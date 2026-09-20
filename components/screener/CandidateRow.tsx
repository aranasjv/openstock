'use client';

import { useState, useTransition } from 'react';
import { ChevronDown, ChevronRight, Sparkles, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { explainCandidate } from '@/lib/actions/screener.actions';
import type { ScreenerCandidate } from '@/lib/actions/screener.actions';
import { openCoinDrawer } from '@/lib/coin-drawer-event';
import { openStockDrawer } from '@/lib/stock-drawer-event';
import { formatCryptoPrice, formatPrice } from '@/lib/utils';

interface CandidateRowProps {
    rank: number;
    candidate: ScreenerCandidate;
    assetType: 'stock' | 'crypto';
    strategyId: string;
}

const TIER_STYLES: Record<string, string> = {
    Strong: 'bg-emerald-950/60 text-emerald-300 border-emerald-900/60',
    Moderate: 'bg-teal-950/60 text-teal-300 border-teal-900/60',
    Watch: 'bg-gray-800/60 text-gray-400 border-gray-700',
};

/**
 * RSI banding, so an overbought/oversold condition is visible without expanding the row or
 * applying a strategy that looks for it.
 */
function rsiBand(rsi: number | null): { label: string; className: string; tone: string } | null {
    if (rsi === null || !Number.isFinite(rsi)) return null;

    const label = `RSI ${rsi.toFixed(0)}`;
    if (rsi <= 30) return { label, className: 'bg-emerald-950/60 text-emerald-300', tone: 'Oversold' };
    if (rsi <= 40) return { label, className: 'bg-emerald-950/30 text-emerald-400/80', tone: 'Approaching oversold' };
    if (rsi >= 70) return { label, className: 'bg-red-950/50 text-red-300', tone: 'Overbought' };
    return { label, className: 'text-gray-500', tone: 'Neutral' };
}

export default function CandidateRow({ rank, candidate, assetType, strategyId }: CandidateRowProps) {
    const [expanded, setExpanded] = useState(false);
    const [pending, startTransition] = useTransition();
    const [explanation, setExplanation] = useState<string | null>(null);
    const [explainMeta, setExplainMeta] = useState<{ framework?: string; provider?: string } | null>(null);
    const [explainError, setExplainError] = useState<string | null>(null);

    const price = assetType === 'crypto' ? formatCryptoPrice(candidate.price) : formatPrice(candidate.price);
    const change = candidate.changePercent24h;
    const rsi = rsiBand(candidate.rsi14);

    const handleExplain = () => {
        startTransition(async () => {
            setExplainError(null);
            const result = await explainCandidate(assetType, candidate.symbol, strategyId);
            if (result.ok && result.text) {
                setExplanation(result.text);
                setExplainMeta({ framework: result.framework, provider: result.provider });
            } else {
                setExplainError(result.error ?? 'Could not generate an explanation.');
            }
        });
    };

    // Both asset types have a drawer now, so the name opens details and the chevron keeps the
    // checklist toggle separate. Stocks used to expand in place, because they had no drawer to
    // open — the same gesture did different things depending on the asset type.
    const isCrypto = assetType === 'crypto';
    const openDetails = () => {
        if (isCrypto) openCoinDrawer(candidate.symbol);
        else openStockDrawer(candidate.symbol);
    };

    return (
        <div className="border-b border-gray-800/60 last:border-0">
            <div className="flex items-center gap-2 px-3 py-2">
                <span className="w-5 shrink-0 text-[11px] text-gray-500">{rank}</span>

                {/* Separate toggle so expansion stays reachable for crypto rows, where the
                    name opens the drawer. */}
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Hide conditions' : 'Show conditions'}
                    className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-white/10 hover:text-gray-300"
                >
                    {expanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                    )}
                </button>

                <button
                    type="button"
                    onClick={openDetails}
                    title="Open details"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                    <span className="truncate text-sm font-medium text-gray-100 hover:text-teal-300">
                        {candidate.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-gray-500">
                        {candidate.matched}/{candidate.total}
                    </span>
                </button>

                <span className="hidden shrink-0 font-mono text-xs text-gray-300 sm:block">{price}</span>

                {rsi ? (
                    <span
                        className={`hidden shrink-0 rounded px-1 text-[10px] font-medium md:block ${rsi.className}`}
                        title={rsi.tone}
                    >
                        {rsi.label}
                    </span>
                ) : null}

                {change !== null && change !== undefined ? (
                    <span
                        className={`hidden shrink-0 text-[11px] font-medium sm:block ${
                            change >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                    >
                        {change >= 0 ? '+' : ''}
                        {change.toFixed(1)}%
                    </span>
                ) : null}

                <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium ${TIER_STYLES[candidate.tier]}`}
                >
                    {candidate.score}
                </span>
            </div>

            {expanded ? (
                <div className="space-y-2 bg-black/30 px-3 pb-3 pt-1">
                    <ul className="space-y-1.5">
                        {candidate.passed.map((criterion) => (
                            <li key={criterion.label} className="flex items-start gap-2 text-xs">
                                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                                <span className="text-gray-300">{criterion.label}</span>
                                <span className="ml-auto font-mono text-gray-500">{criterion.detail}</span>
                            </li>
                        ))}
                        {candidate.failed.map((criterion) => (
                            <li key={criterion.label} className="flex items-start gap-2 text-xs">
                                <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
                                <span className="text-gray-500">{criterion.label}</span>
                                <span className="ml-auto font-mono text-gray-500">{criterion.detail}</span>
                            </li>
                        ))}
                    </ul>

                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={handleExplain}
                            className="h-7 border-gray-700 bg-transparent px-2 text-xs text-gray-300 hover:bg-white/5"
                        >
                            <Sparkles className="mr-1.5 h-3 w-3" />
                            {pending ? 'Generating…' : 'Explain with AI'}
                        </Button>
                        <button
                            type="button"
                            onClick={openDetails}
                            className="text-xs text-teal-400 hover:text-teal-300"
                        >
                            Open details →
                        </button>
                    </div>

                    {explanation ? (
                        <div className="rounded-md border border-gray-800 bg-gray-900/40 p-3">
                            <p className="whitespace-pre-line text-xs leading-relaxed text-gray-300">
                                {explanation}
                            </p>
                            {explainMeta?.framework ? (
                                <p className="mt-2 border-t border-gray-800 pt-2 text-[10px] text-gray-500">
                                    {explainMeta.framework}
                                    {explainMeta.provider ? ` · ${explainMeta.provider}` : ''} · AI-written
                                    commentary on the figures above, not advice
                                </p>
                            ) : null}
                        </div>
                    ) : null}
                    {explainError ? (
                        <p className="text-xs text-red-400">{explainError}</p>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
