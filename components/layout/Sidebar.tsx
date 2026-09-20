import Image from 'next/image';
import Link from 'next/link';
import SidebarNav from '@/components/layout/SidebarNav';
import SidebarPickRows from '@/components/layout/SidebarPickRows';
import { searchStocks } from '@/lib/actions/finnhub.actions';
import { searchCrypto } from '@/lib/actions/crypto.actions';
import { getPortfolioSummary } from '@/lib/actions/holdings.actions';
import { runScreener } from '@/lib/actions/screener.actions';
import { getStrategy, DEFAULT_STRATEGY_ID, isStrategyId } from '@/lib/strategies';
import { loadConfig } from '@/lib/config';
import { formatCryptoPrice, formatPrice } from '@/lib/utils';

/**
 * Persistent left sidebar: navigation, a portfolio snapshot, and today's top must-buy
 * scores. Replaces the former top header so page content gets the full remaining width.
 *
 * Everything here is served from caches that already exist — the screener shares its cached
 * scan with the dashboard's Must Buy section, and holdings prices come from the same batched
 * lookups — so the sidebar adds no new data sources.
 */
export default async function Sidebar({ user }: { user: User }) {
    const config = await loadConfig();
    const strategyId = isStrategyId(config.SCREENER_STRATEGY)
        ? config.SCREENER_STRATEGY
        : DEFAULT_STRATEGY_ID;

    const [initialStocks, initialCoins, portfolio, stockResult, cryptoResult] = await Promise.all([
        searchStocks(),
        searchCrypto(),
        getPortfolioSummary(),
        runScreener('stock', strategyId),
        runScreener('crypto', strategyId),
    ]);

    // One list per market. Previously these were merged and sorted by score, which meant
    // stocks (whose conditions are easier to satisfy in full) crowded crypto out entirely.
    const topStocks = stockResult.candidates
        .filter((candidate) => candidate.matched > 0)
        .slice(0, 2);
    const topCrypto = cryptoResult.candidates
        .filter((candidate) => candidate.matched > 0)
        .slice(0, 2);

    const pnlPositive = portfolio.totalPnl >= 0;

    return (
        <aside className="hidden w-60 shrink-0 flex-col border-r border-gray-800 bg-black lg:flex">
            <div className="sticky top-0 flex h-screen flex-col overflow-y-auto px-3 py-4">
                <Link href="/" className="mb-4 block px-1">
                    <Image
                        src="/assets/images/logo.png"
                        alt="OpenStock"
                        width={160}
                        height={40}
                        className="h-8 w-auto"
                    />
                </Link>

                <SidebarNav initialStocks={initialStocks} initialCoins={initialCoins} />

                {/* Portfolio snapshot */}
                <div className="mt-5 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-gray-600">Portfolio</div>
                    <div className="mt-0.5 font-mono text-lg text-gray-100">
                        {formatPrice(portfolio.totalValue)}
                    </div>
                    <div className={`text-xs ${pnlPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                        {pnlPositive ? '+' : ''}
                        {formatPrice(portfolio.totalPnl)} ({portfolio.totalPnlPercent.toFixed(1)}%)
                    </div>
                    {portfolio.holdings.length === 0 ? (
                        <Link href="/holdings" className="mt-1 block text-[11px] text-teal-400 hover:text-teal-300">
                            Add a holding →
                        </Link>
                    ) : null}
                </div>

                {/* Top must-buy picks, split by market so both are always represented. */}
                <div className="mt-3 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-gray-600">
                            Must buy
                        </span>
                        <span className="text-[10px] text-gray-600">
                            {getStrategy(strategyId).name}
                        </span>
                    </div>

                    <div className="mt-2">
                        <div className="text-[10px] font-medium uppercase tracking-wider text-gray-700">
                            Stocks
                        </div>
                        <SidebarPickRows picks={topStocks} isCrypto={false} />
                    </div>

                    <div className="mt-2.5">
                        <div className="text-[10px] font-medium uppercase tracking-wider text-gray-700">
                            Crypto
                        </div>
                        <SidebarPickRows picks={topCrypto} isCrypto />
                    </div>
                </div>

                <div className="mt-auto space-y-2 pt-4">
                    <Link
                        href="/settings"
                        className="block truncate rounded-md px-2 py-1.5 text-xs text-gray-500 hover:bg-white/5 hover:text-gray-300"
                    >
                        {user.name}
                        <span className="block truncate text-[10px] text-gray-600">{user.email}</span>
                    </Link>

                    {/*
                     * Secondary links. These lived in a large footer that took a big block on
                     * every page; folding them into two compact rows keeps /about, /help and
                     * /terms reachable without costing page height.
                     */}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 px-2 text-[10px] text-gray-600">
                        <Link href="/about" className="hover:text-gray-400">About</Link>
                        <Link href="/help" className="hover:text-gray-400">Help</Link>
                        <Link href="/terms" className="hover:text-gray-400">Terms</Link>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 px-2 text-[10px] text-gray-700">
                        <a
                            href="https://github.com/Open-Dev-Society/OpenStock"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-gray-500"
                        >
                            GitHub
                        </a>
                        <a
                            href="https://discord.gg/JkJ8kfxgxB"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-gray-500"
                        >
                            Discord
                        </a>
                        <a
                            href="https://www.linkedin.com/company/opendevsociety-in/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-gray-500"
                        >
                            LinkedIn
                        </a>
                    </div>
                </div>
            </div>
        </aside>
    );
}
