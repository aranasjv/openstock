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
    provider: 'deepseek' | 'gemini' | 'minimax' | 'siray' | 'finnhub' | 'coingecko'
): Promise<{ ok: boolean; message: string }> {
    if (!(await isCurrentUserAdmin())) {
        return { ok: false, message: 'Not authorised.' };
    }

    try {
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
