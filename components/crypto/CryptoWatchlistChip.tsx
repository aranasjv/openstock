"use client";

import React, { useState } from "react";
import { removeFromWatchlist } from "@/lib/actions/watchlist.actions";
import { Bell, X } from "lucide-react";
import { formatCryptoPrice } from "@/lib/utils";
import CreateAlertModal from "@/components/watchlist/CreateAlertModal";

interface CryptoWatchlistChipProps {
    /** CoinGecko coin id, stored uppercase by the watchlist model. */
    coinId: string;
    /** Market data for this coin, fetched in one batch by the manager. */
    coin: CryptoMarketCoin | null;
}

/**
 * Presentational: the manager fetches all watchlist market data in a single batched
 * CoinGecko call, so this does no fetching of its own.
 */
export default function CryptoWatchlistChip({ coinId, coin }: CryptoWatchlistChipProps) {
    const [modalOpen, setModalOpen] = useState(false);

    const handleRemove = async () => {
        await removeFromWatchlist(coinId, 'crypto');
    };

    const label = coin ? `${coin.name} (${coin.symbol})` : coinId;
    const price = coin?.currentPrice ?? 0;

    return (
        <div className="group flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700/80 rounded-full border border-gray-700 transition">
            <span className="font-semibold text-sm text-white">{label}</span>

            {price > 0 ? (
                <span className="text-xs font-mono text-gray-400">{formatCryptoPrice(price)}</span>
            ) : null}

            {/* Divider */}
            <div className="w-px h-4 bg-gray-600 mx-1"></div>

            {/* Alert Button */}
            <button
                onClick={() => setModalOpen(true)}
                className="text-gray-400 hover:text-yellow-400 transition-colors p-0.5"
                title="Create Alert"
            >
                <Bell className="w-3.5 h-3.5" />
            </button>

            {/* Remove Button */}
            <form action={handleRemove}>
                <button type="submit" className="text-gray-400 hover:text-red-400 transition-colors p-0.5" title="Remove">
                    <X className="w-3.5 h-3.5" />
                </button>
            </form>

            <CreateAlertModal
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
