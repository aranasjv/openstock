import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The assistant's tool loop and its guardrails.
 *
 * The behaviour that matters:
 *   - the system prompt forbids stating market figures from memory and forbids advice;
 *   - a tool call is executed, its result fed back, and the loop continues to an answer;
 *   - every failure mode (unknown tool, malformed arguments, a throwing tool) becomes
 *     information for the model rather than a dead turn;
 *   - the loop is bounded, so a confused model cannot bill indefinitely.
 *
 * The provider and the tool registry are both stubbed, so this exercises the real loop.
 */

const callAIProviderWithTools = vi.fn();
const getTool = vi.fn();
const getToolSpecs = vi.fn();

vi.mock('@/lib/ai-provider', () => ({
    callAIProviderWithTools: (...args: unknown[]) => callAIProviderWithTools(...args),
}));

vi.mock('@/lib/ai-tools', () => ({
    getTool: (name: string) => getTool(name),
    getToolSpecs: () => getToolSpecs(),
}));

let configValues: Record<string, string> = {};
vi.mock('@/lib/config', () => ({
    loadConfig: async () => configValues,
}));

import { runChatTurn, buildAssistantSystemPrompt } from '@/lib/ai-chat';

let echoExecute: ReturnType<typeof vi.fn>;
let echoTool: { spec: Record<string, unknown>; execute: typeof echoExecute };

beforeEach(() => {
    callAIProviderWithTools.mockReset();
    getTool.mockReset();
    getToolSpecs.mockReset();

    configValues = { AI_PROVIDER: 'deepseek', SCREENER_STRATEGY: 'trend-following' };

    echoExecute = vi.fn(async (args: Record<string, unknown>) => ({ echoed: args.value }));
    echoTool = {
        spec: {
            name: 'echo',
            description: 'Echo a value back to the caller.',
            parameters: { type: 'object', properties: {} },
        },
        execute: echoExecute,
    };

    getToolSpecs.mockReturnValue([echoTool.spec]);
    getTool.mockImplementation((name: string) => (name === 'echo' ? echoTool : undefined));
});

