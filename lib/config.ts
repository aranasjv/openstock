import 'server-only';

import { connectToDatabase } from '@/database/mongoose';
import { AppSettingsModel, SETTINGS_DOC_KEY } from '@/database/models/settings.model';

/**
 * Runtime configuration.
 *
 * Resolution order, highest priority first:
 *   1. value saved from the /settings UI (MongoDB)
 *   2. the environment variable
 *   3. the declared default
 *
 * This exists because `NEXT_PUBLIC_*` values are inlined at build time — anything read
 * from `process.env` at module scope cannot change without a rebuild. Reads here happen
 * per call, so editing a key in the UI takes effect immediately.
 *
 * `server-only` makes the build fail if this module is ever pulled into a client bundle,
 * which is what keeps API keys off the browser.
 */

export type SettingGroup = 'ai' | 'market' | 'sentiment' | 'notifications' | 'email' | 'automation' | 'screener' | 'system';

export interface SettingDef {
    /** Canonical key used in code. */
    key: string;
    group: SettingGroup;
    label: string;
    description?: string;
    /** Environment variable names to fall back to, in priority order. */
    env?: string[];
    default?: string;
    secret?: boolean;
    /** false for values that bootstrap the app and cannot safely change at runtime. */
    runtimeEditable?: boolean;
    type?: 'text' | 'password' | 'number' | 'select';
    options?: string[];
}

