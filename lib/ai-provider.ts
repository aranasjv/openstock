import 'server-only';

import { loadConfig } from '@/lib/config';

/**
 * AI provider abstraction for OpenStock.
 *
 * Provider, key, base URL and model all come from the runtime config layer (see
 * lib/config.ts), so they can be changed from /settings without a rebuild. Values fall
 * back to environment variables and then to the defaults declared in the config schema.
 *
 * Supported providers:
 *   - "gemini"   (default) – Google Gemini REST API
 *   - "deepseek" – DeepSeek (OpenAI-compatible)
 *   - "minimax"  – MiniMax (OpenAI-compatible)
 *   - "siray"    – Siray.ai (OpenAI-compatible)
 *
 * Each provider returns a plain-text string from the model.
 */

export type AIProviderName = 'gemini' | 'deepseek' | 'minimax' | 'siray';

export const AI_PROVIDER_NAMES: AIProviderName[] = ['gemini', 'deepseek', 'minimax', 'siray'];

export interface AIProviderConfig {
    name: AIProviderName;
    apiKey: string;
    baseUrl: string;
    model: string;
}

export interface AIRequestOptions {
    /** Instructions that shape how the model responds (persona, rules, format). */
    system?: string;
    temperature?: number;
}

/**
 * Resolve the provider configuration from the runtime config layer.
 */
export async function getProviderConfig(provider?: AIProviderName): Promise<AIProviderConfig> {
    const config = await loadConfig();

    const name = (provider || (config.AI_PROVIDER as AIProviderName) || 'gemini') as AIProviderName;

    switch (name) {
        case 'deepseek':
            return {
                name: 'deepseek',
                apiKey: config.DEEPSEEK_API_KEY || '',
                baseUrl: config.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
                model: config.DEEPSEEK_MODEL || 'deepseek-flash',
            };

        case 'minimax':
            return {
                name: 'minimax',
                apiKey: config.MINIMAX_API_KEY || '',
                baseUrl: config.MINIMAX_BASE_URL || 'https://api.minimax.io/v1',
                model: config.MINIMAX_MODEL || 'MiniMax-M3',
            };

        case 'siray':
            return {
                name: 'siray',
                apiKey: config.SIRAY_API_KEY || '',
                baseUrl: config.SIRAY_BASE_URL || 'https://api.siray.ai/v1',
                model: config.SIRAY_MODEL || 'siray-1.0-ultra',
            };

        case 'gemini':
        default:
            return {
                name: 'gemini',
                apiKey: config.GEMINI_API_KEY || '',
                baseUrl: config.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/models',
                model: config.GEMINI_MODEL || 'gemini-2.5-flash-lite',
            };
    }
}

/**
 * Pick a fallback provider for the given primary.
 *
 * Mirrors the original contract: a Gemini primary falls back to any other provider that
 * has a key (DeepSeek preferred, then MiniMax, then Siray); any other primary falls back
 * to Gemini.
 */
export async function getFallbackProviderName(primary: AIProviderName): Promise<AIProviderName> {
    const config = await loadConfig();
    const hasKey = (name: AIProviderName): boolean => {
        switch (name) {
            case 'gemini': return Boolean(config.GEMINI_API_KEY);
            case 'deepseek': return Boolean(config.DEEPSEEK_API_KEY);
            case 'minimax': return Boolean(config.MINIMAX_API_KEY);
            case 'siray': return Boolean(config.SIRAY_API_KEY);
        }
    };

    if (primary === 'gemini') {
        const candidate = (['deepseek', 'minimax', 'siray'] as AIProviderName[]).find(hasKey);
        // With no other key configured, name one anyway so the caller surfaces a clear
        // missing-key error rather than silently doing nothing.
        return candidate ?? 'minimax';
    }

    return 'gemini';
}

// ── Provider call implementations ──────────────────────────────────

