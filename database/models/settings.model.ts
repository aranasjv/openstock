import { Schema, model, models, type Document, type Model } from 'mongoose';

/**
 * Application settings, editable at runtime from /settings.
 *
 * Stored as a single document so a read is one query and a write is atomic. Values here
 * override environment variables (which remain the fallback and the bootstrap default).
 */
export interface AppSettings extends Document {
    key: string;
    values: Record<string, string>;
    updatedAt: Date;
}

const AppSettingsSchema = new Schema<AppSettings>(
    {
        key: { type: String, required: true, unique: true, default: 'app' },
        values: { type: Schema.Types.Mixed, default: {} },
        updatedAt: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

export const AppSettingsModel: Model<AppSettings> =
    (models?.AppSettings as Model<AppSettings>) ||
    model<AppSettings>('AppSettings', AppSettingsSchema);

export const SETTINGS_DOC_KEY = 'app';
