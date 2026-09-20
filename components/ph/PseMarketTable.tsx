import { fetchPseMarket } from '@/lib/phisix';

/**
 * The PSE market table.
 *
 * The US side needs a screener because it has to fetch a history per symbol to say anything. Here
 * the feed returns every listing in one request, so this is a full market table rather than a screen
 * — and it costs the same whether it renders ten rows or eighty. That asymmetry is worth knowing
 * before "improving" this into a screener.
 *
 * A stale snapshot is labelled rather than shown silently. The feed is community-run, and prices
 * that stopped updating at Friday's close are indistinguishable from prices in a quiet market once
 * they are parsed.
 */

/** Prices are in pesos; the app's `formatPrice` is USD-only. */
const PESO = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 2,
});

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export default async function PseMarketTable() {
    const market = await fetchPseMarket();

    if (!market) {
        return (
            <section className="flex h-full min-h-0 flex-col rounded-xl border border-gray-800 bg-gray-950/40 p-3">
                <h2 className="text-sm font-semibold text-white">PSE market</h2>
                <p className="mt-2 text-xs text-gray-400">
                    The Philippine price feed could not be read. Nothing is shown rather than an empty
                    market, because those look identical.
                </p>
            </section>
        );
    }

    return (
        <section className="flex h-full min-h-0 flex-col rounded-xl border border-gray-800 bg-gray-950/40 p-3">
            <div className="mb-2 flex shrink-0 items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-white">PSE market</h2>
                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                    {market.quotes.length} common · {market.excluded} pref/warrant
                </span>
            </div>

            {market.stale ? (
                <p className="mb-2 shrink-0 rounded border border-amber-900/50 bg-amber-950/20 px-2 py-1 text-[11px] text-amber-200">
                    Feed last updated {market.asOf.slice(0, 10) || 'unknown'} — these prices are not live.
                </p>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto">
                <table className="w-full border-collapse text-[11px]">
                    <thead className="sticky top-0 bg-gray-950/95">
                        <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                            <th scope="col" className="py-1.5 text-left font-medium">
                                Symbol
                            </th>
                            <th scope="col" className="py-1.5 text-left font-medium">
                                Name
                            </th>
                            <th scope="col" className="py-1.5 text-right font-medium">
                                Price
                            </th>
                            <th scope="col" className="py-1.5 text-right font-medium">
                                Chg%
                            </th>
                            <th scope="col" className="py-1.5 text-right font-medium">
                                Volume
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {market.quotes.map((quote) => (
                            <tr key={quote.symbol} className="border-t border-gray-800/50">
                                <td className="py-1 font-mono text-gray-200">{quote.symbol}</td>
                                <td className="max-w-[12rem] truncate py-1 text-gray-400" title={quote.name}>
                                    {quote.name}
                                </td>
                                <td className="py-1 text-right font-mono tabular-nums text-gray-200">
                                    {PESO.format(quote.price)}
                                </td>
                                <td
                                    className={`py-1 text-right font-mono tabular-nums ${
                                        quote.changePercent > 0
                                            ? 'text-emerald-400'
                                            : quote.changePercent < 0
                                              ? 'text-red-400'
                                              : 'text-gray-500'
                                    }`}
                                >
                                    {/* The sign is the second channel — colour alone fails in greyscale and
                                        for the common red/green deficiency. */}
                                    {quote.changePercent > 0 ? '+' : ''}
                                    {quote.changePercent.toFixed(2)}%
                                </td>
                                <td className="py-1 text-right font-mono tabular-nums text-gray-500">
                                    {COMPACT.format(quote.volume)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
