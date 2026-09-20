'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, Loader2, Sparkles } from 'lucide-react';
import ChatPanel from '@/components/assistant/ChatPanel';
import {
    loadAssistantOverlayState,
    type ConversationDetail,
} from '@/lib/actions/assistant.actions';
import { ASSISTANT_OVERLAY_EVENT } from '@/lib/assistant-overlay-event';
import { useDragSize } from '@/hooks/useDragSize';

/**
 * The assistant as a floating, resizable panel.
 *
 * Mounted once in the root layout and opened by event — the same contract as the coin drawer —
 * so any client component can summon it without prop threading. "Ask AI" on either dashboard
 * opens this instead of navigating to /assistant, which keeps the screener or chart you were
 * reading behind it.
 *
 * The conversation is loaded on first open rather than at mount: most page views never open
 * the assistant, and doing this eagerly would add a database round trip to every navigation.
 *
 * Sizing is deliberately double-clamped — numerically in `useDragSize`, and again with
 * viewport-relative `max-*` classes here. A size stored on a large monitor would otherwise
 * leave the panel's own close button off-screen on a laptop.
 */
export default function AssistantOverlay() {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [conversation, setConversation] = useState<ConversationDetail | null>(null);
    const [providerLabel, setProviderLabel] = useState('assistant');
    const [error, setError] = useState<string | null>(null);

    const { width, height, resizing, startResize } = useDragSize({
        storageKey: 'openstock:assistant-overlay:size',
        initial: { width: 460, height: 640 },
        min: { width: 320, height: 360 },
        max: { width: 1100, height: 1000 },
    });

    useEffect(() => {
        const handler = () => setOpen(true);
        window.addEventListener(ASSISTANT_OVERLAY_EVENT, handler);
        return () => window.removeEventListener(ASSISTANT_OVERLAY_EVENT, handler);
    }, []);

    useEffect(() => {
        if (!open || conversation || loading) return;

        let cancelled = false;
        setLoading(true);
        setError(null);

        loadAssistantOverlayState()
            .then((state) => {
                if (cancelled) return;
                setConversation(state.conversation);
                setProviderLabel(state.providerLabel);
            })
            .catch((cause: unknown) => {
                if (cancelled) return;
                setError(cause instanceof Error ? cause.message : 'Could not open the assistant.');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [open, conversation, loading]);

    useEffect(() => {
        if (!open) return;

        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };

        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-label="AI chat"
            style={{ width, height }}
            className={`fixed right-4 bottom-4 z-50 flex max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-950/95 shadow-2xl backdrop-blur ${
                resizing ? 'select-none' : ''
            }`}
        >
            {/* Top-left corner grip. The panel is anchored bottom-right, so this is the corner
                that can move without detaching it. */}
            <button
                type="button"
                onPointerDown={startResize}
                aria-label="Resize AI chat"
                title="Drag to resize"
                className="absolute top-0 left-0 z-10 flex h-4 w-4 cursor-nwse-resize items-center justify-center text-gray-600 transition-colors hover:text-gray-400"
            >
                <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true">
                    <path
                        d="M1 9 L9 1 M1 14 L14 1"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        fill="none"
                    />
                </svg>
            </button>

            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-800 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-teal-400" aria-hidden="true" />
                    <span className="shrink-0 text-xs font-semibold text-white">AI Chat</span>
                    <span className="truncate text-[10px] tracking-wider text-gray-500 uppercase">
                        {providerLabel}
                    </span>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                    <Link
                        href="/assistant"
                        className="rounded px-2 py-1 text-[11px] text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200"
                    >
                        Full page
                    </Link>
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        aria-label="Close AI chat"
                        className="rounded p-1 text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* ChatPanel brings its own card chrome, which would nest a border inside this
                panel's border. `[&>div]` strips it so it reads as one surface. */}
            <div className="min-h-0 flex-1 p-2 [&>div]:rounded-none [&>div]:border-0 [&>div]:bg-transparent">
                {error ? (
                    <div className="flex h-full items-center justify-center p-4">
                        <p className="text-center text-xs text-red-400">{error}</p>
                    </div>
                ) : loading && !conversation ? (
                    <div className="flex h-full items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-gray-500" aria-hidden="true" />
                    </div>
                ) : (
                    <ChatPanel conversation={conversation} providerLabel={providerLabel} />
                )}
            </div>
        </div>
    );
}
