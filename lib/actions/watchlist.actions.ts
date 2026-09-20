'use server';

import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/session';
import {
    addToWatchlistForUser,
    getWatchlistForUser,
    isInWatchlistForUser,
    removeFromWatchlistForUser,
    type WatchlistAssetType,
} from '@/lib/data/watchlist';

/**
 * Watchlist, as callable server actions.
 *
 * The session is resolved here and never accepted as an argument — previously these took a
 * `userId` from the caller, so any signed-in user could read or edit anyone's watchlist. See
 * `lib/data/watchlist.ts` for the explicit-userId layer that server-side callers use.
 *
 * `getWatchlistSymbolsByEmail` used to live here and is deleted, not moved: resolving an
 * arbitrary email to a user id made "whose symbols are these" caller-controlled, and its only
 * importer (`lib/inngest/functions.ts`) never actually called it.
 */

export async function addToWatchlist(
    symbol: string,
    company: string,
    assetType: WatchlistAssetType = 'stock'
) {
    const userId = await requireUserId();
    const item = await addToWatchlistForUser(userId, symbol, company, assetType);

    revalidatePath('/watchlist');
    revalidatePath('/holdings');
    return item;
}

export async function removeFromWatchlist(
    symbol: string,
    assetType: WatchlistAssetType = 'stock'
) {
    const userId = await requireUserId();
    const result = await removeFromWatchlistForUser(userId, symbol, assetType);

    revalidatePath('/watchlist');
    revalidatePath('/holdings');
    revalidatePath('/');
    return result;
}

export async function getUserWatchlist(assetType?: WatchlistAssetType) {
    return getWatchlistForUser(await requireUserId(), assetType);
}

export async function isStockInWatchlist(
    symbol: string,
    assetType: WatchlistAssetType = 'stock'
) {
    return isInWatchlistForUser(await requireUserId(), symbol, assetType);
}
