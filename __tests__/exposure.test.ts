import { describe, it, expect } from 'vitest';
import {
    CRITICAL_INPUTS,
    EXPOSURE_INPUTS,
    EXPOSURE_WEIGHTS,
    evaluateExposure,
    type ExposureInput,
} from '@/lib/exposure';

/** Every dimension at the same score, which makes the composite equal that score. */
function uniform(score: number): Record<ExposureInput, number> {
    return Object.fromEntries(EXPOSURE_INPUTS.map((input) => [input, score])) as Record<
        ExposureInput,
        number
    >;
}

function without(...omitted: ExposureInput[]): Partial<Record<ExposureInput, number>> {
    const scores: Partial<Record<ExposureInput, number>> = { ...uniform(80) };
    for (const input of omitted) delete scores[input];
    return scores;
}

describe('exposure weights', () => {
    it('sums to 100, which the weighted average assumes', () => {
        const total = EXPOSURE_INPUTS.reduce((sum, input) => sum + EXPOSURE_WEIGHTS[input], 0);
        expect(total).toBe(100);
    });

    it('treats regime, top risk and breadth as the critical three', () => {
        expect(CRITICAL_INPUTS).toEqual(['regime', 'top_risk', 'breadth']);
    });
});

describe('evaluateExposure — the composite', () => {
    it('is the weighted average when everything is provided', () => {
        expect(evaluateExposure(uniform(80)).composite).toBe(80);
    });

    it('reweights over the inputs present when some are missing', () => {
        // ftd is non-critical, so nothing is haircut — the average simply moves to what exists.
        expect(evaluateExposure(without('ftd')).composite).toBe(80);
    });

    it('applies the missing-critical haircut, one step per critical input', () => {
        // One critical gone: 80 × 0.9. Two gone: 80 × 0.8 — taken off the composite, which is where
        // the framework puts it, because an absent critical makes the evidence weaker, not just the
        // conclusion.
        expect(evaluateExposure(without('top_risk')).composite).toBe(72);
        expect(evaluateExposure(without('top_risk', 'regime')).composite).toBe(64);
    });

    it('is null when nothing could be scored, rather than zero', () => {
        const posture = evaluateExposure({});
        expect(posture.composite).toBeNull();
        expect(posture.ceilingPct).toBeNull();
    });

    it('ignores a non-finite score rather than summing it', () => {
        const posture = evaluateExposure({ ...uniform(80), breadth: Number.NaN });
        expect(Number.isFinite(posture.composite)).toBe(true);
        expect(posture.missing).toContain('breadth');
    });
});

describe('evaluateExposure — the ceiling', () => {
    it('takes the bottom of each band', () => {
        expect(evaluateExposure(uniform(85)).ceilingPct).toBe(90);
        expect(evaluateExposure(uniform(70)).ceilingPct).toBe(70);
        expect(evaluateExposure(uniform(50)).ceilingPct).toBe(50);
        expect(evaluateExposure(uniform(40)).ceilingPct).toBe(30);
        expect(evaluateExposure(uniform(25)).ceilingPct).toBe(10);
        expect(evaluateExposure(uniform(10)).ceilingPct).toBe(0);
    });
});

