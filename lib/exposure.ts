/**
 * Exposure posture — the synthesis from `.agents/skills/exposure-coach`.
 *
 * Pure, and transcribed rather than reinterpreted, because the interesting behaviour is a *rejection*:
 * `NEW_ENTRY_ALLOWED` requires that no critical input be missing, and the three critical inputs are
 * Regime, Top Risk and Breadth. This app can currently supply Breadth alone, so the framework's
 * correct answer is `REDUCE_ONLY` — not because the market is poor, but because two critical reads do
 * not exist here. A version that quietly relaxed that rule would produce a permissive recommendation
 * from a quarter of the evidence, which is precisely the failure the rule was written to prevent.
 *
 * That is why the result carries `structural`: it distinguishes "reduce because the market is weak"
 * from "reduce because we cannot see", which are the same two words and completely different facts.
 */

export const EXPOSURE_INPUTS = [
    'regime',
    'top_risk',
    'breadth',
    'uptrend',
    'institutional',
    'sector',
    'theme',
    'ftd',
] as const;

export type ExposureInput = (typeof EXPOSURE_INPUTS)[number];

/** Weights from `references/exposure_framework.md`. They sum to 100. */
export const EXPOSURE_WEIGHTS: Record<ExposureInput, number> = {
    regime: 25,
    top_risk: 20,
    breadth: 15,
    uptrend: 15,
    institutional: 10,
    sector: 5,
    theme: 5,
    ftd: 5,
};

/**
 * The three inputs the recommendation logic treats as critical. Missing any of them caps how
 * permissive the answer can be, and missing two makes `NEW_ENTRY_ALLOWED` unreachable.
 */
export const CRITICAL_INPUTS: ExposureInput[] = ['regime', 'top_risk', 'breadth'];

/** Confidence thresholds: 6+ high, 4-5 medium, fewer low. */
const HIGH_CONFIDENCE_INPUTS = 6;
const MEDIUM_CONFIDENCE_INPUTS = 4;

/** 10% off the composite per missing critical input, per the framework's missing-input handling. */
const CRITICAL_MISSING_HAIRCUT = 0.1;

export type ExposureRecommendation = 'NEW_ENTRY_ALLOWED' | 'REDUCE_ONLY' | 'CASH_PRIORITY';
export type ExposureConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type ExposureParticipation = 'BROAD' | 'NARROW' | 'UNKNOWN';
export type ExposureBias = 'GROWTH' | 'VALUE' | 'NEUTRAL';

export interface ExposurePosture {
    /** Weighted composite over the inputs provided, after the missing-critical haircut. */
    composite: number | null;
    ceilingPct: number | null;
    recommendation: ExposureRecommendation;
    confidence: ExposureConfidence;
    participation: ExposureParticipation;
    bias: ExposureBias;
    provided: ExposureInput[];
    missing: ExposureInput[];
    criticalMissing: ExposureInput[];
    /** True when the recommendation is forced by absent inputs rather than by the market itself. */
    structural: boolean;
    rationale: string;
}

/** Ceiling bands, taken at the bottom of each range — the conservative end, per "safety first". */
const CEILING_BANDS: { min: number; ceiling: number }[] = [
    { min: 80, ceiling: 90 },
    { min: 65, ceiling: 70 },
    { min: 50, ceiling: 50 },
    { min: 35, ceiling: 30 },
    { min: 20, ceiling: 10 },
    { min: 0, ceiling: 0 },
];

function ceilingFor(composite: number): number {
    return CEILING_BANDS.find((band) => composite >= band.min)?.ceiling ?? 0;
}

