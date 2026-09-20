import 'server-only';

import {
    callAIProviderWithTools,
    type AIChatMessage,
    type AIProviderName,
    type AIToolCall,
} from '@/lib/ai-provider';
import { getTool, getToolSpecs, type AIToolContext } from '@/lib/ai-tools';
import { listAnalysisSkills, MAX_PLAYBOOK_CHARS } from '@/lib/analysis-skills';
import { loadConfig } from '@/lib/config';

/**
 * The assistant's tool-calling loop.
 *
 * The central problem this exists to solve: a language model will state a price from its
 * training data with complete confidence. For a market application that is worse than
 * having no answer at all. So the system prompt forbids stating any figure from memory, and
 * the model must call a tool and cite what came back.
 *
 * Also bounded and auditable:
 *   - at most MAX_ITERATIONS provider calls per turn, so a confused model cannot bill
 *     indefinitely;
 *   - every tool call is individually timed out and its failure is returned to the model as
 *     text, so it can adapt instead of the whole turn collapsing;
 *   - the trace of calls is returned to the caller and shown in the UI, so a claim can be
 *     checked against the data that produced it.
 */

/** Without a cap, a model that keeps calling tools can spend without limit. */
const MAX_ITERATIONS = 6;

/** A single tool must not be able to hang the turn. */
const TOOL_TIMEOUT_MS = 20_000;

/** Tool output is fed back into the model's context, so it is truncated rather than unbounded. */
const MAX_TOOL_RESULT_CHARS = 6_000;

/**
 * Analysis playbooks are read whole — a methodology cut off mid-way is worse than useless —
 * so the vendored skills get a larger budget than ordinary data results. The size lives with
 * the loader (`MAX_PLAYBOOK_CHARS`) and is asserted against every vendored playbook by the
 * test suite, so this cannot silently start clipping one.
 */
const PLAYBOOK_TOOL = 'get_analysis_playbook';

/** How much of each playbook description goes into the system prompt. */
const PLAYBOOK_DESCRIPTION_CHARS = 180;

export interface ToolTraceEntry {
    name: string;
    arguments: string;
    ok: boolean;
    /** Short human-readable summary of what came back, for the UI. */
    summary: string;
    durationMs: number;
}

