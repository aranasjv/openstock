import 'server-only';

import { connectToDatabase } from '@/database/mongoose';
import { HoldingModel } from '@/database/models/holding.model';
import { getQuote } from '@/lib/actions/finnhub.actions';
import { getCryptoMarketsByIds } from '@/lib/actions/crypto.actions';
import { MAX_LIST_ITEMS } from '@/lib/validate';

/**
 * Holdings data access.
 *
 * Takes an explicit `userId` because every caller is server-side and already knows whose
 * data it wants: the daily digest and the AI report act as the admin user, and the assistant
 * tools act as the user whose turn it is.
 *
 * It is deliberately **not** a `'use server'` module. Nothing here resolves a session, so it
 * must never be reachable from the browser — and it cannot be, because `server-only` makes
 * importing it into a client bundle a build error. The session-resolving wrapper the UI calls
 * lives in `lib/actions/holdings.actions.ts`.
 *
 * Keeping the split this way is what fixed the original hole: the action used to accept a
 * `userId` argument from the browser, so any signed-in user could read or write anyone's
 * portfolio by passing a different id.
 */

export type HoldingAssetType = 'stock' | 'crypto';

export interface HoldingView {
    symbol: string;
    assetType: HoldingAssetType;
    quantity: number;
    averageCost: number;
    /** null when no price could be fetched — never 0, which would read as a total loss. */
    price: number | null;
    marketValue: number | null;
    costBasis: number;
    pnl: number | null;
    pnlPercent: number | null;
}

export interface PortfolioSummary {
    holdings: HoldingView[];
    totalValue: number;
    totalCost: number;
    totalPnl: number;
    totalPnlPercent: number;
    /** Symbols whose price could not be resolved, so totals are explicitly partial. */
    unpricedSymbols: string[];
}

export async function getHoldingsForUser(userId: string, assetType?: HoldingAssetType) {
    try {
        await connectToDatabase();
        const filter = assetType ? { userId, assetType } : { userId };
        const holdings = await HoldingModel.find(filter).sort({ addedAt: -1 }).limit(MAX_LIST_ITEMS);
        return JSON.parse(JSON.stringify(holdings));
    } catch (error) {
        console.error('Error fetching holdings:', error);
        // Rethrow rather than returning []. Swallowing it made a database outage
        // indistinguishable from "you hold nothing", which is the wrong thing to tell
        // someone about their portfolio.
        throw new Error('Could not load holdings.');
    }
}

export async function addHoldingForUser(
    userId: string,
    params: { symbol: string; assetType: HoldingAssetType; quantity: number; averageCost: number }
) {
    const { symbol, assetType, quantity, averageCost } = params;

    if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Quantity must be greater than zero.');
    }
    if (!Number.isFinite(averageCost) || averageCost < 0) {
        throw new Error('Average cost cannot be negative.');
    }

    try {
        await connectToDatabase();
        const holding = await HoldingModel.findOneAndUpdate(
            { userId, symbol: symbol.toUpperCase(), assetType },
            { userId, symbol: symbol.toUpperCase(), assetType, quantity, averageCost, addedAt: new Date() },
            { upsert: true, new: true }
        );

        return JSON.parse(JSON.stringify(holding));
    } catch (error) {
        console.error('Error saving holding:', error);
        throw new Error('Failed to save holding');
    }
}

export async function removeHoldingForUser(
    userId: string,
    symbol: string,
    assetType: HoldingAssetType = 'stock'
) {
    try {
        await connectToDatabase();
        await HoldingModel.findOneAndDelete({ userId, symbol: symbol.toUpperCase(), assetType });
        return { success: true };
    } catch (error) {
        console.error('Error removing holding:', error);
        throw new Error('Failed to remove holding');
    }
}

/** Batch price lookup, one request per market regardless of how many holdings exist. */
async function fetchPrices(
    stockSymbols: string[],
    cryptoIds: string[]
): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    const [quotes, coins] = await Promise.all([
        Promise.all(
            stockSymbols.map(async (symbol) => {
                try {
                    const quote = await getQuote(symbol);
                    return [symbol.toUpperCase(), quote?.c] as const;
                } catch {
                    return [symbol.toUpperCase(), undefined] as const;
                }
            })
        ),
        getCryptoMarketsByIds(cryptoIds),
    ]);

    for (const [symbol, price] of quotes) {
        if (typeof price === 'number' && Number.isFinite(price)) prices.set(symbol, price);
    }
    for (const coin of coins) {
        if (Number.isFinite(coin.currentPrice)) prices.set(coin.id.toUpperCase(), coin.currentPrice);
    }

    return prices;
}

/**
 * Valuations for a user's holdings, plus portfolio totals.
 *
 * Totals only include holdings with a resolvable price; those that failed are reported in
 * `unpricedSymbols` so a data outage is visible rather than silently dragging the total down.
 */
export async function getPortfolioSummaryForUser(
    userId: string,
    assetType?: HoldingAssetType
): Promise<PortfolioSummary> {
    const empty: PortfolioSummary = {
        holdings: [],
        totalValue: 0,
        totalCost: 0,
        totalPnl: 0,
        totalPnlPercent: 0,
        unpricedSymbols: [],
    };

    try {
        await connectToDatabase();
        const filter = assetType ? { userId, assetType } : { userId };
        const records = await HoldingModel.find(filter).limit(MAX_LIST_ITEMS).lean();

        if (records.length === 0) return empty;

        const stockSymbols = records.filter((r) => r.assetType !== 'crypto').map((r) => r.symbol);
        const cryptoIds = records.filter((r) => r.assetType === 'crypto').map((r) => r.symbol);

        const prices = await fetchPrices(stockSymbols, cryptoIds);

        const holdings: HoldingView[] = records.map((record) => {
            const symbol = String(record.symbol);
            const quantity = Number(record.quantity) || 0;
            const averageCost = Number(record.averageCost) || 0;
            const costBasis = quantity * averageCost;
            const price = prices.get(symbol.toUpperCase()) ?? null;

            const marketValue = price === null ? null : quantity * price;
            const pnl = marketValue === null ? null : marketValue - costBasis;
            const pnlPercent = pnl === null || costBasis === 0 ? null : (pnl / costBasis) * 100;

            return {
                symbol,
                assetType: (record.assetType === 'crypto' ? 'crypto' : 'stock') as HoldingAssetType,
                quantity,
                averageCost,
                price,
                marketValue,
                costBasis,
                pnl,
                pnlPercent,
            };
        });

        const priced = holdings.filter((h) => h.marketValue !== null);
        const totalValue = priced.reduce((sum, h) => sum + (h.marketValue ?? 0), 0);
        const totalCost = priced.reduce((sum, h) => sum + h.costBasis, 0);
        const totalPnl = totalValue - totalCost;

        return {
            holdings,
            totalValue,
            totalCost,
            totalPnl,
            totalPnlPercent: totalCost === 0 ? 0 : (totalPnl / totalCost) * 100,
            unpricedSymbols: holdings.filter((h) => h.price === null).map((h) => h.symbol),
        };
    } catch (error) {
        console.error('Error building portfolio summary:', error);
        // See getHoldingsForUser: a failure must not read as a zeroed portfolio.
        throw new Error('Could not build the portfolio summary.');
    }
}
