'use server';

import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/session';
import {
    addHoldingForUser,
    getHoldingsForUser,
    getPortfolioSummaryForUser,
    removeHoldingForUser,
    type HoldingAssetType,
} from '@/lib/data/portfolio';

/**
 * Holdings, as callable server actions.
 *
 * Each action resolves the session itself and passes *that* userId to the data layer, so the
 * browser never supplies an identity and cannot ask for someone else's portfolio. This is the
 * whole point of the split: the data layer still takes an explicit userId, because the
 * scheduled jobs (acting as the admin user) and the assistant tools (acting as the signed-in
 * user) legitimately need it — but nothing reachable from the client does.
 *
 * Revalidation lives here rather than in the data layer, because it is a request concern.
 */

export async function getHoldings(assetType?: HoldingAssetType) {
    return getHoldingsForUser(await requireUserId(), assetType);
}

export async function addHolding(params: {
    symbol: string;
    assetType: HoldingAssetType;
    quantity: number;
    averageCost: number;
}) {
    const userId = await requireUserId();
    const holding = await addHoldingForUser(userId, params);

    revalidatePath('/holdings');
    return holding;
}

export async function removeHolding(symbol: string, assetType: HoldingAssetType = 'stock') {
    const userId = await requireUserId();
    const result = await removeHoldingForUser(userId, symbol, assetType);

    revalidatePath('/holdings');
    return result;
}

export async function getPortfolioSummary(assetType?: HoldingAssetType) {
    return getPortfolioSummaryForUser(await requireUserId(), assetType);
}