export const CONFIG_SCHEMA: SettingDef[] = [
    // ── AI ──────────────────────────────────────────────────────────
    {
        key: 'AI_PROVIDER',
        group: 'ai',
        env: ['AI_PROVIDER'],
        label: 'Active AI provider',
        description: 'Provider used for generated rationale. Falls back automatically if it errors.',
        default: 'gemini',
        type: 'select',
        options: ['gemini', 'deepseek', 'minimax', 'siray'],
    },
    { key: 'GEMINI_API_KEY', group: 'ai', env: ['GEMINI_API_KEY'], label: 'Gemini API key', secret: true, type: 'password' },
    { key: 'GEMINI_BASE_URL', group: 'ai', env: ['GEMINI_BASE_URL'], label: 'Gemini base URL', default: 'https://generativelanguage.googleapis.com/v1beta/models' },
    { key: 'GEMINI_MODEL', group: 'ai', env: ['GEMINI_MODEL'], label: 'Gemini model', default: 'gemini-2.5-flash-lite' },

    { key: 'DEEPSEEK_API_KEY', group: 'ai', env: ['DEEPSEEK_API_KEY'], label: 'DeepSeek API key', secret: true, type: 'password' },
    { key: 'DEEPSEEK_BASE_URL', group: 'ai', env: ['DEEPSEEK_BASE_URL'], label: 'DeepSeek base URL', default: 'https://api.deepseek.com' },
    { key: 'DEEPSEEK_MODEL', group: 'ai', env: ['DEEPSEEK_MODEL'], label: 'DeepSeek model', default: 'deepseek-flash' },

    { key: 'MINIMAX_API_KEY', group: 'ai', env: ['MINIMAX_API_KEY'], label: 'MiniMax API key', secret: true, type: 'password' },
    { key: 'MINIMAX_BASE_URL', group: 'ai', env: ['MINIMAX_BASE_URL'], label: 'MiniMax base URL', default: 'https://api.minimax.io/v1' },
    { key: 'MINIMAX_MODEL', group: 'ai', env: ['MINIMAX_MODEL'], label: 'MiniMax model', default: 'MiniMax-M3' },

    { key: 'SIRAY_API_KEY', group: 'ai', env: ['SIRAY_API_KEY'], label: 'Siray API key', secret: true, type: 'password' },
    { key: 'SIRAY_BASE_URL', group: 'ai', env: ['SIRAY_BASE_URL'], label: 'Siray base URL', default: 'https://api.siray.ai/v1' },
    { key: 'SIRAY_MODEL', group: 'ai', env: ['SIRAY_MODEL'], label: 'Siray model', default: 'siray-1.0-ultra' },

    {
        key: 'TRADER_FRAMEWORK',
        group: 'ai',
        env: ['TRADER_FRAMEWORK'],
        label: 'Trader analysis framework',
        description:
            'How the AI writes its explanation of a screener result. "Technical Analyst" applies a structured methodology adapted from tradermonty/claude-trading-skills (MIT): trend, levels, momentum and volume, a mandatory opposing case, and an invalidation level. It shapes wording only — ranking stays deterministic.',
        default: 'technical-analyst',
        type: 'select',
        options: ['technical-analyst', 'plain'],
    },
    {
        key: 'ANALYSIS_PLAYBOOK',
        group: 'ai',
        env: ['ANALYSIS_PLAYBOOK'],
        label: 'Explain: analysis playbook',
        description:
            'Optional. Overrides the framework above with one of the full playbooks vendored under .agents/skills — for example "technical-analyst", "us-stock-analysis" or "position-sizer". The playbook is sent as the system prompt, so it costs more per explanation than the built-in framework. Leave blank to use the framework.',
        default: '',
    },

    // ── Market data ─────────────────────────────────────────────────
    {
        key: 'FINNHUB_API_KEY',
        group: 'market',
        // NEXT_PUBLIC_ kept as a fallback so existing deployments keep working.
        env: ['FINNHUB_API_KEY', 'NEXT_PUBLIC_FINNHUB_API_KEY'],
        label: 'Finnhub API key',
        description: 'Used for stock quotes, profiles, search and news. Free tier: 60 calls/min.',
        secret: true,
        type: 'password',
    },
    { key: 'FINNHUB_BASE_URL', group: 'market', env: ['FINNHUB_BASE_URL'], label: 'Finnhub base URL', default: 'https://finnhub.io/api/v1' },
    {
        key: 'COINGECKO_API_KEY',
        group: 'market',
        env: ['COINGECKO_API_KEY'],
        label: 'CoinGecko API key',
        description: 'Optional. The public endpoints work without a key at a lower rate limit.',
        secret: true,
        type: 'password',
    },
    { key: 'COINGECKO_API_BASE_URL', group: 'market', env: ['COINGECKO_API_BASE_URL'], label: 'CoinGecko base URL', default: 'https://api.coingecko.com/api/v3' },
    {
        key: 'YAHOO_CHART_BASE_URL',
        group: 'market',
        env: ['YAHOO_CHART_BASE_URL'],
        label: 'Stock history base URL',
        description:
            'Unofficial fallback for stock price history (Finnhub candles need a paid plan). Point this at a proxy if the direct endpoint is blocked.',
        default: 'https://query1.finance.yahoo.com/v8/finance/chart',
    },

    // ── Sentiment ───────────────────────────────────────────────────
    { key: 'ADANOS_API_KEY', group: 'sentiment', env: ['ADANOS_API_KEY'], label: 'Adanos API key', description: 'Optional. Enables the stock sentiment card.', secret: true, type: 'password' },
    { key: 'ADANOS_API_BASE_URL', group: 'sentiment', env: ['ADANOS_API_BASE_URL'], label: 'Adanos base URL', default: 'https://api.adanos.org' },

    // ── Notifications (Telegram) ────────────────────────────────────
    // Stocks and crypto each get their own bot and chat, so the two streams can be pointed at
    // different bots the user controls independently.
    {
        key: 'TELEGRAM_STOCK_BOT_TOKEN',
        group: 'notifications',
        env: ['TELEGRAM_STOCK_BOT_TOKEN'],
        label: 'Stock bot token',
        description: 'Create a bot with @BotFather for stock alerts and the stock digest.',
        secret: true,
        type: 'password',
    },
    {
        key: 'TELEGRAM_STOCK_CHAT_ID',
        group: 'notifications',
        env: ['TELEGRAM_STOCK_CHAT_ID'],
        label: 'Stock chat id',
        description: 'Where the stock bot sends. Use "Find chat id" after messaging that bot.',
    },
    {
        key: 'TELEGRAM_CRYPTO_BOT_TOKEN',
        group: 'notifications',
        env: ['TELEGRAM_CRYPTO_BOT_TOKEN'],
        label: 'Crypto bot token',
        description: 'Create a second bot with @BotFather for crypto alerts and the crypto digest.',
        secret: true,
        type: 'password',
    },
    {
        key: 'TELEGRAM_CRYPTO_CHAT_ID',
        group: 'notifications',
        env: ['TELEGRAM_CRYPTO_CHAT_ID'],
        label: 'Crypto chat id',
        description: 'Where the crypto bot sends. Use "Find chat id" after messaging that bot.',
    },
    {
        key: 'TELEGRAM_BOT_TOKEN',
        group: 'notifications',
        env: ['TELEGRAM_BOT_TOKEN'],
        label: 'Shared bot token (fallback)',
        description: 'Optional. Used for either audience when its own bot token is not set.',
        secret: true,
        type: 'password',
    },
    {
        key: 'TELEGRAM_ENABLED',
        group: 'notifications',
        env: ['TELEGRAM_ENABLED'],
        label: 'Send Telegram notifications',
        description: 'Turn off to pause all Telegram delivery without clearing the tokens.',
        default: 'true',
        type: 'select',
        options: ['true', 'false'],
    },
    {
        key: 'TELEGRAM_API_BASE_URL',
        group: 'notifications',
        env: ['TELEGRAM_API_BASE_URL'],
        label: 'Telegram API base URL',
        description: 'Only change this to point at a self-hosted Bot API server.',
        default: 'https://api.telegram.org',
    },
    {
        key: 'ALERT_CHECK_MINUTES',
        group: 'notifications',
        env: ['ALERT_CHECK_MINUTES'],
        label: 'Alert check interval (minutes)',
        description: 'How often price alerts are evaluated. Alerts are polled, not pushed.',
        default: '5',
        type: 'number',
    },
    {
        key: 'DIGEST_ENABLED',
        group: 'notifications',
        env: ['DIGEST_ENABLED'],
        label: 'Send the daily digest',
        description: 'Must-buy screen for stocks and crypto, plus your holdings.',
        default: 'true',
        type: 'select',
        options: ['true', 'false'],
    },
    {
        key: 'DIGEST_HOUR',
        group: 'notifications',
        env: ['DIGEST_HOUR'],
        label: 'Digest hour (0-23)',
        description: 'Hour of the day, interpreted in the timezone below.',
        default: '8',
        type: 'number',
    },
    {
        key: 'DIGEST_TIMEZONE',
        group: 'notifications',
        env: ['DIGEST_TIMEZONE'],
        label: 'Digest timezone',
        description: 'IANA name, e.g. Asia/Manila or America/New_York. The container clock is UTC, so this decides when "8" means 8am.',
        default: 'UTC',
    },
    {
        key: 'DIGEST_MARKET',
        group: 'notifications',
        env: ['DIGEST_MARKET'],
        label: 'Digest market',
        description: 'Which market the digest screens for must-buy candidates.',
        default: 'both',
        type: 'select',
        options: ['both', 'stocks', 'crypto'],
    },

    // ── Email ───────────────────────────────────────────────────────
    { key: 'NODEMAILER_EMAIL', group: 'email', env: ['NODEMAILER_EMAIL'], label: 'Gmail address' },
    { key: 'NODEMAILER_PASSWORD', group: 'email', env: ['NODEMAILER_PASSWORD'], label: 'Gmail app password', secret: true, type: 'password' },

    // ── Automation ──────────────────────────────────────────────────
    {
        key: 'INNGEST_SIGNING_KEY',
        group: 'automation',
        env: ['INNGEST_SIGNING_KEY'],
        label: 'Inngest signing key',
        description: 'Read-only: the Inngest client is constructed at module load, so this must come from the environment.',
        secret: true,
        runtimeEditable: false,
    },
    { key: 'KIT_API_KEY', group: 'automation', env: ['KIT_API_KEY'], label: 'Kit API key', secret: true, type: 'password' },
    { key: 'KIT_API_SECRET', group: 'automation', env: ['KIT_API_SECRET'], label: 'Kit API secret', secret: true, type: 'password' },
    { key: 'KIT_WELCOME_FORM_ID', group: 'automation', env: ['KIT_WELCOME_FORM_ID'], label: 'Kit welcome form ID' },

    // ── Screener ────────────────────────────────────────────────────
    {
        key: 'SCREENER_STRATEGY',
        group: 'screener',
        env: ['SCREENER_STRATEGY'],
        label: 'Default strategy',
        description: 'Used by the daily digest. The dashboard dropdown can still be changed per view.',
        default: 'trend-following',
        type: 'select',
        options: ['trend-following', 'momentum', 'oversold-pullback', 'breakout', 'mean-reversion'],
    },
    {
        key: 'SCREENER_UNIVERSE_SIZE',
        group: 'screener',
        env: ['SCREENER_UNIVERSE_SIZE'],
        label: 'Assets scanned per market',
        description: 'How many symbols the Must Buy screener evaluates. Each one costs a history request.',
        default: '12',
        type: 'number',
    },
    {
        key: 'SCREENER_CACHE_SECONDS',
        group: 'screener',
        env: ['SCREENER_CACHE_SECONDS'],
        label: 'Screener cache (seconds)',
        description: 'Signals are computed from daily bars, so an hour is plenty.',
        default: '3600',
        type: 'number',
    },

    // ── System (read-only) ──────────────────────────────────────────
    {
        key: 'MONGODB_URI',
        group: 'system',
        env: ['MONGODB_URI'],
        label: 'MongoDB URI',
        description: 'Read-only: the app is already connected to this database.',
        secret: true,
        runtimeEditable: false,
    },
    {
        key: 'BETTER_AUTH_SECRET',
        group: 'system',
        env: ['BETTER_AUTH_SECRET'],
        label: 'Auth secret',
        description: 'Read-only: changing this would invalidate every active session.',
        secret: true,
        runtimeEditable: false,
    },
    {
        key: 'BETTER_AUTH_URL',
        group: 'system',
        env: ['BETTER_AUTH_URL'],
        label: 'Auth base URL',
        description: 'Read-only: used to build callback and reset links.',
        runtimeEditable: false,
    },
    {
        key: 'ADMIN_EMAILS',
        group: 'system',
        env: ['ADMIN_EMAILS'],
        label: 'Admin emails',
        description: 'Comma-separated. Read-only here; if unset, the earliest registered user is the admin.',
        runtimeEditable: false,
    },
];

