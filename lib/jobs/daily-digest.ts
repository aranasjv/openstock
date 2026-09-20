import 'server-only';

import { loadConfig } from '@/lib/config';
import { getAdminUserId } from '@/lib/admin';
import { runScreener } from '@/lib/actions/screener.actions';
import { getPortfolioSummaryForUser } from '@/lib/data/portfolio';
import { getTelegramConfig, sendTelegramMessage } from '@/lib/telegram';
import { buildDigestMessages, type DigestPick } from '@/lib/notifications';
import { getStrategy, isStrategyId, DEFAULT_STRATEGY_ID } from '@/lib/strategies';
import { formatCryptoPrice, formatPrice } from '@/lib/utils';

/**
 * The daily digest: today's must-buy screen for both markets, plus holdings, delivered to
 * the configured Telegram chats.
 *
 * Stock and crypto halves go to separate chats (TELEGRAM_STOCK_CHAT_ID /
 * TELEGRAM_CRYPTO_CHAT_ID), so each audience only receives what it asked for.
 *
 * Holdings belong to the admin user — the same identity that configures Telegram — since
 * the chat ids are deployment-wide rather than per-user.
 */

const MAX_PICKS = 5;

export interface DigestResult {
    ok: boolean;
    sent: { stocks: boolean; crypto: boolean };
    pickCounts: { stocks: number; crypto: number };
    error?: string;
}

function toPick(candidate: { symbol: string; name: string; score: number; price: number }, isCrypto: boolean): DigestPick {
    return { symbol: candidate.symbol, name: candidate.name, score: candidate.score, price: candidate.price, isCrypto };
}

export async function runDailyDigest(): Promise<DigestResult> {
    try {
        const config = await loadConfig();
        const strategyId = isStrategyId(config.SCREENER_STRATEGY) ? config.SCREENER_STRATEGY : DEFAULT_STRATEGY_ID;
        const strategy = getStrategy(strategyId);
        const market = config.DIGEST_MARKET || 'both';

        const wantStocks = market === 'both' || market === 'stocks';
        const wantCrypto = market === 'both' || market === 'crypto';

        const [stockResult, cryptoResult] = await Promise.all([
            wantStocks ? runScreener('stock', strategyId) : Promise.resolve(null),
            wantCrypto ? runScreener('crypto', strategyId) : Promise.resolve(null),
        ]);

        // Only show assets that matched at least one condition; a 0-score row is noise.
        const stockPicks = (stockResult?.candidates ?? [])
            .filter((candidate) => candidate.matched > 0)
            .slice(0, MAX_PICKS)
            .map((candidate) => toPick(candidate, false));

        const cryptoPicks = (cryptoResult?.candidates ?? [])
            .filter((candidate) => candidate.matched > 0)
            .slice(0, MAX_PICKS)
            .map((candidate) => toPick(candidate, true));

        // Holdings for the deployment's admin user.
        const adminId = await getAdminUserId();

        const summary = adminId
            ? await getPortfolioSummaryForUser(adminId)
            : { holdings: [], totalValue: 0, totalPnlPercent: 0, unpricedSymbols: [] as string[], totalCost: 0, totalPnl: 0 };

        const messages = buildDigestMessages({
            date: new Date().toISOString().slice(0, 10),
            strategyName: strategy.name,
            stockPicks,
            cryptoPicks,
            holdings: summary.holdings.map((holding) => ({
                symbol: holding.symbol,
                quantity: holding.quantity,
                pnlPercent: holding.pnlPercent,
                marketValue: holding.marketValue,
            })),
            totalValue: summary.totalValue,
            totalPnlPercent: summary.totalPnlPercent,
            currency: (value, isCrypto) => (isCrypto ? formatCryptoPrice(value) : formatPrice(value)),
        });

        const sent = { stocks: false, crypto: false };
        // Resolved once, and passed explicitly so both sends use the same snapshot.
        const telegramConfig = await getTelegramConfig();

        if (wantStocks) {
            const result = await sendTelegramMessage(messages.stocks, { audience: 'stocks', config: telegramConfig });
            sent.stocks = result.ok;
            if (!result.ok) console.error(`Digest to stocks chat failed: ${result.error}`);
        }

        if (wantCrypto) {
            const result = await sendTelegramMessage(messages.crypto, { audience: 'crypto', config: telegramConfig });
            sent.crypto = result.ok;
            if (!result.ok) console.error(`Digest to crypto chat failed: ${result.error}`);
        }

        return {
            ok: sent.stocks || sent.crypto,
            sent,
            pickCounts: { stocks: stockPicks.length, crypto: cryptoPicks.length },
        };
    } catch (error) {
        console.error('Daily digest failed:', error);
        return {
            ok: false,
            sent: { stocks: false, crypto: false },
            pickCounts: { stocks: 0, crypto: 0 },
            error: error instanceof Error ? error.message : 'Digest failed.',
        };
    }
}
