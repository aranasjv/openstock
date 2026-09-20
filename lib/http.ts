/**
 * Outbound HTTP with a deadline.
 *
 * Every outbound call needs a bound. Without one a hung upstream holds the request — or a
 * cron tick — open until the platform kills the process, and it presents as a hang rather
 * than as an error, so nothing logs and nothing retries.
 *
 * CoinGecko, Yahoo, Telegram and Adanos each grew their own `AbortController`; this is the
 * shared version the rest now use.
 */

/** Data APIs are expected to answer quickly. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** A model call legitimately takes longer than a data fetch — a long generation is not a hang. */
export const AI_TIMEOUT_MS = 60_000;

export async function fetchWithTimeout(
    input: string | URL,
    // Next augments the global RequestInit with its `next: { revalidate }` cache option, so
    // this needs no extra type and re-declaring it would narrow `revalidate` to a number and
    // reject a perfectly valid call.
    init: RequestInit = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
        // An abort surfaces as a bare AbortError, which reads like a bug rather than a slow
        // upstream, so name the cause.
        //
        // The URL is deliberately not included: the Gemini endpoint carries `?key=<api key>`
        // in its query string, and these messages end up in logs and in error surfaces.
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`Upstream request timed out after ${timeoutMs}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}
