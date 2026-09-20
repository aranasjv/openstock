import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Input validation (A9) and the outbound deadline (A1).
 *
 * Both exist because the action boundary is reachable directly and the network is not
 * trustworthy. They are pure enough to test without a database or a real request.
 */

import { isObjectId, requireNumber, requireOneOf, requireText } from '@/lib/validate';
import { fetchWithTimeout } from '@/lib/http';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('requireText', () => {
    it('trims and returns a valid value', () => {
        expect(requireText('  AAPL  ', 'Symbol')).toBe('AAPL');
    });

    it('rejects a blank value', () => {
        expect(() => requireText('   ', 'Symbol')).toThrow('Symbol is required.');
    });

    it('rejects a non-string', () => {
        expect(() => requireText(42, 'Symbol')).toThrow('Symbol must be text.');
    });

    it('rejects an over-long value rather than truncating it', () => {
        expect(() => requireText('x'.repeat(41), 'Symbol', 40)).toThrow('40 characters or fewer');
    });
});

describe('requireNumber', () => {
    it('accepts a numeric string, because form inputs arrive as strings', () => {
        expect(requireNumber('12.5', 'Target')).toBe(12.5);
    });

    it('rejects NaN and infinity', () => {
        expect(() => requireNumber('abc', 'Target')).toThrow('must be a number');
        expect(() => requireNumber(Number.POSITIVE_INFINITY, 'Target')).toThrow('must be a number');
    });

    it('enforces bounds', () => {
        expect(() => requireNumber(-1, 'Target', { min: 0 })).toThrow('at least 0');
        expect(() => requireNumber(101, 'Target', { max: 100 })).toThrow('at most 100');
    });
});

describe('requireOneOf', () => {
    it('accepts an allowed value', () => {
        expect(requireOneOf('crypto', 'Asset type', ['stock', 'crypto'] as const)).toBe('crypto');
    });

    it('rejects anything else, including wrong types', () => {
        expect(() => requireOneOf('bonds', 'Asset type', ['stock', 'crypto'] as const)).toThrow(
            'must be one of: stock, crypto'
        );
        expect(() => requireOneOf(7, 'Asset type', ['stock'] as const)).toThrow('must be one of');
    });
});

describe('isObjectId', () => {
    it('accepts a 24-character hex id', () => {
        expect(isObjectId('507f1f77bcf86cd799439011')).toBe(true);
    });

    it('rejects the shapes that make Mongoose throw a CastError', () => {
        for (const value of ['', 'abc', 'not-an-id', '507f1f77bcf86cd79943901', undefined, 42]) {
            expect(isObjectId(value)).toBe(false);
        }
    });
});

describe('fetchWithTimeout', () => {
    it('aborts a stalled request, names the cause, and does not leak the URL', async () => {
        vi.stubGlobal(
            'fetch',
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => {
                        const error = new Error('aborted');
                        error.name = 'AbortError';
                        reject(error);
                    });
                })
        );

        const error = await fetchWithTimeout(
            'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=SUPERSECRET',
            {},
            20
        ).then(
            () => null,
            (reason: unknown) => reason as Error
        );

        expect(error).toBeInstanceOf(Error);
        expect(error?.message).toContain('timed out after 20ms');
        // The Gemini endpoint carries the API key in its query string, and this message is
        // logged and surfaced — so the URL must never appear in it.
        expect(error?.message).not.toContain('SUPERSECRET');
        expect(error?.message).not.toContain('http');
    });

    it('propagates a genuine network error unchanged', async () => {
        vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));

        await expect(fetchWithTimeout('https://api.example.com')).rejects.toThrow('ECONNREFUSED');
    });

    it('returns the response and forwards the caller’s init', async () => {
        const response = { ok: true } as Response;
        const fetchMock = vi.fn().mockResolvedValue(response);
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchWithTimeout('https://api.example.com', {
            method: 'POST',
            cache: 'no-store',
        });

        expect(result).toBe(response);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', cache: 'no-store' });
        // A signal is always attached, or the deadline would not apply.
        expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });
});
