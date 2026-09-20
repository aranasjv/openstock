import { getPhNews } from '@/lib/ph-news';

/**
 * Philippine business headlines.
 *
 * `fill`-shaped like the US news panel, so the two markets read the same even though the sources
 * differ. It renders its own empty state rather than collapsing: a panel that disappears is
 * indistinguishable from a page with less on it, and "the feeds are down" is worth saying.
 */
function timeAgo(seconds: number): string {
    const hours = Math.floor((Date.now() / 1000 - seconds) / 3600);
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export default async function PhNewsPanel() {
    const articles = await getPhNews();

    return (
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900/30">
            <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-3 py-2">
                <h2 className="text-sm font-semibold text-white">PH Business News</h2>
                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                    {articles.length} stories
                </span>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {articles.length === 0 ? (
                    <p className="p-4 text-xs text-gray-400">
                        No Philippine headlines could be loaded right now. The publishers&apos; feeds
                        are read directly, so this is a feed problem rather than an empty news day.
                    </p>
                ) : (
                    <ul className="divide-y divide-gray-800/60">
                        {articles.map((article) => (
                            <li key={article.url}>
                                <a
                                    href={article.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block px-3 py-2 transition-colors hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none"
                                >
                                    <p className="text-xs leading-snug text-gray-200">
                                        {article.headline}
                                    </p>
                                    <p className="mt-1 text-[10px] text-gray-500">
                                        {article.source} · {timeAgo(article.datetime)}
                                    </p>
                                </a>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}