const SCHEMA_BY_KEY = new Map(CONFIG_SCHEMA.map((def) => [def.key, def]));

export const SETTING_GROUPS: { id: SettingGroup; label: string }[] = [
    { id: 'ai', label: 'AI Providers' },
    { id: 'market', label: 'Market Data' },
    { id: 'notifications', label: 'Telegram Notifications' },
    { id: 'sentiment', label: 'Sentiment' },
    { id: 'email', label: 'Email' },
    { id: 'automation', label: 'Automation' },
    { id: 'screener', label: 'Screener' },
    { id: 'system', label: 'System (read-only)' },
];

function fromEnv(def: SettingDef): string | undefined {
    for (const name of def.env ?? []) {
        const value = process.env[name];
        if (value !== undefined && value !== '') return value;
    }
    return undefined;
}

/** Merged config, cached briefly. Callers in loops should load once and pass it down. */
type Cache = { values: Record<string, string>; expiresAt: number } | null;
const CACHE_TTL_MS = 30_000;
let cache: Cache = null;

export function invalidateConfigCache(): void {
    cache = null;
}

function envOnlyValues(): Record<string, string> {
    const values: Record<string, string> = {};
    for (const def of CONFIG_SCHEMA) {
        const value = fromEnv(def) ?? def.default ?? '';
        values[def.key] = value;
    }
    return values;
}

