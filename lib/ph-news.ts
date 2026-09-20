import 'server-only';

import { fetchWithTimeout } from '@/lib/http';
import { mapWithConcurrency } from '@/lib/concurrency';
import { parseRssFeed } from '@/lib/rss';

/**
 * Philippine business news.
 *
 * TradingView's timeline widget has no PSE market — its `market` parameter offers stock, crypto and
 * forex — so unlike the charts this panel cannot be a widget swap. These are the publishers' own
 * feeds instead.
 *
 * Every feed here was checked by hand first, which is why there are only three: BusinessWorld
 * redirects (301), GMA's business feed 404s, and Manila Bulletin returns 403 to a non-browser agent.
 * Listing a feed that does not work would render as a silently short panel.
 *
 * A feed that fails contributes nothing rather than failing the panel: these are independent
 * publishers, and one being down says nothing about the other two.
 */
const PH_NEWS_FEEDS = [
    'https://business.inquirer.net/feed',
    'https://www.rappler.com/business/feed/',
    'https://www.philstar.com/rss/business',
];

const MAX_PH_ARTICLES = 8;

const FEED_HEADERS = {
    'user-agent': 'Mozilla/5.0 (compatible; OpenStock/1.0)',
    accept: 'application/rss+xml, application/xml, text/xml',
};

export async function getPhNews(): Promise<MarketNewsArticle[]> {
    const perFeed = await mapWithConcurrency(PH_NEWS_FEEDS, 3, async (feed) => {
        try {
            const res = await fetchWithTimeout(feed, {
                headers: FEED_HEADERS,
                next: { revalidate: 600 },
            });

            if (!res.ok) {
                console.warn(`PH news feed ${res.status} for ${feed}`);
                return [];
            }

            const source = new URL(feed).hostname.replace(/^www\./, '');
            return parseRssFeed(await res.text(), source, 'ph');
        } catch (error) {
            console.warn(`PH news feed failed for ${feed}:`, error);
            return [];
        }
    });

    // Newest first across all three, then trimmed: the panel scrolls, but this is what it is sized
    // for, and mixing three publishers means their individual orderings cannot be trusted as one.
    return perFeed.flat().sort((a, b) => b.datetime - a.datetime).slice(0, MAX_PH_ARTICLES);
}
