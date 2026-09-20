'use server';

import { revalidatePath } from 'next/cache';
import { isCurrentUserAdmin } from '@/lib/admin';

/**
 * Manual triggers for the scheduled jobs.
 *
 * These exist so delivery can be confirmed immediately rather than waiting for the clock to
 * come round — and so the scheduled path can be verified end to end.
 */

export async function sendTestDigest(): Promise<{ ok: boolean; message: string }> {
    if (!(await isCurrentUserAdmin())) {
        return { ok: false, message: 'Not authorised.' };
    }

    try {
        const { runDailyDigest } = await import('@/lib/jobs/daily-digest');
        const result = await runDailyDigest();

        if (!result.ok) {
            return {
                ok: false,
                message:
                    result.error ??
                    'Nothing was sent — check the bot token and that the stock/crypto chat ids are set.',
            };
        }

        return {
            ok: true,
            message: `Digest sent (stocks: ${result.sent.stocks ? 'yes' : 'no'}, crypto: ${result.sent.crypto ? 'yes' : 'no'}; ${result.pickCounts.stocks} stock and ${result.pickCounts.crypto} crypto matches).`,
        };
    } catch (error) {
        return {
            ok: false,
            message: error instanceof Error ? error.message : 'Digest failed.',
        };
    }
}

/**
 * Run the AI report on demand.
 *
 * Deliberately does not check REPORT_ENABLED: the point of this button is to see what the
 * report will say *before* switching the daily send on.
 */
export async function sendAssistantReportNow(): Promise<{ ok: boolean; message: string }> {
    if (!(await isCurrentUserAdmin())) {
        return { ok: false, message: 'Not authorised.' };
    }

    try {
        const { runAssistantReport } = await import('@/lib/jobs/assistant-report');
        const result = await runAssistantReport();

        if (!result.ok) {
            return {
                ok: false,
                message:
                    result.error ??
                    'Nothing was sent — check the AI provider key and the Telegram bot tokens.',
            };
        }

        const total = result.characters.stocks + result.characters.crypto;
        return {
            ok: true,
            message:
                `AI report sent — stocks: ${result.sent.stocks ? 'yes' : 'no'}, ` +
                `crypto: ${result.sent.crypto ? 'yes' : 'no'} (${total} characters` +
                `${result.provider ? `, via ${result.provider}` : ''}).`,
        };
    } catch (error) {
        return {
            ok: false,
            message: error instanceof Error ? error.message : 'AI report failed.',
        };
    }
}

export async function runAlertCheckNow(): Promise<{ ok: boolean; message: string }> {
    if (!(await isCurrentUserAdmin())) {
        return { ok: false, message: 'Not authorised.' };
    }

    try {
        const { runAlertCheck } = await import('@/lib/jobs/alert-check');
        const result = await runAlertCheck();
        revalidatePath('/watchlist');

        if (result.triggered === 0) {
            return { ok: true, message: `Checked ${result.processed} active alert(s); none triggered.` };
        }

        return {
            ok: true,
            message: `Triggered ${result.triggered} alert(s). stocks: ${result.notified.stocks ? 'sent' : 'not sent'}, crypto: ${result.notified.crypto ? 'sent' : 'not sent'}.`,
        };
    } catch (error) {
        return {
            ok: false,
            message: error instanceof Error ? error.message : 'Alert check failed.',
        };
    }
}
