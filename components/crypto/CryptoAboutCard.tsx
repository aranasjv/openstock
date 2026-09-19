import Image from "next/image";
import { ExternalLink } from "lucide-react";
import {
    formatCryptoPrice,
    formatCompactNumber,
    formatMarketCapValue,
} from "@/lib/utils";

interface CryptoAboutCardProps {
    coin: CryptoCoinDetail;
}

/**
 * The crypto counterpart to the stock company-profile / financials widgets.
 * CoinGecko supplies this data; TradingView has no crypto equivalent of those widgets.
 */
export default function CryptoAboutCard({ coin }: CryptoAboutCardProps) {
    const change = coin.changePercent24h;
    const changeClass =
        change === null || change === undefined
            ? "text-gray-500"
            : change >= 0
                ? "text-emerald-400"
                : "text-red-400";

    const description = coin.description
        ? coin.description.replace(/<[^>]*>/g, "").trim()
        : "";

    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-5">
            <div className="flex items-center gap-3">
                {coin.image ? (
                    <Image
                        src={coin.image}
                        alt={coin.name}
                        width={44}
                        height={44}
                        className="h-11 w-11 rounded-full"
                        unoptimized
                    />
                ) : null}
                <div>
                    <h2 className="text-lg font-semibold text-white">{coin.name}</h2>
                    <p className="text-xs text-gray-500">
                        {coin.symbol}
                        {coin.marketCapRank ? ` · Rank #${coin.marketCapRank}` : ""}
                    </p>
                </div>
                <div className="ml-auto text-right">
                    <div className="font-mono text-lg text-white">
                        {formatCryptoPrice(coin.currentPrice)}
                    </div>
                    <div className={`text-xs font-medium ${changeClass}`}>
                        {change === null || change === undefined
                            ? "N/A"
                            : `${change >= 0 ? "+" : ""}${change.toFixed(2)}% (24h)`}
                    </div>
                </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3">
                <Stat label="Market Cap" value={formatMarketCapValue(coin.marketCap)} />
                <Stat label="Volume (24h)" value={formatCompactNumber(coin.totalVolume)} />
                <Stat label="24h High" value={coin.high24h ? formatCryptoPrice(coin.high24h) : "N/A"} />
                <Stat label="24h Low" value={coin.low24h ? formatCryptoPrice(coin.low24h) : "N/A"} />
                <Stat label="All-Time High" value={coin.ath ? formatCryptoPrice(coin.ath) : "N/A"} />
                <Stat label="All-Time Low" value={coin.atl ? formatCryptoPrice(coin.atl) : "N/A"} />
                <Stat
                    label="Circulating Supply"
                    value={coin.circulatingSupply ? formatCompactNumber(coin.circulatingSupply) : "N/A"}
                />
                <Stat
                    label="Total Supply"
                    value={coin.totalSupply ? formatCompactNumber(coin.totalSupply) : "N/A"}
                />
            </div>

            {description ? (
                <div className="mt-5 border-t border-gray-800 pt-4">
                    <h3 className="mb-2 text-sm font-semibold text-gray-300">About</h3>
                    <p className="line-clamp-6 text-xs leading-relaxed text-gray-500">
                        {description}
                    </p>
                    {coin.homepage ? (
                        <a
                            href={coin.homepage}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-flex items-center gap-1.5 text-xs text-teal-400 hover:text-teal-300"
                        >
                            Official website
                            <ExternalLink className="h-3 w-3" />
                        </a>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-600">{label}</div>
            <div className="mt-0.5 font-mono text-sm text-gray-200">{value}</div>
        </div>
    );
}
