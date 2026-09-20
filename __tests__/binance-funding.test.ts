import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getFundingRates } from '@/lib/binance';

/**
 * Funding feeds the leverage component of the crypto regime read, and the component is contrarian
 * — it only matters at the extremes. So the tests care most about what happens when the endpoint
 * is partly or wholly unavailable, because that is the normal case for a geo-blocked public API
 * and the failure mode is a silently wrong average rather than an error.
 */
function jsonResponse(body: unknown, ok = true) {
    return { ok, status: ok ? 200 : 500, json: async () => body };
}

beforeEach(() => {
    vi.unstubAllGlobals();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('getFundingRates', () => {
    it('averages the funding rate across the majors', async () => {
        const rates: Record<string, string> = {
            BTCUSDT: '0.0001',
            ETHUSDT: '0.0002',
            SOLUSDT: '0.0003',
        };

        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                const symbol = new URL(url).searchParams.get('symbol') ?? '';
                if (!(symbol in rates)) return jsonResponse({}, false);
                return jsonResponse({ symbol, lastFundingRate: rates[symbol] });
            })
        );

        const result = await getFundingRates(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);

        expect(result).not.toBeNull();
        expect(result?.sampleSize).toBe(3);
        // (0.0001 + 0.0002 + 0.0003) / 3
        expect(result?.averageRate).toBeCloseTo(0.0002, 8);
    });

    it('keeps the symbols that answered when one is unavailable', async () => {
        // The realistic case: Binance geo-blocks a symbol or two. Dropping the whole read would
        // mean no leverage component at all, so partial data must still be usable.
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                const symbol = new URL(url).searchParams.get('symbol') ?? '';
                if (symbol === 'BNBUSDT') throw new Error('blocked');
                return jsonResponse({ symbol, lastFundingRate: '0.0002' });
            })
        );

        const result = await getFundingRates(['BTCUSDT', 'ETHUSDT', 'BNBUSDT']);

        expect(result?.sampleSize).toBe(2);
        expect(result?.averageRate).toBeCloseTo(0.0002, 8);
        expect(result?.perSymbol.map((entry) => entry.symbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
    });

    it('returns null only when nothing answered', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('geo-blocked'); }));

        expect(await getFundingRates(['BTCUSDT', 'ETHUSDT'])).toBeNull();
    });

    it('ignores a response with no usable rate', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ symbol: 'BTCUSDT' })));

        // A missing field must not become NaN and quietly poison the average.
        expect(await getFundingRates(['BTCUSDT'])).toBeNull();
    });

    it('treats a non-2xx as unavailable rather than parsing the body', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ lastFundingRate: '0.0001' }, false)));

        expect(await getFundingRates(['BTCUSDT'])).toBeNull();
    });

    it('distinguishes a negative funding rate from a missing one', async () => {
        // Negative funding is a real signal — capitulation — not an absence of data. It must
        // survive the finite-number check that rejects NaN.
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse({ symbol: 'BTCUSDT', lastFundingRate: '-0.0004' }))
        );

        const result = await getFundingRates(['BTCUSDT']);

        expect(result?.averageRate).toBeCloseTo(-0.0004, 8);
    });
});
