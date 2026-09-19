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
 * Everything is deliberately sized to fit one screen: four widgets at 300px in a 3-column
 * grid, with the Must Buy list scrolling inside its own panel rather than growing the page.
 */
const WIDGET_HEIGHT = 300;

const Home = async ({ searchParams }: HomeProps) => {
    const { strategy } = await searchParams;
    const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

    return (
        <div className="flex h-full flex-col gap-3 p-3">
            <section className="grid w-full shrink-0 gap-3 xl:grid-cols-3">
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

            <section className="grid min-h-[340px] w-full flex-1 gap-3 xl:grid-cols-3">
                <div className="min-h-0 xl:col-span-2">
                    <MustBuySection assetType="stock" strategyId={strategy} />
                </div>
                <TradingViewWidget
                    title="Top Stories"
                    scriptUrl={`${scriptUrl}timeline.js`}
                    config={TOP_STORIES_WIDGET_CONFIG}
                    height={WIDGET_HEIGHT}
                />
            </section>
        </div>
    )
}

export default Home;
