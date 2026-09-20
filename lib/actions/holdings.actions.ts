'use server';

import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/session';
import { requireOneOf, requireText, MAX_SYMBOL_LENGTH } from '@/lib/validate';
import {
    addHoldingForUser,
    getHoldingsForUser,
    getPortfolioSummaryForUser,
    removeHoldingForUser,
    type HoldingAssetType,
} from '@/lib/data/portfolio';

const ASSET_TYPES = ['stock', 'crypto'] as const;

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
    symbol: unknown;
    assetType: unknown;
    quantity: number;
    averageCost: number;
}) {
    const userId = await requireUserId();

    // Symbol and asset type are validated here; quantity and average cost are checked by the
    // data layer, which is the single choke point for that write.
    const holding = await addHoldingForUser(userId, {
        symbol: requireText(params.symbol, 'Symbol', MAX_SYMBOL_LENGTH),
        assetType: requireOneOf(params.assetType, 'Asset type', ASSET_TYPES),
        quantity: params.quantity,
        averageCost: params.averageCost,
    });

    revalidatePath('/holdings');
    return holding;
}

export async function removeHolding(symbol: unknown, assetType: unknown = 'stock') {
    const userId = await requireUserId();

    const result = await removeHoldingForUser(
        userId,
        requireText(symbol, 'Symbol', MAX_SYMBOL_LENGTH),
        requireOneOf(assetType, 'Asset type', ASSET_TYPES)
    );

    revalidatePath('/holdings');
    return result;
}

export async function getPortfolioSummary(assetType?: HoldingAssetType) {
    return getPortfolioSummaryForUser(await requireUserId(), assetType);
}
