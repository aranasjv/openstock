import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The dominance store exists because CoinGecko's free tier gives only the current value. The
 * rules that matter are therefore about *time*: that a short history is reported as insufficient
 * rather than read as a trend, and that the day boundary is UTC so the window does not shift when
 * the server moves.
 */
const find = vi.fn();
const getCryptoGlobal = vi.fn();

vi.mock('@/database/mongoose', () => ({ connectToDatabase: async () => ({}) }));
vi.mock('@/database/models/dominance.model', () => ({ DominanceModel: { find: () => find() } }));
vi.mock('@/lib/actions/crypto.actions', () => ({ getCryptoGlobal: () => getCryptoGlobal() }));

import {
    DOMINANCE_TREND_DAYS,
    dominanceChange,
    getDominanceHistory,
    utcDay,
    recordDominanceObservation,
} from '@/lib/data/dominance';

/** The model chain: find().sort().limit().lean(). */
function chain(docs: unknown[]) {
    return { sort: () => ({ limit: () => ({ lean: async () => docs }) }) };
}

beforeEach(() => {
    find.mockReset();
    getCryptoGlobal.mockReset();
});

describe('utcDay', () => {
    it('formats as a calendar day in UTC', () => {
        expect(utcDay(new Date('2026-03-09T00:30:00Z'))).toBe('2026-03-09');
        expect(utcDay(new Date('2026-03-09T23:30:00Z'))).toBe('2026-03-09');
    });

    it('does not roll over with the local timezone', () => {
        // 23:30 UTC is the *next* day in UTC+1. Recording a dominance point under a local day
        // would put two observations on one calendar day and leave gaps on another.
        const lateUtc = new Date('2026-03-09T23:30:00Z');
        expect(utcDay(lateUtc)).toBe('2026-03-09');
        expect(utcDay(lateUtc)).not.toBe('2026-03-10');
    });
});

describe('dominanceChange', () => {
    it('measures the change across the window in percentage points', () => {
        expect(
            dominanceChange([
                { day: '2026-01-01', btcDominance: 52 },
                { day: '2026-01-02', btcDominance: 55.5 },
            ])
        ).toBeCloseTo(3.5, 6);
    });

    it('is negative when dominance is falling', () => {
        expect(
            dominanceChange([
                { day: '2026-01-01', btcDominance: 60 },
                { day: '2026-01-02', btcDominance: 54 },
            ])
        ).toBeCloseTo(-6, 6);
    });

    it('needs at least two observations', () => {
        // One point is a level, not a trend. Treating it as a trend would produce a confident zero.
        expect(dominanceChange([])).toBeNull();
        expect(dominanceChange([{ day: '2026-01-01', btcDominance: 52 }])).toBeNull();
    });

    it('refuses to compute from a non-finite value', () => {
        expect(
            dominanceChange([
                { day: '2026-01-01', btcDominance: Number.NaN },
                { day: '2026-01-02', btcDominance: 55 },
            ])
        ).toBeNull();
    });
});

describe('getDominanceHistory', () => {
    it('returns points oldest-first even though the query is newest-first', async () => {
        find.mockReturnValue(
            chain([
                { day: '2026-01-03', btcDominance: 58 },
                { day: '2026-01-02', btcDominance: 56 },
                { day: '2026-01-01', btcDominance: 54 },
            ])
        );

        const read = await getDominanceHistory();

        // The newest-first order is a query detail for taking the most recent N; a caller reading a
        // trend should not have to know it was reversed.
        expect(read.points.map((point) => point.day)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
        expect(read.change).toBeCloseTo(4, 6);
    });

    it('reports insufficient history below the threshold', async () => {
        find.mockReturnValue(chain([{ day: '2026-01-02', btcDominance: 56 }, { day: '2026-01-01', btcDominance: 54 }]));

        const read = await getDominanceHistory();

        expect(read.sufficient).toBe(false);
        // The change is still computed — it is the *confidence* that is low, and the engine decides
        // whether to use it. Hiding it here would make the component impossible to explain.
        expect(read.change).toBeCloseTo(2, 6);
    });

    it('reports sufficient history at the threshold', async () => {
        const docs = Array.from({ length: DOMINANCE_TREND_DAYS }, (_, index) => ({
            day: `2026-01-${String(index + 1).padStart(2, '0')}`,
            btcDominance: 50,
        }));
        find.mockReturnValue(chain(docs));

        const read = await getDominanceHistory();

        expect(read.points).toHaveLength(DOMINANCE_TREND_DAYS);
        expect(read.sufficient).toBe(true);
    });

    it('is sufficient with no history only if the threshold is zero', async () => {
        find.mockReturnValue(chain([]));
        const read = await getDominanceHistory();
        expect(read.sufficient).toBe(false);
        expect(read.change).toBeNull();
    });
});

describe('recordDominanceObservation', () => {
    it('reports failure when the reading is unavailable', async () => {
        getCryptoGlobal.mockResolvedValue(null);
        expect(await recordDominanceObservation()).toBe(false);
    });
});
