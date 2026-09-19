'use client';

import React, { useState, useMemo, useEffect } from 'react';
import CryptoWatchlistChip from './CryptoWatchlistChip';
import TradingViewWatchlist from '@/components/watchlist/TradingViewWatchlist';
import { Button } from '@/components/ui/button';
import { ArrowDownAZ, ArrowUpZA, ArrowUpDown } from 'lucide-react';
import { getCryptoMarketsByIds } from '@/lib/actions/crypto.actions';
import { resolveCryptoSymbols } from '@/lib/actions/tradingview.actions';

interface CryptoWatchlistManagerProps {
    initialItems: Array<{ symbol: string; company: string; addedAt?: string }>;
    userId: string;
}

export default function CryptoWatchlistManager({ initialItems, userId }: CryptoWatchlistManagerProps) {
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(null);
    const [coins, setCoins] = useState<Record<string, CryptoMarketCoin>>({});
    const [symbols, setSymbols] = useState<Record<string, string | null>>({});

    const toggleSort = () => {
        if (sortOrder === null) setSortOrder('asc');
        else if (sortOrder === 'asc') setSortOrder('desc');
        else setSortOrder(null);
    };

    const sortedItems = useMemo(() => {
        if (!sortOrder) return initialItems;

        return [...initialItems].sort((a, b) => {
            if (sortOrder === 'asc') {
                return a.symbol.localeCompare(b.symbol);
            } else {
                return b.symbol.localeCompare(a.symbol);
            }
        });
    }, [initialItems, sortOrder]);

    const coinIds = sortedItems.map((item) => item.symbol);
    const coinIdsKey = coinIds.join(',');

    /**
     * One batched CoinGecko request for the whole watchlist, plus one batched TradingView
     * resolution. The stored value is the CoinGecko id, which is neither a ticker nor a
     * tradable symbol, so both facts have to be looked up.
     */
    useEffect(() => {
        if (coinIds.length === 0) {
            setCoins({});
            setSymbols({});
            return;
        }

        let cancelled = false;

        getCryptoMarketsByIds(coinIds)
            .then(async (results) => {
                if (cancelled) return;

                const map: Record<string, CryptoMarketCoin> = {};
                for (const coin of results) {
                    map[coin.id.toUpperCase()] = coin;
                }
                setCoins(map);

                const tickers = results.map((coin) => coin.symbol).filter(Boolean);
                if (tickers.length === 0) return;

                const resolved = await resolveCryptoSymbols(tickers);
                if (!cancelled) setSymbols(resolved);
            })
            .catch(() => {
                /* leave chips in their symbol-only state */
            });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [coinIdsKey]);

    // Only symbols TradingView confirmed; unresolved coins are skipped by the widget.
    const resolvedSymbols = sortedItems
        .map((item) => {
            const ticker = coins[item.symbol.toUpperCase()]?.symbol;
            if (!ticker) return null;
            return symbols[ticker.toUpperCase()] ?? null;
        })
        .filter((symbol): symbol is string => Boolean(symbol));

    return (
        <div className="space-y-6">
            <div className="bg-gray-900/30 rounded-xl border border-gray-800 p-4 backdrop-blur-sm">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center">
                        <span className="mr-2">Manage Coins</span>
                        <span className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full">
                            {coinIds.length}
                        </span>
                    </h3>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleSort}
                        className="h-8 px-2 text-gray-400 hover:text-white hover:bg-white/10"
                        title={
                            sortOrder === 'asc'
                                ? 'Sorted A-Z'
                                : sortOrder === 'desc'
                                    ? 'Sorted Z-A'
                                    : 'Default Order'
                        }
                    >
                        {sortOrder === 'asc' && <ArrowDownAZ className="w-4 h-4 mr-2" />}
                        {sortOrder === 'desc' && <ArrowUpZA className="w-4 h-4 mr-2" />}
                        {sortOrder === null && <ArrowUpDown className="w-4 h-4 mr-2" />}
                        <span className="text-xs">
                            {sortOrder === 'asc' ? 'A-Z' : sortOrder === 'desc' ? 'Z-A' : 'Sort'}
                        </span>
                    </Button>
                </div>

                {coinIds.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {sortedItems.map((item) => (
                            <CryptoWatchlistChip
                                key={item.symbol}
                                coinId={item.symbol}
                                userId={userId}
                                coin={coins[item.symbol.toUpperCase()] ?? null}
                            />
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-gray-500 italic">No coins in watchlist.</p>
                )}
            </div>

            <div className="min-h-[550px]">
                <TradingViewWatchlist
                    symbols={resolvedSymbols}
                    formatSymbol={(symbol) => symbol}
                />
            </div>
        </div>
    );
}
