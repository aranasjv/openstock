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

export default async function CryptoDetails({ params }: CryptoDetailsPageProps) {
    const { id } = await params;
    const coinId = id.toLowerCase();
    const tvSymbol = formatCryptoSymbolForTradingView(coinId);
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

    return (
        <div className="flex min-h-screen p-4 md:p-6 lg:p-8">
            <section className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full">
                {/* Left column */}
                <div className="flex flex-col gap-6">
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

                    <TradingViewWidget
                        scriptUrl={`${scriptUrl}technical-analysis.js`}
                        config={TECHNICAL_ANALYSIS_WIDGET_CONFIG(tvSymbol)}
                        height={400}
                    />
                </div>
            </section>
        </div>
    );
}
