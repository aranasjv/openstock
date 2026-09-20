import { describe, it, expect } from 'vitest';
import { sizePosition, stopFromAtr } from '@/lib/position-sizing';

describe('sizePosition', () => {
    it('sizes from the distance to the stop, not from conviction', () => {
        // 1% of 100k is a 1000 budget; a 20.00 stop distance buys 50 shares.
        const result = sizePosition({ equity: 100_000, entry: 100, stop: 80 });

        expect(result.shares).toBe(50);
        expect(result.riskDollars).toBe(1000);
        expect(result.notional).toBe(5000);
        expect(result.bindingConstraint).toBe('risk');
    });

    it('buys fewer shares for the same risk when the stop is wider', () => {
        const tight = sizePosition({ equity: 100_000, entry: 100, stop: 90 });
        const wide = sizePosition({ equity: 100_000, entry: 100, stop: 70 });

        // The point of risk-first sizing: both commit about the same 1000 to being wrong.
        // "About", because shares are whole and the floor only ever rounds down — the budget is
        // a ceiling that cannot be exceeded, not a target that is always hit exactly.
        expect(tight.riskDollars).toBeLessThanOrEqual(1000);
        expect(wide.riskDollars).toBeLessThanOrEqual(1000);
        expect(tight.riskDollars).toBeGreaterThan(1000 - 10);
        expect(wide.riskDollars).toBeGreaterThan(1000 - 30);
        expect(wide.shares).toBeLessThan(tight.shares);
    });

    it('caps the position even when the risk budget would allow more', () => {
        // A 5.00 stop on a 100 stock permits 200 shares by risk, but that is 20k of a 100k
        // account — twice the 10% ceiling. Concentration is a separate limit from risk.
        const result = sizePosition({ equity: 100_000, entry: 100, stop: 95 });

        expect(result.shares).toBe(100);
        expect(result.bindingConstraint).toBe('max-position');
        expect(result.riskDollars).toBe(500);
        expect(result.notes.join(' ')).toMatch(/position ceiling/i);
    });

    it('refuses new risk once the portfolio heat ceiling is reached', () => {
        // 5.8% of 6% is already committed, leaving 0.2% of equity (200) of headroom.
        const result = sizePosition({
            equity: 100_000,
            entry: 100,
            stop: 95,
            currentHeatPercent: 5.8,
        });

        expect(result.shares).toBe(40);
        expect(result.bindingConstraint).toBe('portfolio-heat');
    });

    it('returns zero rather than sizing into a full book', () => {
        const result = sizePosition({
            equity: 100_000,
            entry: 100,
            stop: 95,
            currentHeatPercent: 6,
        });

        expect(result.shares).toBe(0);
        expect(result.notional).toBe(0);
        expect(result.notes.join(' ')).toMatch(/heat ceiling/i);
    });

    it('never rounds up, because rounding up is a silent increase in risk', () => {
        // 200 budget / 16 stop distance = 12.5 shares. Rounding to 13 risks 208, over the plan.
        const result = sizePosition({ equity: 20_000, entry: 100, stop: 84 });

        expect(result.shares).toBe(12);
        expect(result.riskDollars).toBeLessThanOrEqual(200);
    });

    it('explains a zero size differently when the problem is the budget, not the book', () => {
        const result = sizePosition({ equity: 500, entry: 100, stop: 90 });

        expect(result.shares).toBe(0);
        expect(result.notes.join(' ')).toMatch(/smaller than the stop distance/i);
    });

    it('clamps an over-large risk percentage instead of refusing to answer', () => {
        const result = sizePosition({ equity: 100_000, entry: 100, stop: 80, riskPercent: 5 });

        expect(result.notes.join(' ')).toMatch(/capped at 2%/i);
        expect(result.riskDollars).toBeLessThanOrEqual(2000);
    });

    it('refuses to size without a stop', () => {
        const result = sizePosition({ equity: 100_000, entry: 100, stop: 0 });

        expect(result.shares).toBe(0);
        expect(result.bindingConstraint).toBe('none');
        expect(result.notes.join(' ')).toMatch(/stop price is required/i);
    });

    it('refuses a stop at or above the entry rather than returning a negative size', () => {
        const result = sizePosition({ equity: 100_000, entry: 100, stop: 105 });

        expect(result.shares).toBe(0);
        expect(result.notes.join(' ')).toMatch(/long positions only/i);
    });
});

describe('stopFromAtr', () => {
    it('places the stop a multiple of ATR below the entry', () => {
        expect(stopFromAtr(100, 3)).toBe(94);
        expect(stopFromAtr(100, 3, 3)).toBe(91);
    });

    it('returns null rather than a stop at or below zero', () => {
        // A stop under 0 is not a stop, it is a total loss — better to say so.
        expect(stopFromAtr(100, 60)).toBeNull();
    });

    it('returns null for unusable inputs', () => {
        expect(stopFromAtr(100, 0)).toBeNull();
        expect(stopFromAtr(100, Number.NaN)).toBeNull();
        expect(stopFromAtr(0, 3)).toBeNull();
    });
});
