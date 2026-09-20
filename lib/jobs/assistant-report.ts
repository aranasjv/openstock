import 'server-only';

import { DEFAULT_REPORT_PROMPT, loadConfig } from '@/lib/config';
import { getAdminUserId } from '@/lib/admin';
import { runChatTurn, type ChatTurnResult } from '@/lib/ai-chat';
import {
    escapeTelegramHtml,
    getTelegramConfig,
    sendTelegramMessage,
    type TelegramAudience,
} from '@/lib/telegram';

/**
 * The daily AI report.
 *
 * This is `/assistant` run headlessly: the same system prompt, the same tools, the same
 * playbooks — asked a standing question on a schedule and delivered to Telegram. It exists
 * because the digest can report *what* the screen flagged but not *what it means*, and that
 * reading is the part worth having at 8am.
 *
 * Two consequences follow from running the chat with nobody watching:
 *   - every figure must still come from a tool call (the system prompt forbids stating a
 *     price from memory), so a number cannot quietly be invented for a chat that no human
 *     will sanity-check;
 *   - the text is HTML-escaped before it reaches Telegram, because a stray `&` or `<` in
 *     model prose otherwise makes the API reject the entire message.
 *
 * Whether this runs on a schedule is decided by the scheduler (REPORT_ENABLED), not here —
 * so the "send now" button still works before the feature is switched on.
 */

const DEFAULT_MAX_CHARS = 3_000;
/** Telegram rejects a single message over 4096 characters. */
const TELEGRAM_MESSAGE_LIMIT = 4_096;

const AUDIENCE_MARKET: Record<TelegramAudience, string> = {
    stocks: 'US stocks',
    crypto: 'crypto',
};

const DISCLAIMER = 'AI-generated from live market data. Not investment advice.';

export interface AssistantReportResult {
    ok: boolean;
    sent: { stocks: boolean; crypto: boolean };
    /** Characters actually delivered, so a silent truncation is visible in the logs. */
    characters: { stocks: number; crypto: number };
    provider?: string;
    error?: string;
}

/**
 * `{market}` and `{date}` are the documented placeholders. An unrecognised placeholder is
 * left as written rather than blanked, so a typo is visible in the output.
 */
export function buildReportPrompt(
    template: string,
    audience: TelegramAudience,
    date: string
): string {
    return (template || DEFAULT_REPORT_PROMPT)
        .replace(/\{market\}/g, AUDIENCE_MARKET[audience])
        .replace(/\{date\}/g, date);
}

function clip(text: string, maxChars: number): string {
    const clean = (text || '').trim();
    if (clean.length <= maxChars) return clean;
    return `${clean.slice(0, maxChars - 1).trimEnd()}…`;
}

/** Header, escaped body, disclaimer. Kept pure so the wire format is unit-testable. */
export function renderReportMessage(body: string, date: string): string {
    return [
        '<b>OpenStock — AI briefing</b>',
        escapeTelegramHtml(date),
        '',
        escapeTelegramHtml(body),
        '',
        DISCLAIMER,
    ].join('\n');
}

function resolveMaxChars(raw: string): number {
    const parsed = Number.parseInt(raw || '', 10);
    const requested = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CHARS;
    return Math.min(requested, TELEGRAM_MESSAGE_LIMIT);
}

function resolveAudiences(market: string): TelegramAudience[] {
    const audiences: TelegramAudience[] = [];
    if (market === 'both' || market === 'stocks') audiences.push('stocks');
    if (market === 'both' || market === 'crypto') audiences.push('crypto');
    return audiences;
}

export async function runAssistantReport(): Promise<AssistantReportResult> {
    const sent = { stocks: false, crypto: false };
    const characters = { stocks: 0, crypto: 0 };

    try {
        const config = await loadConfig();
        const audiences = resolveAudiences(config.REPORT_MARKET || 'both');

        if (audiences.length === 0) {
            return {
                ok: false,
                sent,
                characters,
                error: `Unknown report audience "${config.REPORT_MARKET}".`,
            };
        }

        const template = config.REPORT_PROMPT || DEFAULT_REPORT_PROMPT;
        const maxChars = resolveMaxChars(config.REPORT_MAX_CHARS);

        // "Your holdings" means the deployment owner's, exactly as in the digest — the chat
        // ids are deployment-wide, so there is no per-user report to write.
        const userId = (await getAdminUserId()) ?? '';
        if (!userId) {
            console.warn('AI report: no admin user found — personal tools will return nothing.');
        }

        // Resolved once so both sends use the same snapshot.
        const telegramConfig = await getTelegramConfig();
        const date = new Date().toISOString().slice(0, 10);
        const failures: string[] = [];
        let provider: string | undefined;

        for (const audience of audiences) {
            try {
                const prompt = buildReportPrompt(template, audience, date);
                const turn: ChatTurnResult = await runChatTurn({
                    history: [{ role: 'user', content: prompt }],
                    userId,
                });
                provider = provider ?? turn.provider;

                const body = clip(turn.content, maxChars);
                if (!body) {
                    failures.push(`${audience}: the model returned nothing`);
                    continue;
                }

                const result = await sendTelegramMessage(renderReportMessage(body, date), {
                    audience,
                    config: telegramConfig,
                });

                sent[audience] = result.ok;
                if (result.ok) {
                    characters[audience] = body.length;
                } else {
                    failures.push(`${audience}: ${result.error}`);
                }
            } catch (error) {
                // One audience failing must not stop the other.
                console.error(`AI report for ${audience} failed:`, error);
                failures.push(
                    `${audience}: ${error instanceof Error ? error.message : 'report generation failed'}`
                );
            }
        }

        const ok = sent.stocks || sent.crypto;
        const result: AssistantReportResult = { ok, sent, characters, provider };
        if (!ok) result.error = failures.join('; ') || 'Nothing was sent.';
        else if (failures.length > 0) result.error = failures.join('; ');
        return result;
    } catch (error) {
        console.error('AI report failed:', error);
        return {
            ok: false,
            sent,
            characters,
            error: error instanceof Error ? error.message : 'Report failed.',
        };
    }
}
