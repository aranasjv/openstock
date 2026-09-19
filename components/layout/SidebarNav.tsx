'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SearchCommand from '@/components/SearchCommand';
import CryptoSearchCommand from '@/components/crypto/CryptoSearchCommand';
import { SEARCH_PALETTE_ITEMS } from '@/lib/constants';

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

    const entries = [
        { href: '/', label: 'Dashboard' },
        { href: '/search', label: 'Stock search', palette: 'stock' as const },
        { href: '/crypto', label: 'Crypto' },
        { href: '/crypto-search', label: 'Crypto search', palette: 'crypto' as const },
        { href: '/watchlist', label: 'Watchlist' },
        { href: '/holdings', label: 'Holdings' },
        { href: '/settings', label: 'Settings' },
        { href: '/api-docs', label: 'API Docs' },
    ];

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
