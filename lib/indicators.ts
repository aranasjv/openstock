/**
 * Technical indicators, implemented directly rather than pulling in a library.
 *
 * The npm `technicalindicators` package has not been published in ~6 years; these are
 * short, well-understood formulas and they are covered by unit tests (see
 * __tests__/indicators.test.ts) including reference values.
 *
 * Every function returns `null` when there is not enough history to compute a value, so
 * short-lived assets are skipped rather than throwing or producing a misleading number.
 */

export interface Candle {
    /** Unix seconds. */
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
}

export type Series = number[];

export function closes(candles: Candle[]): Series {
    return candles.map((candle) => candle.c);
}

export function volumes(candles: Candle[]): Series {
    return candles.map((candle) => candle.v);
}

/** Simple moving average of the most recent `period` values. */
export function sma(values: Series, period: number): number | null {
    if (period <= 0 || values.length < period) return null;
    const window = values.slice(-period);
    return window.reduce((sum, value) => sum + value, 0) / period;
}

/**
 * Exponential moving average. Seeded with the SMA of the first `period` values, then
 * smoothed with k = 2 / (period + 1) — the standard formulation.
 */
export function ema(values: Series, period: number): number | null {
    if (period <= 0 || values.length < period) return null;

    const k = 2 / (period + 1);
    let value = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;

    for (let i = period; i < values.length; i++) {
        value = values[i] * k + value * (1 - k);
    }

    return value;
}

/**
 * Wilder's RSI. Returns the value at the end of the series.
 * Returns null if there are fewer than period + 1 values (one change needs two prices).
 */
export function rsi14(values: Series, period = 14): number | null {
    if (period <= 0 || values.length < period + 1) return null;

    let gainSum = 0;
    let lossSum = 0;

    // Seed with the first `period` changes (simple average).
    for (let i = 1; i <= period; i++) {
        const change = values[i] - values[i - 1];
        if (change >= 0) gainSum += change;
        else lossSum -= change;
    }

    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;

    // Then Wilder-smooth across the remainder.
    for (let i = period + 1; i < values.length; i++) {
        const change = values[i] - values[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    // A flat series has no gains and no losses, so relative strength is undefined.
    // Conventionally libraries report 100 here, but 100 reads as "extremely overbought"
    // for a price that has not moved at all, so report neutral instead.
    if (avgGain === 0 && avgLoss === 0) return 50;
    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}

export interface MacdResult {
    macd: number;
    signal: number;
    histogram: number;
}

/**
 * MACD (12/26/9). Computed by walking the series with EMA series so the signal line is
 * a real EMA of the MACD line rather than an approximation.
 */
export function macd(values: Series, fast = 12, slow = 26, signalPeriod = 9): MacdResult | null {
    if (values.length < slow + signalPeriod) return null;

    const fastK = 2 / (fast + 1);
    const slowK = 2 / (slow + 1);

    let fastEma = values.slice(0, fast).reduce((sum, v) => sum + v, 0) / fast;
    let slowEma = values.slice(0, slow).reduce((sum, v) => sum + v, 0) / slow;

    // Build the MACD line for every bar from `slow` onwards.
    const macdLine: number[] = [];
    for (let i = 0; i < values.length; i++) {
        if (i >= fast) fastEma = values[i] * fastK + fastEma * (1 - fastK);
        if (i >= slow) {
            slowEma = values[i] * slowK + slowEma * (1 - slowK);
            macdLine.push(fastEma - slowEma);
        }
    }

    if (macdLine.length < signalPeriod) return null;

    const signalK = 2 / (signalPeriod + 1);
    let signal = macdLine.slice(0, signalPeriod).reduce((sum, v) => sum + v, 0) / signalPeriod;
    for (let i = signalPeriod; i < macdLine.length; i++) {
        signal = macdLine[i] * signalK + signal * (1 - signalK);
    }

    const macdValue = macdLine[macdLine.length - 1];
    return { macd: macdValue, signal, histogram: macdValue - signal };
}

/** Highest value over the last `period` values (inclusive of the latest). */
export function rollingMax(values: Series, period: number): number | null {
    if (period <= 0 || values.length < period) return null;
    return Math.max(...values.slice(-period));
}

export function rollingMin(values: Series, period: number): number | null {
    if (period <= 0 || values.length < period) return null;
    return Math.min(...values.slice(-period));
}

/** Average of the last `period` values, excluding the most recent one. */
export function averageVolumePrior(values: Series, period: number): number | null {
    if (period <= 0 || values.length < period + 1) return null;
    const window = values.slice(-(period + 1), -1);
    return window.reduce((sum, value) => sum + value, 0) / period;
}

/** Percentage change across the last `period` values, as a percentage. */
export function pctChange(values: Series, period: number): number | null {
    if (values.length < period + 1) return null;
    const start = values[values.length - 1 - period];
    const end = values[values.length - 1];
    if (start === 0) return null;
    return ((end - start) / start) * 100;
}

/** Largest peak-to-trough decline over the series, as a positive percentage. */
export function maxDrawdown(values: Series): number | null {
    if (values.length < 2) return null;

    let peak = values[0];
    let worst = 0;

    for (const value of values) {
        if (value > peak) peak = value;
        if (peak > 0) {
            const drawdown = ((peak - value) / peak) * 100;
            if (drawdown > worst) worst = drawdown;
        }
    }

    return worst;
}

/** Standard deviation of daily percentage returns, as a percentage. */
export function volatility(values: Series): number | null {
    if (values.length < 3) return null;

    const returns: number[] = [];
    for (let i = 1; i < values.length; i++) {
        if (values[i - 1] === 0) continue;
        returns.push(((values[i] - values[i - 1]) / values[i - 1]) * 100);
    }

    if (returns.length < 2) return null;

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance =
        returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);

    return Math.sqrt(variance);
}

export interface IndicatorBundle {
    price: number;
    sma50: number | null;
    sma200: number | null;
    /** SMA200 as of 20 bars ago, for slope comparison. */
    sma200Prior: number | null;
    rsi14: number | null;
    macd: MacdResult | null;
    high20: number | null;
    low20: number | null;
    avgVolume20: number | null;
    latestVolume: number;
    change5d: number | null;
    change30d: number | null;
    maxDrawdown: number | null;
    volatility: number | null;
    bars: number;
}

/** Compute everything the strategies need, in one pass. */
export function computeIndicators(candles: Candle[]): IndicatorBundle | null {
    if (!candles || candles.length < 30) return null;

    const series = closes(candles);
    const volumeSeries = volumes(candles);

    // SMA200 twenty bars ago: slice off the tail so the window ends 20 bars back.
    const priorSeries = series.slice(0, Math.max(0, series.length - 20));

    return {
        price: series[series.length - 1],
        sma50: sma(series, 50),
        sma200: sma(series, 200),
        sma200Prior: sma(priorSeries, 200),
        rsi14: rsi14(series, 14),
        macd: macd(series),
        high20: rollingMax(series, 20),
        low20: rollingMin(series, 20),
        avgVolume20: averageVolumePrior(volumeSeries, 20),
        latestVolume: volumeSeries[volumeSeries.length - 1] ?? 0,
        change5d: pctChange(series, 5),
        change30d: pctChange(series, 30),
        maxDrawdown: maxDrawdown(series),
        volatility: volatility(series),
        bars: candles.length,
    };
}
