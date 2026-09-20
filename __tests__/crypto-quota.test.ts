import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let configValues: Record<string, string> = {};

vi.mock('@/lib/config', () => ({
    loadConfig: async () => configValues,
}));

/**
 * The breaker and the spacing are module-level and deliberately not exported, so each test loads
 * a fresh copy of the module — otherwise the first test's 429 would trip the breaker for every
 * test after it and they would pass or fail depending on the order they ran in.
 */
async function freshModule() {
    vi.resetModules();
    return await import('@/lib/actions/crypto.actions');
}

function rateLimited() {
    return {
        status: 429,
        ok: false,
        headers: new Headers({ 'retry-after': '15' }),
        json: async () => ({}),
    };
}

describe('CoinGecko quota handling', () => {
    beforeEach(() => {
        configValues = {
            COINGECKO_API_BASE_URL: 'https://api.coingecko.com/api/v3',
            COINGECKO_API_KEY: '',
        };
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('gives up on a 429 instead of sleeping out the Retry-After', async () => {
        // The sleep is what made a cold page take 38s: this is the regression guard for it.
        const started = Date.now();
        const fetchMock = vi.fn().mockResolvedValue(rateLimited());
        vi.stubGlobal('fetch', fetchMock);

        const { getCryptoPriceHistory } = await freshModule();
        const result = await getCryptoPriceHistory('bitcoin');

        expect(result).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        // Retry-After says 15s; it must not have waited anything like that.
        expect(Date.now() - started).toBeLessThan(5_000);
    });

    it('skips later calls entirely while the breaker is tripped', async () => {
        const fetchMock = vi.fn().mockResolvedValue(rateLimited());
        vi.stubGlobal('fetch', fetchMock);

        const { getCryptoPriceHistory } = await freshModule();

        await getCryptoPriceHistory('bitcoin');
        await getCryptoPriceHistory('ethereum');
        await getCryptoPriceHistory('solana');

        // This is the whole point of the breaker: twelve symbols must not each make their own
        // doomed attempt through the serialised gate.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('still fetches while the quota is healthy', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            status: 200,
            ok: true,
            headers: new Headers(),
            json: async () => ({
                prices: [
                    [1_700_000_000_000, 100],
                    [1_700_086_400_000, 101],
                ],
            }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const { getCryptoPriceHistory } = await freshModule();
        const result = await getCryptoPriceHistory('bitcoin');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result).not.toBeNull();
    });

    it('does not trip the breaker on a non-429 failure', async () => {
        // A 500 from one symbol must not stop the whole scan — only a quota error is shared.
        const fetchMock = vi.fn().mockResolvedValue({
            status: 500,
            ok: false,
            headers: new Headers(),
            json: async () => ({}),
        });
        vi.stubGlobal('fetch', fetchMock);

        const { getCryptoPriceHistory } = await freshModule();

        await getCryptoPriceHistory('bitcoin');
        await getCryptoPriceHistory('ethereum');

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
