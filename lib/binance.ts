import 'server-only';

import { fetchWithTimeout } from '@/lib/http';
import { mapWithConcurrency } from '@/lib/concurrency';

/**
 * Binance public futures funding rates.
 *
 * Funding is the clearest free read on how crowded leveraged longs are: sustained positive
 * funding means longs are paying to keep the position open, which is what a top looks like.
 * Negative funding is what capitulation looks like. The `crypto-regime-analyzer` playbook uses it
 * as a contrarian component, meaningful at the extremes and noise in the middle.
 *
 * Keyless, but **geo-blocked in some regions**, so failure is expected rather than exceptional:
 * this returns null and the caller skips the component, rather than taking down the whole regime
 * read over one endpoint. That resilience is the reason it is not a plain fetch.
 *
 * Deliberately **not** a `'use server'` module. Its only callers are server-side, so marking it an
 * action would expose it to the browser for no benefit — and one invocation is five upstream calls,
 * which is a quota to spend at someone else's expense.
 */

const BINANCE_FAPI = 'https://fapi.binance.com';

/** Majors with liquid perpetuals. An average over these is a proxy for the whole complex. */
const MAJORS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

/** Funding is an 8-hourly rate; three decimal places is more precision than the signal has. */
const RATE_PRECISION = 1e-6;

export interface FundingSnapshot {
    /** Simple mean of the symbols that responded, per 8 hours. */
    averageRate: number;
    /** How many majors answered — the mean over two symbols is a much weaker signal than five. */
    sampleSize: number;
    perSymbol: { symbol: string; rate: number }[];
}

interface PremiumIndex {
    symbol?: string;
    lastFundingRate?: string;
}

export async function getFundingRates(symbols: readonly string[] = MAJORS): Promise<FundingSnapshot | null> {
    try {
        const results = await mapWithConcurrency([...symbols], 3, async (symbol) => {
            try {
                const response = await fetchWithTimeout(
                    `${BINANCE_FAPI}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`,
                    { cache: 'no-store' }
                );
                if (!response.ok) return null;

                const data = (await response.json()) as PremiumIndex;
                const rate = Number.parseFloat(data.lastFundingRate ?? '');

                return Number.isFinite(rate) ? { symbol, rate } : null;
            } catch {
                // One symbol being geo-blocked or missing must not discard the others; the
                // sample size in the result records the cost of any that dropped out.
                return null;
            }
        });

        const perSymbol = results.filter((entry): entry is { symbol: string; rate: number } => entry !== null);
        if (perSymbol.length === 0) return null;

        const averageRate =
            perSymbol.reduce((sum, entry) => sum + entry.rate, 0) / perSymbol.length;

        return {
            averageRate: Math.round(averageRate / RATE_PRECISION) * RATE_PRECISION,
            sampleSize: perSymbol.length,
            perSymbol,
        };
    } catch (error) {
        console.warn('Binance funding unavailable:', error instanceof Error ? error.message : error);
        return null;
    }
}
