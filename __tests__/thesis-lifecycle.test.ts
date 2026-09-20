import { describe, it, expect } from 'vitest';
import {
    THESIS_STATUSES,
    TERMINAL_STATUSES,
    applyTrim,
    canAttachPosition,
    canClose,
    canOpenPosition,
    canTransitionManually,
    canTrim,
    isChronological,
    isLegalTransition,
    isTerminal,
    pnlPercent,
    realisedPnl,
    reviewStatus,
    type ThesisLedgerEntry,
    type ThesisStatus,
} from '@/lib/thesis-lifecycle';

/** The graph from the playbook, written out so a change to it has to be a deliberate edit here too. */
const LEGAL: Record<ThesisStatus, ThesisStatus[]> = {
    IDEA: ['ENTRY_READY', 'INVALIDATED'],
    ENTRY_READY: ['ACTIVE', 'INVALIDATED'],
    ACTIVE: ['PARTIALLY_CLOSED', 'CLOSED', 'INVALIDATED'],
    PARTIALLY_CLOSED: ['PARTIALLY_CLOSED', 'CLOSED', 'INVALIDATED'],
    CLOSED: [],
    INVALIDATED: [],
};

describe('thesis lifecycle', () => {
    it('allows exactly the documented transitions and nothing else', () => {
        for (const from of THESIS_STATUSES) {
            for (const to of THESIS_STATUSES) {
                expect(isLegalTransition(from, to), `${from} -> ${to}`).toBe(LEGAL[from].includes(to));
            }
        }
    });

    it('blocks every reverse transition', () => {
        // The specific moves the playbook names, plus the general shape.
        expect(isLegalTransition('ACTIVE', 'IDEA')).toBe(false);
        expect(isLegalTransition('CLOSED', 'ACTIVE')).toBe(false);
        expect(isLegalTransition('PARTIALLY_CLOSED', 'ACTIVE')).toBe(false);
        expect(isLegalTransition('ENTRY_READY', 'IDEA')).toBe(false);
    });

    it('treats terminal states as terminal', () => {
        for (const terminal of TERMINAL_STATUSES) {
            expect(isTerminal(terminal)).toBe(true);
            // No exits at all — not to each other either.
            for (const to of THESIS_STATUSES) {
                expect(isLegalTransition(terminal, to), `${terminal} -> ${to}`).toBe(false);
            }
        }
        expect(isTerminal('ACTIVE')).toBe(false);
        expect(isTerminal('PARTIALLY_CLOSED')).toBe(false);
    });

    it('lets any non-terminal status be invalidated', () => {
        const nonTerminal = THESIS_STATUSES.filter((status) => !isTerminal(status));
        for (const status of nonTerminal) {
            expect(isLegalTransition(status, 'INVALIDATED'), status).toBe(true);
        }
    });

    it('keeps a manual transition to IDEA -> ENTRY_READY only', () => {
        expect(canTransitionManually('IDEA', 'ENTRY_READY')).toBe(true);

        // Reaching ACTIVE or PARTIALLY_CLOSED is the job of open_position/trim, which carry the data
        // those states claim to have. A bare status change would produce a thesis that says it holds
        // a position it has no record of opening.
        expect(canTransitionManually('IDEA', 'ACTIVE')).toBe(false);
        expect(canTransitionManually('ENTRY_READY', 'ACTIVE')).toBe(false);
        expect(canTransitionManually('ENTRY_READY', 'PARTIALLY_CLOSED')).toBe(false);
    });

    it('gates each operation on the status the playbook requires', () => {
        expect(canOpenPosition('ENTRY_READY')).toBe(true);
        expect(canOpenPosition('IDEA')).toBe(false);

        expect(canAttachPosition('IDEA')).toBe(true);
        expect(canAttachPosition('ENTRY_READY')).toBe(true);
        expect(canAttachPosition('ACTIVE')).toBe(true);
        // Rejected once trimming has begun: overwriting `shares` would invalidate every realised
        // figure already recorded against it.
        expect(canAttachPosition('PARTIALLY_CLOSED')).toBe(false);
        expect(canAttachPosition('CLOSED')).toBe(false);
        expect(canAttachPosition('INVALIDATED')).toBe(false);

        expect(canTrim('ACTIVE')).toBe(true);
        expect(canTrim('PARTIALLY_CLOSED')).toBe(true);
        expect(canTrim('IDEA')).toBe(false);

        expect(canClose('ACTIVE')).toBe(true);
        expect(canClose('PARTIALLY_CLOSED')).toBe(true);
        expect(canClose('ENTRY_READY')).toBe(false);
    });
});

