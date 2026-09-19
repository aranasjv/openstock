import type { IndicatorBundle } from '@/lib/indicators';

/**
 * Rule-based screeners.
 *
 * The conditions are widely used textbook technical setups. The criteria for
 * Oversold Pullback, Breakout and the trend/momentum pair are adapted from the public
 * methodologies in tradermonty/claude-trading-skills (MIT):
 *   - dividend-growth-pullback-screener -> RSI <= 40 pullback in an intact uptrend
 *   - vcp-screener                      -> breakout out of a contraction
 *   - canslim-screener                  -> trend / relative-strength conditions
 * and the weighted conviction score follows the shape of its edge-signal-aggregator.
 *
 * These are conditions, not predictions: passing them says an asset currently matches a
 * pattern, not that it will appreciate. Nothing here is backtested or investment advice.
 */

export type StrategyId =
    | 'trend-following'
    | 'momentum'
    | 'oversold-pullback'
    | 'breakout'
    | 'mean-reversion';

export interface Criterion {
    label: string;
    passed: boolean;
    /** Short description of the measured value, shown in the UI. */
    detail: string;
}

export interface StrategyResult {
    score: number;
    tier: 'Strong' | 'Moderate' | 'Watch';
    passed: Criterion[];
    failed: Criterion[];
    /** Fraction of criteria met, for transparency in the UI. */
    matched: number;
    total: number;
}

export interface StrategyDef {
    id: StrategyId;
    name: string;
    summary: string;
    evaluate: (bundle: IndicatorBundle) => Criterion[];
}

function pct(value: number | null, digits = 1): string {
    return value === null ? 'n/a' : `${value.toFixed(digits)}%`;
}

function num(value: number | null, digits = 2): string {
    return value === null ? 'n/a' : value.toFixed(digits);
}

function tierFor(score: number): StrategyResult['tier'] {
    if (score >= 80) return 'Strong';
    if (score >= 60) return 'Moderate';
    return 'Watch';
}

