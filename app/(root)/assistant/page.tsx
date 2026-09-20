import React, { Suspense } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/better-auth/auth';
import { loadConfig } from '@/lib/config';
import { getConversation, listConversations } from '@/lib/actions/assistant.actions';
import ChatPanel from '@/components/assistant/ChatPanel';
import ConversationList from '@/components/assistant/ConversationList';

interface AssistantPageProps {
    searchParams: Promise<{ c?: string }>;
}

export default async function AssistantPage({ searchParams }: AssistantPageProps) {
    const { c } = await searchParams;

    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) redirect('/sign-in');

    const [conversations, active, config] = await Promise.all([
        listConversations(),
        c ? getConversation(c) : Promise.resolve(null),
        loadConfig(),
    ]);

    const provider = config.AI_PROVIDER || 'gemini';
    const model = provider === 'deepseek' ? config.DEEPSEEK_MODEL : provider === 'gemini' ? config.GEMINI_MODEL : null;
    const configured = provider === 'deepseek' ? config.DEEPSEEK_API_KEY : provider === 'gemini' ? config.GEMINI_API_KEY : '1';
    const providerLabel = configured ? `${provider}${model ? ` · ${model}` : ''}` : `${provider} · no key set`;

    return (
        <div className="flex h-full flex-col gap-6 p-6 md:p-8">
            <div>
                <h1 className="bg-clip-text text-3xl font-bold text-transparent bg-gradient-to-r from-white to-gray-500">
                    Assistant
                </h1>
                <p className="mt-1 max-w-3xl text-sm text-gray-500">
                    Ask about stocks, crypto, the screener or your holdings. Every answer is built from
                    data fetched through tools at the time you ask, and each reply lists the lookups it
                    used so you can check the figures yourself.
                </p>
            </div>

            {!configured ? (
                <div className="rounded-xl border border-yellow-900/50 bg-yellow-950/20 p-4 text-sm text-yellow-200/90">
                    <strong className="font-semibold">No AI provider key is configured.</strong> Add one at{' '}
                    <a href="/settings" className="underline">
                        /settings
                    </a>{' '}
                    to use the assistant.
                </div>
            ) : null}

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-4">
                <div className="min-h-0 lg:col-span-1">
                    <Suspense fallback={<div className="h-40 rounded-xl border border-gray-800 bg-gray-900/30" />}>
                        <ConversationList conversations={conversations} activeId={active?.id ?? null} />
                    </Suspense>
                </div>

                <div className="min-h-[520px] lg:col-span-3">
                    <ChatPanel conversation={active} providerLabel={providerLabel} />
                </div>
            </div>
        </div>
    );
}
