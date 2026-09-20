'use client';

import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import {
    closeThesis,
    createThesis,
    invalidateThesis,
    openThesisPosition,
    transitionThesis,
    trimThesis,
} from '@/lib/actions/thesis.actions';
import { THESIS_TYPES, realisedPnl, type ThesisStatus } from '@/lib/thesis-lifecycle';
import type { ThesisRecord } from '@/lib/data/theses';
import { formatPrice } from '@/lib/utils';

/**
 * The journal board.
 *
 * A dense table rather than a card per thesis, matching the rest of the app: a journal is read by
 * scanning status and P&L down a column, and cards hide exactly that.
 *
 * Which actions a row offers follows from its status, mirroring the lifecycle machine instead of
 * re-deriving it. The server rejects an illegal move regardless — but offering a button that cannot
 * work is its own kind of lie, so a terminal row offers nothing at all.
 */

const STATUS_STYLE: Record<ThesisStatus, string> = {
    IDEA: 'bg-gray-800/60 text-gray-300',
    ENTRY_READY: 'bg-teal-950/50 text-teal-300',
    ACTIVE: 'bg-emerald-950/50 text-emerald-300',
    PARTIALLY_CLOSED: 'bg-amber-950/50 text-amber-300',
    CLOSED: 'bg-gray-800/40 text-gray-500',
    INVALIDATED: 'bg-red-950/40 text-red-300/80',
};

type ArmedKind = 'ready' | 'open' | 'trim' | 'close' | 'invalidate';

const ACTIONS_FOR: Record<ThesisStatus, ArmedKind[]> = {
    IDEA: ['ready', 'invalidate'],
    ENTRY_READY: ['open', 'invalidate'],
    ACTIVE: ['trim', 'close', 'invalidate'],
    PARTIALLY_CLOSED: ['trim', 'close', 'invalidate'],
    CLOSED: [],
    INVALIDATED: [],
};

const ACTION_LABEL: Record<ArmedKind, string> = {
    ready: 'Entry ready',
    open: 'Open',
    trim: 'Trim',
    close: 'Close',
    invalidate: 'Invalidate',
};

const CHIP =
    'rounded border border-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-50';
const INPUT =
    'h-7 w-full rounded border border-gray-800 bg-black/40 px-2 text-[11px] text-gray-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-500/60';

