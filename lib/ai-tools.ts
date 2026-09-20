import 'server-only';

import type { AIToolSpec } from '@/lib/ai-provider';

/**
 * Tools the assistant can call.
 *
 * Deliberately read-only. A model that can silently create alerts, move money or edit
 * holdings is a far larger risk surface than this feature needs; everything here answers a
 * question. Write actions are left as future work.
 *
 * Every tool receives the calling user's id, and the personal ones (holdings, watchlist)
 * filter by it, so a conversation can never read another user's positions.
 */

export interface AIToolContext {
    userId: string;
}

export interface AITool {
    spec: AIToolSpec;
    /** Returns a JSON-serialisable result, or throws with a message the model can read. */
    execute: (args: Record<string, unknown>, ctx: AIToolContext) => Promise<unknown>;
}

function str(args: Record<string, unknown>, key: string): string {
    const value = args[key];
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`"${key}" is required and must be a non-empty string.`);
    }
    return value.trim();
}

function optionalAssetType(args: Record<string, unknown>): 'stock' | 'crypto' {
    const value = args.assetType;
    return value === 'crypto' ? 'crypto' : 'stock';
}

/**
 * Cap how much of a list is returned. Tool output is fed straight back into the model's
 * context, so an unbounded 50-coin payload on every call is wasteful and can crowd out the
 * conversation.
 */
function limit<T>(items: T[], max: number): T[] {
    return items.slice(0, max);
}

