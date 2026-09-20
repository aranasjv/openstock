import type { PseQuote } from '@/lib/phisix';

/**
 * A custom filter over the PSE snapshot.
 *
 * Built on the fields the feed actually carries — last price, today's change, today's volume — rather
 * than on the screener's trend and momentum criteria. Those need daily *history*, and no source this
 * app can reach supplies PSE history, so a filter that promised "uptrend" here would be printing a
 * number it cannot compute. What it can do honestly is answer "which listings moved more than 2% on
 * more than a million shares", which is a real screen over real data today.
 *
 * The symbol list is the other half of "custom": naming your own tickers is a filter too, and it is
 * the one that works when you already know what you are watching.
 */

export type PseSort = 'change' | 'volume' | 'price' | 'name';

export interface PseFilter {
    /** Restrict to these tickers when the user names their own list. */
    symbols: string[];
    minChange: number | null;
    maxChange: number | null;
    minVolume: number | null;
    minPrice: number | null;
    maxPrice: number | null;
    sort: PseSort;
    descending: boolean;
}

const SORTS: PseSort[] = ['change', 'volume', 'price', 'name'];

export const DEFAULT_PSE_FILTER: PseFilter = {
    symbols: [],
    minChange: null,
    maxChange: null,
    minVolume: null,
    minPrice: null,
    maxPrice: null,
    // Volume by default: the feed lists every listing including ones that did not trade, so leading
    // with "most active" is more useful than leading with the biggest price.
    sort: 'volume',
    descending: true,
};

function first(value: string | string[] | undefined): string {
    if (Array.isArray(value)) return value[0] ?? '';
    return value ?? '';
}

function numberOrNull(value: string | string[] | undefined): number | null {
    const raw = first(value).trim();
    if (raw === '') return null;

    // An unparseable number is treated as *unset*, not as zero. Zero would be a filter, and a filter
    // of zero quietly matches everything or nothing depending on the field.
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

export function parsePseFilter(params: Record<string, string | string[] | undefined>): PseFilter {
    const symbols = first(params.symbols)
        .split(',')
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);

    const requestedSort = first(params.sort);
    const sort = SORTS.includes(requestedSort as PseSort) ? (requestedSort as PseSort) : DEFAULT_PSE_FILTER.sort;

    return {
        symbols,
        minChange: numberOrNull(params.minChg),
        maxChange: numberOrNull(params.maxChg),
        minVolume: numberOrNull(params.minVol),
        minPrice: numberOrNull(params.minPrice),
        maxPrice: numberOrNull(params.maxPrice),
        sort,
        // Ascending only when explicitly asked for; the default view is "biggest first".
        descending: first(params.dir) !== 'asc',
    };
}

export function isPseFilterActive(filter: PseFilter): boolean {
    return (
        filter.symbols.length > 0 ||
        filter.minChange !== null ||
        filter.maxChange !== null ||
        filter.minVolume !== null ||
        filter.minPrice !== null ||
        filter.maxPrice !== null
    );
}

export function filterPseQuotes(quotes: PseQuote[], filter: PseFilter): PseQuote[] {
    const wanted = new Set(filter.symbols.map((symbol) => symbol.toUpperCase()));

    const matched = quotes.filter((quote) => {
        // A named symbol that is not in the feed cannot match, which is the honest outcome: the list
        // is the feed's, not ours.
        if (wanted.size > 0 && !wanted.has(quote.symbol.toUpperCase())) return false;
        if (filter.minChange !== null && quote.changePercent < filter.minChange) return false;
        if (filter.maxChange !== null && quote.changePercent > filter.maxChange) return false;
        if (filter.minVolume !== null && quote.volume < filter.minVolume) return false;
        if (filter.minPrice !== null && quote.price < filter.minPrice) return false;
        if (filter.maxPrice !== null && quote.price > filter.maxPrice) return false;
        return true;
    });

    const sortValue = (quote: PseQuote): number => {
        if (filter.sort === 'change') return quote.changePercent;
        if (filter.sort === 'volume') return quote.volume;
        return quote.price;
    };

    return matched.sort((a, b) => {
        if (filter.sort === 'name') {
            const order = a.symbol.localeCompare(b.symbol);
            return filter.descending ? -order : order;
        }
        const order = sortValue(b) - sortValue(a);
        return filter.descending ? order : -order;
    });
}
