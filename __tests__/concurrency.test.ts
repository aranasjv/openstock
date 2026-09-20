import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '@/lib/concurrency';

/**
 * This helper exists to stop unbounded fan-out at a vendor, so the property worth testing is not
 * "it returns the right values" — `Promise.all(items.map(...))` already does that — but that it
 * never has more than `limit` calls in flight, and that the results still line up with the input
 * even though completion order does not.
 */
describe('mapWithConcurrency', () => {
    it('preserves input order when the work finishes out of order', async () => {
        // Deliberately inverted: item 1 is the slowest, so completion order is 2, 0, 1.
        const delays = [30, 60, 10];

        const result = await mapWithConcurrency([0, 1, 2], 3, async (index) => {
            await new Promise((resolve) => setTimeout(resolve, delays[index]));
            return index * 10;
        });

        expect(result).toEqual([0, 10, 20]);
    });

    it('never runs more than the limit at once', async () => {
        let live = 0;
        let peak = 0;

        await mapWithConcurrency([...Array(20).keys()], 4, async () => {
            live += 1;
            peak = Math.max(peak, live);
            await new Promise((resolve) => setTimeout(resolve, 5));
            live -= 1;
        });

        expect(peak).toBeLessThanOrEqual(4);
        // Without this the test would also pass for an implementation that did nothing at all.
        expect(peak).toBeGreaterThan(1);
    });

    it('does not start more workers than there are items', async () => {
        let live = 0;
        let peak = 0;

        await mapWithConcurrency([1, 2], 10, async () => {
            live += 1;
            peak = Math.max(peak, live);
            await new Promise((resolve) => setTimeout(resolve, 5));
            live -= 1;
        });

        expect(peak).toBeLessThanOrEqual(2);
    });

    it('returns an empty array without calling the mapper', async () => {
        let calls = 0;

        const result = await mapWithConcurrency([], 4, async () => {
            calls += 1;
        });

        expect(result).toEqual([]);
        expect(calls).toBe(0);
    });

    it('runs strictly in sequence with a limit of one', async () => {
        const order: number[] = [];

        await mapWithConcurrency([1, 2, 3], 1, async (item) => {
            order.push(item);
            await new Promise((resolve) => setTimeout(resolve, 5));
        });

        expect(order).toEqual([1, 2, 3]);
    });

    it('propagates a rejection rather than resolving around it', async () => {
        await expect(
            mapWithConcurrency([1, 2, 3], 2, async (item) => {
                if (item === 2) throw new Error('boom');
                return item;
            })
        ).rejects.toThrow('boom');
    });
});
