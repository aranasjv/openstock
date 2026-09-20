# AGENTS.md

Working notes for anyone — human or agent — changing this codebase. Read this before
touching anything; several of the rules below exist because breaking them has already caused
a real bug. `README.md` is the user-facing pitch; this file is the engineering reality.

## What this is

OpenStock — a stock **and crypto** market dashboard. Next.js 15 (App Router) + React 19 +
Tailwind v4, MongoDB/Mongoose, Better Auth, Inngest, TradingView widgets. It is not a
brokerage and nothing in it is financial advice.

## Commands

```bash
npm run dev        # dev server (Turbopack)
npm run build      # production build (Turbopack) — must work with NO database
npm start          # run the production server (standalone output)
npm test           # vitest (hermetic; never touches the network or MongoDB)
npm run test:db    # one-off MongoDB connectivity check
npm run lint       # eslint — see "Known debt" below before trusting a clean run
docker compose up -d --build   # app + MongoDB
```

## Skills

[`.agents/skills/`](.agents/skills/) contains **23 complete upstream Agent Skills, vendored
verbatim** — not summaries. Load one with `/<name>` or let it activate by description; read
the relevant one **before** starting work in its area.

Provenance, licences, the exact upstream commits, and the list of what was deliberately *not*
vendored are in [`.agents/UPSTREAM.md`](.agents/UPSTREAM.md). Read it before editing anything
under `.agents/`. Refresh with `git clone --depth 1` + `cp -r`.

**The playbooks are CLI-shaped; the app is not.** 17 of the 23 `SKILL.md` files instruct the
agent to run `python3 scripts/*.py` and to read/write `state/` and `reports/`. The runtime image
is `node:20-alpine` — there is **no Python and no writable state directory**. Those scripts are
*reference implementations* and are never executed; when the assistant applies a playbook it has
to map the steps onto `lib/ai-tools.ts` tools (or a `lib/` port). That bridge does not exist yet,
which is why a naive `get_analysis_playbook` call can leave the model describing a script it
cannot run. See §2.1 of [`PROJECT_REVIEW.md`](PROJECT_REVIEW.md).

### Analysis playbooks (tradermonty/claude-trading-skills, MIT)

| Skill | Use it for |
|---|---|
| [`crypto-regime-analyzer`](.agents/skills/crypto-regime-analyzer/SKILL.md) | Crypto risk-on/risk-off, BTC dominance, funding rates, alt-season reads. |
| [`market-breadth-analyzer`](.agents/skills/market-breadth-analyzer/SKILL.md) / [`uptrend-analyzer`](.agents/skills/uptrend-analyzer/SKILL.md) | Breadth and participation — is a rally broad-based. |
| [`exposure-coach`](.agents/skills/exposure-coach/SKILL.md) | Net-exposure ceiling and new-entry-allowed vs cash-priority posture. |
| [`market-environment-analysis`](.agents/skills/market-environment-analysis/SKILL.md) / [`market-news-analyst`](.agents/skills/market-news-analyst/SKILL.md) | Global macro/risk-on-off environment; impact-ranked news review. |
| [`technical-analyst`](.agents/skills/technical-analyst/SKILL.md) | Trend, support/resistance, scenario planning, invalidation levels. |
| [`us-stock-analysis`](.agents/skills/us-stock-analysis/SKILL.md) | Full single-name review (fundamentals + technicals + report). |
| [`vcp-screener`](.agents/skills/vcp-screener/SKILL.md) / [`canslim-screener`](.agents/skills/canslim-screener/SKILL.md) | Minervini VCP and O'Neil CANSLIM setups — the methodologies `lib/strategies.ts` draws on. |
| [`breakout-trade-planner`](.agents/skills/breakout-trade-planner/SKILL.md) | Entry/stop/target plans from screener output. |
| [`position-sizer`](.agents/skills/position-sizer/SKILL.md) / [`pre-trade-discipline-gate`](.agents/skills/pre-trade-discipline-gate/SKILL.md) / [`drawdown-circuit-breaker`](.agents/skills/drawdown-circuit-breaker/SKILL.md) | Risk-first sizing, the pre-trade checklist, account-level cooldowns. |
| [`trader-memory-core`](.agents/skills/trader-memory-core/SKILL.md) / [`signal-postmortem`](.agents/skills/signal-postmortem/SKILL.md) / [`trade-performance-coach`](.agents/skills/trade-performance-coach/SKILL.md) / [`weekly-performance-digest`](.agents/skills/weekly-performance-digest/SKILL.md) | Thesis lifecycle, post-trade review, process-vs-outcome coaching, expectancy. |
| [`backtest-expert`](.agents/skills/backtest-expert/SKILL.md) | Validating a strategy before trusting it — the screener is currently un-backtested. |
| [`earnings-calendar`](.agents/skills/earnings-calendar/SKILL.md) | Event-risk dates. |

