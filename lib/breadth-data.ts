import 'server-only';

import { loadConfig } from '@/lib/config';
import { fetchWithTimeout } from '@/lib/http';
import { parseBreadthCsv, parseBreadthSummary, type BreadthRow } from '@/lib/breadth-csv';
import { assessBreadth, type BreadthAssessment } from '@/lib/breadth-components';

/**
 * Fetches the market-breadth series published by the `market-breadth-analyzer` skill's upstream
 * project.
 *
 * This is the one input the app cannot compute itself: the breadth index is the share of S&P 500
 * constituents above their 200-day average, which needs the constituents' own histories. The skill
 * publishes the computed series as CSV on GitHub Pages and the playbook points at it explicitly, so
 * fetching it is following the methodology rather than substituting for it.
 *
 * Three things the shape of this file is trying to say:
 * - **It is a third-party URL**, so both the URL and the cache window are configurable: if the host
 *   moves, that is a setting rather than a release.
 * - **A failure returns null, not an empty series.** An empty array would make "the host is down"
 *   indistinguishable from "breadth is zero", and the composite would score the latter.
 * - **Cached for an hour.** The series is daily and the upstream rebuilds on its own schedule; a
 *   page render has no business refetching 2,500 rows to answer the same question.
 */

const DEFAULT_DETAIL_URL = 'https://tradermonty.github.io/market-breadth-analysis/market_breadth_data.csv';
const DEFAULT_SUMMARY_URL = 'https://tradermonty.github.io/market-breadth-analysis/market_breadth_summary.csv';

const REVALIDATE_SECONDS = 3_600;
const FETCH_TIMEOUT_MS = 20_000;

async function urls(): Promise<{ detail: string; summary: string }> {
    const config = await loadConfig();
    return {
        detail: config.BREADTH_DETAIL_URL || DEFAULT_DETAIL_URL,
        summary: config.BREADTH_SUMMARY_URL || DEFAULT_SUMMARY_URL,
    };
}

/**
 * undici reports every network failure as a bare "fetch failed" and puts the reason on `cause`.
 * Without it the log cannot distinguish an unreachable host from an unresolvable one — which is the
 * difference between waiting for the upstream and fixing our own networking.
 */
function describeError(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    const cause = error.cause;
    const detail = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
    return detail ? `${error.message} (${detail})` : error.message;
}

/** Daily rows, oldest first, or null when the source could not be read. */
export async function fetchBreadthSeries(): Promise<BreadthRow[] | null> {
    try {
        const { detail } = await urls();
        const response = await fetchWithTimeout(
            detail,
            { next: { revalidate: REVALIDATE_SECONDS } },
            FETCH_TIMEOUT_MS
        );

        if (!response.ok) {
            console.warn(`Breadth: detail CSV responded ${response.status}`);
            return null;
        }

        const rows = parseBreadthCsv(await response.text());
        return rows.length > 0 ? rows : null;
    } catch (error) {
        console.warn('Breadth: could not read the detail CSV:', describeError(error));
        return null;
    }
}

export async function fetchBreadthSummary(): Promise<Record<string, string> | null> {
    try {
        const { summary } = await urls();
        const response = await fetchWithTimeout(
            summary,
            { next: { revalidate: REVALIDATE_SECONDS } },
            FETCH_TIMEOUT_MS
        );

        if (!response.ok) return null;

        const parsed = parseBreadthSummary(await response.text());
        return Object.keys(parsed).length > 0 ? parsed : null;
    } catch (error) {
        console.warn('Breadth: could not read the summary CSV:', describeError(error));
        return null;
    }
}

export interface BreadthReport extends BreadthAssessment {
    asOf: string;
    /** How much history the reading is built on. */
    rows: number;
    period: { from: string; to: string } | null;
}

/**
 * The whole breadth reading, or null when the source could not be read.
 *
 * **null rather than a defaulted "Neutral 50"**, for the same reason the fetchers return null rather
 * than an empty array: a defaulted reading is indistinguishable from a measured one, and this number
 * is meant to inform exposure. A caller that cannot tell those apart will treat a broken feed as a
 * neutral market, which is the one input that looks safe and is not.
 *
 * The summary is optional — components 1-4 and 6 need only the daily rows, and only C5 uses the
 * historical averages — so a summary failure degrades one component instead of the whole reading.
 */
export async function marketBreadthReport(): Promise<BreadthReport | null> {
    const [rows, summary] = await Promise.all([fetchBreadthSeries(), fetchBreadthSummary()]);
    if (!rows) return null;

    return {
        ...assessBreadth(rows, summary ?? {}),
        asOf: new Date().toISOString(),
        rows: rows.length,
        period: { from: rows[0].date, to: rows[rows.length - 1].date },
    };
}
