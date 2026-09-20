import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The loader behind the assistant's analysis playbooks.
 *
 * Two layers are tested separately: the frontmatter reader (pure), and the catalogue/loader
 * against a throwaway fixture tree so the assertions do not depend on which upstream skills
 * happen to be vendored. One test does check the real `.agents/skills` — that is the guard
 * against vendoring silently breaking.
 */

import {
    parseFrontmatter,
    listAnalysisSkills,
    getAnalysisSkillSummary,
    loadAnalysisSkill,
    resetAnalysisSkillCache,
    MAX_PLAYBOOK_CHARS,
    getPlaybookBridge,
    renderPlaybook,
} from '@/lib/analysis-skills';

const REAL_SKILLS_DIR = path.join(process.cwd(), '.agents', 'skills');

describe('parseFrontmatter', () => {
    it('reads a single-line description', () => {
        const raw = '---\nname: foo\ndescription: A short one.\n---\n\n# Body\n';
        expect(parseFrontmatter(raw)).toEqual({ name: 'foo', description: 'A short one.' });
    });

    it('folds a >- block description onto one line', () => {
        const raw = '---\nname: foo\ndescription: >-\n  First part\n  second part.\n---\n';
        expect(parseFrontmatter(raw).description).toBe('First part second part.');
    });

    it('strips surrounding quotes', () => {
        const raw = '---\nname: "foo"\ndescription: \'quoted\'\n---\n';
        expect(parseFrontmatter(raw)).toEqual({ name: 'foo', description: 'quoted' });
    });

    it('stops the description at the next top-level key', () => {
        const raw = '---\nname: foo\ndescription: >-\n  folded\nlicense: MIT\n---\n';
        expect(parseFrontmatter(raw).description).toBe('folded');
    });

    it('returns empty values when there is no frontmatter', () => {
        expect(parseFrontmatter('# Just a heading\n')).toEqual({ name: '', description: '' });
    });

    it('reads a CRLF file whose description is the last frontmatter line', () => {
        // Regression: the trailing \r broke the line match, so every upstream skill vendored
        // with CRLF endings reported an empty description.
        const raw = '---\r\nname: foo\r\ndescription: Windows line endings.\r\n---\r\n\r\n# Body\r\n';
        expect(parseFrontmatter(raw)).toEqual({ name: 'foo', description: 'Windows line endings.' });
    });
});

describe('analysis skill catalogue', () => {
    let fixture: string;

    beforeEach(async () => {
        fixture = await mkdtemp(path.join(tmpdir(), 'skills-'));
        process.env.ANALYSIS_SKILLS_DIR = fixture;
        resetAnalysisSkillCache();
    });

    afterEach(async () => {
        delete process.env.ANALYSIS_SKILLS_DIR;
        resetAnalysisSkillCache();
        await rm(fixture, { recursive: true, force: true });
    });

    async function addSkill(name: string, description = 'Does a thing.') {
        const dir = path.join(fixture, name);
        await mkdir(path.join(dir, 'references'), { recursive: true });
        await writeFile(
            path.join(dir, 'SKILL.md'),
            `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody of ${name}.\n`
        );
        await writeFile(path.join(dir, 'references', 'deep.md'), `Deep reference for ${name}.\n`);
        return dir;
    }

    it('lists every directory that has a valid SKILL.md', async () => {
        await addSkill('alpha');
        await addSkill('beta');

        const skills = await listAnalysisSkills();
        expect(skills.map((skill) => skill.id)).toEqual(['alpha', 'beta']);
        expect(skills[0].references).toEqual(['references/deep.md']);
    });

    it('skips a skill whose declared name does not match its directory', async () => {
        await addSkill('alpha');
        const bad = path.join(fixture, 'gamma');
        await mkdir(bad, { recursive: true });
        await writeFile(path.join(bad, 'SKILL.md'), '---\nname: something-else\ndescription: x\n---\n');

        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const skills = await listAnalysisSkills();
        consoleSpy.mockRestore();

        expect(skills.map((skill) => skill.id)).toEqual(['alpha']);
    });

    it('ignores directories without a SKILL.md and unsafe directory names', async () => {
        await addSkill('alpha');
        await mkdir(path.join(fixture, 'not-a-skill'), { recursive: true });
        await mkdir(path.join(fixture, 'Bad_Name'), { recursive: true });

        const skills = await listAnalysisSkills();
        expect(skills.map((skill) => skill.id)).toEqual(['alpha']);
    });

    it('loads the body with the frontmatter removed', async () => {
        await addSkill('alpha');
        const document = await loadAnalysisSkill('alpha');

        expect(document?.name).toBe('alpha');
        expect(document?.body).toContain('# alpha');
        expect(document?.body).not.toContain('name: alpha');
    });

    it('loads a listed reference document', async () => {
        await addSkill('alpha');
        const document = await loadAnalysisSkill('alpha', 'references/deep.md');
        expect(document?.body).toContain('Deep reference for alpha.');
    });

    it('refuses a section that is not part of the skill', async () => {
        await addSkill('alpha');
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const document = await loadAnalysisSkill('alpha', '../../../package.json');
        consoleSpy.mockRestore();
        expect(document).toBeNull();
    });

    it('rejects an id that is not a safe directory name', async () => {
        expect(await getAnalysisSkillSummary('../secrets')).toBeNull();
        expect(await loadAnalysisSkill('..')).toBeNull();
    });

    it('returns null for an unknown id instead of throwing', async () => {
        await addSkill('alpha');
        expect(await loadAnalysisSkill('nope')).toBeNull();
    });

    it('degrades to an empty catalogue when the directory is missing', async () => {
        process.env.ANALYSIS_SKILLS_DIR = path.join(fixture, 'does-not-exist');
        resetAnalysisSkillCache();

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const skills = await listAnalysisSkills();
        consoleSpy.mockRestore();

        expect(skills).toEqual([]);
    });
});

