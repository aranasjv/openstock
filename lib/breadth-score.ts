/**
 * Breadth composite scoring — `scorer.py` from `.agents/skills/market-breadth-analyzer`, transcribed.
 *
 * Pure, and kept separate from both the data layer and the component calculators, because this is
 * the arithmetic easiest to get quietly wrong: six weighted components, proportional redistribution
 * when some are missing, and a defined convention for when none are available.
 *
 * One detail from the original is preserved deliberately because it looks like a mistake and is not:
 * when every component is unavailable the composite becomes 50 and the zone is forced to Neutral
 * with a warning, rather than presenting a mid-range number as if it had been measured.
 *
 * One detail is deliberately *not* reproduced. The original substitutes 50 for a missing component
 * score and relies on that component's weight being zero to cancel it; that holds for an absent
 * value but not for a NaN, since `NaN * 0` is NaN. Contributions are guarded instead — see the
 * summation below.
 *
 * The component *calculators* (C1–C6) are not here. Their band tables live in the playbook's
 * `calculators/` package rather than in the methodology document, and inventing bands that look
 * plausible would produce a score comparable to nothing while appearing comparable to everything.
 */

export const COMPONENT_WEIGHTS = {
    breadth_level_trend: 0.25,
    ma_crossover: 0.2,
    cycle_position: 0.2,
    bearish_signal: 0.15,
    historical_percentile: 0.1,
    divergence: 0.1,
} as const;

export type BreadthComponentKey = keyof typeof COMPONENT_WEIGHTS;

export const COMPONENT_LABELS: Record<BreadthComponentKey, string> = {
    breadth_level_trend: 'Current Breadth Level & Trend',
    ma_crossover: '8MA vs 200MA Crossover',
    cycle_position: 'Peak/Trough Cycle Position',
    bearish_signal: 'Bearish Signal Status',
    historical_percentile: 'Historical Percentile',
    divergence: 'S&P 500 vs Breadth Divergence',
};

export type BreadthZone = 'Strong' | 'Healthy' | 'Neutral' | 'Weakening' | 'Critical';

interface ZoneDefinition {
    zone: BreadthZone;
    /** Share of equity exposure the playbook associates with this zone. */
    exposure: string;
    guidance: string;
    actions: string[];
}

/** Highest band first; `interpretZone` walks it in order. */
const ZONES: { floor: number; definition: ZoneDefinition }[] = [
    {
        floor: 80,
        definition: {
            zone: 'Strong',
            exposure: '90-100%',
            guidance: 'Broad market participation. Maintain full equity exposure.',
            actions: [
                'Full position sizing allowed',
                'New entries on pullbacks encouraged',
                'Wide stop-losses acceptable',
                'Growth and momentum strategies favored',
            ],
        },
    },
    {
        floor: 60,
        definition: {
            zone: 'Healthy',
            exposure: '75-90%',
            guidance: 'Above-average breadth. Normal operations with standard risk management.',
            actions: [
                'Normal position sizing',
                'Standard stop-loss levels',
                'New position entries allowed',
                'Monitor for deterioration in leading indicators',
            ],
        },
    },
    {
        floor: 40,
        definition: {
            zone: 'Neutral',
            exposure: '60-75%',
            guidance: 'Mixed signals. Be selective with new positions and tighten risk controls.',
            actions: [
                'Reduce new position sizes by 25-50%',
                'Tighten stop-losses',
                'Focus on stocks with strong relative strength',
                'Avoid lagging sectors and speculative names',
            ],
        },
    },
    {
        floor: 20,
        definition: {
            zone: 'Weakening',
            exposure: '40-60%',
            guidance: 'Breadth deteriorating. Begin profit-taking and raise cash allocation.',
            actions: [
                'Take profits on weakest 25-40% of positions',
                'No new momentum entries',
                'Raise cash allocation significantly',
                'Consider defensive sector rotation (XLU, XLP, XLV)',
                'Watch for cycle trough signal for re-entry',
            ],
        },
    },
    {
        floor: Number.NEGATIVE_INFINITY,
        definition: {
            zone: 'Critical',
            exposure: '25-40%',
            guidance:
                'Severe breadth weakness. Capital preservation is the priority. Watch for trough formation as re-entry signal.',
            actions: [
                'Maximum cash allocation (60-75%)',
                'Only hold strongest relative strength leaders',
                'Consider hedges (put options, inverse ETFs)',
                'Monitor for extreme trough (8MA < 0.4) as contrarian buy signal',
                'Prepare watchlist for recovery: quality stocks near support',
            ],
        },
    },
];

