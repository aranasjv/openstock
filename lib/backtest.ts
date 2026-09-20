import { computeIndicators, type Candle } from '@/lib/indicators';
import { runStrategy, type StrategyId } from '@/lib/strategies';

/**
 * Strategy backtesting — the evaluation shape from `.agents/skills/backtest-expert`.
 *
 * Replays the *actual* screener strategies (`runStrategy` over `computeIndicators`) rather than a
 * reimplementation, because a backtest of a copy measures the copy. The playbook's central demand is
 * to "test all cases, not cherry-picked examples", and that falls out of the design: every eligible
 * bar is evaluated and every qualifying one becomes a trade, so there is no selection step in which
 * to introduce survivorship bias.
 *
 * The honesty guard that matters most is the robustness dimension. The playbook spends 80% of its
 * time stress testing and treats a single parameter set as insufficient evidence — so a run without
 * a parameter sweep **cannot** reach a DEPLOY verdict, however good its metrics look. Reporting
 * "deploy" from one pass is precisely the overconfidence the playbook warns about, and it is the
 * failure mode a backtester invites.
 */

/** The longest lookback any strategy needs (SMA200 plus its 20-bar slope). */
const MIN_LOOKBACK = 240;

export interface BacktestTrade {
    entryIndex: number;
    /** Epoch ms of the bar the entry was taken on. */
    entryAt: number;
    entryPrice: number;
    exitPrice: number;
    /** Net of slippage, in percent. */
    returnPct: number;
}

export interface BacktestMetrics {
    trades: number;
    winRatePct: number;
    avgWinPct: number;
    avgLossPct: number;
    /** Mean return per trade, in percent. The single number that decides whether an edge exists. */
    expectancyPct: number;
    /** Gross wins ÷ gross losses. Null when there are no losses, which is not the same as infinite. */
    profitFactor: number | null;
    maxDrawdownPct: number;
}

export interface BacktestOptions {
    /** Bars held after entry. */
    horizonDays?: number;
    /** Bars between candidate entries. A stride above 1 samples rather than exhaustively tests. */
    stepDays?: number;
    /** Per-side friction, in percent. The playbook asks for 1.5-2× a typical estimate. */
    slippagePct?: number;
    /** How many of the strategy's criteria must pass for an entry. */
    minMatched?: number;
}

export interface BacktestDimension {
    name: string;
    score: number;
    max: number;
    note: string;
}

export interface BacktestResult {
    strategyId: string;
    /** Bars evaluated. */
    bars: number;
    /** Calendar span covered, in days. */
    spanDays: number;
    horizonDays: number;
    slippagePct: number;
    metrics: BacktestMetrics;
    dimensions: BacktestDimension[];
    totalScore: number;
    verdict: 'DEPLOY' | 'REFINE' | 'ABANDON';
    redFlags: string[];
    /** True when the horizon ran past the end of the data for the final candidates. */
    truncated: boolean;
}

/** Compounding equity path over the trades, reporting the worst peak-to-trough fall. */
export function maxDrawdownPct(trades: BacktestTrade[]): number {
    let equity = 1;
    let peak = 1;
    let worst = 0;

    for (const trade of trades) {
        equity *= 1 + trade.returnPct / 100;
        peak = Math.max(peak, equity);
        worst = Math.min(worst, (equity / peak - 1) * 100);
    }

    return Math.abs(worst);
}

export function summariseTrades(trades: BacktestTrade[]): BacktestMetrics {
    const wins = trades.filter((trade) => trade.returnPct > 0);
    const losses = trades.filter((trade) => trade.returnPct <= 0);
    const sum = (list: BacktestTrade[]) => list.reduce((total, trade) => total + trade.returnPct, 0);

    const grossWin = sum(wins);
    const grossLoss = Math.abs(sum(losses));

    return {
        trades: trades.length,
        winRatePct: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
        avgWinPct: wins.length > 0 ? grossWin / wins.length : 0,
        avgLossPct: losses.length > 0 ? grossLoss / losses.length : 0,
        expectancyPct: trades.length > 0 ? (grossWin - grossLoss) / trades.length : 0,
        // A run with no losing trades has no ratio, not an infinite one — reporting Infinity would
        // serialise to null anyway and quietly read as a perfect strategy.
        profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
        maxDrawdownPct: maxDrawdownPct(trades),
    };
}

/** Scores a parameter sweep. This is the dimension the playbook says separates an edge from a fit. */
export function robustnessScore(variantExpectancies: number[]): { score: number; note: string } {
    if (variantExpectancies.length < 3) {
        return { score: 0, note: 'not tested — fewer than three parameter variants' };
    }

    const positive = variantExpectancies.filter((value) => value > 0).length;
    const share = positive / variantExpectancies.length;

    if (share === 1) return { score: 20, note: `all ${variantExpectancies.length} variants positive` };

    // The playbook's requirement is a hard one: "positive expectancy in the majority of years".
    // A minority of variants working is the parameter-sensitivity failure, not a partial pass, so it
    // scores zero and raises a red flag rather than sitting on a comfortable middle score.
    if (share > 0.5) {
        return { score: 12, note: `${positive}/${variantExpectancies.length} variants positive` };
    }

    return { score: 0, note: `${positive}/${variantExpectancies.length} positive — the edge is parameter-specific` };
}