export const STRATEGIES: StrategyDef[] = [
    {
        id: 'trend-following',
        name: 'Trend Following',
        summary: 'Established uptrend: the 50-day average has crossed above the 200-day and both are rising.',
        evaluate: (b) => [
            {
                label: '50-day average above 200-day',
                passed: b.sma50 !== null && b.sma200 !== null && b.sma50 > b.sma200,
                detail: b.sma50 !== null && b.sma200 !== null
                    ? `50d ${num(b.sma50)} vs 200d ${num(b.sma200)}`
                    : 'needs 200 bars of history',
            },
            {
                label: 'Price above 200-day average',
                passed: b.sma200 !== null && b.price > b.sma200,
                detail: b.sma200 !== null ? `price ${num(b.price)} vs 200d ${num(b.sma200)}` : 'needs 200 bars of history',
            },
            {
                label: '200-day average rising',
                passed: b.sma200 !== null && b.sma200Prior !== null && b.sma200 > b.sma200Prior,
                detail: b.sma200 !== null && b.sma200Prior !== null
                    ? `${num(b.sma200Prior)} → ${num(b.sma200)} over 20 bars`
                    : 'needs 220 bars of history',
            },
        ],
    },
    {
        id: 'momentum',
        name: 'Momentum',
        summary: 'MACD has turned bullish while RSI sits in the healthy 50-70 band — strength without being stretched.',
        evaluate: (b) => [
            {
                label: 'MACD above signal line',
                passed: Boolean(b.macd && b.macd.macd > b.macd.signal),
                detail: b.macd ? `MACD ${num(b.macd.macd, 3)} vs signal ${num(b.macd.signal, 3)}` : 'needs 35 bars of history',
            },
            {
                label: 'RSI between 50 and 70',
                passed: b.rsi14 !== null && b.rsi14 >= 50 && b.rsi14 <= 70,
                detail: b.rsi14 !== null ? `RSI ${b.rsi14.toFixed(1)}` : 'needs 15 bars of history',
            },
            {
                label: 'Price above 50-day average',
                passed: b.sma50 !== null && b.price > b.sma50,
                detail: b.sma50 !== null ? `price ${num(b.price)} vs 50d ${num(b.sma50)}` : 'needs 50 bars of history',
            },
        ],
    },
    {
        id: 'oversold-pullback',
        name: 'Oversold Pullback',
        summary: 'A short-term dip (RSI ≤ 40) inside a longer-term uptrend — the pullback setup, not a breakdown.',
        evaluate: (b) => [
            {
                label: 'RSI at or below 40',
                passed: b.rsi14 !== null && b.rsi14 <= 40,
                detail: b.rsi14 !== null ? `RSI ${b.rsi14.toFixed(1)}` : 'needs 15 bars of history',
            },
            {
                label: 'Still above the 200-day average',
                passed: b.sma200 !== null && b.price > b.sma200,
                detail: b.sma200 !== null ? `price ${num(b.price)} vs 200d ${num(b.sma200)}` : 'needs 200 bars of history',
            },
            {
                label: 'Within 15% of the 50-day average',
                // Guards against a genuine breakdown being mistaken for a pullback.
                passed: b.sma50 !== null && b.price > b.sma50 * 0.85,
                detail: b.sma50 !== null ? `price ${num(b.price)} vs floor ${num(b.sma50 * 0.85)}` : 'needs 50 bars of history',
            },
        ],
    },
    {
        id: 'breakout',
        name: 'Breakout',
        summary: 'A new 20-day high on above-average volume, with the 50-day average beneath the price.',
        evaluate: (b) => [
            {
                label: 'At a 20-day high',
                passed: b.high20 !== null && b.price >= b.high20 * 0.999,
                detail: b.high20 !== null ? `price ${num(b.price)} vs 20d high ${num(b.high20)}` : 'needs 20 bars of history',
            },
            {
                label: 'Volume above 1.5x the 20-day average',
                passed: b.avgVolume20 !== null && b.avgVolume20 > 0 && b.latestVolume > b.avgVolume20 * 1.5,
                detail: b.avgVolume20 !== null && b.avgVolume20 > 0
                    ? `${(b.latestVolume / b.avgVolume20).toFixed(2)}x average`
                    : 'needs 21 bars of history',
            },
            {
                label: 'Price above 50-day average',
                passed: b.sma50 !== null && b.price > b.sma50,
                detail: b.sma50 !== null ? `price ${num(b.price)} vs 50d ${num(b.sma50)}` : 'needs 50 bars of history',
            },
        ],
    },
    {
        id: 'mean-reversion',
        name: 'Mean Reversion',
        summary: 'Deeply below its long-term average with a weak RSI, but not in free-fall — a stretched-to-the-downside setup.',
        evaluate: (b) => [
            {
                label: 'At least 15% below the 200-day average',
                passed: b.sma200 !== null && b.price <= b.sma200 * 0.85,
                detail: b.sma200 !== null ? `price ${num(b.price)} vs 200d ${num(b.sma200)}` : 'needs 200 bars of history',
            },
            {
                label: 'RSI at or below 35',
                passed: b.rsi14 !== null && b.rsi14 <= 35,
                detail: b.rsi14 !== null ? `RSI ${b.rsi14.toFixed(1)}` : 'needs 15 bars of history',
            },
            {
                label: 'Not down more than 20% in 5 days',
                // Excludes genuine collapses, where mean reversion tends not to apply.
                passed: b.change5d !== null && b.change5d > -20,
                detail: `5-day change ${pct(b.change5d)}`,
            },
        ],
    },
];

const STRATEGY_BY_ID = new Map(STRATEGIES.map((strategy) => [strategy.id, strategy]));

export const DEFAULT_STRATEGY_ID: StrategyId = 'trend-following';

export function isStrategyId(value: string | undefined): value is StrategyId {
    return Boolean(value && STRATEGY_BY_ID.has(value as StrategyId));
}

export function getStrategy(id: string | undefined): StrategyDef {
    if (isStrategyId(id)) return STRATEGY_BY_ID.get(id)!;
    return STRATEGY_BY_ID.get(DEFAULT_STRATEGY_ID)!;
}

/**
 * Run a strategy against one asset's indicators.
 *
 * Score is the percentage of criteria met, so it is directly interpretable ("2 of 3
 * conditions"). Criteria that cannot be evaluated (insufficient history) count as not
 * met, which keeps scores comparable across assets.
 */
export function runStrategy(bundle: IndicatorBundle, strategyId: StrategyId): StrategyResult {
    const strategy = getStrategy(strategyId);
    const criteria = strategy.evaluate(bundle);

    const passed = criteria.filter((criterion) => criterion.passed);
    const failed = criteria.filter((criterion) => !criterion.passed);
    const score = criteria.length === 0 ? 0 : Math.round((passed.length / criteria.length) * 100);

    return {
        score,
        tier: tierFor(score),
        passed,
        failed,
        matched: passed.length,
        total: criteria.length,
    };
}
