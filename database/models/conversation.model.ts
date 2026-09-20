import { Schema, model, models, type Document, type Model } from 'mongoose';

/**
 * A persisted assistant conversation.
 *
 * Messages are embedded rather than stored in a second collection: a conversation is read
 * and written as a whole, so one query per turn beats a join. Growth is bounded by
 * `$slice` on push (see the actions), which keeps a long thread from expanding a document
 * toward MongoDB's 16MB limit.
 */

export interface ConversationToolTrace {
    name: string;
    ok: boolean;
    summary: string;
}

export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
    /** Which data the assistant fetched to produce this reply, for auditability. */
    toolTrace?: ConversationToolTrace[];
    createdAt: Date;
}

export interface Conversation extends Document {
    userId: string;
    title: string;
    messages: ConversationMessage[];
    createdAt: Date;
    updatedAt: Date;
}

const MessageSchema = new Schema<ConversationMessage>(
    {
        role: { type: String, enum: ['user', 'assistant'], required: true },
        content: { type: String, required: true },
        toolTrace: [
            {
                _id: false,
                name: { type: String, required: true },
                ok: { type: Boolean, required: true },
                summary: { type: String, default: '' },
            },
        ],
        createdAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const ConversationSchema = new Schema<Conversation>(
    {
        userId: { type: String, required: true, index: true },
        title: { type: String, required: true, trim: true, maxlength: 120 },
        messages: { type: [MessageSchema], default: [] },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

// Listing a user's conversations is the most common query.
ConversationSchema.index({ userId: 1, updatedAt: -1 });

export const ConversationModel: Model<Conversation> =
    (models?.Conversation as Model<Conversation>) ||
    model<Conversation>('Conversation', ConversationSchema);

/** Keeps the embedded array bounded; older turns fall off the front. */
export const MAX_CONVERSATION_MESSAGES = 100;
