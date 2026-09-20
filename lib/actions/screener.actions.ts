'use server';

import { POPULAR_STOCK_SYMBOLS } from '@/lib/constants';
import { loadConfig, getConfigNumber } from '@/lib/config';
import { computeIndicators, type Candle } from '@/lib/indicators';
import {
    runStrategy,
    STRATEGIES,
    type BenchmarkContext,
    isStrategyId,
    DEFAULT_STRATEGY_ID,
    type Criterion,
    type StrategyId,
} from '@/lib/strategies';
import { getCryptoMarkets, getCryptoPriceHistory } from '@/lib/actions/crypto.actions';
import { buildCandidatePrompt, getTraderFramework } from '@/lib/trading-framework';
import { getCachedScreener, setCachedScreener } from '@/lib/screener-cache';
import type { AIProviderName } from '@/lib/ai-provider';

/**
 * The screener.
 *
 * Two data paths with very different reliability:
 *   - Crypto  -> CoinGecko market_chart. Official, free, stable.
 *   - Stocks  -> Yahoo Finance's unofficial chart endpoint. Finnhub's candle endpoint
 *                requires a paid plan and Stooq is now behind a JS challenge, so this is
 *                the only free OHLCV source left. It is treated as unreliable: any
 *                failure marks that symbol unavailable instead of failing the page.
 */

const DEFAULT_YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const REQUEST_TIMEOUT_MS = 10_000;
const CONCURRENCY = 4;

/**
 * The reference each run measures relative strength against: SPY for stocks, BTC for crypto.
 *
 * Returns null rather than throwing when it cannot be built. A missing benchmark costs one
 * criterion for every row in the run, which is a much smaller failure than losing the screen — and
 * because the omission is run-wide, the remaining scores still share a denominator and stay
 * comparable to each other.
 */
async function loadBenchmark(assetType: 'stock' | 'crypto'): Promise<BenchmarkContext | null> {
    try {
        const candles =
            assetType === 'crypto'
                ? await getCryptoPriceHistory('bitcoin')
                : await getStockPriceHistory('SPY');

        if (!candles) return null;

        const bundle = computeIndicators(candles);
        if (!bundle || bundle.change30d === null) return null;

        return { symbol: assetType === 'crypto' ? 'BTC' : 'SPY', change30d: bundle.change30d };
    } catch (error) {
        console.warn('Screener: benchmark unavailable, relative strength omitted:', error);
        return null;
    }
}

/** A playbook used as an explanation persona is capped so one call cannot blow up the bill. */
const MAX_PLAYBOOK_SYSTEM_CHARS = 12_000;

/**
 * Kept alongside whichever playbook is selected: the vendored playbooks are general-purpose
 * and shipped for other data sources, so the app's own boundary is restated on top of them.
 */
const EXPLAIN_GUARD =
    'OpenStock boundary: report conditions, measured values and invalidation levels only. ' +
    'Never give buy/sell/hold advice or price targets. Every figure must come from the data ' +
    'supplied below, never from memory.';

export interface ScreenerCandidate {
    /** Route key: CoinGecko id for crypto, ticker for stocks. */
    symbol: string;
    name: string;
    price: number;
    changePercent24h: number | null;
    score: number;
    tier: 'Strong' | 'Moderate' | 'Watch';
    passed: Criterion[];
    failed: Criterion[];
    matched: number;
    total: number;
    /** Exposed so the UI can flag overbought/oversold conditions at a glance. */
    rsi14: number | null;
}

export interface ScreenerResult {
    strategyId: StrategyId;
    strategies: { id: StrategyId; name: string; summary: string }[];
    candidates: ScreenerCandidate[];
    scanned: number;
    unavailable: number;
    /** True when at least one data source failed, so the UI can say results are partial. */
    degraded: boolean;
    /** Set when nothing could be analysed at all (e.g. the stock feed is down). */
    unavailableReason?: string;
}

/**
 * Fetch daily candles from Yahoo's unofficial chart endpoint.
 * Exported so the AI tool layer can compute indicators for a single stock without
 * re-running the whole screener.
 */
export async function getStockPriceHistory(symbol: string): Promise<Candle[] | null> {
    const config = await loadConfig();
    const baseUrl = (config.YAHOO_CHART_BASE_URL || DEFAULT_YAHOO_CHART_BASE).replace(/\/$/, '');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const res = await fetch(
            `${baseUrl}/${encodeURIComponent(symbol)}?range=1y&interval=1d`,
            {
                headers: {
                    // Yahoo rejects requests without a browser-like agent.
                    'user-agent': 'Mozilla/5.0 (compatible; OpenStock/1.0)',
                    accept: 'application/json',
                },
                next: { revalidate: 3600 },
                signal: controller.signal,
            }
        );

        if (!res.ok) {
            console.error(`Yahoo chart ${res.status} for ${symbol}`);
            return null;
        }

        const data = await res.json();
        const result = data?.chart?.result?.[0];
        const timestamps: number[] | undefined = result?.timestamp;
        const quote = result?.indicators?.quote?.[0];

        if (!timestamps || !quote?.close) return null;

        const candles: Candle[] = [];
        for (let i = 0; i < timestamps.length; i++) {
            const close = quote.close[i];
            // Yahoo emits nulls for halted or partial sessions.
            if (!Number.isFinite(close)) continue;

            candles.push({
                t: timestamps[i],
                o: Number.isFinite(quote.open?.[i]) ? quote.open[i] : close,
                h: Number.isFinite(quote.high?.[i]) ? quote.high[i] : close,
                l: Number.isFinite(quote.low?.[i]) ? quote.low[i] : close,
                c: close,
                v: Number.isFinite(quote.volume?.[i]) ? quote.volume[i] : 0,
            });
        }

        return candles.length > 0 ? candles : null;
    } catch (error) {
        console.error(`Yahoo chart request failed for ${symbol}:`, error);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

/** Run async work over items with a bounded number of concurrent tasks. */
async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;

    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await worker(items[index]);
        }
    });

    await Promise.all(runners);
    return results;
}

