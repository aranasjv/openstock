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
  ai-tools.ts          the 9 read-only tools the assistant may call
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

## Conventions

- Comments explain **why**, not what. The existing density is intentional — match it.
- Server actions live in `lib/actions/*.actions.ts` marked `'use server'`. In such a file
  **every export must be an async function** — a sync helper (even a test helper) breaks the
  build. Put non-action helpers in their own module (see `lib/screener-cache.ts`).
- Server-only modules import `server-only`. Pages/actions resolve the session themselves and
  scope queries by `userId` — the check lives in the action, because actions are callable
  directly, not only through the page.
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