describe('the vendored playbooks', () => {
    afterEach(() => {
        resetAnalysisSkillCache();
    });

    it('has a parseable SKILL.md for every vendored skill', async () => {
        process.env.ANALYSIS_SKILLS_DIR = REAL_SKILLS_DIR;
        resetAnalysisSkillCache();

        const skills = await listAnalysisSkills();

        // 20 analysis playbooks + 3 development/design skills.
        expect(skills.length).toBeGreaterThanOrEqual(23);
        for (const skill of skills) {
            expect(skill.description.length).toBeGreaterThan(0);
        }

        delete process.env.ANALYSIS_SKILLS_DIR;
    });

    it('includes the playbooks the assistant is told about', async () => {
        process.env.ANALYSIS_SKILLS_DIR = REAL_SKILLS_DIR;
        resetAnalysisSkillCache();

        const ids = (await listAnalysisSkills()).map((skill) => skill.id);
        expect(ids).toContain('position-sizer');
        expect(ids).toContain('crypto-regime-analyzer');
        expect(ids).toContain('technical-analyst');
        expect(ids).toContain('vercel-react-best-practices');

        delete process.env.ANALYSIS_SKILLS_DIR;
    });

    it('fits every vendored playbook inside the chat budget', async () => {
        process.env.ANALYSIS_SKILLS_DIR = REAL_SKILLS_DIR;
        resetAnalysisSkillCache();

        const oversized: string[] = [];
        for (const skill of await listAnalysisSkills()) {
            const document = await loadAnalysisSkill(skill.id);
            // The chat sends the body inside a JSON envelope, so leave headroom for it.
            if ((document?.body.length ?? 0) + 500 > MAX_PLAYBOOK_CHARS) oversized.push(skill.id);
        }

        delete process.env.ANALYSIS_SKILLS_DIR;
        // Guards the bug this caught: two playbooks were larger than the old 24k budget and
        // were being silently truncated mid-procedure.
        expect(oversized).toEqual([]);
    });

    it('reads a real playbook body end to end', async () => {
        process.env.ANALYSIS_SKILLS_DIR = REAL_SKILLS_DIR;
        resetAnalysisSkillCache();

        const document = await loadAnalysisSkill('position-sizer');
        expect(document?.body.length).toBeGreaterThan(500);

        delete process.env.ANALYSIS_SKILLS_DIR;
    });
});

describe('the playbook bridge', () => {
    // The playbooks were written for a CLI agent with Python; without the bridge the model
    // reads "python3 scripts/..." and either claims a run that never happened or stalls.
    it('tells every vendored playbook which tools replace the scripts', async () => {
        process.env.ANALYSIS_SKILLS_DIR = REAL_SKILLS_DIR;
        resetAnalysisSkillCache();

        for (const skill of await listAnalysisSkills()) {
            const bridge = getPlaybookBridge(skill.id);

            expect(bridge).toContain('cannot execute anything');
            expect(bridge).toContain('get_indicators');
            expect(bridge).toContain('run_screener');
            // The rule that matters most: a missing input is never estimated.
            expect(bridge).toMatch(/not\s+available|missing input/);
        }

        delete process.env.ANALYSIS_SKILLS_DIR;
    });

    it('names the specific gap for playbooks whose data is genuinely absent', () => {
        // Two of six crypto components need sources this app does not have.
        expect(getPlaybookBridge('crypto-regime-analyzer')).toMatch(/dominance/i);
        expect(getPlaybookBridge('crypto-regime-analyzer')).toMatch(/funding/i);

        // Scoring three of seven CANSLIM components would look like a score and mean nothing.
        expect(getPlaybookBridge('canslim-screener')).toMatch(/not assessed/i);

        // The breadth series is not integrated; a proxy must be labelled as one.
        expect(getPlaybookBridge('market-breadth-analyzer')).toMatch(/proxy/i);

        // This one is a pure function of a ledger that does not exist.
        expect(getPlaybookBridge('drawdown-circuit-breaker')).toMatch(/cannot (be evaluated|assess)/i);

        // Sizing arithmetic must be shown, not asserted.
        expect(getPlaybookBridge('position-sizer')).toMatch(/step by step/i);
    });

    it('falls back to the generic bridge for a playbook with no specific note', () => {
        const bridge = getPlaybookBridge('technical-analyst');
        expect(bridge).toContain('cannot execute anything');
        expect(bridge).not.toMatch(/not integrated here/);
    });

    it('prepends the bridge to the body, and can be told not to', async () => {
        process.env.ANALYSIS_SKILLS_DIR = REAL_SKILLS_DIR;
        resetAnalysisSkillCache();

        const document = (await loadAnalysisSkill('position-sizer'))!;
        const rendered = renderPlaybook(document);

        expect(rendered.startsWith('## Running this playbook in OpenStock')).toBe(true);
        expect(rendered).toContain(document.body);
        expect(renderPlaybook(document, { withBridge: false })).toBe(document.body);

        delete process.env.ANALYSIS_SKILLS_DIR;
    });
});
