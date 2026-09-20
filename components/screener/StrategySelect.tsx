'use client';

import { useRouter, useSearchParams } from 'next/navigation';

interface StrategySelectProps {
    strategies: { id: string; name: string; summary: string }[];
    selected: string;
}

/**
 * Writes the chosen strategy to the URL so the server re-runs the screener. Keeping the
 * selection in the query string makes results shareable and avoids client-side fetching.
 */
export default function StrategySelect({ strategies, selected }: StrategySelectProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const handleChange = (value: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('strategy', value);
        params.delete('page');
        router.replace(`?${params.toString()}`, { scroll: false });
    };

    const active = strategies.find((s) => s.id === selected);

    return (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
            <label htmlFor="strategy" className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                Strategy
            </label>
            <select
                id="strategy"
                value={selected}
                onChange={(e) => handleChange(e.target.value)}
                className="h-8 rounded-md border border-gray-800 bg-[#1C1C1F] px-2 text-xs text-white"
            >
                {strategies.map((strategy) => (
                    <option key={strategy.id} value={strategy.id}>
                        {strategy.name}
                    </option>
                ))}
            </select>
            {active?.summary ? (
                <p className="truncate text-[11px] text-gray-500" title={active.summary}>
                    {active.summary}
                </p>
            ) : null}
        </div>
    );
}
