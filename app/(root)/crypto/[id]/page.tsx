import TradingViewWidget from "@/components/TradingViewWidget";
import WatchlistButton from "@/components/WatchlistButton";
import CryptoAboutCard from "@/components/crypto/CryptoAboutCard";
import CryptoAlertButton from "@/components/crypto/CryptoAlertButton";
import {
    SYMBOL_INFO_WIDGET_CONFIG,
    CANDLE_CHART_WIDGET_CONFIG,
    BASELINE_WIDGET_CONFIG,
    TECHNICAL_ANALYSIS_WIDGET_CONFIG,
} from "@/lib/constants";

import { getAuth } from '@/lib/better-auth/auth';
import { headers } from 'next/headers';
import { isStockInWatchlist } from '@/lib/actions/watchlist.actions';
import { getCryptoCoinDetail } from '@/lib/actions/crypto.actions';
import { formatCryptoSymbolForTradingView } from '@/lib/utils';

function ChartUnavailable({ label }: { label: string }) {
    return (
        <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-gray-800 bg-gray-900/30 p-6 text-center">
            <p className="text-sm text-gray-400">{label} chart unavailable</p>
            <p className="max-w-sm text-xs text-gray-600">
                TradingView has no matching pair for this coin, so no chart is shown rather than
                an &quot;Invalid Symbol&quot; placeholder. Price data above comes from CoinGecko.
            </p>
        </div>
    );
}

export default async function CryptoDetails({ params }: CryptoDetailsPageProps) {
    const { id } = await params;
    const coinId = id.toLowerCase();
    const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

    const auth = await getAuth();
    const session = await auth.api.getSession({
        headers: await headers()
    });
    const userId = session?.user?.id;

    const [isInWatchlist, coin] = await Promise.all([
        userId ? isStockInWatchlist(userId, coinId, 'crypto') : Promise.resolve(false),
        getCryptoCoinDetail(coinId),
    ]);

    // TradingView needs the ticker ("TAO"), not the CoinGecko id ("bittensor"). The detail
    // response is the only place that ticker is available, so the symbol is resolved after
    // it arrives — and left null when it cannot be, so the charts can be skipped.
    const tvSymbol = coin?.symbol ? formatCryptoSymbolForTradingView(coin.symbol) : null;

    return (
        <div className="flex min-h-screen p-4 md:p-6 lg:p-8">
            <section className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full">
                {/* Left column */}
                <div className="flex flex-col gap-6">
                    {tvSymbol ? (
                        <>
                            <TradingViewWidget
                                scriptUrl={`${scriptUrl}symbol-info.js`}
                                config={SYMBOL_INFO_WIDGET_CONFIG(tvSymbol)}
                                height={170}
                            />

                            <TradingViewWidget
                                scriptUrl={`${scriptUrl}advanced-chart.js`}
                                config={CANDLE_CHART_WIDGET_CONFIG(tvSymbol)}
                                className="custom-chart"
                                height={600}
                                allowExpand={true}
                            />

                            <TradingViewWidget
                                scriptUrl={`${scriptUrl}advanced-chart.js`}
                                config={BASELINE_WIDGET_CONFIG(tvSymbol)}
                                className="custom-chart"
                                height={600}
                                allowExpand={true}
                            />
                        </>
                    ) : (
                        <ChartUnavailable label={coin?.name ?? coinId} />
                    )}
                </div>

                {/* Right column */}
                <div className="flex flex-col gap-6">
                    <div className="flex items-center justify-between gap-3">
                        <WatchlistButton
                            symbol={coinId}
                            company={coin?.name ?? coinId}
                            isInWatchlist={isInWatchlist}
                            userId={userId}
                            assetType="crypto"
                        />
                        {userId ? (
                            <CryptoAlertButton
                                userId={userId}
                                coinId={coinId}
                                coinName={coin?.name ?? coinId}
                                currentPrice={coin?.currentPrice ?? 0}
                            />
                        ) : null}
                    </div>

                    {coin ? (
                        <CryptoAboutCard coin={coin} />
                    ) : (
                        <div className="rounded-xl border border-gray-800 bg-gray-900/30 p-5 text-sm text-gray-500">
                            Coin details are unavailable right now.
                        </div>
                    )}

                    {tvSymbol ? (
                        <TradingViewWidget
                            scriptUrl={`${scriptUrl}technical-analysis.js`}
                            config={TECHNICAL_ANALYSIS_WIDGET_CONFIG(tvSymbol)}
                            height={400}
                        />
                    ) : null}
                </div>
            </section>
        </div>
    );
}