describe('runChatTurn', () => {
    it('returns the model answer directly when no tools are requested', async () => {
        callAIProviderWithTools.mockResolvedValue({ content: 'Nothing is flagged today.' });

        const result = await runChatTurn({ history: [{ role: 'user', content: 'anything good?' }], userId: 'u1' });

        expect(result.content).toBe('Nothing is flagged today.');
        expect(result.iterations).toBe(1);
        expect(result.toolTrace).toEqual([]);
        expect(result.provider).toBe('deepseek');

        const [sentMessages] = callAIProviderWithTools.mock.calls[0];
        expect(sentMessages[0].role).toBe('system');
        expect(sentMessages[0].content).toContain('NEVER state a price');
        expect(sentMessages.at(-1)).toEqual({ role: 'user', content: 'anything good?' });
    });

    it('executes a requested tool, feeds the result back, and answers on the next round', async () => {
        callAIProviderWithTools
            .mockResolvedValueOnce({
                content: '',
                toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"value":"hi"}' }],
            })
            .mockResolvedValueOnce({ content: 'done' });

        const result = await runChatTurn({ history: [{ role: 'user', content: 'q' }], userId: 'u1' });

        expect(result.content).toBe('done');
        expect(result.iterations).toBe(2);
        expect(result.toolTrace).toHaveLength(1);
        expect(result.toolTrace[0]).toMatchObject({ name: 'echo', ok: true });
        expect(echoExecute).toHaveBeenCalledWith({ value: 'hi' }, { userId: 'u1' });

        const secondMessages = callAIProviderWithTools.mock.calls[1][0];
        const toolResult = secondMessages.find((m: { role: string }) => m.role === 'tool');
        expect(toolResult).toMatchObject({ toolCallId: 'c1', name: 'echo' });
        expect(JSON.parse(toolResult.content)).toEqual({ echoed: 'hi' });
    });

    it('tells the model when it called a tool that does not exist', async () => {
        callAIProviderWithTools
            .mockResolvedValueOnce({
                content: '',
                toolCalls: [{ id: 'c1', name: 'launch_missiles', arguments: '{}' }],
            })
            .mockResolvedValueOnce({ content: 'apologies' });

        const result = await runChatTurn({ history: [{ role: 'user', content: 'q' }], userId: 'u' });

        expect(result.toolTrace[0]).toMatchObject({
            name: 'launch_missiles',
            ok: false,
            summary: 'unknown tool',
        });

        const toolMessage = callAIProviderWithTools.mock.calls[1][0].find(
            (m: { role: string }) => m.role === 'tool'
        );
        expect(toolMessage.content).toContain('Unknown tool');
    });

    it('hands a malformed argument string back as a tool error', async () => {
        callAIProviderWithTools
            .mockResolvedValueOnce({
                content: '',
                toolCalls: [{ id: 'c1', name: 'echo', arguments: '{not json' }],
            })
            .mockResolvedValueOnce({ content: 'ok' });

        const result = await runChatTurn({ history: [{ role: 'user', content: 'q' }], userId: 'u' });

        expect(result.toolTrace[0]).toMatchObject({ name: 'echo', ok: false, summary: 'invalid JSON arguments' });
        expect(echoExecute).not.toHaveBeenCalled();
    });

    it('keeps the turn alive when a tool throws and reports the failure to the model', async () => {
        echoExecute.mockRejectedValueOnce(new Error('upstream unavailable'));
        callAIProviderWithTools
            .mockResolvedValueOnce({
                content: '',
                toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }],
            })
            .mockResolvedValueOnce({ content: 'I could not fetch that.' });

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const result = await runChatTurn({ history: [{ role: 'user', content: 'q' }], userId: 'u' });
        consoleSpy.mockRestore();

        expect(result.content).toBe('I could not fetch that.');
        expect(result.toolTrace[0]).toMatchObject({ ok: false, summary: 'upstream unavailable' });

        const toolMessage = callAIProviderWithTools.mock.calls[1][0].find(
            (m: { role: string }) => m.role === 'tool'
        );
        expect(JSON.parse(toolMessage.content)).toEqual({ error: 'upstream unavailable' });
    });

    it('stops after the iteration cap rather than looping forever', async () => {
        callAIProviderWithTools.mockResolvedValue({
            content: '',
            toolCalls: [{ id: 'c1', name: 'echo', arguments: '{}' }],
        });

        const result = await runChatTurn({ history: [{ role: 'user', content: 'q' }], userId: 'u' });

        expect(result.iterations).toBe(6);
        expect(callAIProviderWithTools).toHaveBeenCalledTimes(6);
        expect(result.content).toContain('stopped after 6 rounds');
    });

    it('substitutes a message for an empty model response', async () => {
        callAIProviderWithTools.mockResolvedValue({ content: '   ' });

        const result = await runChatTurn({ history: [{ role: 'user', content: 'q' }], userId: 'u' });

        expect(result.content).toBe('The model returned an empty response.');
    });

    it('honours an explicit provider override', async () => {
        callAIProviderWithTools.mockResolvedValue({ content: 'x' });

        const result = await runChatTurn({ history: [], userId: 'u', provider: 'gemini' });

        expect(result.provider).toBe('gemini');
        expect(callAIProviderWithTools.mock.calls[0][2]).toBe('gemini');
    });
});

describe('buildAssistantSystemPrompt', () => {
    const prompt = buildAssistantSystemPrompt({ date: '2026-01-01', defaultStrategy: 'trend-following' });

    it('forbids stating figures from memory', () => {
        expect(prompt).toContain('NEVER state a price');
        expect(prompt).toMatch(/Call a tool/);
    });

    it('forbids investment advice', () => {
        expect(prompt).toMatch(/must NOT give investment advice/i);
    });

    it('carries the current date and default strategy', () => {
        expect(prompt).toContain('2026-01-01');
        expect(prompt).toContain('trend-following');
    });

    it('defers to the deterministic screener ranking', () => {
        expect(prompt).toMatch(/do not re-rank/);
    });
});
