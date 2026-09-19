import { describe, it, expect } from 'vitest';
import {
  sma,
  ema,
  rsi14,
  macd,
  rollingMax,
  rollingMin,
  averageVolumePrior,
  pctChange,
  maxDrawdown,
  volatility,
  computeIndicators,
  type Candle,
} from '@/lib/indicators';

/** Build a candle series from closes, with synthetic volume. */
function series(closes: number[], volume = 100): Candle[] {
  return closes.map((c, i) => ({
    t: 1_700_000_000 + i * 86_400,
    o: c,
    h: c,
    l: c,
    c,
    v: volume,
  }));
}

describe('sma', () => {
  it('averages the most recent window', () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([1, 2, 3, 4, 5], 2)).toBe(4.5);
  });

  it('returns null when the window exceeds the data', () => {
    expect(sma([1, 2, 3], 5)).toBeNull();
  });

  it('is the constant itself for a flat series', () => {
    expect(sma([7, 7, 7, 7], 4)).toBe(7);
  });
});

describe('ema', () => {
  it('returns the SMA seed when the series is exactly one period long', () => {
    expect(ema([1, 2, 3], 3)).toBe(2);
  });

  it('applies k = 2/(period+1) to the next value', () => {
    // Seed = mean(1,2,3) = 2; k = 2/4 = 0.5; next value 4 -> 4*0.5 + 2*0.5 = 3
    expect(ema([1, 2, 3, 4], 3)).toBeCloseTo(3, 10);
  });

  it('equals the constant for a flat series', () => {
    expect(ema([5, 5, 5, 5, 5], 3)).toBeCloseTo(5, 10);
  });

  it('returns null with insufficient data', () => {
    expect(ema([1, 2], 5)).toBeNull();
  });
});

describe('rsi14', () => {
  it('matches a hand-computed Wilder value', () => {
    // values 10,11,12,11,10,11 with period 3:
    //   seed changes: +1 +1 -1  -> avgGain 2/3, avgLoss 1/3
    //   -1 -> avgGain 4/9,  avgLoss 5/9
    //   +1 -> avgGain 17/27, avgLoss 10/27
    //   RS = 1.7 -> RSI = 100 - 100/2.7
    const value = rsi14([10, 11, 12, 11, 10, 11], 3);
    expect(value).toBeCloseTo(100 - 100 / 2.7, 10);
  });

  it('is 100 for a monotonically rising series', () => {
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi14(rising, 14)).toBe(100);
  });

  it('is 0 for a monotonically falling series', () => {
    const falling = Array.from({ length: 30 }, (_, i) => 200 - i);
    expect(rsi14(falling, 14)).toBe(0);
  });

  it('is neutral (50) for a flat series', () => {
    const flat = Array.from({ length: 30 }, () => 42);
    expect(rsi14(flat, 14)).toBe(50);
  });

  it('stays within 0-100', () => {
    const noisy = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 10);
    const value = rsi14(noisy, 14);
    expect(value).not.toBeNull();
    expect(value!).toBeGreaterThanOrEqual(0);
    expect(value!).toBeLessThanOrEqual(100);
  });

  it('returns null with insufficient data', () => {
    expect(rsi14([1, 2, 3], 14)).toBeNull();
  });
});

describe('macd', () => {
  it('returns null when the series is too short', () => {
    expect(macd([1, 2, 3], 12, 26, 9)).toBeNull();
  });

  it('produces a positive histogram for a rising series', () => {
    const rising = Array.from({ length: 80 }, (_, i) => 100 + i * 2);
    const result = macd(rising);
    expect(result).not.toBeNull();
    expect(result!.macd).toBeGreaterThan(0);
    expect(result!.histogram).toBeCloseTo(result!.macd - result!.signal, 10);
  });

  it('produces a negative MACD for a falling series', () => {
    const falling = Array.from({ length: 80 }, (_, i) => 300 - i * 2);
    const result = macd(falling);
    expect(result).not.toBeNull();
    expect(result!.macd).toBeLessThan(0);
  });

  it('is ~0 for a flat series', () => {
    const flat = Array.from({ length: 80 }, () => 50);
    const result = macd(flat);
    expect(result).not.toBeNull();
    expect(result!.macd).toBeCloseTo(0, 8);
    expect(result!.signal).toBeCloseTo(0, 8);
  });
});

