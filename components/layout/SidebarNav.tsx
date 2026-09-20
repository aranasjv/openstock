'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SearchCommand from '@/components/SearchCommand';
import CryptoSearchCommand from '@/components/crypto/CryptoSearchCommand';
import { NAV_ITEMS, SEARCH_PALETTE_ITEMS } from '@/lib/constants';

/**
 * Order is a sidebar concern (each search palette sits next to the market it searches), but
 * the hrefs and labels come from `NAV_ITEMS`. This list used to be a second, hand-maintained
 * copy of the nav, which had already drifted: `/assistant` existed in NAV_ITEMS and was
 * missing here, so the assistant was unreachable from the sidebar entirely.
 */
const SIDEBAR_ORDER = [
    '/',
    '/assistant',
    '/search',
    '/crypto',
    '/crypto-search',
    '/watchlist',
    '/holdings',
    '/settings',
    '/api-docs',
];

/**
 * Sidebar-only label overrides, keyed by href. A sidebar has room for "Stock search" where a
 * header needs "Search"; an entry with no override keeps its `NAV_ITEMS` label.
 */
const LABEL_OVERRIDES: Record<string, string> = {
    '/search': 'Stock search',
    '/crypto-search': 'Crypto search',
    '/assistant': 'AI Chat',
};

interface SidebarNavProps {
    initialStocks: StockWithWatchlistStatus[];
    initialCoins: CryptoCoinWithWatchlistStatus[];
}

/**
 * Sidebar navigation.
 *
 * Mirrors NavItems' behaviour — the `/search` and `/crypto-search` entries open a search
 * palette rather than navigating, since there are no routes at those paths — but stacks
 * vertically for the sidebar.
 */
export default function SidebarNav({ initialStocks, initialCoins }: SidebarNavProps) {
    const pathname = usePathname();

    const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

    const entries = SIDEBAR_ORDER.map((href) => ({
        href,
        label: LABEL_OVERRIDES[href] ?? NAV_ITEMS.find((item) => item.href === href)?.label ?? href,
        palette: SEARCH_PALETTE_ITEMS[href],
    }));

    return (
        <nav className="flex flex-col gap-0.5">
            {entries.map((entry) => {
                const palette = SEARCH_PALETTE_ITEMS[entry.href];
                const active = !palette && isActive(entry.href);

                return (
                    <div key={entry.href} className="contents">
                        {palette === 'stock' ? (
                            <SearchCommand renderAs="text" label={entry.label} initialStocks={initialStocks} />
                        ) : palette === 'crypto' ? (
                            <CryptoSearchCommand renderAs="text" label={entry.label} initialCoins={initialCoins} />
                        ) : (
                            <Link
                                href={entry.href}
                                className={`rounded-md px-3 py-2 text-sm transition-colors ${
                                    active
                                        ? 'bg-teal-600/15 font-medium text-teal-300'
                                        : 'text-gray-400 hover:bg-white/5 hover:text-gray-100'
                                }`}
                            >
                                {entry.label}
                            </Link>
                        )}
                    </div>
                );
            })}
        </nav>
    );
}