export default function JournalBoard({ theses }: { theses: ThesisRecord[] }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [armed, setArmed] = useState<{ id: string; kind: ArmedKind } | null>(null);
    const [form, setForm] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    const field = (key: string) => form[key] ?? '';
    const setField = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

    /** Every mutation funnels through here so the busy state, the error and the refresh are uniform. */
    function run(action: () => Promise<{ ok: boolean; error?: string }>) {
        setError(null);
        startTransition(async () => {
            const result = await action();
            if (!result.ok) {
                setError(result.error ?? 'That move was rejected.');
                return;
            }
            setArmed(null);
            setForm({});
            router.refresh();
        });
    }

    function submitCreate() {
        setError(null);
        startTransition(async () => {
            try {
                await createThesis({
                    ticker: field('ticker'),
                    assetType: field('assetType') || 'stock',
                    thesisType: field('thesisType') || THESIS_TYPES[1],
                    thesisStatement: field('statement'),
                    entryTargetPrice: field('target') || undefined,
                    stopLoss: field('stop') || undefined,
                });
                setForm({});
                setCreating(false);
                router.refresh();
            } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Could not create the thesis.');
            }
        });
    }

    function armedForm(thesis: ThesisRecord, kind: ArmedKind) {
        if (kind === 'ready') {
            return (
                <input
                    className={INPUT}
                    placeholder="Why is this ready to enter?"
                    value={field('reason')}
                    onChange={(event) => setField('reason', event.target.value)}
                    aria-label="Reason"
                />
            );
        }
        if (kind === 'open') {
            return (
                <div className="grid grid-cols-2 gap-2">
                    <input className={INPUT} placeholder="Entry price" value={field('price')} onChange={(e) => setField('price', e.target.value)} aria-label="Entry price" />
                    <input className={INPUT} placeholder="Shares" value={field('shares')} onChange={(e) => setField('shares', e.target.value)} aria-label="Shares" />
                </div>
            );
        }
        if (kind === 'trim') {
            return (
                <div className="grid grid-cols-2 gap-2">
                    <input className={INPUT} placeholder="Shares sold" value={field('sharesSold')} onChange={(e) => setField('sharesSold', e.target.value)} aria-label="Shares sold" />
                    <input className={INPUT} placeholder="Price" value={field('price')} onChange={(e) => setField('price', e.target.value)} aria-label="Price" />
                </div>
            );
        }
        return (
            <input
                className={INPUT}
                placeholder={kind === 'close' ? 'Exit price' : 'What invalidated it?'}
                value={field(kind === 'close' ? 'price' : 'reason')}
                onChange={(event) => setField(kind === 'close' ? 'price' : 'reason', event.target.value)}
                aria-label={kind === 'close' ? 'Exit price' : 'Reason'}
            />
        );
    }

    function submitArmed(thesis: ThesisRecord, kind: ArmedKind) {
        const id = String(thesis._id);
        if (kind === 'ready') return run(() => transitionThesis(id, 'ENTRY_READY', field('reason')));
        if (kind === 'open') {
            return run(() => openThesisPosition(id, { price: field('price'), shares: field('shares') }));
        }
        if (kind === 'trim') {
            return run(() => trimThesis(id, { sharesSold: field('sharesSold'), price: field('price') }));
        }
        if (kind === 'close') return run(() => closeThesis(id, { price: field('price') }));
        return run(() => invalidateThesis(id, field('reason')));
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex shrink-0 items-center justify-between gap-3">
                <p className="text-[11px] text-gray-500">
                    {theses.length} track{theses.length === 1 ? '' : 's'} · status moves are forward-only
                </p>
                <button type="button" onClick={() => setCreating((value) => !value)} className={`${CHIP} inline-flex items-center gap-1`}>
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    New thesis
                </button>
            </div>

            {error ? (
                <p className="shrink-0 rounded border border-red-900/50 bg-red-950/30 px-2 py-1 text-[11px] text-red-300">{error}</p>
            ) : null}

            {creating ? (
                <div className="grid shrink-0 grid-cols-2 gap-2 rounded-lg border border-gray-800 bg-gray-900/30 p-3 md:grid-cols-3">
                    <input className={INPUT} placeholder="Ticker" value={field('ticker')} onChange={(e) => setField('ticker', e.target.value)} aria-label="Ticker" />
                    <select className={INPUT} value={field('assetType') || 'stock'} onChange={(e) => setField('assetType', e.target.value)} aria-label="Asset type">
                        <option value="stock">Stock</option>
                        <option value="crypto">Crypto</option>
                    </select>
                    <select className={INPUT} value={field('thesisType') || THESIS_TYPES[1]} onChange={(e) => setField('thesisType', e.target.value)} aria-label="Thesis type">
                        {THESIS_TYPES.map((type) => (
                            <option key={type} value={type}>
                                {type.replace(/_/g, ' ')}
                            </option>
                        ))}
                    </select>
                    <input className={`${INPUT} md:col-span-3`} placeholder="The thesis, in one sentence" value={field('statement')} onChange={(e) => setField('statement', e.target.value)} aria-label="Thesis statement" />
                    <input className={INPUT} placeholder="Entry target" value={field('target')} onChange={(e) => setField('target', e.target.value)} aria-label="Entry target" />
                    <input className={INPUT} placeholder="Stop loss" value={field('stop')} onChange={(e) => setField('stop', e.target.value)} aria-label="Stop loss" />
                    <button type="button" disabled={pending} onClick={submitCreate} className={`${CHIP} h-7 bg-teal-950/40 text-teal-300`}>
                        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
                    </button>
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-800">
                <table className="w-full border-collapse text-left">
                    <thead className="sticky top-0 bg-gray-950/95 text-[10px] uppercase tracking-wider text-gray-500">
                        <tr>
                            <th className="px-3 py-2 font-medium">Ticker</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                            <th className="px-3 py-2 font-medium">Type</th>
                            <th className="px-3 py-2 text-right font-medium">Realised</th>
                            <th className="px-3 py-2 text-right font-medium">Remaining</th>
                            <th className="px-3 py-2 font-medium">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {theses.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-3 py-6 text-center text-[11px] text-gray-500">
                                    No theses yet. A journal only earns its keep if entries are written before the trade.
                                </td>
                            </tr>
                        ) : null}
                        {theses.map((thesis) => {
                            const id = String(thesis._id);
                            const status = thesis.status;
                            const realised = realisedPnl(thesis.statusHistory ?? []);
                            const remaining = thesis.position?.sharesRemaining ?? null;
                            const actions = ACTIONS_FOR[status];
                            const armedKind = armed?.id === id ? armed.kind : null;

                            return (
                                <Fragment key={id}>
                                    <tr className="border-t border-gray-800/60">
                                        <td className="px-3 py-2 text-xs font-medium text-gray-100">
                                            {thesis.ticker}
                                            <span className="ml-1.5 text-[10px] font-normal text-gray-500">{thesis.assetType}</span>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_STYLE[status]}`}>
                                                {status.replace(/_/g, ' ').toLowerCase()}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-[11px] text-gray-500">{thesis.thesisType.replace(/_/g, ' ')}</td>
                                        <td className={`px-3 py-2 text-right font-mono text-[11px] tabular-nums ${realised > 0 ? 'text-emerald-400' : realised < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                                            {realised === 0 ? '—' : formatPrice(realised)}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-gray-400">
                                            {remaining === null ? '—' : remaining}
                                        </td>
                                        <td className="px-3 py-2">
                                            {actions.length === 0 ? (
                                                <span className="text-[10px] text-gray-600">closed</span>
                                            ) : (
                                                <div className="flex flex-wrap gap-1">
                                                    {actions.map((kind) => (
                                                        <button
                                                            key={kind}
                                                            type="button"
                                                            disabled={pending}
                                                            onClick={() => (armedKind === kind ? submitArmed(thesis, kind) : (setArmed({ id, kind }), setField('reason', '')))}
                                                            className={CHIP}
                                                        >
                                                            {armedKind === kind ? 'Confirm' : ACTION_LABEL[kind]}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                    {armedKind ? (
                                        <tr className="border-t border-gray-800/40 bg-black/20">
                                            <td colSpan={6} className="px-3 py-2">
                                                <div className="flex items-end gap-2">
                                                    <div className="min-w-0 flex-1">{armedForm(thesis, armedKind)}</div>
                                                    <button type="button" disabled={pending} onClick={() => setArmed(null)} className={CHIP}>
                                                        Cancel
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : null}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
