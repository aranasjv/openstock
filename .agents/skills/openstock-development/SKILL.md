---
name: openstock-development
description: Implement, review or refactor code in the OpenStock Next.js 15 App Router codebase — server actions, runtime config, the AI provider/tool layer, screener strategies, jobs and Telegram. Use when adding a feature, changing architecture, wiring a new data source or integration, or reviewing a diff for architecture and performance gaps. Encodes this repo's invariants and extension recipes.
license: MIT. Performance rules distilled from vercel-labs/agent-skills (MIT).
metadata:
  author: openstock
  version: "1.0.0"
  adapted-from: https://github.com/vercel-labs/agent-skills
---

# OpenStock Development

How to change this codebase without breaking the things that make it work. Read `AGENTS.md`
at the repo root first — it is the canonical source for architecture and gotchas; this skill
is the working procedure.

## The invariants — check every change against these

1. **Config is read at request time.** Never `process.env.X` at module scope. Add the key to
   `CONFIG_SCHEMA` in `lib/config.ts` and read via `loadConfig()` / `getConfigValue()` /
   `getConfigNumber()`. Mark bootstrap-only values `runtimeEditable: false`.
2. **`loadConfig()` never throws.** It degrades to env/defaults with no database — that is
   what makes the DB-free build possible. Do not add a throw to that path.
3. **Server modules import `server-only`.** If a module must not reach the browser, say so
   with the import; the build then fails rather than leaking a key.
4. **Every export in a `'use server'` file is an async function.** A sync helper — even a test
   helper — breaks the build. Put it in its own module (see `lib/screener-cache.ts`).
5. **Server actions authenticate and scope.** Resolve the session inside the action and filter
   by `userId`; actions are callable directly, so the page's check is not enough.
6. **`instrumentation.ts` imports no Node builtins.** It is compiled for the edge runtime too
   (middleware); a `node:net`/`node:dns` import there crashes every matched route.
7. **Ranking stays deterministic.** `lib/strategies.ts` decides what appears and in what order.
   AI writes explanations only.
8. **The assistant's tools are read-only**, and personal ones take `ctx.userId`.
9. **Tests are hermetic.** Mock `@/lib/config` and stub every network call; never touch Mongo
   or the internet.
10. **The build must succeed with no database** — verify it, don't assume.

## Extension recipes

### Add a config setting
`lib/config.ts` → push a `SettingDef` into `CONFIG_SCHEMA` with `key`, `group`, `label`,
`env`, `default`, and `type`/`options` if it is a select. It appears at `/settings`
automatically. If it must not change at runtime, set `runtimeEditable: false` and read it
before the first request.

### Add an assistant tool
`lib/ai-tools.ts` → append an `AITool` with `spec` (JSON Schema `parameters`) and an `execute`
that lazily imports its data module (so importing the registry does not trigger network I/O).
Keep it read-only; for personal data, filter by `ctx.userId` and note why in the comment.
Add a case to `__tests__/ai-tools.test.ts` for argument validation and scoping.

### Add a screener strategy
`lib/strategies.ts` → add a `StrategyDef` to `STRATEGIES` with 3 criteria that read the
`IndicatorBundle`, each with a human `detail` string. Add its id to `StrategyId`. The UI
dropdown, the digest and the assistant tool pick it up from `STRATEGIES` automatically. Add a
case to `__tests__/strategies.test.ts`.

### Add a page
`app/(root)/<name>/page.tsx`. Get `session` from `getAuth()` and `redirect('/sign-in')` when
absent. Keep it dynamic (use `searchParams`/`headers`) so nothing prerenders against a DB.
Dashboards must fill the viewport with internally-scrolling panels — see the
`finance-dashboard-ux` skill.

### Add a background job
Write the body under `lib/jobs/<name>.ts` and call it from **both** `lib/scheduler.ts`
(`runDueJobs`) and `lib/inngest/functions.ts`. Never fork the logic — one trigger firing and
the other not is the worst bug in an alerting feature. Record the run and its outcome so
`/api/health` reports it: `setLastRun` then `recordJobOutcome`.

### Add a data source
Put it in `lib/actions/<source>.actions.ts`. Rules learned the hard way:
- Serialise rate-limited providers (see the request gate in `crypto.actions.ts`); honour
  `Retry-After` on 429 with capped backoff.
- Cache with `next: { revalidate }` for history, and add a bounded TTL cache for derived
  results (`lib/screener-cache.ts` is the pattern).
- Return `null` and degrade one symbol, never throw the whole page.
- Read base URL and key from config, not `process.env`.

### Add a Telegram notification
Format it in `lib/notifications.ts` (pure, testable) and send with `sendTelegramMessage`,
passing the right `audience` — stocks and crypto go to **separate bots**. Escape every
interpolated value with `escapeTelegramHtml`; an unescaped `&` makes Telegram reject the
whole message.

## Performance rules that matter here

Distilled from Vercel's React/Next.js guidance, mapped to this repo's patterns.

**Waterfalls (critical).** Independent awaits must be parallel: `Promise.all([...])`. The
dashboards do this (`getCryptoMarkets` + `searchCrypto`). Before adding an `await`, ask
whether it can join an existing `Promise.all`. Move an `await` into the branch that uses it.

**Bundle size (critical).** Import directly, not from a barrel. Use `next/dynamic` for heavy
client components. Load analytics after hydration. `cn()` and lucide icons are already
tree-shakeable — do not add a barrel that defeats it.

**Server-side (high).**
- Authenticate every server action (invariant 5).
- `React.cache()` for per-request dedup (`searchCrypto = cache(...)` is the pattern).
- Module-level mutable state must not hold *request* state. Cross-request caches
  (`rate-limit.ts`, `screener-cache.ts`) are fine but must be documented as per-container.
- Pass the minimum data to client components — serialise lean DTOs, not whole Mongoose docs.
- Hoist static I/O (font URLs, logos, `scriptUrl`) to module scope.

**Client data (medium-high).** Deduplicate global listeners; use passive scroll listeners;
version anything in `localStorage`.

**Re-renders (medium).** Derive state during render instead of syncing with `useEffect`;
use functional `setState` for stable callbacks; don't define components inside components;
`startTransition` for non-urgent updates (the chat panel uses `useTransition` correctly).
Note: `components/assistant/ChatPanel.tsx` has a known `exhaustive-deps` warning (a
deliberate one — it resets the transcript on conversation change). Don't "fix" it by adding
the dependency; use a `key` or a reducer if you must silence it.

**Rendering (medium).** Ternary, not `&&`, for conditional render. Respect
`prefers-reduced-motion`.

## Verification loop — run before every commit

```bash
npm test                     # hermetic unit tests — must be green
npx tsc --noEmit             # the build ignores TS errors, so check here
npm run build                # with a bogus MONGODB_URI; must succeed DB-free
docker compose up -d --build # then: curl -s localhost:3000/api/health
```

`npm run lint` is **not** a valid signal — `main` has pre-existing errors. Do not gate on it.

## Anti-patterns to reject in review

- `process.env` at module scope for anything configurable.
- A new write-capable assistant tool without a deliberate decision to widen the risk surface.
- Sequential awaits over a list where `Promise.all` (or `mapWithConcurrency`) applies.
- A new `useEffect` that syncs state another effect already derives.
- New in-process caches or locks without a note about multi-replica behaviour.
- Adding a dependency for something the repo already implements (`lib/indicators.ts` is
  intentionally hand-rolled and tested; `lib/config.ts` replaces dotenv-style config).
- Bypassing the request gate for a rate-limited provider because "it felt slow".
