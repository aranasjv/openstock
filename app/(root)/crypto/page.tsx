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
 * Fills the viewport the same way as the stock dashboard: a fixed widget row, then a
 * flexible row whose three panels share one height and scroll internally, so the page
 * itself never scrolls.
 *
 * The RSS news grid that used to sit at the bottom was removed — the timeline widget already
 * covers crypto headlines, and it was the main cause of page scroll. News is still on the
 * watchlist page.
 */
const WIDGET_HEIGHT = 280;

export default async function CryptoDashboard({ searchParams }: CryptoDashboardProps) {
    const { strategy } = await searchParams;
    const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

    const [markets, topCoins] = await Promise.all([
        getCryptoMarkets(50),
        searchCrypto(),
    ]);

    return (
        // No outer padding: panels sit flush against the sidebar and viewport edges. A small
        // gap still separates panels from each other.
        <div className="flex h-full flex-col gap-2">
            <header className="flex shrink-0 flex-col gap-2 px-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-baseline gap-2">
                    <h1 className="bg-clip-text text-lg font-bold text-transparent bg-gradient-to-r from-white to-gray-500">
                        Crypto
                    </h1>
                    <span className="text-[11px] text-gray-600">
                        Live prices and charts for the top coins
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <Link
                        href="/watchlist?tab=crypto"
                        className="rounded-md border border-gray-800 px-2.5 py-1.5 text-[11px] text-gray-300 transition-colors hover:bg-white/5"
                    >
                        Watchlist
                    </Link>
                    <CryptoSearchCommand
                        renderAs="button"
                        label="Search"
                        initialCoins={topCoins}
                    />
                </div>
            </header>

            <section className="grid shrink-0 gap-2 xl:grid-cols-3">
                <TradingViewWidget
                    title="Market overview"
                    scriptUrl={`${scriptUrl}market-overview.js`}
                    config={CRYPTO_MARKET_OVERVIEW_WIDGET_CONFIG}
                    className="custom-chart"
                    height={WIDGET_HEIGHT}
                />
                <TradingViewWidget
                    title="Heatmap"
                    scriptUrl={`${scriptUrl}crypto-coins-heatmap.js`}
                    config={CRYPTO_HEATMAP_WIDGET_CONFIG}
                    height={WIDGET_HEIGHT}
                />
                <TradingViewWidget
                    title="Quotes"
                    scriptUrl={`${scriptUrl}market-quotes.js`}
                    config={CRYPTO_MARKET_DATA_WIDGET_CONFIG}
                    height={WIDGET_HEIGHT}
                />
            </section>

            {/* One flexible row: every panel takes the remaining height, so all three line up
                and none of them can push the page taller than the viewport. */}
            <section className="grid min-h-0 flex-1 gap-2 xl:grid-cols-3">
                <div className="h-full min-h-0">
                    <TopCoinsTable coins={markets} />
                </div>
                <div className="h-full min-h-0">
                    <MustBuySection assetType="crypto" strategyId={strategy} />
                </div>
                <div className="h-full min-h-0">
                    <TradingViewWidget
                        title="News"
                        scriptUrl={`${scriptUrl}timeline.js`}
                        config={CRYPTO_TOP_STORIES_WIDGET_CONFIG}
                        fill
                    />
                </div>
            </section>
        </div>
    );
}
