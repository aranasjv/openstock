import TradingViewWidget from "@/components/TradingViewWidget";
import TopCoinsTable from "@/components/crypto/TopCoinsTable";
import CryptoSearchCommand from "@/components/crypto/CryptoSearchCommand";
import NewsGrid from "@/components/watchlist/NewsGrid";
import {
    CRYPTO_HEATMAP_WIDGET_CONFIG,
    CRYPTO_MARKET_DATA_WIDGET_CONFIG,
    CRYPTO_MARKET_OVERVIEW_WIDGET_CONFIG,
    CRYPTO_TOP_STORIES_WIDGET_CONFIG,
} from "@/lib/constants";
import { getCryptoMarkets, getCryptoNews, searchCrypto } from "@/lib/actions/crypto.actions";

export default async function CryptoDashboard() {
    const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

    const [markets, news, topCoins] = await Promise.all([
        getCryptoMarkets(50),
        getCryptoNews(),
        searchCrypto(),
    ]);

    return (
        <div className="flex min-h-screen flex-col gap-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="bg-clip-text text-3xl font-bold text-transparent bg-gradient-to-r from-white to-gray-500">
                        Crypto
                    </h1>
                    <p className="mt-1 text-gray-500">
                        Live prices, market cap and charts for the top cryptocurrencies.
                    </p>
                </div>
                <CryptoSearchCommand
                    renderAs="button"
                    label="Search Crypto"
                    initialCoins={topCoins}
                />
            </div>

            <section className="grid w-full gap-8 home-section">
                <div className="md:col-span-1 xl:col-span-1">
                    <TradingViewWidget
                        title="Crypto Market Overview"
                        scriptUrl={`${scriptUrl}market-overview.js`}
                        config={CRYPTO_MARKET_OVERVIEW_WIDGET_CONFIG}
                        className="custom-chart"
                        height={600}
                    />
                </div>
                <div className="md-col-span xl:col-span-2">
                    <TradingViewWidget
                        title="Crypto Heatmap"
                        scriptUrl={`${scriptUrl}crypto-coins-heatmap.js`}
                        config={CRYPTO_HEATMAP_WIDGET_CONFIG}
                        height={600}
                    />
                </div>
            </section>

            <TopCoinsTable coins={markets} />

            <section className="grid w-full gap-8 home-section">
                <div className="h-full md:col-span-1 xl:col-span-2">
                    <TradingViewWidget
                        title="Crypto Quotes"
                        scriptUrl={`${scriptUrl}market-quotes.js`}
                        config={CRYPTO_MARKET_DATA_WIDGET_CONFIG}
                        height={600}
                    />
                </div>
                <div className="h-full md:col-span-1 xl:col-span-1">
                    <TradingViewWidget
                        title="Crypto News"
                        scriptUrl={`${scriptUrl}timeline.js`}
                        config={CRYPTO_TOP_STORIES_WIDGET_CONFIG}
                        height={600}
                    />
                </div>
            </section>

            <NewsGrid news={news} />
        </div>
    );
}
