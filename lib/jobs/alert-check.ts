import 'server-only';

import { connectToDatabase } from '@/database/mongoose';
import { loadConfig } from '@/lib/config';
import { getQuote } from '@/lib/actions/finnhub.actions';
import { getCryptoMarketsByIds } from '@/lib/actions/crypto.actions';
import { sendTelegramMessage } from '@/lib/telegram';
import { buildAlertMessage, type TriggeredAlert } from '@/lib/notifications';

/**
 * Evaluates active price alerts and delivers the triggered ones to Telegram.
 *
 * Extracted from the Inngest function so the scheduler and Inngest call the *same* code.
 * Two copies of this logic would drift, and an alert that fires under one trigger but not
 * the other is the worst kind of bug here.
 */

export interface AlertCheckResult {
    processed: number;
    triggered: number;
    notified: { stocks: boolean; crypto: boolean };
}

export async function runAlertCheck(): Promise<AlertCheckResult> {
    const empty: AlertCheckResult = { processed: 0, triggered: 0, notified: { stocks: false, crypto: false } };

    const mongoose = await connectToDatabase();
    const { Alert } = await import('@/database/models/alert.model');

    const now = new Date();
    const activeAlerts = await Alert.find({
        active: true,
        triggered: false,
        expiresAt: { $gt: now },
    }).lean();

    if (!activeAlerts || activeAlerts.length === 0) return empty;

    // Group by asset type: crypto prices come from one batched CoinGecko call, stocks from
    // Finnhub per symbol.
    const stockSymbols = [
        ...new Set(
            activeAlerts
                .filter((a: { assetType?: string }) => (a.assetType ?? 'stock') === 'stock')
                .map((a: { symbol: string }) => a.symbol)
        ),
    ] as string[];

    const cryptoSymbols = [
        ...new Set(
            activeAlerts
                .filter((a: { assetType?: string }) => a.assetType === 'crypto')
                .map((a: { symbol: string }) => a.symbol)
        ),
    ] as string[];

    const priceMap = new Map<string, number>();

    if (stockSymbols.length > 0) {
        const quotes = await Promise.all(
            stockSymbols.map(async (symbol) => {
                try {
                    const quote = await getQuote(symbol);
                    return [symbol.toUpperCase(), quote?.c] as const;
                } catch {
                    return [symbol.toUpperCase(), undefined] as const;
                }
            })
        );
        for (const [symbol, price] of quotes) {
            if (typeof price === 'number' && Number.isFinite(price)) priceMap.set(symbol, price);
        }
    }

    if (cryptoSymbols.length > 0) {
        const coins = await getCryptoMarketsByIds(cryptoSymbols);
        for (const coin of coins) {
            priceMap.set(coin.id.toUpperCase(), coin.currentPrice);
        }
    }

    const triggered: (TriggeredAlert & { id: unknown })[] = [];

    for (const alert of activeAlerts as unknown as {
        _id: unknown;
        symbol: string;
        assetType?: string;
        condition: 'ABOVE' | 'BELOW';
        targetPrice: number;
    }[]) {
        const currentPrice = priceMap.get(alert.symbol.toUpperCase());
        if (currentPrice === undefined) continue;

        const hit =
            (alert.condition === 'ABOVE' && currentPrice >= alert.targetPrice) ||
            (alert.condition === 'BELOW' && currentPrice <= alert.targetPrice);

        if (hit) {
            triggered.push({
                id: alert._id,
                symbol: alert.symbol,
                condition: alert.condition,
                targetPrice: alert.targetPrice,
                currentPrice,
                isCrypto: alert.assetType === 'crypto',
            });
        }
    }

    if (triggered.length === 0) {
        return { processed: activeAlerts.length, triggered: 0, notified: { stocks: false, crypto: false } };
    }

    const notified = { stocks: false, crypto: false };

    // One message per audience, because the two asset classes go to different chats.
    for (const [audience, isCrypto] of [['stocks', false], ['crypto', true]] as const) {
        const forAudience = triggered.filter((alert) => alert.isCrypto === isCrypto);
        const text = buildAlertMessage(forAudience);
        if (!text) continue;

        const result = await sendTelegramMessage(text, { audience });
        if (!result.ok) {
            console.error(`Alert notification to ${audience} failed: ${result.error}`);
        }
        notified[audience] = result.ok;
    }

    // Mark triggered only after attempting delivery, so a failed send is retried next tick
    // rather than silently swallowing the alert.
    const { Alert: AlertModel } = await import('@/database/models/alert.model');
    for (const alert of triggered) {
        await AlertModel.findByIdAndUpdate(alert.id, { triggered: true, active: false });
    }

    return { processed: activeAlerts.length, triggered: triggered.length, notified };
}
