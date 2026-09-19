import TradingViewWidget from "@/components/TradingViewWidget";
import MustBuySection from "@/components/screener/MustBuySection";
import {
    HEATMAP_WIDGET_CONFIG,
    MARKET_DATA_WIDGET_CONFIG,
    MARKET_OVERVIEW_WIDGET_CONFIG,
    TOP_STORIES_WIDGET_CONFIG
} from "@/lib/constants";

interface HomeProps {
    searchParams: Promise<{ strategy?: string }>;
}

/**
 * Compact dashboard layout.
 *
 * The shell is viewport-height, and this page fills it: a fixed widget row plus a flexible
 * row that takes whatever is left. Panels in the second row share that height, and each
 * scrolls internally — so the page itself never scrolls, and the two panels are always the
 * same height regardless of how much content they hold.
 */
const WIDGET_HEIGHT = 280;

const Home = async ({ searchParams }: HomeProps) => {
    const { strategy } = await searchParams;
    const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

    return (
        // No outer padding: the panels sit flush against the sidebar and viewport edges so the
        // dashboard uses the full area. A small gap still separates panels from each other.
        <div className="flex h-full flex-col gap-2">
            <section className="grid shrink-0 gap-2 xl:grid-cols-3">
                <TradingViewWidget
                    title="Market Overview"
                    scriptUrl={`${scriptUrl}market-overview.js`}
                    config={MARKET_OVERVIEW_WIDGET_CONFIG}
                    className="custom-chart"
                    height={WIDGET_HEIGHT}
                />
                <TradingViewWidget
                    title="Stock Heatmap"
                    scriptUrl={`${scriptUrl}stock-heatmap.js`}
                    config={HEATMAP_WIDGET_CONFIG}
                    height={WIDGET_HEIGHT}
                />
                <TradingViewWidget
                    title="Stocks"
                    scriptUrl={`${scriptUrl}market-quotes.js`}
                    config={MARKET_DATA_WIDGET_CONFIG}
                    height={WIDGET_HEIGHT}
                />
            </section>

            <section className="grid min-h-0 flex-1 gap-2 xl:grid-cols-3">
                <div className="h-full min-h-0 xl:col-span-2">
                    <MustBuySection assetType="stock" strategyId={strategy} />
                </div>
                <div className="h-full min-h-0">
                    <TradingViewWidget
                        title="Top Stories"
                        scriptUrl={`${scriptUrl}timeline.js`}
                        config={TOP_STORIES_WIDGET_CONFIG}
                        fill
                    />
                </div>
            </section>
        </div>
    )
}

export default Home;
