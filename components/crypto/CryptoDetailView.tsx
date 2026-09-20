'use client';

import TradingViewWidget from '@/components/TradingViewWidget';
import WatchlistButton from '@/components/WatchlistButton';
import CryptoAboutCard from '@/components/crypto/CryptoAboutCard';
import CryptoAlertButton from '@/components/crypto/CryptoAlertButton';
import CryptoSentimentCard from '@/components/crypto/CryptoSentimentCard';
import {
    SYMBOL_INFO_WIDGET_CONFIG,
    CANDLE_CHART_WIDGET_CONFIG,
    BASELINE_WIDGET_CONFIG,
    TECHNICAL_ANALYSIS_WIDGET_CONFIG,
} from '@/lib/constants';

const SCRIPT_URL = 'https://s3.tradingview.com/external-embedding/embed-widget-';

interface CryptoDetailViewProps {
    coinId: string;
    coin: CryptoCoinDetail | null;
    /** Fear & Greed for the whole market; null when the feed is unavailable. */
    marketSentiment: { value: number; classification: string; updatedAt: number } | null;
    /** TradingView ticker, or null when no venue lists the coin — charts are then skipped. */
    tvSymbol: string | null;
    isInWatchlist: boolean;
}

function ChartUnavailable({ label }: { label: string }) {
    return (
        <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-gray-800 bg-gray-900/30 p-6 text-center">
            <p className="text-sm text-gray-400">{label} chart unavailable</p>
            <p className="max-w-sm text-xs text-gray-500">
                TradingView has no matching pair for this coin, so no chart is shown rather than
                an &quot;Invalid Symbol&quot; placeholder. Price data above comes from CoinGecko.
            </p>
        </div>
    );
}

/**
 * The coin detail body, shared by /crypto/[id] and the dashboard drawer.
 *
 * Both surfaces used to have their own version: the page had the full set of widgets, and the
 * drawer had a smaller summary plus a link telling you to go and look at the page. Two copies
 * meant the drawer quietly fell behind — it had no technical-analysis widget and no watchlist
 * or alert control. One component means "the drawer shows the page" stays true by construction
 * rather than by discipline.
 *
 * The columns respond to a **container** query rather than the viewport: the drawer is
 * resizable, so viewport breakpoints would hold two columns in a 400px-wide panel and stack
 * them in a half-screen panel. The page and the drawer both get the layout their own width
 * deserves. This is also why the component is `'use client'` — the drawer is a client
 * component, and a client component cannot import a server one.
 */
export default function CryptoDetailView({
    coinId,
    coin,
    marketSentiment,
    tvSymbol,
    isInWatchlist,
}: CryptoDetailViewProps) {
    return (
        <div className="@container w-full">
            <section className="grid grid-cols-1 gap-8 @3xl:grid-cols-2">
                <div className="flex flex-col gap-6">
                    {tvSymbol ? (
                        <>
                            {/*
                             * Two charts, each with a distinct job: the candlestick view carries
                             * RSI and MACD for momentum, and the baseline view gives a clean price
                             * path without candle noise. The baseline chart was briefly removed as
                             * redundant and is kept because the two read differently.
                             */}
                            <TradingViewWidget
                                scriptUrl={`${SCRIPT_URL}advanced-chart.js`}
                                config={CANDLE_CHART_WIDGET_CONFIG(tvSymbol)}
                                className="custom-chart"
                                height={520}
                                allowExpand={true}
                            />

                            <TradingViewWidget
                                scriptUrl={`${SCRIPT_URL}advanced-chart.js`}
                                config={BASELINE_WIDGET_CONFIG(tvSymbol)}
                                className="custom-chart"
                                height={400}
                                allowExpand={true}
                            />

                            <TradingViewWidget
                                scriptUrl={`${SCRIPT_URL}technical-analysis.js`}
                                config={TECHNICAL_ANALYSIS_WIDGET_CONFIG(tvSymbol)}
                                height={380}
                            />
                        </>
                    ) : (
                        <ChartUnavailable label={coin?.name ?? coinId} />
                    )}
                </div>

                <div className="flex flex-col gap-6">
                    {/* Rendered only when a real symbol resolved — an empty symbol shows
                        TradingView's "Invalid Symbol" placeholder. */}
                    {tvSymbol ? (
                        <TradingViewWidget
                            scriptUrl={`${SCRIPT_URL}symbol-info.js`}
                            config={SYMBOL_INFO_WIDGET_CONFIG(tvSymbol)}
                            height={170}
                        />
                    ) : null}

                    <div className="flex items-center justify-between gap-3">
                        <WatchlistButton
                            symbol={coinId}
                            company={coin?.name ?? coinId}
                            isInWatchlist={isInWatchlist}
                            assetType="crypto"
                        />
                        <CryptoAlertButton
                            coinId={coinId}
                            coinName={coin?.name ?? coinId}
                            currentPrice={coin?.currentPrice ?? 0}
                        />
                    </div>

                    {coin ? (
                        <CryptoAboutCard coin={coin} />
                    ) : (
                        <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-5 text-sm text-gray-500">
                            Coin details are unavailable right now.
                        </div>
                    )}

                    <CryptoSentimentCard
                        up={coin?.sentimentUp}
                        down={coin?.sentimentDown}
                        market={marketSentiment}
                    />
                </div>
            </section>
        </div>
    );
}
