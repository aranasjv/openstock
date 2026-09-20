import 'server-only';

import type { FlattenMaps } from 'mongoose';
import { connectToDatabase } from '@/database/mongoose';
import { ThesisModel, type Thesis, type ThesisType } from '@/database/models/thesis.model';
import {
    applyTrim,
    canAttachPosition,
    canClose,
    canOpenPosition,
    canTransitionManually,
    canTrim,
    isChronological,
    isTerminal,
    pnlPercent,
    realisedPnl,
    reviewStatus,
    type ThesisLedgerEntry,
    type ThesisStatus,
} from '@/lib/thesis-lifecycle';

/**
 * Thesis and trade-journal storage.
 *
 * Takes an explicit `userId` and resolves no session, exactly like the other `lib/data` modules:
 * the scheduled jobs act as the owner and the assistant tools act as the signed-in user, while the
 * browser-facing wrappers in `lib/actions/thesis.actions.ts` resolve the session first. Nothing here
 * is client-callable.
 *
 * Every lifecycle operation validates against `lib/thesis-lifecycle.ts` before writing, and the
 * ledger append is checked for chronological order on every path. The state machine is the part
 * worth centralising: an illegal transition that reaches Mongo is a journal whose P&L can no longer
 * be reconciled.
 */

/**
 * What a `.lean()` query actually returns — mongoose flattens subdocuments and adds `__v`, so this
 * is not a `Thesis` instance. Declared rather than inferred so the read functions can state a return
 * type without leaking a mongoose expression into every caller's signature.
 */
export type ThesisRecord = FlattenMaps<Thesis> & { _id: unknown; __v?: number };

export type ThesisResult = { ok: true; thesis: Thesis } | { ok: false; error: string };

export interface CreateThesisInput {
    ticker: string;
    assetType: 'stock' | 'crypto';
    thesisType: ThesisType;
    thesisStatement: string;
    evidence?: string[];
    killCriteria?: string[];
    confidenceScore?: number | null;
    entryTargetPrice?: number | null;
    entryConditions?: string[];
    stopLoss?: number | null;
    takeProfit?: number | null;
    timeStopDays?: number | null;
    reviewIntervalDays?: number;
    originSkill?: string;
    originGrade?: string | null;
    originScore?: number | null;
}

/** Append-only, and ordered: a backwards stamp is rejected rather than sorted into place. */
function appendEntry(thesis: Thesis, entry: ThesisLedgerEntry): void {
    if (!isChronological([...thesis.statusHistory, entry])) {
        throw new Error('Status history must stay chronological.');
    }
    if (isTerminal(thesis.status)) {
        throw new Error(`A ${thesis.status} thesis is final.`);
    }
    thesis.statusHistory.push(entry);
    thesis.status = entry.status;
}

function at(value: Date | string | undefined): string {
    const date = value === undefined ? new Date() : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('Invalid date.');
    return date.toISOString();
}

export async function listThesesForUser(userId: string, statuses?: ThesisStatus[]): Promise<ThesisRecord[]> {
    await connectToDatabase();
    const filter: Record<string, unknown> = { userId };
    if (statuses?.length) filter.status = { $in: statuses };
    return ThesisModel.find(filter).sort({ updatedAt: -1 }).limit(500).lean();
}

export async function getThesisForUser(userId: string, thesisId: string): Promise<ThesisRecord | null> {
    await connectToDatabase();
    // `userId` in the filter is the authorisation check, not just a lookup key.
    return ThesisModel.findOne({ _id: thesisId, userId }).lean();
}