/**
 * Load the effective configuration. Never throws: if MongoDB is unreachable (during a
 * build, or before the DB is up) it degrades to environment values.
 */
export async function loadConfig(): Promise<Record<string, string>> {
    if (cache && cache.expiresAt > Date.now()) return cache.values;

    const values = envOnlyValues();

    try {
        const mongoose = await connectToDatabase();
        const doc = await mongoose.connection.db
            ?.collection('appsettings')
            .findOne({ key: SETTINGS_DOC_KEY });

        const stored = (doc?.values ?? {}) as Record<string, string>;
        for (const [key, value] of Object.entries(stored)) {
            // Ignore unknown keys so a stale document cannot inject arbitrary values.
            if (SCHEMA_BY_KEY.has(key) && typeof value === 'string' && value !== '') {
                values[key] = value;
            }
        }
    } catch (error) {
        console.error('Config: falling back to environment values:', error);
    }

    cache = { values, expiresAt: Date.now() + CACHE_TTL_MS };
    return values;
}

export async function getConfigValue(key: string): Promise<string> {
    const values = await loadConfig();
    return values[key] ?? '';
}

export async function getConfigNumber(key: string, fallback: number): Promise<number> {
    const raw = await getConfigValue(key);
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Persist values from the settings UI. Rejects anything not in the schema or read-only. */
export async function saveConfig(updates: Record<string, string>): Promise<{ saved: string[]; rejected: string[] }> {
    const saved: string[] = [];
    const rejected: string[] = [];

    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(updates)) {
        const def = SCHEMA_BY_KEY.get(key);
        if (!def || def.runtimeEditable === false) {
            rejected.push(key);
            continue;
        }
        clean[key] = String(value ?? '');
        saved.push(key);
    }

    if (saved.length > 0) {
        const mongoose = await connectToDatabase();
        const collection = mongoose.connection.db?.collection('appsettings');
        if (!collection) throw new Error('MongoDB connection not found');

        // Merge into the existing document rather than replacing it, so saving one group
        // never clears values from another. `$unset` clears a field when the value is blank,
        // which is how a user removes an override and falls back to the environment.
        const existing = await collection.findOne({ key: SETTINGS_DOC_KEY });
        const merged = { ...((existing?.values ?? {}) as Record<string, string>) };

        for (const [key, value] of Object.entries(clean)) {
            if (value === '') delete merged[key];
            else merged[key] = value;
        }

        await collection.updateOne(
            { key: SETTINGS_DOC_KEY },
            { $set: { values: merged, updatedAt: new Date() } },
            { upsert: true }
        );

        invalidateConfigCache();
    }

    return { saved, rejected };
}

