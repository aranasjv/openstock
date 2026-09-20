/**
 * Crypto regime scoring — the six-component model from `.agents/skills/crypto-regime-analyzer`.
 *
 * Pure functions only. Every input is a series or a number the caller has already fetched, so the
 * scoring is testable against fixed snapshots and cannot quietly reach the network. The thresholds
 * are transcribed from `references/crypto_regime_methodology.md` rather than tuned here: the
 * playbook is explicit that they are interpretable heuristics rather than backtested optima, and
 * re-deriving them by feel would make the output incomparable to the documented model.
 *
 * Score direction: 100 = maximum risk-on health, 0 = critical risk-off.
 */

export interface RegimeComponent {
    key: string;
    label: string;
    /** Share of the composite before redistribution, in percentage points. */
    weight: number;
    /** null when the component could not be computed, so its weight is redistributed. */
    score: number | null;
    signal: string;
}

export type RegimeZone = 'RISK_ON' | 'NEUTRAL' | 'RISK_OFF' | 'UNKNOWN';

export interface RegimeResult {
    score: number | null;
    zone: RegimeZone;
    guidance: string;
    components: RegimeComponent[];
    /** Share each component actually contributed, after redistribution. */
    effectiveWeights: Record<string, number>;
}

/**
 * Two bands the methodology leaves as exact equalities, which no real series ever satisfies.
 *
 * "price = 50DMA = 200DMA (flat)" describes a flat market, and "+10 rising / 0 flat / -10 falling"
 * needs a magnitude for "flat". Both are read here as a 0.5% band. This is a transcription choice,
 * and a visible one: it only ever decides the *middle* of each mapping, so a wrong pick cannot
 * turn a bull stack into a bear stack.
 */
const FLAT_BAND_PCT = 0.5;

/** Slope lookback for the 200DMA. */
const SLOPE_LOOKBACK = 20;

/** Longest window any component needs (drawdown and volatility). */
const LONG_WINDOW = 365;

/** Metric day counts, all from the component definitions. */
const MIN_BTC_CLOSES = 220;
const MIN_ALT_CLOSES = 200;
const MIN_DRAWDOWN_CLOSES = 365;
const MIN_MOMENTUM_CLOSES = 31;
const MIN_ALTS = 5;

/** Dominance needs a month of observations before its direction means anything. */
export const MIN_DOMINANCE_OBSERVATIONS = 31;

/** A BTC trend at or above this is "constructive" for the dominance table. */
const BTC_TREND_CONSTRUCTIVE = 60;

export const GUIDANCE: Record<RegimeZone, string> = {
    RISK_ON: 'Broad risk-on conditions observed; review risk limits before decisions',
    NEUTRAL: 'Mixed conditions observed; no strong regime conclusion',
    RISK_OFF: 'Defensive market conditions observed; review existing risk controls',
    UNKNOWN: 'Not enough components had data to describe a regime',
};

// ── Series maths ────────────────────────────────────────────────────

function sma(values: number[], period: number): number | null {
    if (values.length < period) return null;
    let sum = 0;
    for (let i = values.length - period; i < values.length; i++) sum += values[i];
    return sum / period;
}

/** Every trailing simple moving average, so a slope has something to compare against. */
function smaSeries(values: number[], period: number): number[] {
    const out: number[] = [];
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= period) sum -= values[i - period];
        if (i >= period - 1) out.push(sum / period);
    }
    return out;
}

/** Annualised volatility from log returns, in percent. */
function realizedVolPercent(closes: number[], endIndex: number, window: number): number | null {
    if (endIndex - window < 0) return null;

    const returns: number[] = [];
    for (let i = endIndex - window + 1; i <= endIndex; i++) {
        const previous = closes[i - 1];
        const current = closes[i];
        if (previous > 0 && current > 0) returns.push(Math.log(current / previous));
    }
    if (returns.length < 2) return null;

    const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
    const variance =
        returns.reduce((total, value) => total + (value - mean) ** 2, 0) / (returns.length - 1);

    return Math.sqrt(variance) * Math.sqrt(365) * 100;
}

/**
 * Where today's 30-day volatility sits in its own trailing year.
 *
 * Sampled weekly, per the methodology: daily samples over a year are ~365 overlapping
 * observations of a 30-day window, which correlates so heavily that the distribution is much
 * narrower than the real spread of regimes and almost everything lands in the middle third.
 */
function volatilityTertile(closes: number[]): 'low' | 'mid' | 'high' | null {
    const current = realizedVolPercent(closes, closes.length - 1, 30);
    if (current === null) return null;

    const history: number[] = [];
    for (let end = closes.length - 1; end >= Math.max(30, closes.length - LONG_WINDOW); end -= 7) {
        const value = realizedVolPercent(closes, end, 30);
        if (value !== null) history.push(value);
    }
    if (history.length < 6) return null;

    history.sort((a, b) => a - b);
    const lower = history[Math.floor(history.length / 3)];
    const upper = history[Math.floor((history.length * 2) / 3)];

    if (current <= lower) return 'low';
    if (current >= upper) return 'high';
    return 'mid';
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));

