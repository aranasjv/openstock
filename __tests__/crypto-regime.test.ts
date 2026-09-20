import { describe, it, expect } from 'vitest';
import {
    COMPONENT_WEIGHTS,
    composeRegime,
    altBreadthParticipation,
    btcTrendStructure,
    dominanceRegime,
    drawdownVolatility,
    fundingRegime,
    momentumThrust,
    type RegimeComponent,
} from '@/lib/crypto-regime';

/**
 * The thresholds are transcribed from the playbook rather than tuned here, so these tests are what
 * stop them drifting: if someone "improves" a band, the documented model silently becomes a
 * different one and the output stops being comparable to the skill it claims to implement.
 */

/** A straight line from `from` to `to`, oldest first. */
function ramp(from: number, to: number, count: number): number[] {
    return Array.from({ length: count }, (_, index) => from + ((to - from) * index) / (count - 1));
}

function flat(value: number, count: number): number[] {
    return new Array(count).fill(value);
}

function coin(symbol: string, closes: number[]) {
    return { symbol, closes };
}

describe('btcTrendStructure', () => {
    it('scores a bull stack at the top of the range', () => {
        // Rising 100 -> 300 over 260 days puts price above the 50DMA above the 200DMA, and the
        // 200DMA itself is rising, so the +10 modifier clamps the base of 90 at 100.
        const result = btcTrendStructure(ramp(100, 300, 260));

        expect(result?.score).toBe(100);
        expect(result?.signal).toContain('bull stack');
        expect(result?.signal).toContain('rising');
    });

    it('scores a bear stack at the bottom', () => {
        const result = btcTrendStructure(ramp(300, 100, 260));

        expect(result?.score).toBe(5);
        expect(result?.signal).toContain('bear stack');
        expect(result?.signal).toContain('falling');
    });

    it('scores a flat market as neither', () => {
        const result = btcTrendStructure(flat(200, 260));

        expect(result?.score).toBe(50);
        expect(result?.signal).toContain('flat');
    });

    it('recognises a recovery attempt — price above the 50DMA but the stack still inverted', () => {
        // A long decline followed by a sharp bounce: the averages are still falling even though
        // price has turned. This is the row a naive "price above the 50DMA" check gets wrong.
        const closes = [...ramp(400, 200, 300), ...ramp(200, 260, 30)];
        const result = btcTrendStructure(closes);

        expect(result?.signal).toContain('recovery attempt');
    });

    it('needs 220 closes', () => {
        expect(btcTrendStructure(ramp(100, 200, 219))).toBeNull();
        expect(btcTrendStructure(ramp(100, 200, 220))).not.toBeNull();
    });
});

describe('altBreadthParticipation', () => {
    /** Alts whose last close is above or below their own 200DMA. */
    function alts(above: number, below: number) {
        return [
            ...Array.from({ length: above }, (_, index) => coin(`U${index}`, ramp(100, 200, 210))),
            ...Array.from({ length: below }, (_, index) => coin(`D${index}`, ramp(200, 100, 210))),
        ];
    }

    it('maps % above the 200DMA to the documented bands', () => {
        expect(altBreadthParticipation(alts(9, 1))?.score).toBeGreaterThanOrEqual(95); // 90%
        expect(altBreadthParticipation(alts(7, 3))?.score).toBeGreaterThanOrEqual(80); // 70%
        expect(altBreadthParticipation(alts(5, 5))?.score).toBeGreaterThanOrEqual(65); // 50%
        expect(altBreadthParticipation(alts(4, 6))?.score).toBeGreaterThanOrEqual(45); // 40%
        expect(altBreadthParticipation(alts(2, 8))?.score).toBeGreaterThanOrEqual(25); // 20%
        expect(altBreadthParticipation(alts(1, 9))?.score).toBe(10); // 10%
    });

    it('needs at least five usable alts', () => {
        expect(altBreadthParticipation(alts(3, 1))).toBeNull();
    });

    it('lists coins skipped for short history rather than counting them as breadth-negative', () => {
        const result = altBreadthParticipation([
            ...Array.from({ length: 6 }, (_, index) => coin(`U${index}`, ramp(100, 200, 210))),
            coin('NEW', ramp(10, 12, 40)),
        ]);

        // Counting a coin with no 200DMA as "below" would understate breadth purely for being new.
        expect(result?.score).toBe(95);
        expect(result?.signal).toContain('1 skipped');
    });
});