### Development and design

| Skill | Use it for |
|---|---|
| [`vercel-react-best-practices`](.agents/skills/vercel-react-best-practices/SKILL.md) | Writing, reviewing or refactoring React/Next.js — waterfalls, bundle, server-side performance, re-renders. |
| [`web-design-guidelines`](.agents/skills/web-design-guidelines/SKILL.md) | UI/accessibility/UX review of a file or pattern. |
| [`frontend-design`](.agents/skills/frontend-design/SKILL.md) | Aesthetic direction when building or reshaping UI. |

Upstream ships Python helpers inside most trading skills. **This app does not run them** —
there is no Python runtime in the image. They are vendored because they are part of the skill
and document exactly how each method computes its numbers.

### The same playbooks drive the app

The skills are not just for agents editing the repo — the running app reads the same files
through [`lib/analysis-skills.ts`](lib/analysis-skills.ts), so its AI uses the real
methodology rather than a paraphrase:

- **Chat** — the assistant's system prompt lists every playbook, and the
  `get_analysis_playbook` tool pulls one on demand (`lib/ai-chat.ts`, `lib/ai-tools.ts`).
  Playbook reads get a larger result budget than ordinary data because a half-read
  methodology is useless.
- **Explain** — `/settings → Explain: analysis playbook` (`ANALYSIS_PLAYBOOK`) makes the
  screener's per-candidate "Explain" action use a chosen playbook as its system prompt,
  capped at 12k chars and always wrapped in the app's not-advice guard
  (`explainCandidate` in `lib/actions/screener.actions.ts`).
- `/api/health` reports the number of playbooks it loaded, so a deployment that failed to
  ship `.agents` is visible rather than silent. The **Dockerfile copies `.agents`** into the
  runtime image for exactly this reason — Next's standalone tracing follows imports, not
  directories read with `fs`.

The catalogue is a directory scan, cached per process: adding or removing a skill directory
needs no code change. Ids are validated (`^[a-z0-9][a-z0-9-]*$`) and reads are confined to the
skill's own directory, so the loader cannot be used to read outside `.agents/skills`.

Verify discovery with `cmdc skills list` — a malformed skill (name ≠ directory) is skipped
with a warning.

## Architecture map

