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
const getEarningsCalendar = vi.fn();
const getStockPriceHistory = vi.fn();
const getCryptoPriceHistory = vi.fn();
const computeIndicators = vi.fn();

// The personal tools go through the data layer, not the server actions: an action resolves a
// session, and a tool call already has an authenticated userId from its own caller.
vi.mock('@/lib/data/portfolio', () => ({
    getPortfolioSummaryForUser: (userId: string) => getPortfolioSummary(userId),
}));
vi.mock('@/lib/data/watchlist', () => ({
    getWatchlistForUser: (userId: string, assetType?: string) => getUserWatchlist(userId, assetType),
}));
vi.mock('@/lib/actions/crypto.actions', () => ({
    getCryptoMarkets: (limit: number) => getCryptoMarkets(limit),
    getCryptoCoinDetail: (id: string) => getCryptoCoinDetail(id),
    getCryptoNews: () => getCryptoNews(),
    getCryptoPriceHistory: (id: string) => getCryptoPriceHistory(id),
    searchCrypto: (query: string) => searchCrypto(query),
}));
vi.mock('@/lib/actions/finnhub.actions', () => ({
    getQuote: (symbol: string) => getQuote(symbol),
    getCompanyProfile: (symbol: string) => getCompanyProfile(symbol),
    getNews: () => getNews(),
    getEarningsCalendar: (symbol: string) => getEarningsCalendar(symbol),
    searchStocks: async () => [],
}));
vi.mock('@/lib/actions/screener.actions', () => ({
    runScreener: (assetType: string, strategy?: string) => runScreener(assetType, strategy),
    getStockPriceHistory: (symbol: string, range?: string) => getStockPriceHistory(symbol, range),
}));
vi.mock('@/lib/indicators', () => ({
    computeIndicators: (candles: unknown) => computeIndicators(candles),
}));

const loadAnalysisSkill = vi.fn();
const getAnalysisSkillSummary = vi.fn();
const listAnalysisSkills = vi.fn();

vi.mock('@/lib/analysis-skills', () => ({
    loadAnalysisSkill: (id: string, section?: string) => loadAnalysisSkill(id, section),
    getAnalysisSkillSummary: (id: string) => getAnalysisSkillSummary(id),
    listAnalysisSkills: () => listAnalysisSkills(),
    // Mirrors the real composer: the bridge is prefixed to the main document only.
    renderPlaybook: (doc: { body: string }, options?: { withBridge?: boolean }) =>
        options?.withBridge === false ? doc.body : `BRIDGE\n\n---\n\n${doc.body}`,
}));

const getCryptoRegime = vi.fn();
const evaluateBreakerForUser = vi.fn();
const portfolioRiskForUser = vi.fn();
vi.mock('@/lib/crypto-regime-live', () => ({ getCryptoRegime: () => getCryptoRegime() }));
vi.mock('@/lib/data/theses', () => ({ evaluateBreakerForUser: (userId: string) => evaluateBreakerForUser(userId) }));
vi.mock('@/lib/portfolio-risk-live', () => ({
    portfolioRiskForUser: (userId: string) => portfolioRiskForUser(userId),
}));

import { AI_TOOLS, getTool, getToolSpecs } from '@/lib/ai-tools';

