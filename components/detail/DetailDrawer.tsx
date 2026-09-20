'use client';

import { useEffect, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { X, ExternalLink, Loader2 } from 'lucide-react';
import { useDragSize } from '@/hooks/useDragSize';

export interface DetailDrawerPrice {
    value: string;
    changePercent: number | null;
}

interface DetailDrawerProps {
    open: boolean;
    onClose: () => void;
    /** Accessible name for the dialog, e.g. "AAPL details". */
    label: string;
    title: string;
    subtitle?: string;
    imageUrl?: string;
    price?: DetailDrawerPrice;
    /** The full page this drawer is a convenience over, not a replacement for. */
    href: string;
    /**
     * Persisted width key. One per asset type, so a width chosen for stocks and one chosen for
     * coins stay independent — they are different reading tasks.
     */
    widthStorageKey: string;
    loading?: boolean;
    children: ReactNode;
}

/**
 * The slide-over shell shared by the stock and coin drawers.
 *
 * Extracted once the coin drawer had grown resizing, persisted width, Escape handling, the
 * backdrop rule and the deep-link affordance: duplicating all of that for stocks would have
 * created two copies of the same behaviour, which is exactly how the two detail surfaces
 * drifted apart in the first place. Each drawer supplies its own data and body; the chrome
 * around the body lives here.
 *
 * Default width is three times the original 440px panel, which is what makes a two-column
 * layout fit, and it is clamped to 95vw so a width chosen on a large monitor stays reachable
 * on a laptop. The handle is on the left edge — the edge that can move without detaching a
 * right-anchored panel.
 */
export default function DetailDrawer({
    open,
    onClose,
    label,
    title,
    subtitle,
    imageUrl,
    price,
    href,
    widthStorageKey,
    loading = false,
    children,
}: DetailDrawerProps) {
    const { width, resizing, startResize } = useDragSize({
        storageKey: widthStorageKey,
        initial: { width: 1320, height: 900 },
        min: { width: 380, height: 0 },
        max: { width: 1800, height: 0 },
        axis: 'x',
    });

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    const change = price?.changePercent ?? null;

    return (
        <>
            {/* Backdrop only below the width at which the drawer would otherwise cover the table. */}
            <div
                className="fixed inset-0 z-40 bg-black/50 xl:hidden"
                onClick={onClose}
                aria-hidden="true"
            />

            <aside
                role="dialog"
                aria-label={label}
                style={{ width }}
                className="fixed top-0 right-0 z-50 flex h-screen max-w-[95vw] flex-col border-l border-gray-800 bg-black shadow-2xl"
            >
                <div
                    onPointerDown={startResize}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize details panel"
                    className={`absolute top-0 left-0 z-10 h-full w-1.5 cursor-ew-resize transition-colors hover:bg-teal-500/40 ${
                        resizing ? 'bg-teal-500/40' : ''
                    }`}
                />

                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                        {imageUrl ? (
                            <Image
                                src={imageUrl}
                                alt=""
                                width={24}
                                height={24}
                                className="h-6 w-6 rounded-full"
                                unoptimized
                            />
                        ) : null}
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">{title}</div>
                            {subtitle ? (
                                <div className="truncate text-[11px] text-gray-500">{subtitle}</div>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                        {price ? (
                            <div className="flex items-baseline gap-2">
                                <span className="font-mono text-sm text-white">{price.value}</span>
                                {change !== null ? (
                                    <span
                                        className={`font-mono text-[11px] ${
                                            change >= 0 ? 'text-emerald-400' : 'text-red-400'
                                        }`}
                                    >
                                        {change >= 0 ? '+' : ''}
                                        {change.toFixed(2)}%
                                    </span>
                                ) : null}
                            </div>
                        ) : null}

                        <Link
                            href={href}
                            aria-label="Open full page"
                            title="Open full page"
                            className="rounded p-1 text-gray-500 transition-colors hover:bg-white/10 hover:text-white"
                        >
                            <ExternalLink className="h-4 w-4" />
                        </Link>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close"
                            title="Close"
                            className="rounded p-1 text-gray-500 transition-colors hover:bg-white/10 hover:text-white"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {loading ? (
                        <div className="flex h-40 items-center justify-center">
                            <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
                        </div>
                    ) : (
                        children
                    )}
                </div>
            </aside>
        </>
    );
}
