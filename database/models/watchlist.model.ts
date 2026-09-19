import { Schema, model, models, type Document, type Model } from 'mongoose';

export interface WatchlistItem extends Document {
    userId: string;
    symbol: string;
    company: string;
    assetType: 'stock' | 'crypto';
    addedAt: Date;
}

const WatchlistSchema = new Schema<WatchlistItem>(
    {
        userId: { type: String, required: true, index: true },
        symbol: { type: String, required: true, uppercase: true, trim: true },
        company: { type: String, required: true, trim: true },
        assetType: {
            type: String,
            enum: ['stock', 'crypto'],
            default: 'stock',
            required: true,
            index: true,
        },
        addedAt: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

// Prevent duplicate symbols per user, per asset type. Stocks and crypto can share a
// ticker (e.g. SOL, LINK, ADA), so assetType is part of the uniqueness key.
WatchlistSchema.index({ userId: 1, symbol: 1, assetType: 1 }, { unique: true });

export const Watchlist: Model<WatchlistItem> =
    (models?.Watchlist as Model<WatchlistItem>) || model<WatchlistItem>('Watchlist', WatchlistSchema);