/**
 * The assistant-overlay open contract.
 *
 * Kept as a plain module, separate from the React host, for the same two reasons as
 * `lib/coin-drawer-event.ts`: the event name and dispatcher are the shared interface between
 * components that have no other relationship, and a component-free module can be unit-tested
 * directly (this project's vitest setup does not transform JSX).
 *
 * Opened by event rather than by threading a setter because the places that want it — the
 * stock dashboard header, the crypto dashboard header — are server components with no shared
 * client ancestor other than the layout.
 */

export const ASSISTANT_OVERLAY_EVENT = 'openstock:open-assistant-overlay';

/** Open the floating assistant. Safe to call from any client component. */
export function openAssistant(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(ASSISTANT_OVERLAY_EVENT));
}
