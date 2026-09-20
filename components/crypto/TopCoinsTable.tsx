'use client';

import Image from 'next/image';
import { ChevronRight } from 'lucide-react';
import { openCoinDrawer } from '@/lib/coin-drawer-event';
import { formatCryptoPrice } from '@/lib/utils';

interface TopCoinsTableProps {
    coins: CryptoMarketCoin[];
}

/**
 * Top coins table.
 *
 * Deliberately four columns. It previously forced six (with a 520px min-width) into a
 * third-width panel, which produced a horizontal scrollbar and clipped Market Cap and
 * Volume. Those figures now live in the drawer, which is where you go for detail anyway —
 * the table stays scannable at any panel width.
 *
 * Clicking a row opens the shared drawer rather than navigating away, so the table stays
 * visible.
 */
export default function TopCoinsTable({ coins }: TopCoinsTableProps) {
    if (!coins || coins.length === 0) {
        return (
            <div className="flex h-full flex-col items-center justify-center rounded-xl border border-gray-800 bg-gray-900/30 p-6 text-center text-sm text-gray-500">
                Crypto market data is unavailable right now.
            </div>
        );
    }

    return (
        <>
            <div className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900/30">
                <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-3 py-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        Top coins
                    </h2>
                    <span className="text-[10px] text-gray-500">by market cap</span>
                </div>

                {/* Scrolls internally so the dashboard keeps its height. */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-900/95 backdrop-blur">
                            <tr className="border-b border-gray-800 text-left text-[10px] uppercase tracking-wider text-gray-500">
                                <th className="w-8 px-2 py-2 font-medium">#</th>
                                <th className="px-2 py-2 font-medium">Coin</th>
                                <th className="px-2 py-2 text-right font-medium">Price</th>
                                <th className="px-2 py-2 text-right font-medium">24h</th>
                                <th className="w-5 px-1 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {coins.map((coin) => {
                                const change = coin.changePercent24h;
                                const changeClass =
                                    change === null || change === undefined
                                        ? 'text-gray-500'
                                        : change >= 0
                                            ? 'text-emerald-400'
                                            : 'text-red-400';

                                return (
                                    <tr
                                        key={coin.id}
                                        onClick={() => openCoinDrawer(coin.id)}
                                        title="Click for details"
                                        className="cursor-pointer border-b border-gray-800/60 transition-colors last:border-0 hover:bg-white/5"
                                    >
                                        <td className="px-2 py-1.5 text-[11px] text-gray-500">
                                            {coin.marketCapRank ?? '-'}
                                        </td>
                                        <td className="px-2 py-1.5">
                                            <div className="flex min-w-0 items-center gap-2">
                                                {coin.image ? (
                                                    <Image
                                                        src={coin.image}
                                                        alt={coin.name}
                                                        width={18}
                                                        height={18}
                                                        className="h-4 w-4 shrink-0 rounded-full"
                                                        unoptimized
                                                    />
                                                ) : (
                                                    <div className="h-4 w-4 shrink-0 rounded-full bg-gray-800" />
                                                )}
                                                {/* A real button rather than a key handler on the
                                                    row: the row keeps its table semantics for
                                                    screen readers, and this is the control a
                                                    keyboard can actually reach. The row click stays
                                                    as a mouse convenience. */}
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        openCoinDrawer(coin.id);
                                                    }}
                                                    className="truncate rounded text-left text-xs font-medium text-gray-100 hover:text-teal-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-500/60"
                                                >
                                                    {coin.name}
                                                </button>
                                                <span className="shrink-0 text-[10px] text-gray-500">
                                                    {coin.symbol}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[11px] tabular-nums text-gray-100">
                                            {formatCryptoPrice(coin.currentPrice)}
                                        </td>
                                        <td className={`whitespace-nowrap px-2 py-1.5 text-right text-[11px] font-medium tabular-nums ${changeClass}`}>
                                            {change === null || change === undefined
                                                ? 'N/A'
                                                : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}
                                        </td>
                                        <td className="px-1 py-1.5 text-gray-500">
                                            <ChevronRight className="h-3 w-3" />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}
