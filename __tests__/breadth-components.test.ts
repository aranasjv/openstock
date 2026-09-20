import { describe, it, expect } from 'vitest';
import type { BreadthRow } from '@/lib/breadth-csv';
import {
    assessBreadth,
    bearishSignalStatus,
    breadthLevelTrend,
    cyclePosition,
    divergence,
    historicalPercentile,
    maCrossover,
    roundHalfEven,
} from '@/lib/breadth-components';

const DAY = (index: number) =>
    `2025-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`;

function row(overrides: Partial<BreadthRow> = {}): BreadthRow {
    return {
        date: '2025-01-01',
        sp500: 100,
        breadthRaw: 0.5,
        breadth200Ma: 0.5,
        breadth8Ma: 0.5,
        breadth200MaTrend: 1,
        bearishSignal: false,
        isPeak: false,
        isTrough: false,
        isTrough8MaBelow04: false,
        breadth50Raw: 0.5,
        breadth50Ma: 0.5,
        breadth50MaTrend: 1,
        isPeak50: false,
        isTrough50: false,
        ...overrides,
    };
}

const repeat = (count: number, overrides: Partial<BreadthRow> = {}) =>
    Array.from({ length: count }, (_, index) => row({ date: DAY(index), ...overrides }));

describe('roundHalfEven', () => {
    it('matches Python round() on exact halves, which is where Math.round differs', () => {
        expect(roundHalfEven(90.5)).toBe(90);
        expect(roundHalfEven(30.5)).toBe(30);
        expect(roundHalfEven(29.5)).toBe(30);
        expect(roundHalfEven(0.5)).toBe(0);
        expect(roundHalfEven(1.5)).toBe(2);
        // Everything off a half agrees with Math.round, so only the ties needed handling.
        expect(roundHalfEven(90.51)).toBe(91);
        expect(roundHalfEven(90.49)).toBe(90);
    });
});

describe('breadthLevelTrend (C1)', () => {
    it('rounds the weighted base half-to-even, not half-up', () => {
        // 0.70 × 95 + 0.30 × 80 = 90.5. Math.round would say 91; the skill says 90.
        const result = breadthLevelTrend(repeat(1, { breadth8Ma: 0.75, breadth200MaTrend: 1 }));

        expect(result.score).toBe(90);
    });

    it('maps the 8MA level bands', () => {
        const at = (value: number) => breadthLevelTrend(repeat(1, { breadth8Ma: value, breadth200MaTrend: 1 }))!.score;

        // The trend half contributes a flat 0.30 × 80 to every one of these, which is why the low
        // bands sit well above their level score alone.
        expect(at(0.75)).toBe(90); // half-to-even of 0.70×95 + 0.30×80 = 90.5
        expect(at(0.65)).toBe(80); // 0.70×80 + 0.30×80
        expect(at(0.45)).toBe(59); // 0.70×50 + 0.30×80
        expect(at(0.25)).toBe(38); // 0.70×20 + 0.30×80
    });

    it('penalises a falling 8MA from a high level and rewards a rising one from a low', () => {
        const fallingHigh = repeat(6, { breadth8Ma: 0.65, breadth200MaTrend: 1 });
        fallingHigh[0] = row({ date: DAY(0), breadth8Ma: 0.72, breadth200MaTrend: 1 });
        expect(breadthLevelTrend(fallingHigh).detail.direction_modifier).toBe(-10);

        const risingLow = repeat(6, { breadth8Ma: 0.35, breadth200MaTrend: 1 });
        risingLow[0] = row({ date: DAY(0), breadth8Ma: 0.3, breadth200MaTrend: 1 });
        expect(breadthLevelTrend(risingLow).detail.direction_modifier).toBe(5);
    });

    it('treats a missing 200-day trend as a downtrend, as the reference does', () => {
        const result = breadthLevelTrend(repeat(1, { breadth8Ma: 0.75, breadth200MaTrend: null }));
        expect(result.detail.trend_score).toBe(20);
    });

    it('is unavailable without data', () => {
        expect(breadthLevelTrend([]).score).toBeNull();
        expect(breadthLevelTrend([row({ breadth8Ma: null })]).score).toBeNull();
    });
});

