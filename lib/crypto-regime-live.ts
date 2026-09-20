import 'server-only';

import { getCryptoMarkets, getCryptoPriceHistory } from '@/lib/actions/crypto.actions';
import { getFundingRates } from '@/lib/binance';
import { getDominanceHistory, recordDominanceObservation } from '@/lib/data/dominance';
import { mapWithConcurrency } from '@/lib/concurrency';
import { scoreCryptoRegime, type CoinSeries, type RegimeResult } from '@/lib/crypto-regime';
import type { Candle } from '@/lib/indicators';

/**
 * The crypto regime, scored from live data.
 *
 * `lib/crypto-regime.ts` is pure and takes series; this is the part that goes and fetches them.
 * Keeping the two apart is what lets the model be tested against fixed snapshots while this side is
 * allowed to fail partially: every input degrades on its own, and the composite decides whether
 * enough of the model survived to say anything at all.
 *
 * Deliberately **not** a `'use server'` module, for the reason given in `lib/binance.ts`. One
 * invocation is around twenty CoinGecko history calls and it is reached from a server component and
 * a tool — never from a browser, so there is nothing to gain by exposing it and a quota to lose.
 */

/** Coins considered for breadth and momentum, excluding BTC. */
const REGIME_UNIVERSE = 20;

/**
 * BTC needs a year for the drawdown and trend components. The alts need only 200 days for breadth,
 * and asking for 200 deliberately reuses the screener's 6-hour history cache instead of paying for
 * a second, year-long fetch per coin.
 */
const BTC_HISTORY_DAYS = 365;

/** In-flight CoinGecko history calls. The shared gate paces them anyway; this bounds the queue. */
const HISTORY_CONCURRENCY = 3;

/** The methodology's floor: one exchange's funding is not a market-wide leverage reading. */
const MIN_FUNDING_SYMBOLS = 2;

export interface CryptoRegimeReport extends RegimeResult {
    asOf: string;
    /** Daily dominance observations on record — the deterministic half of "is this reliable". */
    dominanceObservations: number;
    /** Coins that contributed a usable series, BTC included. */
    universeSize: number;
    /** Symbols that actually answered Binance. */
    fundingSample: number;
}

function closesOf(candles: Candle[] | null): number[] {
    if (!candles) return [];
    return candles
        .map((candle) => candle.c)
        .filter((value) => Number.isFinite(value) && value > 0);
}

export async function getCryptoRegime(): Promise<CryptoRegimeReport> {
    // Recording first, but best-effort. The history can only grow one day at a time, so a read path
    // that never recorded would leave the dominance component permanently unavailable — worse than a
    // component that is merely missing. A failure to *record*, though, must not fail the read: the
    // component is unavailable either way, and taking down the panel over a bookkeeping write would
    // be the worse trade of the two.
    try {
        await recordDominanceObservation();
    } catch (error) {
        console.warn('Regime: could not record the dominance observation:', error);
    }

    const [dominance, markets] = await Promise.all([
        getDominanceHistory(),
        getCryptoMarkets(REGIME_UNIVERSE),
    ]);

    // BTC history and funding are independent of each other and of the calls above.
    const [btcCloses, funding] = await Promise.all([
        getCryptoPriceHistory('bitcoin', BTC_HISTORY_DAYS).then(closesOf),
        getFundingRates(),
    ]);

    const altMarkets = markets.filter((market) => market.id !== 'bitcoin');
    const altSeries: CoinSeries[] = (
        await mapWithConcurrency(altMarkets, HISTORY_CONCURRENCY, async (market) => ({
            symbol: market.symbol.toUpperCase(),
            closes: closesOf(await getCryptoPriceHistory(market.id)),
        }))
    ).filter((series) => series.closes.length > 0);

    const result = scoreCryptoRegime({
        btcCloses,
        alts: altSeries,
        dominanceSeries: dominance.points.map((point) => point.btcDominance),
        fundingAverage:
            funding && funding.sampleSize >= MIN_FUNDING_SYMBOLS ? funding.averageRate : null,
        // BTC is in the momentum universe by definition. A crypto momentum read that excluded the
        // largest asset would be measuring a different market than the one being asked about.
        momentumUniverse: [{ symbol: 'BTC', closes: btcCloses }, ...altSeries],
    });

    return {
        ...result,
        asOf: new Date().toISOString(),
        dominanceObservations: dominance.points.length,
        universeSize: altSeries.length + (btcCloses.length > 0 ? 1 : 0),
        fundingSample: funding?.sampleSize ?? 0,
    };
}
