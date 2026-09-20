import { describe, it, expect } from 'vitest';
import {
    COMPONENT_LABELS,
    COMPONENT_WEIGHTS,
    composeBreadthScore,
    interpretZone,
    type BreadthComponentKey,
} from '@/lib/breadth-score';

const KEYS = Object.keys(COMPONENT_WEIGHTS) as BreadthComponentKey[];

/** Every component at the same score: with weights summing to 1, the composite equals it. */
const allAt = (score: number) => Object.fromEntries(KEYS.map((key) => [key, score])) as Record<BreadthComponentKey, number>;

describe('composeBreadthScore', () => {
    it('weights the six components by the documented shares', () => {
        expect(COMPONENT_WEIGHTS.breadth_level_trend).toBe(0.25);
        expect(COMPONENT_WEIGHTS.bearish_signal).toBe(0.15);
        expect(Object.values(COMPONENT_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 10);
    });

    it('returns the shared score when every component agrees', () => {
        const result = composeBreadthScore(allAt(100));

        expect(result.score).toBe(100);
        expect(result.zone).toBe('Strong');
        expect(result.quality.label).toBe('Complete (6/6 components)');
        expect(result.referenceOnly).toBe(false);
    });

    it('redistributes proportionally and reports the effective weights', () => {
        const result = composeBreadthScore({
            breadth_level_trend: 80,
            ma_crossover: 60,
            cycle_position: 40,
            bearish_signal: 20,
            historical_percentile: 100,
            divergence: null,
        });

        // The unavailable component carries no weight at all, and the rest normalise to 1.
        expect(result.effectiveWeights.divergence).toBe(0);
        expect(result.effectiveWeights.breadth_level_trend).toBeCloseTo(0.25 / 0.9, 10);
        expect(
            Object.values(result.effectiveWeights).reduce((sum, weight) => sum + weight, 0)
        ).toBeCloseTo(1, 10);

        // 80·0.2778 + 60·0.2222 + 40·0.2222 + 20·0.1667 + 100·0.1111
        expect(result.score).toBe(58.9);
        expect(result.zone).toBe('Neutral');
        expect(result.excluded).toEqual(['S&P 500 vs Breadth Divergence']);
    });

    it('does not let an unavailable component contribute anything', () => {
        const withAbsent = composeBreadthScore({ ...allAt(0), divergence: null });
        const withZero = composeBreadthScore({ ...allAt(0), divergence: 0 });

        // Both must be 0. If an absent component leaked a substituted mid-value into the sum, the
        // first would drift toward 50 in proportion to the missing weight.
        expect(withAbsent.score).toBe(0);
        expect(withZero.score).toBe(0);
    });

    it('reports a reference value rather than a measurement when nothing is available', () => {
        const result = composeBreadthScore({
            breadth_level_trend: null,
            ma_crossover: NaN,
            cycle_position: undefined,
        });

        expect(result.score).toBe(50);
        expect(result.zone).toBe('Neutral');
        expect(result.referenceOnly).toBe(true);
        expect(result.guidance).toMatch(/reference value only/i);
        expect(result.strongest).toBeNull();
        expect(result.weakest).toBeNull();
        expect(result.quality.label).toMatch(/Limited \(0\/6/);
    });

    it('ignores a non-finite score instead of summing it', () => {
        const result = composeBreadthScore({ ...allAt(100), ma_crossover: Number.NaN });

        // NaN is treated as unavailable, so the remaining five normalise — not 100 with a NaN hole.
        expect(Number.isFinite(result.score)).toBe(true);
        expect(result.score).toBe(100);
        expect(result.excluded).toContain(COMPONENT_LABELS.ma_crossover);
    });

    it('names the strongest and weakest among the available components only', () => {
        const result = composeBreadthScore({
            breadth_level_trend: 90,
            ma_crossover: 10,
            cycle_position: 50,
            // Deliberately extreme-but-absent: it must not be reported as either extreme.
            bearish_signal: null,
        });

        expect(result.weakest?.key).toBe('ma_crossover');
        expect(result.strongest?.key).toBe('breadth_level_trend');
        expect(result.excluded).toContain(COMPONENT_LABELS.bearish_signal);
    });

    it('escalates the quality warning as components go missing', () => {
        expect(composeBreadthScore(allAt(60)).quality.label).toMatch(/Complete/);

        const one = composeBreadthScore({ ...allAt(60), divergence: null });
        expect(one.quality.label).toMatch(/Partial \(5\/6/);

        const two = composeBreadthScore({ ...allAt(60), divergence: null, historical_percentile: null });
        expect(two.quality.label).toMatch(/Partial \(4\/6/);

        // Three missing crosses into "low confidence" — the playbook's own threshold.
        const three = composeBreadthScore({
            ...allAt(60),
            divergence: null,
            historical_percentile: null,
            bearish_signal: null,
        });
        expect(three.quality.label).toMatch(/Limited \(3\/6/);
    });

    it('hands back the zone table for a composite, boundaries inclusive at the bottom', () => {
        expect(interpretZone(80).zone).toBe('Strong');
        expect(interpretZone(79.9).zone).toBe('Healthy');
        expect(interpretZone(60).zone).toBe('Healthy');
        expect(interpretZone(59.9).zone).toBe('Neutral');
        expect(interpretZone(40).zone).toBe('Neutral');
        expect(interpretZone(39.9).zone).toBe('Weakening');
        expect(interpretZone(20).zone).toBe('Weakening');
        expect(interpretZone(19.9).zone).toBe('Critical');
        expect(interpretZone(0).zone).toBe('Critical');
    });

    it('carries the exposure guidance and actions with the zone', () => {
        const strong = composeBreadthScore(allAt(85));
        expect(strong.exposure).toBe('90-100%');
        expect(strong.actions.length).toBeGreaterThan(0);

        const critical = composeBreadthScore(allAt(10));
        expect(critical.exposure).toBe('25-40%');
        expect(critical.guidance).toMatch(/capital preservation/i);
    });
});
