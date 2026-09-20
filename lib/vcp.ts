import type { Candle } from '@/lib/indicators';

/**
 * Minervini VCP detection — the Stage 2 template and the contraction pattern, transcribed from
 * `.agents/skills/vcp-screener`.
 *
 * What is reproduced, and what deliberately is not, stated plainly because the difference matters to
 * anyone reading a result:
 *
 * - **Reproduced** from `references/vcp_methodology.md`: the 7-point Trend Template (six points are
 *   computable from price history; relative strength needs a universe rank and is an optional
 *   input), the contraction rules with their documented depths and tightening ratios, the pivot, the
 *   stop, and the volume dry-up bands.
 * - **Not reproduced**: the playbook's composite 0-100 score. Its component weights live in
 *   `references/scoring_system.md`, a different document from the methodology, and inventing
 *   plausible weights would produce a number that cannot be compared to the skill's own output while
 *   looking exactly as if it could. Quality is reported from the methodology's stated bands instead.
 *
 * The playbook's script needs an FMP key because it screens the S&P 500. The *pattern* needs only
 * OHLCV, which this app already fetches — so the detector is useful here even though the vendor is
 * not.
 */

export interface TrendTemplateCheck {
    label: string;
    passed: boolean;
    detail: string;
}

export interface TrendTemplateResult {
    passed: number;
    total: number;
    checks: TrendTemplateCheck[];
}

const MIN_TEMPLATE_BARS = 252;
const SMA150_WINDOW = 150;
const SMA200_WINDOW = 200;
const SMA200_SLOPE_DAYS = 22;

function sma(values: number[], period: number): number | null {
    if (values.length < period) return null;
    const slice = values.slice(-period);
    return slice.reduce((sum, value) => sum + value, 0) / period;
}

function smaSeries(values: number[], period: number): number[] {
    const out: number[] = [];
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
        sum += values[index];
        if (index >= period) sum -= values[index - period];
        if (index >= period - 1) out.push(sum / period);
    }
    return out;
}

/**
 * Minervini's 7-point Stage 2 template.
 *
 * Six points come from price alone. The seventh, relative strength, is a rank against a universe and
 * cannot be derived from one series — so it is an optional input, and when it is absent the template
 * reports `total: 6` rather than silently marking the point as failed. A caller comparing "5 of 6"
 * against the playbook's "6 of 7" needs to know which set it was measured against.
 */
export function trendTemplate(
    closes: number[],
    options: { rsPercentile?: number | null } = {}
): TrendTemplateResult | null {
    if (closes.length < MIN_TEMPLATE_BARS) return null;

    const price = closes[closes.length - 1];
    const sma50 = sma(closes, 50);
    const sma150 = sma(closes, SMA150_WINDOW);
    const sma200 = sma(closes, SMA200_WINDOW);
    if (sma50 === null || sma150 === null || sma200 === null || !(price > 0)) return null;

    // 200-day slope: the playbook wants it rising for 22+ sessions, which is a comparison against the
    // value 22 sessions ago rather than a fitted slope.
    const sma200s = smaSeries(closes, SMA200_WINDOW);
    const priorIndex = sma200s.length - 1 - SMA200_SLOPE_DAYS;
    const prior200 = priorIndex >= 0 ? sma200s[priorIndex] : null;

    const year = closes.slice(-MIN_TEMPLATE_BARS);
    const low52 = Math.min(...year);
    const high52 = Math.max(...year);

    const checks: TrendTemplateCheck[] = [
        {
            label: 'Price above the 150-day and 200-day averages',
            passed: price > sma150 && price > sma200,
            detail: `price ${price.toFixed(2)} vs 150d ${sma150.toFixed(2)}, 200d ${sma200.toFixed(2)}`,
        },
        {
            label: '150-day average above the 200-day',
            passed: sma150 > sma200,
            detail: `150d ${sma150.toFixed(2)} vs 200d ${sma200.toFixed(2)}`,
        },
        {
            label: `200-day average rising for ${SMA200_SLOPE_DAYS}+ sessions`,
            passed: prior200 !== null && sma200 > prior200,
            detail: prior200 === null ? 'not enough history' : `200d ${sma200.toFixed(2)} vs ${prior200.toFixed(2)} ${SMA200_SLOPE_DAYS} sessions ago`,
        },
        {
            label: 'Price above the 50-day average',
            passed: price > sma50,
            detail: `price ${price.toFixed(2)} vs 50d ${sma50.toFixed(2)}`,
        },
        {
            label: 'At least 25% above the 52-week low',
            passed: low52 > 0 && (price / low52 - 1) * 100 >= 25,
            detail: `+${(((price / low52) - 1) * 100).toFixed(1)}% above ${low52.toFixed(2)}`,
        },
        {
            label: 'Within 25% of the 52-week high',
            passed: high52 > 0 && (1 - price / high52) * 100 <= 25,
            detail: `${(((high52 - price) / high52) * 100).toFixed(1)}% below ${high52.toFixed(2)}`,
        },
    ];

    if (typeof options.rsPercentile === 'number' && Number.isFinite(options.rsPercentile)) {
        checks.push({
            label: 'Relative strength above 70',
            passed: options.rsPercentile > 70,
            detail: `RS ${options.rsPercentile.toFixed(0)}`,
        });
    }

    return { passed: checks.filter((check) => check.passed).length, total: checks.length, checks };
}

