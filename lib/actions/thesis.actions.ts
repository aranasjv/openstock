'use server';

import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/session';
import { THESIS_TYPES, type Thesis } from '@/database/models/thesis.model';
import {
    attachPositionForUser,
    closeThesisForUser,
    createThesisForUser,
    getThesisForUser,
    invalidateThesisForUser,
    listThesesForUser,
    markReviewedForUser,
    openPositionForUser,
    reviewDueThesesForUser,
    transitionThesisForUser,
    trimThesisForUser,
    type ThesisRecord,
    type ThesisResult,
} from '@/lib/data/theses';
import { THESIS_STATUSES, type ThesisStatus } from '@/lib/thesis-lifecycle';
import { requireNumber, requireOneOf, requireText } from '@/lib/validate';

/**
 * The journal, as callable server actions.
 *
 * Each action resolves the session and passes *that* userId down — the browser never supplies an
 * identity, so one user cannot read or write another's journal. The data layer
 * (`lib/data/theses.ts`) keeps the explicit userId for callers that legitimately act for someone
 * else: scheduled jobs acting as the owner, and the assistant tools acting as the signed-in user.
 *
 * Lifecycle legality is enforced in the data layer, not here, so every caller gets the same rules.
 */

const REVALIDATE = '/journal';

/** Tickers and coin ids are short; a thesis statement is prose and gets real room. */
const MAX_TICKER_LENGTH = 32;
const MAX_STATEMENT_LENGTH = 2000;

function optionalNumber(value: unknown, field: string): number | null {
    if (value === undefined || value === null || value === '') return null;
    return requireNumber(value, field, { min: 0 });
}

export async function listTheses(statuses?: unknown): Promise<ThesisRecord[]> {
    const userId = await requireUserId();

    // An unrecognised filter is dropped rather than rejected: it comes from a query string, and a
    // stale bookmark should list everything rather than error the page.
    const wanted = Array.isArray(statuses)
        ? THESIS_STATUSES.filter((status) => statuses.includes(status))
        : undefined;

    return listThesesForUser(userId, wanted);
}

export async function getThesis(thesisId: string): Promise<ThesisRecord | null> {
    const userId = await requireUserId();
    return getThesisForUser(userId, requireText(thesisId, 'Thesis id', 64));
}

export async function createThesis(input: {
    ticker: unknown;
    assetType: unknown;
    thesisType: unknown;
    thesisStatement: unknown;
    evidence?: unknown;
    killCriteria?: unknown;
    confidenceScore?: unknown;
    entryTargetPrice?: unknown;
    stopLoss?: unknown;
    takeProfit?: unknown;
    originSkill?: unknown;
    originGrade?: unknown;
    originScore?: unknown;
}): Promise<Thesis> {
    const userId = await requireUserId();

    const strings = (value: unknown): string[] =>
        Array.isArray(value)
            ? value.map((item) => requireText(item, 'Entry', 300)).filter(Boolean)
            : [];

    const thesis = await createThesisForUser(userId, {
        ticker: requireText(input.ticker, 'Ticker', MAX_TICKER_LENGTH),
        assetType: requireOneOf(input.assetType, 'Asset type', ['stock', 'crypto'] as const),
        thesisType: requireOneOf(input.thesisType, 'Thesis type', THESIS_TYPES),
        thesisStatement: requireText(input.thesisStatement, 'Thesis statement', MAX_STATEMENT_LENGTH),
        evidence: strings(input.evidence),
        killCriteria: strings(input.killCriteria),
        confidenceScore: optionalNumber(input.confidenceScore, 'Confidence'),
        entryTargetPrice: optionalNumber(input.entryTargetPrice, 'Entry target'),
        stopLoss: optionalNumber(input.stopLoss, 'Stop loss'),
        takeProfit: optionalNumber(input.takeProfit, 'Take profit'),
        originSkill: typeof input.originSkill === 'string' ? requireText(input.originSkill, 'Origin', 60) : 'manual',
        originGrade: typeof input.originGrade === 'string' ? requireText(input.originGrade, 'Grade', 40) : null,
        originScore: optionalNumber(input.originScore, 'Score'),
    });

    revalidatePath(REVALIDATE);
    return thesis;
}

