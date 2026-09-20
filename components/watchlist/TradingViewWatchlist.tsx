"use client";

import React, { useEffect, useRef, memo } from 'react';
import { formatSymbolForTradingView } from '@/lib/utils';

interface TradingViewWatchlistProps {
    symbols: string[];
    /**
     * Maps a stored symbol to a TradingView symbol. Returns null when no sensible symbol
     * exists (e.g. a crypto coin with no matching pair), so it can be skipped instead of
     * rendering an "Invalid Symbol" row.
     */
    formatSymbol?: (symbol: string) => string | null;
    groupName?: string;
}

function TradingViewWatchlist({
    symbols,
    formatSymbol = formatSymbolForTradingView,
    groupName = 'My Watchlist',
}: TradingViewWatchlistProps) {
    const container = useRef<HTMLDivElement>(null);

    // Resolve first so we can decide whether there is anything worth rendering.
    const symbolList = symbols
        .map((symbol) => ({ name: formatSymbol(symbol), displayName: symbol }))
        .filter((entry): entry is { name: string; displayName: string } => Boolean(entry.name));

    useEffect(() => {
        if (!container.current) return;

        // Clear previous widget if any (though React key usually handles it, safety check)
        container.current.innerHTML = "";

        if (symbolList.length === 0) return;

        const script = document.createElement("script");
        script.src = "https://s3.tradingview.com/external-embedding/embed-widget-market-quotes.js";
        script.type = "text/javascript";
        script.async = true;

        script.innerHTML = JSON.stringify({
            "width": "100%",
            "height": 550,
            "symbolsGroups": [
                {
                    "name": groupName,
                    "symbols": symbolList
                }
            ],
            "showSymbolLogo": true,
            "isTransparent": true,
            "colorTheme": "dark",
            "locale": "en"
        });

        container.current.appendChild(script);
        // `symbolList` is derived from `symbols` and `formatSymbol`.
    }, [JSON.stringify(symbolList), groupName]);

    return (
        <div className="tradingview-widget-container border border-white/10 rounded-xl overflow-hidden shadow-2xl bg-black/40 backdrop-blur-md" ref={container}>
            <div className="tradingview-widget-container__widget">
                {symbolList.length === 0 ? (
                    <div className="flex h-[550px] flex-col items-center justify-center gap-2 p-6 text-center">
                        <p className="text-sm text-gray-400">No chartable symbols yet</p>
                        <p className="max-w-sm text-xs text-gray-500">
                            Add a stock or coin and it will appear here.
                        </p>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export default memo(TradingViewWatchlist);
