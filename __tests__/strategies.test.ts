import { describe, it, expect } from 'vitest';
import { computeIndicators, type Candle } from '@/lib/indicators';
import {
  STRATEGIES,
  runStrategy,
  getStrategy,
  isStrategyId,
  DEFAULT_STRATEGY_ID,
  type StrategyId,
} from '@/lib/strategies';

function series(closes: number[], volume: number | number[] = 100): Candle[] {
  return closes.map((c, i) => ({
    t: 1_700_000_000 + i * 86_400,
    o: c,
    h: c,
    l: c,
    c,
    v: Array.isArray(volume) ? volume[i] : volume,
  }));
}

/** Steady uptrend long enough for the 200-day average to exist. */
const uptrend = () => Array.from({ length: 260 }, (_, i) => 100 + i * 0.5);
/** Steady downtrend. */
const downtrend = () => Array.from({ length: 260 }, (_, i) => 250 - i * 0.5);

describe('strategy registry', () => {
  it('exposes the five configured strategies', () => {
    expect(STRATEGIES.map((s) => s.id)).toEqual([
      'trend-following',
      'momentum',
      'oversold-pullback',
      'breakout',
      'mean-reversion',
    ]);
  });

  it('validates ids and falls back to the default', () => {
    expect(isStrategyId('momentum')).toBe(true);
    expect(isStrategyId('nonsense')).toBe(false);
    expect(isStrategyId(undefined)).toBe(false);
    expect(getStrategy('nonsense').id).toBe(DEFAULT_STRATEGY_ID);
    expect(getStrategy(undefined).id).toBe(DEFAULT_STRATEGY_ID);
  });

  it('every strategy returns three labelled criteria', () => {
    const bundle = computeIndicators(series(uptrend()))!;
    for (const strategy of STRATEGIES) {
      const criteria = strategy.evaluate(bundle);
      expect(criteria).toHaveLength(3);
      for (const criterion of criteria) {
        expect(typeof criterion.label).toBe('string');
        expect(criterion.label.length).toBeGreaterThan(0);
        expect(typeof criterion.passed).toBe('boolean');
        expect(typeof criterion.detail).toBe('string');
      }
    }
  });
});

describe('relative strength', () => {
  const bundle = () => computeIndicators(series(uptrend()))!;

  it('adds no criterion when the run has no benchmark', () => {
    // Backwards compatible on purpose: with no reference there is nothing to be relative to, and a
    // fabricated pass or fail would blame the asset for a data gap that is not its own.
    const criteria = getStrategy('trend-following').evaluate(bundle());
    expect(criteria).toHaveLength(3);
    expect(criteria.some((c) => c.label.includes('30 days'))).toBe(false);
  });

  it('adds exactly one criterion when a benchmark is supplied', () => {
    const criteria = getStrategy('trend-following').evaluate(bundle(), { symbol: 'SPY', change30d: 1 });
    expect(criteria).toHaveLength(4);
    expect(criteria[3].label).toContain('SPY');
  });

  it('passes when the asset leads and fails when it lags', () => {
    const asset = bundle();
    const behind = asset.change30d! - 5;
    const ahead = asset.change30d! + 5;

    expect(getStrategy('momentum').evaluate(asset, { symbol: 'SPY', change30d: behind })[3].passed).toBe(true);
    expect(getStrategy('momentum').evaluate(asset, { symbol: 'SPY', change30d: ahead })[3].passed).toBe(false);
  });

  it('states the spread, not just the verdict', () => {
    const criterion = getStrategy('momentum').evaluate(bundle(), { symbol: 'BTC', change30d: 2.5 })[3];
    expect(criterion.detail).toContain('vs +2.5% BTC');
    expect(criterion.detail).toContain('pt');
  });

  it('lowers the score when the same asset lags its benchmark', () => {
    const asset = bundle();
    const alone = runStrategy(asset, 'momentum');
    const lagging = runStrategy(asset, 'momentum', { symbol: 'SPY', change30d: asset.change30d! + 50 });

    // One extra criterion, not met: the denominator grows and the numerator does not.
    expect(lagging.total).toBe(alone.total + 1);
    expect(lagging.matched).toBe(alone.matched);
    expect(lagging.score).toBeLessThan(alone.score);
  });
});

