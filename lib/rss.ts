/**
 * RSS parsing, shared by the crypto and Philippine news paths.
 *
 * Extracted from the crypto fetcher rather than duplicated, so a fix to entity handling or to the
 * timestamp contract lands for both markets at once — the two would otherwise drift the moment
 * either feed changed shape.
 *
 * The parser is forgiving rather than spec-compliant, deliberately: these are public feeds written
 * by hand, and a strict XML parser rejects one for a stray tag where a reader would show it fine.
 * Anything that does not yield both a headline and a link is dropped instead of rendered empty.
 */

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

export function parseRssFeed(
    xml: string,
    source: string,
    category = 'market'
): MarketNewsArticle[] {
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
                category,
                related: '',
            };
        })
        .filter((article) => article.headline && article.url);
}