// ── 1. BTC trend structure (25%) ────────────────────────────────────

export function btcTrendStructure(closes: number[]): { score: number; signal: string } | null {
    if (closes.length < MIN_BTC_CLOSES) return null;

    const price = closes[closes.length - 1];
    const sma50 = sma(closes, 50);
    const sma200 = sma(closes, 200);
    if (sma50 === null || sma200 === null || !(price > 0) || !(sma200 > 0)) return null;

    const series = smaSeries(closes, 200);
    const last = series[series.length - 1];
    const prior = series[series.length - 1 - SLOPE_LOOKBACK];
    if (prior === undefined || !(prior > 0)) return null;

    const slopePct = ((last - prior) / prior) * 100;

    const bandFrom200 = ((price - sma200) / sma200) * 100;
    const gap = ((sma50 - sma200) / sma200) * 100;

    let base: number;
    let structure: string;

    if (Math.abs(bandFrom200) < FLAT_BAND_PCT && Math.abs(gap) < FLAT_BAND_PCT) {
        base = 50;
        structure = 'flat';
    } else if (price > sma50 && sma50 > sma200) {
        base = 90;
        structure = 'bull stack';
    } else if (price < sma50 && price > sma200 && sma50 > sma200) {
        base = 65;
        structure = 'pullback within an intact stack';
    } else if (price < sma50 && price < sma200 && sma50 > sma200) {
        base = 55;
        structure = 'below both averages, stack intact';
    } else if (price > sma50 && sma50 <= sma200) {
        base = 45;
        structure = 'recovery attempt';
    } else {
        base = 15;
        structure = 'bear stack';
    }

    const slopeModifier = slopePct > FLAT_BAND_PCT ? 10 : slopePct < -FLAT_BAND_PCT ? -10 : 0;
    const slopeWord = slopeModifier > 0 ? 'rising' : slopeModifier < 0 ? 'falling' : 'flat';

    const crossWatch = Math.abs(gap) < 1.5 ? ', 50/200 within 1.5% — cross watch' : '';

    return {
        score: clamp(base + slopeModifier),
        signal: `${structure}; 200DMA ${slopeWord} (${slopePct.toFixed(1)}%)${crossWatch}`,
    };
}

// ── 2. Alt breadth participation (20%) ──────────────────────────────

export interface CoinSeries {
    symbol: string;
    closes: number[];
}

export function altBreadthParticipation(
    alts: CoinSeries[]
): { score: number; signal: string } | null {
    const usable = alts.filter((alt) => alt.closes.length >= MIN_ALT_CLOSES);
    const skipped = alts.filter((alt) => alt.closes.length < MIN_ALT_CLOSES).map((alt) => alt.symbol);
    if (usable.length < MIN_ALTS) return null;

    let above200 = 0;
    let above50 = 0;
    for (const alt of usable) {
        const price = alt.closes[alt.closes.length - 1];
        const mean200 = sma(alt.closes, 200);
        const mean50 = sma(alt.closes, 50);
        if (mean200 !== null && price > mean200) above200++;
        if (mean50 !== null && price > mean50) above50++;
    }

    const pct200 = (above200 / usable.length) * 100;
    const pct50 = (above50 / usable.length) * 100;

    const base =
        pct200 >= 80 ? 95 : pct200 >= 65 ? 80 : pct200 >= 50 ? 65 : pct200 >= 35 ? 45 : pct200 >= 20 ? 25 : 10;

    const lead = pct50 - pct200;
    const modifier = lead >= 15 ? 5 : lead <= -15 ? -5 : 0;
    const leadWord = modifier > 0 ? 'fresh thrust' : modifier < 0 ? 'rolling over' : 'in line';

    const skippedNote = skipped.length > 0 ? `; ${skipped.length} skipped for short history` : '';

    return {
        score: clamp(base + modifier),
        signal: `${pct200.toFixed(0)}% of ${usable.length} alts above the 200DMA; 50DMA breadth ${leadWord}${skippedNote}`,
    };
}

// ── 3. BTC dominance regime (15%) ───────────────────────────────────