describe('scoring', () => {
  it('is 100 and "Strong" when every criterion passes', () => {
    const bundle = computeIndicators(series(uptrend()))!;
    const result = runStrategy(bundle, 'trend-following');
    expect(result.matched).toBe(3);
    expect(result.total).toBe(3);
    expect(result.score).toBe(100);
    expect(result.tier).toBe('Strong');
    expect(result.failed).toHaveLength(0);
  });

  it('is 0 for a downtrend under trend-following', () => {
    const bundle = computeIndicators(series(downtrend()))!;
    const result = runStrategy(bundle, 'trend-following');
    expect(result.matched).toBe(0);
    expect(result.score).toBe(0);
    expect(result.tier).toBe('Watch');
    expect(result.passed).toHaveLength(0);
  });

  it('splits criteria into passed and failed with no overlap', () => {
    const bundle = computeIndicators(series(downtrend()))!;
    const result = runStrategy(bundle, 'momentum');
    expect(result.passed.length + result.failed.length).toBe(result.total);
    expect(result.matched).toBe(result.passed.length);
  });

  it('maps score to tier at the documented boundaries', () => {
    // 3 of 3 -> Strong, 2 of 3 -> Moderate (67), 1 of 3 -> Watch (33)
    const bundle = computeIndicators(series(uptrend()))!;

    const strong = runStrategy(bundle, 'trend-following');
    expect(strong.tier).toBe('Strong');

    const partial = { ...bundle, rsi14: 55, macd: null };
    const moderate = runStrategy(partial, 'momentum');
    // MACD unverifiable + RSI in band + price above SMA50 => 2 of 3
    expect(moderate.score).toBe(67);
    expect(moderate.tier).toBe('Moderate');
  });
});

describe('strategy behaviour on constructed data', () => {
  it('flags an oversold pullback inside an uptrend', () => {
    // Long uptrend, then a sharp multi-day dip: RSI low, price still above the 200-day.
    const closes = [...uptrend(), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => 230 - i * 4)];
    const bundle = computeIndicators(series(closes))!;

    expect(bundle.rsi14!).toBeLessThan(40);
    const result = runStrategy(bundle, 'oversold-pullback');
    expect(result.passed.some((c) => c.label.startsWith('RSI'))).toBe(true);
  });

  it('flags a breakout on a new high with a volume spike', () => {
    const closes = [...Array.from({ length: 60 }, () => 100), 130];
    const volumes = [...Array.from({ length: 60 }, () => 100), 500];
    const bundle = computeIndicators(series(closes, volumes))!;

    const result = runStrategy(bundle, 'breakout');
    const highCheck = result.passed.find((c) => c.label.includes('20-day high'));
    const volumeCheck = result.passed.find((c) => c.label.includes('Volume'));
    expect(highCheck).toBeDefined();
    expect(volumeCheck).toBeDefined();
    expect(result.score).toBe(100);
  });

  it('does not flag a breakout when volume is unremarkable', () => {
    const closes = [...Array.from({ length: 60 }, () => 100), 130];
    const bundle = computeIndicators(series(closes, 100))!;
    const result = runStrategy(bundle, 'breakout');
    expect(result.passed.some((c) => c.label.includes('Volume'))).toBe(false);
  });

  it('flags mean reversion when far below the 200-day average', () => {
    const closes = [...Array.from({ length: 240 }, () => 200), 120, 118];
    const bundle = computeIndicators(series(closes))!;
    const result = runStrategy(bundle, 'mean-reversion');
    expect(result.passed.some((c) => c.label.includes('200-day average'))).toBe(true);
  });

  it('excludes a collapse from mean reversion', () => {
    // Down >20% in five days should fail the "not in free-fall" guard.
    const closes = [...Array.from({ length: 240 }, () => 200), 150, 120, 100, 90, 80];
    const bundle = computeIndicators(series(closes))!;
    const result = runStrategy(bundle, 'mean-reversion');
    const guard = result.failed.find((c) => c.label.includes('5 days'));
    expect(guard).toBeDefined();
  });
});

describe('insufficient history', () => {
  it('treats unverifiable criteria as not met rather than throwing', () => {
    // 40 bars: enough for RSI and SMA-ish maths, not for SMA200.
    const short = Array.from({ length: 40 }, (_, i) => 100 + i);
    const bundle = computeIndicators(series(short))!;
    expect(bundle.sma200).toBeNull();

    const result = runStrategy(bundle, 'trend-following');
    expect(result.score).toBe(0);
    expect(result.failed).toHaveLength(3);
  });

  it('counts a null MACD as failing rather than passing', () => {
    const short = Array.from({ length: 32 }, (_, i) => 100 + i);
    const bundle = computeIndicators(series(short))!;
    expect(bundle.macd).toBeNull();

    const result = runStrategy(bundle, 'momentum');
    expect(result.failed.some((c) => c.label.includes('MACD'))).toBe(true);
  });
});

describe('all strategies run without throwing', () => {
  const cases: [string, number[]][] = [
    ['uptrend', uptrend()],
    ['downtrend', downtrend()],
    ['flat', Array.from({ length: 260 }, () => 100)],
    ['volatile', Array.from({ length: 260 }, (_, i) => 100 + Math.sin(i / 3) * 25)],
  ];

  for (const [name, closes] of cases) {
    it(`handles a ${name} series`, () => {
      const bundle = computeIndicators(series(closes));
      expect(bundle).not.toBeNull();

      for (const strategy of STRATEGIES) {
        const result = runStrategy(bundle!, strategy.id as StrategyId);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
        expect(['Strong', 'Moderate', 'Watch']).toContain(result.tier);
      }
    });
  }
});
