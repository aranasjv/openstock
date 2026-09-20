# Project review — 2026-09-20

A one-off, thorough review of OpenStock through three lenses. Every finding is grounded in a
`file:line` that was read, not inferred. Severity: **blocker** · **major** · **minor**.

Reviewed with the skills vendored in [`.agents/skills/`](.agents/skills/) (see
[`.agents/UPSTREAM.md`](.agents/UPSTREAM.md) for provenance):

- `market-breadth-analyzer` / `uptrend-analyzer` / `exposure-coach` / `crypto-regime-analyzer`,
  plus `position-sizer`, `pre-trade-discipline-gate`, `trader-memory-core` → **new features**
  ([§2](#2-new-features--trading--market-analysis))
- `vercel-react-best-practices` → **architecture gaps** ([§1](#1-architecture--development-lens))
- `web-design-guidelines` / `frontend-design` → **UI/UX** ([§3](#3-uiux))

---

## 0. Stop-ship: broken access control

These are pre-existing (not introduced by the assistant work) and are the most serious
findings in the codebase. They are listed first because nothing else matters until they are
fixed.

**S1 — Any user can delete or toggle any other user's alert (blocker).**
`lib/actions/alert.actions.ts:46` (`deleteAlert`) and `:59` (`toggleAlert`) call
`Alert.findByIdAndDelete(alertId)` / `findByIdAndUpdate(alertId, …)` with **no owner filter**.
The alert id is passed straight from the DOM (`components/watchlist/AlertsPanel.tsx:16`).
Fix: resolve the session and filter by `{ _id, userId }`.

**S2 — Every personal action trusts a client-supplied `userId` (blocker).**
`lib/actions/alert.actions.ts:8,33`, `lib/actions/watchlist.actions.ts:11,42,60,73,90`
(including `getWatchlistSymbolsByEmail(email)`), and `lib/actions/holdings.actions.ts:34,46,78,131`
take the user id (or an email) as a parameter and never call `getAuth()`. Any caller can read
or write another account's watchlist, holdings and alerts.
Fix: the pattern already exists and is correct in `lib/actions/assistant.actions.ts:27`
(`requireUserId()` + query scoped by the session id). Apply it here and drop the `userId`
parameters from the public surface, updating callers.

**S3 — All users' names and emails are exposed as a callable action (blocker).**
`lib/actions/user.actions.ts:5` exports `getAllUsersForNewsEmail()` from a `'use server'`
module with no authorization, returning every user's `email` and `name`. It is only used by
the Inngest job (`lib/inngest/functions.ts:4`), so it does not need to be a server action at
all.
Fix: move it to a non-`'use server'` module (e.g. `lib/jobs/`), keep the export internal.

**S4 — A generic URL fetcher is exported as a server action (major).**
`lib/actions/finnhub.actions.ts:62` (`export { fetchJSON }`) exposes an arbitrary-URL `fetch`
as an action — an SSRF primitive, and a way to launder requests through the server.
Fix: make it a module-private function (`async function fetchJSON` without the export).

**S5 — The middleware only checks that a cookie is present (major).**
`middleware.ts:6` uses `getSessionCookie(request)` and redirects only when absent; it does not
validate the session. Combined with S1–S4, an action that does not itself verify the session
is reachable with a forged/expired cookie value. Defence in depth requires the actions to
authenticate on their own — which S1/S2 fix.

> I have **not** changed any of these: fixing them alters function signatures across several
> actions and their callers, which is a deliberate change you should sign off on. Say the word
> and I will do it (it is mechanical: `requireUserId()` per action, drop the `userId` params,
> update callers, add authorization tests).

---

## 1. Architecture — development lens

### Reliability

| # | Finding | Evidence | Fix |
|---|---|---|---|
| A1 | **No fetch timeout on Finnhub** — a hung provider stalls the page. CoinGecko, Yahoo, Telegram, Adanos all have one; Finnhub, the AI providers and Kit do not. | `lib/actions/finnhub.actions.ts:54`; `lib/ai-provider.ts` (all call sites); `lib/kit.ts:35` | Add an `AbortController` timeout in a shared helper. |
| A2 | **A DB outage renders as "no data".** List/read actions catch and return `[]`/`null`, so an error looks like an empty watchlist/holdings/alerts. | `watchlist.actions.ts:66`; `holdings.actions.ts:195`; `alert.actions.ts:39` | Distinguish "empty" from "failed"; surface a degraded state in the UI. |
| A3 | **Unbounded outbound fan-out.** One request per symbol with no cap. | `finnhub.actions.ts:103,130` | Cap the symbol list (e.g. 50) and reject beyond it. |
| A4 | **Unbounded DB reads.** No `.limit()` on the list queries. | `alert.actions.ts:38`; `watchlist.actions.ts:64,108`; `holdings.actions.ts:37,151` | Add `.limit()` + pagination. |
| A5 | **Per-process state not documented for the CoinGecko gate and the scheduler** — with N replicas the rate limit and the cron multiply by N. `rate-limit.ts` and `screener-cache.ts` already document this; these two don't. | `crypto.actions.ts:55-56`; `scheduler.ts:214` | Either document it and enforce single-replica, or move to a shared store. |

### Correctness & consistency

| # | Finding | Evidence | Fix |
|---|---|---|---|
| A6 | **Sequential awaits over independent work.** Per-row updates that should be one write. | `jobs/alert-check.ts:132` (one `findByIdAndUpdate` per triggered alert); `inngest/functions.ts:271` (per-user loop) | `bulkWrite`/`updateMany`; `Promise.all` with a concurrency cap. |
| A7 | **Invalid `ObjectId` throws an unhandled `CastError`.** `getConversation`/`deleteConversation` don't validate or catch; `sendMessage` was guarded but these weren't. | `assistant.actions.ts:70,103` | Validate the id (and catch), as `sendMessage` does. |
| A8 | **The re-engagement job silently no-ops in production.** A personal email is the only real send recipient; every other user is mocked and marked as sent. | `inngest/functions.ts:369` (`11aravipratapsingh@gmail.com`), `:372-374` | Either implement the tag-based broadcast or remove the job; do not leave a job that reports success while doing nothing. |
| A9 | **Validation is inconsistent.** Only the assistant caps input length; symbols/emails/queries are unbounded everywhere else. | `assistant.actions.ts:128` (good) vs `watchlist.actions.ts:11`, `alert.actions.ts:8`, `finnhub.actions.ts:206` | Add a small `assertLength` helper and apply it at the action boundary. |
| A10 | **`peRatio` is faked.** `getWatchlistData` hard-codes `peRatio: 0`. | `lib/actions/finnhub.actions.ts:103+` | Fetch `/stock/metric`, or render `—` instead of a wrong `0`. |

### Testing

| # | Finding | Evidence |
|---|---|---|
| A11 | `lib/actions/*` is almost entirely untested — exactly where S1–S3 live, and why they were never caught. Only `screener.actions.ts` (`explainCandidate`) has coverage. | No test for `alert/watchlist/holdings/user.actions.ts` |
| A12 | No coverage for `lib/config.ts`, `lib/jobs/*`, `lib/inngest/*`. | — |

**Recommendation:** add one authorization test per personal action — "spoofed `userId` cannot
touch another user's document". That single pattern would have prevented S1–S3 and keeps them
from returning.

### Known debt (carried forward)

- `npm run lint` fails on `main` (32 errors in `scripts/`, `lib/kit.ts`, `lib/inngest/functions.ts`, …), so CI does not gate on it.
- `next.config.ts` sets `ignoreBuildErrors` — the build does not catch type errors; `npx tsc --noEmit` does.

---

## 2. New features — trading & market analysis

Ranked by value to the workflow the app is already shaped around. Each notes whether the
existing data layer can support it (i.e. no new vendor required).

### F1 — Market regime / breadth panel · *high value, medium effort, no new data*
The app scores a whole universe but never aggregates it. A regime panel turns the screener
into a market read: % of the universe above its 200-day average, % in golden cross, %
at 20-day highs, net advancers — scored and banded into **risk-on / neutral / defensive /
risk-off**. The vendored `market-breadth-analyzer`, `uptrend-analyzer` and `exposure-coach`
playbooks already define the scoring, so the logic is written.
**Files:** new `lib/regime.ts` over `runScreener` + `get_indicators`; a panel on both
dashboards; a new assistant tool `get_market_regime`.

### F2 — Portfolio risk panel · *high value, medium effort, no new data*
`getPortfolioSummary` computes only value/cost/PnL. The pieces for real risk exist already:
per-asset `volatility`/`maxDrawdown` (`lib/indicators.ts`) and price history for any benchmark
(`getStockPriceHistory('SPY')`, `getCryptoPriceHistory('bitcoin')`). Add concentration,
weighted volatility, max drawdown, beta vs SPY/BTC, and pairwise correlation.
**Files:** `lib/actions/holdings.actions.ts` + a new `lib/portfolio-risk.ts`; extend the
holdings page and the `get_my_holdings` tool output.

### F3 — Position sizing calculator · *high value, low effort, no new data*
Entry/stop come from `low20`/`volatility` already returned by `get_indicators`; account equity
and risk % are user inputs. Produces shares, $ risk, R-multiples and portfolio heat — the
vendored `position-sizer` playbook defines the exact maths. Highest value-to-effort item here.
**Files:** new `lib/position-sizing.ts` (pure, unit-testable); a small panel/drawer; wire the
stop/target into the existing alert creation.

### F4 — Trade journal & postmortem · *high value, medium effort, new model*
Nothing records fills, exits or outcomes, so the process can never be evaluated. A journal
model (thesis, entry, stop, target, size, regime stance at entry, exit, R outcome, whether the
plan was followed) plus aggregate expectancy is the single biggest gap for a *trader* rather
than a *viewer*.
**Files:** new `database/models/trade.model.ts`, `lib/actions/journal.actions.ts`, a
`/journal` page, and an assistant tool `get_my_journal`.

### F5 — Screener backtest · *high value, medium effort, no new data*
`lib/strategies.ts` openly states "nothing here is backtested". History is already available
(Yahoo 1y daily; CoinGecko 200d), and `computeIndicators` can be recomputed over a rolling
window. A backtest of a strategy over the existing universe would let a score be judged rather
than trusted — and directly closes the caveat the UI prints today.
**Files:** new `lib/backtest.ts` reusing `indicators.ts` + `strategies.ts`; a results panel in
`MustBuySection`; an assistant tool `run_backtest`.

### F6 — Trailing stops and R-multiple / %-based alerts · *medium value, low effort*
Alerts are absolute-price only. Adding an anchor price + trail distance, or expressing a target
as "−8%" / "2R from entry", makes the plan from F3 actionable.
**Files:** `database/models/alert.model.ts`; `lib/actions/alert.actions.ts`;
`lib/jobs/alert-check.ts`; `components/watchlist/CreateAlertModal.tsx`.

### F7 — Earnings & economic calendar · *medium value, medium effort, new provider call*
Finnhub exposes an earnings calendar (unused here). It would let the screener and alerts warn
about binary event risk — the one gate item in the `pre-trade-discipline-gate` playbook that
is currently always "unknown".
**Files:** `lib/actions/finnhub.actions.ts` + a calendar surface.

### F8 — Sector rotation · *medium value, medium effort*
`getCompanyProfile` maps only currency/exchange/logo/marketCap/name — no industry. Mapping
`finnhubIndustry` from `/stock/profile2` unlocks grouping the universe and holdings by sector.
**Files:** `lib/actions/finnhub.actions.ts` (add the field) + an aggregation module.

### F9 — Equity curve / performance history · *medium value, higher effort*
`holding.model.ts` stores a snapshot (`quantity`, `averageCost`, `addedAt`) with no transactions
and no time series, so no curve is derivable. Needs a daily snapshot job alongside the digest.
**Files:** `database/models/holding.model.ts` (or a new snapshot model) + a job in
`lib/jobs/`.

### F10 — Data export · *low effort*
No CSV/JSON download exists. All the data is already returned by existing actions; a route
handler with `Content-Disposition` is enough.

### Explicitly not recommended

- **Real-time streaming / websockets.** The free data tiers are delayed anyway; polling and
  the cache layer are the honest fit.
- **Automated execution.** Out of scope, and the app is deliberately not a broker.
- **More AI features before F1–F3.** The assistant is already the most capable part of the
  app; the gap is deterministic analysis the model can then explain, not more prompting.

---

## 3. UI/UX

Verified against `web-design-guidelines`. Note the palette is customised in `app/globals.css:118-122`:
`gray-900 #050505`, `gray-800 #141414`, `gray-700 #212328`, `gray-600 #30333A`, `gray-500 #9095A1`.
That changes the contrast maths materially: **`gray-500` is ~6.8:1 (fine)**, but
**`gray-600` is ~1.6:1 and `gray-700` ~1.2:1 — effectively invisible.**

### Blockers

| # | Finding | Evidence |
|---|---|---|
| U1 | **Meaningful text rendered in `gray-600`/`gray-700`, i.e. invisible.** This is app-wide and includes disclaimers, empty states, table labels and captions. Fix: move meaningful copy to `gray-500` or lighter; reserve `gray-600`/`700` for genuinely decorative marks. | `components/layout/Sidebar.tsx:90,97,123`; `components/screener/MustBuySection.tsx:40,49`; `components/screener/CandidateRow.tsx:75,102,143,150,188`; `components/assistant/ConversationList.tsx:57,75`; `components/assistant/ChatPanel.tsx:195`; `components/crypto/TopCoinsTable.tsx:71,104`; `components/crypto/CryptoSentimentCard.tsx:93`; `app/(root)/holdings/page.tsx:37-48` |
| U2 | **No visible keyboard focus** on hand-rolled buttons/links (only the shadcn `ui/*` primitives have rings). Fix: add a shared `focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:outline-none` to the interactive class set. | `components/assistant/ChatPanel.tsx:98`; `ConversationList.tsx:64,79`; `screener/CandidateRow.tsx:79,93,168`; `layout/SidebarNav.tsx:53`; `watchlist/WatchlistTabs.tsx:39`; `crypto/CoinDetailDrawer.tsx:124` |

### Major

| # | Finding | Evidence |
|---|---|---|
| U3 | **Icon-only buttons with no accessible name** — the send button, the add-holding button, the delete-alert button. | `ChatPanel.tsx:186`; `holdings/HoldingsManager.tsx:165`; `watchlist/AlertsPanel.tsx:63` |
| U4 | **Numbers are not aligned or tabular.** `tabular-nums` appears nowhere; the watchlist table's numeric columns are left-aligned. Add `tabular-nums` to every numeric cell and right-align numeric columns. | `watchlist/WatchlistTable.tsx:80-82,117-126` (left-aligned); `HoldingsManager.tsx:189-220`, `TopCoinsTable.tsx:49-50,96,99` (right but proportional) |
| U5 | **Controls only reachable by hover** — invisible to touch and keyboard. | `ConversationList.tsx:84` (`opacity-0 group-hover:opacity-100`); `TradingViewWidget.tsx:80` |
| U6 | **The coin drawer does not trap focus, does not restore it, and mounts its Escape listener even when closed.** | `crypto/CoinDetailDrawer.tsx:84-92,98` |
| U7 | **Table rows are mouse-only click targets** — no `tabIndex`, role or key handler. | `crypto/TopCoinsTable.tsx:65-68` |
| U8 | **Silent void states** — components return `null` instead of an empty/loading/error state, so a failed fetch looks like the feature does not exist. | `watchlist/NewsGrid.tsx:19`; `stocks/StockSentimentCard.tsx:43`; `watchlist/WatchlistTable.tsx:36` (polling error only logged) |

### Minor

| # | Finding | Evidence |
|---|---|---|
| U9 | Colour-only signalling: RSI tone is a bare coloured number (meaning only in a `title` tooltip); the sidebar pick tier is colour-only and never spells the tier. | `screener/CandidateRow.tsx:109-113`; `layout/SidebarPickRows.tsx:44-53` |
| U10 | Form controls without labels: holdings inputs and chat textarea rely on placeholders; `CreateAlertModal` `<Label>`s have no `htmlFor`. | `holdings/HoldingsManager.tsx:117-163`; `ChatPanel.tsx:179`; `watchlist/CreateAlertModal.tsx:89,100,114,127,141` |
| U11 | **Code defects worth fixing while in the area:** invalid class `text-gray-4`; no-op class `focus: text-white` (stray space); dead ternary in `WatchlistButton`; blocking `confirm()` instead of the app's dialog. | `UserDropdown.tsx:37`; `forms/SelectField.tsx:30`; `WatchlistButton.tsx:38-41`; `watchlist/AlertsPanel.tsx:15` |
| U12 | **Watchlist table clips on mobile** — no `overflow-x-auto`, unlike the holdings table which has one. | `watchlist/WatchlistTable.tsx:74` |
| U13 | Missing `DialogDescription` on the alert modal triggers a Radix accessibility warning. | `watchlist/CreateAlertModal.tsx:81-83` |

### What is already right (keep it)

The compact, single-screen dashboard is the correct direction and should be protected: the
viewport-height shell, the internally-scrolling panels, the one-line header with the Ask AI
entry, and `MustBuySection`/`CandidateRow` (which shows *why* each candidate scored, with the
measured value for every condition). The assistant's empty state, its "Fetching market data…"
progress, and its actionable rate-limit error are the model for copy elsewhere.

The one thing to trim: the ALL-CAPS tracked eyebrow labels (e.g. the sidebar section labels) —
they are a generated-page tell and, at `gray-700`, currently invisible anyway.

---

## 4. Suggested order

| Priority | Items |
|---|---|
| **P0 — now** | S1, S2, S3, S4 (access control & exposure). Add the authorization tests (A11) in the same change. |
| **P1 — next** | U1, U2 (contrast + focus — cheap, app-wide), A1 (fetch timeouts), A2 (degrade honestly), A7/A9 (validate + guard). |
| **P2 — then** | U3–U8, F3 + F1 (sizing and regime — highest value-per-effort features), A6, A10, F5. |
| **P3 — later** | F2, F4, F6–F10, remaining minors. |

The methodology each item should be implemented against already lives in the vendored skills:
sizing in `position-sizer`, the gate in `pre-trade-discipline-gate`, regime scoring in
`market-breadth-analyzer` / `uptrend-analyzer` / `exposure-coach`, and the repo invariants and
extension recipes for all of it in `AGENTS.md`. The running app can read any of them through
`lib/analysis-skills.ts`, so the same methodology drives both the code and the assistant.