async function callGemini(
    prompt: string,
    config: AIProviderConfig,
    options?: AIRequestOptions
): Promise<string> {
    if (!config.apiKey) throw new Error('GEMINI_API_KEY is not set');

    const url = `${config.baseUrl}/${config.model}:generateContent?key=${config.apiKey}`;

    const body: Record<string, unknown> = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
    };

    if (options?.system) {
        body.systemInstruction = { parts: [{ text: options.system }] };
    }

    if (typeof options?.temperature === 'number') {
        body.generationConfig = { temperature: options.temperature };
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        throw new Error(`Gemini API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned empty response');
    return text;
}

/**
 * DeepSeek, MiniMax and Siray all speak the OpenAI chat-completions dialect, so they
 * share this implementation.
 */
async function callOpenAICompatible(
    prompt: string,
    config: AIProviderConfig,
    options?: AIRequestOptions
): Promise<string> {
    if (!config.apiKey) {
        throw new Error(`${config.name.toUpperCase()}_API_KEY is not set`);
    }

    const url = `${config.baseUrl}/chat/completions`;

    const messages: { role: 'system' | 'user'; content: string }[] = [];
    if (options?.system) {
        messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: prompt });

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.model,
            messages,
            temperature: options?.temperature ?? 0.7,
        }),
    });

    if (!res.ok) {
        throw new Error(`${config.name} API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
        throw new Error(`${config.name} returned empty response`);
    }
    return text;
}

// ── Tool calling ───────────────────────────────────────────────────
//
// A normalized interface over two dialects. The OpenAI-compatible shape (DeepSeek,
// MiniMax, Siray) uses `tool_calls` plus `role: 'tool'` messages; Gemini uses
// `functionDeclarations` and `functionCall` / `functionResponse` parts. Everything above
// this layer speaks only the normalized types below.

export interface AIToolCall {
    id: string;
    name: string;
    /** Raw JSON string as returned by the model — parsed by the caller, not here. */
    arguments: string;
}

export interface AIToolSpec {
    name: string;
    description: string;
    /** JSON Schema for the arguments. */
    parameters: Record<string, unknown>;
}

export interface AIChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    /** Set on an assistant turn that requested tools. */
    toolCalls?: AIToolCall[];
    /** Set on a tool result, linking it back to the request. */
    toolCallId?: string;
    /** Tool name, needed by Gemini's functionResponse. */
    name?: string;
}

export interface AICompletion {
    content?: string;
    toolCalls?: AIToolCall[];
}

function toOpenAIMessages(messages: AIChatMessage[]): Record<string, unknown>[] {
    return messages.map((message) => {
        if (message.role === 'assistant' && message.toolCalls?.length) {
            return {
                role: 'assistant',
                // OpenAI expects null rather than "" when the turn is purely tool calls.
                content: message.content || null,
                tool_calls: message.toolCalls.map((call) => ({
                    id: call.id,
                    type: 'function',
                    function: { name: call.name, arguments: call.arguments },
                })),
            };
        }

        if (message.role === 'tool') {
            return {
                role: 'tool',
                tool_call_id: message.toolCallId,
                content: message.content,
            };
        }

        return { role: message.role, content: message.content };
    });
}

