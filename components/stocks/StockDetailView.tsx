'use client';

import type { ComponentProps } from 'react';
import TradingViewWidget from '@/components/TradingViewWidget';
import WatchlistButton from '@/components/WatchlistButton';
import StockSentimentCard from '@/components/stocks/StockSentimentCard';
import {
    SYMBOL_INFO_WIDGET_CONFIG,
    CANDLE_CHART_WIDGET_CONFIG,
    BASELINE_WIDGET_CONFIG,
    TECHNICAL_ANALYSIS_WIDGET_CONFIG,
    COMPANY_PROFILE_WIDGET_CONFIG,
    COMPANY_FINANCIALS_WIDGET_CONFIG,
} from '@/lib/constants';
import { formatSymbolForTradingView } from '@/lib/utils';

const SCRIPT_URL = 'https://s3.tradingview.com/external-embedding/embed-widget-';

/** Taken from the card that consumes it, so the two cannot disagree about the shape. */
type SentimentInsight = ComponentProps<typeof StockSentimentCard>['insight'];

interface StockDetailViewProps {
    symbol: string;
    isInWatchlist: boolean;
    sentimentInsights: SentimentInsight;
}

/**
 * The stock detail body, shared by /stocks/[symbol] and the dashboard drawer.
 *
 * Same reasoning as the coin view: one component means the drawer cannot fall behind the page.
 * The stock drawer did not exist before this, so there was no copy to keep in step yet — that
 * is exactly why it is written shared from the start rather than as a second implementation.
 *
 * Columns key off a **container** query, not the viewport, because the drawer is resizable:
 * viewport breakpoints would hold two columns in a 400px panel and stack them in a
 * half-screen one. It is `'use client'` because the drawer is a client component, and a client
 * component cannot import a server one.
 */
export default function StockDetailView({
    symbol,
    isInWatchlist,
    sentimentInsights,
}: StockDetailViewProps) {
    const tvSymbol = formatSymbolForTradingView(symbol);
    const upper = symbol.toUpperCase();

    return (
        <div className="@container w-full">
            <section className="grid grid-cols-1 gap-8 @3xl:grid-cols-2">
                <div className="flex flex-col gap-6">
                    <TradingViewWidget
                        scriptUrl={`${SCRIPT_URL}symbol-info.js`}
                        config={SYMBOL_INFO_WIDGET_CONFIG(tvSymbol)}
                        height={170}
                    />

                    <TradingViewWidget
                        scriptUrl={`${SCRIPT_URL}advanced-chart.js`}
                        config={CANDLE_CHART_WIDGET_CONFIG(tvSymbol)}
                        className="custom-chart"
                        height={600}
                        allowExpand={true}
                    />

                    <TradingViewWidget
                        scriptUrl={`${SCRIPT_URL}advanced-chart.js`}
                        config={BASELINE_WIDGET_CONFIG(tvSymbol)}
                        className="custom-chart"
                        height={600}
                        allowExpand={true}
                    />
                </div>

                <div className="flex flex-col gap-6">
                    <div className="flex items-center justify-between">
                        <WatchlistButton
                            symbol={upper}
                            company={upper}
                            isInWatchlist={isInWatchlist}
                        />
                    </div>

                    <StockSentimentCard insight={sentimentInsights} />

                    <TradingViewWidget
                        scriptUrl={`${SCRIPT_URL}technical-analysis.js`}
                        config={TECHNICAL_ANALYSIS_WIDGET_CONFIG(tvSymbol)}
                        height={560}
                    />

                    <TradingViewWidget
                        scriptUrl={`${SCRIPT_URL}company-profile.js`}
                        config={COMPANY_PROFILE_WIDGET_CONFIG(tvSymbol)}
                        height={440}
                    />

                    <TradingViewWidget
                        scriptUrl={`${SCRIPT_URL}financials.js`}
                        config={COMPANY_FINANCIALS_WIDGET_CONFIG(tvSymbol)}
                        height={800}
                    />
                </div>
            </section>
        </div>
    );
}
