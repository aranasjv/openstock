'use server';

import { cache } from 'react';
import { POPULAR_CRYPTO_IDS } from '@/lib/constants';
import { loadConfig } from '@/lib/config';
import type { Candle } from '@/lib/indicators';

/**
 * CoinGecko data layer.
 *
 * Design notes vs. the Finnhub layer:
 * - CoinGecko's free tier allows far fewer requests per minute than Finnhub (60/min),
 *   so nothing here fans out per-coin. The markets list is fetched once and reused,
 *   and watchlist prices come back in a single batched call.
 * - Every exported function degrades to `null` / `[]` instead of throwing, so a rate
 *   limit or outage never takes down a page.
 */

const DEFAULT_COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';

const REQUEST_TIMEOUT_MS = 8000;

type RawCoinMarket = {
    id?: string;
    symbol?: string;
    name?: string;
    image?: string;
    market_cap_rank?: number | null;
    current_price?: number | null;
    price_change_percentage_24h?: number | null;
    market_cap?: number | null;
    total_volume?: number | null;
    high_24h?: number | null;
    low_24h?: number | null;
    ath?: number | null;
    atl?: number | null;
    circulating_supply?: number | null;
    total_supply?: number | null;
};

/**
 * Serialised request gate.
 *
 * The free CoinGecko tier allows roughly 10-30 requests a minute, and the screener asks for
 * one coin's history at a time. Firing those in parallel produces 429s — observed live, with
 * about a third of a cold scan failing. Spacing them costs latency on a cold cache and
 * nothing thereafter, which is the right trade.
 *
 * Requests are chained rather than merely delayed, so concurrency is one by construction
 * and there is no window where two calls slip through together.
 */
const MARKET_CHART_SPACING_MS = 2_000;
const DEFAULT_SPACING_MS = 250;

let requestChain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

/**
 * Circuit breaker for the shared CoinGecko quota.
 *
 * A 429 is not about one request — it means the account's quota is spent. Retrying every
 * screener symbol on its own schedule therefore keeps the quota exhausted and the page never
 * finishes: observed live, with each symbol cycling 15s retries while the serialised gate held
 * everything behind it. Once the API says back off, every caller stops asking until the window
 * passes, so the screener degrades to "unavailable" and renders instead of grinding.
 *
 * Per-process, like the gate above — see the note in AGENTS.md on single-replica assumptions.
 */
let rateLimitedUntil = 0;

function spacingFor(path: string): number {
    return path.includes('/market_chart') ? MARKET_CHART_SPACING_MS : DEFAULT_SPACING_MS;
}

function scheduleRequest(path: string): Promise<void> {
    const spacing = spacingFor(path);

    const scheduled = requestChain.then(async () => {
        // Leave the queue entirely while the quota is exhausted. Without this every queued
        // symbol still pays its spacing slice — two seconds each for a market_chart — before
        // discovering what the first 429 already established, which is a quarter of a minute of
        // a twelve-symbol scan spent waiting to be told the same thing.
        if (Date.now() < rateLimitedUntil) return;

        const elapsed = Date.now() - lastRequestAt;
        if (elapsed < spacing) {
            await new Promise((resolve) => setTimeout(resolve, spacing - elapsed));
        }
        lastRequestAt = Date.now();
    });

    // Keep the chain alive even if a scheduled wait rejects, or every later request would
    // inherit the rejection and the gate would deadlock.
    requestChain = scheduled.catch(() => undefined);
    return scheduled;
}

/** Retry-After is in seconds; clamp it so a hostile value cannot stall the scheduler. */
function retryDelayMs(res: Response, attempt: number): number {
    const header = Number(res.headers.get('retry-after'));
    if (Number.isFinite(header) && header > 0) {
        return Math.min(header * 1000, 15_000);
    }
    return Math.min(1_000 * 2 ** attempt, 8_000);
}

