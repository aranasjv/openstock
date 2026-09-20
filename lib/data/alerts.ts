import 'server-only';

import { connectToDatabase } from '@/database/mongoose';
import { Alert } from '@/database/models/alert.model';

/**
 * Alert data access.
 *
 * Explicit `userId` in, no session resolution — see `lib/data/portfolio.ts` for why the split
 * exists. The session-resolving wrappers the UI calls are in `lib/actions/alert.actions.ts`.
 *
 * Every mutation filters by `userId` as well as `_id`. That filter *is* the authorisation
 * check: `findByIdAndDelete(alertId)` with no owner condition let any caller delete any
 * user's alert simply by knowing or guessing its id.
 */

export type AlertAssetType = 'stock' | 'crypto';

export async function createAlertForUser(
    userId: string,
    params: {
        symbol: string;
        targetPrice: number;
        condition: 'ABOVE' | 'BELOW';
        assetType?: AlertAssetType;
    }
) {
    try {
        await connectToDatabase();
        const newAlert = await Alert.create({
            userId,
            symbol: params.symbol,
            targetPrice: params.targetPrice,
            condition: params.condition,
            assetType: params.assetType ?? 'stock',
            active: true,
            // expiresAt handled by default value in schema
        });
        return JSON.parse(JSON.stringify(newAlert));
    } catch (error) {
        console.error('Error creating alert:', error);
        throw new Error('Failed to create alert');
    }
}

export async function getAlertsForUser(userId: string, assetType?: AlertAssetType) {
    try {
        await connectToDatabase();
        const filter = assetType ? { userId, assetType } : { userId };
        const alerts = await Alert.find(filter).sort({ createdAt: -1 });
        return JSON.parse(JSON.stringify(alerts));
    } catch (error) {
        console.error('Error fetching alerts:', error);
        return [];
    }
}

/**
 * An `_id` that is not a valid ObjectId makes the driver throw a CastError, which would
 * surface as an opaque 500. Callers get a plain "not found" instead.
 */
async function alertForUser(userId: string, alertId: string) {
    const mongoose = await connectToDatabase();
    if (!mongoose.isValidObjectId(alertId)) return null;
    return Alert.findOne({ _id: alertId, userId });
}

export async function deleteAlertForUser(userId: string, alertId: string) {
    try {
        const alert = await alertForUser(userId, alertId);
        // Not found and not-yours are the same answer on purpose: distinguishing them would
        // confirm that an id exists to someone who does not own it.
        if (!alert) return { success: false };

        await alert.deleteOne();
        return { success: true };
    } catch (error) {
        console.error('Error deleting alert:', error);
        throw new Error('Failed to delete alert');
    }
}

export async function toggleAlertForUser(userId: string, alertId: string, active: boolean) {
    try {
        const alert = await alertForUser(userId, alertId);
        if (!alert) return { success: false };

        await alert.updateOne({ active });
        return { success: true };
    } catch (error) {
        console.error('Error toggling alert:', error);
        throw new Error('Failed to update alert');
    }
}
