import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCachedScreener, setCachedScreener, clearScreenerCache } from '@/lib/screener-cache';
import type { ScreenerResult } from '@/lib/actions/screener.actions';

/**
 * The screener cache exists so that a dashboard render, the digest and an assistant tool
 * call to run_screener within the same window cost one scan rather than three.
 *
 * The type import above is erased at build time, so importing it here does not pull the
 * server action into the test.
 */
const sample = {
    strategyId: 'trend-following',
    strategies: [],
    candidates: [{ symbol: 'AAPL' }],
    scanned: 12,
    unavailable: 0,
    degraded: false,
} as unknown as ScreenerResult;

describe('screener cache', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        clearScreenerCache();
    });

    afterEach(() => {
        vi.useRealTimers();
        clearScreenerCache();
    });

    it('returns a value stored within the TTL', () => {
        setCachedScreener('stock:trend-following', sample, 60);
        expect(getCachedScreener('stock:trend-following')).toBe(sample);
    });

    it('expires the entry after the TTL', () => {
        setCachedScreener('k', sample, 60);
        vi.advanceTimersByTime(60_001);
        expect(getCachedScreener('k')).toBeUndefined();
    });

    it('does not store when the TTL is zero or negative', () => {
        setCachedScreener('k', sample, 0);
        expect(getCachedScreener('k')).toBeUndefined();

        setCachedScreener('k', sample, -5);
        expect(getCachedScreener('k')).toBeUndefined();
    });

    it('returns undefined for an unknown key', () => {
        expect(getCachedScreener('missing')).toBeUndefined();
    });

    it('clears every entry', () => {
        setCachedScreener('a', sample, 60);
        setCachedScreener('b', sample, 60);
        clearScreenerCache();
        expect(getCachedScreener('a')).toBeUndefined();
        expect(getCachedScreener('b')).toBeUndefined();
    });

    it('keys entries independently', () => {
        const other = { ...sample, strategyId: 'momentum' } as unknown as ScreenerResult;
        setCachedScreener('stock:trend-following', sample, 60);
        setCachedScreener('crypto:trend-following', other, 60);

        expect(getCachedScreener('stock:trend-following')).toBe(sample);
        expect(getCachedScreener('crypto:trend-following')).toBe(other);
    });
});
