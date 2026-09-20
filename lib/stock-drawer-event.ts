/**
 * The stock-drawer open contract.
 *
 * Mirrors `lib/coin-drawer-event.ts`, for the same reasons: the event name and dispatcher are
 * the shared interface between components that have no other relationship, and a
 * component-free module can be unit-tested directly (this project's vitest setup does not
 * transform JSX, so importing a .tsx module from a test fails to parse).
 */

export const OPEN_STOCK_DRAWER_EVENT = 'openstock:open-stock-drawer';

/** Open the detail drawer for a stock ticker. Safe to call from any client component. */
export function openStockDrawer(symbol: string): void {
    if (typeof window === 'undefined' || !symbol) return;
    window.dispatchEvent(new CustomEvent<string>(OPEN_STOCK_DRAWER_EVENT, { detail: symbol }));
}
