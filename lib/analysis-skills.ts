import 'server-only';

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Access to the analysis playbooks in `.agents/skills/`.
 *
 * These are **vendored verbatim from upstream** (see `.agents/UPSTREAM.md`): real,
 * complete Agent Skills — tradermonty/claude-trading-skills, vercel-labs/agent-skills and
 * anthropics/skills, all MIT. They are not summaries; the full methodology is on disk and is
 * read here rather than reimplemented.
 *
 * The same files serve two consumers:
 *   1. an agent working in this repo, which loads them by description (progressive
 *      disclosure — only the frontmatter is in context until the skill activates);
 *   2. the running app, which reads them through this module so the assistant's chat can
 *      pull the relevant playbook and the "Explain" action can be driven by one.
 *
 * One source of truth, read at request time. Adding or removing a skill directory needs no
 * code change — the catalogue is a directory scan.
 */

/**
 * Resolved at call time, not module load, so tests (and unusual deployments) can point it
 * elsewhere. In the container this is `/app/.agents/skills`, which the Dockerfile copies in;
 * without that COPY the standalone build has no `.agents` directory at all.
 */
function skillsRoot(): string {
    return process.env.ANALYSIS_SKILLS_DIR || path.join(process.cwd(), '.agents', 'skills');
}

export interface AnalysisSkillSummary {
    /** Directory name; equals the frontmatter `name`, which the loader enforces. */
    id: string;
    name: string;
    description: string;
    /** Relative paths of extra documents inside the skill, e.g. `references/x.md`. */
    references: string[];
    /** True when the skill ships executable helpers (Python) that this app does not run. */
    hasScripts: boolean;
}

export interface AnalysisSkillDocument {
    id: string;
    name: string;
    description: string;
    /** The document body with the YAML frontmatter removed. */
    body: string;
}

/** Ids are directory names, so they must never escape the skills root. */
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;

/** Documents a skill may expose besides SKILL.md. */
const REFERENCE_DIRS = ['references', 'assets'];

/**
 * How much of a playbook may be handed to the model in one go.
 *
 * A truncated methodology is worse than none — the model follows half a procedure and reports
 * it as done — so this must exceed the largest vendored SKILL.md. It currently does so
 * comfortably (the largest is `market-news-analyst` at ~27.8KB); the test suite asserts that
 * every vendored playbook fits, so vendoring a bigger skill fails loudly rather than silently
 * clipping it.
 */
export const MAX_PLAYBOOK_CHARS = 32_000;

interface Frontmatter {
    name: string;
    description: string;
}

/**
 * Minimal YAML frontmatter reader: enough for `name`, and `description` in both the plain
 * and `>-` folded-block forms. Deliberately not a YAML parser — the schema here is fixed and
 * a dependency would be overkill.
 */
