/**
 * The coin-drawer open contract.
 *
 * Kept as a plain module, separate from the React host, for two reasons: the event name and
 * dispatcher are the shared interface between components that have no other relationship, and
 * a component-free module can be unit-tested directly (this project's vitest setup does not
 * transform JSX, so importing a .tsx module from a test fails to parse).
 *
 * The drawer is opened by event rather than by threading a setter, because the places that
 * list coins — the Top Coins table, the Setups rows, the sidebar — are server components or
 * live in unrelated client trees.
 */

export const OPEN_COIN_DRAWER_EVENT = 'openstock:open-coin-drawer';

/** Open the detail drawer for a CoinGecko coin id. Safe to call from any client component. */
export function openCoinDrawer(coinId: string): void {
    if (typeof window === 'undefined' || !coinId) return;
    window.dispatchEvent(new CustomEvent<string>(OPEN_COIN_DRAWER_EVENT, { detail: coinId }));
}
