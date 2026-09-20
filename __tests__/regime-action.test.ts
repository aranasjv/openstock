import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The engine is pure and tested elsewhere, so what is tested here is the *wiring*: which series get
 * fetched, what is passed where, and the two places a plausible shortcut would be wrong — an
 * average taken from a single exchange, and a momentum universe that quietly excludes BTC.
 */
const getCryptoMarkets = vi.fn();
const getCryptoPriceHistory = vi.fn();
const getFundingRates = vi.fn();
const getDominanceHistory = vi.fn();
const recordDominanceObservation = vi.fn();
const scoreCryptoRegime = vi.fn();

vi.mock('@/lib/actions/crypto.actions', () => ({
    getCryptoMarkets: (limit: number) => getCryptoMarkets(limit),
    getCryptoPriceHistory: (id: string, days?: number) => getCryptoPriceHistory(id, days),
}));
vi.mock('@/lib/binance', () => ({ getFundingRates: () => getFundingRates() }));
vi.mock('@/lib/data/dominance', () => ({
    getDominanceHistory: () => getDominanceHistory(),
    recordDominanceObservation: () => recordDominanceObservation(),
}));
vi.mock('@/lib/crypto-regime', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/crypto-regime')>();
    return { ...actual, scoreCryptoRegime: (input: unknown) => scoreCryptoRegime(input) };
});

import { getCryptoRegime } from '@/lib/crypto-regime-live';

interface EngineInput {
    btcCloses: number[];
    alts: { symbol: string; closes: number[] }[];
    dominanceSeries: number[];
    fundingAverage: number | null;
    momentumUniverse: { symbol: string; closes: number[] }[];
}

/** Candle closes live on `c` — see lib/indicators.ts. */
const candles = (close: number) => [
    { t: 1, o: close - 1, h: close, l: close - 1, c: close - 1, v: 1 },
    { t: 2, o: close - 1, h: close, l: close - 1, c: close, v: 1 },
];

beforeEach(() => {
    vi.clearAllMocks();

    recordDominanceObservation.mockResolvedValue(true);
    getCryptoMarkets.mockResolvedValue([
        { id: 'bitcoin', symbol: 'btc' },
        { id: 'ethereum', symbol: 'eth' },
        { id: 'solana', symbol: 'sol' },
    ]);
    getCryptoPriceHistory.mockResolvedValue(candles(100));
    getFundingRates.mockResolvedValue({
        averageRate: 0.0004,
        sampleSize: 3,
        perSymbol: [{ symbol: 'BTCUSDT', rate: 0.0004 }],
    });
    getDominanceHistory.mockResolvedValue({
        points: [
            { day: '2026-01-01', btcDominance: 54 },
            { day: '2026-01-02', btcDominance: 55 },
        ],
        change: 1,
        sufficient: false,
    });
    scoreCryptoRegime.mockReturnValue({
        score: 55,
        zone: 'NEUTRAL',
        guidance: 'stub',
        components: [],
        effectiveWeights: {},
    });
});

async function run() {
    await getCryptoRegime();
    return scoreCryptoRegime.mock.calls[0][0] as EngineInput;
}

describe('getCryptoRegime', () => {
    it('records the dominance observation before reading the history', async () => {
        await getCryptoRegime();

        // The history only grows if the read path records. A read that never recorded would leave
        // the component permanently unavailable and permanently redistributed.
        expect(recordDominanceObservation).toHaveBeenCalledTimes(1);
        expect(recordDominanceObservation.mock.invocationCallOrder[0]).toBeLessThan(
            getDominanceHistory.mock.invocationCallOrder[0]
        );
    });

    it('fetches a year of BTC history but the default window for alts', async () => {
        await getCryptoRegime();

        // The alt window must stay at the default so it shares the screener's 6-hour cache; asking
        // for a year per coin would double the CoinGecko load for data already held.
        expect(getCryptoPriceHistory).toHaveBeenCalledWith('bitcoin', 365);
        expect(getCryptoPriceHistory.mock.calls).toContainEqual(['ethereum', undefined]);
        expect(getCryptoPriceHistory.mock.calls).toContainEqual(['solana', undefined]);
    });

    it('includes BTC in the momentum universe', async () => {
        const input = await run();

        // The methodology says the momentum universe includes BTC. Excluding the largest asset
        // would measure a different market from the one being asked about.
        expect(input.momentumUniverse.map((series) => series.symbol)).toContain('BTC');
        expect(input.momentumUniverse[0].symbol).toBe('BTC');
        // And it must not be double-counted as an alt.
        expect(input.alts.map((series) => series.symbol)).not.toContain('BTC');
    });

    it('treats funding from a single exchange as unavailable', async () => {
        getFundingRates.mockResolvedValue({
            averageRate: 0.0004,
            sampleSize: 1,
            perSymbol: [{ symbol: 'BTCUSDT', rate: 0.0004 }],
        });

        const input = await run();

        // One venue's funding is not a market-wide leverage reading. Averaging it in would score a
        // crowded-longs component from a single order book.
        expect(input.fundingAverage).toBeNull();
    });

    it('passes the funding average once at least two symbols answered', async () => {
        const input = await run();
        expect(input.fundingAverage).toBe(0.0004);
    });

    it('degrades a missing funding reading rather than inventing a neutral one', async () => {
        getFundingRates.mockResolvedValue(null);

        const input = await run();

        // Not 0, which would score as "neutral" and hide the gap. null makes the component
        // unavailable and hands its weight to the others.
        expect(input.fundingAverage).toBeNull();
    });

    it('drops a coin whose history failed instead of scoring it as zero', async () => {
        getCryptoPriceHistory.mockImplementation(async (id: string) =>
            id === 'ethereum' ? null : candles(100)
        );

        const report = await getCryptoRegime();
        const input = scoreCryptoRegime.mock.calls[0][0] as EngineInput;

        expect(input.alts.map((series) => series.symbol)).toEqual(['SOL']);
        expect(report.universeSize).toBe(2);
    });

    it('reports the counts the user needs to judge reliability', async () => {
        const report = await getCryptoRegime();

        expect(report.dominanceObservations).toBe(2);
        expect(report.universeSize).toBe(3);
        expect(report.fundingSample).toBe(3);
        expect(report.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('passes the dominance series oldest-first', async () => {
        const input = await run();
        expect(input.dominanceSeries).toEqual([54, 55]);
    });
});
