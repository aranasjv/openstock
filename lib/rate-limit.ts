import 'server-only';

/**
 * A small in-process sliding-window rate limiter.
 *
 * Used to bound AI spending: one assistant turn can make up to six provider calls, and a
 * single user clicking repeatedly could burn real money. Also guards the on-demand
 * "Explain" action.
 *
 * Deliberately in-memory and therefore per-process. With one app container that is exactly
 * the intended scope; with multiple replicas each would enforce its own window, so the
 * effective limit would be multiplied by the replica count. A shared store (Redis, or a
 * Mongo counter) is the fix if this ever scales out — noted rather than silently assumed.
 */

const buckets = new Map<string, number[]>();

export interface RateLimitResult {
    ok: boolean;
    /** How long until the oldest hit in the window expires. */
    retryAfterMs?: number;
    remaining: number;
}

export function checkRateLimit(key: string, max: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const cutoff = now - windowMs;

    const hits = (buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

    if (hits.length >= max) {
        const oldest = hits[0];
        buckets.set(key, hits);
        return { ok: false, retryAfterMs: oldest + windowMs - now, remaining: 0 };
    }

    hits.push(now);
    buckets.set(key, hits);

    return { ok: true, remaining: max - hits.length };
}

/** Test helper — the limiter is process-global, so tests need to reset it. */
export function resetRateLimits(): void {
    buckets.clear();
}