export interface Contraction {
    /** Peak-to-trough depth in percent. */
    depthPct: number;
    peakIndex: number;
    troughIndex: number;
}

export interface VcpDetection {
    valid: boolean;
    contractions: Contraction[];
    /** High of the final contraction — the level to buy through. */
    pivot: number | null;
    /** 1-2% below the final contraction's low, per the methodology. */
    stop: number | null;
    riskPct: number | null;
    /** Last-10-bar volume over the 50-day average. Lower is calmer. */
    dryUpRatio: number | null;
    dryUpBand: 'exceptional' | 'strong' | 'adequate' | 'weak' | null;
    /** Why it failed, when it did. Empty when valid. */
    reasons: string[];
}

interface Swing {
    kind: 'high' | 'low';
    index: number;
    price: number;
}

function atr(bars: Candle[], index: number, period = 14): number | null {
    if (index < period) return null;
    let sum = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
        const bar = bars[cursor];
        const previous = bars[cursor - 1];
        sum += Math.max(
            bar.h - bar.l,
            Math.abs(bar.h - previous.c),
            Math.abs(bar.l - previous.c)
        );
    }
    return sum / period;
}

/**
 * Alternating swing extremes, detected by an ATR-scaled reversal rather than by fixed windows.
 *
 * The playbook exposes `--atr-multiplier` for exactly this, and scaling by volatility is what makes
 * the detector work across a quiet large-cap and a fast mover without a per-symbol threshold.
 */
function zigzag(bars: Candle[], multiplier: number): Swing[] {
    const swings: Swing[] = [];
    if (bars.length < 20) return swings;

    let direction: 'up' | 'down' = 'up';
    let extremeIndex = 0;
    let extremePrice = bars[0].c;

    for (let index = 1; index < bars.length; index += 1) {
        const price = bars[index].c;
        const range = atr(bars, index);
        if (range === null || range <= 0) continue;
        const threshold = range * multiplier;

        if (direction === 'up') {
            if (price > extremePrice) {
                extremeIndex = index;
                extremePrice = price;
            } else if (extremePrice - price >= threshold) {
                swings.push({ kind: 'high', index: extremeIndex, price: extremePrice });
                direction = 'down';
                extremeIndex = index;
                extremePrice = price;
            }
        } else if (price < extremePrice) {
            extremeIndex = index;
            extremePrice = price;
        } else if (price - extremePrice >= threshold) {
            swings.push({ kind: 'low', index: extremeIndex, price: extremePrice });
            direction = 'up';
            extremeIndex = index;
            extremePrice = price;
        }
    }

    // The final leg is still forming; it is not a completed swing and must not be treated as one.
    swings.push({ kind: direction === 'up' ? 'high' : 'low', index: extremeIndex, price: extremePrice });
    return swings;
}

/**
 * The VCP itself: successive contractions, each at least 25% tighter than the last.
 *
 * Starting from the highest swing high in the window, because the pattern is defined relative to the
 * high that began the base — a shallower contraction *before* it is a different structure and
 * including it would make an ordinary pullback look like a tightening sequence.
 */
