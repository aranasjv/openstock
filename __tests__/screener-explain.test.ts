import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TRADER_FRAMEWORKS } from '@/lib/trading-framework';
import type { Candle } from '@/lib/indicators';

/**
 * Wiring test for explainCandidate: proves the framework selected in settings actually
 * reaches the provider as the system prompt, and that a change of framework changes it.
 *
 * The data source and the provider are both stubbed, so this exercises the real
 * explainCandidate logic (indicator computation, strategy run, prompt assembly) without
 * needing a live market API or a live model.
 */

const priceHistory = vi.fn();

vi.mock('@/lib/actions/crypto.actions', () => ({
  getCryptoPriceHistory: (coinId: string) => priceHistory(coinId),
  getCryptoMarkets: async () => [],
}));

const providerCall = vi.fn();

vi.mock('@/lib/ai-provider', () => ({
  callAIProvider: (prompt: string, provider?: string, options?: unknown) =>
    providerCall(prompt, provider, options),
}));

let configValues: Record<string, string> = {};

vi.mock('@/lib/config', () => ({
  loadConfig: async () => configValues,
  getConfigNumber: async (_key: string, fallback: number) => fallback,
}));

import { explainCandidate } from '@/lib/actions/screener.actions';

/** A long uptrend so every indicator is computable. */
function uptrendCandles(): Candle[] {
  return Array.from({ length: 260 }, (_, i) => {
    const c = 100 + i * 0.5;
    return { t: 1_700_000_000 + i * 86_400, o: c, h: c, l: c, c, v: 100 };
  });
}

describe('explainCandidate framework wiring', () => {
  beforeEach(() => {
    providerCall.mockReset();
    priceHistory.mockReset();
    providerCall.mockResolvedValue('Setup: test.\nEvidence: test.\nAgainst: test.\nInvalidation: test.');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sends the structured framework as the system prompt', async () => {
    priceHistory.mockResolvedValue(uptrendCandles());
    configValues = { AI_PROVIDER: 'deepseek', TRADER_FRAMEWORK: 'technical-analyst' };

    const result = await explainCandidate('crypto', 'bitcoin', 'trend-following');

    expect(result.ok).toBe(true);
    expect(providerCall).toHaveBeenCalledTimes(1);

    const [prompt, provider, options] = providerCall.mock.calls[0];
    const structured = TRADER_FRAMEWORKS.find((f) => f.id === 'technical-analyst')!;

    expect(provider).toBe('deepseek');
    expect(options.system).toBe(structured.system);
    expect(options.temperature).toBe(structured.temperature);
    // The user prompt carries the measured figures.
    expect(prompt).toContain('RSI(14)');
    expect(prompt).toContain('bitcoin (crypto)');
  });

  it('switches the system prompt when the framework setting changes', async () => {
    priceHistory.mockResolvedValue(uptrendCandles());
    configValues = { AI_PROVIDER: 'deepseek', TRADER_FRAMEWORK: 'plain' };

    await explainCandidate('crypto', 'bitcoin', 'trend-following');

    const structured = TRADER_FRAMEWORKS.find((f) => f.id === 'technical-analyst')!;
    const plain = TRADER_FRAMEWORKS.find((f) => f.id === 'plain')!;
    const [, , options] = providerCall.mock.calls[0];

    expect(options.system).toBe(plain.system);
    expect(options.system).not.toBe(structured.system);
  });

  it('defaults to the structured framework when unset', async () => {
    priceHistory.mockResolvedValue(uptrendCandles());
    configValues = { AI_PROVIDER: 'deepseek' };

    await explainCandidate('crypto', 'bitcoin', 'momentum');

    const structured = TRADER_FRAMEWORKS.find((f) => f.id === 'technical-analyst')!;
    const [, , options] = providerCall.mock.calls[0];
    expect(options.system).toBe(structured.system);
  });

  it('reports the framework and provider back for display', async () => {
    priceHistory.mockResolvedValue(uptrendCandles());
    configValues = { AI_PROVIDER: 'deepseek', TRADER_FRAMEWORK: 'technical-analyst' };

    const result = await explainCandidate('crypto', 'bitcoin', 'trend-following');

    expect(result.provider).toBe('deepseek');
    expect(result.framework).toContain('Technical Analyst');
  });

  it('does not call the provider when there is no price history', async () => {
    priceHistory.mockResolvedValue(null);
    configValues = { AI_PROVIDER: 'deepseek' };

    const result = await explainCandidate('crypto', 'missing', 'trend-following');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('No price history');
    expect(providerCall).not.toHaveBeenCalled();
  });

  it('does not call the provider when history is too short to analyse', async () => {
    priceHistory.mockResolvedValue(uptrendCandles().slice(0, 10));
    configValues = { AI_PROVIDER: 'deepseek' };

    const result = await explainCandidate('crypto', 'newcoin', 'trend-following');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Not enough history');
    expect(providerCall).not.toHaveBeenCalled();
  });

  it('surfaces a provider failure as an error rather than throwing', async () => {
    priceHistory.mockResolvedValue(uptrendCandles());
    configValues = { AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: '' };
    providerCall.mockRejectedValue(new Error('DEEPSEEK_API_KEY is not set'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await explainCandidate('crypto', 'bitcoin', 'trend-following');
    consoleSpy.mockRestore();

    expect(result.ok).toBe(false);
    expect(result.error).toContain('DEEPSEEK_API_KEY is not set');
  });
});
