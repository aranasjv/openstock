import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkRateLimit, resetRateLimits } from '@/lib/rate-limit';

/**
 * The limiter bounds AI spending: one assistant turn can make several provider calls, so a
 * user clicking repeatedly would otherwise bill without limit.
 *
 * Time is faked so the window boundary can be asserted exactly instead of by sleeping.
 */
describe('checkRateLimit', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        resetRateLimits();
    });

    afterEach(() => {
        vi.useRealTimers();
        resetRateLimits();
    });

    it('allows requests up to the limit', () => {
        for (let i = 0; i < 5; i++) {
            expect(checkRateLimit('user', 5, 60_000).ok).toBe(true);
        }
    });

    it('blocks the request past the limit and reports when to retry', () => {
        for (let i = 0; i < 5; i++) checkRateLimit('user', 5, 60_000);

        const result = checkRateLimit('user', 5, 60_000);

        expect(result.ok).toBe(false);
        expect(result.remaining).toBe(0);
        // The oldest hit was at t=0, so the window clears exactly one window from now.
        expect(result.retryAfterMs).toBe(60_000);
    });

    it('counts the remaining allowance down', () => {
        expect(checkRateLimit('k', 3, 1_000).remaining).toBe(2);
        expect(checkRateLimit('k', 3, 1_000).remaining).toBe(1);
        expect(checkRateLimit('k', 3, 1_000).remaining).toBe(0);
    });

    it('admits a new request once the oldest hit leaves the window', () => {
        checkRateLimit('user', 2, 60_000); // t=0
        vi.advanceTimersByTime(30_000);
        checkRateLimit('user', 2, 60_000); // t=30s — window now full

        expect(checkRateLimit('user', 2, 60_000).ok).toBe(false);

        // Past the first hit's expiry, only the second one remains in the window.
        vi.advanceTimersByTime(30_001);
        expect(checkRateLimit('user', 2, 60_000).ok).toBe(true);
    });

    it('keeps a separate window per key', () => {
        checkRateLimit('a', 1, 1_000);
        expect(checkRateLimit('a', 1, 1_000).ok).toBe(false);
        expect(checkRateLimit('b', 1, 1_000).ok).toBe(true);
    });

    it('treats the block as sliding, not fixed-window', () => {
        // Three hits spread evenly; the count must follow them out one at a time.
        checkRateLimit('u', 3, 1_000); // t=0
        vi.advanceTimersByTime(400);
        checkRateLimit('u', 3, 1_000); // t=400
        vi.advanceTimersByTime(400);
        checkRateLimit('u', 3, 1_000); // t=800 — at the limit

        expect(checkRateLimit('u', 3, 1_000).ok).toBe(false);

        vi.advanceTimersByTime(201); // t=1001, the t=0 hit expires
        expect(checkRateLimit('u', 3, 1_000).ok).toBe(true);
    });
});
