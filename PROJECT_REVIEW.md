# Project review — 2026-09-20 (revision 3)

A one-off, thorough review of OpenStock through three lenses. Every finding is grounded in a
`file:line` that was read, not inferred. Severity: **blocker** · **major** · **minor**.

**Revision 3** restructures [§2](#2-ai-features--can-the-web-app-run-all-twenty-playbooks) to
answer one question directly: *can all twenty trading playbooks run as AI features on the web
app?* Short answer — **yes, and none of them needs a Python runtime.** §2 sets out the four
layers of work, the bridge that is missing today, and a per-skill verdict.

**Revision 2** re-ran the review against the 23 playbooks vendored in
[`.agents/skills/`](.agents/skills/) (provenance in [`.agents/UPSTREAM.md`](.agents/UPSTREAM.md)),
so the proposals below specify the **actual** weights, thresholds and formulas those playbooks
ship. [§0](#0-stop-ship-broken-access-control) and the UI evidence are unchanged — the skills do
not affect them.

Reviewed with:

- the 20 trading playbooks below → **AI features** ([§2](#2-ai-features--can-the-web-app-run-all-twenty-playbooks))
- `vercel-react-best-practices` → **architecture** ([§1](#1-architecture--development-lens))
- `web-design-guidelines` → **UI/UX** ([§3](#3-uiux))

---

## 0. Stop-ship: broken access control

Pre-existing, and the most serious findings in the codebase. Nothing in the vendored skills
addresses them — they are application-security gaps, not methodology gaps.

**S1 — Any user can delete or toggle any other user's alert (blocker).**
`lib/actions/alert.actions.ts:46` (`deleteAlert`) and `:59` (`toggleAlert`) call
`Alert.findByIdAndDelete(alertId)` / `findByIdAndUpdate(alertId, …)` with **no owner filter**.
The id comes straight from the DOM (`components/watchlist/AlertsPanel.tsx:16`).

**S2 — Every personal action trusts a client-supplied `userId` (blocker).**
`lib/actions/alert.actions.ts:8,33`, `lib/actions/watchlist.actions.ts:11,42,60,73,90`
(including `getWatchlistSymbolsByEmail(email)`), and
`lib/actions/holdings.actions.ts:34,46,78,131`. The correct pattern already exists —
`requireUserId()` in `lib/actions/assistant.actions.ts:27`.

**S3 — All users' names and emails are exposed as a callable action (blocker).**
`lib/actions/user.actions.ts:5` exports `getAllUsersForNewsEmail()` from a `'use server'`
module with no authorization. It is only used by the Inngest job.

**S4 — A generic URL fetcher is exported as a server action (major).**
`lib/actions/finnhub.actions.ts:62` (`export { fetchJSON }`) — an SSRF primitive.

**S5 — The middleware only checks that a cookie is present (major).**
`middleware.ts:6` does not validate the session, so an action that does not verify it itself
is reachable with a forged cookie. Defence in depth requires S1/S2's fix.

> Not fixed here: it changes action signatures and every caller. Mechanical, and I will do it
> on request — `requireUserId()` per action, drop the `userId` params, move
> `getAllUsersForNewsEmail` out of `'use server'`, delete the `fetchJSON` export, and add the
> authorization tests from A11.

---

## 1. Architecture — development lens

Cross-referenced against `vercel-react-best-practices`, which ships 70 rules in 8 categories.
The rule ids below are the ones that actually bite here.

### Reliability

| # | Finding | Evidence | Rule | Fix |
|---|---|---|---|---|
| A1 | **No fetch timeout on Finnhub, the AI providers, or Kit.** CoinGecko, Yahoo, Telegram, Adanos all have one. | `finnhub.actions.ts:54`; `ai-provider.ts`; `kit.ts:35` | — | Shared `AbortController` helper. |
| A2 | **A DB outage renders as "no data"** — an error looks like an empty list. | `watchlist.actions.ts:66`; `holdings.actions.ts:195`; `alert.actions.ts:39` | — | Distinguish empty from failed; surface degraded state. |
| A3 | **Unbounded outbound fan-out** — one request per symbol, no cap. | `finnhub.actions.ts:103,130` | — | Cap the list length. |
| A4 | **Unbounded DB reads** — no `.limit()` on list queries. | `alert.actions.ts:38`; `watchlist.actions.ts:64,108`; `holdings.actions.ts:37,151` | — | `.limit()` + pagination. |
| A5 | **Per-process state undocumented for the CoinGecko gate and the scheduler.** | `crypto.actions.ts:55-56`; `scheduler.ts:214` | `server-no-shared-module-state` | Document and enforce single-replica, or move to a shared store. The rule is violated on purpose; say so. |

### Correctness

| # | Finding | Evidence | Rule | Fix |
|---|---|---|---|---|
| A6 | **Sequential awaits over independent work.** | `jobs/alert-check.ts:132` (one update per alert); `inngest/functions.ts:271` (per-user loop) | `async-parallel` | `bulkWrite` / `Promise.all` with a concurrency cap. |
| A7 | **Invalid `ObjectId` throws unhandled `CastError`.** | `assistant.actions.ts:70,103` | — | Validate and catch, as `sendMessage` does. |
| A8 | **The re-engagement job no-ops in production** — one personal email is the only real send target. | `inngest/functions.ts:369,372-374` | — | Implement or remove; do not report success while doing nothing. |
| A9 | **Validation is inconsistent** — only the assistant caps input length. | `assistant.actions.ts:128` vs `watchlist.actions.ts:11` | `server-auth-actions` (adjacent) | `assertLength` at the action boundary. |
| A10 | **`peRatio` is faked with `0`.** | `finnhub.actions.ts:103+` | — | Fetch `/stock/metric`, or render `—`. Rendering a wrong `0` is worse than a blank. |

### Already following the rules (keep it that way)

- `searchCrypto = cache(...)` in `crypto.actions.ts` — `server-cache-react`.
- Lazy `await import(...)` inside every `lib/ai-tools.ts` tool — `bundle-conditional`: importing
  the registry does not trigger I/O.
- Lean DTOs passed to client components, not Mongoose documents — `server-serialization`.
- `Promise.all` on all five data-fetching pages — `async-parallel`.
- `lib/indicators.ts` caches nothing at module scope and is pure — `js-cache-function-results`
  applies only where a lookup repeats, and it does not here.

### Testing

| # | Finding |
|---|---|
| A11 | `lib/actions/*` is almost entirely untested — exactly where S1–S3 live. Only `screener.actions.ts` (`explainCandidate`) has coverage. |
| A12 | No coverage for `lib/config.ts`, `lib/jobs/*`, `lib/inngest/*`. |

**Recommendation:** one authorization test per personal action — "a spoofed `userId` cannot
touch another user's document". That single pattern would have caught S1–S3.

---

## 2. AI features — can the web app run all twenty playbooks?

**Yes.** All nineteen you listed, plus `exposure-coach` (which completes the regime set), can run
as AI features on the web app — and **not one of them needs a Python runtime**.

The interpretation layer is already built: the assistant reads any playbook verbatim through
`get_analysis_playbook` and applies it to data its own tools fetch. What is missing is everything
*around* the prose, and it sorts into four layers. There is no point at which "the LLM cannot do
this" is the blocker.

### 2.1 The bridge problem — read this first

**17 of the 23 vendored `SKILL.md` files instruct the model to run `python3 scripts/*.py`**, to
write `state/*.yaml`, and to emit `reports/*.md`. The container is `node:20-alpine`: no Python,
no `state/` directory, no filesystem to write to.

Handed a playbook unmodified, the model will either claim to have run a script it cannot run, or
stall asking for a file that will never exist. This is the single biggest gap between "the
playbooks are in the repo" and "the playbooks work" — and it is a *prompt-bridging* problem, not
an engineering one.

The fix is a **bridge**: a short note served alongside each playbook saying how to do it *here* —
*"you do not have `scripts/analyze_breadth.py`; compute the components from `get_indicators` over
the screener universe instead."* `lib/analysis-skills.ts` already resolves the id and the file
(and `get_analysis_playbook` already accepts a `section` argument), so the bridge hangs off the
registry and is appended at serve time. It is the highest value-per-line change in the whole
plan: it turns 20 documents into 20 working functions.

### 2.2 The two ways a playbook becomes a feature

| | **Path A — assistant-read** | **Path B — deterministic engine** |
|---|---|---|
| What it is | The model loads the playbook and applies it to tool output | A TypeScript port in `lib/` computes the artifact |
| Use when | The output is judgement, prose, or a plan | The output is a **number that must be reproducible** |
| Cost | ~zero — already built | Real work, per skill |

This repo already made that choice once and got it right: `lib/strategies.ts` scores candidates
deterministically and the model only writes the prose (`explainCandidate`). **Every scorer below
must follow that pattern — compute in code, explain in the model.** Asking an LLM to produce a
0–100 breadth composite by reading ten JSON blobs yields a confident number that is *not* the one
the methodology specifies, which is worse than no number at all.

### 2.3 Feasibility — every skill

Legend: **✅** works via assistant + existing tools once the bridge exists · **🟡** needs a new
data source · **🟠** needs a TypeScript engine · **🔴** needs persistence first.

| # | Skill | Produces | Path | Needs | Today |
|---|---|---|---|---|---|
| 1 | `technical-analyst` | Support/resistance, trend, momentum read | A | Daily OHLCV → weekly resample | ✅ |
| 2 | `pre-trade-discipline-gate` | `GO` / `REVIEW_REQUIRED` / `NO_GO` | A + B | Plan inputs; better once history exists | ✅ |
| 3 | `position-sizer` | Shares, risk $, binding constraint | **B** | Equity, entry, stop — pure arithmetic | ✅ concept, 🟠 to trust the number |
| 4 | `breakout-trade-planner` | Levels, stop, 2R targets, portfolio heat | A + **B** | `get_indicators` + the sizer | ✅ narrative, 🟠 levels |
| 5 | `us-stock-analysis` | Full single-name brief | A | **Fundamentals** — A10 currently fakes P/E as `0` | 🟡 |
| 6 | `market-news-analyst` | 10-day ranked, deduped sentiment | A + B | Multi-day news corpus + scoring | 🟡 |
| 7 | `earnings-calendar` | Event-risk dates per position | **B** | Finnhub `/calendar/earnings` — provider already integrated | 🟡 one endpoint |
| 8 | `crypto-regime-analyzer` | 0–100 regime + zone (80/40) | **B** | CoinGecko (have) + `/global` dominance + Binance funding — all keyless | 🟠 closest to done |
| 9 | `market-breadth-analyzer` | 0–100 breadth composite | **B** | TraderMonty public CSVs (keyless, new) | 🟠 |
| 10 | `uptrend-analyzer` | 0–100 uptrend ratio | **B** | Same CSVs | 🟠 |
| 11 | `exposure-coach` | Exposure ceiling + recommendation | **B** | Synthesises #9 + #10 | 🟠 blocked on 9/10 |
| 12 | `vcp-screener` | VCP pattern matches | **B** | OHLCV (have) + benchmark; trend template, contraction detection | 🟠 |
| 13 | `canslim-screener` | 0–100 C-A-N-S-L-I-M | **B** | OHLCV (have) + **fundamentals for C/A/I** | 🟠 engine + data |
| 14 | `backtest-expert` | Validated strategy + metrics | **B** | History engine; expectancy, profit factor, drawdown | 🟠 |
| 15 | `trader-memory-core` | Thesis lifecycle store | **B + state** | Mongo model replacing `state/theses/*.yaml` | 🔴 |
| 16 | `signal-postmortem` | Per-trade review, MAE/MFE | A + **B** | Closed trades | 🔴 blocked on 15 |
| 17 | `trade-performance-coach` | Cohort / edge analysis | **B** | Closed trades | 🔴 blocked on 15 |
| 18 | `weekly-performance-digest` | Weekly **trade** stats + narrative | **B** | Closed trades | 🔴 blocked on 15 |
| 19 | `drawdown-circuit-breaker` | `TRADING_ALLOWED` / `COOLDOWN` / `HALTED` | **B** | Realised P&L ledger | 🔴 blocked on 15 |
| 20 | `market-environment-analysis` | Macro / rates / commodities posture | A | Macro data — **no source integrated** | 🔴 no data |

Two honest notes. **#20 will stay partial**: it needs rates, commodities and FX, and there is no
provider for them (no good keyless source exists). **#13 is the weakest data link**: C, A and I
need fundamentals; Finnhub's free tier covers the first two via `/stock/metric`, but
institutional ownership is the piece that is not reliably free.

One clarification: the market-data digest that already ships is *not* #18. #18 is a digest of
**your trades**, so it is downstream of #15 like the other three.

### 2.4 Layer 1 — the bridge, plus two read tools

Cheapest layer, unlocks the most. Work: the per-playbook bridge note, plus two read-only tools so
the model has somewhere to go — `get_earnings_calendar` (#7) and a benchmark-relative
`get_benchmark_history` (SPY for stocks, BTC for coins, which is also the input for the relative
strength factor below). Together those close #6, #7 and half of #12, and both are small additions
to an existing pattern in `lib/ai-tools.ts`.

### 2.5 Layer 2 — the deterministic engines

Port in this order, because each reuses the last.

**F3 — `position-sizer` (#3).** Pure arithmetic, no data, no network, fully unit-testable, and it
is also the missing half of `breakout-trade-planner`. Default **fixed-fractional**:

```
riskPerShare = entry − stop
riskDollars  = accountEquity × riskPct          # default 1%, never above 2%
shares       = riskDollars / riskPerShare        # FLOOR, never round up
```

with an ATR mode (`stop = entry − ATR × multiplier`, default 2.0×) and **half-Kelly** from
win/loss stats. Then apply the constraints and take the **strictest**: `max-position-pct` (10%),
`max-sector-pct` (30%), and portfolio heat **≤ 6%** (the playbook allows 6–8%; take 6, matching
`breakout-trade-planner`'s default). Report the binding constraint — `binding_constraint` is a
field in the playbook's own output schema. Entry/stop come from `get_indicators` (`price`,
`low20`); equity and risk % are user inputs.
*Files:* new pure `lib/position-sizing.ts` (the playbook's `scripts/position_sizer.py` is the
reference implementation, with a 24KB test suite worth mirroring); a panel/drawer; feed the levels
into the existing alert creation.

**F1 — `crypto-regime-analyzer` (#8).** The best value-for-effort feature in the review, because
it uses **CoinGecko — the source already integrated** — plus Binance's keyless funding endpoint.
Six weighted components, 0–100 composite, 80/40 zones:

1. **BTC trend structure (25%)** — price vs 50/200 DMA stack, 200 DMA slope. Fully available.
2. **Alt breadth (20%)** — % of top-N above their 200 DMA, via the existing serialised
   `getCryptoPriceHistory` (the 6h cache makes it cheap after the first run).
3. **BTC dominance regime (15%)** — needs `/global` (one new call) plus a stored daily history;
   the playbook's own note is that this component reports `data_available: false` until 31 days
   accumulate, with its weight redistributed.
4. **Perpetual funding (15%)** — Binance `fapi` (keyless); skip gracefully when unreachable.
5. **Drawdown & volatility position (15%)** — `maxDrawdown` + `volatility` already computed.
6. **Momentum thrust (10%)** — `change30d` over the universe.

Copy its proportional-weight-redistribution convention and its fail-closed behaviour on sparse
data exactly.
*Files:* new `lib/regime.ts` + a server action; a panel on the crypto dashboard; a
`get_crypto_regime` assistant tool.

**F6 — relative strength (#12, #13).** Not a playbook of its own, but `canslim-screener` weights
leadership (L) at **20%** with `RS = 0.40×3m + 0.30×6m + 0.30×12m` versus a benchmark, and
`vcp-screener` requires a 7-point Stage-2 trend template — while `lib/strategies.ts` has **no
benchmark-relative criterion at all**. One RS criterion (vs SPY for stocks, vs BTC for coins) on
the existing history functions is the highest-value single addition to the screener, and it is the
piece both playbooks agree on.
*Files:* `lib/indicators.ts` (relative-return helper) + `lib/strategies.ts` (criterion).

**F9 — `drawdown-circuit-breaker` (#19).** Trivial arithmetic once the ledger exists: **daily
−2%**, **weekly −5%**, **monthly −8%**, and **2 consecutive losses → 24h cooldown**, all on
*realised* P&L only (not unrealised), fail-closed on incomplete state, with an *empty* state
permitting a new user to begin.

### 2.6 Layer 3 — persistence (unlocks four skills at once)

**F4 — `trader-memory-core` (#15)** is the keystone and the biggest structural gap. It defines a
**forward-only** lifecycle `IDEA → ENTRY_READY → ACTIVE → CLOSED | INVALIDATED`, partial trims
with `shares_remaining`, a cumulative realised-P&L ledger, MAE/MFE, and a JSON Schema
(`schemas/thesis.schema.json`) that maps cleanly onto Mongoose.

Build it and **#16, #17, #18 and #19 all become computable** — they are three views over one
dataset plus one gate. That is the largest single unlock in the plan, and it is also what
`pre-trade-discipline-gate` needs to stop being a one-shot checklist.
*Files:* `database/models/thesis.model.ts` mirroring the schema;
`lib/actions/journal.actions.ts`; a `/journal` page; a `get_my_theses` assistant tool.

### 2.7 Layer 4 — data sources

**F2 — equity breadth (#9, #10, #11).** `market-breadth-analyzer` (6 components,
25/20/20/15/10/10) and `uptrend-analyzer` (5 components, 30/25/15/20/10, plus warning penalties)
both consume **public, keyless CSVs** (TraderMonty GitHub Pages). That is a new outbound source,
but the cheapest kind: no key, no rate limit, and the scoring is already written. Port the
scorers, or — cheaper — display the published series and let the assistant fetch and interpret
them. `exposure-coach` (#11) then synthesises both into an exposure ceiling and a
`NEW_ENTRY_ALLOWED` / `REDUCE_ONLY` / `CASH_PRIORITY` call.

**Caution:** do not conflate this with F1. Crypto regime and equity breadth are different
universes with different inputs; reporting one as "the market" is the failure mode both playbooks
warn about.

**F8 — earnings (#7).** `earnings-calendar` and `pre-trade-discipline-gate` both treat an imminent
binary event as a gate item; today it is permanently "unknown" here. Finnhub (already integrated,
free tier) exposes an earnings calendar, so this is one action + a surface, not a new vendor.

### 2.8 What will not work

- **Python is never executed.** `scripts/` is reference implementation, not runtime. Anything
  needed from it must be rewritten in TypeScript — port the *method*, not the code.
- **`--as-of` determinism and the `state/`/`reports/` filesystems** must become Mongo writes and
  server actions; the playbooks assume a filesystem the container does not have.
- **LLM arithmetic is not acceptable** for any scorer. Path B, or nothing.
- **Full CANSLIM.** C, A and I need EPS/revenue growth and institutional ownership; a partial
  implementation would produce a confident-looking 0–100 with three components stubbed — worse
  than the honest technical-only screen that exists now. Take the L component (F6) and leave the
  rest.
- **Futures, options, MT5, pair trading, dividend tax, DeFi, real-time streaming, automated
  execution.** Out of scope, and not vendored.

Two warnings from `backtest-expert` (#14) apply directly here: OpenStock's universe is a
**curated 50-symbol list** (`POPULAR_STOCK_SYMBOLS`) — survivorship-flavoured if reused as a
backtest universe — and `computeIndicators` needs 200 bars, so a 1-year Yahoo window yields very
few evaluable signals. The history range must be extended before #14 is meaningful.

Also worth knowing: **no vendored playbook covers cross-asset statistics** (beta, correlation,
concentration). The closest, `portfolio-manager`, is built around Alpaca and allocations rather
than risk factors, so that remains original work.

### 2.9 Build order

| Phase | Work | Unlocks |
|---|---|---|
| **A** | Bridge notes + `get_earnings_calendar` + benchmark history | #1, #2, #4, #6, #7 usable; #5 partial |
| **B** | `position-sizer` → `crypto-regime-analyzer` → relative-strength criterion | #3, #8, #4 complete, #12/#13 partial |
| **C** | Thesis / journal model (Mongo) | #15 |
| **D** | Postmortem, coach, digest, circuit breaker over the journal | #16, #17, #18, #19 |
| **E** | TraderMonty CSVs → breadth + uptrend → exposure-coach | #9, #10, #11 |
| **F** | VCP + CANSLIM engines (fundamentals permitting), `backtest-expert` engine | #12, #13, #14 |

---

## 3. UI/UX

Reviewed against `web-design-guidelines` — the actual rule set the skill fetches
(`vercel-labs/web-interface-guidelines`). Severity: **blocker** · **major** · **minor**.

Palette note (`app/globals.css:118-122`): `gray-900 #050505`, `gray-800 #141414`,
`gray-700 #212328`, `gray-600 #30333A`, `gray-500 #9095A1`. So **`gray-500` is ~6.8:1 (fine)**
but **`gray-600` ~1.6:1 and `gray-700` ~1.2:1 — effectively invisible.**

### Blockers

| # | Finding | Rule | Evidence |
|---|---|---|---|
| U1 | **Meaningful text in `gray-600`/`gray-700` — invisible.** Disclaimers, empty states, table labels, captions. Move meaningful copy to `gray-500` or lighter. | Accessibility / contrast (AA) | `layout/Sidebar.tsx:90,97,123`; `screener/MustBuySection.tsx:40,49`; `screener/CandidateRow.tsx:75,102,143,150,188`; `assistant/ConversationList.tsx:57,75`; `assistant/ChatPanel.tsx:195`; `crypto/TopCoinsTable.tsx:71,104` |
| U2 | **No visible keyboard focus** on hand-rolled buttons and links. Only the shadcn `ui/*` primitives have rings. | Focus States: "Interactive elements need visible focus: `focus-visible:ring-*`" | `ChatPanel.tsx:98`; `ConversationList.tsx:64,79`; `CandidateRow.tsx:79,93,168`; `SidebarNav.tsx:53`; `WatchlistTabs.tsx:39` |

### Major

| # | Finding | Rule | Evidence |
|---|---|---|---|
| U3 | **Icon-only buttons with no accessible name.** | Accessibility: "Icon-only buttons need `aria-label`"; anti-pattern list | `ChatPanel.tsx:186` (send); `holdings/HoldingsManager.tsx:165` (add); `watchlist/AlertsPanel.tsx:63` (delete) |
| U4 | **Numbers are neither aligned nor tabular.** | Typography: "`font-variant-numeric: tabular-nums` for number columns/comparisons" | `WatchlistTable.tsx:80-82,117-126` (left-aligned); `HoldingsManager.tsx:189-220`, `TopCoinsTable.tsx:49-50,96,99` (right but proportional) |
| U5 | **Controls reachable only by hover.** | Touch & Interaction: gestures need tap/click and keyboard alternatives; anti-pattern list | `ConversationList.tsx:84` (`opacity-0 group-hover:opacity-100`); `TradingViewWidget.tsx:80` |
| U6 | **The coin drawer traps no focus, restores none, and keeps an Escape listener mounted while closed.** | Touch: "`overscroll-behavior: contain` in modals/drawers"; Focus States: sticky overlays must not cover the focused element | `crypto/CoinDetailDrawer.tsx:84-92,98` |
| U7 | **Table rows are mouse-only click targets.** | Anti-patterns: "`<div>`/`<span>` with click handlers (should be `<button>`)"; "Inline `onClick` navigation without `<a>`" | `crypto/TopCoinsTable.tsx:65-68` |
| U8 | **Silent void states** — components return `null` instead of an empty state, so a failure looks like the feature does not exist. | Content Handling: "Handle empty states—don't render broken UI for empty strings/arrays" | `watchlist/NewsGrid.tsx:19`; `stocks/StockSentimentCard.tsx:43` |
| U9 | **Destructive actions are immediate or use a blocking native `confirm()`.** The conversation delete has no confirmation at all. | Navigation & State: "Destructive actions need confirmation modal or undo window—never immediate" | `watchlist/AlertsPanel.tsx:15`; `assistant/ConversationList.tsx:79-86` |

### Minor

| # | Finding | Rule | Evidence |
|---|---|---|---|
| U10 | Colour-only signalling: RSI tone is a bare coloured number (meaning only in a hover `title`); the sidebar pick tier never spells the tier. | Accessibility | `CandidateRow.tsx:109-113`; `layout/SidebarPickRows.tsx:44-53` |
| U11 | Form controls without labels: holdings inputs and the chat textarea rely on placeholders; `CreateAlertModal` labels have no `htmlFor`. | Accessibility: "Form controls need `<label>` or `aria-label`"; anti-pattern "Form inputs without labels" | `HoldingsManager.tsx:117-163`; `ChatPanel.tsx:179`; `CreateAlertModal.tsx:89,100,114,127,141` |
| U12 | **`color-scheme: dark` is never set.** Dark themes need it to fix native scrollbars and form controls (Windows dark mode especially). | Dark Mode & Theming | absent from `app/globals.css` and `app/layout.tsx` |
| U13 | **`transition-all` throughout** — must list properties explicitly; it animates layout properties too. | Animation: "Never `transition: all`—list properties explicitly"; anti-pattern list | `ui/button.tsx:8`; `WatchlistButton.tsx:76`; `TradingViewWidget.tsx:63,79`; `crypto/CryptoWatchlistChip.tsx:32`; `watchlist/WatchlistStockChip.tsx:45`; `WatchlistTable.tsx:137`; `CreateAlertModal.tsx:94,150,167` |
| U14 | **Hardcoded number formats** — `.toFixed(2)` with literal `$`/`T`/`B`/`M`/`K` suffixes instead of `Intl.NumberFormat` compact notation. `Intl` *is* used elsewhere in the same file, so this is inconsistent as well as non-localised. | Locale & i18n: "Numbers/currency: use `Intl.NumberFormat` not hardcoded formats" | `lib/utils.ts:32-35,128-131` |
| U15 | Watchlist table clips on mobile — no `overflow-x-auto`, unlike the holdings table. | Safe Areas & Layout: "Avoid unwanted scrollbars… fix content overflow" | `watchlist/WatchlistTable.tsx:74` |
| U16 | Missing `DialogDescription` on the alert modal (Radix a11y warning). | Accessibility | `watchlist/CreateAlertModal.tsx:81-83` |
| U17 | Code defects: invalid class `text-gray-4`; no-op `focus: text-white` (stray space); dead ternary. | — | `UserDropdown.tsx:37`; `forms/SelectField.tsx:30`; `WatchlistButton.tsx:38-41` |

### What is already right (keep it)

The compact single-screen dashboard is the correct direction and should be protected: the
viewport-height shell, internally-scrolling panels, the one-line header with the Ask AI entry,
and `MustBuySection`/`CandidateRow` — which shows *why* each candidate scored, with the measured
value for every condition. The assistant's empty state, its "Fetching market data…" progress
(already using `…` per the Typography rule), and its actionable rate-limit error are the model
for copy elsewhere. The conversation id and strategy are already in the URL, satisfying
"URL reflects state".

The one thing to trim: the ALL-CAPS tracked eyebrow labels (`Sidebar.tsx:90,97,123`) — a
generated-page tell, and at `gray-700` currently invisible anyway.

---

## 4. Suggested order

| Priority | Items |
|---|---|
| **P0 — now** | S1–S4 (access control) + the authorization tests (A11) in the same change. |
| **P1 — next** | UI blockers U1, U2, U3, U12, U13 (cheap, app-wide); A1 (fetch timeouts); A2 (degrade honestly); A7/A9 (validate + guard). |
| **P2 — the AI layer** | §2.9 phase A (bridge + two tools) → phase B (`position-sizer`, `crypto-regime-analyzer`, relative strength); U4–U9, U14, U15, A6, A10. |
| **P3 — persistence** | §2.6 thesis/journal model, then the four skills it unlocks. |
| **P4 — depth** | Phases E–F: equity breadth, uptrend, exposure-coach; VCP/CANSLIM engines; backtest engine. |
| **P5 — polish** | Remaining U/A minors; portfolio risk (beta, correlation, concentration). |

Everything in P2+ has its method already specified in `.agents/skills/` and is readable by the
running app through `lib/analysis-skills.ts` — so the same playbook can drive the implementation,
the assistant's answers, and the review of the result.
