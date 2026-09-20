import { marketBreadthReport } from '@/lib/breadth-data';
import { COMPONENT_LABELS } from '@/lib/breadth-score';

/**
 * US equity breadth, as a strip — the same shape as the crypto regime strip, for the same reason:
 * the dashboards are sized so the page itself does not scroll, and this is context for the tables
 * below rather than something you read on its own.
 *
 * **It renders nothing when the source cannot be read**, which is the one place it deliberately
 * differs from the crypto strip. A missing regime still has computable components worth showing; a
 * missing CSV has nothing, and a placeholder would be worse than an absence because "Neutral 50" is
 * indistinguishable from a measured neutral market — and this number is meant to inform exposure.
 *
 * Every component score is shown, not just the composite, because the disagreements are where the
 * signal is.
 */
const ZONE_STYLES: Record<string, { text: string; bar: string }> = {
    Strong: { text: 'text-emerald-300', bar: 'bg-emerald-500' },
    Healthy: { text: 'text-emerald-200', bar: 'bg-emerald-400' },
    Neutral: { text: 'text-gray-300', bar: 'bg-gray-400' },
    Weakening: { text: 'text-amber-300', bar: 'bg-amber-500' },
    Critical: { text: 'text-red-300', bar: 'bg-red-500' },
};

/** Short labels for the strip; the full name goes in the title so the row stays one line. */
const SHORT_LABELS: Record<string, string> = {
    breadth_level_trend: 'Level',
    ma_crossover: 'Crossover',
    cycle_position: 'Cycle',
    bearish_signal: 'Signal',
    historical_percentile: 'Percentile',
    divergence: 'Divergence',
};

/** Component scores share the composite's 0-100 scale, so one tone scale stays comparable. */
function componentTone(score: number | null): string {
    if (score === null) return 'text-gray-500';
    if (score >= 70) return 'text-emerald-300';
    if (score >= 40) return 'text-gray-300';
    return 'text-red-300';
}

export default async function BreadthStrip() {
    const report = await marketBreadthReport();
    if (!report) return null;

    const { composite, components } = report;
    const zone = ZONE_STYLES[composite.zone] ?? ZONE_STYLES.Neutral;
    const scored = components.filter((component) => component.score !== null);

    return (
        <section className="shrink-0 rounded-xl border border-gray-800 bg-gray-900/30 px-3 py-2">
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex items-baseline gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-gray-500">US breadth</span>
                        <span className={`text-sm font-semibold ${zone.text}`}>{composite.zone}</span>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="font-mono text-sm tabular-nums text-white">
                            {composite.score.toFixed(1)}
                        </span>
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-800">
                            <span
                                className={`block h-full ${zone.bar}`}
                                style={{ width: `${Math.max(0, Math.min(100, composite.score))}%` }}
                            />
                        </span>
                        <span className="text-[11px] text-gray-400">{composite.exposure} exposure</span>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {components.map((component) => (
                        <span
                            key={component.key}
                            title={`${COMPONENT_LABELS[component.key]} — ${component.signal}`}
                            className="flex items-baseline gap-1 text-[11px]"
                        >
                            <span className="text-gray-500">
                                {SHORT_LABELS[component.key] ?? component.key}
                            </span>
                            <span className={`font-mono tabular-nums ${componentTone(component.score)}`}>
                                {component.score === null ? '—' : component.score.toFixed(0)}
                            </span>
                        </span>
                    ))}
                </div>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-gray-500">
                <span>
                    {scored.length} of {components.length} components scored
                </span>
                {/* Coverage is reported because it changes what the score means: a component with no
                    marker inside its 120-day window is unavailable rather than neutral, and its weight
                    is redistributed. */}
                <span>
                    {report.period ? `${report.period.from} → ${report.period.to}` : 'no period'}
                </span>
                <span>{composite.quality.label}</span>
                {composite.referenceOnly ? (
                    <span className="text-amber-300">reference value — no component could be scored</span>
                ) : null}
                <span>Rule-based model, not investment advice.</span>
            </div>
        </section>
    );
}
