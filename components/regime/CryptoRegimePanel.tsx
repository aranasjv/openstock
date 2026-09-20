import { getCryptoRegime } from '@/lib/actions/regime.actions';

/**
 * The crypto regime, as a strip.
 *
 * Deliberately a strip rather than a panel: the dashboards are sized so the page itself does not
 * scroll, and a regime reading is context for the tables below it rather than something you read on
 * its own. A full-height card would push the coin list and the screener down to make room for a
 * number you glance at.
 *
 * Every component score is shown, not just the composite. The composite is the headline, but which
 * components disagree is the part that tells you whether to trust it — a 65 built from five strong
 * readings and one collapsed one is a different situation from a flat 65, and a single number hides
 * that.
 */
const ZONE_STYLES: Record<string, { label: string; text: string; bar: string }> = {
    RISK_ON: { label: 'Risk on', text: 'text-emerald-300', bar: 'bg-emerald-500' },
    NEUTRAL: { label: 'Neutral', text: 'text-gray-300', bar: 'bg-gray-400' },
    RISK_OFF: { label: 'Risk off', text: 'text-red-300', bar: 'bg-red-500' },
    UNKNOWN: { label: 'Unknown', text: 'text-gray-500', bar: 'bg-gray-700' },
};

/** Component bars are relative to the same 0-100 scale as the composite, so they stay comparable. */
function componentTone(score: number | null): string {
    if (score === null) return 'text-gray-500';
    if (score >= 70) return 'text-emerald-300';
    if (score >= 40) return 'text-gray-300';
    return 'text-red-300';
}

export default async function CryptoRegimePanel() {
    const report = await getCryptoRegime();
    const zone = ZONE_STYLES[report.zone] ?? ZONE_STYLES.UNKNOWN;
    const scored = report.components.filter((component) => component.score !== null);

    return (
        <section className="shrink-0 rounded-xl border border-gray-800 bg-gray-900/30 px-3 py-2">
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex items-baseline gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-gray-500">
                            Crypto regime
                        </span>
                        <span className={`text-sm font-semibold ${zone.text}`}>{zone.label}</span>
                    </div>

                    {report.score === null ? (
                        <span className="text-[11px] text-gray-400">
                            Not enough components could be computed
                        </span>
                    ) : (
                        <div className="flex items-center gap-2">
                            <span className="font-mono text-sm tabular-nums text-white">
                                {report.score.toFixed(1)}
                            </span>
                            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-800">
                                <span
                                    className={`block h-full ${zone.bar}`}
                                    style={{ width: `${Math.max(0, Math.min(100, report.score))}%` }}
                                />
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {report.components.map((component) => (
                        <span
                            key={component.key}
                            title={`${component.label} — ${component.signal}`}
                            className="flex items-baseline gap-1 text-[11px]"
                        >
                            <span className="text-gray-500">{component.label}</span>
                            <span className={`font-mono tabular-nums ${componentTone(component.score)}`}>
                                {component.score === null ? '—' : component.score.toFixed(0)}
                            </span>
                        </span>
                    ))}
                </div>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-gray-500">
                <span>{scored.length} of {report.components.length} components scored</span>
                {/* Coverage is reported because it changes what the score means: the dominance
                    component needs a month of daily observations, and it only accumulates one a day. */}
                <span>dominance history: {report.dominanceObservations} day(s)</span>
                <span>{report.universeSize} coins</span>
                <span>funding: {report.fundingSample} venue(s)</span>
                <span className="text-gray-500">Rule-based model, not investment advice.</span>
            </div>
        </section>
    );
}
