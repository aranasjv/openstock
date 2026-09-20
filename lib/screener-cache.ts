import 'server-only';

import type { ScreenerResult } from '@/lib/actions/screener.actions';

/**
 * In-process cache of screener results.
 *
 * A scan is the most expensive thing the app does: one history request per instrument in
 * the universe. The dashboard, the daily digest and the assistant's run_screener tool all
 * ask for the same (assetType, strategy) within a short window, so without this the same
 * scan is paid for several times over.
 *
 * It lives in its own module rather than inside screener.actions.ts because that file is a
 * `'use server'` module, where every export must be an async server action — a synchronous
 * cache accessor cannot be exported from it. The type import below is erased at build time,
 * so this does not create a runtime cycle with the action module.
 *
 * Per-process and therefore per-container, exactly like lib/rate-limit.ts.
 */

const entries = new Map<string, { expiresAt: number; value: ScreenerResult }>();

export function getCachedScreener(key: string): ScreenerResult | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
    }

    return entry.value;
}

export function setCachedScreener(key: string, value: ScreenerResult, ttlSeconds: number): void {
    if (ttlSeconds <= 0) return;
    entries.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, value });
}

/** Test helper: the cache is process-global, so tests need to clear it between cases. */
export function clearScreenerCache(): void {
    entries.clear();
}
