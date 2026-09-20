/**
 * Thesis lifecycle — the state machine from `.agents/skills/trader-memory-core`.
 *
 * Pure, because this is the part whose rules are easy to get subtly wrong and expensive to get
 * wrong quietly: a journal that permits `CLOSED → ACTIVE` produces a P&L history that can never be
 * reconciled, and one that lets a position be re-attached after a trim corrupts the very ledger the
 * cumulative P&L is summed from. The playbook is explicit that transitions are forward-only, so the
 * machine is transcribed from `references/thesis_lifecycle.md` rather than inferred here.
 */

export const THESIS_STATUSES = [
    'IDEA',
    'ENTRY_READY',
    'ACTIVE',
    'PARTIALLY_CLOSED',
    'CLOSED',
    'INVALIDATED',
] as const;

export type ThesisStatus = (typeof THESIS_STATUSES)[number];

/** Terminal states have no exits at all — not even to each other. */
export const TERMINAL_STATUSES: readonly ThesisStatus[] = ['CLOSED', 'INVALIDATED'];

export function isTerminal(status: ThesisStatus): boolean {
    return TERMINAL_STATUSES.includes(status);
}

/**
 * The legal graph. Note `PARTIALLY_CLOSED → PARTIALLY_CLOSED`, which is not a self-loop by mistake:
 * further trims are legal, so the status can be re-stamped with another ledger entry.
 */
const LEGAL_TRANSITIONS: Record<ThesisStatus, readonly ThesisStatus[]> = {
    IDEA: ['ENTRY_READY', 'INVALIDATED'],
    ENTRY_READY: ['ACTIVE', 'INVALIDATED'],
    ACTIVE: ['PARTIALLY_CLOSED', 'CLOSED', 'INVALIDATED'],
    PARTIALLY_CLOSED: ['PARTIALLY_CLOSED', 'CLOSED', 'INVALIDATED'],
    CLOSED: [],
    INVALIDATED: [],
};

export function isLegalTransition(from: ThesisStatus, to: ThesisStatus): boolean {
    return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * The status changes each operation is allowed to make. The playbook restricts these well beyond
 * the graph — `transition()` reaches ENTRY_READY and nothing else, because ACTIVE requires entry
 * data and PARTIALLY_CLOSED requires a ledger entry. Allowing a bare status change to reach either
 * would produce a thesis that claims a position it has no record of opening.
 */
export function canTransitionManually(from: ThesisStatus, to: ThesisStatus): boolean {
    return from === 'IDEA' && to === 'ENTRY_READY';
}

export function canOpenPosition(status: ThesisStatus): boolean {
    // The only path to ACTIVE, and it requires an actual price and date.
    return status === 'ENTRY_READY';
}

export function canAttachPosition(status: ThesisStatus): boolean {
    // Rejected once trimming has begun: overwriting `shares` mid-ledger would invalidate every
    // realised P&L already recorded against it.
    return status === 'IDEA' || status === 'ENTRY_READY' || status === 'ACTIVE';
}

export function canTrim(status: ThesisStatus): boolean {
    return status === 'ACTIVE' || status === 'PARTIALLY_CLOSED';
}

export function canClose(status: ThesisStatus): boolean {
    return status === 'ACTIVE' || status === 'PARTIALLY_CLOSED';
}

export interface ThesisLedgerEntry {
    status: ThesisStatus;
    at: string;
    reason: string;
    sharesSold?: number;
    price?: number;
    proceeds?: number;
    realizedPnl?: number;
}

/**
 * Cumulative realised P&L across every trim and the final close. Absent values count as zero, so a
 * thesis that was invalidated before any fill contributes nothing rather than breaking the sum.
 */
export function realisedPnl(history: readonly ThesisLedgerEntry[]): number {
    return round2(history.reduce((sum, entry) => sum + (entry.realizedPnl ?? 0), 0));
}

/**
 * Return on the **original** position, not on what is still open — so trimming a winner cannot
 * flatter the percentage, and the figure stays comparable across a partially closed position and
 * one that ran to the end.
 */
export function pnlPercent(
    pnlDollars: number,
    entryPrice: number | null,
    originalShares: number | null
): number | null {
    if (entryPrice === null || originalShares === null) return null;
    const basis = entryPrice * originalShares;
    if (!(basis > 0)) return null;
    return round2((pnlDollars / basis) * 100);
}

/**
 * Chronological order is checked on save because the ledger is the audit trail. A history whose
 * timestamps go backwards cannot be read as a sequence of events, and the playbook's own
 * `--event-date` machinery exists precisely to keep this true when backfilling.
 */
export function isChronological(history: readonly ThesisLedgerEntry[]): boolean {
    for (let index = 1; index < history.length; index++) {
        if (Date.parse(history[index].at) < Date.parse(history[index - 1].at)) return false;
    }
    return true;
}

export interface TrimInput {
    entryPrice: number;
    sharesRemaining: number;
    sharesSold: number;
    price: number;
}

export interface TrimResult {
    sharesRemaining: number;
    proceeds: number;
    realizedPnl: number;
    nextStatus: ThesisStatus;
}

/**
 * Apply a trim. Returns null for an impossible one rather than clamping: selling more than is held,
 * or at a non-positive price, is a caller bug that must surface rather than be silently rounded into
 * a plausible ledger entry.
 */
export function applyTrim(input: TrimInput): TrimResult | null {
    const { entryPrice, sharesRemaining, sharesSold, price } = input;

    if (!(entryPrice > 0) || !(price > 0)) return null;
    if (!(sharesSold > 0) || sharesSold > sharesRemaining) return null;

    const remaining = sharesRemaining - sharesSold;

    return {
        sharesRemaining: remaining,
        proceeds: round2(sharesSold * price),
        realizedPnl: round2(sharesSold * (price - entryPrice)),
        // Selling the entire remainder closes the thesis; anything less leaves it partially closed.
        nextStatus: remaining === 0 ? 'CLOSED' : 'PARTIALLY_CLOSED',
    };
}

export type ReviewStatus = 'OK' | 'WARN' | 'REVIEW';

/**
 * The escalation ladder: on time, then late, then overdue at twice the interval. Two thresholds
 * rather than one so a thesis that has slipped a day is distinguishable from one nobody has looked
 * at in two months.
 */
export function reviewStatus(daysSinceReview: number, intervalDays: number): ReviewStatus {
    if (!(intervalDays > 0)) return 'REVIEW';
    if (daysSinceReview <= intervalDays) return 'OK';
    if (daysSinceReview <= intervalDays * 2) return 'WARN';
    return 'REVIEW';
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}