export function parseFrontmatter(raw: string): Frontmatter {
    // Normalise line endings first. On a CRLF file the last frontmatter line keeps a trailing
    // carriage return, and `$` does not match before `\r` — so `description` silently came
    // back empty for every skill whose description was the final frontmatter line.
    const text = raw.replace(/\r\n/g, '\n');

    if (!text.startsWith('---')) return { name: '', description: '' };

    const end = text.indexOf('\n---', 3);
    if (end === -1) return { name: '', description: '' };

    const lines = text.slice(3, end).split('\n');
    let name = '';
    let description = '';
    const folded: string[] = [];
    let inDescription = false;

    for (const line of lines) {
        const key = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line);

        if (key) {
            // A new top-level key ends the previous block-scalar description.
            if (inDescription) break;
            inDescription = false;

            if (key[1] === 'name') {
                name = key[2].trim().replace(/^["']|["']$/g, '');
            } else if (key[1] === 'description') {
                const value = key[2].trim();
                if (value === '>-' || value === '>' || value === '|' || value === '|-') {
                    inDescription = true;
                } else {
                    description = value.replace(/^["']|["']$/g, '');
                }
            }
            continue;
        }

        if (inDescription && /^\s+\S/.test(line)) folded.push(line.trim());
    }

    if (folded.length > 0) {
        description = `${description} ${folded.join(' ')}`.trim();
    }

    return { name, description: description.replace(/\s+/g, ' ').trim() };
}

/** Split the frontmatter off, leaving the instruction body. */
function stripFrontmatter(raw: string): string {
    const text = raw.replace(/\r\n/g, '\n');
    if (!text.startsWith('---')) return text;
    const end = text.indexOf('\n---', 3);
    if (end === -1) return text;
    return text.slice(end + 4).replace(/^\s*\n/, '');
}

// ── Cache ──────────────────────────────────────────────────────────
//
// Reading a dozen small files on every chat turn is wasteful, and the contents cannot change
// while the process runs (a deploy replaces the container). Per-process, like the other
// caches in this repo.

interface Catalogue {
    root: string;
    skills: AnalysisSkillSummary[];
    byId: Map<string, AnalysisSkillSummary>;
}

let catalogue: Catalogue | null = null;
const documentCache = new Map<string, AnalysisSkillDocument>();

/** Test helper: the cache is process-global. */
export function resetAnalysisSkillCache(): void {
    catalogue = null;
    documentCache.clear();
}

async function listReferences(dir: string): Promise<string[]> {
    const found: string[] = [];

    for (const referenceDir of REFERENCE_DIRS) {
        const full = path.join(dir, referenceDir);
        let entries: string[];
        try {
            entries = await readdir(full);
        } catch {
            continue; // directory absent — normal for a knowledge-only skill
        }

        for (const entry of entries) {
            if (entry.startsWith('.')) continue;
            const entryPath = path.join(full, entry);
            const info = await stat(entryPath).catch(() => null);
            if (info?.isFile()) found.push(`${referenceDir}/${entry}`);
        }
    }

    return found.sort();
}

async function buildCatalogue(): Promise<Catalogue> {
    const root = skillsRoot();
    const skills: AnalysisSkillSummary[] = [];
    const byId = new Map<string, AnalysisSkillSummary>();

    let entries: string[] = [];
    try {
        const dirents = await readdir(root, { withFileTypes: true });
        entries = dirents.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
        // A missing directory is not fatal: the app still runs, it just has no playbooks.
        console.error(`Analysis skills: could not read ${root}:`, error);
        return { root, skills, byId };
    }

    for (const id of entries.sort()) {
        if (!SAFE_ID.test(id)) continue;

        const dir = path.join(root, id);
        const raw = await readFile(path.join(dir, 'SKILL.md'), 'utf8').catch(() => null);
        if (raw === null) continue;

        const { name, description } = parseFrontmatter(raw);
        // The Agent Skills spec requires the declared name to equal the directory name; a
        // mismatch would be skipped by other tools, so surface it here rather than hiding it.
        if (name && name !== id) {
            console.warn(`Analysis skills: "${id}" declares name "${name}"; skipping.`);
            continue;
        }

        const hasScripts = await stat(path.join(dir, 'scripts'))
            .then((info) => info.isDirectory())
            .catch(() => false);

        const summary: AnalysisSkillSummary = {
            id,
            name: name || id,
            description,
            references: await listReferences(dir),
            hasScripts,
        };

        skills.push(summary);
        byId.set(id, summary);
    }

    return { root, skills, byId };
}

async function getCatalogue(): Promise<Catalogue> {
    if (catalogue && catalogue.root === skillsRoot()) return catalogue;
    catalogue = await buildCatalogue();
    return catalogue;
}

/** Every vendored playbook, ordered by id. */
export async function listAnalysisSkills(): Promise<AnalysisSkillSummary[]> {
    return (await getCatalogue()).skills;
}

export async function getAnalysisSkillSummary(id: string): Promise<AnalysisSkillSummary | null> {
    if (!SAFE_ID.test(id)) return null;
    return (await getCatalogue()).byId.get(id) ?? null;
}

/**
 * Load a playbook, or one of its reference documents.
 *
 * `section` is a path relative to the skill directory and must be one of the skill's listed
 * references — an arbitrary path is rejected, so this cannot be used to read outside the
 * skills root.
 */
export async function loadAnalysisSkill(
    id: string,
    section?: string
): Promise<AnalysisSkillDocument | null> {
    const summary = await getAnalysisSkillSummary(id);
    if (!summary) return null;

    const relative = section ? section : 'SKILL.md';

    if (section && !summary.references.includes(section)) {
        console.warn(`Analysis skills: "${id}" has no reference "${section}".`);
        return null;
    }

    const cacheKey = `${id}::${relative}`;
    const cached = documentCache.get(cacheKey);
    if (cached) return cached;

    const file = path.join(skillsRoot(), id, relative);
    // Defence in depth: resolve, then confirm the result is still inside the skill directory.
    const resolved = path.resolve(file);
    if (!resolved.startsWith(path.resolve(skillsRoot(), id) + path.sep)) {
        console.warn(`Analysis skills: refused out-of-tree path for "${id}/${relative}".`);
        return null;
    }

    const raw = await readFile(resolved, 'utf8').catch(() => null);
    if (raw === null) return null;

    const document: AnalysisSkillDocument = {
        id,
        name: summary.name,
        description: summary.description,
        body: stripFrontmatter(raw),
    };

    documentCache.set(cacheKey, document);
    return document;
}
