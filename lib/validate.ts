/**
 * Input validation at the action boundary.
 *
 * Server actions are reachable directly, so everything they receive is untrusted — including
 * input from a signed-in user's own browser, which can be edited.
 *
 * Validation used to be inconsistent: the assistant capped message length, while watchlist,
 * holdings and alert inputs went straight to Mongoose. These helpers make the boundary
 * uniform, and they throw, so a bad payload fails the call instead of writing a malformed
 * document that is then hard to explain.
 */

/** Symbols, coin ids, company names, conversation titles. */
export const MAX_TEXT_LENGTH = 120;

/** Ticker symbols and CoinGecko ids are short; anything longer is not one. */
export const MAX_SYMBOL_LENGTH = 40;

/**
 * Ceiling on any list returned to a client.
 *
 * Nothing bounded these before: a watchlist, holdings list or alert list returned however many
 * rows the account had accumulated, and every one of them is serialised into the payload of
 * each page that renders it. A cap far above any realistic portfolio still means the failure
 * mode is a truncated list rather than a page that grows without limit.
 */
export const MAX_LIST_ITEMS = 500;

export function requireText(value: unknown, field: string, maxLength = MAX_TEXT_LENGTH): string {
    if (typeof value !== 'string') throw new Error(`${field} must be text.`);

    const trimmed = value.trim();
    if (!trimmed) throw new Error(`${field} is required.`);
    if (trimmed.length > maxLength) {
        throw new Error(`${field} must be ${maxLength} characters or fewer.`);
    }

    return trimmed;
}

export function requireNumber(
    value: unknown,
    field: string,
    bounds: { min?: number; max?: number } = {}
): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${field} must be a number.`);
    if (bounds.min !== undefined && parsed < bounds.min) {
        throw new Error(`${field} must be at least ${bounds.min}.`);
    }
    if (bounds.max !== undefined && parsed > bounds.max) {
        throw new Error(`${field} must be at most ${bounds.max}.`);
    }

    return parsed;
}

export function requireOneOf<T extends string>(
    value: unknown,
    field: string,
    allowed: readonly T[]
): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
        throw new Error(`${field} must be one of: ${allowed.join(', ')}.`);
    }

    return value as T;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

/**
 * Mongo's `_id` shape.
 *
 * A malformed id makes Mongoose throw a `CastError` from deep inside the query, which
 * surfaces to the user as an opaque 500. Checking at the boundary turns it into a plain
 * "not found", which is also the honest answer: a wrong-shaped id cannot match anything.
 */
export function isObjectId(value: unknown): value is string {
    return typeof value === 'string' && OBJECT_ID.test(value);
}