```
app/(root)/            dashboards + detail pages. All are dynamic (searchParams/headers).
  page.tsx             stock dashboard (widgets + Must Buy screener)
  crypto/page.tsx      crypto dashboard
  assistant/page.tsx   AI assistant (conversations + chat)
  stocks/[symbol]/     stock detail
app/api/
  inngest/route.ts     Inngest serve endpoint
  health/route.ts      public liveness/readiness probe (DB + job status)
components/            UI. assistant/, screener/, crypto/, settings/, watchlist/ …
database/
  mongoose.ts          connection (cached on global), DNS/IPv4 fixups
  models/              Mongoose models (watchlist, alert, settings, conversation, …)
lib/
  config.ts            runtime configuration schema + loader   ← read this first
  ai-provider.ts       provider abstraction + tool-calling dialects
  ai-chat.ts           assistant tool loop + system prompt
  ai-tools.ts          the 10 read-only tools the assistant may call
  analysis-skills.ts   reads the vendored playbooks in .agents/skills for the app
  rate-limit.ts        in-process sliding-window limiter (AI spend)
  screener-cache.ts    in-process TTL cache of screener results
  strategies.ts        deterministic screener rules (the source of truth)
  indicators.ts        SMA/RSI/MACD/… from daily candles
  jobs/                alert-check.ts, daily-digest.ts (shared by scheduler + Inngest)
  scheduler.ts         in-process scheduler + persisted job state
  telegram.ts          two-bot Telegram delivery
  trading-framework.ts AI persona for explanations
__tests__/             vitest; each file is hermetic
```

## The config system — the thing to understand first

`lib/config.ts` resolves every setting at **request time**, in this order: saved value in
MongoDB → environment variable → declared default. This exists because `NEXT_PUBLIC_*` is
inlined at build time, so anything read from `process.env` at module scope cannot change
without a rebuild. Users edit keys at `/settings` and the change takes effect immediately.

Rules:
- **Never read a secret/config with `process.env.X` at module scope.** Add it to
  `CONFIG_SCHEMA` and read it with `loadConfig()` / `getConfigValue()` / `getConfigNumber()`.
- Mark values that genuinely cannot change at runtime `runtimeEditable: false` (e.g.
  `MONGODB_URI`, `BETTER_AUTH_SECRET`, `INNGEST_SIGNING_KEY`) — `saveConfig` rejects them.
- `loadConfig()` never throws: with no DB it degrades to env/defaults. That is what lets the
  production build run without a database. Keep it that way.
- `server-only` is imported by config and every server module; the build fails if one is
  pulled into a client bundle. Do not remove those imports.

## The AI layer

Three entry points, deliberately distinct:

1. `callAIProvider(prompt, provider?, options?)` — plain text completion (screener
   explanations, emails).
2. `callAIProviderWithFallback(...)` — as above, but switches provider on failure.
3. `callAIProviderWithTools(messages, tools, provider?, options?)` — one exchange with tool
   specs. **The caller drives the loop**; this only normalizes one request/response.

The assistant is the only thing that uses #3, via `runChatTurn` in `lib/ai-chat.ts`:
- Max **6** provider calls per turn, each tool **20s** timeout, tool output truncated. These
  bounds prevent runaway spend; do not remove them.
- Every tool failure (unknown tool, bad JSON args, thrown error) is returned to the model as
  text so it can adapt. A failed tool must never throw out of the loop.
- Tools in `lib/ai-tools.ts` are **read-only by design**. Personal tools take
  `ctx.userId` and filter by it. Do not add a tool that mutates user data without a
  deliberate decision to widen the risk surface.
- The system prompt forbids stating any market figure from memory and forbids advice. That
  anti-hallucination rule is the whole point of the feature — keep it.
- `runChatTurn` is wrapped by `sendMessage` in `lib/actions/assistant.actions.ts`, which
  rate-limits per user and is the only place conversations are persisted.

Provider dialects: OpenAI-compatible (DeepSeek, MiniMax, Siray) uses `tool_calls` +
`role: 'tool'`. Gemini uses `functionDeclarations` + `functionCall`/`functionResponse`.
Normalize **only** in `lib/ai-provider.ts`; nothing above it should know which provider ran.

## Market data & reliability

- **Stocks**: Finnhub for search/profile/quotes/news. Price **history** comes from Yahoo's
  unofficial chart endpoint (`YAHOO_CHART_BASE_URL`) because Finnhub candles need a paid
  plan. Treat it as unreliable — a failure marks one symbol unavailable, never the page.