describe('maCrossover (C2)', () => {
    it('scores the gap and flags a recovery below the 200MA', () => {
        // 0.62 − 0.50 rather than 0.60 − 0.50: in binary floating point the latter is
        // 0.09999999999999998, which falls just under the `>= 0.10` band and scores 65. The reference
        // behaves identically, so the fixture moves rather than the band — and the band edge being
        // unreachable from two round decimals is worth knowing before "fixing" it.
        const rising = repeat(6, { breadth8Ma: 0.62, breadth200Ma: 0.5 });
        rising[0] = row({ date: DAY(0), breadth8Ma: 0.55, breadth200Ma: 0.5 });

        const healthy = maCrossover(rising);
        expect(healthy.detail.gap_score).toBe(80); // gap +0.12
        expect(healthy.detail.direction_modifier).toBe(0); // above, and rising is not a penalty here

        // Below the 200MA but rising: the reference's recovery signal, worth +10.
        const recovering = repeat(6, { breadth8Ma: 0.44, breadth200Ma: 0.5 });
        recovering[0] = row({ date: DAY(0), breadth8Ma: 0.4, breadth200Ma: 0.5 });
        expect(maCrossover(recovering).detail.direction_modifier).toBe(10);
    });

    it('penalises a falling 8MA while still above the 200MA', () => {
        const deteriorating = repeat(6, { breadth8Ma: 0.56, breadth200Ma: 0.5 });
        deteriorating[0] = row({ date: DAY(0), breadth8Ma: 0.6, breadth200Ma: 0.5 });

        expect(maCrossover(deteriorating).detail.direction_modifier).toBe(-10);
    });

    it('needs six rows, because the direction read is a five-day lookback', () => {
        expect(maCrossover(repeat(5)).score).toBeNull();
        expect(maCrossover(repeat(6)).score).not.toBeNull();
    });
});

describe('cyclePosition (C3)', () => {
    it('scores an early trough on whether the 8MA is rising', () => {
        const rising = repeat(20, { breadth8Ma: 0.5, breadth200MaTrend: -1 });
        rising[14] = row({ date: DAY(14), isTrough: true, breadth8Ma: 0.4 });
        rising[19] = row({ date: DAY(19), breadth8Ma: 0.6 }); // last six rising

        const result = cyclePosition(rising);
        expect(result.detail.days_since_marker).toBe(5);
        expect(result.score).toBe(85);
    });

    it('adds the contrarian bonus for an extreme trough', () => {
        const extreme = repeat(20, { breadth8Ma: 0.5 });
        extreme[14] = row({ date: DAY(14), isTrough8MaBelow04: true, breadth8Ma: 0.3 });
        extreme[19] = row({ date: DAY(19), breadth8Ma: 0.6 });

        expect(cyclePosition(extreme).score).toBe(95);
        expect(cyclePosition(extreme).detail.extreme_trough).toBe(true);
    });

    it('calls a failed reversal what it is rather than a recovery', () => {
        const falling = repeat(20, { breadth8Ma: 0.4 });
        falling[14] = row({ date: DAY(14), isTrough: true, breadth8Ma: 0.5 });
        falling[19] = row({ date: DAY(19), breadth8Ma: 0.3 });

        expect(cyclePosition(falling).score).toBe(30);
    });

    it('is unavailable when no marker falls in the window, rather than neutral', () => {
        const result = cyclePosition(repeat(30));
        expect(result.score).toBeNull();
        expect(result.signal).toMatch(/No cycle marker/);
    });
});

describe('bearishSignalStatus (C4)', () => {
    it('maps the four signal/trend combinations', () => {
        const clear = bearishSignalStatus(repeat(1, { bearishSignal: false, breadth200MaTrend: 1 }));
        expect(clear.score).toBe(85);

        const quietDowntrend = bearishSignalStatus(
            repeat(1, { bearishSignal: false, breadth200MaTrend: -1, breadth8Ma: 0.6, breadth200Ma: 0.5 })
        );
        expect(quietDowntrend.score).toBe(50);

        const warningInUptrend = bearishSignalStatus(
            repeat(1, { bearishSignal: true, breadth200MaTrend: 1, breadth8Ma: 0.6 })
        );
        expect(warningInUptrend.score).toBe(45); // 30 + 15 for strong breadth

        const fullyBearish = bearishSignalStatus(
            repeat(1, { bearishSignal: true, breadth200MaTrend: -1, breadth8Ma: 0.2, breadth200Ma: 0.5 })
        );
        expect(fullyBearish.score).toBe(5); // 10 − 5 for extreme weakness
    });

    it('penalises the Pink Zone even with no signal, because the structure is already weak', () => {
        // trend −1 and 8MA below the 200MA, but no flagged signal.
        const rows = repeat(3, { bearishSignal: false, breadth200MaTrend: -1, breadth8Ma: 0.4, breadth200Ma: 0.5 });
        const result = bearishSignalStatus(rows);

        expect(result.detail.in_pink_zone).toBe(true);
        expect(result.detail.pink_zone_days).toBe(3);
        expect(result.score).toBe(40); // 50 − 10
    });
});

