import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    callAIProviderWithTools,
    type AIChatMessage,
    type AIToolSpec,
} from '@/lib/ai-provider';

/**
 * The two provider dialects the assistant must speak.
 *
 * OpenAI-compatible providers (DeepSeek, MiniMax, Siray) use `tool_calls` plus `role: 'tool'`
 * messages. Gemini uses `functionDeclarations` and `functionCall` / `functionResponse` parts.
 * Everything above this layer speaks only the normalized types, so a mistake in either
 * mapping is invisible until a real conversation fails — which is exactly what these tests
 * pin down.
 */

let configValues: Record<string, string> = {};

vi.mock('@/lib/config', () => ({
    loadConfig: async () => configValues,
}));

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
    return {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        statusText: init.statusText ?? 'OK',
        json: async () => data,
    };
}

const tools: AIToolSpec[] = [
    {
        name: 'get_stock_quote',
        description: 'Current price and daily change for a stock ticker.',
        parameters: {
            type: 'object',
            properties: { symbol: { type: 'string' } },
            required: ['symbol'],
        },
    },
];

/** A full exchange: system, user, an assistant tool request, then the tool result. */
const messages: AIChatMessage[] = [
    { role: 'system', content: 'You must never state a price from memory.' },
    { role: 'user', content: 'What is Apple trading at?' },
    {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_0', name: 'get_stock_quote', arguments: '{"symbol":"AAPL"}' }],
    },
    { role: 'tool', toolCallId: 'call_0', name: 'get_stock_quote', content: '{"price":200}' },
];

describe('callAIProviderWithTools — OpenAI-compatible dialect', () => {
    beforeEach(() => {
        configValues = {
            DEEPSEEK_API_KEY: 'test-key',
            DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
            DEEPSEEK_MODEL: 'deepseek-flash',
        };
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('sends the tool specs and maps each message shape', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse({
                choices: [
                    {
                        message: {
                            content: 'Apple is at 200.',
                            tool_calls: [
                                {
                                    id: 'call_1',
                                    function: { name: 'get_stock_quote', arguments: '{"symbol":"AAPL"}' },
                                },
                            ],
                        },
                    },
                ],
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        const result = await callAIProviderWithTools(messages, tools, 'deepseek', { temperature: 0.3 });

        expect(result.content).toBe('Apple is at 200.');
        expect(result.toolCalls).toEqual([
            { id: 'call_1', name: 'get_stock_quote', arguments: '{"symbol":"AAPL"}' },
        ]);

        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.deepseek.com/chat/completions');
        expect(options.headers.Authorization).toBe('Bearer test-key');

        const body = JSON.parse(options.body);
        expect(body.tool_choice).toBe('auto');
        expect(body.temperature).toBe(0.3);
        expect(body.tools).toEqual([
            {
                type: 'function',
                function: {
                    name: 'get_stock_quote',
                    description: tools[0].description,
                    parameters: tools[0].parameters,
                },
            },
        ]);

        // A tool-requesting assistant turn must carry null content, not "".
        expect(body.messages[2]).toEqual({
            role: 'assistant',
            content: null,
            tool_calls: [
                {
                    id: 'call_0',
                    type: 'function',
                    function: { name: 'get_stock_quote', arguments: '{"symbol":"AAPL"}' },
                },
            ],
        });
        // The result is linked back to its request by id.
        expect(body.messages[3]).toEqual({
            role: 'tool',
            tool_call_id: 'call_0',
            content: '{"price":200}',
        });
    });

    it('returns undefined toolCalls when the model answers directly', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'hello' } }] }))
        );

        const result = await callAIProviderWithTools(messages, tools, 'deepseek');

        expect(result.content).toBe('hello');
        expect(result.toolCalls).toBeUndefined();
    });

    it('synthesizes an id when the provider omits one', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                jsonResponse({
                    choices: [
                        {
                            message: {
                                tool_calls: [{ function: { name: 'get_stock_quote', arguments: '{}' } }],
                            },
                        },
                    ],
                })
            )
        );

        const result = await callAIProviderWithTools(messages, tools, 'deepseek');
        expect(result.toolCalls).toEqual([{ id: 'call_0', name: 'get_stock_quote', arguments: '{}' }]);
    });

    it('throws a clear error when the key is missing', async () => {
        configValues = { DEEPSEEK_API_KEY: '' };
        await expect(callAIProviderWithTools(messages, tools, 'deepseek')).rejects.toThrow(
            'DEEPSEEK_API_KEY is not set'
        );
    });

    it('surfaces a non-2xx response as an error', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 429, statusText: 'Too Many Requests' }))
        );

        await expect(callAIProviderWithTools(messages, tools, 'deepseek')).rejects.toThrow(
            'deepseek API error: 429'
        );
    });
});

