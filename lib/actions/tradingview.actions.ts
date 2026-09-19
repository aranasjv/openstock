'use server';

import { resolveCryptoTradingViewSymbols } from '@/lib/tradingview';

/**
 * Resolve crypto tickers to TradingView symbols that actually exist.
 *
 * Exposed as an action because the watchlist manager is a client component: it discovers
 * tickers after fetching market data, and the probe must happen server-side (it is a
 * network check, and the TradingView endpoint rejects browser-style cross-origin calls).
 */
export async function resolveCryptoSymbols(
    tickers: string[]
): Promise<Record<string, string | null>> {
    if (!tickers || tickers.length === 0) return {};

    try {
        return await resolveCryptoTradingViewSymbols(tickers);
    } catch (error) {
        console.error('resolveCryptoSymbols failed:', error);
        return {};
    }
}
