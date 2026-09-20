import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * lib/config is the app's runtime settings layer, and its failure modes are quiet ones: a value
 * that is ignored is indistinguishable from a value that was never set, and both look like "the
 * default". These pin the rules that decide which of those you get.
 *
 * The module caches its resolved values, so each test loads a fresh instance rather than trying
 * to reach into the cache — otherwise the first test's document leaks into every test after it.
 */
const findOne = vi.fn();
let dbThrows = false;

vi.mock('@/database/mongoose', () => ({
    connectToDatabase: async () => {
        if (dbThrows) throw new Error('database unreachable');
        return { connection: { db: { collection: () => ({ findOne }) } } };
    },
}));

async function freshConfig() {
    vi.resetModules();
    return await import('@/lib/config');
}

beforeEach(() => {
    findOne.mockReset();
    dbThrows = false;
    delete process.env.AI_PROVIDER;
    delete process.env.SCREENER_UNIVERSE_SIZE;
});

afterEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.SCREENER_UNIVERSE_SIZE;
});

describe('loadConfig', () => {
    it('prefers a stored value over the environment', async () => {
        process.env.AI_PROVIDER = 'gemini';
        findOne.mockResolvedValue({ key: 'appsettings', values: { AI_PROVIDER: 'deepseek' } });

        const { loadConfig } = await freshConfig();

        expect((await loadConfig()).AI_PROVIDER).toBe('deepseek');
    });

    it('ignores an empty stored value so clearing a setting falls back rather than blanking it', async () => {
        process.env.AI_PROVIDER = 'gemini';
        findOne.mockResolvedValue({ key: 'appsettings', values: { AI_PROVIDER: '' } });

        const { loadConfig } = await freshConfig();

        // '' must not win: the settings UI clears a value by saving an empty string, and the
        // intent there is "unset", not "set to nothing".
        expect((await loadConfig()).AI_PROVIDER).toBe('gemini');
    });

    it('ignores keys that are not in the schema', async () => {
        findOne.mockResolvedValue({
            key: 'appsettings',
            values: { NOT_A_REAL_SETTING: 'injected', AI_PROVIDER: 'siray' },
        });

        const { loadConfig } = await freshConfig();
        const config = await loadConfig();

        // A stale or hand-edited document must not be able to introduce arbitrary config.
        expect(config.NOT_A_REAL_SETTING).toBeUndefined();
        expect(config.AI_PROVIDER).toBe('siray');
    });

    it('resolves from the environment instead of throwing when the database is down', async () => {
        dbThrows = true;
        process.env.AI_PROVIDER = 'gemini';

        const { loadConfig } = await freshConfig();

        // Every page reads config; a database blip must not take the whole app down with it.
        await expect(loadConfig()).resolves.toMatchObject({ AI_PROVIDER: 'gemini' });
    });
});

describe('getConfigNumber', () => {
    it('parses a stored number', async () => {
        findOne.mockResolvedValue({ key: 'appsettings', values: { SCREENER_UNIVERSE_SIZE: '30' } });

        const { getConfigNumber } = await freshConfig();

        expect(await getConfigNumber('SCREENER_UNIVERSE_SIZE', 12)).toBe(30);
    });

    it.each([
        ['a non-numeric string', 'twelve'],
        ['zero', '0'],
        ['a negative number', '-5'],
    ])('falls back for %s rather than producing a broken scan size', async (_label, stored) => {
        findOne.mockResolvedValue({ key: 'appsettings', values: { SCREENER_UNIVERSE_SIZE: stored } });

        const { getConfigNumber } = await freshConfig();

        // Each of these would otherwise become a screener asking for 0 or NaN symbols, which
        // renders as an empty panel with no explanation.
        expect(await getConfigNumber('SCREENER_UNIVERSE_SIZE', 12)).toBe(12);
    });

    it('treats an empty stored value as unset, so the schema default beats the caller fallback', async () => {
        findOne.mockResolvedValue({ key: 'appsettings', values: { SCREENER_UNIVERSE_SIZE: '' } });

        const { getConfigNumber } = await freshConfig();

        // Clearing a field saves '', and the intent there is "unset" — so the value is ignored and the
        // schema default applies. The caller's fallback is only reached when there is no default
        // either, which is why this is 100 and not the 12 passed in. The two are both usable scan
        // sizes; the failure this guards against is 0 or NaN, which renders as an empty panel.
        expect(await getConfigNumber('SCREENER_UNIVERSE_SIZE', 12)).toBe(100);
    });
});

describe('the default AI report prompt', () => {
    it('sends the briefing through the playbooks instead of general knowledge', async () => {
        const { DEFAULT_REPORT_PROMPT } = await freshConfig();

        // The report runs with nobody watching, so "use the methodology" has to be stated in the
        // prompt — a model asked for a market backdrop will otherwise write one from memory, which is
        // the exact failure the rest of this system is built to prevent.
        expect(DEFAULT_REPORT_PROMPT).toContain('get_analysis_playbook');
        expect(DEFAULT_REPORT_PROMPT).toContain('market-breadth-analyzer');
        expect(DEFAULT_REPORT_PROMPT).toContain('crypto-regime-analyzer');

        // And a playbook that will not load degrades to "unavailable" rather than to the model's own
        // view of the market.
        expect(DEFAULT_REPORT_PROMPT).toMatch(/unavailable instead of/);
    });
});
