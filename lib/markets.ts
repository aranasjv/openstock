/**
 * The markets this app covers.
 *
 * Two, not one, because "which market am I looking at" is now a real question rather than an
 * assumption — and it changes the data source, the currency, the TradingView symbol namespace and
 * what the screener can even attempt.
 */
export const MARKETS = ['us', 'ph'] as const;

export type Market = (typeof MARKETS)[number];

export interface MarketMeta {
    /** For prose. */
    label: string;
    /** For a toggle chip. */
    short: string;
    currency: string;
    /** IANA zone, used by the widget configs so PSE charts render in Manila time. */
    timezone: string;
    /** TradingView namespaces non-US symbols by exchange; US tickers are bare. */
    tvPrefix: string;
}

export const MARKET_META: Record<Market, MarketMeta> = {
    us: { label: 'United States', short: 'US', currency: 'USD', timezone: 'America/New_York', tvPrefix: '' },
    ph: { label: 'Philippines', short: 'PH', currency: 'PHP', timezone: 'Asia/Manila', tvPrefix: 'PSE:' },
};

/** Anything unrecognised is the default market rather than an error — the toggle is a link. */
export function parseMarket(value: string | undefined | string[]): Market {
    const raw = Array.isArray(value) ? value[0] : value;
    return raw === 'ph' ? 'ph' : 'us';
}
