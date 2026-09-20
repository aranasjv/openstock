import { describe, it, expect } from 'vitest';
import type { Candle } from '@/lib/indicators';
import {
    evaluateBacktest,
    maxDrawdownPct,
    robustnessScore,
    runBacktest,
    summariseTrades,
    type BacktestTrade,
} from '@/lib/backtest';

function trade(returnPct: number, entryIndex = 0): BacktestTrade {
    return { entryIndex, entryAt: 1_700_000_000_000 + entryIndex * 86_400_000, entryPrice: 100, exitPrice: 100, returnPct };
}

/** Daily bars from a close series; open/high/low track the close and volume is constant. */
function bars(closes: number[]): Candle[] {
    return closes.map((close, index) => ({
        t: 1_600_000_000_000 + index * 86_400_000,
        o: close,
        h: close,
        l: close,
        c: close,
        v: 1_000_000,
    }));
}

function ramp(from: number, to: number, count: number): number[] {
    return Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
}

const STRONG = {
    trades: 250,
    winRatePct: 55,
    avgWinPct: 2,
    avgLossPct: 1.2,
    expectancyPct: 1.2,
    profitFactor: 2.5,
    maxDrawdownPct: 8,
};

describe('summariseTrades', () => {
    it('computes win rate, average win and loss, expectancy and profit factor', () => {
        const metrics = summariseTrades([trade(10), trade(-5), trade(2), trade(-3)]);

        expect(metrics.trades).toBe(4);
        expect(metrics.winRatePct).toBe(50);
        expect(metrics.avgWinPct).toBeCloseTo(6);
        expect(metrics.avgLossPct).toBeCloseTo(4);
        expect(metrics.expectancyPct).toBeCloseTo(1);
        expect(metrics.profitFactor).toBeCloseTo(1.5);
    });

    it('reports no profit factor when there are no losses, rather than infinity', () => {
        // Infinity serialises to null over JSON, where it would read as a perfect strategy.
        expect(summariseTrades([trade(3), trade(4)]).profitFactor).toBeNull();
    });

    it('handles an empty trade list without dividing by zero', () => {
        const metrics = summariseTrades([]);
        expect(metrics.trades).toBe(0);
        expect(metrics.winRatePct).toBe(0);
        expect(metrics.expectancyPct).toBe(0);
        expect(Number.isFinite(metrics.maxDrawdownPct)).toBe(true);
    });
});

describe('maxDrawdownPct', () => {
    it('measures the worst peak-to-trough fall of the compounded equity path', () => {
        // 1.00 → 1.10 → 0.88 → 0.924: the trough is 20% below the 1.10 peak.
        expect(maxDrawdownPct([trade(10), trade(-20), trade(5)])).toBeCloseTo(20);
    });

    it('is zero for a monotonically rising path', () => {
        expect(maxDrawdownPct([trade(5), trade(5)])).toBe(0);
    });
});

describe('robustnessScore', () => {
    it('refuses to score fewer than three variants', () => {
        // One or two parameter sets cannot distinguish an edge from a fit, which is the playbook's
        // whole point about plateaus versus spikes.
        expect(robustnessScore([1, 2]).score).toBe(0);
        expect(robustnessScore([1, 2]).note).toMatch(/not tested/);
    });

    it('scores a fully positive sweep highest', () => {
        expect(robustnessScore([1, 2, 3]).score).toBe(20);
    });

    it('scores a bare-majority sweep lower than a clean one', () => {
        // 2/3 is a majority, which the playbook requires, but not the plateau a clean sweep is.
        expect(robustnessScore([1, 2, -3]).score).toBe(12);
    });

    it('scores a minority-positive sweep at zero and says why', () => {
        const result = robustnessScore([1, -2, -3]);
        expect(result.score).toBe(0);
        expect(result.note).toMatch(/parameter-specific/);
    });
});

