import BreadthStrip from "@/components/breadth/BreadthStrip";
import MarketToggle from "@/components/market/MarketToggle";
import PhNewsPanel from "@/components/ph/PhNewsPanel";
import PseMarketTable from "@/components/ph/PseMarketTable";
import PseMovers from "@/components/ph/PseMovers";
import SearchCommand from "@/components/SearchCommand";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import TradingViewWidget from "@/components/TradingViewWidget";
import SetupsSection from "@/components/screener/SetupsSection";
import { parseMarket } from "@/lib/markets";
import { parsePseFilter } from "@/lib/pse-filter";
import {
    HEATMAP_WIDGET_CONFIG,
    MARKET_DATA_WIDGET_CONFIG,
    MARKET_OVERVIEW_WIDGET_CONFIG,
    TOP_STORIES_WIDGET_CONFIG,
} from "@/lib/constants";

interface HomeProps {
    // A broad record rather than named fields: this page reads the market, the screener strategy and
    // the filter parameters, and enumerating them had already drifted behind the code once.
    searchParams: Promise<Record<string, string | string[] | undefined>>;
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
 * US, every panel is a real feed. For the PSE, everything now comes from phisix: the TradingView
 * panels originally tried there did not render — the index reported its symbol as available only on
 * TradingView, and the quotes board came back empty — and neither was a configuration mistake, so
 * they were replaced rather than repaired. The screener still cannot run at all, because it scores
 * trend and momentum from daily bars and no source this app can reach carries PSE history. The PSE
 * branch states that instead of rendering an empty screener that looks like "nothing matched today".
 */
const WIDGET_HEIGHT = 280;

const Home = async ({ searchParams }: HomeProps) => {
    const params = await searchParams;
    const market = parseMarket(typeof params.market === "string" ? params.market : undefined);
    const strategy = typeof params.strategy === "string" ? params.strategy : undefined;

    // Parsed from the same parameters the filter form writes, so the table and the form cannot
    // disagree about what is being shown.
    const pseFilter = parsePseFilter(params);
    const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

    // Only the US palette is pre-fetched. The PSE panels read the feed themselves and share the same
    // cached request, so pre-fetching here would buy nothing while adding a second source of truth.
    const initialStocks = market === 'us' ? await searchStocks() : [];

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
                    {/* Both PH rows share the viewport instead of the first sizing to its content.
                        That was the defect in the previous version: the market table grew the page
                        rather than scrolling inside it, so the dashboard ran past the fold. */}
                    <section className="grid min-h-0 flex-1 gap-2 xl:grid-cols-[1fr_1.6fr]">
                        <PseMovers />
                        <PseMarketTable filter={pseFilter} />
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
                        <PhNewsPanel />
                    </section>
                </>
            )}
        </div>
    )
}

export default Home;