describe('callAIProviderWithTools — Gemini dialect', () => {
    beforeEach(() => {
        configValues = {
            GEMINI_API_KEY: 'gemini-key',
            GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models',
            GEMINI_MODEL: 'gemini-2.5-flash-lite',
        };
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('sends functionDeclarations, lifts the system prompt, and maps the parts', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse({
                candidates: [
                    {
                        content: {
                            parts: [
                                { text: 'Apple is at 200.' },
                                { functionCall: { name: 'get_stock_quote', args: { symbol: 'AAPL' } } },
                            ],
                        },
                    },
                ],
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        const result = await callAIProviderWithTools(messages, tools, 'gemini', { temperature: 0.3 });

        expect(result.content).toBe('Apple is at 200.');
        // Gemini supplies no ids, so a stable one is synthesized from the part index.
        expect(result.toolCalls).toEqual([
            { id: 'gemini_call_1', name: 'get_stock_quote', arguments: '{"symbol":"AAPL"}' },
        ]);

        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toContain('gemini-2.5-flash-lite:generateContent');
        expect(url).toContain('key=gemini-key');

        const body = JSON.parse(options.body);
        expect(body.systemInstruction).toEqual({
            parts: [{ text: 'You must never state a price from memory.' }],
        });
        expect(body.generationConfig).toEqual({ temperature: 0.3 });
        expect(body.tools[0].functionDeclarations[0].name).toBe('get_stock_quote');

        // Gemini has no system role in `contents`; the assistant is `model`.
        expect(body.contents[0]).toEqual({ role: 'user', parts: [{ text: 'What is Apple trading at?' }] });
        expect(body.contents[1]).toEqual({
            role: 'model',
            parts: [{ functionCall: { name: 'get_stock_quote', args: { symbol: 'AAPL' } } }],
        });
        // Tool results come back as a user turn with a functionResponse part.
        expect(body.contents[2]).toEqual({
            role: 'user',
            parts: [
                {
                    functionResponse: {
                        name: 'get_stock_quote',
                        response: { result: '{"price":200}' },
                    },
                },
            ],
        });
    });

    it('omits the system instruction when no system message is present', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [] } }] }));
        vi.stubGlobal('fetch', fetchMock);

        await callAIProviderWithTools([{ role: 'user', content: 'hi' }], tools, 'gemini');

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.systemInstruction).toBeUndefined();
        expect(body.contents).toHaveLength(1);
    });

    it('does not let malformed tool arguments break the request', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [] } }] }));
        vi.stubGlobal('fetch', fetchMock);

        await callAIProviderWithTools(
            [
                {
                    role: 'assistant',
                    content: '',
                    toolCalls: [{ id: 'x', name: 'get_stock_quote', arguments: '{not json' }],
                },
            ],
            tools,
            'gemini'
        );

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.contents[0].parts[0]).toEqual({
            functionCall: { name: 'get_stock_quote', args: {} },
        });
    });

    it('throws when the key is missing', async () => {
        configValues = { GEMINI_API_KEY: '' };
        await expect(callAIProviderWithTools(messages, tools, 'gemini')).rejects.toThrow(
            'GEMINI_API_KEY is not set'
        );
    });
});
