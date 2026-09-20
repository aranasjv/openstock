import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The daily AI report is the /assistant chat run headlessly, so the things worth asserting
 * are the ones a human would normally catch: that the right chat got it, that a runaway
 * reply was clipped, and that model prose cannot break the Telegram parse.
 */

const runChatTurn = vi.fn();
const getAdminUserId = vi.fn();
const sendTelegramMessage = vi.fn();
const getTelegramConfig = vi.fn();

let configValues: Record<string, string> = {};

vi.mock('@/lib/config', () => ({
    loadConfig: async () => configValues,
    DEFAULT_REPORT_PROMPT: 'DEFAULT PROMPT for {market} on {date}',
}));

vi.mock('@/lib/admin', () => ({
    getAdminUserId: () => getAdminUserId(),
}));

vi.mock('@/lib/ai-chat', () => ({
    runChatTurn: (input: unknown) => runChatTurn(input),
}));

// escapeTelegramHtml is kept real: the escaping is the thing under test, not a detail to stub.
vi.mock('@/lib/telegram', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/telegram')>();
    return {
        ...actual,
        getTelegramConfig: () => getTelegramConfig(),
        sendTelegramMessage: (text: string, options: unknown) => sendTelegramMessage(text, options),
    };
});

import { runAssistantReport, buildReportPrompt, renderReportMessage } from '@/lib/jobs/assistant-report';

function turn(content: string) {
    return { content, toolTrace: [], iterations: 2, provider: 'gemini' };
}

beforeEach(() => {
    runChatTurn.mockReset();
    getAdminUserId.mockReset();
    sendTelegramMessage.mockReset();
    getTelegramConfig.mockReset();

    configValues = { REPORT_MARKET: 'both', REPORT_PROMPT: '', REPORT_MAX_CHARS: '3000' };

    getAdminUserId.mockResolvedValue('admin-1');
    getTelegramConfig.mockResolvedValue({ enabled: true, apiBase: 'https://api.telegram.org' });
    sendTelegramMessage.mockResolvedValue({ ok: true, messageId: 1 });
    runChatTurn.mockResolvedValue(turn('Briefing body.'));
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('runAssistantReport', () => {
    it('briefs both audiences by default, as the admin user', async () => {
        const result = await runAssistantReport();

        expect(result.ok).toBe(true);
        expect(result.sent).toEqual({ stocks: true, crypto: true });
        expect(sendTelegramMessage).toHaveBeenCalledTimes(2);
        expect(sendTelegramMessage.mock.calls.map((call) => call[1].audience)).toEqual([
            'stocks',
            'crypto',
        ]);

        // The chat ids are deployment-wide, so "your holdings" means the owner's.
        expect(getAdminUserId).toHaveBeenCalled();
        for (const call of runChatTurn.mock.calls) {
            expect(call[0].userId).toBe('admin-1');
        }
    });

    it('writes a market-specific prompt for each audience', async () => {
        await runAssistantReport();

        const prompts = runChatTurn.mock.calls.map((call) => call[0].history[0].content as string);
        expect(prompts[0]).toContain('US stocks');
        expect(prompts[1]).toContain('crypto');
    });

    it('only sends to the configured audience', async () => {
        configValues.REPORT_MARKET = 'crypto';

        const result = await runAssistantReport();

        expect(result.sent).toEqual({ stocks: false, crypto: true });
        expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
        expect(sendTelegramMessage.mock.calls[0][1].audience).toBe('crypto');
    });

    it('rejects an unknown audience rather than sending nothing quietly', async () => {
        configValues.REPORT_MARKET = 'bonds';

        const result = await runAssistantReport();

        expect(result.ok).toBe(false);
        expect(result.error).toContain('bonds');
        expect(sendTelegramMessage).not.toHaveBeenCalled();
    });

    it('clips a runaway briefing to the configured cap', async () => {
        configValues.REPORT_MAX_CHARS = '500';
        runChatTurn.mockResolvedValue(turn('x'.repeat(5_000)));

        const result = await runAssistantReport();

        expect(result.characters.stocks).toBe(500);
        const message = sendTelegramMessage.mock.calls[0][0] as string;
        expect(message).toContain('…');
        expect(message).not.toContain('x'.repeat(501));
    });

    it('escapes model prose so Telegram accepts the message', async () => {
        runChatTurn.mockResolvedValue(turn('AT&T is up, and <b>this is not markup</b>'));

        await runAssistantReport();

        const message = sendTelegramMessage.mock.calls[0][0] as string;
        expect(message).toContain('AT&amp;T');
        expect(message).toContain('&lt;b&gt;this is not markup&lt;/b&gt;');
    });

    it('keeps going when one audience fails', async () => {
        sendTelegramMessage
            .mockResolvedValueOnce({ ok: false, error: 'chat not found' })
            .mockResolvedValueOnce({ ok: true, messageId: 2 });

        const result = await runAssistantReport();

        expect(result.ok).toBe(true);
        expect(result.sent).toEqual({ stocks: false, crypto: true });
        expect(result.error).toContain('chat not found');
    });

    it('does not send an empty briefing', async () => {
        runChatTurn.mockResolvedValue(turn('   '));

        const result = await runAssistantReport();

        expect(result.ok).toBe(false);
        expect(result.error).toContain('returned nothing');
        expect(sendTelegramMessage).not.toHaveBeenCalled();
    });

    it('surfaces a provider failure instead of throwing', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        runChatTurn.mockRejectedValue(new Error('GEMINI_API_KEY is not set'));

        const result = await runAssistantReport();

        expect(result.ok).toBe(false);
        expect(result.error).toContain('GEMINI_API_KEY');
        expect(result.sent).toEqual({ stocks: false, crypto: false });
    });
});

describe('buildReportPrompt', () => {
    it('substitutes the market and date placeholders', () => {
        expect(buildReportPrompt('{market} on {date}', 'crypto', '2026-09-20')).toBe(
            'crypto on 2026-09-20'
        );
    });

    it('falls back to the shipped default when the setting is blank', () => {
        expect(buildReportPrompt('', 'stocks', '2026-09-20')).toBe(
            'DEFAULT PROMPT for US stocks on 2026-09-20'
        );
    });
});

describe('renderReportMessage', () => {
    it('wraps the body with a header, the date and a standing disclaimer', () => {
        const message = renderReportMessage('Trend is up & breadth is thin', '2026-09-20');

        expect(message).toContain('OpenStock — AI briefing');
        expect(message).toContain('2026-09-20');
        expect(message).toContain('Trend is up &amp; breadth is thin');
        expect(message).toContain('Not investment advice');
    });
});
