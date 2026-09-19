import { Schema, model, models, type Document, type Model } from 'mongoose';

/**
 * A position the user holds.
 *
 * `averageCost` is the blended cost basis per unit, so P&L is derived rather than entered.
 * Assets are keyed by the same convention as the watchlist: a ticker for stocks, a CoinGecko
 * id for crypto, plus the asset type — a stock and a coin can share a symbol.
 */
export interface Holding extends Document {
    userId: string;
    symbol: string;
    assetType: 'stock' | 'crypto';
    quantity: number;
    averageCost: number;
    addedAt: Date;
}

const HoldingSchema = new Schema<Holding>(
    {
        userId: { type: String, required: true, index: true },
        symbol: { type: String, required: true, uppercase: true, trim: true },
        assetType: {
            type: String,
            enum: ['stock', 'crypto'],
            default: 'stock',
            required: true,
            index: true,
        },
        quantity: { type: Number, required: true, min: 0 },
        averageCost: { type: Number, required: true, min: 0 },
        addedAt: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

HoldingSchema.index({ userId: 1, symbol: 1, assetType: 1 }, { unique: true });

export const HoldingModel: Model<Holding> =
    (models?.Holding as Model<Holding>) || model<Holding>('Holding', HoldingSchema);
