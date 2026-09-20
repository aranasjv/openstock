'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { X, ExternalLink, Loader2 } from 'lucide-react';
import { getCryptoCoinDetail, getCryptoMarketSentiment } from '@/lib/actions/crypto.actions';
import { isStockInWatchlist } from '@/lib/actions/watchlist.actions';
import { resolveCryptoSymbols } from '@/lib/actions/tradingview.actions';
import CryptoDetailView from '@/components/crypto/CryptoDetailView';
import { useDragSize } from '@/hooks/useDragSize';
import { formatCryptoPrice } from '@/lib/utils';

interface CoinDetailDrawerProps {
    coinId: string | null;
    onClose: () => void;
}

type MarketSentiment = { value: number; classification: string; updatedAt: number } | null;

/**
 * Slide-over detail panel for a coin.
 *
 * The body is the same component the full page renders, so the drawer is no longer a summary
 * that tells you to go and look at the page: the watchlist and alert controls, the
 * technical-analysis widget and the stats are all here, and the link to the page is now a
 * header icon rather than a footer, because it is a deep-link affordance rather than the way
 * you are expected to read this.
 *
 * Default width is three times the original 440px, which is what makes room for the shared
 * view's two-column layout. It resizes from its left edge — the edge that can move without
 * detaching a right-anchored panel — and the width persists, because how wide you like a chart
 * is a preference about you, not a property of the coin.
 */
export default function CoinDetailDrawer({ coinId, onClose }: CoinDetailDrawerProps) {
    const [coin, setCoin] = useState<CryptoCoinDetail | null>(null);
    const [symbol, setSymbol] = useState<string | null>(null);
    const [market, setMarket] = useState<MarketSentiment>(null);
    const [isInWatchlist, setIsInWatchlist] = useState(false);
    const [loading, setLoading] = useState(false);

    const { width, resizing, startResize } = useDragSize({
        storageKey: 'openstock:coin-drawer:width',
        // 3 x the previous 440px default. Clamped by max-w-[95vw] at the call site so it stays
        // reachable on a smaller screen than the one it was sized on.
        initial: { width: 1320, height: 900 },
        min: { width: 380, height: 0 },
        max: { width: 1800, height: 0 },
        axis: 'x',
    });

    useEffect(() => {
        if (!coinId) {
            setCoin(null);
            setSymbol(null);
            setIsInWatchlist(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setCoin(null);
        setSymbol(null);
        setIsInWatchlist(false);

        // Market sentiment is market-wide, so it only needs fetching once per open.
        getCryptoMarketSentiment()
            .then((result) => {
                if (!cancelled) setMarket(result);
            })
            .catch(() => {
                /* context only — the card hides itself when absent */
            });

        isStockInWatchlist(coinId, 'crypto')
            .then((result) => {
                if (!cancelled) setIsInWatchlist(result);
            })
            .catch(() => {
                /* the button falls back to its own state */
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
            {/* Backdrop only below the width at which the drawer would otherwise cover the table. */}
            <div
                className="fixed inset-0 z-40 bg-black/50 xl:hidden"
                onClick={onClose}
                aria-hidden="true"
            />

            <aside
                role="dialog"
                aria-label={`${coin?.name ?? coinId} details`}
                style={{ width }}
                className="fixed top-0 right-0 z-50 flex h-screen max-w-[95vw] flex-col border-l border-gray-800 bg-black shadow-2xl"
            >
                <div
                    onPointerDown={startResize}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize details panel"
                    className={`absolute top-0 left-0 z-10 h-full w-1.5 cursor-ew-resize transition-colors hover:bg-teal-500/40 ${
                        resizing ? 'bg-teal-500/40' : ''
                    }`}
                />

                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
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
                                {coin?.symbol ? (
                                    <span className="ml-2 text-[11px] font-normal text-gray-500">
                                        {coin.symbol}
                                    </span>
                                ) : null}
                            </div>
                            <div className="text-[11px] text-gray-500">
                                {coin?.marketCapRank ? `Rank #${coin.marketCapRank}` : ''}
                            </div>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                        {coin ? (
                            <div className="flex items-baseline gap-2">
                                <span className="font-mono text-sm text-white">
                                    {formatCryptoPrice(coin.currentPrice)}
                                </span>
                                {change !== null ? (
                                    <span
                                        className={`font-mono text-[11px] ${
                                            change >= 0 ? 'text-emerald-400' : 'text-red-400'
                                        }`}
                                    >
                                        {change >= 0 ? '+' : ''}
                                        {change.toFixed(2)}%
                                    </span>
                                ) : null}
                            </div>
                        ) : null}

                        <Link
                            href={`/crypto/${coinId}`}
                            aria-label="Open full page"
                            title="Open full page"
                            className="rounded p-1 text-gray-500 transition-colors hover:bg-white/10 hover:text-white"
                        >
                            <ExternalLink className="h-4 w-4" />
                        </Link>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close"
                            title="Close"
                            className="rounded p-1 text-gray-500 transition-colors hover:bg-white/10 hover:text-white"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {loading ? (
                        <div className="flex h-40 items-center justify-center">
                            <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
                        </div>
                    ) : coin ? (
                        <CryptoDetailView
                            coinId={coinId}
                            coin={coin}
                            marketSentiment={market}
                            tvSymbol={symbol}
                            isInWatchlist={isInWatchlist}
                        />
                    ) : (
                        <p className="text-xs text-gray-500">
                            Details are unavailable for this coin right now.
                        </p>
                    )}
                </div>
            </aside>
        </>
    );
}