export async function transitionThesis(thesisId: string, to: unknown, reason: unknown): Promise<ThesisResult> {
    const userId = await requireUserId();
    const result = await transitionThesisForUser(
        userId,
        requireText(thesisId, 'Thesis id', 64),
        requireOneOf(to, 'Status', THESIS_STATUSES) as ThesisStatus,
        requireText(reason, 'Reason', 300)
    );
    if (result.ok) revalidatePath(REVALIDATE);
    return result;
}

export async function openThesisPosition(
    thesisId: string,
    fill: { price: unknown; shares: unknown; date?: unknown; riskDollars?: unknown }
): Promise<ThesisResult> {
    const userId = await requireUserId();
    const result = await openPositionForUser(userId, requireText(thesisId, 'Thesis id', 64), {
        price: requireNumber(fill.price, 'Entry price', { min: 0.0000001 }),
        shares: requireNumber(fill.shares, 'Shares', { min: 0.0000001 }),
        date: typeof fill.date === 'string' && fill.date ? fill.date : undefined,
        riskDollars: optionalNumber(fill.riskDollars, 'Risk'),
        sizingMethod: 'position-sizing',
    });
    if (result.ok) revalidatePath(REVALIDATE);
    return result;
}

export async function attachThesisPosition(
    thesisId: string,
    position: { shares: unknown; riskDollars?: unknown; riskPctOfAccount?: unknown }
): Promise<ThesisResult> {
    const userId = await requireUserId();
    const result = await attachPositionForUser(userId, requireText(thesisId, 'Thesis id', 64), {
        shares: requireNumber(position.shares, 'Shares', { min: 0.0000001 }),
        riskDollars: optionalNumber(position.riskDollars, 'Risk'),
        riskPctOfAccount: optionalNumber(position.riskPctOfAccount, 'Risk percent'),
        sizingMethod: 'position-sizing',
    });
    if (result.ok) revalidatePath(REVALIDATE);
    return result;
}

export async function trimThesis(
    thesisId: string,
    trim: { sharesSold: unknown; price: unknown; date?: unknown; reason?: unknown }
): Promise<ThesisResult> {
    const userId = await requireUserId();
    const result = await trimThesisForUser(userId, requireText(thesisId, 'Thesis id', 64), {
        sharesSold: requireNumber(trim.sharesSold, 'Shares sold', { min: 0.0000001 }),
        price: requireNumber(trim.price, 'Price', { min: 0.0000001 }),
        date: typeof trim.date === 'string' && trim.date ? trim.date : undefined,
        reason: typeof trim.reason === 'string' && trim.reason ? trim.reason : undefined,
    });
    if (result.ok) revalidatePath(REVALIDATE);
    return result;
}

export async function closeThesis(
    thesisId: string,
    exit: { price: unknown; date?: unknown; reason?: unknown; exitReason?: unknown }
): Promise<ThesisResult> {
    const userId = await requireUserId();
    const result = await closeThesisForUser(userId, requireText(thesisId, 'Thesis id', 64), {
        price: requireNumber(exit.price, 'Exit price', { min: 0.0000001 }),
        date: typeof exit.date === 'string' && exit.date ? exit.date : undefined,
        reason: typeof exit.reason === 'string' && exit.reason ? requireText(exit.reason, 'Reason', 300) : undefined,
        exitReason:
            typeof exit.exitReason === 'string'
                ? requireOneOf(exit.exitReason, 'Exit reason', ['stop_hit', 'target_hit', 'time_stop', 'invalidated', 'manual'] as const)
                : undefined,
    });
    if (result.ok) revalidatePath(REVALIDATE);
    return result;
}

export async function invalidateThesis(thesisId: string, reason: unknown): Promise<ThesisResult> {
    const userId = await requireUserId();
    const result = await invalidateThesisForUser(
        userId,
        requireText(thesisId, 'Thesis id', 64),
        requireText(reason, 'Reason', 300)
    );
    if (result.ok) revalidatePath(REVALIDATE);
    return result;
}

export async function listDueTheses(): Promise<ThesisRecord[]> {
    const userId = await requireUserId();
    return reviewDueThesesForUser(userId);
}

export async function markThesisReviewed(thesisId: string): Promise<ThesisResult> {
    const userId = await requireUserId();
    const result = await markReviewedForUser(userId, requireText(thesisId, 'Thesis id', 64));
    if (result.ok) revalidatePath(REVALIDATE);
    return result;
}
