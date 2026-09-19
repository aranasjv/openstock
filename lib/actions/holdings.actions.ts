'use server';

import { revalidatePath } from 'next/cache';
import { connectToDatabase } from '@/database/mongoose';
import { HoldingModel } from '@/database/models/holding.model';
import { getQuote } from '@/lib/actions/finnhub.actions';
import { getCryptoMarketsByIds } from '@/lib/actions/crypto.actions';

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

export async function getHoldings(userId: string, assetType?: HoldingAssetType) {
    try {
        await connectToDatabase();
        const filter = assetType ? { userId, assetType } : { userId };
        const holdings = await HoldingModel.find(filter).sort({ addedAt: -1 });
        return JSON.parse(JSON.stringify(holdings));
    } catch (error) {
        console.error('Error fetching holdings:', error);
        return [];
    }
}

export async function addHolding(params: {
    userId: string;
    symbol: string;
    assetType: HoldingAssetType;
    quantity: number;
    averageCost: number;
}) {
    const { userId, symbol, assetType, quantity, averageCost } = params;

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

        revalidatePath('/holdings');
        return JSON.parse(JSON.stringify(holding));
    } catch (error) {
        console.error('Error saving holding:', error);
        throw new Error('Failed to save holding');
    }
}

export async function removeHolding(
    userId: string,
    symbol: string,
    assetType: HoldingAssetType = 'stock'
) {
    try {
        await connectToDatabase();
        await HoldingModel.findOneAndDelete({ userId, symbol: symbol.toUpperCase(), assetType });
        revalidatePath('/holdings');
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
 * Valuations for the user's holdings, plus portfolio totals.
 *
 * Totals only include holdings with a resolvable price; those that failed are reported in
 * `unpricedSymbols` so a data outage is visible rather than silently dragging the total down.
 */
export async function getPortfolioSummary(
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
        const records = await HoldingModel.find(filter).lean();

        if (records.length === 0) return empty;

        const stockSymbols = records
            .filter((r) => r.assetType !== 'crypto')
            .map((r) => r.symbol);
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
        return empty;
    }
}