describe('applyTrim', () => {
    it('leaves the thesis partially closed when some shares remain', () => {
        const trim = applyTrim({ entryPrice: 100, sharesRemaining: 100, sharesSold: 40, price: 120 });
        expect(trim).toEqual({
            sharesRemaining: 60,
            proceeds: 4800,
            realizedPnl: 800,
            nextStatus: 'PARTIALLY_CLOSED',
        });
    });

    it('closes the thesis when the remainder is sold', () => {
        const trim = applyTrim({ entryPrice: 100, sharesRemaining: 60, sharesSold: 60, price: 90 });
        expect(trim?.sharesRemaining).toBe(0);
        expect(trim?.realizedPnl).toBe(-600);
        // Selling the entire remainder is a close, not a partial close.
        expect(trim?.nextStatus).toBe('CLOSED');
    });

    it('refuses an impossible trim instead of clamping it', () => {
        // Selling more than is held, or at a nonsensical price, is a caller bug. Silently rounding it
        // into a plausible ledger entry would corrupt the P&L sum it feeds.
        expect(applyTrim({ entryPrice: 100, sharesRemaining: 10, sharesSold: 11, price: 120 })).toBeNull();
        expect(applyTrim({ entryPrice: 100, sharesRemaining: 10, sharesSold: 0, price: 120 })).toBeNull();
        expect(applyTrim({ entryPrice: 100, sharesRemaining: 10, sharesSold: 5, price: 0 })).toBeNull();
        expect(applyTrim({ entryPrice: 0, sharesRemaining: 10, sharesSold: 5, price: 120 })).toBeNull();
    });
});

describe('cumulative outcome', () => {
    const first = applyTrim({ entryPrice: 100, sharesRemaining: 100, sharesSold: 40, price: 120 })!;
    const second = applyTrim({ entryPrice: 100, sharesRemaining: 60, sharesSold: 60, price: 90 })!;

    const history: ThesisLedgerEntry[] = [
        { status: 'ACTIVE', at: '2026-01-01T00:00:00Z', reason: 'opened' },
        {
            status: 'PARTIALLY_CLOSED',
            at: '2026-02-01T00:00:00Z',
            reason: 'trim',
            sharesSold: 40,
            price: 120,
            realizedPnl: first.realizedPnl,
        },
        {
            status: 'CLOSED',
            at: '2026-03-01T00:00:00Z',
            reason: 'closed',
            sharesSold: 60,
            price: 90,
            realizedPnl: second.realizedPnl,
        },
    ];

    it('sums every ledger entry, trim and close alike', () => {
        expect(realisedPnl(history)).toBe(200);
    });

    it('ignores entries that carry no realised figure', () => {
        // A thesis invalidated before any fill contributes nothing rather than breaking the sum.
        expect(realisedPnl([{ status: 'IDEA', at: '2026-01-01T00:00:00Z', reason: 'screened' }])).toBe(0);
    });

    it('measures return against the original position, not the open remainder', () => {
        // Two trims on 100 shares at an average entry of 100: 200 / 10,000.
        expect(pnlPercent(200, 100, 100)).toBe(2);
    });

    it('returns null rather than a divide-by-zero when the basis is unusable', () => {
        expect(pnlPercent(200, null, 100)).toBeNull();
        expect(pnlPercent(200, 100, null)).toBeNull();
        expect(pnlPercent(200, 100, 0)).toBeNull();
    });

    it('accepts a chronological ledger', () => {
        expect(isChronological(history)).toBe(true);
    });

    it('rejects a ledger whose timestamps go backwards', () => {
        // The ledger is the audit trail; a history that cannot be read as a sequence of events is not
        // one. This is the check the playbook's --event-date machinery exists to keep satisfiable.
        expect(isChronological([...history].reverse())).toBe(false);
    });

    it('allows two entries at the same instant', () => {
        // Backdating an existing broker position legitimately stamps several statuses with one date.
        const sameInstant: ThesisLedgerEntry[] = [
            { status: 'IDEA', at: '2026-01-01T00:00:00Z', reason: 'a' },
            { status: 'ENTRY_READY', at: '2026-01-01T00:00:00Z', reason: 'b' },
        ];
        expect(isChronological(sameInstant)).toBe(true);
    });
});

describe('reviewStatus', () => {
    it('escalates on time, then late, then overdue', () => {
        expect(reviewStatus(10, 30)).toBe('OK');
        expect(reviewStatus(30, 30)).toBe('OK');
        expect(reviewStatus(31, 30)).toBe('WARN');
        expect(reviewStatus(60, 30)).toBe('WARN');
        expect(reviewStatus(61, 30)).toBe('REVIEW');
    });

    it('treats a missing interval as overdue rather than on time', () => {
        expect(reviewStatus(0, 0)).toBe('REVIEW');
        expect(reviewStatus(0, -5)).toBe('REVIEW');
    });
});
