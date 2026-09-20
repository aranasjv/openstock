'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MARKETS, MARKET_META, type Market } from '@/lib/markets';

/**
 * The market switch.
 *
 * A URL parameter rather than stored state, matching the strategy selector already on this page: it
 * makes a market view linkable and shareable, and it keeps the choice on the server where the data
 * source differs — the PH path reads a different feed entirely, so resolving the market during the
 * render is the only place that decision can be made once.
 *
 * `aria-pressed` on both buttons rather than a radio group: they are two toggles describing one
 * choice, and screen readers announce the selected one without needing a described group.
 */
export default function MarketToggle({ market }: { market: Market }) {
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();

    const select = (next: Market) => {
        if (next === market) return;

        // Built from the existing query so switching market keeps the strategy selection.
        const query = new URLSearchParams(params.toString());
        query.set('market', next);

        router.push(`${pathname}?${query.toString()}`, { scroll: false });
    };

    return (
        <div
            role="group"
            aria-label="Market"
            className="flex shrink-0 items-center rounded-md border border-gray-800 p-0.5"
        >
            {MARKETS.map((option) => {
                const active = option === market;

                return (
                    <button
                        key={option}
                        type="button"
                        onClick={() => select(option)}
                        aria-pressed={active}
                        title={MARKET_META[option].label}
                        className={`rounded px-2 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-500/60 ${
                            active
                                ? 'bg-teal-600/20 font-medium text-teal-200'
                                : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                        }`}
                    >
                        {MARKET_META[option].short}
                    </button>
                );
            })}
        </div>
    );
}
