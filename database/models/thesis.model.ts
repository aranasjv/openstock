import { Schema, model, models, type Document, type Model } from 'mongoose';
import { THESIS_STATUSES, type ThesisLedgerEntry, type ThesisStatus } from '@/lib/thesis-lifecycle';

/**
 * A tracked trading thesis.
 *
 * The shape is the `trader-memory-core` schema reduced to what this app can actually populate. The
 * futures and contract-spec fields are gone because the app holds spot stocks and crypto, and the
 * file-oriented ones (`origin.output_file`, `linked_reports`) are gone because there are no report
 * files here — a thesis originates from a screener run, and that is recorded inline.
 *
 * `statusHistory` is the audit trail and is **append-only**. Cumulative P&L is derived from the
 * ledger on read rather than stored alongside it, so the two cannot disagree about what happened.
 */

export const THESIS_TYPES = [
    'dividend_income',
    'growth_momentum',
    'mean_reversion',
    'earnings_drift',
    'pivot_breakout',
] as const;

export type ThesisType = (typeof THESIS_TYPES)[number];

export const EXIT_REASONS = ['stop_hit', 'target_hit', 'time_stop', 'invalidated', 'manual'] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];

export const REVIEW_STATUSES = ['OK', 'WARN', 'REVIEW'] as const;
export type ReviewStatusName = (typeof REVIEW_STATUSES)[number];

export interface ThesisPosition {
    /** Original opened quantity. Immutable once trimming starts — the ledger depends on it. */
    shares: number;
    sharesRemaining: number;
    riskDollars?: number | null;
    riskPctOfAccount?: number | null;
    sizingMethod?: string | null;
}

export interface ThesisEntryPlan {
    targetPrice?: number | null;
    conditions: string[];
    actualPrice?: number | null;
    actualDate?: Date | null;
}

export interface ThesisExitPlan {
    stopLoss?: number | null;
    takeProfit?: number | null;
    timeStopDays?: number | null;
    actualPrice?: number | null;
    actualDate?: Date | null;
    exitReason?: ExitReason | null;
}

export interface ThesisOutcomeRecord {
    pnlDollars?: number | null;
    pnlPct?: number | null;
    holdingDays?: number | null;
    lessonsLearned?: string | null;
}

export interface ThesisMonitoring {
    reviewIntervalDays: number;
    nextReviewDate?: Date | null;
    lastReviewDate?: Date | null;
    reviewStatus: ReviewStatusName;
}

export interface Thesis extends Document {
    userId: string;
    ticker: string;
    assetType: 'stock' | 'crypto';
    thesisType: ThesisType;
    status: ThesisStatus;
    statusHistory: ThesisLedgerEntry[];
    thesisStatement: string;
    evidence: string[];
    killCriteria: string[];
    confidenceScore?: number | null;
    entry: ThesisEntryPlan;
    exit: ThesisExitPlan;
    position?: ThesisPosition | null;
    marketContext?: { regime?: string | null; breadthScore?: number | null } | null;
    origin: { skill: string; screeningGrade?: string | null; screeningScore?: number | null };
    outcome: ThesisOutcomeRecord;
    monitoring: ThesisMonitoring;
    createdAt: Date;
    updatedAt: Date;
}

const LedgerEntrySchema = new Schema<ThesisLedgerEntry>(
    {
        status: { type: String, enum: THESIS_STATUSES, required: true },
        at: { type: String, required: true },
        reason: { type: String, required: true, default: '' },
        sharesSold: { type: Number },
        price: { type: Number },
        proceeds: { type: Number },
        realizedPnl: { type: Number },
    },
    { _id: false }
);

const ThesisSchema = new Schema<Thesis>(
    {
        userId: { type: String, required: true, index: true },
        ticker: { type: String, required: true, uppercase: true, trim: true, maxlength: 32 },
        assetType: { type: String, enum: ['stock', 'crypto'], required: true },
        thesisType: { type: String, enum: THESIS_TYPES, required: true },
        status: { type: String, enum: THESIS_STATUSES, required: true, default: 'IDEA' },
        statusHistory: { type: [LedgerEntrySchema], default: [] },
        thesisStatement: { type: String, required: true, maxlength: 2000 },
        evidence: { type: [String], default: [] },
        killCriteria: { type: [String], default: [] },
        confidenceScore: { type: Number, min: 0, max: 1, default: null },
        entry: {
            targetPrice: { type: Number, default: null },
            conditions: { type: [String], default: [] },
            actualPrice: { type: Number, default: null },
            actualDate: { type: Date, default: null },
        },
        exit: {
            stopLoss: { type: Number, default: null },
            takeProfit: { type: Number, default: null },
            timeStopDays: { type: Number, default: null },
            actualPrice: { type: Number, default: null },
            actualDate: { type: Date, default: null },
            exitReason: { type: String, enum: [...EXIT_REASONS, null], default: null },
        },
        position: {
            type: new Schema<ThesisPosition>(
                {
                    shares: { type: Number, required: true },
                    sharesRemaining: { type: Number, required: true },
                    riskDollars: { type: Number, default: null },
                    riskPctOfAccount: { type: Number, default: null },
                    sizingMethod: { type: String, default: null },
                },
                { _id: false }
            ),
            default: null,
        },
        marketContext: {
            type: new Schema(
                {
                    regime: { type: String, default: null },
                    breadthScore: { type: Number, default: null },
                },
                { _id: false }
            ),
            default: null,
        },
        origin: {
            skill: { type: String, required: true, default: 'manual' },
            screeningGrade: { type: String, default: null },
            screeningScore: { type: Number, default: null },
        },
        outcome: {
            pnlDollars: { type: Number, default: null },
            pnlPct: { type: Number, default: null },
            holdingDays: { type: Number, default: null },
            lessonsLearned: { type: String, default: null },
        },
        monitoring: {
            reviewIntervalDays: { type: Number, default: 30, min: 1 },
            nextReviewDate: { type: Date, default: null },
            lastReviewDate: { type: Date, default: null },
            reviewStatus: { type: String, enum: REVIEW_STATUSES, default: 'OK' },
        },
    },
    { timestamps: true }
);

// The two queries the journal actually makes: a user's open book, and what is due for review.
ThesisSchema.index({ userId: 1, status: 1, updatedAt: -1 });
ThesisSchema.index({ userId: 1, ticker: 1 });

export const ThesisModel: Model<Thesis> =
    (models?.Thesis as Model<Thesis>) || model<Thesis>('Thesis', ThesisSchema);
