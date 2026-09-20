/**
 * The six breadth component calculators, transcribed from `calculators/*.py` in
 * `.agents/skills/market-breadth-analyzer`.
 *
 * Pure: every input is parsed rows and the summary map, so each band can be tested against a fixed
 * fixture and none of them can quietly depend on the network.
 *
 * Two things are carried over deliberately rather than "fixed":
 *
 * - **Python's `round()` is half-to-even, and JavaScript's `Math.round` rounds half up.** The
 *   difference is not academic here: component 1 computes `0.70 × level + 0.30 × trend`, which lands
 *   on an exact half whenever the level band is odd (35, 65, 95), so 30.5 must become 30 and not 31
 *   for the score to match the skill's output.
 * - **A component that cannot be computed returns null, not 50.** The reference returns 50 *and*
 *   `data_available: false`, and its composite zeroes the weight — so the 50 never reaches the sum.
 *   `null` says the same thing in one field instead of two, and makes the zero-weight path the only
 *   one that exists.
 *
 * Components 1 and 3 treat a missing 200-day trend as a downtrend, because `trend == 1` is false for
 * `None` as well as for `-1`. That is the reference behaviour, not an oversight, and it is the
 * pessimistic direction — worth knowing when a data gap shows up as bearish.
 */

import type { BreadthRow } from '@/lib/breadth-csv';
import { composeBreadthScore, type BreadthComponentKey, type BreadthComposite } from '@/lib/breadth-score';

export interface ComponentResult {
    key: BreadthComponentKey;
    /** null when the component could not be computed; its weight is redistributed. */
    score: number | null;
    signal: string;
    detail: Record<string, number | string | boolean | null>;
}

/** Half-to-even, matching Python's `round()`. */
export function roundHalfEven(value: number): number {
    const floor = Math.floor(value);
    const fraction = value - floor;
    if (fraction > 0.5) return floor + 1;
    if (fraction < 0.5) return floor;
    return floor % 2 === 0 ? floor : floor + 1;
}

function roundHalfEvenTo(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return roundHalfEven(value * factor) / factor;
}

function clamp(value: number, low: number, high: number): number {
    return Math.max(low, Math.min(high, value));
}

function last<T>(items: T[]): T {
    return items[items.length - 1];
}

/** Band lookup: the first floor the value reaches, mirroring the reference's if/elif chains. */
function band(value: number, bands: [floor: number, score: number][], fallback: number): number {
    for (const [floor, score] of bands) {
        if (value >= floor) return score;
    }
    return fallback;
}