export interface ChatTurnResult {
    content: string;
    toolTrace: ToolTraceEntry[];
    iterations: number;
    provider: AIProviderName;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

function summarise(result: unknown): string {
    if (result === null || result === undefined) return 'no data';
    if (Array.isArray(result)) return `${result.length} item(s)`;

    if (typeof result === 'object') {
        const record = result as Record<string, unknown>;
        // Prefer the most informative count-like field present.
        for (const key of ['count', 'bars', 'scanned']) {
            if (typeof record[key] === 'number') return `${key}=${record[key]}`;
        }
        if (Array.isArray(record.coins)) return `${record.coins.length} coin(s)`;
        if (Array.isArray(record.candidates)) return `${record.candidates.length} candidate(s)`;
        if (Array.isArray(record.holdings)) return `${record.holdings.length} holding(s)`;
        if (Array.isArray(record.items)) return `${record.items.length} item(s)`;
        if (Array.isArray(record.headlines)) return `${record.headlines.length} headline(s)`;
        if (Array.isArray(record.results)) return `${record.results.length} result(s)`;
        return Object.keys(record).slice(0, 4).join(', ');
    }

    return String(result).slice(0, 60);
}

/**
 * The system prompt. Two jobs: stop the model inventing market data, and keep it inside the
 * same not-advice boundary the rest of the app uses.
 */
export function buildAssistantSystemPrompt(context: {
    date: string;
    defaultStrategy: string;
    /** The vendored playbooks, listed so the model knows what it can pull. */
    playbooks?: { id: string; description: string }[];
}): string {
    const playbooks = context.playbooks ?? [];

    const playbookSection =
        playbooks.length === 0
            ? []
            : [
                  '',
                  'ANALYSIS PLAYBOOKS:',
                  'This repo vendors complete analysis playbooks (from tradermonty/claude-trading-skills,',
                  'MIT — see .agents/UPSTREAM.md). When a question calls for one, call',
                  `${PLAYBOOK_TOOL} with its id FIRST, then follow it exactly. Pass a listed "section" for`,
                  'the deeper reference document when the main playbook points at one.',
                  '- Do not paraphrase a playbook back to the user. Apply it to the data you fetched.',
                  '- A playbook is a methodology, not a source of figures. Its example numbers are',
                  '  illustrative — every figure you report must still come from a tool call.',
                  '',
                  ...playbooks.map((playbook) => {
                      const description =
                          playbook.description.length > PLAYBOOK_DESCRIPTION_CHARS
                              ? `${playbook.description.slice(0, PLAYBOOK_DESCRIPTION_CHARS)}…`
                              : playbook.description;
                      return `- ${playbook.id}: ${description}`;
                  }),
              ];

    return [
        'You are the analysis assistant inside OpenStock, a market dashboard covering stocks and crypto.',
        '',
        'NON-NEGOTIABLE RULES:',
        '- NEVER state a price, percentage, indicator, score, market cap or holding value from your',
        '  own knowledge. Your training data is out of date and any figure you recall is wrong.',
        '  Call a tool, then report only what it returned.',
        '- If a tool fails or returns nothing, say the data is unavailable. Never estimate, and never',
        '  fill the gap with a plausible-looking number.',
        '- You must NOT give investment advice. No buy/sell/hold recommendations, no price targets,',
        '  no projected returns. You may report what a screen or indicator shows — for example "the',
        '  screener scores AAPL 100 of 100" — and leave the decision to the user. If asked what to',
        '  buy, explain that you can show what the rules-based screen flags, not what to purchase.',
        '- Say when data is cached or delayed rather than implying it is live tick-by-tick.',
        '- If asked something unrelated to markets, say so and steer back.',
        '',
        'STYLE: concise and factual. Give the figures, name the tool that produced them, and note',
        'anything that limits them (missing history, rate limiting, unofficial sources).',
        '',
        'CONTEXT:',
        `- Today (UTC): ${context.date}`,
        `- Default screener strategy: ${context.defaultStrategy}`,
        '- The Must Buy screener is a deterministic rules engine. Its ranking is authoritative;',
        '  do not re-rank or second-guess it with your own scoring.',
        '- Stock price history comes from an unofficial free source and can be unavailable.',
        '- Crypto data is from CoinGecko and may be rate limited.',
        '',
        'When the user asks about "the market", "what to buy", or wants suggestions, call',
        'run_screener for both asset types and report the flagged candidates with their scores and',
        'the conditions they met, plus the standing disclaimer.',
        ...playbookSection,
    ].join('\n');
}

/**
 * Run one conversational turn, executing any tools the model asks for.
 *
 * `history` is the prior conversation (user and assistant turns). The system prompt is added
 * here rather than stored, so it can reflect the current date on every turn.
 */
export async function runChatTurn({
    history,
    userId,
    provider,
}: {
    history: { role: 'user' | 'assistant'; content: string }[];
    userId: string;
    provider?: AIProviderName;
}): Promise<ChatTurnResult> {
    const config = await loadConfig();
    const providerName = (provider || (config.AI_PROVIDER as AIProviderName) || 'gemini') as AIProviderName;

    // The catalogue is a directory scan, cached after the first turn. If it fails (no
    // .agents directory in some deployment) the assistant still works, just without playbooks.
    const playbooks = await listAnalysisSkills()
        .then((skills) => skills.map((skill) => ({ id: skill.id, description: skill.description })))
        .catch(() => []);

    const system = buildAssistantSystemPrompt({
        date: new Date().toISOString().slice(0, 10),
        defaultStrategy: config.SCREENER_STRATEGY || 'trend-following',
        playbooks,
    });

    const tools = getToolSpecs();
    const ctx: AIToolContext = { userId };
    const toolTrace: ToolTraceEntry[] = [];

    const messages: AIChatMessage[] = [
        { role: 'system', content: system },
        ...history.map((turn) => ({ role: turn.role, content: turn.content }) as AIChatMessage),
    ];

    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
        iterations += 1;

        const completion = await callAIProviderWithTools(messages, tools, providerName, {
            temperature: 0.3,
        });

        const calls: AIToolCall[] = completion.toolCalls ?? [];

        if (calls.length === 0) {
            return {
                content: completion.content?.trim() || 'The model returned an empty response.',
                toolTrace,
                iterations,
                provider: providerName,
            };
        }

        // Record the assistant turn that requested the tools, so the next request has the
        // full exchange in context.
        messages.push({
            role: 'assistant',
            content: completion.content ?? '',
            toolCalls: calls,
        });

        for (const call of calls) {
            const started = Date.now();
            const tool = getTool(call.name);

            if (!tool) {
                const message = `Unknown tool "${call.name}". Available tools: ${tools.map((t) => t.name).join(', ')}.`;
                toolTrace.push({
                    name: call.name,
                    arguments: call.arguments,
                    ok: false,
                    summary: 'unknown tool',
                    durationMs: Date.now() - started,
                });
                messages.push({
                    role: 'tool',
                    toolCallId: call.id,
                    name: call.name,
                    content: JSON.stringify({ error: message }),
                });
                continue;
            }

            let parsedArgs: Record<string, unknown> = {};
            try {
                parsedArgs = call.arguments ? JSON.parse(call.arguments) : {};
            } catch {
                // A malformed argument string is the model's error to correct; hand it back
                // as a tool failure rather than throwing.
                const message = `Arguments for ${call.name} were not valid JSON. Received: ${call.arguments}`;
                toolTrace.push({
                    name: call.name,
                    arguments: call.arguments,
                    ok: false,
                    summary: 'invalid JSON arguments',
                    durationMs: Date.now() - started,
                });
                messages.push({
                    role: 'tool',
                    toolCallId: call.id,
                    name: call.name,
                    content: JSON.stringify({ error: message }),
                });
                continue;
            }

            try {
                const result = await withTimeout(
                    tool.execute(parsedArgs, ctx),
                    TOOL_TIMEOUT_MS,
                    `Tool ${call.name}`
                );

                const serialised = JSON.stringify(result);
                // A playbook is read whole; everything else keeps the tighter data budget.
                const budget =
                    call.name === PLAYBOOK_TOOL ? MAX_PLAYBOOK_CHARS : MAX_TOOL_RESULT_CHARS;
                const truncated =
                    serialised.length > budget
                        ? `${serialised.slice(0, budget)}… (truncated)`
                        : serialised;

                toolTrace.push({
                    name: call.name,
                    arguments: call.arguments,
                    ok: true,
                    summary: summarise(result),
                    durationMs: Date.now() - started,
                });

                messages.push({
                    role: 'tool',
                    toolCallId: call.id,
                    name: call.name,
                    content: truncated,
                });
            } catch (error) {
                // A failed tool is information for the model, not a fatal error. Telling it
                // what went wrong lets it retry or explain the gap.
                const message = error instanceof Error ? error.message : 'Tool failed.';
                console.error(`Assistant tool ${call.name} failed:`, error);

                toolTrace.push({
                    name: call.name,
                    arguments: call.arguments,
                    ok: false,
                    summary: message.slice(0, 120),
                    durationMs: Date.now() - started,
                });

                messages.push({
                    role: 'tool',
                    toolCallId: call.id,
                    name: call.name,
                    content: JSON.stringify({ error: message }),
                });
            }
        }
    }

    // Out of iterations. Say so plainly rather than returning a half-finished answer.
    return {
        content:
            `I stopped after ${MAX_ITERATIONS} rounds of data lookups without reaching an answer. ` +
            'Try asking something narrower — for example a specific asset or one market.',
        toolTrace,
        iterations,
        provider: providerName,
    };
}
