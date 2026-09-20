import { Schema, model, models, type Document, type Model } from 'mongoose';

/**
 * One BTC-dominance observation per day.
 *
 * This collection exists only because CoinGecko's free tier exposes the *current* dominance value
 * and no history for it. The trend the regime engine needs can therefore only be built by
 * recording one point per day and waiting — the vendored playbook documents the same limitation
 * (weight is redistributed until 31 observations exist) rather than working around it.
 *
 * `day` is the key, not the timestamp. A run that happens twice in a day updates the same row, so
 * a burst of traffic cannot inflate the history and make a two-day trend look like a month.
 */
export interface DominanceObservation extends Document {
    /** UTC calendar day, YYYY-MM-DD. */
    day: string;
    btcDominance: number;
    ethDominance: number;
    totalMarketCapUsd: number;
    recordedAt: Date;
}

const DominanceSchema = new Schema<DominanceObservation>(
    {
        day: { type: String, required: true, unique: true, index: true },
        btcDominance: { type: Number, required: true },
        ethDominance: { type: Number, default: 0 },
        totalMarketCapUsd: { type: Number, default: 0 },
        recordedAt: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

export const DominanceModel: Model<DominanceObservation> =
    (models?.DominanceObservation as Model<DominanceObservation>) ||
    model<DominanceObservation>('DominanceObservation', DominanceSchema);
