'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export type WatchlistTab = 'stocks' | 'crypto';

interface WatchlistTabsProps {
    active: WatchlistTab;
    stockCount: number;
    cryptoCount: number;
}

/**
 * Writes the selected tab to the URL so the server re-renders with the right asset type.
 * Same pattern as the screener's strategy dropdown: shareable, and no client-side fetching.
 */
export default function WatchlistTabs({ active, stockCount, cryptoCount }: WatchlistTabsProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const select = (tab: WatchlistTab) => {
        const params = new URLSearchParams(searchParams.toString());
        if (tab === 'stocks') params.delete('tab');
        else params.set('tab', tab);
        const query = params.toString();
        router.replace(query ? `/watchlist?${query}` : '/watchlist', { scroll: false });
    };

    const tabs: { id: WatchlistTab; label: string; count: number }[] = [
        { id: 'stocks', label: 'Stocks', count: stockCount },
        { id: 'crypto', label: 'Crypto', count: cryptoCount },
    ];

    return (
        <div className="flex items-center gap-1 rounded-lg border border-gray-800 bg-gray-900/40 p-1">
            {tabs.map((tab) => {
                const isActive = tab.id === active;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => select(tab.id)}
                        aria-current={isActive ? 'page' : undefined}
                        className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                            isActive
                                ? 'bg-teal-600 text-white'
                                : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                        }`}
                    >
                        {tab.label}
                        <span
                            className={`rounded-full px-1.5 text-[10px] ${
                                isActive ? 'bg-black/25 text-white' : 'bg-gray-800 text-gray-500'
                            }`}
                        >
                            {tab.count}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