function isScored(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Evaluate the posture from whatever inputs exist.
 *
 * Rules are checked most-severe first. The framework lists them in the opposite order, but its
 * conditions overlap on the composite bands — a score below 30 satisfies neither the "30-49" clause
 * nor the ">= 50" one, so the order only matters for the overlapping cases, and there the severe
 * reading is the safe one.
 */
export function evaluateExposure(
    scores: Partial<Record<ExposureInput, number | null>>
): ExposurePosture {
    const provided = EXPOSURE_INPUTS.filter((input) => isScored(scores[input]));
    const missing = EXPOSURE_INPUTS.filter((input) => !isScored(scores[input]));
    const criticalMissing = CRITICAL_INPUTS.filter((input) => missing.includes(input));

    let composite: number | null = null;

    if (provided.length > 0) {
        const totalWeight = provided.reduce((sum, input) => sum + EXPOSURE_WEIGHTS[input], 0);
        const weighted = provided.reduce(
            (sum, input) => sum + (scores[input] as number) * EXPOSURE_WEIGHTS[input],
            0
        );

        // The haircut is applied to the composite rather than to the ceiling, which is where the
        // framework puts it — an absent critical input makes the *evidence* weaker, not only the
        // conclusion.
        const raw = weighted / totalWeight;
        composite = Math.max(0, Math.round(raw * (1 - CRITICAL_MISSING_HAIRCUT * criticalMissing.length) * 10) / 10);
    }

    const topRisk = isScored(scores.top_risk) ? (scores.top_risk as number) : null;
    const regime = isScored(scores.regime) ? (scores.regime as number) : null;
    const breadth = isScored(scores.breadth) ? (scores.breadth as number) : null;
    const uptrend = isScored(scores.uptrend) ? (scores.uptrend as number) : null;

    let recommendation: ExposureRecommendation;

    if (
        (composite !== null && composite < 30) ||
        (topRisk !== null && topRisk < 25) ||
        (regime !== null && regime <= 20 && topRisk !== null && topRisk < 50)
    ) {
        recommendation = 'CASH_PRIORITY';
    } else if (
        (composite !== null && composite >= 30 && composite <= 49) ||
        (topRisk !== null && topRisk >= 25 && topRisk <= 39) ||
        criticalMissing.length >= 2
    ) {
        recommendation = 'REDUCE_ONLY';
    } else if (
        composite !== null &&
        composite >= 50 &&
        topRisk !== null &&
        topRisk >= 40 &&
        criticalMissing.length === 0
    ) {
        recommendation = 'NEW_ENTRY_ALLOWED';
    } else {
        // Reached when the composite clears 50 but the evidence is not permitted to support a
        // permissive call — one critical input short, or no top-risk reading at all.
        recommendation = 'REDUCE_ONLY';
    }

    // The framework gives two confidence rules that can disagree: a table by input count
    // ("6+ inputs → HIGH"), and "reduce confidence proportionally" under missing-input handling. A
    // book with six inputs but no regime and no top-risk reading scores HIGH by the table alone,
    // which cannot be right — so the count gives the ceiling and the missing criticals cap it. Where
    // two stated rules conflict, the conservative one is the one to implement.
    const byCount: ExposureConfidence =
        provided.length >= HIGH_CONFIDENCE_INPUTS
            ? 'HIGH'
            : provided.length >= MEDIUM_CONFIDENCE_INPUTS
              ? 'MEDIUM'
              : 'LOW';

    const confidence: ExposureConfidence =
        criticalMissing.length >= 2
            ? 'LOW'
            : criticalMissing.length === 1 && byCount === 'HIGH'
              ? 'MEDIUM'
              : byCount;

    const participation: ExposureParticipation =
        uptrend === null && breadth === null
            ? 'UNKNOWN'
            : (uptrend ?? 0) >= 50 && (breadth ?? 0) >= 50
              ? 'BROAD'
              : 'NARROW';

    const bias: ExposureBias =
        regime === null ? 'NEUTRAL' : regime >= 80 ? 'GROWTH' : regime <= 40 ? 'VALUE' : 'NEUTRAL';

    // "Reduce only" and "cash priority" carry no information about the market when the inputs that
    // would permit the opposite do not exist here.
    const structural = criticalMissing.length >= 2;

    const rationale = buildRationale({
        composite,
        recommendation,
        criticalMissing,
        provided,
        topRisk,
        structural,
    });

    return {
        composite,
        ceilingPct: composite === null ? null : ceilingFor(composite),
        recommendation,
        confidence,
        participation,
        bias,
        provided,
        missing,
        criticalMissing,
        structural,
        rationale,
    };
}

function buildRationale({
    composite,
    recommendation,
    criticalMissing,
    provided,
    topRisk,
    structural,
}: {
    composite: number | null;
    recommendation: ExposureRecommendation;
    criticalMissing: ExposureInput[];
    provided: ExposureInput[];
    topRisk: number | null;
    structural: boolean;
}): string {
    if (provided.length === 0) {
        return 'No dimension could be scored, so the framework returns its most defensive recommendation by rule.';
    }

    const scored = `Scored ${provided.length} of ${EXPOSURE_INPUTS.length} dimensions (composite ${
        composite ?? 'n/a'
    }).`;

    if (structural) {
        return `${scored} Critical inputs missing: ${criticalMissing.join(', ')}. The framework cannot permit new entries without them, so this recommendation is structural rather than a reading of the market.`;
    }

    if (recommendation === 'CASH_PRIORITY') {
        return `${scored} ${
            topRisk !== null && topRisk < 25 ? `Top risk scored ${topRisk}.` : 'Conditions are defensive.'
        }`;
    }

    return scored;
}