- **Crypto**: CoinGecko. The free tier rate-limits hard, which is why
  `lib/actions/crypto.actions.ts` has a **serialized request gate** (2s spacing for
  `market_chart`, 250ms otherwise), 429 backoff honouring `Retry-After`, and a 6h cache on
  price history. Do not parallelize CoinGecko calls; that is what caused ~⅓ of a cold scan
  to fail. Prefer CoinGecko data/symbols over guessed values.
- The screener (`lib/actions/screener.actions.ts`) is cached for `SCREENER_CACHE_SECONDS`
  via `lib/screener-cache.ts`. Empty/degraded results are intentionally **not** cached so a
  transient rate-limit doesn't pin an empty dashboard for an hour.
- `lib/strategies.ts` is the deterministic ranking. AI only writes explanations; it must
  never change which assets appear or their order.

## Notifications & jobs

- Two Telegram bots, one per asset class (`TELEGRAM_STOCK_*`, `TELEGRAM_CRYPTO_*`), with a
  shared `TELEGRAM_BOT_TOKEN` as fallback. Never merge the two streams into one chat.
- `lib/jobs/*` hold the job bodies so the **in-process scheduler** and **Inngest** run
  identical logic. If you change one trigger, both get it — never fork the logic.
- Last-run and last-outcome are persisted in the `jobstate` collection
  (`lib/scheduler.ts`); `/api/health` reports them. A restart must not re-send the digest.
- `recordJobOutcome` logs **both** success and failure. Keeping jobs silent on success is how
  a digest that quietly stopped sending looked identical to one with nothing to send.
- Three jobs: `alerts` (interval), `digest` (daily, deterministic screen), and `report`
  (daily, **AI-written**, off unless `REPORT_ENABLED`). The report is `/assistant` run
  headlessly — `runChatTurn` with a standing prompt — so it inherits the tool surface and the
  playbooks. Two consequences: it needs a working AI provider key, and its output is
  `escapeTelegramHtml`-ed before sending, because model prose containing `&` or `<` otherwise
  makes Telegram reject the whole message.
- Jobs act as the **admin user** (`getAdminUserId()`), since chat ids are deployment-wide and
  there is no session. That is what makes "your holdings" resolvable in a scheduled run.

## Conventions

- Comments explain **why**, not what. The existing density is intentional — match it.
- Server actions live in `lib/actions/*.actions.ts` marked `'use server'`. In such a file
  **every export must be an async function** — a sync helper (even a test helper) breaks the
  build. Put non-action helpers in their own module (see `lib/screener-cache.ts`).
- **Personal data goes through two layers, and this is a security boundary, not style:**
  - `lib/data/*.ts` — `server-only`, **not** `'use server'`. Every function takes an explicit
    `userId` and resolves nothing. Safe only because it is unreachable from the browser.
  - `lib/actions/*.actions.ts` — `'use server'`. Resolves the session via
    `requireUserId()` (`lib/session.ts`) and passes *that* id down. It must never accept an
    identity from the caller.
  Why both: actions are callable directly (not only through the page), and the middleware
  only checks that a cookie is **present**, not valid — so the action is the only place that
  can tell who is really asking. The data layer keeps the explicit `userId` because the
  scheduled jobs (admin user) and the assistant tools (the signed-in user) legitimately act
  for someone else. A query that mutates must also filter by `userId`, not just `_id`.
  Covered by `__tests__/action-authorization.test.ts` and `__tests__/data-owner-scoping.test.ts`.
- `.actions.ts` transport only: `revalidatePath` belongs there, not in `lib/data/`.
- **Outbound HTTP goes through `fetchWithTimeout` (`lib/http.ts`).** `DEFAULT_TIMEOUT_MS` for
  data APIs, `AI_TIMEOUT_MS` for model calls — a slow generation is not a hang. The error it
  throws names the deadline but **never the URL**: Gemini and Kit put their API keys in the
  query string, so echoing the URL would write a secret into the logs and the UI.
