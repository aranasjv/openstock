'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag-to-resize for panels anchored to the bottom-right or the right edge.
 *
 * The handle sits on the panel's top-left corner, which is the direction that grows a
 * bottom-right-anchored panel without it detaching from its corner. Size is persisted per
 * key: a panel that forgets the size you chose is more annoying than one that cannot resize.
 *
 * Sizes are clamped twice — numerically here, and again with CSS `max-*` at the call site —
 * because the viewport can shrink after a size is stored, and a panel larger than the window
 * would put its own controls out of reach.
 */

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

export interface DragSizeConfig {
    storageKey: string;
    initial: { width: number; height: number };
    min: { width: number; height: number };
    max: { width: number; height: number };
}

export interface DragSize {
    width: number;
    height: number;
    resizing: boolean;
    startResize: (event: React.PointerEvent<HTMLElement>) => void;
}

export function useDragSize({ storageKey, initial, min, max }: DragSizeConfig): DragSize {
    const [size, setSize] = useState(initial);
    const [resizing, setResizing] = useState(false);
    const origin = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

    // Restored after mount, never during render: the server cannot know the stored size, and
    // reading it eagerly would make the first client render disagree with the server's.
    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(storageKey);
            if (!stored) return;

            const parsed = JSON.parse(stored) as { width?: number; height?: number };
            setSize((current) => ({
                width: clamp(parsed.width ?? current.width, min.width, max.width),
                height: clamp(parsed.height ?? current.height, min.height, max.height),
            }));
        } catch {
            // A corrupt or unreadable entry is not worth failing over; defaults are fine.
        }
    }, [storageKey, min.width, max.width, min.height, max.height]);

    const startResize = useCallback(
        (event: React.PointerEvent<HTMLElement>) => {
            event.preventDefault();
            origin.current = {
                x: event.clientX,
                y: event.clientY,
                width: size.width,
                height: size.height,
            };
            setResizing(true);
        },
        [size.width, size.height]
    );

    useEffect(() => {
        if (!resizing) return;

        const move = (event: PointerEvent) => {
            if (!origin.current) return;
            // Top-left handle on a bottom-right-anchored panel: dragging up or left grows it,
            // so the delta is subtracted rather than added.
            setSize({
                width: clamp(
                    origin.current.width - (event.clientX - origin.current.x),
                    min.width,
                    max.width
                ),
                height: clamp(
                    origin.current.height - (event.clientY - origin.current.y),
                    min.height,
                    max.height
                ),
            });
        };
        const stop = () => setResizing(false);

        // Pointer events (not mouse) so touch and pen drag the handle too, and window-level
        // listeners so the drag survives the pointer leaving the small handle.
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
        window.addEventListener('pointercancel', stop);

        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', stop);
            window.removeEventListener('pointercancel', stop);
        };
    }, [resizing, min.width, max.width, min.height, max.height]);

    useEffect(() => {
        if (resizing) return;
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(size));
        } catch {
            // Storage can be unavailable (private mode, quota); the session still resizes.
        }
    }, [resizing, size, storageKey]);

    return { width: size.width, height: size.height, resizing, startResize };
}
