import 'server-only';

import { cryptoTradingViewCandidates } from '@/lib/utils';

/**
 * Verified TradingView symbol resolution.
 *
 * TradingView exposes a lightweight scanner endpoint that answers "does this symbol exist?":
 *
 *   https://scanner.tradingview.com/symbol?symbol=BINANCE%3ATAOUSDT&fields=close
 *     200 {"close":269.3,"description":"TAO / TetherUS"}
 *     404 {"code":"symbol_not_exists"}
 *
 * That turns symbol mapping from guesswork into a check. A guessed convention can only ever
 * be right for the exchanges it happens to match — the previous Binance-only rule produced
 * an "Invalid Symbol" chart for any coin Binance does not list.
 *
 * Resolution walks the candidate venues in order and keeps the first that exists. Results are
 * cached for a day, so the cost is one probe per candidate per coin per day, not per page view.
 */

const SCANNER_ENDPOINT = 'https://scanner.tradingview.com/symbol';
const PROBE_TIMEOUT_MS = 6000;
/** TradingView listings change rarely; a day of caching is plenty. */
const RESOLUTION_TTL_SECONDS = 86_400;

/** Confirm a single symbol exists on TradingView. */
export async function verifyTradingViewSymbol(symbol: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    try {
        const res = await fetch(
            `${SCANNER_ENDPOINT}?symbol=${encodeURIComponent(symbol)}&fields=close`,
            {
                headers: {
                    // The endpoint rejects requests without a browser-like agent.
                    'user-agent': 'Mozilla/5.0 (compatible; OpenStock/1.0)',
                    accept: 'application/json',
                },
                next: { revalidate: RESOLUTION_TTL_SECONDS },
                signal: controller.signal,
            }
        );

        return res.ok;
    } catch (error) {
        console.error(`TradingView probe failed for ${symbol}:`, error);
        // Treat a probe failure as "unknown", not "invalid": a transient network problem
        // should not hide a chart that would otherwise work.
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Resolve one ticker to a symbol that actually exists, or null when none of the candidate
 * venues list it (in which case the caller should hide the chart).
 */
export async function resolveCryptoTradingViewSymbol(ticker: string): Promise<string | null> {
    const candidates = cryptoTradingViewCandidates(ticker);
    if (candidates.length === 0) return null;

    for (const candidate of candidates) {
        if (await verifyTradingViewSymbol(candidate)) return candidate;
    }

    return null;
}

/** Resolve many tickers, probing sequentially within a ticker but in parallel across them. */
export async function resolveCryptoTradingViewSymbols(
    tickers: string[]
): Promise<Record<string, string | null>> {
    const unique = [...new Set(tickers.filter(Boolean).map((t) => t.trim().toUpperCase()))];

    const resolved = await Promise.all(
        unique.map(async (ticker) => [ticker, await resolveCryptoTradingViewSymbol(ticker)] as const)
    );

    return Object.fromEntries(resolved);
}
