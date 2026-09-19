import Image from "next/image";
import Link from "next/link";
import { formatCryptoPrice, formatCompactNumber, formatMarketCapValue } from "@/lib/utils";

interface TopCoinsTableProps {
    coins: CryptoMarketCoin[];
}

export default function TopCoinsTable({ coins }: TopCoinsTableProps) {
    if (!coins || coins.length === 0) {
        return (
            <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-6 text-center text-sm text-gray-500">
                Crypto market data is unavailable right now.
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900/30">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-4 py-2.5">
                <h2 className="text-sm font-semibold text-white">Top Cryptocurrencies</h2>
                <span className="text-[11px] text-gray-500">By market cap</span>
            </div>

            {/* Scrolls internally so the dashboard does not grow with the coin list. */}
            <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-[560px] text-sm">
                    <thead className="sticky top-0 bg-gray-900/95 backdrop-blur">
                        <tr className="border-b border-gray-800 text-left text-[10px] uppercase tracking-wider text-gray-500">
                            <th className="px-4 py-2 font-medium">#</th>
                            <th className="px-4 py-2 font-medium">Coin</th>
                            <th className="px-4 py-2 text-right font-medium">Price</th>
                            <th className="px-4 py-2 text-right font-medium">24h</th>
                            <th className="px-4 py-2 text-right font-medium">Market Cap</th>
                            <th className="px-4 py-2 text-right font-medium">Volume (24h)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {coins.map((coin) => {
                            const change = coin.changePercent24h;
                            const changeClass =
                                change === null || change === undefined
                                    ? "text-gray-500"
                                    : change >= 0
                                        ? "text-emerald-400"
                                        : "text-red-400";

                            return (
                                <tr
                                    key={coin.id}
                                    className="border-b border-gray-800/60 transition-colors last:border-0 hover:bg-white/5"
                                >
                                    <td className="px-4 py-2 text-xs text-gray-500">
                                        {coin.marketCapRank ?? "-"}
                                    </td>
                                    <td className="px-4 py-2">
                                        <Link
                                            href={`/crypto/${coin.id}`}
                                            className="flex items-center gap-2 group"
                                        >
                                            {coin.image ? (
                                                <Image
                                                    src={coin.image}
                                                    alt={coin.name}
                                                    width={20}
                                                    height={20}
                                                    className="h-5 w-5 rounded-full"
                                                    unoptimized
                                                />
                                            ) : (
                                                <div className="h-5 w-5 rounded-full bg-gray-800" />
                                            )}
                                            <span className="font-medium text-gray-100 group-hover:text-teal-400 transition-colors">
                                                {coin.name}
                                            </span>
                                            <span className="text-[11px] text-gray-500">
                                                {coin.symbol}
                                            </span>
                                        </Link>
                                    </td>
                                    <td className="px-4 py-2 text-right font-mono text-xs text-gray-100">
                                        {formatCryptoPrice(coin.currentPrice)}
                                    </td>
                                    <td className={`px-4 py-2 text-right text-xs font-medium ${changeClass}`}>
                                        {change === null || change === undefined
                                            ? "N/A"
                                            : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
                                    </td>
                                    <td className="px-4 py-2 text-right text-xs text-gray-300">
                                        {formatMarketCapValue(coin.marketCap)}
                                    </td>
                                    <td className="px-4 py-2 text-right text-xs text-gray-400">
                                        {formatCompactNumber(coin.totalVolume)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
