import type { BreakerDecision } from '@/lib/circuit-breaker';

/**
 * The circuit breaker's current verdict for the account.
 *
 * Every state carries a text label alongside its colour: the whole point of the breaker is that a
 * reader can tell "halted" from "allowed" at a glance, and colour alone fails that for anyone who
 * cannot distinguish the two greens and reds used elsewhere in the app.
 */
const TONE: Record<BreakerDecision['recommendation'], { label: string; className: string; dot: string }> = {
    TRADING_ALLOWED: {
        label: 'Trading allowed',
        className: 'border-emerald-900/50 bg-emerald-950/20 text-emerald-200',
        dot: 'bg-emerald-400',
    },
    COOLDOWN: {
        label: 'Cooldown',
        className: 'border-amber-900/50 bg-amber-950/20 text-amber-200',
        dot: 'bg-amber-400',
    },
    HALTED: {
        label: 'Halted',
        className: 'border-red-900/50 bg-red-950/20 text-red-200',
        dot: 'bg-red-400',
    },
};

export default function BreakerBanner({ decision }: { decision: BreakerDecision }) {
    const tone = TONE[decision.recommendation];

    return (
        <section className={`shrink-0 rounded-xl border px-3 py-2 ${tone.className}`}>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
                    <span className="shrink-0 text-sm font-semibold">{tone.label}</span>
                    <span className="truncate text-[11px] opacity-80">{decision.rationale}</span>
                </div>

                <div className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums opacity-90">
                    <span>Today {decision.metrics.realizedPnlToday.toFixed(0)}</span>
                    <span>Week {decision.metrics.realizedPnlWeek.toFixed(0)}</span>
                    <span>Month {decision.metrics.realizedPnlMonth.toFixed(0)}</span>
                    <span>Streak {decision.metrics.consecutiveLosses}</span>
                </div>
            </div>

            {decision.triggeredRules.length > 0 ? (
                <ul className="mt-1.5 space-y-0.5">
                    {decision.triggeredRules.map((rule) => (
                        <li key={rule.rule} className="text-[11px] opacity-90">
                            <span className="font-medium">{rule.rule.replace(/_/g, ' ')}</span> — {rule.detail}
                            {rule.activeUntil ? ` Lifts ${rule.activeUntil.slice(0, 16).replace('T', ' ')} UTC.` : ''}
                        </li>
                    ))}
                </ul>
            ) : null}

            {decision.dataQuality !== 'OK' ? (
                <p className="mt-1 text-[10px] uppercase tracking-wider opacity-70">
                    Data quality: {decision.dataQuality.replace('_', ' ')}
                </p>
            ) : null}
        </section>
    );
}
