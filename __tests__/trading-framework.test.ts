import { describe, it, expect } from 'vitest';
import {
  TRADER_FRAMEWORKS,
  getTraderFramework,
  isTraderFrameworkId,
  buildCandidatePrompt,
  DEFAULT_TRADER_FRAMEWORK,
} from '@/lib/trading-framework';
import type { IndicatorBundle } from '@/lib/indicators';
import { computeIndicators, type Candle } from '@/lib/indicators';
import { runStrategy } from '@/lib/strategies';

function bundleFor(closes: number[], volume = 100): IndicatorBundle {
  const candles: Candle[] = closes.map((c, i) => ({
    t: 1_700_000_000 + i * 86_400,
    o: c,
    h: c,
    l: c,
    c,
    v: volume,
  }));
  return computeIndicators(candles)!;
}

const uptrend = () => Array.from({ length: 260 }, (_, i) => 100 + i * 0.5);

describe('framework registry', () => {
  it('exposes both frameworks with the structured one as default', () => {
    expect(TRADER_FRAMEWORKS.map((f) => f.id)).toEqual(['technical-analyst', 'plain']);
    expect(DEFAULT_TRADER_FRAMEWORK).toBe('technical-analyst');
  });

  it('validates ids and falls back to the default', () => {
    expect(isTraderFrameworkId('plain')).toBe(true);
    expect(isTraderFrameworkId('nope')).toBe(false);
    expect(isTraderFrameworkId(undefined)).toBe(false);
    expect(getTraderFramework('nope').id).toBe('technical-analyst');
    expect(getTraderFramework(undefined).id).toBe('technical-analyst');
  });
});

describe('the analyst framework encodes the skill methodology', () => {
  const system = getTraderFramework('technical-analyst').system;

  it('forbids advice and price targets', () => {
    expect(system).toMatch(/NOT permitted to give investment advice/i);
    expect(system).toMatch(/price target/i);
  });

  it('requires an opposing case, to counter confirmation bias', () => {
    expect(system).toMatch(/opposing case/i);
    expect(system).toMatch(/Against:/);
  });

  it('requires an invalidation level', () => {
    expect(system).toMatch(/Invalidation:/);
    expect(system).toMatch(/mandatory/i);
  });

  it('bans subjective language', () => {
    expect(system).toMatch(/I think/);
    expect(system).toMatch(/neutral, precise language/i);
  });

  it('forbids inventing data', () => {
    expect(system).toMatch(/Never invent/i);
  });

  it('runs cooler than the plain framework, for reproducibility', () => {
    const structured = getTraderFramework('technical-analyst').temperature;
    const plain = getTraderFramework('plain').temperature;
    expect(structured).toBeLessThan(plain);
  });
});

describe('buildCandidatePrompt', () => {
  const bundle = bundleFor(uptrend());
  const result = runStrategy(bundle, 'trend-following');

  const prompt = buildCandidatePrompt({
    symbol: 'TEST',
    assetType: 'stock',
    strategyName: 'Trend Following',
    strategySummary: 'Established uptrend.',
    bundle,
    passed: result.passed,
    failed: result.failed,
    matched: result.matched,
    total: result.total,
  });

  it('includes the asset and strategy', () => {
    expect(prompt).toContain('TEST (stock)');
    expect(prompt).toContain('Trend Following');
    expect(prompt).toContain(`${result.matched} of ${result.total}`);
  });

  it('supplies every figure the analyst sequence refers to', () => {
    for (const label of ['SMA50', 'SMA200', 'RSI(14)', 'MACD line', '20-bar high', '20-bar low', '20-bar average volume']) {
      expect(prompt).toContain(label);
    }
  });

  it('lists met and unmet conditions separately', () => {
    expect(prompt).toContain('Conditions met:');
    expect(prompt).toContain('Conditions not met:');
    expect(prompt).toContain('MET:');
  });

  it('renders unavailable values rather than NaN or undefined', () => {
    const short = bundleFor(Array.from({ length: 40 }, (_, i) => 100 + i));
    const shortResult = runStrategy(short, 'trend-following');
    const shortPrompt = buildCandidatePrompt({
      symbol: 'SHORT',
      assetType: 'crypto',
      strategyName: 'Trend Following',
      strategySummary: 'x',
      bundle: short,
      passed: shortResult.passed,
      failed: shortResult.failed,
      matched: shortResult.matched,
      total: shortResult.total,
    });
    expect(shortPrompt).not.toContain('NaN');
    expect(shortPrompt).not.toContain('undefined');
    expect(shortPrompt).toContain('unavailable');
  });

  it('reports when nothing was met', () => {
    const down = bundleFor(Array.from({ length: 260 }, (_, i) => 250 - i * 0.5));
    const downResult = runStrategy(down, 'trend-following');
    const downPrompt = buildCandidatePrompt({
      symbol: 'DOWN',
      assetType: 'stock',
      strategyName: 'Trend Following',
      strategySummary: 'x',
      bundle: down,
      passed: downResult.passed,
      failed: downResult.failed,
      matched: downResult.matched,
      total: downResult.total,
    });
    expect(downPrompt).toContain('(none)');
  });
});
