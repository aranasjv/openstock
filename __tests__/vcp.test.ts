import { describe, it, expect } from 'vitest';
import { detectVcp, trendTemplate } from '@/lib/vcp';
import type { Candle } from '@/lib/indicators';

/** Piecewise-linear close series, concatenated segment by segment. */
function closesFromSegments(segments: { from: number; to: number; bars: number }[]): number[] {
    const out: number[] = [];
    for (const segment of segments) {
        for (let index = 0; index < segment.bars; index += 1) {
            out.push(segment.from + ((segment.to - segment.from) * index) / Math.max(1, segment.bars - 1));
        }
    }
    return out;
}

function bars(closes: number[], volume: (index: number) => number = () => 1_000_000): Candle[] {
    return closes.map((close, index) => ({
        t: 1_600_000_000_000 + index * 86_400_000,
        o: close,
        h: close,
        l: close,
        c: close,
        v: volume(index),
    }));
}

const UPTREND = closesFromSegments([{ from: 100, to: 200, bars: 260 }]);
const DOWNTREND = closesFromSegments([{ from: 200, to: 100, bars: 260 }]);

/**
 * A textbook three-contraction VCP: a 20% correction, then 12%, then 5%, with volume drying up into
 * the pivot. Built from segments because a zigzag detector needs actual reversals to find, not a
 * formula with an expected answer beside it.
 */
const VCP_CLOSES = closesFromSegments([
    { from: 100, to: 150, bars: 60 },
    { from: 150, to: 120, bars: 20 },
    { from: 120, to: 148, bars: 20 },
    { from: 148, to: 130, bars: 16 },
    { from: 130, to: 146, bars: 16 },
    { from: 146, to: 139, bars: 12 },
    { from: 139, to: 145, bars: 12 },
]);

describe('trendTemplate', () => {
    it('passes a stock in a confirmed Stage 2 uptrend', () => {
        const result = trendTemplate(UPTREND);

        expect(result).not.toBeNull();
        expect(result!.passed).toBe(result!.total);
    });

    it('fails a downtrend', () => {
        const result = trendTemplate(DOWNTREND);

        expect(result).not.toBeNull();
        expect(result!.passed).toBeLessThan(3);
    });

    it('returns null rather than a verdict without a year of history', () => {
        expect(trendTemplate(closesFromSegments([{ from: 100, to: 120, bars: 200 }]))).toBeNull();
    });

    it('reports six points without a relative-strength rank and seven with one', () => {
        // The playbook's threshold is "6 of 7". Six is what price history alone can decide, and a
        // caller comparing the two needs to know which set the count came from — so the denominator
        // changes rather than the missing point quietly counting as failed.
        expect(trendTemplate(UPTREND)!.total).toBe(6);
        expect(trendTemplate(UPTREND, { rsPercentile: 85 })!.total).toBe(7);

        // A failing rank is a failed seventh check, not a lowered price count.
        const weak = trendTemplate(UPTREND, { rsPercentile: 40 })!;
        expect(weak.passed).toBe(6);
        expect(weak.total).toBe(7);
        expect(weak.checks.find((check) => check.label.includes('Relative strength'))!.passed).toBe(false);
    });

    it('fails the 52-week-high check when price is deep in a correction', () => {
        const corrected = closesFromSegments([
            { from: 100, to: 200, bars: 240 },
            { from: 200, to: 130, bars: 20 },
        ]);

        const check = trendTemplate(corrected)!.checks.find((item) => item.label.includes('52-week high'))!;
        expect(check.passed).toBe(false);
    });
});

describe('detectVcp', () => {
    it('returns null rather than guessing without enough bars', () => {
        expect(detectVcp(bars(closesFromSegments([{ from: 100, to: 120, bars: 100 }])))).toBeNull();
    });

    it('finds the contraction sequence in a textbook pattern', () => {
        const result = detectVcp(bars(VCP_CLOSES));

        expect(result).not.toBeNull();
        expect(result!.valid).toBe(true);
        expect(result!.contractions.length).toBeGreaterThanOrEqual(2);
        expect(result!.reasons).toEqual([]);
    });

    it('reports progressively tighter contractions', () => {
        const result = detectVcp(bars(VCP_CLOSES))!;

        // 20% -> 12% -> 5%, each at least a quarter tighter than the one before.
        expect(result.contractions[0].depthPct).toBeGreaterThan(15);
        expect(result.contractions[1].depthPct).toBeLessThan(result.contractions[0].depthPct);
    });

    it('gives a pivot and a stop from the last completed contraction', () => {
        const result = detectVcp(bars(VCP_CLOSES))!;

        expect(result.pivot).not.toBeNull();
        expect(result.stop).not.toBeNull();
        expect(result.pivot!).toBeGreaterThan(result.stop!);
        // The methodology's guidance is 5-8% of risk from entry to stop.
        expect(result.riskPct).toBeGreaterThan(0);
        expect(result.riskPct).toBeLessThan(12);
    });

    it('rejects expanding contractions, which are explicitly not a VCP', () => {
        const expanding = closesFromSegments([
            { from: 100, to: 150, bars: 60 },
            { from: 150, to: 140, bars: 20 }, // -6.7%
            { from: 140, to: 148, bars: 20 },
            { from: 148, to: 110, bars: 20 }, // -25.7%, deeper than the first
            { from: 110, to: 146, bars: 20 },
        ]);

        const result = detectVcp(bars(expanding))!;
        expect(result.valid).toBe(false);
        expect(result.reasons.join(' ')).toMatch(/tighter/);
    });

    it('rejects a single contraction however sharp it looks', () => {
        const single = closesFromSegments([
            { from: 100, to: 150, bars: 60 },
            { from: 150, to: 120, bars: 20 },
            { from: 120, to: 149, bars: 60 },
        ]);

        const result = detectVcp(bars(single))!;
        expect(result.valid).toBe(false);
        expect(result.reasons.join(' ')).toMatch(/contraction\(s\)/);
    });

    it('bands the volume dry-up, treating calm as good', () => {
        // Volume falls to a tenth of the average over the final ten bars.
        const drying = detectVcp(bars(VCP_CLOSES, (index) => (index >= VCP_CLOSES.length - 10 ? 60_000 : 1_000_000)))!;
        const flat = detectVcp(bars(VCP_CLOSES, () => 1_000_000))!;

        expect(drying.dryUpBand).toBe('exceptional');
        expect(drying.dryUpRatio!).toBeLessThan(0.3);
        // Unchanged volume is a ratio of 1.0, which is "weak" — no dry-up is a warning, not a pass.
        expect(flat.dryUpBand).toBe('weak');
    });
});
