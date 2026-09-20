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

const listAnalysisSkills = vi.fn();

vi.mock('@/lib/analysis-skills', () => ({
    listAnalysisSkills: () => listAnalysisSkills(),
    // Mirrors lib/analysis-skills.ts; that value is asserted against every vendored playbook
    // by analysis-skills.test.ts.
    MAX_PLAYBOOK_CHARS: 32_000,
}));

let configValues: Record<string, string> = {};
vi.mock('@/lib/config', () => ({
    loadConfig: async () => configValues,
}));

import { runChatTurn, buildAssistantSystemPrompt } from '@/lib/ai-chat';

let echoExecute: ReturnType<typeof vi.fn>;
let echoTool: { spec: Record<string, unknown>; execute: typeof echoExecute };
let playbookExecute: ReturnType<typeof vi.fn>;
let playbookTool: { spec: Record<string, unknown>; execute: typeof playbookExecute };

beforeEach(() => {
    callAIProviderWithTools.mockReset();
    getTool.mockReset();
    getToolSpecs.mockReset();
    listAnalysisSkills.mockReset();

    configValues = { AI_PROVIDER: 'deepseek', SCREENER_STRATEGY: 'trend-following' };
    listAnalysisSkills.mockResolvedValue([]);

    echoExecute = vi.fn(async (args: Record<string, unknown>) => ({ echoed: args.value }));
    echoTool = {
        spec: {
            name: 'echo',
            description: 'Echo a value back to the caller.',
            parameters: { type: 'object', properties: {} },
        },
        execute: echoExecute,
    };

    playbookExecute = vi.fn(async () => ({ playbook: 'x'.repeat(10_000) + 'END-OF-PLAYBOOK' }));
    playbookTool = {
        spec: {
            name: 'get_analysis_playbook',
            description: 'Load a playbook.',
            parameters: { type: 'object', properties: {} },
        },
        execute: playbookExecute,
    };

    getToolSpecs.mockReturnValue([echoTool.spec, playbookTool.spec]);
    getTool.mockImplementation((name: string) => {
        if (name === 'echo') return echoTool;
        if (name === 'get_analysis_playbook') return playbookTool;
        return undefined;
    });
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

describe('analysis playbook wiring', () => {
    it('lists the vendored playbooks in the system prompt', async () => {
        listAnalysisSkills.mockResolvedValue([
            {
                id: 'position-sizer',
                name: 'position-sizer',
                description: 'Risk-based position sizing for long trades.',
                references: [],
                hasScripts: false,
            },
        ]);
        callAIProviderWithTools.mockResolvedValue({ content: 'ok' });

        await runChatTurn({ history: [{ role: 'user', content: 'size this' }], userId: 'u' });

        const [messages] = callAIProviderWithTools.mock.calls[0];
        const system = messages[0].content as string;
        expect(system).toContain('ANALYSIS PLAYBOOKS');
        expect(system).toContain('- position-sizer: Risk-based position sizing');
        // The model must be told which tool to call to pull one.
        expect(system).toContain('get_analysis_playbook');
    });

    it('routes the question to a playbook by intent, not by keyword', async () => {
        listAnalysisSkills.mockResolvedValue([
            {
                id: 'position-sizer',
                name: 'position-sizer',
                description: 'Risk-based position sizing for long trades.',
                references: [],
                hasScripts: false,
            },
            {
                id: 'frontend-design',
                name: 'frontend-design',
                description: 'Interface design.',
                references: [],
                hasScripts: false,
            },
        ]);
        callAIProviderWithTools.mockResolvedValue({ content: 'ok' });

        await runChatTurn({ history: [{ role: 'user', content: 'size this' }], userId: 'u' });

        const [messages] = callAIProviderWithTools.mock.calls[0];
        const system = messages[0].content as string;

        // "Sizing a position" is the route, so the model does not have to infer which playbook suits
        // the question from a 180-character description — which is the failure the routing prevents.
        expect(system).toContain('Sizing a position');
        expect(system).toContain('position-sizer');

        // And the three vendored for coding agents are named as out of scope rather than left sitting
        // in the catalogue for a market question to trip over.
        expect(system).toContain('coding agents');
        expect(system).toContain('frontend-design');
    });

    it('omits the playbook section when none are installed', () => {
        const prompt = buildAssistantSystemPrompt({ date: '2026-01-01', defaultStrategy: 'trend-following' });
        expect(prompt).not.toContain('ANALYSIS PLAYBOOKS');
    });

    it('trims an over-long playbook description', () => {
        const prompt = buildAssistantSystemPrompt({
            date: '2026-01-01',
            defaultStrategy: 'trend-following',
            playbooks: [{ id: 'big', description: 'y'.repeat(500) }],
        });
        expect(prompt).toContain('- big: y');
        expect(prompt).not.toContain('y'.repeat(500));
    });

    it('does not truncate a playbook result the way it truncates data', async () => {
        callAIProviderWithTools
            .mockResolvedValueOnce({
                content: '',
                toolCalls: [{ id: 'p1', name: 'get_analysis_playbook', arguments: '{}' }],
            })
            .mockResolvedValueOnce({ content: 'done' });

        await runChatTurn({ history: [{ role: 'user', content: 'q' }], userId: 'u' });

        const toolMessage = callAIProviderWithTools.mock.calls[1][0].find(
            (m: { role: string }) => m.role === 'tool'
        );
        // The playbook gets the larger budget, so the tail of a 10k body survives.
        expect(toolMessage.content).toContain('END-OF-PLAYBOOK');
    });

    it('still caps an ordinary tool result at the data budget', async () => {
        echoExecute.mockResolvedValueOnce({ big: 'z'.repeat(10_000) + 'END-OF-ECHO' });
        callAIProviderWithTools
            .mockResolvedValueOnce({
                content: '',
                toolCalls: [{ id: 'e1', name: 'echo', arguments: '{}' }],
            })
            .mockResolvedValueOnce({ content: 'done' });

        await runChatTurn({ history: [{ role: 'user', content: 'q' }], userId: 'u' });

        const toolMessage = callAIProviderWithTools.mock.calls[1][0].find(
            (m: { role: string }) => m.role === 'tool'
        );
        expect(toolMessage.content).toContain('truncated');
        expect(toolMessage.content).not.toContain('END-OF-ECHO');
    });
});