describe('rolling max / min', () => {
  it('finds the extremes of the trailing window only', () => {
    const values = [1, 99, 3, 4, 5];
    expect(rollingMax(values, 3)).toBe(5);
    expect(rollingMin(values, 3)).toBe(3);
  });

  it('returns null when the window is too large', () => {
    expect(rollingMax([1, 2], 5)).toBeNull();
    expect(rollingMin([1, 2], 5)).toBeNull();
  });
});

describe('averageVolumePrior', () => {
  it('excludes the most recent bar so a spike cannot mask itself', () => {
    // Last value is a spike; the average must ignore it.
    const volumes = [10, 10, 10, 10, 1000];
    expect(averageVolumePrior(volumes, 4)).toBe(10);
  });

  it('returns null without enough history', () => {
    expect(averageVolumePrior([1, 2], 5)).toBeNull();
  });
});

describe('pctChange', () => {
  it('computes percentage change over the window', () => {
    expect(pctChange([100, 110], 1)).toBeCloseTo(10, 10);
    expect(pctChange([100, 90], 1)).toBeCloseTo(-10, 10);
  });

  it('returns null when the window exceeds the data', () => {
    expect(pctChange([100], 5)).toBeNull();
  });

  it('returns null when the starting value is zero', () => {
    expect(pctChange([0, 10], 1)).toBeNull();
  });
});

describe('maxDrawdown', () => {
  it('measures the largest peak-to-trough decline', () => {
    // peak 100 -> trough 50 = 50%
    expect(maxDrawdown([100, 120, 60, 80])).toBeCloseTo(50, 10);
  });

  it('is 0 for a monotonically rising series', () => {
    expect(maxDrawdown([1, 2, 3, 4])).toBe(0);
  });

  it('returns null for a single point', () => {
    expect(maxDrawdown([5])).toBeNull();
  });
});

describe('volatility', () => {
  it('is 0 for a flat series', () => {
    expect(volatility([10, 10, 10, 10])).toBeCloseTo(0, 10);
  });

  it('is greater for a noisier series', () => {
    const calm = [100, 100.5, 100, 100.5, 100];
    const wild = [100, 120, 90, 130, 80];
    expect(volatility(wild)!).toBeGreaterThan(volatility(calm)!);
  });

  it('returns null with insufficient data', () => {
    expect(volatility([1])).toBeNull();
  });
});

describe('computeIndicators', () => {
  it('returns null for a series that is too short to analyse', () => {
    expect(computeIndicators(series([1, 2, 3]))).toBeNull();
  });

  it('computes the expected fields for a long rising series', () => {
    const closes = Array.from({ length: 260 }, (_, i) => 100 + i);
    const bundle = computeIndicators(series(closes));

    expect(bundle).not.toBeNull();
    expect(bundle!.bars).toBe(260);
    expect(bundle!.price).toBe(closes[closes.length - 1]);
    expect(bundle!.sma50).not.toBeNull();
    expect(bundle!.sma200).not.toBeNull();
    // In an uptrend the average of the last 50 sits above the last 200.
    expect(bundle!.sma50!).toBeGreaterThan(bundle!.sma200!);
    expect(bundle!.rsi14).toBeCloseTo(100, 5);
    expect(bundle!.change30d!).toBeGreaterThan(0);
    expect(bundle!.maxDrawdown).toBe(0);
  });

  it('exposes a moving SMA200 for the uptrend check', () => {
    const closes = Array.from({ length: 240 }, (_, i) => 100 + i);
    const bundle = computeIndicators(series(closes));
    expect(bundle!.sma200Prior).not.toBeNull();
    // Rising series: the earlier average must be lower.
    expect(bundle!.sma200!).toBeGreaterThan(bundle!.sma200Prior!);
  });
});
