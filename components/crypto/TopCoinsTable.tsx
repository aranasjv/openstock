import Image from "next/image";
import Link from "next/link";
import { formatCryptoPrice, formatCompactNumber, formatMarketCapValue } from "@/lib/utils";

interface TopCoinsTableProps {
    coins: CryptoMarketCoin[];
}

export default function TopCoinsTable({ coins }: TopCoinsTableProps) {
    if (!coins || coins.length === 0) {
        return (
            <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-8 text-center text-sm text-gray-500">
                Crypto market data is unavailable right now.
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/30">
            <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
                <h2 className="text-lg font-semibold text-white">Top Cryptocurrencies</h2>
                <span className="text-xs text-gray-500">By market cap</span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                    <thead>
                        <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wider text-gray-500">
                            <th className="px-5 py-3 font-medium">#</th>
                            <th className="px-5 py-3 font-medium">Coin</th>
                            <th className="px-5 py-3 text-right font-medium">Price</th>
                            <th className="px-5 py-3 text-right font-medium">24h</th>
                            <th className="px-5 py-3 text-right font-medium">Market Cap</th>
                            <th className="px-5 py-3 text-right font-medium">Volume (24h)</th>
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
                                    <td className="px-5 py-3 text-gray-500">
                                        {coin.marketCapRank ?? "-"}
                                    </td>
                                    <td className="px-5 py-3">
                                        <Link
                                            href={`/crypto/${coin.id}`}
                                            className="flex items-center gap-3 group"
                                        >
                                            {coin.image ? (
                                                <Image
                                                    src={coin.image}
                                                    alt={coin.name}
                                                    width={28}
                                                    height={28}
                                                    className="h-7 w-7 rounded-full"
                                                    unoptimized
                                                />
                                            ) : (
                                                <div className="h-7 w-7 rounded-full bg-gray-800" />
                                            )}
                                            <div className="flex flex-col">
                                                <span className="font-semibold text-gray-100 group-hover:text-teal-400 transition-colors">
                                                    {coin.name}
                                                </span>
                                                <span className="text-xs text-gray-500">
                                                    {coin.symbol}
                                                </span>
                                            </div>
                                        </Link>
                                    </td>
                                    <td className="px-5 py-3 text-right font-mono text-gray-100">
                                        {formatCryptoPrice(coin.currentPrice)}
                                    </td>
                                    <td className={`px-5 py-3 text-right font-medium ${changeClass}`}>
                                        {change === null || change === undefined
                                            ? "N/A"
                                            : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
                                    </td>
                                    <td className="px-5 py-3 text-right text-gray-300">
                                        {formatMarketCapValue(coin.marketCap)}
                                    </td>
                                    <td className="px-5 py-3 text-right text-gray-400">
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
