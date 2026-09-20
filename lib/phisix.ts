import 'server-only';

import { fetchWithTimeout } from '@/lib/http';

/**
 * Philippine Stock Exchange quotes, from the community `phisix` feed.
 *
 * This is the whole reason a PH market is affordable at all: the endpoint returns **every** PSE
 * listing in a single keyless request, where the US path spends one request per symbol. There is no
 * signup, no key, and one upstream call for a complete market table.
 *
 * It is also the least official source in the app — a community-run App Engine app, with an older
 * host in the same project already returning 503 — so two guards are not optional:
 *
 * - **`as_of` is checked, not trusted.** The feed carries the trading day it describes. A snapshot
 *   from last Friday looks exactly like a live one once parsed, and prices that silently stop
 *   updating are worse than prices that are visibly missing.
 * - **A failure returns null, never an empty market.** "The feed is down" and "nothing traded today"
 *   are different claims, and an empty array makes them identical.
 *
 * The feed also lists preferred shares and warrants (`ACPB3`, `SMC2V`, and dozens more of the 385).
 * Those are filtered out by symbol shape rather than shown, because a table of "top PH stocks" that
 * leads with a 6.32% preferred series is wrong in a way that looks like a data error.
 */

const PHISIX_URL = 'https://phisix-api3.appspot.com/stocks.json';

/** Quotes change through the session; the underlying feed does too. */
const REVALIDATE_SECONDS = 300;

/** Manila is UTC+8 year round — no DST, so a fixed offset is exact rather than approximate. */
const MANILA_OFFSET_MS = 8 * 3_600_000;

export interface PseQuote {
    symbol: string;
    name: string;
    price: number;
    changePercent: number;
    volume: number;
}

export interface PseMarket {
    quotes: PseQuote[];
    /** The trading day the snapshot describes, as the feed reports it. */
    asOf: string;
    /** `asOf` is not the current Manila trading day, so the feed has stopped updating. */
    stale: boolean;
    /** Rows dropped as preferred shares, warrants or malformed. */
    excluded: number;
}

export function manilaDay(date: Date): string {
    return new Date(date.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Common stock only. PSE common tickers are letters (`SM`, `BDO`, `SMPH`); preferred series and
 * warrants carry digits (`ACPB3`, `SMC2V`), which is what this keys off.
 */
const COMMON_TICKER = /^[A-Z]{2,}$/;

function number(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function parsePseMarket(payload: unknown, now: Date): PseMarket | null {
    const body = payload as { stocks?: unknown; as_of?: unknown } | null;
    if (!body || !Array.isArray(body.stocks)) return null;

    const quotes: PseQuote[] = [];
    let excluded = 0;

    for (const entry of body.stocks) {
        const row = entry as {
            symbol?: unknown;
            name?: unknown;
            price?: { amount?: unknown };
            percentChange?: unknown;
            volume?: unknown;
        };

        const symbol = typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : '';
        if (!symbol || !COMMON_TICKER.test(symbol)) {
            excluded += 1;
            continue;
        }

        quotes.push({
            symbol,
            name: typeof row.name === 'string' ? row.name.trim() : symbol,
            price: number(row.price?.amount),
            changePercent: number(row.percentChange),
            volume: number(row.volume),
        });
    }

    if (quotes.length === 0) return null;

    // Most active first: the feed's own order is by listing, which buries the names that moved.
    quotes.sort((a, b) => b.volume - a.volume);

    const asOf = typeof body.as_of === 'string' ? body.as_of : '';
    const asOfDay = asOf.slice(0, 10);

    return {
        quotes,
        asOf,
        // An absent `as_of` is treated as stale rather than fresh: a missing freshness signal is not
        // evidence of freshness.
        stale: asOfDay !== manilaDay(now),
        excluded,
    };
}

/**
 * The PSE market snapshot, or null when the feed could not be read.
 *
 * Cached for five minutes: the feed itself updates on a similar cadence, so a shorter cache would
 * spend requests to re-read the same numbers.
 */
export async function fetchPseMarket(now = new Date()): Promise<PseMarket | null> {
    try {
        const res = await fetchWithTimeout(PHISIX_URL, { next: { revalidate: REVALIDATE_SECONDS } }, 15_000);
        if (!res.ok) {
            console.warn(`PSE feed returned HTTP ${res.status}`);
            return null;
        }

        return parsePseMarket(await res.json(), now);
    } catch (error) {
        console.warn(
            `PSE feed unavailable: ${error instanceof Error ? error.message : 'unknown'}${
                error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : ''
            }`
        );
        return null;
    }
}