/** Names that would indicate a mutating tool slipped into the read-only registry. */
const WRITE_VERBS = /create|add|update|delete|remove|set_|place|buy|sell|transfer|write/i;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('tool registry shape', () => {
    it('exposes seventeen tools', () => {
        expect(getToolSpecs()).toHaveLength(17);
        expect(AI_TOOLS).toHaveLength(17);
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

describe('get_analysis_playbook', () => {
    it('returns the playbook body and its available references', async () => {
        getAnalysisSkillSummary.mockResolvedValue({
            id: 'position-sizer',
            name: 'position-sizer',
            description: 'Sizes positions.',
            references: ['references/sizing_methodologies.md'],
            hasScripts: true,
        });
        loadAnalysisSkill.mockResolvedValue({
            id: 'position-sizer',
            name: 'position-sizer',
            description: 'Sizes positions.',
            body: '# Position Sizer\n\nRisk-based sizing.',
        });

        const tool = getTool('get_analysis_playbook')!;
        const result = (await tool.execute({ skill: 'position-sizer' }, { userId: 'u' })) as {
            skill: string;
            section: string;
            references: string[];
            playbook: string;
        };

        expect(loadAnalysisSkill).toHaveBeenCalledWith('position-sizer', undefined);
        expect(result.section).toBe('SKILL.md');
        expect(result.playbook).toContain('Risk-based sizing.');
        expect(result.references).toEqual(['references/sizing_methodologies.md']);
    });

    it('passes a requested section through', async () => {
        getAnalysisSkillSummary.mockResolvedValue({
            id: 'position-sizer',
            name: 'position-sizer',
            description: 'Sizes positions.',
            references: ['references/sizing_methodologies.md'],
            hasScripts: false,
        });
        loadAnalysisSkill.mockResolvedValue({
            id: 'position-sizer',
            name: 'position-sizer',
            description: 'Sizes positions.',
            body: 'methodologies',
        });

        const tool = getTool('get_analysis_playbook')!;
        await tool.execute(
            { skill: 'position-sizer', section: 'references/sizing_methodologies.md' },
            { userId: 'u' }
        );

        expect(loadAnalysisSkill).toHaveBeenCalledWith(
            'position-sizer',
            'references/sizing_methodologies.md'
        );
    });

    it('lists the available ids when the playbook is unknown', async () => {
        getAnalysisSkillSummary.mockResolvedValue(null);
        listAnalysisSkills.mockResolvedValue([
            { id: 'position-sizer', name: 'position-sizer', description: '', references: [], hasScripts: false },
            { id: 'backtest-expert', name: 'backtest-expert', description: '', references: [], hasScripts: false },
        ]);

        const tool = getTool('get_analysis_playbook')!;
        await expect(tool.execute({ skill: 'nope' }, { userId: 'u' })).rejects.toThrow(
            /Available playbooks: position-sizer, backtest-expert/
        );
    });

    it('rejects a section the playbook does not have', async () => {
        getAnalysisSkillSummary.mockResolvedValue({
            id: 'backtest-expert',
            name: 'backtest-expert',
            description: 'Backtesting.',
            references: [],
            hasScripts: false,
        });
        loadAnalysisSkill.mockResolvedValue(null);

        const tool = getTool('get_analysis_playbook')!;
        await expect(
            tool.execute({ skill: 'backtest-expert', section: 'references/nope.md' }, { userId: 'u' })
        ).rejects.toThrow(/no section/);
    });

    it('requires the skill argument', async () => {
        const tool = getTool('get_analysis_playbook')!;
        await expect(tool.execute({}, { userId: 'u' })).rejects.toThrow('"skill" is required');
    });

    it('prepends the bridge to the main document', async () => {
        getAnalysisSkillSummary.mockResolvedValue({
            id: 'backtest-expert',
            name: 'backtest-expert',
            description: 'Backtesting.',
            references: [],
            hasScripts: true,
        });
        loadAnalysisSkill.mockResolvedValue({
            id: 'backtest-expert',
            name: 'backtest-expert',
            description: 'Backtesting.',
            body: '# Backtest Expert',
        });

        const tool = getTool('get_analysis_playbook')!;
        const result = (await tool.execute({ skill: 'backtest-expert' }, { userId: 'u' })) as {
            playbook: string;
        };

        // Without this the model reads "python3 scripts/..." and reports a run that never
        // happened — the failure the whole bridge exists to prevent.
        expect(result.playbook.startsWith('BRIDGE')).toBe(true);
        expect(result.playbook).toContain('# Backtest Expert');
    });

    it('does not repeat the bridge on a reference section', async () => {
        getAnalysisSkillSummary.mockResolvedValue({
            id: 'position-sizer',
            name: 'position-sizer',
            description: 'Sizes positions.',
            references: ['references/sizing_methodologies.md'],
            hasScripts: true,
        });
        loadAnalysisSkill.mockResolvedValue({
            id: 'position-sizer',
            name: 'position-sizer',
            description: 'Sizes positions.',
            body: 'methodologies',
        });

        const tool = getTool('get_analysis_playbook')!;
        const result = (await tool.execute(
            { skill: 'position-sizer', section: 'references/sizing_methodologies.md' },
            { userId: 'u' }
        )) as { playbook: string };

        expect(result.playbook).toBe('methodologies');
    });
});

describe('get_earnings_calendar', () => {
    const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

    it('reports the next date, how far away it is, and that it is imminent', async () => {
        getEarningsCalendar.mockResolvedValue([
            { date: inDays(-3), epsActual: 1.2 },
            { date: inDays(2), hour: 'amc', epsEstimate: 1.5 },
            { date: inDays(30), hour: 'bmo', epsEstimate: 1.8 },
        ]);

        const tool = getTool('get_earnings_calendar')!;
        const result = (await tool.execute({ symbol: 'aapl' }, { userId: 'u' })) as {
            symbol: string;
            nextEarnings: { daysAway: number; hour: string } | null;
            imminent: boolean;
            recent: unknown[];
        };

        expect(getEarningsCalendar).toHaveBeenCalledWith('AAPL');
        expect(result.symbol).toBe('AAPL');
        expect(result.nextEarnings?.daysAway).toBe(2);
        expect(result.nextEarnings?.hour).toBe('amc');
        expect(result.imminent).toBe(true);
        // Past events are kept separately so the gate does not confuse the two.
        expect(result.recent).toHaveLength(1);
    });

    it('does not call a distant date imminent', async () => {
        getEarningsCalendar.mockResolvedValue([{ date: inDays(30), epsEstimate: 1.8 }]);

        const tool = getTool('get_earnings_calendar')!;
        const result = (await tool.execute({ symbol: 'AAPL' }, { userId: 'u' })) as {
            imminent: boolean;
        };

        expect(result.imminent).toBe(false);
    });

    it('distinguishes a provider failure from having no dates', async () => {
        // null is a failed lookup; [] is "the provider has nothing". Conflating them would let
        // an outage read as "no event risk", which is the one wrong answer here.
        getEarningsCalendar.mockResolvedValue(null);

        const tool = getTool('get_earnings_calendar')!;
        await expect(tool.execute({ symbol: 'AAPL' }, { userId: 'u' })).rejects.toThrow(
            /Could not load the earnings calendar/
        );
    });

    it('says an absent date is unknown, not clear', async () => {
        getEarningsCalendar.mockResolvedValue([]);

        const tool = getTool('get_earnings_calendar')!;
        const result = (await tool.execute({ symbol: 'AAPL' }, { userId: 'u' })) as {
            nextEarnings: null;
            imminent: boolean;
            note: string;
        };

        expect(result.nextEarnings).toBeNull();
        expect(result.imminent).toBe(false);
        expect(result.note).toMatch(/absence of data/i);
    });

    it('requires a symbol', async () => {
        const tool = getTool('get_earnings_calendar')!;
        await expect(tool.execute({}, { userId: 'u' })).rejects.toThrow('"symbol" is required');
    });
});

describe('get_benchmark', () => {
    const candle = { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 };

    it('uses SPY for stocks and passes its indicators through', async () => {
        getStockPriceHistory.mockResolvedValue([candle]);
        computeIndicators.mockReturnValue({ change30d: 9.1, sma200: 500 });

        const tool = getTool('get_benchmark')!;
        const result = (await tool.execute({}, { userId: 'u' })) as {
            market: string;
            indicators: { change30d: number };
        };

        expect(getStockPriceHistory).toHaveBeenCalledWith('SPY', undefined);
        expect(result.market).toBe('stocks');
        expect(result.indicators.change30d).toBe(9.1);
        expect(getCryptoPriceHistory).not.toHaveBeenCalled();
    });

    it('uses Bitcoin for crypto', async () => {
        getCryptoPriceHistory.mockResolvedValue([candle]);
        computeIndicators.mockReturnValue({ change30d: -4 });

        const tool = getTool('get_benchmark')!;
        const result = (await tool.execute({ market: 'crypto' }, { userId: 'u' })) as {
            benchmark: string;
        };

        expect(getCryptoPriceHistory).toHaveBeenCalledWith('bitcoin');
        expect(result.benchmark).toContain('Bitcoin');
    });

    it('fails loudly when the benchmark history is unavailable', async () => {
        getStockPriceHistory.mockResolvedValue(null);

        const tool = getTool('get_benchmark')!;
        await expect(tool.execute({}, { userId: 'u' })).rejects.toThrow(/Could not load/);
    });

    it('fails loudly when there is too little history to compute indicators', async () => {
        getStockPriceHistory.mockResolvedValue([candle]);
        computeIndicators.mockReturnValue(null);

        const tool = getTool('get_benchmark')!;
        await expect(tool.execute({}, { userId: 'u' })).rejects.toThrow(/too little history/);
    });
});

describe('get_crypto_regime', () => {
    const components = [
        { key: 'btc_trend', label: 'BTC Trend Structure', weight: 25, score: 100, signal: 'bull stack' },
    ];

    it('reports the composite, its components and the input coverage', async () => {
        getCryptoRegime.mockResolvedValue({
            score: 71.25,
            zone: 'NEUTRAL',
            guidance: 'Mixed conditions observed',
            components,
            effectiveWeights: { btc_trend: 25 },
            asOf: '2026-01-01T00:00:00.000Z',
            dominanceObservations: 2,
            universeSize: 21,
            fundingSample: 5,
        });

        const tool = getTool('get_crypto_regime')!;
        const result = (await tool.execute({}, { userId: 'u' })) as {
            score: number;
            zone: string;
            components: unknown[];
            inputs: { dominanceObservations: number; universeSize: number };
        };

        expect(result.score).toBe(71.25);
        expect(result.zone).toBe('NEUTRAL');
        expect(result.components).toHaveLength(1);
        // Input coverage travels with the score: a regime derived from two dominance points is a
        // different claim from one derived from a month of them.
        expect(result.inputs.dominanceObservations).toBe(2);
        expect(result.inputs.universeSize).toBe(21);
    });

    it('says UNKNOWN rather than guessing when too little of the model could be computed', async () => {
        getCryptoRegime.mockResolvedValue({
            score: null,
            zone: 'UNKNOWN',
            guidance: 'Insufficient components',
            components,
            effectiveWeights: {},
            asOf: '2026-01-01T00:00:00.000Z',
            dominanceObservations: 1,
            universeSize: 0,
            fundingSample: 0,
        });

        const tool = getTool('get_crypto_regime')!;
        const result = (await tool.execute({}, { userId: 'u' })) as {
            score?: number;
            zone: string;
            note: string;
        };

        // The dangerous failure here is not a null score, it is a model that fills the gap with a
        // plausible regime call. The note is the guard, so it is what the test pins.
        expect(result.score).toBeUndefined();
        expect(result.zone).toBe('UNKNOWN');
        expect(result.note).toMatch(/do not estimate a regime/i);
    });
});

describe('get_circuit_breaker', () => {
    it('acts for the signed-in user and reports the blocking rule, not a bare verdict', async () => {
        evaluateBreakerForUser.mockResolvedValue({
            recommendation: 'HALTED',
            dataQuality: 'OK',
            rationale: 'realized -2.5% today against a 2.0% limit',
            metrics: { realizedPnlToday: -2500 },
            triggeredRules: [
                {
                    rule: 'max_daily_loss_pct',
                    detail: 'realized -2.5% today against a 2.0% limit',
                    activeUntil: '2026-07-03T04:00:00.000Z',
                },
            ],
        });

        const tool = getTool('get_circuit_breaker')!;
        const result = (await tool.execute({}, { userId: 'u1' })) as {
            recommendation: string;
            triggeredRules: { rule: string }[];
            note: string;
        };

        expect(evaluateBreakerForUser).toHaveBeenCalledWith('u1');
        expect(result.recommendation).toBe('HALTED');
        // A verdict with no rule attached cannot be argued with; the rule is what makes it checkable.
        expect(result.triggeredRules[0].rule).toBe('max_daily_loss_pct');
        expect(result.note).toMatch(/blocked/);
    });

    it('does not let an allowed state read as a recommendation to buy', async () => {
        evaluateBreakerForUser.mockResolvedValue({
            recommendation: 'TRADING_ALLOWED',
            dataQuality: 'OK',
            rationale: 'no rule triggered',
            metrics: { realizedPnlToday: 0 },
            triggeredRules: [],
        });

        const tool = getTool('get_circuit_breaker')!;
        const result = (await tool.execute({}, { userId: 'u1' })) as { note: string };

        // "Allowed" is the account's state, not advice. Left unstated, a model reliably upgrades it.
        expect(result.note).toMatch(/not a recommendation/i);
    });
});

describe('run_backtest', () => {
    const series = (count: number) =>
        Array.from({ length: count }, (_, i) => ({
            t: 1_600_000_000_000 + i * 86_400_000,
            o: 100 + i / 3,
            h: 100 + i / 3,
            l: 100 + i / 3,
            c: 100 + i / 3,
            v: 1_000_000,
        }));

    // `computeIndicators` is mocked in this file, so the engine would otherwise receive undefined for
    // every bar and correctly report no trades. This bundle satisfies trend-following's three
    // criteria, which is all these tests need — the engine's own maths is covered in backtest.test.ts.
    const bundle = { price: 200, sma50: 150, sma200: 100, sma200Prior: 95, change30d: 10 };

    it('refuses an unknown strategy instead of silently using the default', async () => {
        getStockPriceHistory.mockResolvedValue(series(400));
        computeIndicators.mockReturnValue(bundle);
        const tool = getTool('run_backtest')!;

        // runStrategy falls back to the first strategy for an unrecognised id, which would return a
        // confident result for a strategy the caller never asked for.
        await expect(tool.execute({ symbol: 'AAPL', strategy: 'sure-thing' }, { userId: 'u' })).rejects.toThrow(
            /Unknown strategy/
        );
    });

    it('fails loudly when there is no history to test against', async () => {
        getStockPriceHistory.mockResolvedValue(null);
        const tool = getTool('run_backtest')!;

        await expect(tool.execute({ symbol: 'AAPL' }, { userId: 'u' })).rejects.toThrow(/No price history/);
    });

    it('asks Yahoo for a decade, not the screener\u2019s single year', async () => {
        getStockPriceHistory.mockResolvedValue(series(400));
        computeIndicators.mockReturnValue(bundle);
        const tool = getTool('run_backtest')!;

        await tool.execute({ symbol: 'aapl' }, { userId: 'u' });

        expect(getStockPriceHistory).toHaveBeenCalledWith('AAPL', '10y');
    });

    it('reports the verdict together with the reason not to trust it', async () => {
        getStockPriceHistory.mockResolvedValue(series(400));
        computeIndicators.mockReturnValue(bundle);
        const tool = getTool('run_backtest')!;

        const result = (await tool.execute({ symbol: 'AAPL', strategy: 'trend-following' }, { userId: 'u' })) as {
            metrics: { trades: number };
            verdict: string;
            redFlags: string[];
            note: string;
        };

        expect(result.metrics.trades).toBeGreaterThan(0);
        // Without a parameter sweep no run can deploy, however clean the metrics look.
        expect(result.verdict).not.toBe('DEPLOY');
        expect(result.redFlags.length).toBeGreaterThan(0);
        expect(result.note).toMatch(/never present a backtest as evidence/i);
    });
});

describe('get_portfolio_risk', () => {
    const report = (overrides: Record<string, unknown> = {}) => ({
        totalValue: 100_000,
        positions: 3,
        concentration: { topSymbol: 'AAPL', topWeightPct: 60, hhi: 0.46, effectivePositions: 2.2 },
        volatilityPct: 41.2,
        naiveVolatilityPct: 24.8,
        beta: 1.3,
        benchmark: { symbol: 'SPY', reason: 'stocks are 100% of the book by value' },
        coverage: { withHistory: 3, total: 3 },
        excluded: [],
        withoutHistory: [],
        ...overrides,
    });

    it('reports coverage alongside the figures', async () => {
        portfolioRiskForUser.mockResolvedValue(report({ coverage: { withHistory: 2, total: 3 } }));

        const tool = getTool('get_portfolio_risk')!;
        const result = (await tool.execute({}, { userId: 'u1' })) as {
            note: string;
            coverage: { withHistory: number };
        };

        expect(portfolioRiskForUser).toHaveBeenCalledWith('u1');
        expect(result.coverage.withHistory).toBe(2);
        expect(result.note).toMatch(/2 of 3/);
    });

    it('tells the model the correlation gap is the thing worth explaining', async () => {
        portfolioRiskForUser.mockResolvedValue(report());

        const tool = getTool('get_portfolio_risk')!;
        const result = (await tool.execute({}, { userId: 'u1' })) as { note: string };

        // Covariance above the naive figure is the signal; without this the model reports both
        // numbers and explains neither.
        expect(result.note).toMatch(/correlation/i);
    });

    it('refuses to characterise risk for an empty book', async () => {
        portfolioRiskForUser.mockResolvedValue(
            report({ positions: 0, totalValue: 0, volatilityPct: null, beta: null })
        );

        const tool = getTool('get_portfolio_risk')!;
        const result = (await tool.execute({}, { userId: 'u1' })) as { note: string };

        expect(result.note).toMatch(/rather than estimating/i);
    });
});
