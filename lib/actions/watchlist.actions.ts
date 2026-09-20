'use server';

import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/session';
import { requireOneOf, requireText, MAX_SYMBOL_LENGTH } from '@/lib/validate';
import {
    addToWatchlistForUser,
    getWatchlistForUser,
    isInWatchlistForUser,
    removeFromWatchlistForUser,
} from '@/lib/data/watchlist';

/**
 * Watchlist, as callable server actions.
 *
 * The session is resolved here and never accepted as an argument — previously these took a
 * `userId` from the caller, so any signed-in user could read or edit anyone's watchlist. See
 * `lib/data/watchlist.ts` for the explicit-userId layer that server-side callers use.
 *
 * Inputs are validated here too: these actions are reachable directly and a symbol is written
 * straight into a document, so it is checked before it gets there.
 *
 * `getWatchlistSymbolsByEmail` used to live here and is deleted, not moved: resolving an
 * arbitrary email to a user id made "whose symbols are these" caller-controlled, and its only
 * importer (`lib/inngest/functions.ts`) never actually called it.
 */

const ASSET_TYPES = ['stock', 'crypto'] as const;

export async function addToWatchlist(symbol: unknown, company: unknown, assetType: unknown = 'stock') {
    const userId = await requireUserId();

    const item = await addToWatchlistForUser(
        userId,
        requireText(symbol, 'Symbol', MAX_SYMBOL_LENGTH),
        requireText(company, 'Company'),
        requireOneOf(assetType, 'Asset type', ASSET_TYPES)
    );

    revalidatePath('/watchlist');
    revalidatePath('/holdings');
    return item;
}

export async function removeFromWatchlist(symbol: unknown, assetType: unknown = 'stock') {
    const userId = await requireUserId();

    const result = await removeFromWatchlistForUser(
        userId,
        requireText(symbol, 'Symbol', MAX_SYMBOL_LENGTH),
        requireOneOf(assetType, 'Asset type', ASSET_TYPES)
    );

    revalidatePath('/watchlist');
    revalidatePath('/holdings');
    revalidatePath('/');
    return result;
}

export async function getUserWatchlist(assetType?: 'stock' | 'crypto') {
    return getWatchlistForUser(await requireUserId(), assetType);
}

export async function isStockInWatchlist(symbol: unknown, assetType: unknown = 'stock') {
    return isInWatchlistForUser(
        await requireUserId(),
        requireText(symbol, 'Symbol', MAX_SYMBOL_LENGTH),
        requireOneOf(assetType, 'Asset type', ASSET_TYPES)
    );
}
