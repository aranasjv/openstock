import { TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';

interface CryptoSentimentCardProps {
    /** Per-coin community sentiment, 0-100, from CoinGecko. */
    up: number | null | undefined;
    down: number | null | undefined;
    /** Market-wide Fear & Greed, if it was reachable. */
    market?: { value: number; classification: string; updatedAt: number } | null;
}

/**
 * Crypto sentiment.
 *
 * Two distinct signals, kept visually separate because they answer different questions:
 *
 *  - Community votes (CoinGecko) are specific to this coin. They come back with the detail
 *    request already being made, so this costs no extra API call.
 *  - Fear & Greed is market-wide context. A coin's own votes cannot tell you whether the
 *    whole market is greedy or fearful.
 *
 * Both are free and need no API key, unlike the stock sentiment card which depends on an
 * optional Adanos key.
 */

function band(up: number): { label: string; className: string; barClassName: string } {
    if (up >= 70) return { label: 'Bullish', className: 'text-emerald-400', barClassName: 'bg-emerald-500' };
    if (up >= 55) return { label: 'Leaning bullish', className: 'text-emerald-400/80', barClassName: 'bg-emerald-600/70' };
    if (up >= 45) return { label: 'Neutral', className: 'text-gray-400', barClassName: 'bg-gray-500' };
    if (up >= 30) return { label: 'Leaning bearish', className: 'text-red-400/80', barClassName: 'bg-red-600/70' };
    return { label: 'Bearish', className: 'text-red-400', barClassName: 'bg-red-500' };
}

function fearGreedTone(value: number): string {
    if (value <= 24) return 'text-red-400';
    if (value <= 44) return 'text-orange-400';
    if (value <= 55) return 'text-gray-300';
    if (value <= 75) return 'text-emerald-400';
    return 'text-emerald-300';
}

export default function CryptoSentimentCard({ up, down, market }: CryptoSentimentCardProps) {
    const hasVotes = typeof up === 'number' && Number.isFinite(up);
    const hasMarket = Boolean(market);

    if (!hasVotes && !hasMarket) return null;

    const downValue = typeof down === 'number' && Number.isFinite(down) ? down : 100 - (up ?? 0);
    const sentiment = hasVotes ? band(up as number) : null;
    const Icon = !sentiment ? Minus : up! >= 55 ? TrendingUp : up! <= 45 ? TrendingDown : Minus;

    return (
        <section className="rounded-xl border border-gray-800 bg-gray-900/30 p-4">
            <div className="mb-3 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">Sentiment</h2>
                <Info className="h-3 w-3 text-gray-500" />
            </div>

            {hasVotes ? (
                <div>
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-500">Community votes</span>
                        <span className={`flex items-center gap-1 text-xs font-medium ${sentiment!.className}`}>
                            <Icon className="h-3.5 w-3.5" />
                            {sentiment!.label}
                        </span>
                    </div>

                    <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-gray-800">
                        <div className={sentiment!.barClassName} style={{ width: `${up}%` }} />
                        <div className="bg-red-900/60" style={{ width: `${downValue}%` }} />
                    </div>

                    <div className="mt-1.5 flex justify-between text-[11px]">
                        <span className="text-emerald-400/90">{up!.toFixed(1)}% bullish</span>
                        <span className="text-red-400/90">{downValue.toFixed(1)}% bearish</span>
                    </div>
                </div>
            ) : (
                <p className="text-[11px] text-gray-500">No community votes available for this coin.</p>
            )}

            {hasMarket ? (
                <div className="mt-4 border-t border-gray-800 pt-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] text-gray-500">Market sentiment (Fear &amp; Greed)</span>
                        <span className={`font-mono text-sm font-semibold ${fearGreedTone(market!.value)}`}>
                            {market!.value}
                        </span>
                    </div>
                    <p className={`mt-0.5 text-[11px] ${fearGreedTone(market!.value)}`}>
                        {market!.classification}
                    </p>
                    <p className="mt-1.5 text-[10px] text-gray-500">
                        Market-wide, not specific to this coin. Hourly from alternative.me.
                    </p>
                </div>
            ) : null}
        </section>
    );
}