export function evaluateBacktest(
    metrics: BacktestMetrics,
    context: { spanDays: number; slippageModelled: boolean; variantExpectancies?: number[] }
): {
    dimensions: BacktestDimension[];
    totalScore: number;
    verdict: BacktestResult['verdict'];
    redFlags: string[];
} {
    const sampleSize: BacktestDimension = {
        name: 'Sample size',
        max: 20,
        score: metrics.trades >= 200 ? 20 : metrics.trades >= 100 ? 15 : metrics.trades >= 30 ? 8 : 0,
        note: `${metrics.trades} trades (30 minimum, 100 preferred, 200 high confidence)`,
    };

    const expectancy: BacktestDimension = {
        name: 'Expectancy',
        max: 20,
        score:
            metrics.expectancyPct >= 1
                ? 20
                : metrics.expectancyPct >= 0.5
                  ? 15
                  : metrics.expectancyPct >= 0.2
                    ? 10
                    : metrics.expectancyPct > 0
                      ? 5
                      : 0,
        note: `${metrics.expectancyPct.toFixed(2)}% per trade`,
    };

    const risk: BacktestDimension = {
        name: 'Risk management',
        max: 20,
        score:
            metrics.maxDrawdownPct <= 10
                ? 20
                : metrics.maxDrawdownPct <= 20
                  ? 14
                  : metrics.maxDrawdownPct <= 30
                    ? 8
                    : 0,
        note: `${metrics.maxDrawdownPct.toFixed(1)}% max drawdown`,
    };

    const robustness = robustnessScore(context.variantExpectancies ?? []);

    const execution: BacktestDimension = {
        name: 'Execution realism',
        max: 20,
        score: context.slippageModelled ? 20 : 0,
        note: context.slippageModelled ? 'slippage applied on entry and exit' : 'no friction modelled',
    };

    const dimensions = [sampleSize, expectancy, risk, { name: 'Robustness', max: 20, ...robustness }, execution];
    const totalScore = dimensions.reduce((total, dimension) => total + dimension.score, 0);

    const redFlags: string[] = [];
    if (metrics.trades < 30) redFlags.push(`only ${metrics.trades} trades — below the 30-trade minimum`);
    if (metrics.expectancyPct <= 0) redFlags.push('negative or zero expectancy');
    if (metrics.winRatePct > 90 && metrics.trades >= 10) {
        redFlags.push(`${metrics.winRatePct.toFixed(0)}% win rate — audit for look-ahead bias before believing it`);
    }
    if (metrics.maxDrawdownPct > 25) redFlags.push(`${metrics.maxDrawdownPct.toFixed(1)}% drawdown is beyond most risk limits`);
    if (context.spanDays < 365 * 5) {
        redFlags.push(`tested over ${(context.spanDays / 365).toFixed(1)} years — the playbook asks for five or more`);
    }
    if (robustness.score === 0) redFlags.push(`robustness ${robustness.note}`);

    // The cap is the point: one parameter set cannot justify deployment, whatever the metrics say.
    let verdict: BacktestResult['verdict'];
    if (totalScore >= 75 && robustness.score > 0) verdict = 'DEPLOY';
    else if (totalScore >= 45) verdict = 'REFINE';
    else verdict = 'ABANDON';

    if (robustness.score === 0 && verdict === 'DEPLOY') verdict = 'REFINE';

    return { dimensions, totalScore, verdict, redFlags };
}

export function runBacktest(bars: Candle[], strategyId: StrategyId, options: BacktestOptions = {}): BacktestResult {
    const horizonDays = options.horizonDays ?? 20;
    const stepDays = options.stepDays ?? 1;
    const slippagePct = options.slippagePct ?? 0.1;
    const minMatched = options.minMatched ?? 3;

    const trades: BacktestTrade[] = [];
    let truncated = false;

    for (let index = MIN_LOOKBACK; index < bars.length - 1; index += stepDays) {
        if (index + horizonDays >= bars.length) {
            // Running the horizon past the end would silently drop the newest candidates — which are
            // also the ones a user cares about most. Reported instead.
            truncated = true;
            break;
        }

        const window = bars.slice(0, index + 1);
        const bundle = computeIndicators(window);
        if (!bundle) continue;

        const result = runStrategy(bundle, strategyId);
        if (result.matched < minMatched) continue;

        const entry = bars[index].c;
        const exit = bars[index + horizonDays].c;
        if (!(entry > 0) || !(exit > 0)) continue;

        // Both sides pay: bought above the close, sold below it. One-sided friction flatters a
        // strategy in exactly the direction that makes it look deployable.
        const effectiveEntry = entry * (1 + slippagePct / 100);
        const effectiveExit = exit * (1 - slippagePct / 100);

        trades.push({
            entryIndex: index,
            entryAt: bars[index].t,
            entryPrice: entry,
            exitPrice: exit,
            returnPct: ((effectiveExit - effectiveEntry) / effectiveEntry) * 100,
        });
    }

    const metrics = summariseTrades(trades);
    const spanDays = bars.length > 1 ? Math.round((bars[bars.length - 1].t - bars[0].t) / 86_400_000) : 0;

    const evaluation = evaluateBacktest(metrics, {
        spanDays,
        slippageModelled: slippagePct > 0,
    });

    return {
        strategyId,
        bars: bars.length,
        spanDays,
        horizonDays,
        slippagePct,
        metrics,
        ...evaluation,
        truncated,
    };
}
