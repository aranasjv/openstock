import { describe, it, expect } from 'vitest';
import {
    beta,
    concentrationOf,
    covariance,
    portfolioReturns,
    portfolioVolatility,
    summarisePortfolioRisk,
    variance,
    type RiskPosition,
} from '@/lib/portfolio-risk';

const position = (symbol: string, value: number, returnsPct: number[]): RiskPosition => ({
    symbol,
    value,
    returnsPct,
});

describe('concentrationOf', () => {
    it('reports a single holding as fully concentrated', () => {
        const result = concentrationOf([position('AAPL', 1000, [1, 2, 3])]);

        expect(result.topSymbol).toBe('AAPL');
        expect(result.topWeightPct).toBe(100);
        expect(result.hhi).toBeCloseTo(1, 6);
        expect(result.effectivePositions).toBeCloseTo(1, 6);
    });

    it('reports four equal holdings as four effective positions', () => {
        const result = concentrationOf([
            position('A', 250, [1, 2, 3]),
            position('B', 250, [1, 2, 3]),
            position('C', 250, [1, 2, 3]),
            position('D', 250, [1, 2, 3]),
        ]);

        expect(result.topWeightPct).toBeCloseTo(25, 6);
        expect(result.hhi).toBeCloseTo(0.25, 6);
        expect(result.effectivePositions).toBeCloseTo(4, 6);
    });

    it('counts effective positions below the holding count when weights are lopsided', () => {
        // 90/10 is really about one position, which 1/HHI reports as ~1.2 rather than 2.
        const result = concentrationOf([position('BIG', 900, [1, 2, 3]), position('SMALL', 100, [1, 2, 3])]);

        expect(result.topSymbol).toBe('BIG');
        expect(result.effectivePositions).toBeLessThan(2);
        expect(result.effectivePositions).toBeGreaterThan(1);
    });

    it('returns a zero shape rather than NaN for an empty or worthless book', () => {
        expect(concentrationOf([]).hhi).toBe(0);
        expect(concentrationOf([position('X', 0, [1, 2, 3])]).hhi).toBe(0);
    });
});

describe('variance and covariance', () => {
    it('needs at least two observations', () => {
        expect(variance([1])).toBeNull();
        expect(covariance([1], [2])).toBeNull();
    });

    it('is zero for a constant series', () => {
        expect(variance([5, 5, 5, 5])).toBe(0);
    });

    it('rejects series of different lengths rather than aligning them silently', () => {
        expect(covariance([1, 2, 3], [1, 2])).toBeNull();
    });
});

describe('portfolioVolatility', () => {
    it('shows no diversification benefit for perfectly correlated positions', () => {
        // B is exactly twice A, so the blend is a scaled copy of A and carries its full risk.
        const positions = [position('A', 500, [1, 2, 3, 4]), position('B', 500, [2, 4, 6, 8])];
        const { actualPct, naivePct } = portfolioVolatility(positions);

        expect(actualPct).not.toBeNull();
        expect(actualPct!).toBeCloseTo(naivePct!, 6);
    });

    it('shows a real benefit for oppositely-moving positions', () => {
        // Perfectly anti-correlated, equally weighted: the moves cancel and the book is flat.
        const positions = [position('A', 500, [1, 2, 3, 4]), position('B', 500, [4, 3, 2, 1])];
        const { actualPct, naivePct } = portfolioVolatility(positions);

        expect(actualPct).toBeCloseTo(0, 6);
        // The correlation-free figure would have reported the positions' risk as if it still existed.
        expect(naivePct!).toBeGreaterThan(actualPct!);
    });

    it('truncates to the shortest series from the end, not the start', () => {
        // A's last four sessions are 1,2,3,4 — from the start they would be 0,0,1,2, which would
        // shift the blend and quietly compare different dates across positions.
        const returns = portfolioReturns([
            position('A', 500, [0, 0, 1, 2, 3, 4]),
            position('B', 500, [3, 3, 3, 3]),
        ]);

        expect(returns).toEqual([2, 2.5, 3, 3.5]);
    });

    it('returns nulls rather than a number when no position has usable history', () => {
        const { actualPct, naivePct } = portfolioVolatility([position('A', 500, [1]), position('B', 500, [])]);

        expect(actualPct).toBeNull();
        expect(naivePct).toBeNull();
    });
});

describe('beta', () => {
    it('is 2 when the portfolio moves twice the benchmark', () => {
        expect(beta([2, 4, 6, 8], [1, 2, 3, 4])).toBeCloseTo(2, 6);
    });

    it('is 1 for an identical series', () => {
        expect(beta([1, -2, 3, -4], [1, -2, 3, -4])).toBeCloseTo(1, 6);
    });

    it('is negative when the portfolio moves against the benchmark', () => {
        expect(beta([-1, 2, -3, 4], [1, -2, 3, -4])).toBeCloseTo(-1, 6);
    });

    it('is null rather than infinite when the benchmark never moves', () => {
        expect(beta([1, 2, 3, 4], [0, 0, 0, 0])).toBeNull();
    });

    it('is null when the windows do not match', () => {
        expect(beta([1, 2, 3], [1, 2])).toBeNull();
    });
});

describe('summarisePortfolioRisk', () => {
    it('reports coverage so a partial figure cannot pass as a complete one', () => {
        const result = summarisePortfolioRisk(
            [position('A', 500, [1, 2, 3, 4]), position('B', 500, [])],
            [1, 2, 3, 4]
        );

        expect(result.positions).toBe(2);
        expect(result.coverage).toEqual({ withHistory: 1, total: 2 });
    });

    it('computes beta from the portfolio series, not from any single position', () => {
        // A is twice the benchmark; B is flat. Weighted equally the book should run at about 1.
        const result = summarisePortfolioRisk(
            [position('A', 500, [2, 4, 6, 8]), position('B', 500, [0, 0, 0, 0])],
            [1, 2, 3, 4]
        );

        expect(result.beta).toBeCloseTo(1, 6);
    });

    it('omits beta without a benchmark rather than inventing one', () => {
        const result = summarisePortfolioRisk([position('A', 500, [1, 2, 3, 4])], null);

        expect(result.beta).toBeNull();
        expect(result.volatilityPct).not.toBeNull();
    });

    it('totals only positive values, so a short position cannot inflate the book', () => {
        const result = summarisePortfolioRisk(
            [position('LONG', 1000, [1, 2, 3]), position('SHORT', -400, [1, 2, 3])],
            null
        );

        expect(result.totalValue).toBe(1000);
    });
});
