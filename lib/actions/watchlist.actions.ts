'use server';

import { connectToDatabase } from '@/database/mongoose';
import { Watchlist } from '@/database/models/watchlist.model';
import { revalidatePath } from 'next/cache';

type AssetType = 'stock' | 'crypto';

// -- CRUD Operations --

export async function addToWatchlist(
    userId: string,
    symbol: string,
    company: string,
    assetType: AssetType = 'stock'
) {
    try {
        await connectToDatabase();

        // Upsert to avoid duplicates/errors if it already exists
        const newItem = await Watchlist.findOneAndUpdate(
            { userId, symbol: symbol.toUpperCase(), assetType },
            {
                userId,
                symbol: symbol.toUpperCase(),
                company,
                assetType,
                addedAt: new Date()
            },
            { upsert: true, new: true }
        );

        revalidatePath('/watchlist');
        revalidatePath('/crypto/watchlist');
        return JSON.parse(JSON.stringify(newItem));
    } catch (error) {
        console.error('Error adding to watchlist:', error);
        throw new Error('Failed to add to watchlist');
    }
}

export async function removeFromWatchlist(
    userId: string,
    symbol: string,
    assetType: AssetType = 'stock'
) {
    try {
        await connectToDatabase();
        await Watchlist.findOneAndDelete({ userId, symbol: symbol.toUpperCase(), assetType });
        revalidatePath('/watchlist');
        revalidatePath('/crypto/watchlist');
        revalidatePath('/'); // In case it's used elsewhere
        return { success: true };
    } catch (error) {
        console.error('Error removing from watchlist:', error);
        throw new Error('Failed to remove from watchlist');
    }
}

export async function getUserWatchlist(userId: string, assetType?: AssetType) {
    try {
        await connectToDatabase();
        const filter = assetType ? { userId, assetType } : { userId };
        const watchlist = await Watchlist.find(filter).sort({ addedAt: -1 });
        return JSON.parse(JSON.stringify(watchlist));
    } catch (error) {
        console.error('Error fetching watchlist:', error);
        return [];
    }
}

// Check if a symbol is in the user's watchlist
export async function isStockInWatchlist(
    userId: string,
    symbol: string,
    assetType: AssetType = 'stock'
) {
    try {
        await connectToDatabase();
        const item = await Watchlist.findOne({ userId, symbol: symbol.toUpperCase(), assetType });
        return !!item;
    } catch (error) {
        console.error('Error checking watchlist status:', error);
        return false;
    }
}

// -- Legacy Support (if needed by other components) --

export async function getWatchlistSymbolsByEmail(email: string): Promise<string[]> {
    if (!email) return [];

    try {
        const mongoose = await connectToDatabase();
        const db = mongoose.connection.db;
        if (!db) throw new Error('MongoDB connection not found');

        // Better Auth stores users in the "user" collection
        const user = await db.collection('user').findOne<{ _id?: unknown; id?: string; email?: string }>({ email });

        if (!user) return [];

        const userId = (user.id as string) || String(user._id || '');
        if (!userId) return [];

        // Stock news emails only: crypto symbols are not valid Finnhub tickers.
        const items = await Watchlist.find({ userId, assetType: 'stock' }, { symbol: 1 }).lean();
        return items.map((i) => String(i.symbol));
    } catch (err) {
        console.error('getWatchlistSymbolsByEmail error:', err);
        return [];
    }
}