export const AI_TOOLS: AITool[] = [
    {
        spec: {
            name: 'search_assets',
            description:
                'Resolve a company name, ticker or coin name to the exact symbol or CoinGecko id used by the other tools. Call this first when you are not certain of the identifier.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'e.g. "apple", "AAPL", "bitcoin", "solana"' },
                    assetType: { type: 'string', enum: ['stock', 'crypto'], description: 'Restrict to one market.' },
                },
                required: ['query'],
            },
        },
        execute: async (args) => {
            const query = str(args, 'query');
            const assetType = optionalAssetType(args);

            // Imported lazily: these modules read runtime config and open network calls,
            // which should not happen merely because the tool registry was imported.
            if (assetType === 'crypto') {
                const { searchCrypto } = await import('@/lib/actions/crypto.actions');
                const coins = await searchCrypto(query);
                return {
                    assetType: 'crypto',
                    results: limit(
                        coins.map((coin) => ({ id: coin.id, symbol: coin.symbol, name: coin.name })),
                        10
                    ),
                };
            }

            const { searchStocks } = await import('@/lib/actions/finnhub.actions');
            const stocks = await searchStocks(query);
            return {
                assetType: 'stock',
                results: limit(
                    stocks.map((stock) => ({ symbol: stock.symbol, name: stock.name, exchange: stock.exchange })),
                    10
                ),
            };
        },
    },

    {
        spec: {
            name: 'get_stock_quote',
            description: 'Current price and daily change for a stock ticker. Use the exact ticker, e.g. AAPL.',
            parameters: {
                type: 'object',
                properties: { symbol: { type: 'string', description: 'Stock ticker, e.g. AAPL' } },
                required: ['symbol'],
            },
        },
        execute: async (args) => {
            const symbol = str(args, 'symbol').toUpperCase();
            const { getQuote, getCompanyProfile } = await import('@/lib/actions/finnhub.actions');
            const [quote, profile] = await Promise.all([getQuote(symbol), getCompanyProfile(symbol)]);

            if (!quote) {
                throw new Error(
                    `No quote returned for ${symbol}. Either the ticker is wrong or the market data provider is unavailable.`
                );
            }

            return {
                symbol,
                name: profile?.name ?? symbol,
                price: quote.c ?? null,
                change: quote.d ?? null,
                changePercent: quote.dp ?? null,
                currency: profile?.currency ?? 'USD',
                exchange: profile?.exchange ?? null,
                note: 'Price is from the configured market data provider and may be delayed on a free plan.',
            };
        },
    },

    {
        spec: {
            name: 'get_crypto_markets',
            description: 'Top cryptocurrencies by market cap with price, 24h change, market cap and volume.',
            parameters: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: 'How many coins to return, 1-25. Defaults to 10.' },
                },
            },
        },
        execute: async (args) => {
            const requested = Number(args.limit);
            const count = Number.isFinite(requested) ? Math.max(1, Math.min(25, Math.trunc(requested))) : 10;

            const { getCryptoMarkets } = await import('@/lib/actions/crypto.actions');
            const markets = await getCryptoMarkets(Math.max(count, 25));

            if (markets.length === 0) {
                throw new Error('CoinGecko returned no market data. It may be rate limited — try again shortly.');
            }

            return {
                count: Math.min(count, markets.length),
                coins: limit(
                    markets.map((coin) => ({
                        id: coin.id,
                        symbol: coin.symbol,
                        name: coin.name,
                        priceUsd: coin.currentPrice,
                        changePercent24h: coin.changePercent24h,
                        marketCapUsd: coin.marketCap,
                        marketCapRank: coin.marketCapRank ?? null,
                    })),
                    count
                ),
            };
        },
    },

    {
        spec: {
            name: 'get_crypto_coin',
            description:
                'Detail for one coin by its CoinGecko id (e.g. "bitcoin"): description, supply, all-time high and low.',
            parameters: {
                type: 'object',
                properties: { id: { type: 'string', description: 'CoinGecko id, e.g. "bitcoin"' } },
                required: ['id'],
            },
        },
        execute: async (args) => {
            const id = str(args, 'id').toLowerCase();
            const { getCryptoCoinDetail } = await import('@/lib/actions/crypto.actions');
            const coin = await getCryptoCoinDetail(id);

            if (!coin) {
                throw new Error(
                    `No coin found with id "${id}". Verify the id with search_assets — it is the CoinGecko id, not the ticker.`
                );
            }

            return {
                id: coin.id,
                name: coin.name,
                ticker: coin.symbol,
                priceUsd: coin.currentPrice,
                changePercent24h: coin.changePercent24h,
                marketCapUsd: coin.marketCap,
                marketCapRank: coin.marketCapRank ?? null,
                volume24hUsd: coin.totalVolume,
                allTimeHighUsd: coin.ath ?? null,
                allTimeLowUsd: coin.atl ?? null,
                circulatingSupply: coin.circulatingSupply ?? null,
                totalSupply: coin.totalSupply ?? null,
                description: coin.description ? coin.description.replace(/<[^>]*>/g, '').slice(0, 600) : null,
            };
        },
    },

    {
        spec: {
            name: 'get_indicators',
            description:
                'Computed technical indicators for a stock or coin — SMA50, SMA200, RSI(14), MACD, 20-bar high/low, volatility and max drawdown. This is the right tool for "is X overbought" or "where is the trend".',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Ticker for a stock, CoinGecko id for a coin.' },
                    assetType: { type: 'string', enum: ['stock', 'crypto'] },
                },
                required: ['symbol', 'assetType'],
            },
        },
        execute: async (args) => {
            const symbol = str(args, 'symbol');
            const assetType = optionalAssetType(args);

            const { computeIndicators } = await import('@/lib/indicators');
            const { getCryptoPriceHistory } = await import('@/lib/actions/crypto.actions');
            const { getStockPriceHistory } = await import('@/lib/actions/screener.actions');

            const candles =
                assetType === 'crypto'
                    ? await getCryptoPriceHistory(symbol)
                    : await getStockPriceHistory(symbol);

            if (!candles) {
                throw new Error(
                    `No price history for ${symbol} (${assetType}). For stocks the free source is unofficial and may be unavailable; for coins check the id.`
                );
            }

            const bundle = computeIndicators(candles);
            if (!bundle) {
                throw new Error(`Not enough price history for ${symbol} to compute indicators.`);
            }

            return {
                symbol,
                assetType,
                bars: bundle.bars,
                price: bundle.price,
                sma50: bundle.sma50,
                sma200: bundle.sma200,
                sma200TwentyBarsAgo: bundle.sma200Prior,
                rsi14: bundle.rsi14,
                macd: bundle.macd,
                high20: bundle.high20,
                low20: bundle.low20,
                change5dPercent: bundle.change5d,
                change30dPercent: bundle.change30d,
                maxDrawdownPercent: bundle.maxDrawdown,
                volatilityPercent: bundle.volatility,
                note: 'Computed from daily bars; any null value means insufficient history for that indicator.',
            };
        },
    },

    {
        spec: {
            name: 'run_screener',
            description:
                'Run the setups screener for one market and return the ranked candidates with their score and which conditions passed. This is deterministic — you are reporting its output, not producing your own ranking.',
            parameters: {
                type: 'object',
                properties: {
                    assetType: { type: 'string', enum: ['stock', 'crypto'] },
                    strategy: {
                        type: 'string',
                        enum: ['trend-following', 'momentum', 'oversold-pullback', 'breakout', 'mean-reversion'],
                    },
                },
                required: ['assetType'],
            },
        },
        execute: async (args) => {
            const assetType = optionalAssetType(args);
            const strategy = typeof args.strategy === 'string' ? args.strategy : undefined;

            const { runScreener } = await import('@/lib/actions/screener.actions');
            const result = await runScreener(assetType, strategy);
            const matched = result.candidates.filter((candidate) => candidate.matched > 0);

            return {
                assetType,
                strategy: result.strategyId,
                scanned: result.scanned,
                unavailable: result.unavailable,
                // Only assets that matched at least one condition; a 0/3 row is noise.
                candidates: limit(
                    matched.map((candidate) => ({
                        symbol: candidate.symbol,
                        name: candidate.name,
                        price: candidate.price,
                        score: candidate.score,
                        tier: candidate.tier,
                        conditionsMet: `${candidate.matched}/${candidate.total}`,
                        passed: candidate.passed.map((c) => `${c.label} (${c.detail})`),
                        failed: candidate.failed.map((c) => `${c.label} (${c.detail})`),
                    })),
                    8
                ),
                degradedNotice: result.unavailableReason ?? null,
                disclaimer:
                    'Rule-based technical screen, not investment advice. A score is the share of the strategy conditions met, not a forecast.',
            };
        },
    },

    {
        spec: {
            name: 'get_market_news',
            description: 'Recent market headlines for stocks or crypto.',
            parameters: {
                type: 'object',
                properties: { assetType: { type: 'string', enum: ['stock', 'crypto'] } },
                required: ['assetType'],
            },
        },
        execute: async (args) => {
            const assetType = optionalAssetType(args);

            const articles =
                assetType === 'crypto'
                    ? await (await import('@/lib/actions/crypto.actions')).getCryptoNews()
                    : await (await import('@/lib/actions/finnhub.actions')).getNews();

            return {
                assetType,
                count: articles.length,
                headlines: limit(
                    articles.map((article) => ({
                        headline: article.headline,
                        source: article.source,
                        url: article.url,
                    })),
                    8
                ),
            };
        },
    },

    {
        spec: {
            name: 'get_my_holdings',
            description:
                "The user's own portfolio positions with quantity, average cost, current value and profit/loss. Use this for any question about how their positions are doing.",
            parameters: { type: 'object', properties: {} },
        },
        execute: async (_args, ctx) => {
            // The data layer, not the server action: the action resolves a session, and a tool
            // call already knows whose turn it is (ctx.userId comes from the authenticated
            // caller), so it must not go through a second, conflicting identity check.
            const { getPortfolioSummaryForUser } = await import('@/lib/data/portfolio');
            const summary = await getPortfolioSummaryForUser(ctx.userId);

            if (summary.holdings.length === 0) {
                return { holdings: [], note: 'The user has not recorded any holdings yet.' };
            }

            return {
                totalValue: summary.totalValue,
                totalCost: summary.totalCost,
                totalPnl: summary.totalPnl,
                totalPnlPercent: summary.totalPnlPercent,
                holdings: limit(
                    summary.holdings.map((holding) => ({
                        symbol: holding.symbol,
                        assetType: holding.assetType,
                        quantity: holding.quantity,
                        averageCost: holding.averageCost,
                        price: holding.price,
                        marketValue: holding.marketValue,
                        pnl: holding.pnl,
                        pnlPercent: holding.pnlPercent,
                    })),
                    25
                ),
                unpricedSymbols: summary.unpricedSymbols,
                note: 'A null price means no quote was available; totals exclude those positions rather than counting them as zero.',
            };
        },
    },

    {
        spec: {
            name: 'get_my_watchlist',
            description: "The user's watchlist — the assets they are tracking.",
            parameters: {
                type: 'object',
                properties: { assetType: { type: 'string', enum: ['stock', 'crypto'] } },
            },
        },
        execute: async (args, ctx) => {
            const assetType = args.assetType === 'crypto' ? 'crypto' : args.assetType === 'stock' ? 'stock' : undefined;
            const { getWatchlistForUser } = await import('@/lib/data/watchlist');
            const items = await getWatchlistForUser(ctx.userId, assetType);

            return {
                count: items.length,
                items: limit(
                    items.map((item: { symbol: string; company: string; assetType?: string }) => ({
                        symbol: item.symbol,
                        name: item.company,
                        assetType: item.assetType ?? 'stock',
                    })),
                    50
                ),
            };
        },
    },

    {
        spec: {
            name: 'get_analysis_playbook',
            description:
                'Load one of the analysis playbooks vendored under .agents/skills — position sizing, market regime, technical analysis, CANSLIM/VCP screening, trade journaling, postmortems, backtesting. Call this BEFORE performing that kind of analysis, then follow the playbook. The available ids are listed in your system prompt.',
            parameters: {
                type: 'object',
                properties: {
                    skill: {
                        type: 'string',
                        description: 'Playbook id, e.g. "position-sizer", "crypto-regime-analyzer", "technical-analyst".',
                    },
                    section: {
                        type: 'string',
                        description:
                            'Optional reference document inside the playbook, e.g. "references/sizing_methodologies.md". Omit for the main playbook.',
                    },
                },
                required: ['skill'],
            },
        },
        execute: async (args) => {
            const skill = str(args, 'skill').toLowerCase();
            const section =
                typeof args.section === 'string' && args.section.trim() ? args.section.trim() : undefined;

            const { loadAnalysisSkill, getAnalysisSkillSummary, listAnalysisSkills, renderPlaybook } =
                await import('@/lib/analysis-skills');

            const summary = await getAnalysisSkillSummary(skill);
            if (!summary) {
                const available = (await listAnalysisSkills()).map((entry) => entry.id);
                throw new Error(
                    `No playbook "${skill}". Available playbooks: ${available.join(', ')}.`
                );
            }

            const document = await loadAnalysisSkill(skill, section);
            if (!document) {
                throw new Error(
                    section
                        ? `Playbook "${skill}" has no section "${section}". Available: ${summary.references.join(', ') || 'none'}.`
                        : `Playbook "${skill}" could not be read.`
                );
            }

            return {
                skill: document.id,
                name: document.name,
                section: section ?? 'SKILL.md',
                // Listed so the model can ask for a specific reference on a second call.
                references: summary.references,
                // The bridge is prepended for the main document only. A reference section is a
                // sub-document and does not need the "this is not a shell" preamble again.
                playbook: renderPlaybook(document, { withBridge: !section }),
                note: 'Vendored verbatim from the upstream project recorded in .agents/UPSTREAM.md. Follow it as written.',
            };
        },
    },
    {
        spec: {
            name: 'get_earnings_calendar',
            description:
                'Recent and upcoming earnings dates for a stock. Use it for event risk: the earnings playbook and the pre-trade gate both treat an imminent binary event as a reason to wait. A null nextEarnings means the provider has no date on record — that is an absence, not a clearance.',
            parameters: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: 'Stock ticker, e.g. "AAPL".' },
                },
                required: ['symbol'],
            },
        },
        execute: async (args) => {
            const symbol = str(args, 'symbol').toUpperCase();
            const { getEarningsCalendar } = await import('@/lib/actions/finnhub.actions');

            const events = await getEarningsCalendar(symbol);
            // null is a provider failure; [] is a real answer. Conflating them would let a
            // failed lookup read as "no event risk".
            if (events === null) throw new Error(`Could not load the earnings calendar for ${symbol}.`);

            const today = new Date().toISOString().slice(0, 10);
            const upcoming = events.filter((event) => event.date >= today);
            const next = upcoming[0] ?? null;
            const daysAway = next
                ? Math.round(
                      (Date.parse(`${next.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
                          86_400_000
                  )
                : null;

            return {
                symbol,
                nextEarnings: next
                    ? {
                          date: next.date,
                          daysAway,
                          hour: next.hour ?? 'unknown',
                          epsEstimate: next.epsEstimate ?? null,
                      }
                    : null,
                imminent: daysAway !== null && daysAway <= 7,
                recent: events.filter((event) => event.date < today).slice(-3),
                note: next
                    ? `Next earnings ${next.date} (${daysAway} day(s) away). Treat anything inside a week as event risk.`
                    : 'Finnhub has no upcoming earnings date for this symbol. That is an absence of data, not an absence of risk.',
            };
        },
    },
    {
        spec: {
            name: 'get_benchmark',
            description:
                'Indicators for the market benchmark — SPY for stocks, Bitcoin for crypto. Call it to judge an asset in context: relative strength is the asset\'s 30-day change minus this one\'s, and being up 4% means little if the benchmark is up 9%.',
            parameters: {
                type: 'object',
                properties: {
                    market: { type: 'string', description: '"stocks" (default) or "crypto".' },
                },
            },
        },
        execute: async (args) => {
            const market = args.market === 'crypto' ? 'crypto' : 'stocks';

            const [{ getStockPriceHistory }, { getCryptoPriceHistory }, { computeIndicators }] =
                await Promise.all([
                    import('@/lib/actions/screener.actions'),
                    import('@/lib/actions/crypto.actions'),
                    import('@/lib/indicators'),
                ]);

            const benchmark =
                market === 'crypto'
                    ? { symbol: 'bitcoin', label: 'Bitcoin (BTC)' }
                    : { symbol: 'SPY', label: 'S&P 500 ETF (SPY)' };

            const candles =
                market === 'crypto'
                    ? await getCryptoPriceHistory(benchmark.symbol)
                    : await getStockPriceHistory(benchmark.symbol);

            if (!candles) throw new Error(`Could not load ${benchmark.label} price history.`);

            const indicators = computeIndicators(candles);
            if (!indicators) {
                throw new Error(`${benchmark.label} has too little history to compute indicators.`);
            }

            return {
                market,
                benchmark: benchmark.label,
                symbol: benchmark.symbol,
                indicators,
                note: 'Relative strength = the asset\'s change30d minus this change30d. Compare like for like: an asset\'s own 5-day move against a benchmark\'s 30-day move is not a comparison.',
            };
        },
    },
    {
        spec: {
            name: 'get_crypto_regime',
            description:
                'The crypto regime: a 0-100 composite over six published components (BTC trend structure, alt breadth, dominance, funding, drawdown/volatility, momentum thrust) with a RISK_ON / NEUTRAL / RISK_OFF zone. Use it for "what kind of market is this" questions about crypto. It is deterministic, so report its output rather than forming your own regime view; a null score means too little of the model could be computed to say anything.',
            parameters: { type: 'object', properties: {} },
        },
        execute: async () => {
            const { getCryptoRegime } = await import('@/lib/crypto-regime-live');
            const report = await getCryptoRegime();

            const components = report.components.map((component) => ({
                key: component.key,
                label: component.label,
                weight: component.weight,
                score: component.score,
                signal: component.signal,
            }));

            const inputs = {
                dominanceObservations: report.dominanceObservations,
                universeSize: report.universeSize,
                fundingSample: report.fundingSample,
            };

            if (report.score === null) {
                return {
                    zone: 'UNKNOWN' as const,
                    components,
                    inputs,
                    note: 'Too little of the model could be computed for a score. Name the components that are null and what each needs; do not estimate a regime instead.',
                };
            }

            return {
                score: report.score,
                zone: report.zone,
                guidance: report.guidance,
                asOf: report.asOf,
                components,
                inputs,
                note: 'Deterministic output of the crypto-regime-analyzer playbook. Report the components and the zone — do not re-score them or infer a different verdict.',
            };
        },
    },
    {
        spec: {
            name: 'get_circuit_breaker',
            description:
                'The account-level circuit breaker: whether new entries are allowed right now, and if not, which realized-loss rule stopped them and when it lifts. Computed from closed journal theses, never from open positions. Check this before proposing a position.',
            parameters: { type: 'object', properties: {} },
        },
        execute: async (_args, ctx) => {
            const { evaluateBreakerForUser } = await import('@/lib/data/theses');
            const decision = await evaluateBreakerForUser(ctx.userId);

            return {
                recommendation: decision.recommendation,
                dataQuality: decision.dataQuality,
                rationale: decision.rationale,
                metrics: decision.metrics,
                triggeredRules: decision.triggeredRules,
                note:
                    decision.recommendation === 'TRADING_ALLOWED'
                        ? "New entries are permitted. Report that as the account's current state; it is not a recommendation to buy."
                        : "New entries are blocked by the account's own risk rules. State which rule triggered and when it lifts rather than proposing a position.",
            };
        },
    },
];

const TOOL_BY_NAME = new Map(AI_TOOLS.map((tool) => [tool.spec.name, tool]));

export function getToolSpecs(): AIToolSpec[] {
    return AI_TOOLS.map((tool) => tool.spec);
}

export function getTool(name: string): AITool | undefined {
    return TOOL_BY_NAME.get(name);
}
