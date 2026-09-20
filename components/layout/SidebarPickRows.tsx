'use client';

import Link from 'next/link';
import { openCoinDrawer } from '@/lib/coin-drawer-event';
import { formatCryptoPrice, formatPrice } from '@/lib/utils';

interface SidebarPick {
    symbol: string;
    price: number;
    score: number;
    tier: string;
}

interface SidebarPickRowsProps {
    picks: SidebarPick[];
    isCrypto: boolean;
}

/**
 * Compact pick list for the sidebar.
 *
 * Crypto picks open the detail drawer rather than navigating, matching every other place a
 * coin is listed. Stocks have no drawer, so they remain links to their detail page.
 */
export default function SidebarPickRows({ picks, isCrypto }: SidebarPickRowsProps) {
    if (picks.length === 0) {
        return <p className="mt-1 text-[10px] text-gray-500">No matches</p>;
    }

    return (
        <ul className="mt-1 space-y-1">
            {picks.map((pick) => {
                const label = (
                    <>
                        <span className="truncate text-[11px] text-gray-300">{pick.symbol}</span>
                        <span className="shrink-0 font-mono text-[10px] text-gray-500">
                            {isCrypto ? formatCryptoPrice(pick.price) : formatPrice(pick.price)}
                        </span>
                        <span
                            title={`${pick.tier} · score ${pick.score}`}
                            className={`shrink-0 whitespace-nowrap rounded px-1 text-[10px] ${
                                pick.tier === 'Strong'
                                    ? 'bg-emerald-950/60 text-emerald-300'
                                    : pick.tier === 'Moderate'
                                        ? 'bg-teal-950/60 text-teal-300'
                                        : 'bg-gray-800 text-gray-400'
                            }`}
                        >
                            {pick.tier} {pick.score}
                        </span>
                    </>
                );

                return (
                    <li key={pick.symbol}>
                        {isCrypto ? (
                            <button
                                type="button"
                                onClick={() => openCoinDrawer(pick.symbol)}
                                title={`Open ${pick.symbol} details`}
                                className="flex w-full items-center justify-between gap-1.5 rounded px-1 py-0.5 text-left hover:bg-white/5"
                            >
                                {label}
                            </button>
                        ) : (
                            <Link
                                href={`/stocks/${pick.symbol}`}
                                title={pick.symbol}
                                className="flex items-center justify-between gap-1.5 rounded px-1 py-0.5 hover:bg-white/5"
                            >
                                {label}
                            </Link>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