export function dominanceRegime(
    series: number[],
    btcTrendScore: number | null
): { score: number; signal: string } | null {
    if (series.length < MIN_DOMINANCE_OBSERVATIONS || btcTrendScore === null) return null;

    const latest = series[series.length - 1];
    const prior = series[series.length - 1 - 30];
    if (!Number.isFinite(latest) || !Number.isFinite(prior)) return null;

    const change = latest - prior;
    // A ±0.5pt band: dominance drifts by hundredths daily, so a bare sign would flip the
    // interpretation on noise.
    const direction: 'rising' | 'falling' | 'flat' =
        change > 0.5 ? 'rising' : change < -0.5 ? 'falling' : 'flat';

    const btcUp = btcTrendScore >= BTC_TREND_CONSTRUCTIVE;

    let score: number;
    let reading: string;
    if (btcUp && direction === 'falling') {
        score = 90;
        reading = 'alt rotation — risk-on moving down the risk curve';
    } else if (btcUp && direction === 'flat') {
        score = 75;
        reading = 'flat dominance in an uptrend';
    } else if (btcUp && direction === 'rising') {
        score = 65;
        reading = 'BTC-led, alts lagging';
    } else if (!btcUp && direction === 'rising') {
        score = 30;
        reading = 'defensive rotation inside crypto';
    } else if (!btcUp && direction === 'flat') {
        score = 25;
        reading = 'flat dominance in a downtrend';
    } else {
        score = 10;
        reading = 'indiscriminate de-risking';
    }

    // Extremes are contrarian: they mark washouts and froth rather than continuation.
    let extreme = '';
    if (latest >= 62 && !btcUp) {
        score += 5;
        extreme = '; dominance ≥62% into weakness — washout watch';
    } else if (latest <= 40 && btcUp) {
        score -= 5;
        extreme = '; dominance ≤40% in strength — froth caution';
    }

    return {
        score: clamp(score),
        signal: `${latest.toFixed(1)}% (${change >= 0 ? '+' : ''}${change.toFixed(1)}pt over 30d, ${direction}) — ${reading}${extreme}`,
    };
}

// ── 4. Perpetual funding regime (15%) ───────────────────────────────

/** Band edges as 8h fractions: 0.0001 = +0.010%. */
const FUNDING_WASHED_OUT = -0.0001;
const FUNDING_BASELINE = 0.0001;
const FUNDING_BUILDING = 0.0003;
const FUNDING_CROWDED = 0.0006;

export function fundingRegime(averageRate: number): { score: number; signal: string } | null {
    if (!Number.isFinite(averageRate)) return null;

    let score: number;
    let reading: string;
    if (averageRate <= FUNDING_WASHED_OUT) {
        score = 80;
        reading = 'washed out, shorts paying';
    } else if (averageRate < 0) {
        score = 65;
        reading = 'skeptical';
    } else if (averageRate < FUNDING_BASELINE) {
        score = 75;
        reading = 'neutral (Binance baseline is +0.010%)';
    } else if (averageRate < FUNDING_BUILDING) {
        score = 55;
        reading = 'long leverage building';
    } else if (averageRate < FUNDING_CROWDED) {
        score = 30;
        reading = 'crowded longs';
    } else {
        score = 10;
        reading = 'euphoric — liquidation-cascade risk';
    }

    const asPercent = (averageRate * 100).toFixed(3);
    return { score, signal: `avg ${asPercent}% per 8h — ${reading}` };
}

// ── 5. Drawdown & volatility position (15%) ─────────────────────────

export function drawdownVolatility(closes: number[]): { score: number; signal: string } | null {
    if (closes.length < MIN_DRAWDOWN_CLOSES) return null;

    const window = closes.slice(-LONG_WINDOW);
    const high = Math.max(...window);
    const price = closes[closes.length - 1];
    if (!(high > 0) || !(price > 0)) return null;

    const drawdown = ((high - price) / high) * 100;

    const base =
        drawdown <= 10 ? 90 : drawdown <= 20 ? 75 : drawdown <= 35 ? 55 : drawdown <= 50 ? 35 : drawdown <= 65 ? 20 : 10;

    const tertile = volatilityTertile(closes);
    const modifier = tertile === 'low' ? 10 : tertile === 'high' ? -10 : 0;

    let score = base + modifier;

    // Capitulation: a deep drawdown with expanding volatility has historically marked better
    // forward returns than the same drawdown with volatility already settled.
    const capitulation = drawdown > 65 && tertile === 'high';
    if (capitulation) score = Math.max(score, 15);

    const volNote = tertile ? `, volatility ${tertile}` : ', volatility unavailable';

    return {
        score: clamp(score),
        signal: `${drawdown.toFixed(0)}% below the 1y high${volNote}${capitulation ? ' — capitulation floor applied' : ''}`,
    };
}

// ── 6. Momentum thrust / washout (10%) ──────────────────────────────

