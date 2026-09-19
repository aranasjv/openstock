'use server';

import { revalidatePath } from 'next/cache';
import { isCurrentUserAdmin } from '@/lib/admin';
import { saveConfig } from '@/lib/config';

/**
 * Persist settings edited from /settings.
 *
 * Guarded by an explicit admin check rather than requireAdmin(), because that helper
 * calls notFound() — which is the right response for a page but not for an action.
 */
export async function updateSettings(
    values: Record<string, string>
): Promise<{ success: boolean; saved?: string[]; rejected?: string[]; error?: string }> {
    if (!(await isCurrentUserAdmin())) {
        return { success: false, error: 'Not authorised.' };
    }

    try {
        const { saved, rejected } = await saveConfig(values);

        // Settings feed market data and AI clients used across the app, so refresh the
        // routes that render them rather than only this page.
        revalidatePath('/settings');
        revalidatePath('/');
        revalidatePath('/crypto');

        return { success: true, saved, rejected };
    } catch (error) {
        console.error('Failed to save settings:', error);
        return { success: false, error: 'Could not save settings.' };
    }
}

/** Verify a provider's credentials by making a minimal request. */
export async function testProvider(
    provider: 'deepseek' | 'gemini' | 'minimax' | 'siray' | 'finnhub' | 'coingecko' | 'telegram'
): Promise<{ ok: boolean; message: string }> {
    if (!(await isCurrentUserAdmin())) {
        return { ok: false, message: 'Not authorised.' };
    }

    try {
        if (provider === 'telegram') {
            const { getTelegramMe, getTelegramConfig, sendTelegramMessage } = await import('@/lib/telegram');
            const config = await getTelegramConfig();

            const me = await getTelegramMe();
            if (!me.ok) {
                return { ok: false, message: `Bot token rejected: ${me.error}` };
            }

            // Validate each configured chat separately — a wrong chat id is the most common
            // setup error, and one chat working says nothing about the other.
            const results: string[] = [];
            for (const audience of ['stocks', 'crypto'] as const) {
                const chatId = audience === 'crypto' ? config.cryptoChatId : config.stockChatId;
                if (!chatId) {
                    results.push(`${audience}: not configured`);
                    continue;
                }
                const sent = await sendTelegramMessage(
                    `OpenStock test message (${audience}). If you can read this, alerts will arrive here.`,
                    { audience, config }
                );
                results.push(`${audience}: ${sent.ok ? 'sent' : sent.error}`);
            }

            const anyFailed = results.some((line) => !line.includes('sent') && !line.includes('not configured'));
            return {
                ok: !anyFailed,
                message: `Bot @${me.username ?? 'unknown'} — ${results.join('; ')}`,
            };
        }

        if (provider === 'finnhub') {
            const { getQuote } = await import('@/lib/actions/finnhub.actions');
            const quote = await getQuote('AAPL');
            return quote
                ? { ok: true, message: `Finnhub responded (AAPL ${quote.c ?? 'n/a'}).` }
                : { ok: false, message: 'Finnhub returned no data — check the API key.' };
        }

        if (provider === 'coingecko') {
            const { getCryptoMarkets } = await import('@/lib/actions/crypto.actions');
            const markets = await getCryptoMarkets(1);
            return markets.length > 0
                ? { ok: true, message: `CoinGecko responded (${markets[0].name}).` }
                : { ok: false, message: 'CoinGecko returned no data.' };
        }

        const { callAIProvider } = await import('@/lib/ai-provider');
        const reply = await callAIProvider('Reply with the single word: ok', provider);
        return { ok: true, message: `${provider} responded: "${reply.trim().slice(0, 60)}"` };
    } catch (error) {
        return {
            ok: false,
            message: error instanceof Error ? error.message : 'Request failed.',
        };
    }
}

/**
 * Lists the chats that have recently messaged the bot, so a chat id can be copied instead of
 * guessed. This is the fix for the usual "chat not found" setup error.
 */
export async function discoverTelegramChats(): Promise<{ ok: boolean; chats?: { id: string; label: string }[]; message: string }> {
    if (!(await isCurrentUserAdmin())) {
        return { ok: false, message: 'Not authorised.' };
    }

    const { getTelegramUpdates } = await import('@/lib/telegram');
    const result = await getTelegramUpdates();

    if (!result.ok) return { ok: false, message: result.error ?? 'Could not reach Telegram.' };
    if (!result.chats || result.chats.length === 0) {
        return {
            ok: true,
            chats: [],
            message: 'No chats found. Send any message to your bot in Telegram first, then try again.',
        };
    }

    return { ok: true, chats: result.chats, message: `Found ${result.chats.length} chat(s).` };
}