async function getStockName(symbol: string): Promise<string> {
    // The screener only needs a display label; the ticker is a fine fallback if the
    // profile lookup fails.
    try {
        const { getCompanyProfile } = await import('@/lib/actions/finnhub.actions');
        const profile = await getCompanyProfile(symbol);
        return profile?.name || symbol;
    } catch {
        return symbol;
    }
}

async function runScreenerUncached(
    assetType: 'stock' | 'crypto',
    strategyId: StrategyId
): Promise<ScreenerResult> {
    const strategies = STRATEGIES.map(({ id, name, summary }) => ({ id, name, summary }));

    // One setting per market. A crypto scan is a history request per coin, while the stock list is
    // a fixed curated set, so the two have no reason to share a number — and the defaults differ
    // by an order of magnitude.
    const universeSize =
        assetType === 'crypto'
            ? await getConfigNumber('CRYPTO_SCREENER_UNIVERSE_SIZE', 100)
            : await getConfigNumber('SCREENER_UNIVERSE_SIZE', 12);

    // Build the universe: crypto by market cap, stocks from the curated popular list.
    const universe: { symbol: string; name: string; price: number; changePercent24h: number | null }[] = [];

    if (assetType === 'crypto') {
        // CoinGecko caps `per_page` at 250. The 50 that used to be here was a ceiling from when
        // the universe was a dozen coins and was never meant to be a limit — it silently ignored
        // any larger setting.
        const markets = await getCryptoMarkets(Math.min(universeSize, 250));
        for (const coin of markets.slice(0, universeSize)) {
            universe.push({
                symbol: coin.id,
                name: `${coin.name} (${coin.symbol})`,
                price: coin.currentPrice,
                changePercent24h: coin.changePercent24h,
            });
        }
    } else {
        for (const symbol of POPULAR_STOCK_SYMBOLS.slice(0, universeSize)) {
            universe.push({ symbol, name: symbol, price: 0, changePercent24h: null });
        }
    }

    if (universe.length === 0) {
        return {
            strategyId,
            strategies,
            candidates: [],
            scanned: 0,
            unavailable: 0,
            degraded: true,
            unavailableReason: 'The market data provider returned no instruments.',
        };
    }

    // One benchmark per run, not one per asset: it is the same series every time, and fetching it
    // inside the loop would multiply one cached call by the size of the universe.
    const benchmark = await loadBenchmark(assetType);

    const analyses = await mapWithConcurrency(universe, CONCURRENCY, async (entry) => {
        try {
            const candles =
                assetType === 'crypto'
                    ? await getCryptoPriceHistory(entry.symbol)
                    : await getStockPriceHistory(entry.symbol);

            if (!candles) return null;

            const bundle = computeIndicators(candles);
            if (!bundle) return null;

            const result = runStrategy(bundle, strategyId, benchmark);

            const name =
                assetType === 'crypto' ? entry.name : await getStockName(entry.symbol);

            const candidate: ScreenerCandidate = {
                symbol: entry.symbol,
                name,
                price: bundle.price,
                changePercent24h: entry.changePercent24h,
                score: result.score,
                tier: result.tier,
                passed: result.passed,
                failed: result.failed,
                matched: result.matched,
                total: result.total,
                rsi14: bundle.rsi14,
            };
            return candidate;
        } catch (error) {
            console.error(`Screener failed for ${entry.symbol}:`, error);
            return null;
        }
    });

    const candidates = analyses.filter((item): item is ScreenerCandidate => item !== null);
    const unavailable = universe.length - candidates.length;

    // Rank by score, then by how many of the strategy's own conditions matched, so ties
    // prefer assets that satisfied the strategy rather than just the raw percentage.
    candidates.sort((a, b) => b.score - a.score || b.matched - a.matched);

    return {
        strategyId,
        strategies,
        candidates,
        scanned: universe.length,
        unavailable,
        degraded: unavailable > 0,
        unavailableReason:
            candidates.length === 0
                ? assetType === 'stock'
                    ? 'Stock history is unavailable. The free OHLCV source used here is unofficial and may be blocked or rate limited.'
                    : 'Crypto history is unavailable right now — the market data provider may be rate limiting requests. This usually clears within a minute.'
                : undefined,
    };
}