async function fetchCoinGecko<T>(path: string, revalidateSeconds?: number): Promise<T | null> {
    const config = await loadConfig();
    const baseUrl = (config.COINGECKO_API_BASE_URL || DEFAULT_COINGECKO_BASE_URL).replace(/\/$/, '');
    const apiKey = config.COINGECKO_API_KEY || '';

    // One attempt only. A 429 is a quota error, not a blip: sleeping out the Retry-After inside
    // a page render buys nothing, because the window it asks for (up to 15s) is longer than the
    // render can afford to wait. The breaker below stops every other caller instead.
    const MAX_ATTEMPTS = 1;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        // The quota is shared, so once the breaker has tripped there is nothing to gain by
        // asking again — and every symbol that asks keeps the page waiting.
        if (Date.now() < rateLimitedUntil) {
            return null;
        }

        await scheduleRequest(path);

        // Checked again *after* the gate. The screener issues its coin-history requests
        // concurrently, so they all pass the check above before the first 429 has come back —
        // and each then waits its two-second turn in the queue to discover the same thing. This
        // second check is what actually stops the remaining symbols.
        if (Date.now() < rateLimitedUntil) {
            return null;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const options: RequestInit & { next?: { revalidate?: number } } = revalidateSeconds
            ? { cache: 'force-cache', next: { revalidate: revalidateSeconds }, signal: controller.signal }
            : { cache: 'no-store', signal: controller.signal };

        if (apiKey) {
            options.headers = { 'x-cg-demo-api-key': apiKey };
        }

        try {
            const res = await fetch(`${baseUrl}${path}`, options);

            if (res.status === 429) {
                // Trip the breaker for every caller and give this one up immediately.
                //
                // Waiting the Retry-After out here is what made a cold crypto page take 38
                // seconds: every symbol paid it in turn, and the first one paid it twice
                // because the breaker expired exactly as the sleep ended. The screener already
                // reports degraded output, so returning now renders the page and the next load,
                // after the window, tries again.
                rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + retryDelayMs(res, attempt));
                console.warn(`CoinGecko rate limited (429) for ${path}; skipping until the window resets`);
                return null;
            }

            if (!res.ok) {
                console.error(`CoinGecko ${res.status} for ${path}`);
                return null;
            }

            return (await res.json()) as T;
        } catch (error) {
            console.error(`CoinGecko request failed for ${path}:`, error);
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    return null;
}

function mapMarket(coin: RawCoinMarket) {
    const id = (coin.id || '').toLowerCase();
    return {
        id,
        symbol: (coin.symbol || '').toUpperCase(),
        name: coin.name || id,
        image: coin.image,
        marketCapRank: coin.market_cap_rank ?? undefined,
        currentPrice: coin.current_price ?? 0,
        changePercent24h: coin.price_change_percentage_24h ?? null,
        marketCap: coin.market_cap ?? 0,
        totalVolume: coin.total_volume ?? 0,
        high24h: coin.high_24h ?? undefined,
        low24h: coin.low_24h ?? undefined,
        ath: coin.ath ?? undefined,
        atl: coin.atl ?? undefined,
        circulatingSupply: coin.circulating_supply ?? undefined,
        totalSupply: coin.total_supply ?? undefined,
    };
}

function coinIdsParam(ids: string[]): string {
    return ids
        .map((id) => id.trim().toLowerCase())
        .map((id) => encodeURIComponent(id))
        .filter(Boolean)
        .join(',');
}

/**
 * Top coins by market cap. Cached for 5 minutes and reused by both the dashboard
 * table and the empty-query search results, so a page render costs at most one call.
 */
export async function getCryptoMarkets(perPage = 50): Promise<CryptoMarketCoin[]> {
    const raw = await fetchCoinGecko<RawCoinMarket[]>(
        `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=false&price_change_percentage=24h`,
        300
    );

    if (!Array.isArray(raw)) return [];
    return raw.map(mapMarket).filter((c) => c.id);
}

/**
 * Batched market data for a specific set of coin ids — one request regardless of how
 * many coins are on the watchlist.
 */
export async function getCryptoMarketsByIds(coinIds: string[]): Promise<CryptoMarketCoin[]> {
    const ids = coinIdsParam(coinIds);
    if (!ids) return [];

    const raw = await fetchCoinGecko<RawCoinMarket[]>(
        `/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`
    );

    if (!Array.isArray(raw)) return [];
    return raw.map(mapMarket).filter((c) => c.id);
}

export async function getCryptoCoinDetail(coinId: string): Promise<CryptoCoinDetail | null> {
    if (!coinId) return null;

    const raw = await fetchCoinGecko<{
        id?: string;
        symbol?: string;
        name?: string;
        image?: { large?: string; small?: string };
        description?: { en?: string };
        links?: { homepage?: string[]; blockchain_site?: string[]; subreddit_url?: string };
        market_cap_rank?: number | null;
        /** Community sentiment, returned by the same request — no extra call needed. */
        sentiment_votes_up_percentage?: number | null;
        sentiment_votes_down_percentage?: number | null;
        market_data?: {
            current_price?: { usd?: number };
            market_cap?: { usd?: number };
            total_volume?: { usd?: number };
            price_change_percentage_24h?: number | null;
            high_24h?: { usd?: number };
            low_24h?: { usd?: number };
            ath?: { usd?: number };
            atl?: { usd?: number };
            circulating_supply?: number;
            total_supply?: number;
        };
        last_updated?: string;
    }>(`/coins/${encodeURIComponent(coinId.toLowerCase())}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`, 600);

    if (!raw || !raw.id) return null;

    const md = raw.market_data || {};
    const homepage = raw.links?.homepage?.find((link) => Boolean(link));

    return {
        id: raw.id.toLowerCase(),
        symbol: (raw.symbol || '').toUpperCase(),
        name: raw.name || raw.id,
        image: raw.image?.large || raw.image?.small,
        marketCapRank: raw.market_cap_rank ?? undefined,
        currentPrice: md.current_price?.usd ?? 0,
        changePercent24h: md.price_change_percentage_24h ?? null,
        marketCap: md.market_cap?.usd ?? 0,
        totalVolume: md.total_volume?.usd ?? 0,
        high24h: md.high_24h?.usd,
        low24h: md.low_24h?.usd,
        ath: md.ath?.usd,
        atl: md.atl?.usd,
        circulatingSupply: md.circulating_supply,
        totalSupply: md.total_supply,
        description: raw.description?.en || undefined,
        homepage,
        subreddit: raw.links?.subreddit_url || undefined,
        lastUpdated: raw.last_updated,
        sentimentUp: raw.sentiment_votes_up_percentage ?? null,
        sentimentDown: raw.sentiment_votes_down_percentage ?? null,
    };
}

/**
 * Market-wide crypto sentiment: the Fear & Greed Index from alternative.me (free, no key).
 *
 * This is context for a single coin rather than a per-coin signal — it answers "what is the
 * overall market mood", which a coin's own votes cannot.
 */
export async function getCryptoMarketSentiment(): Promise<{
    value: number;
    classification: string;
    updatedAt: number;
} | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const res = await fetch('https://api.alternative.me/fng/?limit=1', {
            cache: 'force-cache',
            next: { revalidate: 1800 },
            signal: controller.signal,
        });

        if (!res.ok) {
            console.error(`Fear & Greed ${res.status}`);
            return null;
        }

        const json = (await res.json()) as {
            data?: { value?: string; value_classification?: string; timestamp?: string }[];
        };
        const entry = json?.data?.[0];
        const value = Number.parseInt(entry?.value ?? '', 10);

        if (!Number.isFinite(value)) return null;

        return {
            value,
            classification: entry?.value_classification ?? 'Unknown',
            updatedAt: Number.parseInt(entry?.timestamp ?? '0', 10) * 1000,
        };
    } catch (error) {
        console.error('Fear & Greed request failed:', error);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Search coins. With no query this reuses the cached markets list (one request total),
 * rather than issuing one request per popular coin the way the stock search does.
 */
export const searchCrypto = cache(async (query?: string): Promise<CryptoCoinWithWatchlistStatus[]> => {
    const trimmed = (query || '').trim();

    if (!trimmed) {
        const markets = await getCryptoMarkets(Math.min(POPULAR_CRYPTO_IDS.length, 50));
        return markets.map((coin) => ({
            id: coin.id,
            symbol: coin.symbol,
            name: coin.name,
            image: coin.image,
            marketCapRank: coin.marketCapRank,
            isInWatchlist: false,
        }));
    }

    const raw = await fetchCoinGecko<{
        coins?: Array<{
            id?: string;
            symbol?: string;
            name?: string;
            thumb?: string;
            large?: string;
            market_cap_rank?: number | null;
        }>;
    }>(`/search?query=${encodeURIComponent(trimmed)}`, 3600);

    if (!raw?.coins || !Array.isArray(raw.coins)) return [];

    return raw.coins.slice(0, 15).map((coin) => ({
        id: (coin.id || '').toLowerCase(),
        symbol: (coin.symbol || '').toUpperCase(),
        name: coin.name || coin.id || '',
        image: coin.large || coin.thumb,
        marketCapRank: coin.market_cap_rank ?? undefined,
        isInWatchlist: false,
    }));
});

/**
 * Daily close/volume history for one coin, used by the screener.
 *
 * CoinGecko's market_chart returns close prices and volumes but not OHLC, so
 * open/high/low are filled from the close. Every indicator the screener uses is derived
 * from closes and volumes, so nothing is lost.
 *
 * Cached for 6 hours. The indicators are computed from DAILY bars, so an hourly refetch
 * bought nothing and was the direct cause of the rate limiting: a cold scan of twelve coins
 * meant twelve upstream calls. With this cache a repeat scan costs zero requests.
 */
export async function getCryptoPriceHistory(coinId: string): Promise<Candle[] | null> {
    if (!coinId) return null;

    const raw = await fetchCoinGecko<{
        prices?: [number, number][];
        total_volumes?: [number, number][];
    }>(`/coins/${encodeURIComponent(coinId.toLowerCase())}/market_chart?vs_currency=usd&days=200&interval=daily`, 21_600);

    if (!raw?.prices || !Array.isArray(raw.prices)) return null;

    const volumesByTimestamp = new Map<number, number>(
        (raw.total_volumes ?? []).map(([ts, volume]) => [ts, volume])
    );

    return raw.prices
        .filter((entry): entry is [number, number] => Array.isArray(entry) && Number.isFinite(entry[1]))
        .map(([ts, price]) => ({
            t: Math.floor(ts / 1000),
            o: price,
            h: price,
            l: price,
            c: price,
            v: volumesByTimestamp.get(ts) ?? 0,
        }));
}

/**
 * Crypto news.
 *
 * CoinGecko's /news endpoint is PRO-only (returns 401 on the free tier), so news comes
 * from public RSS feeds instead. Mapped into the shape the existing NewsGrid renders.
 * Returns [] when the feeds are unreachable.
 */
const CRYPTO_NEWS_FEEDS = [
    'https://cointelegraph.com/rss',
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://decrypt.co/feed',
];

const MAX_CRYPTO_ARTICLES = 6;

function decodeEntities(input: string): string {
    return input
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        // Strip tags before decoding entities so markup is never resurrected.
        .replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        // &amp; last, so "&amp;lt;" decodes to "&lt;" rather than "<".
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractTag(block: string, tag: string): string {
    const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    return match ? decodeEntities(match[1]) : '';
}

function parseRssFeed(xml: string, source: string): MarketNewsArticle[] {
    return xml
        .split(/<item[\s>]/i)
        .slice(1)
        .map((block) => {
            const title = extractTag(block, 'title');
            const url = extractTag(block, 'link');
            const description = extractTag(block, 'description');
            const published = extractTag(block, 'pubDate');

            const parsedMs = published ? Date.parse(published) : NaN;
            const datetime = Number.isFinite(parsedMs)
                ? Math.floor(parsedMs / 1000)
                : Math.floor(Date.now() / 1000);

            return {
                id: 0,
                headline: title,
                summary: description || title,
                source,
                url,
                // NewsGrid multiplies by 1000, so this must stay in Unix seconds.
                datetime,
                category: 'crypto',
                related: '',
            };
        })
        .filter((article) => article.headline && article.url);
}

export async function getCryptoNews(): Promise<MarketNewsArticle[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const feeds = await Promise.all(
            CRYPTO_NEWS_FEEDS.map(async (feed) => {
                try {
                    const res = await fetch(feed, {
                        headers: {
                            'user-agent': 'Mozilla/5.0 (compatible; OpenStock/1.0)',
                            accept: 'application/rss+xml, application/xml, text/xml',
                        },
                        next: { revalidate: 300 },
                        signal: controller.signal,
                    });

                    if (!res.ok) {
                        console.error(`Crypto news feed ${res.status} for ${feed}`);
                        return [];
                    }

                    const source = new URL(feed).hostname.replace(/^www\./, '');
                    return parseRssFeed(await res.text(), source);
                } catch (error) {
                    console.error(`Crypto news feed failed for ${feed}:`, error);
                    return [];
                }
            })
        );

        // Round-robin across feeds so one source cannot dominate the grid.
        const articles: MarketNewsArticle[] = [];
        const seen = new Set<string>();
        const longest = Math.max(0, ...feeds.map((f) => f.length));

        for (let i = 0; i < longest && articles.length < MAX_CRYPTO_ARTICLES; i++) {
            for (const feed of feeds) {
                const article = feed[i];
                if (!article || seen.has(article.url)) continue;
                seen.add(article.url);
                articles.push(article);
                if (articles.length >= MAX_CRYPTO_ARTICLES) break;
            }
        }

        return articles.map((article, index) => ({ ...article, id: index }));
    } catch (error) {
        console.error('Failed to fetch crypto news:', error);
        return [];
    } finally {
        clearTimeout(timeout);
    }
}
