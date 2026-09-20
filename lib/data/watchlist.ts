import 'server-only';

import { connectToDatabase } from '@/database/mongoose';
import { Watchlist } from '@/database/models/watchlist.model';

/**
 * Watchlist data access.
 *
 * Explicit `userId` in, no session resolution — see `lib/data/portfolio.ts` for why the split
 * exists. The session-resolving wrappers the UI calls are in
 * `lib/actions/watchlist.actions.ts`.
 */

export type WatchlistAssetType = 'stock' | 'crypto';

export async function addToWatchlistForUser(
    userId: string,
    symbol: string,
    company: string,
    assetType: WatchlistAssetType = 'stock'
) {
    try {
        await connectToDatabase();

        // Upsert to avoid duplicates/errors if it already exists.
        const newItem = await Watchlist.findOneAndUpdate(
            { userId, symbol: symbol.toUpperCase(), assetType },
            { userId, symbol: symbol.toUpperCase(), company, assetType, addedAt: new Date() },
            { upsert: true, new: true }
        );

        return JSON.parse(JSON.stringify(newItem));
    } catch (error) {
        console.error('Error adding to watchlist:', error);
        throw new Error('Failed to add to watchlist');
    }
}

export async function removeFromWatchlistForUser(
    userId: string,
    symbol: string,
    assetType: WatchlistAssetType = 'stock'
) {
    try {
        await connectToDatabase();
        await Watchlist.findOneAndDelete({ userId, symbol: symbol.toUpperCase(), assetType });
        return { success: true };
    } catch (error) {
        console.error('Error removing from watchlist:', error);
        throw new Error('Failed to remove from watchlist');
    }
}

export async function getWatchlistForUser(userId: string, assetType?: WatchlistAssetType) {
    try {
        await connectToDatabase();
        const filter = assetType ? { userId, assetType } : { userId };
        const watchlist = await Watchlist.find(filter).sort({ addedAt: -1 });
        return JSON.parse(JSON.stringify(watchlist));
    } catch (error) {
        console.error('Error fetching watchlist:', error);
        // Rethrow so a failure is not rendered as an empty watchlist.
        throw new Error('Could not load the watchlist.');
    }
}

export async function isInWatchlistForUser(
    userId: string,
    symbol: string,
    assetType: WatchlistAssetType = 'stock'
) {
    try {
        await connectToDatabase();
        const item = await Watchlist.findOne({ userId, symbol: symbol.toUpperCase(), assetType });
        return !!item;
    } catch (error) {
        console.error('Error checking watchlist status:', error);
        // False would render as "not tracked yet", so a failure here changes what the button
        // says. Let it surface instead.
        throw new Error('Could not check the watchlist.');
    }
}

