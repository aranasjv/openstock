import { Info } from 'lucide-react';
import { Suspense } from 'react';
import StrategySelect from './StrategySelect';
import CandidateRow from './CandidateRow';
import { runScreener } from '@/lib/actions/screener.actions';
import { DEFAULT_STRATEGY_ID } from '@/lib/strategies';

interface MustBuySectionProps {
    assetType: 'stock' | 'crypto';
    /** Raw `?strategy=` value from the URL, validated inside the action. */
    strategyId?: string;
}

/**
 * "Must Buy" screener.
 *
 * The label is descriptive of the screen, not a recommendation: results show which assets
 * currently match a set of technical conditions, with every condition and its measured
 * value visible so the ranking can be audited rather than trusted blindly.
 */
export default async function MustBuySection({ assetType, strategyId }: MustBuySectionProps) {
    const result = await runScreener(assetType, strategyId);
    const selected = strategyId ?? DEFAULT_STRATEGY_ID;

    // Show only assets that actually match something; a 0/3 row is noise in a
    // "must buy" list.
    const ranked = result.candidates.filter((candidate) => candidate.matched > 0);
    const strongCount = ranked.filter((candidate) => candidate.tier === 'Strong').length;

    return (
        <section className="rounded-xl border border-gray-800 bg-gray-900/30">
            <div className="flex flex-col gap-4 border-b border-gray-800 p-5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                    <h2 className="text-lg font-semibold text-white">
                        Must Buy
                        <span className="ml-2 text-sm font-normal text-gray-500">
                            {assetType === 'crypto' ? 'crypto' : 'stocks'}
                        </span>
                    </h2>
                    <p className="text-xs text-gray-600">
                        {result.scanned} scanned · {ranked.length} matched · {strongCount} strong
                    </p>
                </div>

                <Suspense fallback={<div className="h-9" />}>
                    <StrategySelect strategies={result.strategies} selected={selected} />
                </Suspense>

                <p className="flex items-start gap-2 text-xs text-gray-500">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                        Rule-based technical screen, not investment advice. A score is the share of
                        the strategy&apos;s conditions an asset currently meets — it is not a
                        forecast, and no strategy here has been backtested. Expand a row to see
                        exactly which conditions passed.
                    </span>
                </p>
            </div>

            {ranked.length > 0 ? (
                <div>
                    {ranked.map((candidate, index) => (
                        <CandidateRow
                            key={candidate.symbol}
                            rank={index + 1}
                            candidate={candidate}
                            assetType={assetType}
                            strategyId={selected}
                        />
                    ))}
                </div>
            ) : (
                <div className="p-6 text-sm text-gray-500">
                    {result.unavailableReason ??
                        'No assets currently match this strategy. That is a normal outcome — try another strategy.'}
                </div>
            )}

            {result.degraded && ranked.length > 0 ? (
                <p className="border-t border-gray-800 px-5 py-3 text-xs text-yellow-600/80">
                    {result.unavailable} of {result.scanned} assets could not be analysed
                    {assetType === 'stock'
                        ? ' — the free stock history source is unofficial and may be rate limited.'
                        : '.'}
                </p>
            ) : null}
        </section>
    );
}
