'use server';

import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/session';
import { requireNumber, requireOneOf, requireText, MAX_SYMBOL_LENGTH } from '@/lib/validate';
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

const ASSET_TYPES = ['stock', 'crypto'] as const;

export async function createAlert(params: {
    symbol: unknown;
    targetPrice: unknown;
    condition: unknown;
    assetType?: unknown;
}) {
    const userId = await requireUserId();

    const alert = await createAlertForUser(userId, {
        symbol: requireText(params.symbol, 'Symbol', MAX_SYMBOL_LENGTH).toUpperCase(),
        targetPrice: requireNumber(params.targetPrice, 'Target price', { min: 0 }),
        condition: requireOneOf(params.condition, 'Condition', ['ABOVE', 'BELOW'] as const),
        assetType: requireOneOf(params.assetType ?? 'stock', 'Asset type', ASSET_TYPES),
    });

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
