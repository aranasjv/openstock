import 'server-only';

import { getCryptoPriceHistory } from '@/lib/actions/crypto.actions';
import { getStockPriceHistory } from '@/lib/actions/screener.actions';
import { getPortfolioSummaryForUser } from '@/lib/data/portfolio';
import { mapWithConcurrency } from '@/lib/concurrency';
import { summarisePortfolioRisk, type PortfolioRisk, type RiskPosition } from '@/lib/portfolio-risk';

/**
 * Portfolio risk from live positions.
 *
 * Server-only and deliberately **not** a `'use server'` module: its caller is a server component, and
 * as an action it would fan out to one history request per holding on demand.
 *
 * Three things are surfaced rather than smoothed over:
 * - a holding with no price cannot contribute a value or a return, so it is excluded and named;
 *   silently treating it as zero would understate concentration by shrinking the denominator;
 * - the benchmark is chosen by which asset class dominates the book by value, and reported, because
 *   beta against the wrong market is a number that looks meaningful and is not. A mixed book has no
 *   single right answer, so the choice is stated instead of hidden;
 * - crypto holdings store the CoinGecko id as their symbol, which is exactly what the history
 *   endpoint takes.
 */

const MAX_RISK_POSITIONS = 40;
const HISTORY_CONCURRENCY = 4;

/** Daily returns in percent, oldest first. */
function returnsFromCloses(closes: number[]): number[] {
    const returns: number[] = [];
    for (let index = 1; index < closes.length; index++) {
        const previous = closes[index - 1];
        if (previous > 0) returns.push((closes[index] / previous - 1) * 100);
    }
    return returns;
}

function closesOf(candles: { c: number }[] | null): number[] {
    if (!candles) return [];
    return candles.map((candle) => candle.c).filter((value) => Number.isFinite(value) && value > 0);
}

export interface PortfolioRiskReport extends PortfolioRisk {
    /** Holdings left out because no price or no history could be resolved. */
    excluded: string[];
    /** Which market beta is measured against, and why. */
    benchmark: { symbol: string; reason: string } | null;
    /** Positions that resolved a price but not enough history for risk maths. */
    withoutHistory: string[];
    asOf: string;
}

export async function portfolioRiskForUser(userId: string): Promise<PortfolioRiskReport> {
    const summary = await getPortfolioSummaryForUser(userId);
    const holdings = summary.holdings.slice(0, MAX_RISK_POSITIONS);

    const priced = holdings.filter((holding) => typeof holding.marketValue === 'number' && holding.marketValue > 0);
    const excluded = holdings
        .filter((holding) => !(typeof holding.marketValue === 'number' && holding.marketValue > 0))
        .map((holding) => holding.symbol);

    const resolved = await mapWithConcurrency(priced, HISTORY_CONCURRENCY, async (holding) => {
        const candles =
            holding.assetType === 'crypto'
                ? await getCryptoPriceHistory(holding.symbol.toLowerCase())
                : await getStockPriceHistory(holding.symbol.toUpperCase());

        const closes = closesOf(candles);
        if (closes.length < 2) return null;

        const position: RiskPosition = {
            symbol: holding.symbol,
            value: holding.marketValue ?? 0,
            returnsPct: returnsFromCloses(closes),
        };
        return { position, assetType: holding.assetType };
    });

    const withHistory = resolved.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const withoutHistory = priced
        .filter((holding) => !withHistory.some((entry) => entry.position.symbol === holding.symbol))
        .map((holding) => holding.symbol);

    const cryptoValue = withHistory
        .filter((entry) => entry.assetType === 'crypto')
        .reduce((sum, entry) => sum + entry.position.value, 0);
    const stockValue = withHistory
        .filter((entry) => entry.assetType === 'stock')
        .reduce((sum, entry) => sum + entry.position.value, 0);

    const cryptoDominant = cryptoValue > stockValue;
    const benchmarkSymbol = cryptoDominant ? 'BTC' : 'SPY';

    // The benchmark is the same series relative strength uses, so a portfolio and a candidate are
    // judged against one reference rather than two.
    const benchmarkCandles = cryptoDominant
        ? await getCryptoPriceHistory('bitcoin', 365)
        : await getStockPriceHistory('SPY', '2y');
    const benchmarkCloses = closesOf(benchmarkCandles);
    const benchmarkReturns = benchmarkCloses.length >= 2 ? returnsFromCloses(benchmarkCloses) : null;

    const risk = summarisePortfolioRisk(
        withHistory.map((entry) => entry.position),
        benchmarkReturns
    );

    return {
        ...risk,
        excluded,
        withoutHistory,
        benchmark:
            benchmarkReturns === null
                ? null
                : {
                      symbol: benchmarkSymbol,
                      reason: cryptoDominant
                          ? `crypto is ${((cryptoValue / (cryptoValue + stockValue || 1)) * 100).toFixed(0)}% of the book by value`
                          : `stocks are ${((stockValue / (cryptoValue + stockValue || 1)) * 100).toFixed(0)}% of the book by value`,
                  },
        asOf: new Date().toISOString(),
    };
}