export function detectVcp(
    bars: Candle[],
    options: { lookbackDays?: number; atrMultiplier?: number; minT1DepthPct?: number; maxT1DepthPct?: number; contractionRatio?: number; minContractions?: number } = {}
): VcpDetection | null {
    const lookback = options.lookbackDays ?? 120;
    const multiplier = options.atrMultiplier ?? 1.5;
    const minT1 = options.minT1DepthPct ?? 8;
    const maxT1 = options.maxT1DepthPct ?? 35;
    const ratio = options.contractionRatio ?? 0.75;
    const minContractions = options.minContractions ?? 2;

    if (bars.length < lookback + 20) return null;

    const window = bars.slice(-lookback);
    const offset = bars.length - window.length;
    const swings = zigzag(window, multiplier);

    const reasons: string[] = [];
    const firstHighIndex = swings.findIndex((swing) => swing.kind === 'high');
    if (firstHighIndex === -1) {
        return {
            valid: false,
            contractions: [],
            pivot: null,
            stop: null,
            riskPct: null,
            dryUpRatio: null,
            dryUpBand: null,
            reasons: ['no swing high in the window'],
        };
    }

    // Highest swing high from the first high onward: the start of the base.
    let peak = swings[firstHighIndex];
    for (let index = firstHighIndex; index < swings.length; index += 1) {
        if (swings[index].kind === 'high' && swings[index].price > peak.price) peak = swings[index];
    }
    const peakAt = swings.indexOf(peak);

    const contractions: Contraction[] = [];
    for (let index = peakAt; index + 1 < swings.length; index += 2) {
        const high = swings[index];
        const low = swings[index + 1];
        if (!high || !low || high.kind !== 'high' || low.kind !== 'low') break;
        contractions.push({
            depthPct: ((high.price - low.price) / high.price) * 100,
            peakIndex: high.index + offset,
            troughIndex: low.index + offset,
        });
    }

    // The pivot is the high that began the most recent *completed* contraction. The final leg in the
    // series is still forming, so it is skipped rather than read as a finished swing — otherwise a
    // pattern that is mid-decline reports no pivot at all, which is exactly when the trader needs one.
    let lastLowAt = -1;
    for (let index = swings.length - 1; index >= 0; index -= 1) {
        if (swings[index].kind === 'low') {
            lastLowAt = index;
            break;
        }
    }
    const lastLow = lastLowAt >= 0 ? swings[lastLowAt] : null;
    const pivot = lastLowAt > 0 ? swings[lastLowAt - 1].price : null;

    // Volume dry-up: the last ten bars against the 50-day average.
    const volumes = window.map((bar) => bar.v);
    const averageVolume = sma(volumes, Math.min(50, volumes.length));
    const recentVolume = volumes.slice(-10).reduce((sum, value) => sum + value, 0) / Math.min(10, volumes.length);
    const dryUpRatio = averageVolume && averageVolume > 0 ? recentVolume / averageVolume : null;
    const dryUpBand =
        dryUpRatio === null
            ? null
            : dryUpRatio < 0.3
              ? 'exceptional'
              : dryUpRatio <= 0.5
                ? 'strong'
                : dryUpRatio <= 0.7
                  ? 'adequate'
                  : 'weak';

    if (contractions.length < minContractions) reasons.push(`only ${contractions.length} contraction(s); ${minContractions} required`);
    if (contractions.length > 0 && (contractions[0].depthPct < minT1 || contractions[0].depthPct > maxT1)) {
        reasons.push(`first contraction ${contractions[0].depthPct.toFixed(1)}% is outside ${minT1}-${maxT1}%`);
    }
    for (let index = 1; index < contractions.length; index += 1) {
        const previous = contractions[index - 1].depthPct;
        const current = contractions[index].depthPct;
        // "Expanding contractions: if T2 > T1, it is NOT a VCP" — the methodology's own words.
        if (current > previous * ratio) {
            reasons.push(
                `contraction ${index + 1} at ${current.toFixed(1)}% is not at least ${((1 - ratio) * 100).toFixed(0)}% tighter than ${previous.toFixed(1)}%`
            );
        }
    }

    const stop = lastLow ? lastLow.price * 0.99 : null;

    return {
        valid: reasons.length === 0,
        contractions,
        pivot,
        stop,
        riskPct: pivot !== null && stop !== null && pivot > 0 ? ((pivot - stop) / pivot) * 100 : null,
        dryUpRatio,
        dryUpBand,
        reasons,
    };
}
