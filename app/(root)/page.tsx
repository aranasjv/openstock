import AskAiButton from "@/components/assistant/AskAiButton";
import BreadthStrip from "@/components/breadth/BreadthStrip";
import MarketToggle from "@/components/market/MarketToggle";
import PseMarketTable from "@/components/ph/PseMarketTable";
import SearchCommand from "@/components/SearchCommand";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import TradingViewWidget from "@/components/TradingViewWidget";
import SetupsSection from "@/components/screener/SetupsSection";
import { fetchPseMarket } from "@/lib/phisix";
import { parseMarket } from "@/lib/markets";
import {
    HEATMAP_WIDGET_CONFIG,
    MARKET_DATA_WIDGET_CONFIG,
    MARKET_OVERVIEW_WIDGET_CONFIG,
    PH_INDEX_WIDGET_CONFIG,
    TOP_STORIES_WIDGET_CONFIG,
    phQuotesWidgetConfig,
} from "@/lib/constants";

interface HomeProps {
    searchParams: Promise<{ strategy?: string; market?: string }>;
}

/**
 * Compact dashboard layout, for two markets.
 *
 * The shell is viewport-height, and this page fills it: a fixed widget row plus a flexible
 * row that takes whatever is left. Panels in the second row share that height, and each
 * scrolls internally — so the page itself never scrolls, and the two panels are always the
 * same height regardless of how much content they hold.
 *
 * The market is a URL parameter rather than a stored preference: that keeps the view shareable and
 * server-renderable, and matches how the screener's strategy is already chosen on this page.
 *
 * The two branches are not symmetric, and the asymmetry is honest rather than unfinished. For the
 * US, every panel is a real feed. For the PSE, charts and quotes come from TradingView and the
 * table from phisix, but the screener cannot run at all — it scores trend and momentum from daily
 * bars, and no source this app can reach carries PSE history. So the PSE branch states that instead
 * of rendering an empty screener that looks like "nothing matched today".
 */
const WIDGET_HEIGHT = 280;

const Home = async ({ searchParams }: HomeProps) => {
    const { strategy, market: marketParam } = await searchParams;
    const market = parseMarket(marketParam);
    const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

    // One fetch per market, and only the one in use. The US palette and the PSE table have nothing
    // in common, so fetching both would pay twice for half of it.
    const [initialStocks, pse] = await Promise.all([
        market === 'us' ? searchStocks() : Promise.resolve([]),
        market === 'ph' ? fetchPseMarket() : Promise.resolve(null),
    ]);

    // The quote board is built from what the feed says is trading, not from a curated list — a
    // hardcoded set would drift from the market it claims to show.
    const phSymbols = (pse?.quotes ?? []).slice(0, 15).map((quote) => ({
        symbol: quote.symbol,
        name: quote.name,
    }));

    // The header chip dimensions are shared with "Ask AI" so the two read as one row of controls
    // rather than one small link and one large button.
    const headerChip =
        'inline-flex items-center gap-1.5 rounded-md border border-gray-800 px-2.5 py-1.5 text-[11px] text-gray-300 transition-colors hover:bg-white/5';

    return (
        // No outer padding: the panels sit flush against the sidebar and viewport edges so the
        // dashboard uses the full area. A small gap still separates panels from each other.
        <div className="flex h-full flex-col gap-2">
            {/* Same compact header pattern as the crypto dashboard, so the Assistant is
                reachable from both markets without adding any persistent chrome. */}
            <header className="flex shrink-0 items-center justify-between gap-2 px-2 pt-2">
                <div className="flex items-baseline gap-2">
                    <h1 className="bg-clip-text text-lg font-bold text-transparent bg-gradient-to-r from-white to-gray-500">
                        {market === 'ph' ? 'Philippines' : 'Stocks'}
                    </h1>
                    <span className="text-[11px] text-gray-500">
                        {market === 'ph'
                            ? 'PSE index, quotes and the market table'
                            : 'Live indices, heatmap and the setups screen'}
                    </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <MarketToggle market={market} />
                    <AskAiButton />
                    {/* The palette searches US listings only, so it is hidden on the PSE rather than
                        offered and then failing on a market it cannot serve. */}
                    {market === 'us' ? (
                        <SearchCommand
                            renderAs="button"
                            label="Search"
                            initialStocks={initialStocks}
                            className={headerChip}
                        />
                    ) : null}
                </div>
            </header>

            {market === 'us' ? (
                <>
                    {/* Breadth sits between the header and the widgets: it is context for everything
                        below it, and the strip is its own Suspense boundary implicitly, so the page
                        paints while the third-party CSV resolves. It renders nothing if that fails. */}
                    <BreadthStrip />

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

                    {/* The screener gets the width it needs and the news column does not take a third
                        of the row by default — the table is the content, the headlines are secondary. */}
                    <section className="grid min-h-0 flex-1 gap-2 xl:grid-cols-[1.9fr_1fr]">
                        <div className="h-full min-h-0">
                            <SetupsSection assetType="stock" strategyId={strategy} />
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
                </>
            ) : (
                <>
                    <section className="grid shrink-0 gap-2 xl:grid-cols-3">
                        <TradingViewWidget
                            title="PSEi Index"
                            scriptUrl={`${scriptUrl}advanced-chart.js`}
                            config={PH_INDEX_WIDGET_CONFIG}
                            className="custom-chart"
                            height={WIDGET_HEIGHT}
                        />
                        <TradingViewWidget
                            title="PSE Quotes"
                            scriptUrl={`${scriptUrl}market-quotes.js`}
                            config={phQuotesWidgetConfig(phSymbols)}
                            height={WIDGET_HEIGHT}
                        />
                        <PseMarketTable />
                    </section>

                    <section className="grid min-h-0 flex-1 gap-2 xl:grid-cols-[1.9fr_1fr]">
                        <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 rounded-xl border border-gray-800 bg-gray-900/30 p-6 text-center">
                            <p className="text-sm font-medium text-gray-300">
                                Screening is not available for the PSE yet
                            </p>
                            <p className="max-w-md text-xs text-gray-500">
                                The screen scores trend, momentum and breakout conditions from daily
                                bars. Nothing this app can reach carries PSE history — Yahoo and
                                Finnhub both exclude the exchange — so this market cannot be screened,
                                rather than simply returning no matches.
                            </p>
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
                </>
            )}
        </div>
    )
}

export default Home;
