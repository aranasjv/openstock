import { fetchPseMarket } from '@/lib/phisix';

/**
 * The shape of the PSE session: advancers against decliners, and the extremes.
 *
 * This replaces the two TradingView panels that used to sit here, and it is not a fallback for
 * them. Neither rendered: the index chart answered *"This symbol is only available on TradingView"*
 * — an embed entitlement rather than a configuration mistake, so no config would have fixed it —
 * and the quotes widget came back empty for `PSE:`-prefixed symbols. What is left is built from the
 * feed that does work, from the same call the table makes, so it costs nothing extra.
 *
 * Only traded names are counted. The feed lists 385 symbols including untraded ones, and averaging
 * a flat zero into the day's move would report a calmer market than the one that actually traded.
 */
const MOVERS = 5;

function Movers({ title, rows, tone }: { title: string; rows: { symbol: string; changePercent: number }[]; tone: string }) {
    return (
        <div className="min-w-0 flex-1">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-500">{title}</p>
            <ul className="space-y-0.5">
                {rows.map((row) => (
                    <li key={row.symbol} className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[11px] text-gray-300">{row.symbol}</span>
                        <span className={`shrink-0 font-mono text-[11px] tabular-nums ${tone}`}>
                            {row.changePercent >= 0 ? '+' : ''}
                            {row.changePercent.toFixed(2)}%
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default async function PseMovers() {
    const market = await fetchPseMarket();

    if (!market) {
        return (
            <section className="flex h-full flex-col rounded-xl border border-gray-800 bg-gray-900/30 p-3">
                <h2 className="text-sm font-semibold text-white">PSE movers</h2>
                <p className="mt-2 text-xs text-gray-400">
                    The Philippine price feed could not be read, so there is nothing to rank.
                </p>
            </section>
        );
    }

    const traded = market.quotes.filter((quote) => quote.volume > 0);
    const up = traded.filter((quote) => quote.changePercent > 0).length;
    const down = traded.filter((quote) => quote.changePercent < 0).length;
    const flat = traded.length - up - down;
    const average =
        traded.length > 0 ? traded.reduce((sum, quote) => sum + quote.changePercent, 0) / traded.length : 0;

    const ranked = [...traded].sort((a, b) => b.changePercent - a.changePercent);
    const gainers = ranked.slice(0, MOVERS);
    const losers = ranked.slice(-MOVERS).reverse();

    return (
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900/30">
            <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-3 py-2">
                <h2 className="text-sm font-semibold text-white">PSE movers</h2>
                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                    {traded.length} traded
                </span>
            </header>

            <div className="flex shrink-0 items-center gap-3 border-b border-gray-800/60 px-3 py-2 text-[11px]">
                <span className="text-emerald-300">{up} up</span>
                <span className="text-red-300">{down} down</span>
                <span className="text-gray-400">{flat} flat</span>
                <span className={`ml-auto font-mono tabular-nums ${average >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    avg {average >= 0 ? '+' : ''}
                    {average.toFixed(2)}%
                </span>
            </div>

            <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto p-3">
                <Movers title="Gainers" rows={gainers} tone="text-emerald-300" />
                <Movers title="Losers" rows={losers} tone="text-red-300" />
            </div>

            {market.stale ? (
                <p className="shrink-0 border-t border-amber-900/40 bg-amber-950/20 px-3 py-1.5 text-[10px] text-amber-200">
                    Feed last updated {market.asOf.slice(0, 10) || 'unknown'} — not live.
                </p>
            ) : null}
        </section>
    );
}
