'use server';

import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/session';
import {
    createAlertForUser,
    deleteAlertForUser,
    getAlertsForUser,
    toggleAlertForUser,
    type AlertAssetType,
} from '@/lib/data/alerts';

/**
 * Price alerts, as callable server actions.
 *
 * Every mutation is scoped to the session's user id in the query itself — `deleteAlert` and
 * `toggleAlert` previously called `findByIdAndDelete(alertId)` with no owner condition, so any
 * caller could delete or pause any alert on the deployment just by sending its id.
 */

export async function createAlert(params: {
    symbol: string;
    targetPrice: number;
    condition: 'ABOVE' | 'BELOW';
    assetType?: AlertAssetType;
}) {
    const userId = await requireUserId();
    const alert = await createAlertForUser(userId, params);

    revalidatePath('/watchlist');
    revalidatePath('/holdings');
    return alert;
}

export async function getUserAlerts(assetType?: AlertAssetType) {
    return getAlertsForUser(await requireUserId(), assetType);
}

export async function deleteAlert(alertId: string) {
    const userId = await requireUserId();
    const result = await deleteAlertForUser(userId, alertId);

    if (result.success) revalidatePath('/watchlist');
    return result;
}

export async function toggleAlert(alertId: string, active: boolean) {
    const userId = await requireUserId();
    const result = await toggleAlertForUser(userId, alertId, active);

    if (result.success) revalidatePath('/watchlist');
    return result;
}
