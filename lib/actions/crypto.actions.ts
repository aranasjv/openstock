'use server';

import { cache } from 'react';
import { POPULAR_CRYPTO_IDS } from '@/lib/constants';

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

const COINGECKO_BASE_URL = (
    process.env.COINGECKO_API_BASE_URL || 'https://api.coingecko.com/api/v3'
).replace(/\/$/, '');

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || '';

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

async function fetchCoinGecko<T>(path: string, revalidateSeconds?: number): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const options: RequestInit & { next?: { revalidate?: number } } = revalidateSeconds
        ? { cache: 'force-cache', next: { revalidate: revalidateSeconds }, signal: controller.signal }
        : { cache: 'no-store', signal: controller.signal };

    if (COINGECKO_API_KEY) {
        options.headers = { 'x-cg-demo-api-key': COINGECKO_API_KEY };
    }

    try {
        const res = await fetch(`${COINGECKO_BASE_URL}${path}`, options);

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
    };
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
