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
    provider:
        | 'deepseek'
        | 'gemini'
        | 'minimax'
        | 'siray'
        | 'finnhub'
        | 'coingecko'
        | 'telegram-stocks'
        | 'telegram-crypto'
        | 'telegram-shared'
): Promise<{ ok: boolean; message: string }> {
    if (!(await isCurrentUserAdmin())) {
        return { ok: false, message: 'Not authorised.' };
    }

    try {
        if (provider.startsWith('telegram')) {
            const { getTelegramMe, getTelegramConfig, sendTelegramMessage, resolveChatId } = await import(
                '@/lib/telegram'
            );
            const config = await getTelegramConfig();

            const audience =
                provider === 'telegram-crypto' ? 'crypto' : provider === 'telegram-stocks' ? 'stocks' : undefined;

            // Validate the token for THIS bot. With two bots configured, one working says
            // nothing about the other, so each is checked on its own.
            const me = await getTelegramMe(audience);
            if (!me.ok) {
                return { ok: false, message: `Token rejected: ${me.error}` };
            }

            if (!audience) {
                return { ok: true, message: `Shared bot @${me.username} is valid.` };
            }

            const chatId = resolveChatId(config, audience);
            if (!chatId) {
                return {
                    ok: false,
                    message: `@${me.username} is valid, but no ${audience} chat id is set yet.`,
                };
            }

            const sent = await sendTelegramMessage(
                `OpenStock test message (${audience}). If you can read this, alerts will arrive here.`,
                { audience, config }
            );

            return sent.ok
                ? { ok: true, message: `@${me.username} sent a test message to the ${audience} chat.` }
                : { ok: false, message: `@${me.username} token is valid, but the send failed: ${sent.error}` };
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
        const { AI_PROVIDER_NAMES } = await import('@/lib/ai-provider');

        // Narrowed explicitly: TypeScript cannot infer that the telegram branches returned,
        // and telegram ids are not provider names.
        if (!AI_PROVIDER_NAMES.includes(provider as never)) {
            return { ok: false, message: `Unknown provider: ${provider}` };
        }

        const reply = await callAIProvider('Reply with the single word: ok', provider as never);
        return { ok: true, message: `${provider} responded: "${reply.trim().slice(0, 60)}"` };
    } catch (error) {
        return {
            ok: false,
            message: error instanceof Error ? error.message : 'Request failed.',
        };
    }
}

/**
 * Lists the chats that have recently messaged the given bot, so a chat id can be copied
 * instead of guessed. This is the fix for the usual "chat not found" setup error.
 */
export async function discoverTelegramChats(
    audience: 'stocks' | 'crypto' = 'stocks'
): Promise<{ ok: boolean; chats?: { id: string; label: string }[]; message: string }> {
    if (!(await isCurrentUserAdmin())) {
        return { ok: false, message: 'Not authorised.' };
    }

    const { getTelegramUpdates } = await import('@/lib/telegram');
    const result = await getTelegramUpdates(audience);

    if (!result.ok) return { ok: false, message: result.error ?? 'Could not reach Telegram.' };
    if (!result.chats || result.chats.length === 0) {
        return {
            ok: true,
            chats: [],
            message: `No chats found for the ${audience} bot. Send it any message in Telegram first, then try again.`,
        };
    }

    return { ok: true, chats: result.chats, message: `Found ${result.chats.length} chat(s).` };
}