export function interpretZone(composite: number): ZoneDefinition {
    return (ZONES.find((band) => composite >= band.floor) ?? ZONES[ZONES.length - 1]).definition;
}

export interface BreadthComposite {
    score: number;
    zone: BreadthZone;
    exposure: string;
    guidance: string;
    actions: string[];
    effectiveWeights: Record<BreadthComponentKey, number>;
    excluded: string[];
    strongest: { key: BreadthComponentKey; label: string; score: number } | null;
    weakest: { key: BreadthComponentKey; label: string; score: number } | null;
    quality: { label: string; available: number; total: number; missing: string[] };
    /** True when nothing could be scored, so 50 is a convention rather than a measurement. */
    referenceOnly: boolean;
}

function isScored(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param scores A component's score, or null/undefined when it could not be computed. Anything
 *   non-finite is treated as unavailable rather than scored — a NaN would otherwise be summed into
 *   the composite and produce a number that looks calculated.
 */
export function composeBreadthScore(
    scores: Partial<Record<BreadthComponentKey, number | null>>
): BreadthComposite {
    const keys = Object.keys(COMPONENT_WEIGHTS) as BreadthComponentKey[];
    const available = keys.filter((key) => isScored(scores[key]));
    const availableWeight = available.reduce((total, key) => total + COMPONENT_WEIGHTS[key], 0);

    const effectiveWeights = keys.reduce(
        (accumulator, key) => {
            accumulator[key] =
                availableWeight > 0 && available.includes(key) ? COMPONENT_WEIGHTS[key] / availableWeight : 0;
            return accumulator;
        },
        {} as Record<BreadthComponentKey, number>
    );

    let score: number;
    let zone: ZoneDefinition;
    let referenceOnly = false;

    if (availableWeight === 0) {
        score = 50;
        referenceOnly = true;
        zone = {
            ...interpretZone(score),
            zone: 'Neutral',
            guidance: 'All component data is unavailable. Score is a reference value only.',
        };
    } else {
        // Only available components contribute.
        //
        // The original substitutes 50 for a missing score and relies on that component's effective
        // weight being zero to cancel it — which holds for an absent value but *not* for a NaN:
        // `NaN * 0` is NaN, and one NaN turns the whole composite into NaN. A test caught exactly
        // that here. Guarding the contribution is the same arithmetic and cannot be poisoned by a
        // bad input, so the substitution is gone rather than reproduced.
        score =
            Math.round(
                keys.reduce((total, key) => {
                    if (!isScored(scores[key])) return total;
                    return total + (scores[key] as number) * effectiveWeights[key];
                }, 0) * 10
            ) / 10;
        zone = interpretZone(score);
    }

    const ranked = available
        .map((key) => ({ key, label: COMPONENT_LABELS[key], score: scores[key] as number }))
        .sort((left, right) => right.score - left.score);

    const missing = keys.filter((key) => !available.includes(key)).map((key) => COMPONENT_LABELS[key]);
    const total = keys.length;
    const qualityLabel =
        available.length === total
            ? `Complete (${available.length}/${total} components)`
            : available.length >= total - 2
              ? `Partial (${available.length}/${total} components) - interpret with caution`
              : `Limited (${available.length}/${total} components) - low confidence`;

    return {
        score,
        zone: zone.zone,
        exposure: zone.exposure,
        guidance: zone.guidance,
        actions: zone.actions,
        effectiveWeights,
        excluded: missing,
        // Strongest and weakest are drawn from the available components only. Including an absent
        // one would name a component that contributed nothing as the healthiest.
        strongest: ranked[0] ?? null,
        weakest: ranked[ranked.length - 1] ?? null,
        quality: { label: qualityLabel, available: available.length, total, missing },
        referenceOnly,
    };
}