- **Validate at the action boundary** with `lib/validate.ts` (`requireText`, `requireNumber`,
  `requireOneOf`, `isObjectId`). Actions are callable directly, so their arguments are untrusted
  even when they come from a signed-in user's own browser. Validate the shape before Mongoose
  sees it: a malformed `_id` throws a `CastError` that reaches the user as an opaque 500.
- **Never let an infrastructure failure read as "no data".** The readers in `lib/data/` throw;
  returning `[]`/`false` made an outage indistinguishable from an empty portfolio, and "you hold
  nothing" is a factual claim about someone's money. Pages fall through to `app/error.tsx`.
- **`gray-500` (#9095A1, ~6.8:1) is the muted *text* floor.** `gray-600` (#30333A, ~1.6:1) and
  `gray-700` (#212328, ~1.2:1) are borders and surfaces only — never copy, however decorative it
  looks. Focus comes from one base `:where(...):focus-visible` rule in `globals.css`, so new
  hand-rolled controls inherit a visible ring; if you write `focus:outline-none`, you owe a
  replacement indicator.
- `/api/*` is excluded from the auth middleware matcher, so API routes must do their own
  auth and must not leak config. `/api/health` reports failures as a status, never as a raw
  driver error (those embed the connection string).
- Unit tests are hermetic: `vi.mock('@/lib/config', ...)` for config and stub every network
  call. Never let a test reach MongoDB or the internet — CI has neither.
- The dashboards are dense by design: full viewport, panels scroll internally, no page
  scroll, no large footers/banners. Prefer reclaiming vertical space over adding chrome.

## Known debt / gotchas

- **`npm run lint` is not green** on `main` (errors in `scripts/*.js`, `components/
  DonatePopup.tsx`, `lib/kit.ts`, `lib/inngest/functions.ts`, …). CI does **not** gate on
  lint because of this. Fix the debt before adding a lint gate to CI.
- `next.config.ts` sets `eslint.ignoreDuringBuilds` and `typescript.ignoreBuildErrors`. The
  build will **not** catch type errors — run `npx tsc --noEmit` if you want that.
- **IPv6/Happy-Eyeballs trap**: inside Docker, `fetch` to a host publishing AAAA records
  could black-hole until timeout (it looked like Telegram was blocked; it was Node's
  address-family race). `database/mongoose.ts` disables `autoSelectFamily` and prefers IPv4.
  Do not re-enable it. It lives there, not in `instrumentation.ts`, because instrumentation is
  compiled for the **edge** runtime too (middleware) — a `node:net`/`node:dns` import there
  crashed every middleware-matched route. Keep Node builtins out of `instrumentation.ts`.
- A dynamic `import('node:...')` makes Turbopack emit `[externals]_node:*` chunk files, whose
  `:` breaks the standalone copy on **Windows** (`next build` fails with EINVAL). Static
  imports in Node-only modules do not. Linux (CI, Docker) is unaffected either way.
- The compose healthcheck probes `127.0.0.1`, not `localhost`: inside the container
  `localhost` can resolve to `::1` while the server binds IPv4, so `wget` reports
  "connection refused" on a perfectly healthy app.
- Tests mock `server-only` to an empty module (`vitest.config.ts` alias) because vitest
  doesn't apply the `react-server` condition.
- On Windows, `next build` prints `Failed to copy traced files … EINVAL` for traced chunk
  names containing `:`/`[]`. Usually a harmless warning, but a chunk named for a dynamically
  imported Node builtin makes it **fatal** — see the note above. CI runs on Linux either way.
- In-process state (`rate-limit.ts`, `screener-cache.ts`) is per container. With multiple
  replicas each enforces its own limits and its own cache; move to Redis/Mongo if scaling
  out.

## Before you push

1. `npm test` — all green.
2. `npm run build` with a bogus `MONGODB_URI` — it must succeed with no database.
3. If you touched runtime config, verify the change still works from `/settings` without a
   rebuild.