export async function createThesisForUser(userId: string, input: CreateThesisInput): Promise<Thesis> {
    await connectToDatabase();

    const now = new Date();
    const interval = input.reviewIntervalDays ?? 30;

    const thesis = await ThesisModel.create({
        userId,
        ticker: input.ticker,
        assetType: input.assetType,
        thesisType: input.thesisType,
        // IDEA is where everything starts — the playbook's `register()` — and it is also the first
        // ledger entry, so the history always explains how the thesis came to exist.
        status: 'IDEA' satisfies ThesisStatus,
        statusHistory: [{ status: 'IDEA', at: now.toISOString(), reason: 'Registered' }],
        thesisStatement: input.thesisStatement,
        evidence: input.evidence ?? [],
        killCriteria: input.killCriteria ?? [],
        confidenceScore: input.confidenceScore ?? null,
        entry: {
            targetPrice: input.entryTargetPrice ?? null,
            conditions: input.entryConditions ?? [],
            actualPrice: null,
            actualDate: null,
        },
        exit: {
            stopLoss: input.stopLoss ?? null,
            takeProfit: input.takeProfit ?? null,
            timeStopDays: input.timeStopDays ?? null,
            actualPrice: null,
            actualDate: null,
            exitReason: null,
        },
        position: null,
        origin: {
            skill: input.originSkill ?? 'manual',
            screeningGrade: input.originGrade ?? null,
            screeningScore: input.originScore ?? null,
        },
        outcome: { pnlDollars: null, pnlPct: null, holdingDays: null, lessonsLearned: null },
        monitoring: {
            reviewIntervalDays: interval,
            // Scheduled from creation, so a thesis that is never touched still surfaces for review.
            nextReviewDate: new Date(now.getTime() + interval * 86_400_000),
            lastReviewDate: null,
            reviewStatus: 'OK',
        },
    });

    return thesis;
}

/** IDEA → ENTRY_READY only; the playbook deliberately blocks every other manual move. */
export async function transitionThesisForUser(
    userId: string,
    thesisId: string,
    to: ThesisStatus,
    reason: string
): Promise<ThesisResult> {
    await connectToDatabase();
    const thesis = await ThesisModel.findOne({ _id: thesisId, userId });
    if (!thesis) return { ok: false, error: 'Thesis not found.' };

    if (!canTransitionManually(thesis.status, to)) {
        return {
            ok: false,
            error: `Cannot move ${thesis.status} to ${to} by hand. Open a position or trim instead.`,
        };
    }

    appendEntry(thesis, { status: to, at: new Date().toISOString(), reason });
    await thesis.save();
    return { ok: true, thesis };
}

/**
 * The only path to ACTIVE. Records the fill and the starting quantity together, because a thesis
 * that claims an open position without a quantity cannot be trimmed or valued later.
 */
export async function openPositionForUser(
    userId: string,
    thesisId: string,
    fill: { price: number; date?: Date | string; shares: number; riskDollars?: number | null; riskPctOfAccount?: number | null; sizingMethod?: string | null }
): Promise<ThesisResult> {
    await connectToDatabase();
    const thesis = await ThesisModel.findOne({ _id: thesisId, userId });
    if (!thesis) return { ok: false, error: 'Thesis not found.' };

    if (!canOpenPosition(thesis.status)) {
        return { ok: false, error: `A position can only be opened from ENTRY_READY, not ${thesis.status}.` };
    }
    if (!(fill.price > 0)) return { ok: false, error: 'Entry price must be positive.' };
    if (!(fill.shares > 0)) return { ok: false, error: 'Share count must be positive.' };

    const when = at(fill.date);
    thesis.entry.actualPrice = fill.price;
    thesis.entry.actualDate = new Date(when);
    thesis.position = {
        shares: fill.shares,
        sharesRemaining: fill.shares,
        riskDollars: fill.riskDollars ?? null,
        riskPctOfAccount: fill.riskPctOfAccount ?? null,
        sizingMethod: fill.sizingMethod ?? null,
    };

    appendEntry(thesis, { status: 'ACTIVE', at: when, reason: `Opened ${fill.shares} at ${fill.price}` });
    await thesis.save();
    return { ok: true, thesis };
}

