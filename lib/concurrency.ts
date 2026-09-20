/**
 * Bounded-concurrency mapping.
 *
 * `Promise.all(items.map(fn))` fires every call at once, so a watchlist of sixty symbols becomes
 * a hundred and twenty simultaneous requests at one vendor — which is how a rate limit turns
 * into a page that never finishes, and how a per-account quota is spent in one render. This
 * keeps a fixed number in flight and preserves input order.
 */
export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) return [];

    const results = new Array<R>(items.length);
    let next = 0;

    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index]);
        }
    };

    const workers = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: workers }, worker));

    return results;
}
