'use client';

import { useEffect, useState } from 'react';
import DetailDrawer from '@/components/detail/DetailDrawer';
import CryptoDetailView from '@/components/crypto/CryptoDetailView';
import { getCryptoCoinDetail, getCryptoMarketSentiment } from '@/lib/actions/crypto.actions';
import { isStockInWatchlist } from '@/lib/actions/watchlist.actions';
import { resolveCryptoSymbols } from '@/lib/actions/tradingview.actions';
import { formatCryptoPrice } from '@/lib/utils';

interface CoinDetailDrawerProps {
    coinId: string | null;
    onClose: () => void;
}

type MarketSentiment = { value: number; classification: string; updatedAt: number } | null;

/**
 * Slide-over detail panel for a coin.
 *
 * The chrome — resize, persisted width, Escape, the deep-link affordance — lives in
 * components/detail/DetailDrawer, shared with the stock drawer. This file owns only the coin
 * data and which body to render.
 */
export default function CoinDetailDrawer({ coinId, onClose }: CoinDetailDrawerProps) {
    const [coin, setCoin] = useState<CryptoCoinDetail | null>(null);
    const [symbol, setSymbol] = useState<string | null>(null);
    const [market, setMarket] = useState<MarketSentiment>(null);
    const [isInWatchlist, setIsInWatchlist] = useState(false);
    const [loading, setLoading] = useState(false);

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

    return (
        <DetailDrawer
            open={Boolean(coinId)}
            onClose={onClose}
            label={`${coin?.name ?? coinId ?? 'Coin'} details`}
            title={coin?.name ?? coinId ?? ''}
            subtitle={[
                coin?.symbol,
                coin?.marketCapRank ? `Rank #${coin.marketCapRank}` : null,
            ]
                .filter(Boolean)
                .join(' · ')}
            imageUrl={coin?.image}
            price={
                coin
                    ? {
                          value: formatCryptoPrice(coin.currentPrice),
                          changePercent: coin.changePercent24h ?? null,
                      }
                    : undefined
            }
            href={`/crypto/${coinId ?? ''}`}
            widthStorageKey="openstock:coin-drawer:width"
            loading={loading}
        >
            {coin ? (
                <CryptoDetailView
                    coinId={coinId ?? ''}
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
        </DetailDrawer>
    );
}