export function getSettingDef(key: string): SettingDef | undefined {
    return SCHEMA_BY_KEY.get(key);
}

/** Mask a secret for display: keep a short prefix and the last 4 characters. */
export function maskSecret(value: string): string {
    if (!value) return '';
    if (value.length <= 8) return '••••••••';
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export interface ConfigFieldView {
    key: string;
    label: string;
    description?: string;
    group: SettingGroup;
    secret: boolean;
    runtimeEditable: boolean;
    type: NonNullable<SettingDef['type']>;
    options?: string[];
    /** Masked when secret; the real value is never sent to the browser. */
    displayValue: string;
    /** True when a saved override exists in the database. */
    isOverridden: boolean;
    /** True when a value is coming from the environment rather than the DB. */
    fromEnv: boolean;
}

/** UI-facing view of the configuration. Secret values are masked. */
export async function getConfigView(): Promise<ConfigFieldView[]> {
    const values = await loadConfig();

    let overridden = new Set<string>();
    try {
        const mongoose = await connectToDatabase();
        const doc = await mongoose.connection.db
            ?.collection('appsettings')
            .findOne({ key: SETTINGS_DOC_KEY });
        overridden = new Set(Object.keys((doc?.values ?? {}) as Record<string, string>));
    } catch {
        /* env-only view is still useful */
    }

    return CONFIG_SCHEMA.map((def) => {
        const value = values[def.key] ?? '';
        return {
            key: def.key,
            label: def.label,
            description: def.description,
            group: def.group,
            secret: Boolean(def.secret),
            runtimeEditable: def.runtimeEditable !== false,
            type: def.type ?? 'text',
            options: def.options,
            displayValue: def.secret ? maskSecret(value) : value,
            isOverridden: overridden.has(def.key),
            fromEnv: !overridden.has(def.key) && fromEnv(def) !== undefined,
        };
    });
}
