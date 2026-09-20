import { describe, expect, it } from 'vitest';

import { DEFAULT_PSE_FILTER, filterPseQuotes, isPseFilterActive, parsePseFilter } from '@/lib/pse-filter';
import type { PseQuote } from '@/lib/phisix';

const QUOTES: PseQuote[] = [
    { symbol: 'SM', name: 'SM Investments', price: 503, changePercent: -5.98, volume: 2_309_170 },
    { symbol: 'BDO', name: 'BDO Unibank', price: 113, changePercent: -1.22, volume: 5_824_890 },
    { symbol: 'ICT', name: 'Intl Container', price: 905, changePercent: 3.21, volume: 2_600_000 },
    { symbol: 'ACPB3', name: 'Ayala Pref', price: 1924, changePercent: 0, volume: 0 },
];

const symbols = (quotes: PseQuote[]) => quotes.map((quote) => quote.symbol);

describe('parsePseFilter', () => {
    it('defaults to the whole market, most active first', () => {
        const filter = parsePseFilter({});

        expect(filter).toEqual(DEFAULT_PSE_FILTER);
        expect(isPseFilterActive(filter)).toBe(false);
    });

    it('parses a named symbol list, trimmed and upper-cased', () => {
        expect(parsePseFilter({ symbols: ' sm , bdo ,, tel ' }).symbols).toEqual(['SM', 'BDO', 'TEL']);
        expect(isPseFilterActive(parsePseFilter({ symbols: 'SM' }))).toBe(true);
    });

    it('parses numeric bounds', () => {
        const filter = parsePseFilter({ minChg: '1.5', maxChg: '9', minVol: '1000000', minPrice: '10', maxPrice: '900' });

        expect(filter.minChange).toBe(1.5);
        expect(filter.maxChange).toBe(9);
        expect(filter.minVolume).toBe(1_000_000);
        expect(filter.minPrice).toBe(10);
        expect(filter.maxPrice).toBe(900);
    });

    it('treats an unparseable number as unset rather than as zero', () => {
        // Zero is a *filter*: `minChange=0` means "gainers only". An empty or malformed value means
        // "no bound", and conflating the two would silently hide or show the whole market.
        const filter = parsePseFilter({ minChg: 'abc', maxChg: '', minVol: '  ' });

        expect(filter.minChange).toBeNull();
        expect(filter.maxChange).toBeNull();
        expect(filter.minVolume).toBeNull();
        expect(isPseFilterActive(filter)).toBe(false);
    });

    it('accepts zero as a deliberate bound', () => {
        expect(parsePseFilter({ minChg: '0' }).minChange).toBe(0);
    });

    it('falls back to the default sort when the requested one is unknown', () => {
        expect(parsePseFilter({ sort: 'nonsense' }).sort).toBe('volume');
        expect(parsePseFilter({ sort: 'change' }).sort).toBe('change');
    });

    it('sorts descending unless ascending is asked for explicitly', () => {
        expect(parsePseFilter({}).descending).toBe(true);
        expect(parsePseFilter({ dir: 'desc' }).descending).toBe(true);
        expect(parsePseFilter({ dir: 'asc' }).descending).toBe(false);
    });
});

describe('filterPseQuotes', () => {
    it('sorts by volume when nothing else is set', () => {
        expect(symbols(filterPseQuotes(QUOTES, DEFAULT_PSE_FILTER))).toEqual(['BDO', 'ICT', 'SM', 'ACPB3']);
    });

    it('restricts to a named symbol list', () => {
        const filter = { ...DEFAULT_PSE_FILTER, symbols: ['BDO', 'ICT'] };
        expect(symbols(filterPseQuotes(QUOTES, filter))).toEqual(['BDO', 'ICT']);
    });

    it('matches nothing when a named symbol is not in the feed', () => {
        const filter = { ...DEFAULT_PSE_FILTER, symbols: ['NOPE'] };
        expect(filterPseQuotes(QUOTES, filter)).toEqual([]);
    });

    it('applies change bounds', () => {
        // Both lists come back volume-ordered, which is the default sort — the assertions read in that
        // order rather than in the fixture's.
        expect(symbols(filterPseQuotes(QUOTES, { ...DEFAULT_PSE_FILTER, minChange: 0 }))).toEqual(['ICT', 'ACPB3']);
        expect(symbols(filterPseQuotes(QUOTES, { ...DEFAULT_PSE_FILTER, maxChange: -1 }))).toEqual(['BDO', 'SM']);
    });

    it('applies volume and price bounds', () => {
        expect(symbols(filterPseQuotes(QUOTES, { ...DEFAULT_PSE_FILTER, minVolume: 3_000_000 }))).toEqual(['BDO']);
        // ICT at 926 is above the floor too, which is easy to miss when reading the fixture.
        expect(symbols(filterPseQuotes(QUOTES, { ...DEFAULT_PSE_FILTER, minPrice: 500 }))).toEqual([
            'ICT',
            'SM',
            'ACPB3',
        ]);
    });

    it('sorts by name in either direction', () => {
        expect(symbols(filterPseQuotes(QUOTES, { ...DEFAULT_PSE_FILTER, sort: 'name' }))).toEqual([
            'SM',
            'ICT',
            'BDO',
            'ACPB3',
        ]);
        expect(
            symbols(filterPseQuotes(QUOTES, { ...DEFAULT_PSE_FILTER, sort: 'name', descending: false }))
        ).toEqual(['ACPB3', 'BDO', 'ICT', 'SM']);
    });

    it('sorts by change ascending when asked', () => {
        expect(
            symbols(filterPseQuotes(QUOTES, { ...DEFAULT_PSE_FILTER, sort: 'change', descending: false }))
        ).toEqual(['SM', 'BDO', 'ACPB3', 'ICT']);
    });

    it('leaves the caller array in its original order', () => {
        // The sort is applied to the filtered copy. Sorting in place would reorder whatever the caller
        // still holds — here, the same array the movers panel is built from.
        filterPseQuotes(QUOTES, { ...DEFAULT_PSE_FILTER, sort: 'change' });

        expect(symbols(QUOTES)).toEqual(['SM', 'BDO', 'ICT', 'ACPB3']);
    });
});
