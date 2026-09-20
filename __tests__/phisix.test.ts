import { describe, it, expect } from 'vitest';
import { manilaDay, parsePseMarket } from '@/lib/phisix';

const PAYLOAD = {
    as_of: '2026-09-20T00:00:00+08:00',
    stocks: [
        { symbol: 'SM', name: 'SM Investments Corporation', price: { currency: 'PHP', amount: 503 }, percentChange: -5.98, volume: 2_309_170 },
        { symbol: 'ACPB3', name: 'Ayala Corp Pref Series 3', price: { currency: 'PHP', amount: 1924 }, percentChange: 0, volume: 0 },
        { symbol: 'BDO', name: 'BDO Unibank, Inc.', price: { currency: 'PHP', amount: 113 }, percentChange: -1.22, volume: 5_824_890 },
        { symbol: 'SMC2V', name: 'San Miguel Pref', price: { currency: 'PHP', amount: 75 }, percentChange: 0, volume: 0 },
    ],
};

/** Mid-morning in Manila on the day the fixture describes. */
const SAME_DAY = new Date('2026-09-20T02:00:00Z');

describe('manilaDay', () => {
    it('converts across the UTC date boundary', () => {
        // 20:00 UTC on the 19th is 04:00 on the 20th in Manila, and the feed's `as_of` is a Manila
        // date — comparing it to a UTC date would report a live feed as stale every evening.
        expect(manilaDay(new Date('2026-09-19T20:00:00Z'))).toBe('2026-09-20');
        expect(manilaDay(new Date('2026-09-20T15:59:00Z'))).toBe('2026-09-20');
        expect(manilaDay(new Date('2026-09-20T16:01:00Z'))).toBe('2026-09-21');
    });
});

describe('parsePseMarket', () => {
    it('keeps common stock and orders it by activity', () => {
        const market = parsePseMarket(PAYLOAD, SAME_DAY)!;

        // The feed's own order is by listing, which buries the names that actually moved.
        expect(market.quotes.map((quote) => quote.symbol)).toEqual(['BDO', 'SM']);
        expect(market.quotes[0]).toEqual({
            symbol: 'BDO',
            name: 'BDO Unibank, Inc.',
            price: 113,
            changePercent: -1.22,
            volume: 5_824_890,
        });
    });

    it('drops preferred series and warrants, and says how many', () => {
        const market = parsePseMarket(PAYLOAD, SAME_DAY)!;

        // A "top PH stocks" table leading with a 6.32% preferred series is wrong in a way that looks
        // like a data error, so they are excluded by symbol shape rather than displayed.
        expect(market.quotes.some((quote) => /\d/.test(quote.symbol))).toBe(false);
        expect(market.excluded).toBe(2);
    });

    it('reports a feed that has stopped updating as stale', () => {
        expect(parsePseMarket(PAYLOAD, SAME_DAY)!.stale).toBe(false);
        expect(parsePseMarket(PAYLOAD, new Date('2026-09-21T02:00:00Z'))!.stale).toBe(true);
    });

    it('treats a missing as_of as stale rather than fresh', () => {
        const market = parsePseMarket({ stocks: PAYLOAD.stocks }, SAME_DAY)!;

        // A missing freshness signal is not evidence of freshness, and this feed is the least
        // official source in the app.
        expect(market.stale).toBe(true);
    });

    it('returns null rather than an empty market', () => {
        expect(parsePseMarket(null, SAME_DAY)).toBeNull();
        expect(parsePseMarket({}, SAME_DAY)).toBeNull();
        expect(parsePseMarket({ stocks: 'nope' }, SAME_DAY)).toBeNull();

        // Everything filtered out is indistinguishable from a feed that failed, and an empty array
        // would let "the market closed flat" and "the source is down" render identically.
        expect(parsePseMarket({ stocks: PAYLOAD.stocks.filter((row) => /\d/.test(row.symbol)) }, SAME_DAY)).toBeNull();
    });

    it('fills gaps without inventing values', () => {
        const market = parsePseMarket(
            {
                as_of: '2026-09-20T00:00:00+08:00',
                stocks: [
                    { symbol: 'SM' },
                    { symbol: 'BDO', name: 'BDO Unibank', price: { amount: 'nope' }, volume: 5 },
                    { name: 'no symbol' },
                ],
            },
            SAME_DAY
        )!;

        expect(market.quotes).toHaveLength(2);
        expect(market.quotes.find((quote) => quote.symbol === 'SM')).toEqual({
            symbol: 'SM',
            // Falls back to the ticker rather than an empty string.
            name: 'SM',
            price: 0,
            changePercent: 0,
            volume: 0,
        });
        expect(market.quotes.find((quote) => quote.symbol === 'BDO')!.price).toBe(0);
        expect(market.excluded).toBe(1);
    });
});
