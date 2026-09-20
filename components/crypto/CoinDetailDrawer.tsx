'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { X, ExternalLink, Loader2 } from 'lucide-react';
import { getCryptoCoinDetail, getCryptoMarketSentiment } from '@/lib/actions/crypto.actions';
import { resolveCryptoSymbols } from '@/lib/actions/tradingview.actions';
import TradingViewWidget from '@/components/TradingViewWidget';
import CryptoSentimentCard from '@/components/crypto/CryptoSentimentCard';
import { CANDLE_CHART_WIDGET_CONFIG } from '@/lib/constants';
import {
    formatCompactNumber,
    formatCryptoPrice,
    formatMarketCapValue,
} from '@/lib/utils';

interface CoinDetailDrawerProps {
    coinId: string | null;
    onClose: () => void;
}

/**
 * Slide-over detail panel for a coin.
 *
 * Kept as a drawer rather than a navigation so the table stays visible — you can move down
 * the list inspecting coins without losing your place. The full page still exists at
 * /crypto/[id] for deep links and sharing, and is linked from here.
 */
export default function CoinDetailDrawer({ coinId, onClose }: CoinDetailDrawerProps) {
    const [coin, setCoin] = useState<CryptoCoinDetail | null>(null);
    const [symbol, setSymbol] = useState<string | null>(null);
    const [market, setMarket] = useState<{ value: number; classification: string; updatedAt: number } | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!coinId) {
            setCoin(null);
            setSymbol(null);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setCoin(null);
        setSymbol(null);

        // Market sentiment is market-wide, so it only needs fetching once per open.
        getCryptoMarketSentiment()
            .then((result) => {
                if (!cancelled) setMarket(result);
            })
            .catch(() => {
                /* context only — the card hides itself when absent */
            });

        getCryptoCoinDetail(coinId)
            .then(async (detail) => {
                if (cancelled || !detail) return;
                setCoin(detail);

                if (detail.symbol) {
                    const resolved = await resolveCryptoSymbols([detail.symbol]);
                    if (!cancelled) setSymbol(resolved[detail.symbol.toUpperCase()] ?? null);
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [coinId]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    if (!coinId) return null;

    const change = coin?.changePercent24h ?? null;

    return (
        <>
            {/* Backdrop only on small screens, where the drawer would otherwise cover the table. */}
            <div
                className="fixed inset-0 z-40 bg-black/50 xl:hidden"
                onClick={onClose}
                aria-hidden="true"
            />

            <aside
                className="fixed right-0 top-0 z-50 flex h-screen w-full flex-col border-l border-gray-800 bg-black shadow-2xl sm:w-[440px]"
                role="dialog"
                aria-label={`${coin?.name ?? coinId} details`}
            >
                <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                        {coin?.image ? (
                            <Image
                                src={coin.image}
                                alt={coin.name}
                                width={24}
                                height={24}
                                className="h-6 w-6 rounded-full"
                                unoptimized
                            />
                        ) : null}
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">
                                {coin?.name ?? coinId}
                            </div>
                            <div className="text-[11px] text-gray-500">
                                {coin?.symbol ?? ''}
                                {coin?.marketCapRank ? ` · Rank #${coin.marketCapRank}` : ''}
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded p-1 text-gray-500 transition-colors hover:bg-white/10 hover:text-white"
                        title="Close"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex h-40 items-center justify-center">
                            <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
                        </div>
                    ) : coin ? (
                        <div className="space-y-4 p-4">
                            <div className="flex items-baseline gap-3">
                                <span className="font-mono text-2xl text-white">
                                    {formatCryptoPrice(coin.currentPrice)}
                                </span>
                                {change !== null ? (
                                    <span
                                        className={`text-sm font-medium ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                                    >
                                        {change >= 0 ? '+' : ''}
                                        {change.toFixed(2)}%
                                    </span>
                                ) : null}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    ['Market cap', formatMarketCapValue(coin.marketCap)],
                                    ['Volume (24h)', formatCompactNumber(coin.totalVolume)],
                                    ['24h high', coin.high24h ? formatCryptoPrice(coin.high24h) : 'N/A'],
                                    ['24h low', coin.low24h ? formatCryptoPrice(coin.low24h) : 'N/A'],
                                    ['All-time high', coin.ath ? formatCryptoPrice(coin.ath) : 'N/A'],
                                    ['All-time low', coin.atl ? formatCryptoPrice(coin.atl) : 'N/A'],
                                ].map(([label, value]) => (
                                    <div key={label}>
                                        <div className="text-[10px] uppercase tracking-wider text-gray-500">
                                            {label}
                                        </div>
                                        <div className="font-mono text-xs text-gray-200">{value}</div>
                                    </div>
                                ))}
                            </div>

                            {symbol ? (
                                <TradingViewWidget
                                    scriptUrl="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
                                    config={CANDLE_CHART_WIDGET_CONFIG(symbol)}
                                    className="custom-chart"
                                    height={280}
                                />
                            ) : (
                                <p className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 text-[11px] text-gray-500">
                                    No TradingView pair exists for this coin, so no chart is shown.
                                </p>
                            )}

                            {coin.description ? (
                                <div>
                                    <h3 className="mb-1 text-xs font-semibold text-gray-300">About</h3>
                                    <p className="line-clamp-6 text-[11px] leading-relaxed text-gray-500">
                                        {coin.description.replace(/<[^>]*>/g, '').trim()}
                                    </p>
                                </div>
                            ) : null}

                            <CryptoSentimentCard
                                up={coin.sentimentUp}
                                down={coin.sentimentDown}
                                market={market}
                            />
                        </div>
                    ) : (
                        <p className="p-4 text-xs text-gray-500">
                            Details are unavailable for this coin right now.
                        </p>
                    )}
                </div>

                <div className="shrink-0 border-t border-gray-800 px-4 py-3">
                    <Link
                        href={`/crypto/${coinId}`}
                        className="inline-flex items-center gap-1.5 text-xs text-teal-400 hover:text-teal-300"
                    >
                        Open full page
                        <ExternalLink className="h-3 w-3" />
                    </Link>
                </div>
            </aside>
        </>
    );
}
