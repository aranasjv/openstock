import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The tool registry is the assistant's entire interface to the outside world, so the
 * guarantees worth pinning down are:
 *   - every spec is well formed (the model is given a JSON schema it can actually use);
 *   - the set is read-only (no tool can mutate the user's data);
 *   - required arguments are rejected before any network call happens;
 *   - personal tools are scoped by the calling user's id, so a conversation cannot read
 *     another account's positions.
 *
 * Every data source is stubbed. Nothing here makes a real request.
 */

const getPortfolioSummary = vi.fn();
const getUserWatchlist = vi.fn();
const getCryptoMarkets = vi.fn();
const getCryptoCoinDetail = vi.fn();
const searchCrypto = vi.fn();
const getQuote = vi.fn();
const getCompanyProfile = vi.fn();
const getCryptoNews = vi.fn();
const getNews = vi.fn();
const runScreener = vi.fn();

vi.mock('@/lib/actions/holdings.actions', () => ({
    getPortfolioSummary: (userId: string) => getPortfolioSummary(userId),
}));
vi.mock('@/lib/actions/watchlist.actions', () => ({
    getUserWatchlist: (userId: string, assetType?: string) => getUserWatchlist(userId, assetType),
}));
vi.mock('@/lib/actions/crypto.actions', () => ({
    getCryptoMarkets: (limit: number) => getCryptoMarkets(limit),
    getCryptoCoinDetail: (id: string) => getCryptoCoinDetail(id),
    getCryptoNews: () => getCryptoNews(),
    searchCrypto: (query: string) => searchCrypto(query),
}));
vi.mock('@/lib/actions/finnhub.actions', () => ({
    getQuote: (symbol: string) => getQuote(symbol),
    getCompanyProfile: (symbol: string) => getCompanyProfile(symbol),
    getNews: () => getNews(),
    searchStocks: async () => [],
}));
vi.mock('@/lib/actions/screener.actions', () => ({
    runScreener: (assetType: string, strategy?: string) => runScreener(assetType, strategy),
}));

import { AI_TOOLS, getTool, getToolSpecs } from '@/lib/ai-tools';

/** Names that would indicate a mutating tool slipped into the read-only registry. */
const WRITE_VERBS = /create|add|update|delete|remove|set_|place|buy|sell|transfer|write/i;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('tool registry shape', () => {
    it('exposes nine tools', () => {
        expect(getToolSpecs()).toHaveLength(9);
        expect(AI_TOOLS).toHaveLength(9);
    });

    it('gives every tool a unique, non-empty name and description', () => {
        const names = getToolSpecs().map((spec) => spec.name);
        expect(new Set(names).size).toBe(names.length);

        for (const spec of getToolSpecs()) {
            expect(spec.name).toMatch(/^[a-z][a-z0-9_]*$/);
            expect(spec.description.length).toBeGreaterThan(20);
            expect(spec.parameters).toMatchObject({ type: 'object' });
        }
    });

    it('is read-only — no tool name implies a mutation', () => {
        for (const spec of getToolSpecs()) {
            expect(spec.name).not.toMatch(WRITE_VERBS);
        }
    });

    it('resolves a tool by name and returns undefined for an unknown one', () => {
        expect(getTool('run_screener')).toBeDefined();
        expect(getTool('drop_database')).toBeUndefined();
    });
});

describe('required-argument validation', () => {
    it('rejects get_stock_quote without a symbol', async () => {
        const tool = getTool('get_stock_quote')!;
        await expect(tool.execute({}, { userId: 'u' })).rejects.toThrow('"symbol" is required');
        expect(getQuote).not.toHaveBeenCalled();
    });

    it('rejects get_crypto_coin without an id', async () => {
        const tool = getTool('get_crypto_coin')!;
        await expect(tool.execute({ id: '   ' }, { userId: 'u' })).rejects.toThrow('"id" is required');
        expect(getCryptoCoinDetail).not.toHaveBeenCalled();
    });

    it('rejects get_indicators without a symbol', async () => {
        const tool = getTool('get_indicators')!;
        await expect(tool.execute({ assetType: 'stock' }, { userId: 'u' })).rejects.toThrow(
            '"symbol" is required'
        );
    });
});

describe('personal tools are scoped to the caller', () => {
    it('passes the calling user id to holdings and returns a note when empty', async () => {
        getPortfolioSummary.mockResolvedValue({
            holdings: [],
            totalValue: 0,
            totalCost: 0,
            totalPnl: 0,
            totalPnlPercent: 0,
            unpricedSymbols: [],
        });

        const tool = getTool('get_my_holdings')!;
        const result = (await tool.execute({}, { userId: 'user-42' })) as { holdings: unknown[]; note: string };

        expect(getPortfolioSummary).toHaveBeenCalledWith('user-42');
        expect(result.holdings).toEqual([]);
        expect(result.note).toContain('not recorded any holdings');
    });

    it('passes the caller and the asset filter to the watchlist', async () => {
        getUserWatchlist.mockResolvedValue([
            { symbol: 'bitcoin', company: 'Bitcoin', assetType: 'crypto' },
        ]);

        const tool = getTool('get_my_watchlist')!;
        const result = (await tool.execute({ assetType: 'crypto' }, { userId: 'user-7' })) as {
            count: number;
            items: { symbol: string; name: string; assetType: string }[];
        };

        expect(getUserWatchlist).toHaveBeenCalledWith('user-7', 'crypto');
        expect(result.count).toBe(1);
        expect(result.items[0]).toEqual({ symbol: 'bitcoin', name: 'Bitcoin', assetType: 'crypto' });
    });

    it('omits the asset filter when neither market is specified', async () => {
        getUserWatchlist.mockResolvedValue([]);
        const tool = getTool('get_my_watchlist')!;
        await tool.execute({}, { userId: 'user-7' });
        expect(getUserWatchlist).toHaveBeenCalledWith('user-7', undefined);
    });
});

describe('get_crypto_markets', () => {
    it('clamps the requested count and trims the payload', async () => {
        getCryptoMarkets.mockResolvedValue(
            Array.from({ length: 25 }, (_, i) => ({
                id: `coin-${i}`,
                symbol: `c${i}`,
                name: `Coin ${i}`,
                currentPrice: 1,
                changePercent24h: 0,
                marketCap: 100,
                marketCapRank: i + 1,
            }))
        );

        const tool = getTool('get_crypto_markets')!;
        const result = (await tool.execute({ limit: 5 }, { userId: 'u' })) as {
            count: number;
            coins: unknown[];
        };

        expect(result.count).toBe(5);
        expect(result.coins).toHaveLength(5);
    });

    it('reports a clear error when the provider returns nothing', async () => {
        getCryptoMarkets.mockResolvedValue([]);
        const tool = getTool('get_crypto_markets')!;
        await expect(tool.execute({}, { userId: 'u' })).rejects.toThrow(/rate limited/i);
    });
});

describe('run_screener', () => {
    it('returns only candidates that matched at least one condition, with the disclaimer', async () => {
        runScreener.mockResolvedValue({
            strategyId: 'trend-following',
            scanned: 12,
            unavailable: 0,
            candidates: [
                {
                    symbol: 'AAPL',
                    name: 'Apple',
                    price: 200,
                    score: 100,
                    tier: 'Strong',
                    matched: 3,
                    total: 3,
                    passed: [{ label: 'Above SMA50', detail: 'yes' }],
                    failed: [],
                },
                {
                    symbol: 'MSFT',
                    name: 'Microsoft',
                    price: 400,
                    score: 0,
                    tier: 'Watch',
                    matched: 0,
                    total: 3,
                    passed: [],
                    failed: [{ label: 'Above SMA50', detail: 'no' }],
                },
            ],
        });

        const tool = getTool('run_screener')!;
        const result = (await tool.execute({ assetType: 'stock' }, { userId: 'u' })) as {
            candidates: { symbol: string; conditionsMet: string }[];
            disclaimer: string;
        };

        expect(runScreener).toHaveBeenCalledWith('stock', undefined);
        // The 0/3 row is filtered out — it would be noise in the model's context.
        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0]).toMatchObject({ symbol: 'AAPL', conditionsMet: '3/3' });
        expect(result.disclaimer).toContain('not investment advice');
    });
});
