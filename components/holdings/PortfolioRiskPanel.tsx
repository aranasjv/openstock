import { portfolioRiskForUser } from '@/lib/portfolio-risk-live';
import type { PortfolioRiskReport } from '@/lib/portfolio-risk-live';

/**
 * Portfolio risk strip for the holdings page.
 *
 * A row of figures rather than a chart: the reading is four numbers and their relationship, and the
 * one relationship worth showing — correlation pushing volatility above the naive average — is
 * stated in words because a chart would need a second chart to explain it.
 *
 * The panel renders nothing at all when there is no priced position; an empty risk card on an empty
 * portfolio is noise.
 */

function Figure({ label, value, detail }: { label: string; value: string; detail?: string }) {
    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
            <div className="mt-1 font-mono text-2xl tabular-nums text-gray-100">{value}</div>
            {detail ? <div className="mt-1 text-[11px] text-gray-500">{detail}</div> : null}
        </div>
    );
}

export default async function PortfolioRiskPanel({ userId }: { userId: string }) {
    const risk: PortfolioRiskReport = await portfolioRiskForUser(userId);

    if (risk.positions === 0) return null;

    const correlationGap =
        risk.volatilityPct !== null && risk.naiveVolatilityPct !== null
            ? risk.volatilityPct - risk.naiveVolatilityPct
            : null;

    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-sm font-semibold text-white">Risk</h2>
                <span className="text-[11px] text-gray-500">
                    {risk.coverage.withHistory} of {risk.coverage.total} holdings had usable history
                    {risk.benchmark ? ` · beta vs ${risk.benchmark.symbol} (${risk.benchmark.reason})` : ''}
                </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Figure
                    label="Largest position"
                    value={risk.concentration.topWeightPct === null ? '—' : `${risk.concentration.topWeightPct.toFixed(1)}%`}
                    detail={
                        risk.concentration.topSymbol
                            ? `${risk.concentration.topSymbol} · ${risk.concentration.effectivePositions?.toFixed(1) ?? '—'} effective positions`
                            : undefined
                    }
                />
                <Figure
                    label="Volatility (annualised)"
                    value={risk.volatilityPct === null ? '—' : `${risk.volatilityPct.toFixed(1)}%`}
                    detail={
                        correlationGap !== null && correlationGap > 1
                            ? `${correlationGap.toFixed(1)}pt above the uncorrelated average of ${risk.naiveVolatilityPct!.toFixed(1)}%`
                            : 'positions are moving largely independently'
                    }
                />
                <Figure
                    label="Beta"
                    value={risk.beta === null ? '—' : risk.beta.toFixed(2)}
                    detail={risk.benchmark ? `against ${risk.benchmark.symbol}` : 'no benchmark resolved'}
                />
                <Figure
                    label="Positions priced"
                    value={String(risk.positions)}
                    detail={
                        risk.excluded.length > 0 || risk.withoutHistory.length > 0
                            ? `excluded: ${[...risk.excluded, ...risk.withoutHistory].join(', ')}`
                            : undefined
                    }
                />
            </div>

            {correlationGap !== null && correlationGap > 1 ? (
                <p className="rounded-xl border border-yellow-900/40 bg-yellow-950/15 p-3 text-[11px] text-yellow-200/80">
                    Volatility is measured from the positions&apos; joint history, so it already counts the fact that
                    they move together. The uncorrelated average would report {risk.naiveVolatilityPct!.toFixed(1)}% —
                    the gap is concentration you cannot see by looking at the weights.
                </p>
            ) : null}
        </section>
    );
}
