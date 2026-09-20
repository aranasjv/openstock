'use client';

import React, { useEffect, useRef, useState, useTransition } from 'react';
import { Send, Loader2, Wrench, AlertTriangle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sendMessage, type ConversationDetail } from '@/lib/actions/assistant.actions';

interface ChatPanelProps {
    conversation: ConversationDetail | null;
    /** Which provider is answering, shown so the source of an answer is never ambiguous. */
    providerLabel: string;
}

const SUGGESTIONS = [
    'What does the Must Buy screener flag today for stocks and crypto?',
    'How are my holdings doing?',
    'Is bitcoin overbought right now, based on RSI and MACD?',
    'Compare the trend for AAPL and ethereum.',
];

interface DisplayMessage {
    role: 'user' | 'assistant';
    content: string;
    toolTrace?: { name: string; ok: boolean; summary: string }[];
}

export default function ChatPanel({ conversation, providerLabel }: ChatPanelProps) {
    const [messages, setMessages] = useState<DisplayMessage[]>(conversation?.messages ?? []);
    const [input, setInput] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();
    const bottomRef = useRef<HTMLDivElement>(null);

    // Switching conversations replaces the transcript.
    useEffect(() => {
        setMessages(conversation?.messages ?? []);
        setError(null);
    }, [conversation?.id]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length, pending]);

    const submit = (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || pending || !conversation) return;

        setError(null);
        setInput('');
        // Show the question immediately; the answer arrives when the turn completes.
        setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);

        startTransition(async () => {
            const result = await sendMessage(conversation.id, trimmed);

            if (!result.ok || !result.content) {
                setError(result.error ?? 'The assistant did not respond.');
                return;
            }

            setMessages((prev) => [
                ...prev,
                { role: 'assistant', content: result.content!, toolTrace: result.toolTrace },
            ]);
        });
    };

    if (!conversation) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-gray-800 bg-gray-900/30 p-10 text-center">
                <p className="text-sm text-gray-400">No conversation selected</p>
                <p className="max-w-sm text-xs text-gray-500">
                    Start a new conversation to ask about stocks, crypto, the screener or your holdings.
                </p>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900/30">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-4 py-2.5">
                <h2 className="truncate text-sm font-semibold text-white">{conversation.title}</h2>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-gray-500">
                    {providerLabel}
                </span>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                {messages.length === 0 ? (
                    <div className="space-y-3">
                        <p className="text-xs text-gray-500">
                            Ask about a market, an asset, the screener or your own positions. Answers are
                            built from live data fetched through tools — the figures come from the data,
                            not from the model&apos;s memory.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {SUGGESTIONS.map((suggestion) => (
                                <button
                                    key={suggestion}
                                    type="button"
                                    onClick={() => submit(suggestion)}
                                    className="rounded-full border border-gray-800 px-3 py-1.5 text-left text-[11px] text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200"
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}

                {messages.map((message, index) => (
                    <div key={index} className={message.role === 'user' ? 'flex justify-end' : ''}>
                        <div
                            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                                message.role === 'user'
                                    ? 'bg-teal-600/20 text-gray-100'
                                    : 'bg-gray-800/60 text-gray-200'
                            }`}
                        >
                            <p className="whitespace-pre-line leading-relaxed">{message.content}</p>

                            {/* Which data produced this answer. Shown so a claim can be checked
                                against its source rather than taken on trust. */}
                            {message.toolTrace?.length ? (
                                <details className="mt-2 border-t border-gray-700/60 pt-2">
                                    <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-gray-500 hover:text-gray-400">
                                        <Wrench className="mr-1 inline h-3 w-3" />
                                        {message.toolTrace.length} data lookup
                                        {message.toolTrace.length === 1 ? '' : 's'}
                                    </summary>
                                    <ul className="mt-1.5 space-y-1">
                                        {message.toolTrace.map((entry, traceIndex) => (
                                            <li key={traceIndex} className="flex items-start gap-1.5 text-[11px]">
                                                {entry.ok ? (
                                                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                                                ) : (
                                                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-yellow-600" />
                                                )}
                                                <span className="font-mono text-gray-400">{entry.name}</span>
                                                <span className="text-gray-500">{entry.summary}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </details>
                            ) : null}
                        </div>
                    </div>
                ))}

                {pending ? (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Fetching market data and analysing…
                    </div>
                ) : null}

                {error ? (
                    <p className="rounded-md border border-red-900/50 bg-red-950/20 p-3 text-xs text-red-300">
                        {error}
                    </p>
                ) : null}

                <div ref={bottomRef} />
            </div>

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    submit(input);
                }}
                className="flex shrink-0 items-end gap-2 border-t border-gray-800 p-3"
            >
                <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            submit(input);
                        }
                    }}
                    rows={2}
                    placeholder="Ask about stocks, crypto, the screener or your holdings…"
                    className="min-h-[42px] flex-1 resize-none rounded-md border border-gray-800 bg-[#1C1C1F] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-teal-700 focus:outline-none"
                />
                <Button
                    type="submit"
                    disabled={pending || !input.trim()}
                    aria-label="Send message"
                    className="h-[42px] bg-teal-600 px-3 text-white hover:bg-teal-500"
                >
                    <Send className="h-4 w-4" />
                </Button>
            </form>

            <p className="shrink-0 border-t border-gray-800 px-3 py-2 text-[10px] leading-relaxed text-gray-500">
                Answers are generated from the data shown in each lookup. This is not investment advice —
                the assistant can report what a screen or indicator shows, not what to buy.
            </p>
        </div>
    );
}
