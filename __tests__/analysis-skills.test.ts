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

    it('reads a real playbook body end to end', async () => {
        process.env.ANALYSIS_SKILLS_DIR = REAL_SKILLS_DIR;
        resetAnalysisSkillCache();

        const document = await loadAnalysisSkill('position-sizer');
        expect(document?.body.length).toBeGreaterThan(500);

        delete process.env.ANALYSIS_SKILLS_DIR;
    });
});