describe('evaluateBacktest', () => {
    it('cannot reach DEPLOY without a parameter sweep, however good the metrics', () => {
        const result = evaluateBacktest(STRONG, { spanDays: 365 * 6, slippageModelled: true });

        // Four strong dimensions still total 80/100, but the missing dimension is the one the
        // playbook says separates an edge from a curve fit.
        expect(result.totalScore).toBe(80);
        expect(result.verdict).toBe('REFINE');
        expect(result.redFlags.some((flag) => /robustness not tested/i.test(flag))).toBe(true);
    });

    it('reaches DEPLOY once the sweep holds up', () => {
        const result = evaluateBacktest(STRONG, {
            spanDays: 365 * 6,
            slippageModelled: true,
            variantExpectancies: [1.1, 1.4, 0.9],
        });

        expect(result.verdict).toBe('DEPLOY');
        expect(result.totalScore).toBe(100);
        expect(result.redFlags).toEqual([]);
    });

    it('abandons a negative-expectancy strategy even with a large sample', () => {
        const result = evaluateBacktest(
            { trades: 300, winRatePct: 30, avgWinPct: 1, avgLossPct: 2, expectancyPct: -0.5, profitFactor: 0.4, maxDrawdownPct: 42 },
            { spanDays: 365 * 6, slippageModelled: true, variantExpectancies: [-0.4, -0.6, -0.3] }
        );

        expect(result.verdict).toBe('ABANDON');
        expect(result.redFlags).toContain('negative or zero expectancy');
    });

    it('flags a win rate too good to believe', () => {
        const result = evaluateBacktest(
            { ...STRONG, trades: 60, winRatePct: 97 },
            { spanDays: 365 * 6, slippageModelled: true }
        );

        expect(result.redFlags.some((flag) => /look-ahead bias/.test(flag))).toBe(true);
    });

    it('flags a span shorter than the playbook asks for', () => {
        const result = evaluateBacktest(STRONG, { spanDays: 365 * 2, slippageModelled: true });
        expect(result.redFlags.some((flag) => /five or more/.test(flag))).toBe(true);
    });

    it('flags a sample below the absolute minimum', () => {
        const result = evaluateBacktest({ ...STRONG, trades: 12 }, { spanDays: 365 * 6, slippageModelled: true });
        expect(result.redFlags.some((flag) => /below the 30-trade minimum/.test(flag))).toBe(true);
    });
});

describe('runBacktest', () => {
    it('trades a sustained uptrend and finds positive expectancy', () => {
        const result = runBacktest(bars(ramp(100, 300, 400)), 'trend-following');

        expect(result.metrics.trades).toBeGreaterThan(0);
        expect(result.metrics.expectancyPct).toBeGreaterThan(0);
        // The strategy is trend-following, so in a monotonic rise nothing should lose.
        expect(result.metrics.winRatePct).toBe(100);
    });

    it('does not trade a downtrend, because nothing matches', () => {
        // This is the correct outcome and worth pinning: zero trades is the strategy filtering,
        // not the engine failing.
        const result = runBacktest(bars(ramp(300, 100, 400)), 'trend-following');
        expect(result.metrics.trades).toBe(0);
    });

    it('produces nothing when there is not enough history to evaluate a single bar', () => {
        const result = runBacktest(bars(ramp(100, 120, 100)), 'trend-following');
        expect(result.metrics.trades).toBe(0);
        expect(result.truncated).toBe(false);
    });

    it('charges slippage on both sides, so more friction means less expectancy', () => {
        const series = bars(ramp(100, 300, 400));
        const cheap = runBacktest(series, 'trend-following', { slippagePct: 0 });
        const expensive = runBacktest(series, 'trend-following', { slippagePct: 2 });

        // Same entries either way — friction moves the result, not the decision.
        expect(expensive.metrics.trades).toBe(cheap.metrics.trades);
        expect(expensive.metrics.expectancyPct).toBeLessThan(cheap.metrics.expectancyPct);
    });

    it('flags that it stopped early rather than silently dropping recent candidates', () => {
        const result = runBacktest(bars(ramp(100, 300, 400)), 'trend-following', { horizonDays: 30 });
        expect(result.truncated).toBe(true);
    });
});
