'use server';

import { revalidatePath } from 'next/cache';
import { connectToDatabase } from '@/database/mongoose';
import { requireUserId } from '@/lib/session';
import { isObjectId, requireText } from '@/lib/validate';
import {
    ConversationModel,
    MAX_CONVERSATION_MESSAGES,
    type ConversationToolTrace,
} from '@/database/models/conversation.model';
import { runChatTurn } from '@/lib/ai-chat';
import { loadConfig } from '@/lib/config';
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

export interface AssistantOverlayState {
    conversation: ConversationDetail | null;
    providerLabel: string;
}

/**
 * Everything the floating assistant needs on its first open, in one round trip.
 *
 * A conversation is created when the user has none. The overlay is summoned by a single click
 * on "Ask AI", so landing on an empty state with no composer would make the button look
 * broken; the /assistant page can afford a "no conversation selected" placeholder because it
 * also renders the list, and this cannot.
 *
 * The provider label travels with it so the panel can name the model that answered — the same
 * guarantee the full page makes, and the reason it is not hard-coded here.
 */
export async function loadAssistantOverlayState(): Promise<AssistantOverlayState> {
    const userId = await requireUserId();
    await connectToDatabase();

    const newest = await ConversationModel.findOne({ userId })
        .sort({ updatedAt: -1 })
        .select({ _id: 1 })
        .lean();

    const conversationId = newest
        ? String(newest._id)
        : String(
              (
                  await ConversationModel.create({
                      userId,
                      title: 'New conversation',
                      messages: [],
                  })
              )._id
          );

    const conversation = await getConversation(conversationId);

    const config = await loadConfig();
    const provider = config.AI_PROVIDER || 'gemini';
    const model =
        provider === 'deepseek' ? config.DEEPSEEK_MODEL : provider === 'gemini' ? config.GEMINI_MODEL : null;
    const configured =
        provider === 'deepseek' ? config.DEEPSEEK_API_KEY : provider === 'gemini' ? config.GEMINI_API_KEY : '1';

    return {
        conversation,
        providerLabel: configured ? `${provider}${model ? ` · ${model}` : ''}` : `${provider} · no key set`,
    };
}

export async function getConversation(id: string): Promise<ConversationDetail | null> {
    const userId = await requireUserId();

    // A malformed id cannot match anything, and letting Mongoose try throws a CastError that
    // reaches the user as an opaque 500.
    if (!isObjectId(id)) return null;

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

    // The title is written straight into a document and the client may omit or blank it.
    const safeTitle = title?.trim() ? requireText(title, 'Title', 120) : 'New conversation';

    await connectToDatabase();

    const doc = await ConversationModel.create({ userId, title: safeTitle, messages: [] });
    revalidatePath('/assistant');
    return String(doc._id);
}

export async function deleteConversation(id: string): Promise<{ success: boolean }> {
    const userId = await requireUserId();
    if (!isObjectId(id)) return { success: false };

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