/** Sizing data only — IDEA, ENTRY_READY or ACTIVE, and never once trimming has begun. */
export async function attachPositionForUser(
    userId: string,
    thesisId: string,
    position: { shares: number; riskDollars?: number | null; riskPctOfAccount?: number | null; sizingMethod?: string | null }
): Promise<ThesisResult> {
    await connectToDatabase();
    const thesis = await ThesisModel.findOne({ _id: thesisId, userId });
    if (!thesis) return { ok: false, error: 'Thesis not found.' };

    if (!canAttachPosition(thesis.status)) {
        return { ok: false, error: `Cannot attach a position to a ${thesis.status} thesis.` };
    }
    if (!(position.shares > 0)) return { ok: false, error: 'Share count must be positive.' };

    const alreadyOpen = thesis.position?.sharesRemaining ?? 0;
    thesis.position = {
        shares: position.shares,
        sharesRemaining: alreadyOpen > 0 ? alreadyOpen : position.shares,
        riskDollars: position.riskDollars ?? null,
        riskPctOfAccount: position.riskPctOfAccount ?? null,
        sizingMethod: position.sizingMethod ?? null,
    };

    await thesis.save();
    return { ok: true, thesis };
}

export async function trimThesisForUser(
    userId: string,
    thesisId: string,
    trim: { sharesSold: number; price: number; date?: Date | string; reason?: string }
): Promise<ThesisResult> {
    await connectToDatabase();
    const thesis = await ThesisModel.findOne({ _id: thesisId, userId });
    if (!thesis) return { ok: false, error: 'Thesis not found.' };

    if (!canTrim(thesis.status)) return { ok: false, error: `Cannot trim a ${thesis.status} thesis.` };

    const entryPrice = thesis.entry.actualPrice ?? null;
    const held = thesis.position?.sharesRemaining ?? null;
    if (entryPrice === null) return { ok: false, error: 'The thesis has no recorded entry price.' };
    if (held === null) return { ok: false, error: 'The thesis has no recorded position.' };

    const result = applyTrim({ entryPrice, sharesRemaining: held, sharesSold: trim.sharesSold, price: trim.price });
    if (!result) return { ok: false, error: 'That trim is not possible against the recorded position.' };

    thesis.position!.sharesRemaining = result.sharesRemaining;

    appendEntry(thesis, {
        status: result.nextStatus,
        at: at(trim.date),
        reason: trim.reason ?? `Trimmed ${trim.sharesSold} at ${trim.price}`,
        sharesSold: trim.sharesSold,
        price: trim.price,
        proceeds: result.proceeds,
        realizedPnl: result.realizedPnl,
    });

    // Selling the whole remainder is a close, so the outcome is filled in here rather than waiting
    // for a separate close() that will never come.
    if (result.nextStatus === 'CLOSED') {
        finaliseOutcome(thesis, trim.date, 'manual');
    }

    await thesis.save();
    return { ok: true, thesis };
}

export async function closeThesisForUser(
    userId: string,
    thesisId: string,
    exit: { price: number; date?: Date | string; reason?: string; exitReason?: 'stop_hit' | 'target_hit' | 'time_stop' | 'invalidated' | 'manual' }
): Promise<ThesisResult> {
    await connectToDatabase();
    const thesis = await ThesisModel.findOne({ _id: thesisId, userId });
    if (!thesis) return { ok: false, error: 'Thesis not found.' };

    if (!canClose(thesis.status)) return { ok: false, error: `Cannot close a ${thesis.status} thesis.` };

    const held = thesis.position?.sharesRemaining ?? 0;
    if (!(exit.price > 0)) return { ok: false, error: 'Exit price must be positive.' };

    if (held > 0) {
        const entryPrice = thesis.entry.actualPrice ?? null;
        if (entryPrice === null) return { ok: false, error: 'The thesis has no recorded entry price.' };

        const result = applyTrim({ entryPrice, sharesRemaining: held, sharesSold: held, price: exit.price })!;
        thesis.position!.sharesRemaining = 0;

        appendEntry(thesis, {
            status: 'CLOSED',
            at: at(exit.date),
            reason: exit.reason ?? `Closed ${held} at ${exit.price}`,
            sharesSold: held,
            price: exit.price,
            proceeds: result.proceeds,
            realizedPnl: result.realizedPnl,
        });
    } else {
        appendEntry(thesis, { status: 'CLOSED', at: at(exit.date), reason: exit.reason ?? 'Closed' });
    }

    finaliseOutcome(thesis, exit.date, exit.exitReason ?? 'manual');
    await thesis.save();
    return { ok: true, thesis };
}

