import Link from "next/link";
import TradingViewWidget from "@/components/TradingViewWidget";
import TopCoinsTable from "@/components/crypto/TopCoinsTable";
import CryptoSearchCommand from "@/components/crypto/CryptoSearchCommand";
import {
    CRYPTO_HEATMAP_WIDGET_CONFIG,
    CRYPTO_MARKET_DATA_WIDGET_CONFIG,
    CRYPTO_MARKET_OVERVIEW_WIDGET_CONFIG,
    CRYPTO_TOP_STORIES_WIDGET_CONFIG,
} from "@/lib/constants";
import { getCryptoMarkets, searchCrypto } from "@/lib/actions/crypto.actions";
import MustBuySection from "@/components/screener/MustBuySection";

interface CryptoDashboardProps {
    searchParams: Promise<{ strategy?: string }>;
}

/**
 * Compact crypto dashboard.
 *
 * Sized for a single screen: a 3-up widget row and a second row of equal-height panels that
 * scroll internally. The RSS news grid that used to sit at the bottom was removed — the
 * timeline widget already covers crypto headlines, and it was the main cause of page scroll.
 * News is still available on the watchlist page.
 */
const WIDGET_HEIGHT = 300;

export default async function CryptoDashboard({ searchParams }: CryptoDashboardProps) {
    const { strategy } = await searchParams;
    const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

    const [markets, topCoins] = await Promise.all([
        getCryptoMarkets(50),
        searchCrypto(),
    ]);

    return (
        <div className="flex h-full flex-col gap-3 p-3">
            <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="bg-clip-text text-xl font-bold text-transparent bg-gradient-to-r from-white to-gray-500">
                        Crypto
                    </h1>
                    <p className="text-xs text-gray-500">
                        Live prices, market cap and charts for the top cryptocurrencies.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Link
                        href="/watchlist?tab=crypto"
                        className="rounded-md border border-gray-800 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/5"
                    >
                        Crypto watchlist
                    </Link>
                    <CryptoSearchCommand
                        renderAs="button"
                        label="Search Crypto"
                        initialCoins={topCoins}
                    />
                </div>
            </div>

            <section className="grid w-full shrink-0 gap-3 xl:grid-cols-3">
                <TradingViewWidget
                    title="Crypto Market Overview"
                    scriptUrl={`${scriptUrl}market-overview.js`}
                    config={CRYPTO_MARKET_OVERVIEW_WIDGET_CONFIG}
                    className="custom-chart"
                    height={WIDGET_HEIGHT}
                />
                <TradingViewWidget
                    title="Crypto Heatmap"
                    scriptUrl={`${scriptUrl}crypto-coins-heatmap.js`}
                    config={CRYPTO_HEATMAP_WIDGET_CONFIG}
                    height={WIDGET_HEIGHT}
                />
                <TradingViewWidget
                    title="Crypto Quotes"
                    scriptUrl={`${scriptUrl}market-quotes.js`}
                    config={CRYPTO_MARKET_DATA_WIDGET_CONFIG}
                    height={WIDGET_HEIGHT}
                />
            </section>

            <section className="grid min-h-[340px] w-full flex-1 gap-3 xl:grid-cols-3">
                <div className="min-h-0 xl:col-span-1">
                    <TopCoinsTable coins={markets} />
                </div>
                <div className="min-h-0 xl:col-span-1">
                    <MustBuySection assetType="crypto" strategyId={strategy} />
                </div>
                <TradingViewWidget
                    title="Crypto News"
                    scriptUrl={`${scriptUrl}timeline.js`}
                    config={CRYPTO_TOP_STORIES_WIDGET_CONFIG}
                    height={WIDGET_HEIGHT}
                />
            </section>
        </div>
    );
}