async function callOpenAICompatibleWithTools(
    messages: AIChatMessage[],
    tools: AIToolSpec[],
    config: AIProviderConfig,
    options?: AIRequestOptions
): Promise<AICompletion> {
    if (!config.apiKey) {
        throw new Error(`${config.name.toUpperCase()}_API_KEY is not set`);
    }

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.model,
            messages: toOpenAIMessages(messages),
            temperature: options?.temperature ?? 0.7,
            tools: tools.map((tool) => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                },
            })),
            tool_choice: 'auto',
        }),
    });

    if (!res.ok) {
        throw new Error(`${config.name} API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const message = data?.choices?.[0]?.message;
    if (!message) throw new Error(`${config.name} returned no message`);

    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    return {
        content: typeof message.content === 'string' ? message.content : undefined,
        toolCalls: rawCalls.length
            ? rawCalls.map((call: { id?: string; function?: { name?: string; arguments?: string } }, index: number) => ({
                  id: call.id ?? `call_${index}`,
                  name: call.function?.name ?? '',
                  arguments: call.function?.arguments ?? '{}',
              }))
            : undefined,
    };
}

function toGeminiContents(messages: AIChatMessage[]): { role: string; parts: unknown[] }[] {
    return messages
        .filter((message) => message.role !== 'system')
        .map((message) => {
            if (message.role === 'assistant' && message.toolCalls?.length) {
                const parts: unknown[] = [];
                if (message.content) parts.push({ text: message.content });
                for (const call of message.toolCalls) {
                    let args: unknown = {};
                    try {
                        args = JSON.parse(call.arguments || '{}');
                    } catch {
                        // A malformed argument string must not break the whole turn; send an
                        // empty object and let the tool report the validation failure.
                        args = {};
                    }
                    parts.push({ functionCall: { name: call.name, args } });
                }
                return { role: 'model', parts };
            }

            if (message.role === 'tool') {
                // Gemini has no tool_call_id; results are matched by function name.
                return {
                    role: 'user',
                    parts: [
                        {
                            functionResponse: {
                                name: message.name ?? 'unknown',
                                response: { result: message.content },
                            },
                        },
                    ],
                };
            }

            return { role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] };
        });
}

async function callGeminiWithTools(
    messages: AIChatMessage[],
    tools: AIToolSpec[],
    config: AIProviderConfig,
    options?: AIRequestOptions
): Promise<AICompletion> {
    if (!config.apiKey) throw new Error('GEMINI_API_KEY is not set');

    const system = messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n');

    const body: Record<string, unknown> = {
        contents: toGeminiContents(messages),
        tools: [
            {
                functionDeclarations: tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                })),
            },
        ],
    };

    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (typeof options?.temperature === 'number') {
        body.generationConfig = { temperature: options.temperature };
    }

    const res = await fetch(`${config.baseUrl}/${config.model}:generateContent?key=${config.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        throw new Error(`Gemini API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const parts: { text?: string; functionCall?: { name?: string; args?: unknown } }[] =
        data?.candidates?.[0]?.content?.parts ?? [];

    let text = '';
    const toolCalls: AIToolCall[] = [];

    parts.forEach((part, index) => {
        if (typeof part.text === 'string') text += part.text;
        if (part.functionCall?.name) {
            toolCalls.push({
                // Gemini does not supply ids, so synthesize one that is stable within a turn.
                id: `gemini_call_${index}`,
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args ?? {}),
            });
        }
    });

    return {
        content: text || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
    };
}

/**
 * Call the provider with tools available. The caller drives the loop; this only performs
 * one exchange and normalizes the result.
 */
export async function callAIProviderWithTools(
    messages: AIChatMessage[],
    tools: AIToolSpec[],
    provider?: AIProviderName,
    options?: AIRequestOptions
): Promise<AICompletion> {
    const config = await getProviderConfig(provider);

    if (config.name === 'gemini') {
        return callGeminiWithTools(messages, tools, config, options);
    }

    return callOpenAICompatibleWithTools(messages, tools, config, options);
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Call the configured (or specified) AI provider and return the model response as a
 * plain string.
 */
export async function callAIProvider(
    prompt: string,
    provider?: AIProviderName,
    options?: AIRequestOptions
): Promise<string> {
    const config = await getProviderConfig(provider);

    if (config.name === 'gemini') {
        return callGemini(prompt, config, options);
    }
    // DeepSeek, MiniMax and Siray all use OpenAI-compatible endpoints
    return callOpenAICompatible(prompt, config, options);
}

/**
 * Call the AI provider with automatic fallback.
 * Tries the primary provider first; on failure switches to the fallback.
 */
export async function callAIProviderWithFallback(
    prompt: string,
    options?: AIRequestOptions
): Promise<string> {
    const config = await loadConfig();
    const primaryName = ((config.AI_PROVIDER as AIProviderName) || 'gemini') as AIProviderName;
    const fallbackName = await getFallbackProviderName(primaryName);

    try {
        return await callAIProvider(prompt, primaryName, options);
    } catch (primaryError) {
        console.error(`⚠️ ${primaryName} failed, switching to ${fallbackName} fallback`, primaryError);
        return await callAIProvider(prompt, fallbackName, options);
    }
}
