import type { IndicatorBundle } from '@/lib/indicators';
import type { Criterion } from '@/lib/strategies';

/**
 * Analytical framework used when asking a model to explain a screener result.
 *
 * Adapted from the `technical-analyst` skill in tradermonty/claude-trading-skills
 * (MIT licensed). That skill is built around *weekly chart images* — its workflow reads
 * bundled reference documents and Python scripts, none of which apply to a single text
 * completion. What transfers, and what is reproduced here, is its methodology:
 *
 *   - a fixed analysis sequence (trend -> levels -> moving averages -> volume -> synthesis)
 *   - probabilistic scenarios that must sum to 100%
 *   - an explicit invalidation level for every scenario
 *   - a mandatory opposing case, to counter confirmation bias
 *   - objectivity rules: no subjective language, no advice
 *
 * The skill's own guardrail ("verdict-only — never a trade recommendation on its own")
 * is preserved verbatim in spirit below.
 *
 * This shapes *wording only*. Scores and rankings remain deterministic and computed in
 * lib/strategies.ts; the model never influences which assets are selected or how they are
 * ordered.
 */

export type TraderFrameworkId = 'technical-analyst' | 'plain';

export interface TraderFramework {
    id: TraderFrameworkId;
    name: string;
    description: string;
    /** Prepended as the system prompt. */
    system: string;
    temperature: number;
}

export const TRADER_FRAMEWORKS: TraderFramework[] = [
    {
        id: 'technical-analyst',
        name: 'Technical Analyst (structured)',
        description:
            'Structured read: trend, levels, moving averages and volume, with a scenario and an invalidation level.',
        temperature: 0.3,
        system: [
            'You are a technical analyst explaining a rule-based screen to a retail investor.',
            '',
            'STRICT RULES:',
            '- You are NOT permitted to give investment advice, a buy/sell/hold recommendation, a',
            '  price target, or a projected return. If the data would tempt you to, describe the',
            '  condition instead of recommending an action.',
            '- Base every statement only on the figures provided. Never invent prices, levels,',
            '  dates, fundamentals or news. If a figure is missing, say it is unavailable.',
            '- Present the opposing case with equal weight. Do not argue for one outcome.',
            '- Use neutral, precise language. Do not write "I think", "I feel", "clearly",',
            '  "obviously", or "strong buy".',
            '- Never claim a probability you cannot derive from the supplied figures.',
            '',
            'Follow this sequence, using the supplied values:',
            '1. Trend — direction and whether it is strengthening or fading, from the moving',
            '   averages and their relationship to price.',
            '2. Levels — the 20-day high/low given, and what they represent structurally.',
            '3. Momentum — what RSI and MACD say, and whether they agree with the trend.',
            '4. Volume — whether volume confirms or contradicts the price move.',
            '5. Synthesis — which conditions the asset meets, and which it does not.',
            '6. Invalidation — the specific price level or condition that would show this read is',
            '   wrong. This is mandatory and must reference a supplied figure.',
            '',
            'FORMAT (plain text, no markdown headings, max 170 words):',
            'Setup: <one sentence>',
            'Evidence: <two or three sentences covering trend, momentum and volume>',
            'Against: <one sentence giving the strongest opposing reading>',
            'Invalidation: <the level or condition, referencing a supplied figure>',
        ].join('\n'),
    },
    {
        id: 'plain',
        name: 'Plain summary',
        description: 'A short, unstructured explanation with no analytical framework.',
        temperature: 0.7,
        system: [
            'You explain a rule-based technical screen to a retail investor in under 90 words.',
            'Do not give investment advice, a recommendation, or a price target.',
            'Start with one sentence summarising the setup, then one sentence on the main risk.',
        ].join('\n'),
    },
];

export const DEFAULT_TRADER_FRAMEWORK: TraderFrameworkId = 'technical-analyst';

export function isTraderFrameworkId(value: string | undefined): value is TraderFrameworkId {
    return Boolean(value && TRADER_FRAMEWORKS.some((f) => f.id === value));
}

export function getTraderFramework(id?: string): TraderFramework {
    if (isTraderFrameworkId(id)) {
        return TRADER_FRAMEWORKS.find((f) => f.id === id)!;
    }
    return TRADER_FRAMEWORKS.find((f) => f.id === DEFAULT_TRADER_FRAMEWORK)!;
}

export interface CandidatePromptInput {
    symbol: string;
    assetType: 'stock' | 'crypto';
    strategyName: string;
    strategySummary: string;
    bundle: IndicatorBundle;
    passed: Criterion[];
    failed: Criterion[];
    matched: number;
    total: number;
}

function fmt(value: number | null | undefined, digits = 2, suffix = ''): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'unavailable';
    return `${value.toFixed(digits)}${suffix}`;
}

/**
 * The user-role prompt: every figure the model is allowed to reason from. Kept explicit
 * so the model cannot invent levels, and so the analyst framework has real inputs for its
 * mandatory invalidation level.
 */
export function buildCandidatePrompt(input: CandidatePromptInput): string {
    const { bundle, strategyName, strategySummary, symbol, assetType, passed, failed, matched, total } = input;

    return [
        `Asset: ${symbol} (${assetType})`,
        `Strategy applied: ${strategyName} — ${strategySummary}`,
        `Conditions met: ${matched} of ${total}`,
        '',
        'Measured indicators (daily bars):',
        `  Price: ${fmt(bundle.price)}`,
        `  SMA50: ${fmt(bundle.sma50)}`,
        `  SMA200: ${fmt(bundle.sma200)}`,
        `  SMA200 20 bars ago: ${fmt(bundle.sma200Prior)}`,
        `  RSI(14): ${fmt(bundle.rsi14, 1)}`,
        `  MACD line: ${fmt(bundle.macd?.macd, 4)}`,
        `  MACD signal: ${fmt(bundle.macd?.signal, 4)}`,
        `  MACD histogram: ${fmt(bundle.macd?.histogram, 4)}`,
        `  20-bar high: ${fmt(bundle.high20)}`,
        `  20-bar low: ${fmt(bundle.low20)}`,
        `  Latest volume: ${fmt(bundle.latestVolume, 0)}`,
        `  20-bar average volume: ${fmt(bundle.avgVolume20, 0)}`,
        `  5-bar change: ${fmt(bundle.change5d, 2, '%')}`,
        `  30-bar change: ${fmt(bundle.change30d, 2, '%')}`,
        `  Max drawdown over the window: ${fmt(bundle.maxDrawdown, 2, '%')}`,
        `  Daily volatility (stdev of returns): ${fmt(bundle.volatility, 2, '%')}`,
        `  Bars of history: ${bundle.bars}`,
        '',
        'Conditions met:',
        ...(passed.length > 0 ? passed.map((c) => `  MET: ${c.label} — ${c.detail}`) : ['  (none)']),
        'Conditions not met:',
        ...(failed.length > 0 ? failed.map((c) => `  NOT MET: ${c.label} — ${c.detail}`) : ['  (none)']),
        '',
        'Explain this screen result using only the figures above.',
    ].join('\n');
}
