"use client";

import React, { useEffect, useState } from "react";
import { removeFromWatchlist } from "@/lib/actions/watchlist.actions";
import { getCryptoMarketsByIds } from "@/lib/actions/crypto.actions";
import { Bell, Loader2, X } from "lucide-react";
import { formatCryptoPrice } from "@/lib/utils";
import CreateAlertModal from "@/components/watchlist/CreateAlertModal";

interface CryptoWatchlistChipProps {
    /** CoinGecko coin id, stored uppercase by the watchlist model. */
    coinId: string;
    userId: string;
}

export default function CryptoWatchlistChip({ coinId, userId }: CryptoWatchlistChipProps) {
    const [coin, setCoin] = useState<CryptoMarketCoin | null>(null);
    const [price, setPrice] = useState<number>(0);
    const [loadingPrice, setLoadingPrice] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;

        getCryptoMarketsByIds([coinId])
            .then((results) => {
                if (cancelled || !results.length) return;
                setCoin(results[0]);
                setPrice(results[0].currentPrice);
            })
            .catch(() => {
                /* leave the chip in its symbol-only state */
            });

        return () => {
            cancelled = true;
        };
    }, [coinId]);

    const handleBellClick = async () => {
        if (price > 0) {
            setModalOpen(true);
            return;
        }

        setLoadingPrice(true);
        try {
            const results = await getCryptoMarketsByIds([coinId]);
            setPrice(results[0]?.currentPrice ?? 0);
            setModalOpen(true);
        } catch {
            setPrice(0);
            setModalOpen(true);
        } finally {
            setLoadingPrice(false);
        }
    };

    const handleRemove = async () => {
        await removeFromWatchlist(userId, coinId, 'crypto');
    };

    const label = coin ? `${coin.name} (${coin.symbol})` : coinId;

    return (
        <div className="group flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700/80 rounded-full border border-gray-700 transition-all">
            <span className="font-semibold text-sm text-white">{label}</span>

            {coin && coin.currentPrice > 0 ? (
                <span className="text-xs font-mono text-gray-400">
                    {formatCryptoPrice(coin.currentPrice)}
                </span>
            ) : null}

            {/* Divider */}
            <div className="w-px h-4 bg-gray-600 mx-1"></div>

            {/* Alert Button */}
            <button
                onClick={handleBellClick}
                className="text-gray-400 hover:text-yellow-400 transition-colors p-0.5"
                title="Create Alert"
                disabled={loadingPrice}
            >
                {loadingPrice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}
            </button>

            {/* Remove Button */}
            <form action={handleRemove}>
                <button type="submit" className="text-gray-400 hover:text-red-400 transition-colors p-0.5" title="Remove">
                    <X className="w-3.5 h-3.5" />
                </button>
            </form>

            <CreateAlertModal
                userId={userId}
                symbol={coinId}
                currentPrice={price}
                companyName={coin?.name}
                assetType="crypto"
                open={modalOpen}
                onOpenChange={setModalOpen}
            />
        </div>
    );
}