describe('historicalPercentile (C5)', () => {
    const rising = Array.from({ length: 10 }, (_, index) => row({ date: DAY(index), breadth8Ma: 0.1 + index * 0.1 }));

    it('ranks the current level against the whole history', () => {
        const result = historicalPercentile(rising, {});
        expect(result.detail.percentile_rank).toBe(90); // nine of ten are below the latest
        expect(result.detail.base_score).toBe(90);
    });

    it('cools the score near a historical peak and warms it near a trough', () => {
        const hot = historicalPercentile(rising, { 'Average Peaks (200MA)': '1.0' });
        expect(hot.detail.adjustment).toBe(-10);

        const cold = historicalPercentile(
            [row({ date: DAY(0), breadth8Ma: 0.5 }), row({ date: DAY(1), breadth8Ma: 0.2 })],
            { 'Average Troughs (8MA < 0.4)': '0.25' }
        );
        expect(cold.detail.adjustment).toBe(10);
    });

    it('is unavailable with no 8MA values at all', () => {
        expect(historicalPercentile([row({ breadth8Ma: null })], {}).score).toBeNull();
    });
});

describe('divergence (C6)', () => {
    /** 80 rows: price rising throughout, breadth rising then falling over the last 20. */
    const earlyWarning = Array.from({ length: 80 }, (_, index) =>
        row({
            date: DAY(index),
            sp500: 100 + index * 0.8,
            breadth8Ma: index < 60 ? 0.5 + index * 0.002 : 0.62 - (index - 60) * 0.004,
            breadth200Ma: 0.5,
        })
    );

    it('flags an emerging divergence when the short window turns but the long one has not', () => {
        const result = divergence(earlyWarning);

        expect(result.detail.score_60d).toBe(70); // price and breadth both up over 60d
        expect(result.detail.score_20d).toBe(10); // price up hard, breadth down hard over 20d
        expect(result.detail.early_warning).toBe(true);
        // 70 × 0.6 + 10 × 0.4 — the long window carries more, which is why this is a warning and
        // not a verdict.
        expect(result.score).toBe(46);
    });

    it('scores a consistent decline as such rather than as alignment', () => {
        const declining = Array.from({ length: 80 }, (_, index) =>
            row({ date: DAY(index), sp500: 200 - index, breadth8Ma: 0.6 - index * 0.001 })
        );

        expect(divergence(declining).detail.score_60d).toBe(30);
    });

    it('needs twenty rows for the shorter window', () => {
        expect(divergence(repeat(19)).score).toBeNull();
        expect(divergence(repeat(20)).score).not.toBeNull();
    });
});

describe('assessBreadth', () => {
    it('runs all six components and composes them', () => {
        const rows = Array.from({ length: 130 }, (_, index) =>
            row({
                date: DAY(index),
                sp500: 100 + index * 0.5,
                breadth8Ma: 0.45 + Math.sin(index / 10) * 0.15,
                breadth200Ma: 0.5,
                breadth200MaTrend: 1,
                isTrough: index === 100,
            })
        );

        const assessment = assessBreadth(rows, {});

        expect(assessment.components).toHaveLength(6);
        expect(assessment.components.map((component) => component.key)).toEqual([
            'breadth_level_trend',
            'ma_crossover',
            'cycle_position',
            'bearish_signal',
            'historical_percentile',
            'divergence',
        ]);
        expect(assessment.composite.score).toBeGreaterThanOrEqual(0);
        expect(assessment.composite.score).toBeLessThanOrEqual(100);
        expect(assessment.composite.referenceOnly).toBe(false);
    });

    it('reports a reference value rather than a score when there is nothing to score', () => {
        const assessment = assessBreadth([]);

        expect(assessment.composite.referenceOnly).toBe(true);
        expect(assessment.composite.score).toBe(50);
        expect(assessment.composite.zone).toBe('Neutral');
    });
});