describe('evaluateExposure — the recommendation', () => {
    it('permits new entries only with a strong book and no critical input missing', () => {
        const posture = evaluateExposure(uniform(80));
        expect(posture.recommendation).toBe('NEW_ENTRY_ALLOWED');
        expect(posture.structural).toBe(false);
    });

    it('refuses new entries when two critical inputs are missing, however strong the rest', () => {
        // Six dimensions at 80 and no regime or top risk: the composite is a healthy 64, and the
        // answer is still reduce-only. This is the rule that matters — a version without it produces
        // a permissive call from three quarters of the evidence.
        const posture = evaluateExposure(without('regime', 'top_risk'));

        expect(posture.composite).toBe(64);
        expect(posture.recommendation).toBe('REDUCE_ONLY');
        expect(posture.structural).toBe(true);
        expect(posture.rationale).toMatch(/structural rather than a reading of the market/);
    });

    it('refuses new entries with one critical input missing, too', () => {
        // Not a listed reduce-only clause, but NEW_ENTRY_ALLOWED requires none missing, and defaulting
        // the other way would be the unsafe reading of the gap between them.
        const posture = evaluateExposure(without('top_risk'));
        expect(posture.recommendation).toBe('REDUCE_ONLY');
        expect(posture.structural).toBe(false);
    });

    it('goes to cash on a top-risk reading below 25', () => {
        expect(evaluateExposure({ ...uniform(80), top_risk: 20 }).recommendation).toBe('CASH_PRIORITY');
    });

    it('goes to cash on a composite below 30', () => {
        expect(evaluateExposure(uniform(20)).recommendation).toBe('CASH_PRIORITY');
    });

    it('goes to cash on a contraction regime even with a moderate top-risk score', () => {
        const posture = evaluateExposure({ ...uniform(80), regime: 20, top_risk: 40 });
        expect(posture.recommendation).toBe('CASH_PRIORITY');
    });

    it('reduces on a top-risk score in the 25-39 band', () => {
        const posture = evaluateExposure({ ...uniform(80), top_risk: 30 });
        expect(posture.composite).toBe(70);
        expect(posture.recommendation).toBe('REDUCE_ONLY');
    });

    it('reduces rather than crashing when nothing was scored', () => {
        const posture = evaluateExposure({});
        expect(posture.recommendation).toBe('REDUCE_ONLY');
        expect(posture.rationale).toMatch(/No dimension could be scored/);
    });
});

describe('evaluateExposure — confidence', () => {
    it('is high on a complete book', () => {
        expect(evaluateExposure(uniform(80)).confidence).toBe('HIGH');
    });

    it('is capped by missing criticals even when the input count is high', () => {
        // Six inputs scores HIGH on the framework's count table alone, which cannot be right with no
        // regime and no top-risk reading. The count sets the ceiling; the gap caps it.
        const posture = evaluateExposure(without('regime', 'top_risk'));
        expect(posture.provided).toHaveLength(6);
        expect(posture.confidence).toBe('LOW');
    });

    it('drops one step for a single missing critical', () => {
        const posture = evaluateExposure(without('top_risk'));
        expect(posture.provided).toHaveLength(7);
        expect(posture.confidence).toBe('MEDIUM');
    });

    it('is low below four inputs', () => {
        const posture = evaluateExposure({ breadth: 70 });
        expect(posture.confidence).toBe('LOW');
    });
});

describe('evaluateExposure — participation', () => {
    it('is broad when both participation reads clear 50', () => {
        expect(
            evaluateExposure({ ...uniform(80), uptrend: 60, breadth: 60 }).participation
        ).toBe('BROAD');
    });

    it('is narrow when either is below 50', () => {
        expect(
            evaluateExposure({ ...uniform(80), uptrend: 40, breadth: 60 }).participation
        ).toBe('NARROW');
    });

    it('is unknown when neither read exists', () => {
        const posture = evaluateExposure({ regime: 80, top_risk: 80 });
        expect(posture.participation).toBe('UNKNOWN');
    });
});

describe('evaluateExposure — this app today', () => {
    it('can only supply breadth, and says the reduce-only call is structural', () => {
        const posture = evaluateExposure({ breadth: 65 });

        expect(posture.provided).toEqual(['breadth']);
        expect(posture.missing).toHaveLength(EXPOSURE_INPUTS.length - 1);
        expect(posture.criticalMissing).toEqual(['regime', 'top_risk']);
        expect(posture.recommendation).toBe('REDUCE_ONLY');
        expect(posture.structural).toBe(true);
        expect(posture.confidence).toBe('LOW');
    });
});
