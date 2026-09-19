import 'server-only';

import { loadConfig } from '@/lib/config';

/**
 * Telegram delivery via the Bot API.
 *
 * Deliberately never throws: a notification failing must not break the request or cron run
 * that triggered it. Callers get `{ ok, error }` and decide what to log.
 *
 * Formatting uses HTML parse mode rather than MarkdownV2. MarkdownV2 requires escaping a
 * long list of reserved characters or the API rejects the entire message, and company names
 * routinely contain them ("AT&T", "Barnes & Noble"). HTML needs only &, < and > escaped.
 */

const DEFAULT_TELEGRAM_API_BASE = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 10_000;

/** Which configured chat a message goes to. */
export type TelegramAudience = 'stocks' | 'crypto';

export interface TelegramResult {
    ok: boolean;
    messageId?: number;
    error?: string;
}

/**
 * Escapes the three characters Telegram's HTML parser treats as markup.
 *
 * `&` must be replaced first, or the ampersands introduced by the later replacements would
 * themselves be escaped twice.
 */
export function escapeTelegramHtml(text: string): string {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export interface TelegramConfig {
    /**
     * Optional shared token, used only when a per-audience token is not set. Kept so a setup
     * that previously used one bot keeps working.
     */
    sharedToken: string;
    stockBotToken: string;
    cryptoBotToken: string;
    stockChatId: string;
    cryptoChatId: string;
    enabled: boolean;
    /** Overridable to point at a self-hosted Bot API server. */
    apiBase: string;
}

export async function getTelegramConfig(): Promise<TelegramConfig> {
    const config = await loadConfig();
    return {
        sharedToken: config.TELEGRAM_BOT_TOKEN || '',
        stockBotToken: config.TELEGRAM_STOCK_BOT_TOKEN || '',
        cryptoBotToken: config.TELEGRAM_CRYPTO_BOT_TOKEN || '',
        stockChatId: config.TELEGRAM_STOCK_CHAT_ID || '',
        cryptoChatId: config.TELEGRAM_CRYPTO_CHAT_ID || '',
        enabled: (config.TELEGRAM_ENABLED || 'true') !== 'false',
        apiBase: (config.TELEGRAM_API_BASE_URL || DEFAULT_TELEGRAM_API_BASE).replace(/\/$/, ''),
    };
}

/**
 * The token for an audience: its own bot if configured, otherwise the shared fallback.
 * Stocks and crypto are commonly run as two separate bots so each chat is fed by a bot the
 * user controls independently.
 */
export function resolveBotToken(config: TelegramConfig, audience: TelegramAudience): string {
    return audience === 'crypto'
        ? config.cryptoBotToken || config.sharedToken
        : config.stockBotToken || config.sharedToken;
}

/** A recipient is usable when that audience has both a bot token and a chat id. */
export function resolveChatId(config: TelegramConfig, audience: TelegramAudience): string {
    return audience === 'crypto' ? config.cryptoChatId : config.stockChatId;
}

export function isTelegramConfigured(config: TelegramConfig, audience?: TelegramAudience): boolean {
    if (!config.enabled) return false;
    if (audience) {
        return Boolean(resolveBotToken(config, audience) && resolveChatId(config, audience));
    }
    return (['stocks', 'crypto'] as const).some((a) => Boolean(resolveBotToken(config, a) && resolveChatId(config, a)));
}

async function callTelegram<T>(
    method: string,
    token: string,
    apiBase: string,
    payload?: Record<string, unknown>
): Promise<{ ok: boolean; result?: T; error?: string }> {
    if (!token) return { ok: false, error: 'Telegram bot token is not configured.' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const res = await fetch(`${apiBase}/bot${token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload ?? {}),
            signal: controller.signal,
            cache: 'no-store',
        });

        const data = await res.json().catch(() => null);

        if (!res.ok || !data?.ok) {
            // Telegram returns a human-readable reason, e.g. "chat not found". Surfacing it
            // matters because a wrong chat id is the most likely setup mistake.
            return { ok: false, error: data?.description || `Telegram responded ${res.status}` };
        }

        return { ok: true, result: data.result as T };
    } catch (error) {
        const cause = (error as { cause?: { code?: string } })?.cause?.code;
        const message = error instanceof Error ? error.message : 'Telegram request failed.';

        // A timeout is worth naming, because "fetch failed" reads like a bad token.
        //
        // The specific trap here: Node races IPv4 and IPv6 (Happy Eyeballs), and a container
        // with no IPv6 route black-holes an AAAA connection instead of failing fast. This is
        // addressed in instrumentation.ts; the hint remains because a host genuinely behind a
        // network that blocks Telegram needs the proxy option.
        if (cause === 'ETIMEDOUT' || cause === 'ECONNRESET' || cause === 'UND_ERR_CONNECT_TIMEOUT') {
            return {
                ok: false,
                error:
                    `Timed out reaching ${apiBase} (${cause}). This is a connectivity problem, not a bad token — ` +
                    `the bot token was not rejected. If this network blocks Telegram, point ` +
                    `TELEGRAM_API_BASE_URL at a proxy that can reach it.`,
            };
        }

        return { ok: false, error: message };
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Send a message to the chat configured for `audience`.
 * Callers should escape any interpolated values with `escapeTelegramHtml`.
 */
export async function sendTelegramMessage(
    text: string,
    options: { audience: TelegramAudience; config?: TelegramConfig }
): Promise<TelegramResult> {
    const config = options.config ?? (await getTelegramConfig());

    if (!config.enabled) {
        return { ok: false, error: 'Telegram notifications are disabled.' };
    }

    const chatId = resolveChatId(config, options.audience);
    const token = resolveBotToken(config, options.audience);

    if (!token || !chatId) {
        return {
            ok: false,
            error: `Telegram ${options.audience} is not configured (bot token and chat id required).`,
        };
    }

    const result = await callTelegram<{ message_id: number }>('sendMessage', token, config.apiBase, {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
    });

    return result.ok
        ? { ok: true, messageId: result.result?.message_id }
        : { ok: false, error: result.error };
}

/**
 * Validates a bot token. Used by the settings "Test" button.
 * Pass an audience to check that specific bot; omit it to check the shared fallback.
 */
export async function getTelegramMe(
    audience?: TelegramAudience
): Promise<{ ok: boolean; username?: string; error?: string }> {
    const config = await getTelegramConfig();
    const token = audience ? resolveBotToken(config, audience) : config.sharedToken;

    if (!token) {
        return { ok: false, error: `No bot token configured${audience ? ` for ${audience}` : ''}.` };
    }

    const result = await callTelegram<{ username?: string; first_name?: string }>(
        'getMe',
        token,
        config.apiBase
    );

    return result.ok
        ? { ok: true, username: result.result?.username ?? result.result?.first_name }
        : { ok: false, error: result.error };
}

/**
 * Recent updates for this bot, used to discover a chat id: message the bot, then read the
 * id back. This is the fix for the most common setup error.
 */
export async function getTelegramUpdates(audience: TelegramAudience = 'stocks'): Promise<{
    ok: boolean;
    chats?: { id: string; label: string }[];
    error?: string;
}> {
    const config = await getTelegramConfig();
    const token = resolveBotToken(config, audience);

    if (!token) {
        return { ok: false, error: `No bot token configured for ${audience}.` };
    }

    const result = await callTelegram<
        { message?: { chat?: { id: number; title?: string; username?: string; first_name?: string } } }[]
    >('getUpdates', token, config.apiBase);

    if (!result.ok) return { ok: false, error: result.error };

    const seen = new Map<string, string>();
    for (const update of result.result ?? []) {
        const chat = update.message?.chat;
        if (!chat) continue;
        const id = String(chat.id);
        if (!seen.has(id)) {
            seen.set(id, chat.title || chat.username || chat.first_name || 'unknown chat');
        }
    }

    return { ok: true, chats: Array.from(seen, ([id, label]) => ({ id, label })) };
}
