/**
 * Portfolio risk, computed from positions the app already holds.
 *
 * Pure, so it can be tested against fixed return series and cannot quietly reach the network.
 *
 * The one decision that matters here is that portfolio volatility is computed from the **covariance
 * matrix**, not as a weighted average of the positions' own volatilities. A weighted average is
 * easier and it is wrong in the direction that hurts: it assumes every position moves independently,
 * so a book of ten correlated tech names would report roughly a tenth of the concentration it
 * actually carries. Correlation is the whole reason a risk panel is worth looking at, and averaging
 * it away would produce a reassuring number precisely when reassurance is least deserved.
 *
 * Beta is measured against the same benchmark the screener uses for relative strength, so a
 * portfolio and a candidate are judged against one reference rather than two.
 */

/** A position reduced to what risk maths needs: how big it is, and how it has moved. */
export interface RiskPosition {
    symbol: string;
    /** Market value, in the account's currency. */
    value: number;
    /** Aligned daily returns in percent, oldest first. Shorter series are truncated to the shortest. */
    returnsPct: number[];
}

export interface Concentration {
    topSymbol: string | null;
    topWeightPct: number;
    /** Herfindahl index, 0..1. 1 means a single position carries everything. */
    hhi: number;
    /** 1 / HHI — "how many equally-sized positions is this, really". */
    effectivePositions: number;
}

export interface PortfolioRisk {
    totalValue: number;
    positions: number;
    concentration: Concentration;
    /** Annualised portfolio volatility in percent, or null when there is not enough history. */
    volatilityPct: number | null;
    /** Annualised volatility implied by ignoring correlation, for comparison against the real figure. */
    naiveVolatilityPct: number | null;
    beta: number | null;
    /** How many positions had usable history, against how many were held. */
    coverage: { withHistory: number; total: number };
}

export function concentrationOf(positions: RiskPosition[]): Concentration {
    const total = positions.reduce((sum, position) => sum + Math.max(0, position.value), 0);
    if (!(total > 0)) {
        return { topSymbol: null, topWeightPct: 0, hhi: 0, effectivePositions: 0 };
    }

    const weights = positions.map((position) => Math.max(0, position.value) / total);
    const hhi = weights.reduce((sum, weight) => sum + weight * weight, 0);
    const largest = positions.reduce(
        (best, position) => (position.value > best.value ? position : best),
        positions[0]
    );

    return {
        topSymbol: largest?.symbol ?? null,
        topWeightPct: total > 0 ? (Math.max(0, largest?.value ?? 0) / total) * 100 : 0,
        hhi,
        effectivePositions: hhi > 0 ? 1 / hhi : 0,
    };
}

function mean(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function variance(values: number[]): number | null {
    if (values.length < 2) return null;
    const average = mean(values);
    return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
}

export function covariance(a: number[], b: number[]): number | null {
    if (a.length !== b.length || a.length < 2) return null;
    const meanA = mean(a);
    const meanB = mean(b);
    return a.reduce((sum, value, index) => sum + (value - meanA) * (b[index] - meanB), 0) / (a.length - 1);
}

/** Daily percentage returns are annualised on a 252-session year. */
export function annualise(dailyStdev: number): number {
    return dailyStdev * Math.sqrt(252) * 100;
}

/**
 * Positions sharing a common window.
 *
 * Truncated to the shortest series from the **end**, so every series covers the same sessions. The
 * alternative — padding shorter ones with zeros — would invent flat days for an asset and drag its
 * measured covariance toward zero, which reads as diversification that is not there.
 */
function alignedWindow(positions: RiskPosition[]): { weights: number[]; series: number[]; length: number } | null {
    const usable = positions.filter((position) => position.returnsPct.length >= 2 && position.value > 0);
    if (usable.length === 0) return null;

    const length = Math.min(...usable.map((position) => position.returnsPct.length));
    if (length < 2) return null;

    const total = usable.reduce((sum, position) => sum + position.value, 0);
    return {
        weights: usable.map((position) => position.value / total),
        series: usable.flatMap((position) => position.returnsPct.slice(-length)),
        length,
    };
}

function sliceAt(buffer: number[], index: number, length: number): number[] {
    return buffer.slice(index * length, (index + 1) * length);
}

/**
 * Portfolio volatility from the covariance matrix: sqrt(wᵀ Σ w).
 *
 * Returned alongside the correlation-free figure so the difference is visible. When the two agree
 * the book is genuinely diversified; when covariance is higher, the naive number is the one that
 * would have been misleading.
 */
export function portfolioVolatility(positions: RiskPosition[]): { actualPct: number | null; naivePct: number | null } {
    const window = alignedWindow(positions);
    if (!window) return { actualPct: null, naivePct: null };

    // Iterate the positions, not the flattened buffer: mapping the buffer would produce one slice per
    // session rather than per position and read weights past the end.
    const series = window.weights.map((_, index) => sliceAt(window.series, index, window.length));

    let varianceSum = 0;
    for (let i = 0; i < series.length; i++) {
        for (let j = 0; j < series.length; j++) {
            const cell = covariance(series[i], series[j]);
            if (cell === null) return { actualPct: null, naivePct: null };
            varianceSum += window.weights[i] * window.weights[j] * cell;
        }
    }

    if (!(varianceSum >= 0)) return { actualPct: null, naivePct: null };

    const naiveDaily = series.reduce((sum, values, index) => {
        const positionVariance = variance(values);
        return positionVariance === null ? sum : sum + window.weights[index] * Math.sqrt(positionVariance);
    }, 0);

    return { actualPct: annualise(Math.sqrt(varianceSum)), naivePct: annualise(naiveDaily) };
}

/**
 * Portfolio return series implied by the weights, over the shared window.
 *
 * Needed for beta, which is a property of the portfolio as a whole rather than of any one position.
 */
export function portfolioReturns(positions: RiskPosition[]): number[] | null {
    const window = alignedWindow(positions);
    if (!window) return null;

    const series = window.weights.map((_, index) => sliceAt(window.series, index, window.length));
    const returns: number[] = new Array(window.length).fill(0);

    for (let i = 0; i < series.length; i++) {
        for (let day = 0; day < window.length; day++) {
            returns[day] += window.weights[i] * series[i][day];
        }
    }

    return returns;
}

export function beta(returnsPct: number[], benchmarkReturnsPct: number[]): number | null {
    if (returnsPct.length !== benchmarkReturnsPct.length) return null;

    const marketVariance = variance(benchmarkReturnsPct);
    if (marketVariance === null || marketVariance === 0) return null;

    const cell = covariance(returnsPct, benchmarkReturnsPct);
    if (cell === null) return null;

    return cell / marketVariance;
}

export function summarisePortfolioRisk(positions: RiskPosition[], benchmarkReturnsPct: number[] | null): PortfolioRisk {
    const totalValue = positions.reduce((sum, position) => sum + Math.max(0, position.value), 0);
    const { actualPct, naivePct } = portfolioVolatility(positions);

    const returns = portfolioReturns(positions);
    const betaValue =
        returns && benchmarkReturnsPct
            ? beta(returns, benchmarkReturnsPct.slice(-returns.length))
            : null;

    const withHistory = positions.filter((position) => position.returnsPct.length >= 2).length;

    return {
        totalValue,
        positions: positions.length,
        concentration: concentrationOf(positions),
        volatilityPct: actualPct,
        naiveVolatilityPct: naivePct,
        beta: betaValue,
        coverage: { withHistory, total: positions.length },
    };
}