/**
 * Run the screener, memoised for SCREENER_CACHE_SECONDS.
 *
 * Only non-empty results are cached. A fully-degraded scan (every symbol unavailable, which
 * is what a burst of rate limiting looks like) is deliberately not cached — pinning that
 * for an hour would leave the dashboard stuck showing nothing long after the provider
 * recovered.
 */
export async function runScreener(
    assetType: 'stock' | 'crypto',
    strategyIdInput?: string
): Promise<ScreenerResult> {
    const strategyId: StrategyId = isStrategyId(strategyIdInput) ? strategyIdInput : DEFAULT_STRATEGY_ID;

    const cacheSeconds = await getConfigNumber('SCREENER_CACHE_SECONDS', 3600);
    const cacheKey = `${assetType}:${strategyId}`;

    const cached = getCachedScreener(cacheKey);
    if (cached) return cached;

    const result = await runScreenerUncached(assetType, strategyId);

    if (result.candidates.length > 0) {
        setCachedScreener(cacheKey, result, cacheSeconds);
    }

    return result;
}

/** Strategy metadata for the dropdown. */
export async function getStrategiesForUi(): Promise<
    { id: StrategyId; name: string; summary: string }[]
> {
    return STRATEGIES.map(({ id, name, summary }) => ({ id, name, summary }));
}

/**
 * AI rationale for one candidate, generated on demand rather than for every row on every
 * page load — each call costs credit.
 *
 * The model only writes the explanation. Selection, scoring and ordering stay
 * deterministic in lib/strategies.ts, so switching AI provider or framework never changes
 * which assets appear or how they rank.
 */
export async function explainCandidate(
    assetType: 'stock' | 'crypto',
    symbol: string,
    strategyIdInput: string
): Promise<{
    ok: boolean;
    text?: string;
    error?: string;
    framework?: string;
    /** Set when a vendored playbook was used as the explanation persona. */
    playbook?: string;
    provider?: string;
}> {
    const strategyId: StrategyId = isStrategyId(strategyIdInput) ? strategyIdInput : DEFAULT_STRATEGY_ID;

    try {
        const candles =
            assetType === 'crypto'
                ? await getCryptoPriceHistory(symbol)
                : await getStockPriceHistory(symbol);

        if (!candles) return { ok: false, error: 'No price history available for this asset.' };

        const bundle = computeIndicators(candles);
        if (!bundle) return { ok: false, error: 'Not enough history to analyse this asset.' };

        // The explanation is generated for a row the user is looking at, so it is judged against the
        // same benchmark the screen used — otherwise the write-up would describe a different asset
        // than the one in the table.
        const result = runStrategy(bundle, strategyId, await loadBenchmark(assetType));
        const strategy = STRATEGIES.find((s) => s.id === strategyId) ?? STRATEGIES[0];

        const config = await loadConfig();
        const providerName = (config.AI_PROVIDER || 'gemini') as AIProviderName;

        // The framework comes from the same runtime config as everything else.
        const framework = getTraderFramework(config.TRADER_FRAMEWORK);

        // Optionally superseded by one of the full playbooks vendored under .agents/skills.
        // The playbook replaces the persona rather than stacking on it — the upstream
        // playbooks define their own output structure and would otherwise be contradicted.
        const playbookId = (config.ANALYSIS_PLAYBOOK || '').trim();
        let system = framework.system;
        let playbookUsed: string | undefined;

        if (playbookId) {
            const { loadAnalysisSkill, getAnalysisSkillSummary, renderPlaybook } = await import(
                '@/lib/analysis-skills'
            );
            const summary = await getAnalysisSkillSummary(playbookId);

            if (!summary) {
                console.warn(
                    `explainCandidate: ANALYSIS_PLAYBOOK "${playbookId}" is not a vendored playbook; using the built-in framework.`
                );
            } else {
                const document = await loadAnalysisSkill(playbookId);
                if (document) {
                    // Bridge first, so the model learns which tools replace the playbook's
                    // scripts before reading instructions that assume a shell.
                    system = `${renderPlaybook(document).slice(0, MAX_PLAYBOOK_SYSTEM_CHARS)}\n\n---\n${EXPLAIN_GUARD}`;
                    playbookUsed = document.id;
                }
            }
        }

        const prompt = buildCandidatePrompt({
            symbol,
            assetType,
            strategyName: strategy.name,
            strategySummary: strategy.summary,
            bundle,
            passed: result.passed,
            failed: result.failed,
            matched: result.matched,
            total: result.total,
        });

        const { callAIProvider } = await import('@/lib/ai-provider');
        const text = await callAIProvider(prompt, providerName, {
            system,
            temperature: framework.temperature,
        });

        return {
            ok: true,
            text: text.trim(),
            framework: framework.name,
            playbook: playbookUsed,
            provider: providerName,
        };
    } catch (error) {
        console.error('explainCandidate failed:', error);
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'Could not generate an explanation.',
        };
    }
}
