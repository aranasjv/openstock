'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from '@/lib/constants';

/**
 * Order is a sidebar concern, but the hrefs and labels come from `NAV_ITEMS`. This list used to
 * be a second, hand-maintained copy of the nav, which had already drifted: `/assistant` existed
 * in NAV_ITEMS and was missing here, so the assistant was unreachable from the sidebar.
 *
 * The two search palettes are deliberately absent. Each market already opens its own search
 * from its header, so the sidebar entries were a second door into the same room — and they cost
 * two full list fetches on every page render, just so the sidebar could offer them.
 */
const SIDEBAR_ORDER = [
    '/',
    '/assistant',
    '/crypto',
    '/watchlist',
    '/holdings',
    '/settings',
    '/api-docs',
];

/**
 * Sidebar-only label overrides, keyed by href. An entry with no override keeps its `NAV_ITEMS`
 * label, so "Stocks Dashboard" and "Crypto Dashboard" come from there.
 */
const LABEL_OVERRIDES: Record<string, string> = {
    '/assistant': 'AI Chat',
};

/**
 * Sidebar navigation: one link per destination, stacked vertically.
 */
export default function SidebarNav() {
    const pathname = usePathname();

    const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

    return (
        <nav className="flex flex-col gap-0.5">
            {SIDEBAR_ORDER.map((href) => {
                const label = LABEL_OVERRIDES[href] ?? NAV_ITEMS.find((item) => item.href === href)?.label ?? href;

                return (
                    <Link
                        key={href}
                        href={href}
                        className={`rounded-md px-3 py-2 text-sm transition-colors ${
                            isActive(href)
                                ? 'bg-teal-600/15 font-medium text-teal-300'
                                : 'text-gray-400 hover:bg-white/5 hover:text-gray-100'
                        }`}
                    >
                        {label}
                    </Link>
                );
            })}
        </nav>
    );
}