function safeFloat(value: string | undefined): number | null {
    if (value === undefined) return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

// ── C1: Current Breadth Level & Trend (25%) ─────────────────────────────

export function breadthLevelTrend(rows: BreadthRow[]): ComponentResult {
    const key = 'breadth_level_trend' as const;
    const latest = rows.length > 0 ? last(rows) : null;
    if (!latest || latest.breadth8Ma === null) {
        return { key, score: null, signal: 'NO DATA: No breadth data available', detail: {} };
    }

    const ma8 = latest.breadth8Ma;
    const trend = latest.breadth200MaTrend;
    const levelScore = band(ma8, [[0.7, 95], [0.6, 80], [0.5, 65], [0.4, 50], [0.3, 35], [0.2, 20]], 5);
    const trendScore = trend === 1 ? 80 : 20;

    let direction: string | null = null;
    let modifier = 0;
    if (rows.length >= 6) {
        const previous = rows[rows.length - 6].breadth8Ma;
        if (previous !== null) {
            if (ma8 > previous) direction = 'rising';
            else if (ma8 < previous) direction = 'falling';
            else direction = 'flat';

            if (direction === 'falling' && ma8 > 0.6) modifier = -10;
            else if (direction === 'falling' && ma8 < 0.4) modifier = 5;
            else if (direction === 'rising' && ma8 < 0.6) modifier = 5;
        }
    }

    const score = clamp(roundHalfEven(0.7 * levelScore + 0.3 * trendScore) + modifier, 0, 100);
    const state =
        score >= 80 ? 'STRONG' : score >= 60 ? 'HEALTHY' : score >= 40 ? 'NEUTRAL' : score >= 20 ? 'WEAK' : 'CRITICAL';

    return {
        key,
        score,
        signal: `${state}: 8MA=${ma8.toFixed(3)} in ${trend === 1 ? 'uptrend' : 'downtrend'}`,
        detail: {
            current_8ma: ma8,
            current_200ma: latest.breadth200Ma,
            trend,
            level_score: levelScore,
            trend_score: trendScore,
            direction,
            direction_modifier: modifier,
            date: latest.date,
        },
    };
}

// ── C2: 8MA vs 200MA Crossover Dynamics (20%) ───────────────────────────

export function maCrossover(rows: BreadthRow[]): ComponentResult {
    const key = 'ma_crossover' as const;
    if (rows.length < 6) {
        return { key, score: null, signal: 'NO DATA: Insufficient data for crossover analysis', detail: {} };
    }

    const latest = last(rows);
    if (latest.breadth8Ma === null || latest.breadth200Ma === null) {
        return { key, score: null, signal: 'NO DATA: Missing moving averages', detail: {} };
    }

    const ma8 = latest.breadth8Ma;
    const gap = ma8 - latest.breadth200Ma;
    const gapScore = band(
        gap,
        [[0.15, 95], [0.1, 80], [0.05, 65], [0, 50], [-0.05, 35], [-0.1, 20]],
        5
    );

    const previous = rows[rows.length - 6].breadth8Ma;
    const rising = previous !== null && ma8 > previous;

    // The two signals the reference calls out by name: a rising 8MA below the 200MA is a recovery,
    // and a falling 8MA above it is deterioration. Both are the *early* warning, before the cross.
    let modifier = 0;
    if (gap < 0 && rising) modifier = 10;
    else if (gap > 0 && !rising) modifier = -10;

    const score = clamp(roundHalfEven(gapScore + modifier), 0, 100);
    const state =
        score >= 80 ? 'BULLISH' : score >= 60 ? 'POSITIVE' : score >= 40 ? 'NEUTRAL' : score >= 20 ? 'NEGATIVE' : 'BEARISH';

    return {
        key,
        score,
        signal: `${state}: gap=${gap >= 0 ? '+' : ''}${gap.toFixed(3)}, 8MA ${rising ? 'rising' : 'falling'}`,
        detail: {
            gap,
            gap_score: gapScore,
            current_8ma: ma8,
            current_200ma: latest.breadth200Ma,
            ma8_direction: rising ? 'rising' : 'falling',
            direction_modifier: modifier,
            date: latest.date,
        },
    };
}

// ── C3: Peak/Trough Cycle Position (20%) ────────────────────────────────

export function cyclePosition(rows: BreadthRow[]): ComponentResult {
    const key = 'cycle_position' as const;
    if (rows.length < 10) {
        return { key, score: null, signal: 'NO DATA: Insufficient data for cycle analysis', detail: {} };
    }

    const recent = rows.slice(-Math.min(120, rows.length));

    let markerType: 'PEAK' | 'TROUGH' | null = null;
    let markerIndex = -1;
    for (let index = recent.length - 1; index >= 0; index -= 1) {
        if (recent[index].isPeak) {
            markerType = 'PEAK';
            markerIndex = index;
            break;
        }
        if (recent[index].isTrough || recent[index].isTrough8MaBelow04) {
            markerType = 'TROUGH';
            markerIndex = index;
            break;
        }
    }

    const current8Ma = last(rows).breadth8Ma;
    const fiveDaysAgo = rows[rows.length - 6].breadth8Ma;
    const trend = current8Ma !== null && fiveDaysAgo !== null && current8Ma > fiveDaysAgo ? 'rising' : 'falling';

    // No marker in the window means the cycle position is genuinely unknown, not neutral — the
    // reference reports it as unavailable and lets the other components carry the composite.
    if (markerType === null) {
        return {
            key,
            score: null,
            signal: 'NEUTRAL: No cycle marker in last 120 days',
            detail: { current_8ma: current8Ma, ma8_trend: trend, latest_marker_type: null },
        };
    }

    const daysSince = recent.length - 1 - markerIndex;
    const extremeTrough = markerType === 'TROUGH' && recent[markerIndex].isTrough8MaBelow04;
    const rising = trend === 'rising';

    let score: number;
    if (markerType === 'TROUGH') {
        if (daysSince <= 20) score = rising ? 85 : 30;
        else if (daysSince <= 60) score = rising ? 75 : 35;
        else score = rising ? 65 : 40;
        if (extremeTrough) score += 10;
    } else if (daysSince <= 20) {
        score = rising ? 60 : 20;
    } else if (daysSince <= 60) {
        score = rising ? 45 : 15;
    } else {
        score = rising ? 50 : 10;
    }

    return {
        key,
        score: clamp(score, 0, 100),
        signal: `${markerType} (${daysSince}d ago), 8MA ${trend}`,
        detail: {
            latest_marker_type: markerType,
            days_since_marker: daysSince,
            ma8_trend: trend,
            current_8ma: current8Ma,
            extreme_trough: extremeTrough,
            date: last(rows).date,
        },
    };
}

// ── C4: Bearish Signal Status (15%) ─────────────────────────────────────

export function bearishSignalStatus(rows: BreadthRow[]): ComponentResult {
    const key = 'bearish_signal' as const;
    const latest = rows.length > 0 ? last(rows) : null;
    if (!latest || latest.breadth8Ma === null || latest.breadth200Ma === null) {
        return { key, score: null, signal: 'NO DATA: No data available', detail: {} };
    }

    const active = latest.bearishSignal;
    const trend = latest.breadth200MaTrend;
    const ma8 = latest.breadth8Ma;
    const ma200 = latest.breadth200Ma;

    // The "Pink Zone" from the source repository's chart: structural weakness signalled by the trend
    // and the cross alone, without the backtested flag. Consecutive days are counted because
    // persistence is what separates a wobble from a regime.
    const inPinkZone = trend === -1 && ma8 < ma200;
    let pinkZoneDays = 0;
    if (inPinkZone) {
        for (let index = rows.length - 1; index >= 0; index -= 1) {
            const row = rows[index];
            if (row.breadth200MaTrend === -1 && row.breadth8Ma !== null && row.breadth200Ma !== null && row.breadth8Ma < row.breadth200Ma) {
                pinkZoneDays += 1;
            } else break;
        }
    }

    const base = !active && trend === 1 ? 85 : !active && trend === -1 ? 50 : active && trend === 1 ? 30 : 10;

    let contextAdjustment = 0;
    if (active) {
        if (ma8 > 0.5) contextAdjustment = 15;
        else if (ma8 < 0.25) contextAdjustment = -5;
    }

    const pinkZoneAdjustment = inPinkZone && !active ? -10 : 0;
    const score = clamp(roundHalfEven(base + contextAdjustment + pinkZoneAdjustment), 0, 100);

    return {
        key,
        score,
        signal: `${active ? 'BEARISH: signal active' : 'No bearish signal'}, ${trend === 1 ? 'uptrend' : 'downtrend'}${inPinkZone ? ' [PINK ZONE]' : ''}`,
        detail: {
            signal_active: active,
            trend,
            current_8ma: ma8,
            in_pink_zone: inPinkZone,
            pink_zone_days: pinkZoneDays,
            base_score: base,
            context_adjustment: contextAdjustment,
            pink_zone_adjustment: pinkZoneAdjustment,
            date: latest.date,
        },
    };
}

// ── C5: Historical Percentile (10%) ─────────────────────────────────────

export function historicalPercentile(rows: BreadthRow[], summary: Record<string, string>): ComponentResult {
    const key = 'historical_percentile' as const;
    const values = rows.map((row) => row.breadth8Ma).filter((value): value is number => value !== null);
    if (values.length === 0) {
        return { key, score: null, signal: 'NO DATA: No data available for historical analysis', detail: {} };
    }

    const current = last(values);
    const below = values.filter((value) => value < current).length;
    const percentile = (below / values.length) * 100;
    const baseScore = band(percentile, [[80, 90], [60, 70], [40, 50], [20, 30]], 10);

    const averagePeak = safeFloat(summary['Average Peaks (200MA)']);
    const averageTrough = safeFloat(summary['Average Troughs (8MA < 0.4)']);

    let adjustment = 0;
    if (averagePeak !== null && current >= averagePeak * 0.95) adjustment = -10;
    else if (averageTrough !== null && current <= averageTrough * 1.05) adjustment = 10;

    const state = baseScore >= 70 ? 'HIGH' : baseScore >= 40 ? 'AVERAGE' : 'LOW';

    return {
        key,
        score: clamp(roundHalfEven(baseScore + adjustment), 0, 100),
        signal: `${state}: ${percentile.toFixed(0)}th percentile${adjustment < 0 ? ' (near historical peak)' : adjustment > 0 ? ' (near historical trough)' : ''}`,
        detail: {
            current_8ma: current,
            percentile_rank: percentile,
            base_score: baseScore,
            adjustment,
            avg_peak: averagePeak,
            avg_trough: averageTrough,
            total_observations: values.length,
            date: last(rows).date,
        },
    };
}

// ── C6: S&P 500 vs Breadth Divergence (10%) ─────────────────────────────

interface DivergenceWindow {
    score: number;
    spPct: number;
    breadthChange: number;
    type: string;
    lookbackDays: number;
}

function divergenceWindow(rows: BreadthRow[], lookback: number): DivergenceWindow {
    const actual = Math.min(lookback, rows.length);
    const latest = last(rows);
    const past = rows[rows.length - actual];

    const spLatest = latest.sp500;
    const spPast = past.sp500;
    const ma8Latest = latest.breadth8Ma;
    const ma8Past = past.breadth8Ma;

    if (spLatest === null || spPast === null || ma8Latest === null || ma8Past === null || spPast <= 0) {
        return { score: 50, spPct: 0, breadthChange: 0, type: 'Invalid data', lookbackDays: actual };
    }

    const spPct = ((spLatest - spPast) / spPast) * 100;
    const breadthChange = ma8Latest - ma8Past;

    let score: number;
    let type: string;
    // Ordered, because the dangerous cases must be tested before the aligned ones: a market where
    // price rises while participation falls is *both* "SP up" and "breadth down", and only the
    // divergence reading is worth reporting.
    if (spPct > 3 && breadthChange < -0.05) [score, type] = [10, 'Dangerous bearish divergence'];
    else if (spPct > 1 && breadthChange < -0.03) [score, type] = [25, 'Moderate bearish divergence'];
    else if (spPct < -3 && breadthChange > 0.05) [score, type] = [80, 'Strong bullish divergence'];
    else if (spPct < -1 && breadthChange > 0.03) [score, type] = [65, 'Moderate bullish divergence'];
    else if (Math.abs(spPct) < 0.5 && Math.abs(breadthChange) < 0.01) [score, type] = [50, 'Near-flat'];
    else if (spPct > 0 && breadthChange > 0) [score, type] = [70, 'Healthy alignment'];
    else if (spPct <= 0 && breadthChange <= 0) [score, type] = [30, 'Consistent decline'];
    else [score, type] = [50, 'Mixed signals'];

    return { score, spPct, breadthChange, type, lookbackDays: actual };
}

export function divergence(rows: BreadthRow[]): ComponentResult {
    const key = 'divergence' as const;
    if (rows.length < 20) {
        return { key, score: null, signal: 'NO DATA: Insufficient data for divergence analysis', detail: {} };
    }

    const medium = divergenceWindow(rows, 60);
    const short = divergenceWindow(rows, 20);
    const score = clamp(roundHalfEvenTo(medium.score * 0.6 + short.score * 0.4, 1), 0, 100);

    // The signal worth acting on early: the short window has already turned while the long one has
    // not, which is what a divergence looks like before it becomes structural.
    const earlyWarning = short.score <= 25 && medium.score >= 50;

    return {
        key,
        score,
        signal: `${medium.type}: S&P ${medium.spPct >= 0 ? '+' : ''}${medium.spPct.toFixed(1)}%, breadth ${medium.breadthChange >= 0 ? '+' : ''}${medium.breadthChange.toFixed(3)} over 60d${earlyWarning ? ' [EARLY WARNING]' : ''}`,
        detail: {
            sp500_pct_change_60d: roundHalfEvenTo(medium.spPct, 2),
            breadth_change_60d: roundHalfEvenTo(medium.breadthChange, 4),
            score_60d: medium.score,
            score_20d: short.score,
            early_warning: earlyWarning,
            date: last(rows).date,
        },
    };
}

// ── Assembly ────────────────────────────────────────────────────────────

export interface BreadthAssessment {
    components: ComponentResult[];
    composite: BreadthComposite;
}

/**
 * Every component, then the composite over whichever of them could be computed.
 *
 * The two halves stay separate so a caller can show the components alongside the score. The composite
 * is the headline, but *which* components disagree is what says whether to trust it — a 55 built from
 * six readings near the middle and a 55 built from three high and three low are different markets.
 */
export function assessBreadth(rows: BreadthRow[], summary: Record<string, string> = {}): BreadthAssessment {
    const components: ComponentResult[] = [
        breadthLevelTrend(rows),
        maCrossover(rows),
        cyclePosition(rows),
        bearishSignalStatus(rows),
        historicalPercentile(rows, summary),
        divergence(rows),
    ];

    const scores = Object.fromEntries(components.map((component) => [component.key, component.score])) as Partial<
        Record<BreadthComponentKey, number | null>
    >;

    return { components, composite: composeBreadthScore(scores) };
}