/** Any non-terminal status can be invalidated; terminal ones cannot move at all. */
export async function invalidateThesisForUser(
    userId: string,
    thesisId: string,
    reason: string
): Promise<ThesisResult> {
    await connectToDatabase();
    const thesis = await ThesisModel.findOne({ _id: thesisId, userId });
    if (!thesis) return { ok: false, error: 'Thesis not found.' };

    if (isTerminal(thesis.status)) return { ok: false, error: `A ${thesis.status} thesis is final.` };
    if (!reason.trim()) return { ok: false, error: 'An invalidation needs a reason.' };

    // The position is left as recorded: the thesis was killed, but the shares were not necessarily
    // sold, and quietly zeroing them would invent a fill that never happened.
    appendEntry(thesis, { status: 'INVALIDATED', at: new Date().toISOString(), reason });
    thesis.exit.exitReason = 'invalidated';
    await thesis.save();
    return { ok: true, thesis };
}

/** Theses whose review date has arrived, oldest first. */
export async function reviewDueThesesForUser(userId: string, asOf = new Date()): Promise<ThesisRecord[]> {
    await connectToDatabase();
    return ThesisModel.find({
        userId,
        status: { $nin: ['CLOSED', 'INVALIDATED'] },
        nextReviewDate: { $lte: asOf },
    })
        .sort({ nextReviewDate: 1 })
        .limit(200)
        .lean();
}

export async function markReviewedForUser(userId: string, thesisId: string, asOf = new Date()): Promise<ThesisResult> {
    await connectToDatabase();
    const thesis = await ThesisModel.findOne({ _id: thesisId, userId });
    if (!thesis) return { ok: false, error: 'Thesis not found.' };
    if (isTerminal(thesis.status)) return { ok: false, error: `A ${thesis.status} thesis is final.` };

    const last = thesis.monitoring.lastReviewDate;
    const interval = thesis.monitoring.reviewIntervalDays;
    const daysSince = last ? Math.floor((asOf.getTime() - last.getTime()) / 86_400_000) : interval;

    thesis.monitoring.lastReviewDate = asOf;
    thesis.monitoring.nextReviewDate = new Date(asOf.getTime() + interval * 86_400_000);
    thesis.monitoring.reviewStatus = reviewStatus(daysSince, interval);

    await thesis.save();
    return { ok: true, thesis };
}

/**
 * Cumulative outcome, derived from the ledger rather than accumulated incrementally — so it cannot
 * disagree with the fills that produced it. `pnlPct` is measured against the **original** position,
 * so trimming a winner cannot flatter the percentage.
 */
function finaliseOutcome(
    thesis: Thesis,
    date: Date | string | undefined,
    exitReason: 'stop_hit' | 'target_hit' | 'time_stop' | 'invalidated' | 'manual'
): void {
    const pnl = realisedPnl(thesis.statusHistory);
    const originalShares = thesis.position?.shares ?? null;
    const entryPrice = thesis.entry.actualPrice ?? null;

    thesis.outcome.pnlDollars = pnl;
    thesis.outcome.pnlPct = pnlPercent(pnl, entryPrice, originalShares);
    thesis.exit.exitReason = exitReason;
    thesis.exit.actualPrice = thesis.exit.actualPrice ?? null;
    thesis.exit.actualDate = new Date(at(date));

    const opened = thesis.entry.actualDate;
    if (opened) {
        const exitAt = new Date(at(date));
        thesis.outcome.holdingDays = Math.max(
            0,
            Math.floor((exitAt.getTime() - new Date(opened).getTime()) / 86_400_000)
        );
    }
}
