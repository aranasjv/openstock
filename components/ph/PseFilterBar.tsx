'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition, type FormEvent } from 'react';

/**
 * The PSE filter controls.
 *
 * Applied to the URL rather than held in local state, so a screen is shareable and server-rendered —
 * the same reason the market and the screener strategy are parameters, and the reason a filtered view
 * survives a refresh.
 *
 * The fields are uncontrolled and read on submit. A controlled form that pushed on every keystroke
 * would issue a navigation per character and fill the back button with them; this way the URL changes
 * exactly when the user asks it to.
 *
 * What it cannot offer is stated in the copy rather than quietly absent: these are all snapshot
 * fields — price, today's change, today's volume — because PSE history is not available to this app,
 * so there is no "uptrend" or "RSI" filter to give.
 */

const FIELD =
    'h-8 min-w-0 rounded-md border border-gray-800 bg-gray-950/60 px-2 text-[11px] text-gray-200 placeholder:text-gray-500 focus-visible:border-gray-600 focus-visible:outline-none';

export default function PseFilterBar({ matched, total }: { matched: number; total: number }) {
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();
    const [pending, startTransition] = useTransition();

    const value = (key: string) => params.get(key) ?? '';
    const active = ['symbols', 'minChg', 'maxChg', 'minVol', 'minPrice', 'maxPrice'].some(
        (key) => value(key) !== ''
    );

    const apply = (form: FormData) => {
        const query = new URLSearchParams(params.toString());

        // Every field is cleared then set, so emptying a box actually removes its parameter instead of
        // leaving the previous value in the URL.
        for (const key of ['symbols', 'minChg', 'maxChg', 'minVol', 'minPrice', 'maxPrice', 'sort', 'dir']) {
            query.delete(key);
        }

        for (const [key, entry] of form.entries()) {
            const text = String(entry).trim();
            if (text && text !== 'volume' && text !== 'desc') query.set(key, text);
        }

        query.set('sort', String(form.get('sort') ?? 'volume'));
        query.set('dir', String(form.get('dir') ?? 'desc'));

        startTransition(() => router.push(`${pathname}?${query.toString()}`, { scroll: false }));
    };

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        apply(new FormData(event.currentTarget));
    };

    const clear = () => {
        const query = new URLSearchParams(params.toString());
        for (const key of ['symbols', 'minChg', 'maxChg', 'minVol', 'minPrice', 'maxPrice', 'sort', 'dir']) {
            query.delete(key);
        }
        startTransition(() => router.push(`${pathname}?${query.toString()}`, { scroll: false }));
    };

    return (
        <form onSubmit={submit} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
                <input
                    name="symbols"
                    defaultValue={value('symbols')}
                    placeholder="Symbols (SM, BDO, TEL)"
                    aria-label="Restrict to these symbols"
                    className={`${FIELD} w-44`}
                />
                <input
                    name="minChg"
                    defaultValue={value('minChg')}
                    placeholder="Min %"
                    inputMode="decimal"
                    aria-label="Minimum percent change"
                    className={`${FIELD} w-16`}
                />
                <input
                    name="maxChg"
                    defaultValue={value('maxChg')}
                    placeholder="Max %"
                    inputMode="decimal"
                    aria-label="Maximum percent change"
                    className={`${FIELD} w-16`}
                />
                <input
                    name="minVol"
                    defaultValue={value('minVol')}
                    placeholder="Min volume"
                    inputMode="numeric"
                    aria-label="Minimum volume"
                    className={`${FIELD} w-24`}
                />
                <select name="sort" defaultValue={value('sort') || 'volume'} aria-label="Sort by" className={FIELD}>
                    <option value="volume">Volume</option>
                    <option value="change">Change</option>
                    <option value="price">Price</option>
                    <option value="name">Symbol</option>
                </select>
                <select name="dir" defaultValue={value('dir') || 'desc'} aria-label="Direction" className={FIELD}>
                    <option value="desc">High to low</option>
                    <option value="asc">Low to high</option>
                </select>
                <button
                    type="submit"
                    disabled={pending}
                    className="h-8 rounded-md border border-teal-900/50 bg-teal-950/30 px-2.5 text-[11px] text-teal-300 transition-colors hover:bg-teal-900/30 disabled:opacity-50"
                >
                    Apply
                </button>
                {active ? (
                    <button
                        type="button"
                        onClick={clear}
                        disabled={pending}
                        className="h-8 rounded-md border border-gray-800 px-2.5 text-[11px] text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200 disabled:opacity-50"
                    >
                        Clear
                    </button>
                ) : null}
            </div>

            <p className="text-[11px] text-gray-500">
                {matched} of {total} listings match.{' '}
                <span className="text-gray-600">
                    Filters cover price, today&apos;s change and today&apos;s volume. Trend and momentum
                    screens need daily history, which no source this app can reach carries for the PSE.
                </span>
            </p>
        </form>
    );
}