describe('dominanceRegime', () => {
    /** A dominance series ending at `latest`, moving by `change` over the window. */
    function series(latest: number, change: number): number[] {
        const start = latest - change;
        return ramp(start, latest, 31);
    }

    it('reads the direction conditionally on the BTC trend', () => {
        // The same falling dominance is bullish with a healthy BTC trend (rotation into alts) and
        // the worst reading without one (indiscriminate de-risking).
        expect(dominanceRegime(series(55, -2), 80)?.score).toBe(90);
        expect(dominanceRegime(series(55, -2), 40)?.score).toBe(10);
    });

    it('maps the remaining table rows', () => {
        expect(dominanceRegime(series(55, 0.2), 80)?.score).toBe(75); // up + flat
        expect(dominanceRegime(series(55, 2), 80)?.score).toBe(65); // up + rising
        expect(dominanceRegime(series(55, 2), 40)?.score).toBe(30); // down + rising
        expect(dominanceRegime(series(55, 0.2), 40)?.score).toBe(25); // down + flat
    });

    it('applies the contrarian extremes', () => {
        // Washout watch: high dominance into weakness is +5.
        expect(dominanceRegime(series(63, -3), 40)?.score).toBe(15);
        // Froth caution: low dominance in strength is -5.
        expect(dominanceRegime(series(38, -2), 80)?.score).toBe(85);
    });

    it('needs 31 observations and a usable BTC trend', () => {
        expect(dominanceRegime(ramp(50, 55, 30), 80)).toBeNull();
        expect(dominanceRegime(series(55, 2), null)).toBeNull();
    });
});

describe('fundingRegime', () => {
    it('maps each documented band', () => {
        // Bands are 8h fractions: 0.0001 = +0.010%.
        expect(fundingRegime(-0.0002)?.score).toBe(80); // washed out
        expect(fundingRegime(-0.00005)?.score).toBe(65); // skeptical
        expect(fundingRegime(0)?.score).toBe(75); // neutral
        expect(fundingRegime(0.00009)?.score).toBe(75); // still neutral
        expect(fundingRegime(0.0002)?.score).toBe(55); // building
        expect(fundingRegime(0.0004)?.score).toBe(30); // crowded
        expect(fundingRegime(0.0007)?.score).toBe(10); // euphoric
    });

    it('is not monotonic — the neutral band scores higher than mild positive funding', () => {
        // Contrarian at the extremes is the design, not an accident: leverage starting to build is
        // a worse reading than no leverage at all.
        expect(fundingRegime(0.0002)!.score).toBeLessThan(fundingRegime(0)!.score);
    });
});

describe('drawdownVolatility', () => {
    it('maps drawdown bands', () => {
        // A drop from 100 to 95 is a 5% drawdown from the 1y high.
        expect(drawdownVolatility([...flat(100, 364), 95])?.score).toBeGreaterThanOrEqual(80);
        expect(drawdownVolatility([...flat(100, 364), 20])?.signal).toContain('below the 1y high');
        // An 80% drawdown with volatility expanding is the capitulation case, floored at 15.
        expect(drawdownVolatility([...flat(100, 364), 20])?.score).toBe(15);
    });

    it('needs 365 closes', () => {
        expect(drawdownVolatility(flat(100, 364))).toBeNull();
        expect(drawdownVolatility(flat(100, 365))).not.toBeNull();
    });
});

describe('momentumThrust', () => {
    function universe(positive: number, negative: number) {
        return [
            ...Array.from({ length: positive }, (_, index) => coin(`P${index}`, ramp(100, 120, 40))),
            ...Array.from({ length: negative }, (_, index) => coin(`N${index}`, ramp(120, 100, 40))),
        ];
    }

    it('maps % positive over 30 days to the documented bands', () => {
        expect(momentumThrust(universe(9, 1))?.score).toBe(90); // 90%
        expect(momentumThrust(universe(7, 3))?.score).toBe(75); // 70%
        expect(momentumThrust(universe(5, 5))?.score).toBe(55); // 50%
        expect(momentumThrust(universe(3, 7))?.score).toBe(35); // 30%
        expect(momentumThrust(universe(2, 8))?.score).toBe(20); // 20%
    });

    it('turns contrarian at a washout rather than scoring it worst', () => {
        // Below 10% positive, the plain trend mapping would return the lowest score. The playbook
        // deliberately bumps it, because near-total negative momentum has marked better forward
        // returns than the middle of the range.
        const washout = momentumThrust(universe(0, 10));

        expect(washout?.score).toBe(35);
        expect(washout?.score).toBeGreaterThan(momentumThrust(universe(2, 8))!.score);
        expect(washout?.signal).toContain('washout');
    });

    it('needs five usable coins', () => {
        expect(momentumThrust(universe(2, 2))).toBeNull();
    });
});

