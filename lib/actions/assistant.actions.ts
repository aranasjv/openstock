'use server';

import { revalidatePath } from 'next/cache';
import { connectToDatabase } from '@/database/mongoose';
import { requireUserId } from '@/lib/session';
import {
    ConversationModel,
    MAX_CONVERSATION_MESSAGES,
    type ConversationToolTrace,
} from '@/database/models/conversation.model';
import { runChatTurn } from '@/lib/ai-chat';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Assistant conversations.
 *
 * Every function resolves the session itself and scopes its query by `userId`, so one user
 * can never read, continue or delete another user's thread. That check lives here rather
 * than in the page because these are callable directly as server actions.
 */

/** A turn costs up to six provider calls, so cap how often one user can start one. */
const TURNS_PER_WINDOW = 10;
const WINDOW_MS = 5 * 60 * 1000;

export interface ConversationSummary {
    id: string;
    title: string;
    updatedAt: string;
    messageCount: number;
}

export interface ConversationDetail {
    id: string;
    title: string;
    messages: {
        role: 'user' | 'assistant';
        content: string;
        toolTrace?: ConversationToolTrace[];
        createdAt: string;
    }[];
}

export async function listConversations(): Promise<ConversationSummary[]> {
    const userId = await requireUserId();
    await connectToDatabase();

    const docs = await ConversationModel.find({ userId })
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean();

    return docs.map((doc) => ({
        id: String(doc._id),
        title: doc.title,
        updatedAt: new Date(doc.updatedAt).toISOString(),
        messageCount: doc.messages?.length ?? 0,
    }));
}

export async function getConversation(id: string): Promise<ConversationDetail | null> {
    const userId = await requireUserId();
    await connectToDatabase();

    // The userId in the filter is the authorisation check, not just a lookup key.
    const doc = await ConversationModel.findOne({ _id: id, userId }).lean();
    if (!doc) return null;

    return {
        id: String(doc._id),
        title: doc.title,
        messages: (doc.messages ?? []).map((message) => ({
            role: message.role,
            content: message.content,
            toolTrace: message.toolTrace?.map((entry) => ({
                name: entry.name,
                ok: entry.ok,
                summary: entry.summary,
            })),
            createdAt: new Date(message.createdAt).toISOString(),
        })),
    };
}

export async function createConversation(title = 'New conversation'): Promise<string> {
    const userId = await requireUserId();
    await connectToDatabase();

    const doc = await ConversationModel.create({ userId, title, messages: [] });
    revalidatePath('/assistant');
    return String(doc._id);
}

export async function deleteConversation(id: string): Promise<{ success: boolean }> {
    const userId = await requireUserId();
    await connectToDatabase();

    await ConversationModel.deleteOne({ _id: id, userId });
    revalidatePath('/assistant');
    return { success: true };
}

export interface SendMessageResult {
    ok: boolean;
    conversationId?: string;
    content?: string;
    toolTrace?: ConversationToolTrace[];
    error?: string;
}

/**
 * Send a user message, run the tool-calling turn, and persist both sides.
 *
 * Persisting after the model responds (rather than before) means a failed turn leaves the
 * conversation unchanged instead of stranding a question with no answer.
 */
export async function sendMessage(conversationId: string, text: string): Promise<SendMessageResult> {
    let userId: string;
    try {
        userId = await requireUserId();
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Not signed in.' };
    }

    const trimmed = (text || '').trim();
    if (!trimmed) return { ok: false, error: 'Message is empty.' };
    if (trimmed.length > 4000) return { ok: false, error: 'Message is too long (4000 characters max).' };

    const limit = checkRateLimit(`assistant:${userId}`, TURNS_PER_WINDOW, WINDOW_MS);
    if (!limit.ok) {
        const seconds = Math.ceil((limit.retryAfterMs ?? WINDOW_MS) / 1000);
        return {
            ok: false,
            error: `Too many messages. Try again in about ${seconds}s — each turn can make several model calls.`,
        };
    }

    try {
        await connectToDatabase();

        const conversation = await ConversationModel.findOne({ _id: conversationId, userId });
        if (!conversation) return { ok: false, error: 'Conversation not found.' };

        const history = (conversation.messages ?? []).map((message) => ({
            role: message.role,
            content: message.content,
        }));

        // Prior turns plus the new question. Tool results are intentionally not replayed:
        // they are point-in-time and would bloat the context with stale figures.
        const turn = await runChatTurn({
            history: [...history, { role: 'user', content: trimmed }],
            userId,
        });

        const title =
            conversation.messages.length === 0
                ? trimmed.slice(0, 60) + (trimmed.length > 60 ? '…' : '')
                : conversation.title;

        const toolTrace: ConversationToolTrace[] = turn.toolTrace.map((entry) => ({
            name: entry.name,
            ok: entry.ok,
            summary: entry.summary,
        }));

        // $slice keeps the embedded array bounded regardless of how long the thread runs.
        await ConversationModel.updateOne(
            { _id: conversationId, userId },
            {
                $push: {
                    messages: {
                        $each: [
                            { role: 'user', content: trimmed, createdAt: new Date() },
                            {
                                role: 'assistant',
                                content: turn.content,
                                toolTrace,
                                createdAt: new Date(),
                            },
                        ],
                        $slice: -MAX_CONVERSATION_MESSAGES,
                    },
                },
                $set: { updatedAt: new Date(), title },
            }
        );

        revalidatePath('/assistant');

        return { ok: true, conversationId, content: turn.content, toolTrace };
    } catch (error) {
        console.error('Assistant sendMessage failed:', error);
        return {
            ok: false,
            error:
                error instanceof Error
                    ? error.message
                    : 'The assistant could not respond. Check the AI provider settings.',
        };
    }
}
