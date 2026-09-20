'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Trash2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createConversation, deleteConversation, type ConversationSummary } from '@/lib/actions/assistant.actions';

interface ConversationListProps {
    conversations: ConversationSummary[];
    activeId: string | null;
}

export default function ConversationList({ conversations, activeId }: ConversationListProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [pending, startTransition] = useTransition();

    const goTo = (id: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('c', id);
        router.replace(`/assistant?${params.toString()}`, { scroll: false });
    };

    const handleNew = () => {
        startTransition(async () => {
            const id = await createConversation();
            router.replace(`/assistant?c=${id}`, { scroll: false });
        });
    };

    const handleDelete = (id: string) => {
        startTransition(async () => {
            await deleteConversation(id);
            // Deleting the open conversation falls back to the list.
            if (id === activeId) router.replace('/assistant', { scroll: false });
        });
    };

    return (
        <div className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900/30">
            <div className="shrink-0 border-b border-gray-800 p-3">
                <Button
                    type="button"
                    onClick={handleNew}
                    disabled={pending}
                    className="w-full bg-teal-600 text-white hover:bg-teal-500"
                    size="sm"
                >
                    <Plus className="mr-1.5 h-4 w-4" />
                    New conversation
                </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {conversations.length === 0 ? (
                    <p className="p-3 text-xs text-gray-600">No conversations yet.</p>
                ) : (
                    <ul>
                        {conversations.map((conversation) => {
                            const isActive = conversation.id === activeId;
                            return (
                                <li key={conversation.id} className="group flex items-center">
                                    <button
                                        type="button"
                                        onClick={() => goTo(conversation.id)}
                                        className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                                            isActive
                                                ? 'bg-teal-600/15 text-teal-200'
                                                : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                                        }`}
                                    >
                                        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                                        <span className="truncate">{conversation.title}</span>
                                        <span className="ml-auto shrink-0 text-[10px] text-gray-600">
                                            {conversation.messageCount}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(conversation.id)}
                                        disabled={pending}
                                        title="Delete conversation"
                                        className="mr-2 shrink-0 text-gray-700 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}