export function momentumThrust(coins: CoinSeries[]): { score: number; signal: string } | null {
    const usable = coins.filter((coin) => coin.closes.length >= MIN_MOMENTUM_CLOSES);
    if (usable.length < MIN_ALTS) return null;

    let positive = 0;
    for (const coin of usable) {
        const last = coin.closes[coin.closes.length - 1];
        const prior = coin.closes[coin.closes.length - MIN_MOMENTUM_CLOSES];
        if (last > prior) positive++;
    }

    const pct = (positive / usable.length) * 100;

    // Below 10% the mapping turns contrarian: near-total negative momentum is a washout, and the
    // plain trend mapping would score it as the worst possible reading.
    const score = pct >= 85 ? 90 : pct >= 65 ? 75 : pct >= 45 ? 55 : pct >= 25 ? 35 : pct >= 10 ? 20 : 35;
    const washout = pct < 10 ? ' — washout' : '';

    return {
        score,
        signal: `${pct.toFixed(0)}% of ${usable.length} coins positive over 30d${washout}`,
    };
}

// ── Composite ───────────────────────────────────────────────────────

/** Redistribution floor: four components carrying 65% of the original weight. */
const MIN_AVAILABLE_COMPONENTS = 4;
const MIN_AVAILABLE_WEIGHT_SHARE = 0.65;

export function composeRegime(components: RegimeComponent[]): RegimeResult {
    const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
    const available = components.filter(
        (component): component is RegimeComponent & { score: number } => component.score !== null
    );
    const availableWeight = available.reduce((sum, component) => sum + component.weight, 0);

    if (
        available.length < MIN_AVAILABLE_COMPONENTS ||
        availableWeight < MIN_AVAILABLE_WEIGHT_SHARE * totalWeight
    ) {
        // Sparse input returns UNKNOWN rather than a confident number built from one or two
        // readings. A regime call made on a third of the model is worse than no call, because it
        // is indistinguishable from a real one.
        return {
            score: null,
            zone: 'UNKNOWN',
            guidance: GUIDANCE.UNKNOWN,
            components,
            effectiveWeights: {},
        };
    }

    const score = available.reduce((sum, component) => sum + component.score * component.weight, 0) / availableWeight;

    const effectiveWeights: Record<string, number> = {};
    for (const component of components) {
        effectiveWeights[component.key] =
            component.score === null ? 0 : (component.weight / availableWeight) * 100;
    }

    const zone: RegimeZone = score >= 80 ? 'RISK_ON' : score >= 40 ? 'NEUTRAL' : 'RISK_OFF';

    return { score, zone, guidance: GUIDANCE[zone], components, effectiveWeights };
}

/** The six components with their model weights, in report order. */
export const COMPONENT_WEIGHTS = {
    btcTrend: 25,
    altBreadth: 20,
    dominance: 15,
    funding: 15,
    drawdown: 15,
    momentum: 10,
} as const;

/** 0-100 score with the six components and the composite. */
export function scoreCryptoRegime(input: {
    btcCloses: number[];
    alts: CoinSeries[];
    dominanceSeries: number[];
    fundingAverage: number | null;
    /** BTC included, as the playbook specifies. */
    momentumUniverse: CoinSeries[];
}): RegimeResult {
    const trend = btcTrendStructure(input.btcCloses);
    const breadth = altBreadthParticipation(input.alts);
    const dominance = dominanceRegime(input.dominanceSeries, trend?.score ?? null);
    const funding =
        input.fundingAverage === null ? null : fundingRegime(input.fundingAverage);
    const drawdown = drawdownVolatility(input.btcCloses);
    const momentum = momentumThrust(input.momentumUniverse);

    return composeRegime([
        {
            key: 'btcTrend',
            label: 'BTC trend structure',
            weight: COMPONENT_WEIGHTS.btcTrend,
            score: trend?.score ?? null,
            signal: trend?.signal ?? 'needs 220 daily closes',
        },
        {
            key: 'altBreadth',
            label: 'Alt breadth participation',
            weight: COMPONENT_WEIGHTS.altBreadth,
            score: breadth?.score ?? null,
            signal: breadth?.signal ?? 'needs 5 alts with 200 closes',
        },
        {
            key: 'dominance',
            label: 'BTC dominance regime',
            weight: COMPONENT_WEIGHTS.dominance,
            score: dominance?.score ?? null,
            signal: dominance?.signal ?? 'needs 31 daily dominance observations',
        },
        {
            key: 'funding',
            label: 'Perpetual funding regime',
            weight: COMPONENT_WEIGHTS.funding,
            score: funding?.score ?? null,
            signal: funding?.signal ?? 'funding unavailable',
        },
        {
            key: 'drawdown',
            label: 'Drawdown & volatility',
            weight: COMPONENT_WEIGHTS.drawdown,
            score: drawdown?.score ?? null,
            signal: drawdown?.signal ?? 'needs 365 daily closes',
        },
        {
            key: 'momentum',
            label: 'Momentum thrust / washout',
            weight: COMPONENT_WEIGHTS.momentum,
            score: momentum?.score ?? null,
            signal: momentum?.signal ?? 'needs 5 coins with 31 closes',
        },
    ]);
}
