import Image from 'next/image';
import Link from 'next/link';
import SidebarNav from '@/components/layout/SidebarNav';
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
        getPortfolioSummary(user.id),
        runScreener('stock', strategyId),
        runScreener('crypto', strategyId),
    ]);

    // Top picks across both markets, so the sidebar reflects everything at a glance.
    const topPicks = [...stockResult.candidates, ...cryptoResult.candidates]
        .filter((candidate) => candidate.matched > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

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

                {/* Top must-buy picks */}
                <div className="mt-3 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-gray-600">
                            Must buy
                        </span>
                        <span className="text-[10px] text-gray-600">
                            {getStrategy(strategyId).name}
                        </span>
                    </div>

                    {topPicks.length > 0 ? (
                        <ul className="mt-2 space-y-1.5">
                            {topPicks.map((pick) => {
                                const isCrypto = cryptoResult.candidates.some(
                                    (candidate) => candidate.symbol === pick.symbol
                                );
                                return (
                                    <li key={`${isCrypto ? 'c' : 's'}-${pick.symbol}`} className="flex items-center justify-between gap-2">
                                        <Link
                                            href={isCrypto ? `/crypto/${pick.symbol}` : `/stocks/${pick.symbol}`}
                                            className="truncate text-xs text-gray-300 hover:text-teal-300"
                                        >
                                            {pick.symbol}
                                        </Link>
                                        <span className="shrink-0 font-mono text-[11px] text-gray-500">
                                            {isCrypto ? formatCryptoPrice(pick.price) : formatPrice(pick.price)}
                                        </span>
                                        <span
                                            className={`shrink-0 rounded px-1 text-[10px] ${
                                                pick.tier === 'Strong'
                                                    ? 'bg-emerald-950/60 text-emerald-300'
                                                    : pick.tier === 'Moderate'
                                                        ? 'bg-teal-950/60 text-teal-300'
                                                        : 'bg-gray-800 text-gray-400'
                                            }`}
                                        >
                                            {pick.score}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <p className="mt-2 text-[11px] text-gray-600">No matches right now.</p>
                    )}
                </div>

                <div className="mt-auto pt-4">
                    <Link
                        href="/settings"
                        className="block truncate rounded-md px-2 py-1.5 text-xs text-gray-500 hover:bg-white/5 hover:text-gray-300"
                    >
                        {user.name}
                        <span className="block truncate text-[10px] text-gray-600">{user.email}</span>
                    </Link>
                </div>
            </div>
        </aside>
    );
}
