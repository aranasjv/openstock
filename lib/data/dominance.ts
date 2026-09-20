import 'server-only';

import { connectToDatabase } from '@/database/mongoose';
import { DominanceModel } from '@/database/models/dominance.model';
import { getCryptoGlobal } from '@/lib/actions/crypto.actions';

/**
 * The dominance history the crypto regime engine needs.
 *
 * CoinGecko's free tier gives the current dominance value and nothing else, so a *trend* can only
 * exist once this app has been recording it. Two consequences shape everything here:
 *
 *   - There is no backfill. The history starts the day the app first ran, and until it has
 *     `DOMINANCE_TREND_DAYS` observations the dominance component must report itself unavailable
 *     rather than infer a trend from four points. Weight is redistributed, per the playbook.
 *   - Recording is idempotent per calendar day. A second run on the same day updates the row
 *     instead of appending, or a busy day would look like a long trend.
 */

/** Observations needed before a dominance trend is meaningful. The playbook's figure. */
export const DOMINANCE_TREND_DAYS = 31;

export interface DominancePoint {
    day: string;
    btcDominance: number;
}

/** UTC calendar day. UTC because a trend built from local days shifts when the server moves. */
export function utcDay(date: Date = new Date()): string {
    return date.toISOString().slice(0, 10);
}

/**
 * Direction of BTC dominance across the recorded history, in percentage points.
 *
 * Rising dominance is not bullish or bearish on its own — the playbook interprets it jointly with
 * the BTC trend, because money rotating into BTC in a downtrend means something different from
 * money rotating into BTC in an uptrend. This returns the measurement only.
 */
export function dominanceChange(points: DominancePoint[]): number | null {
    if (points.length < 2) return null;

    const first = points[0].btcDominance;
    const last = points[points.length - 1].btcDominance;

    if (!Number.isFinite(first) || !Number.isFinite(last)) return null;

    return last - first;
}

export interface DominanceRead {
    points: DominancePoint[];
    /** Percentage-point change over the window, or null when there is not enough history. */
    change: number | null;
    /** Whether the trend is usable. The component is skipped while false. */
    sufficient: boolean;
}

/** Record today's observation. Returns false when the reading could not be taken. */
export async function recordDominanceObservation(): Promise<boolean> {
    const global = await getCryptoGlobal();
    if (!global) return false;

    try {
        await connectToDatabase();
        const day = utcDay();

        await DominanceModel.updateOne(
            { day },
            {
                $set: {
                    day,
                    btcDominance: global.btcDominance,
                    ethDominance: global.ethDominance,
                    totalMarketCapUsd: global.totalMarketCapUsd,
                    recordedAt: new Date(),
                },
            },
            { upsert: true }
        );

        return true;
    } catch (error) {
        console.error('Could not record the dominance observation:', error);
        return false;
    }
}

/**
 * The recorded history, oldest first.
 *
 * A read failure throws rather than returning an empty array: "no history yet" and "the database
 * is down" lead to different behaviour downstream, and an empty array would silently disable the
 * component and redistribute its weight for the wrong reason.
 */
export async function getDominanceHistory(days: number = DOMINANCE_TREND_DAYS): Promise<DominanceRead> {
    await connectToDatabase();

    const docs = await DominanceModel.find({}).sort({ day: -1 }).limit(days).lean();
    const points: DominancePoint[] = docs
        .reverse()
        .map((doc) => ({ day: doc.day, btcDominance: doc.btcDominance }));

    return {
        points,
        change: dominanceChange(points),
        sufficient: points.length >= DOMINANCE_TREND_DAYS,
    };
}