describe('composeRegime', () => {
    function component(key: string, weight: number, score: number | null): RegimeComponent {
        return { key, label: key, weight, score, signal: '' };
    }

    const full = [
        component('btcTrend', COMPONENT_WEIGHTS.btcTrend, 90),
        component('altBreadth', COMPONENT_WEIGHTS.altBreadth, 80),
        component('dominance', COMPONENT_WEIGHTS.dominance, 65),
        component('funding', COMPONENT_WEIGHTS.funding, 75),
        component('drawdown', COMPONENT_WEIGHTS.drawdown, 55),
        component('momentum', COMPONENT_WEIGHTS.momentum, 35),
    ];

    it('weights the components by the model weights', () => {
        const result = composeRegime(full);
        const expected = (90 * 25 + 80 * 20 + 65 * 15 + 75 * 15 + 55 * 15 + 35 * 10) / 100;

        expect(expected).toBeCloseTo(71.25, 6);
        expect(result.score).toBeCloseTo(expected, 6);
        // Mixed readings land mid-range, which is the whole point of a composite: no single
        // component decides the regime.
        expect(result.zone).toBe('NEUTRAL');
    });

    it('redistributes proportionally when a component is missing', () => {
        const withoutFunding = full.map((entry) =>
            entry.key === 'funding' ? component('funding', 15, null) : entry
        );
        const result = composeRegime(withoutFunding);

        // Scored on the remaining 85 points of weight, not on 100 with a zero in one slot.
        const expected = (90 * 25 + 80 * 20 + 65 * 15 + 55 * 15 + 35 * 10) / 85;
        expect(result.score).toBeCloseTo(expected, 6);
        expect(result.effectiveWeights.funding).toBe(0);
        expect(result.effectiveWeights.btcTrend).toBeCloseTo((25 / 85) * 100, 6);

        const total = Object.values(result.effectiveWeights).reduce((sum, value) => sum + value, 0);
        expect(total).toBeCloseTo(100, 6);
    });

    it('returns UNKNOWN rather than a confident number from too few components', () => {
        const sparse = full.map((entry) =>
            ['dominance', 'funding', 'drawdown'].includes(entry.key)
                ? { ...entry, score: null as number | null }
                : entry
        );
        const result = composeRegime(sparse);

        expect(result.score).toBeNull();
        expect(result.zone).toBe('UNKNOWN');
        expect(result.effectiveWeights).toEqual({});
    });

    it('returns UNKNOWN when four components remain but carry too little weight', () => {
        // Four components is the count floor, but 65% of the original weight is the other half of
        // the rule: four small ones are not enough either.
        const light = [
            component('btcTrend', 25, null),
            component('altBreadth', 20, null),
            component('dominance', 15, 70),
            component('funding', 15, 70),
            component('drawdown', 15, 70),
            component('momentum', 10, 70),
        ];
        const result = composeRegime(light);

        expect(result.score).toBeNull();
        expect(result.zone).toBe('UNKNOWN');
    });

    it('bands the zones at 80 and 40', () => {
        expect(composeRegime(full.map((entry) => ({ ...entry, score: 80 }))).zone).toBe('RISK_ON');
        expect(composeRegime(full.map((entry) => ({ ...entry, score: 79 }))).zone).toBe('NEUTRAL');
        expect(composeRegime(full.map((entry) => ({ ...entry, score: 40 }))).zone).toBe('NEUTRAL');
        expect(composeRegime(full.map((entry) => ({ ...entry, score: 39 }))).zone).toBe('RISK_OFF');
    });
});
