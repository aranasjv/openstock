# Project review — 2026-09-20 (revision 2)

A one-off, thorough review of OpenStock through three lenses. Every finding is grounded in a
`file:line` that was read, not inferred. Severity: **blocker** · **major** · **minor**.

**Revision 2** re-runs the review against the 23 upstream playbooks now vendored in
[`.agents/skills/`](.agents/skills/) (provenance in [`.agents/UPSTREAM.md`](.agents/UPSTREAM.md)).
Revision 1 was written against paraphrases; this one is grounded in the **actual** weights,
thresholds and formulas those playbooks ship, so the feature proposals below specify a method
instead of describing one. Sections [§0](#0-stop-ship-broken-access-control) and the UI
evidence are unchanged — the skills do not affect them.

Reviewed with:

- `market-breadth-analyzer`, `uptrend-analyzer`, `exposure-coach`, `crypto-regime-analyzer`,
  `position-sizer`, `pre-trade-discipline-gate`, `drawdown-circuit-breaker`,
  `vcp-screener`, `canslim-screener`, `breakout-trade-planner`, `trader-memory-core`,
  `backtest-expert` → **new features** ([§2](#2-new-features--grounded-in-the-vendored-playbooks))
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
| A5 | **Per-process state undocumented for the CoinGecko gate and the scheduler.** | `crypto.actions.ts:55-56`; `scheduler.ts:214` | `server-no-shared-module-state` | Document and enforce single-replica, or move to a shared store. The rule is technically violated on purpose; say so. |

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
| A11 | `lib/actions/*` is almost entirely untested — exactly where S1–S3 live. Only `screener.actions.ts` (`explainCandidate`) has coverage. The vendored `dual-axis-skill-reviewer` scores skills on test health for the same reason. |
| A12 | No coverage for `lib/config.ts`, `lib/jobs/*`, `lib/inngest/*`. |

**Recommendation:** one authorization test per personal action — "a spoofed `userId` cannot
touch another user's document". That single pattern would have caught S1–S3.

---

## 2. New features — grounded in the vendored playbooks

### 2.0 What the playbooks change

The playbooks are complete implementations, so each proposed feature now has a specified
method, weights and thresholds rather than a description. They also make the **data gaps**
explicit — which is the most useful thing about them.

| Playbook | Ships | OpenStock already has | Missing |
|---|---|---|---|
| `crypto-regime-analyzer` | 6 weighted components (25/20/15/15/15/10), 0–100, zones 80/40 | CoinGecko `/coins/markets` + `market_chart` + 200d history | BTC dominance (`/global`), Binance funding, and 31 days of stored dominance history |
| `market-breadth-analyzer` | 6 components (25/20/20/15/10/10), zones 80/60/40/20 | nothing breadth-specific | TraderMonty public CSVs (keyless HTTP) |
| `uptrend-analyzer` | 5 components (30/25/15/20/10) + warning penalties | nothing | Monty uptrend-ratio CSVs (keyless) |
| `exposure-coach` | Posture: exposure ceiling %, `NEW_ENTRY_ALLOWED`/`REDUCE_ONLY`/`CASH_PRIORITY`, confidence | nothing | input JSONs from the two above |
| `position-sizer` | Fixed-fractional / ATR / half-Kelly; `max-position-pct`, `max-sector-pct`; floors, never rounds up | `get_indicators` gives `price`, `low20`, `volatility` | account equity + risk % (user input) |
| `pre-trade-discipline-gate` | `GO`/`REVIEW_REQUIRED`/`NO_GO` + exact blocking rules | nothing | written plan, planned vs actual risk $ |
| `drawdown-circuit-breaker` | daily 2% / weekly 5% / monthly 8% / 2-loss → 24h cooldown | nothing | realized P&L ledger — **blocked on F4** |
| `vcp-screener` | Stage-2 trend template + contraction detection, `trend-min-score` 85, contraction ratio 0.70, volume 1.5× | SMA/RSI/MACD/high-low/volume — enough for the technical half | relative strength vs a benchmark |
| `canslim-screener` | 7 weighted components (C15 A20 N15 S15 L20 I10 M5) | price/volume (N, S, M partially) | EPS/revenue growth (C, A), institutional ownership (I) |
| `breakout-trade-planner` | entry/stop/target, worst-case risk ≤ 8%, heat ≤ 6%, default 2R target | screener candidates | nothing structural |
| `trader-memory-core` | thesis lifecycle + P&L ledger + MAE/MFE | nothing | a model and UI |
| `backtest-expert` | 6-step validation, 5-dimension scoring, Deploy/Refine/Abandon | 1y Yahoo / 200d CoinGecko history | nothing structural |

### F1 — Crypto regime panel · *high value, medium effort, mostly existing data*
`crypto-regime-analyzer` is the most directly implementable playbook, because it uses
**CoinGecko — the source OpenStock already integrates** — plus Binance's keyless funding
endpoint. Port the six weighted components and the 0–100 composite with the 80/40 zones:

1. **BTC trend structure (25%)** — price vs 50/200 DMA stack, 200 DMA slope. Fully available.
2. **Alt breadth (20%)** — % of the top-N above their 200 DMA. Available via the existing
   serialised `getCryptoPriceHistory` (the 6h cache makes it cheap after the first run).
3. **BTC dominance regime (15%)** — needs CoinGecko `/global` (one new call) and a stored
   daily observation history; the playbook's own note is that the component reports
   `data_available: false` until 31 days accumulate, with its weight redistributed.
4. **Perpetual funding (15%)** — Binance `fapi` (keyless); skip gracefully when unreachable.
5. **Drawdown & volatility position (15%)** — `maxDrawdown` + `volatility` already computed.
6. **Momentum thrust (10%)** — % of the universe positive over 30d; `change30d` exists.

The playbook's proportional-weight-redistribution convention and fail-closed behaviour on
sparse data are the two details worth copying exactly.
**Files:** new `lib/regime.ts` + a `/api/crypto-regime` or server action; a panel on the crypto
dashboard; a `get_crypto_regime` assistant tool.

### F2 — Equity breadth via `market-breadth-analyzer` / `uptrend-analyzer` · *high value, low effort*
Both consume **public, keyless CSVs** (TraderMonty GitHub Pages; Monty's uptrend ratios). That
is a new outbound source, but the cheapest kind: no key, no rate limit, and the scoring is
already written. Either port the 6-component / 5-component scorers, or — cheaper — display the
published series and let the assistant fetch and interpret them.

**Caution:** do not conflate this with F1. The crypto regime and equity breadth are different
universes with different inputs; reporting one as "the market" is the failure mode both
playbooks warn about.

### F3 — Position sizing · *high value, low effort, no new data*
`position-sizer` specifies the maths precisely, so this is transcription rather than design.
Default **fixed-fractional**:

```
riskPerShare = entry − stop
riskDollars  = accountEquity × riskPct          # default 1%, never above 2%
shares       = riskDollars / riskPerShare        # FLOOR, never round up
```

with ATR mode (`stop = entry − ATR × multiplier`, default 2.0×) and **half-Kelly** from
win/loss stats. Then apply constraints and take the **strictest**:
`max-position-pct` (10%), `max-sector-pct` (30%), and portfolio heat **≤ 6%** (the playbook
allows 6–8%; take 6, matching `breakout-trade-planner`'s default). Report the binding
constraint — `binding_constraint` is a field in the playbook's own output schema.

Entry/stop come from `get_indicators` (`price`, `low20`); equity and risk % are user inputs.
**Files:** new pure `lib/position-sizing.ts` (the playbook's `scripts/position_sizer.py` is the
reference implementation and has a 24KB test suite worth mirroring); a panel/drawer; feed the
levels into the existing alert creation.

### F4 — Trade journal / thesis lifecycle · *high value, medium effort*
`trader-memory-core` is the biggest structural gap. It defines a **forward-only** lifecycle
`IDEA → ENTRY_READY → ACTIVE → CLOSED | INVALIDATED`, partial trims with `shares_remaining`,
a cumulative realized-P&L ledger, MAE/MFE in the postmortem, and a JSON Schema
(`schemas/thesis.schema.json`) that maps cleanly onto a Mongoose model.
`drawdown-circuit-breaker` (F11) and `pre-trade-discipline-gate` both read this state, so it is
the prerequisite for the whole risk half of the playbook set — hence P2 rather than P3.

**Files:** `database/models/thesis.model.ts` mirroring the schema; `lib/actions/journal.actions.ts`;
a `/journal` page; a `get_my_theses` assistant tool.

### F5 — Strategy validation with `backtest-expert` · *high value, medium effort, no new data*
`lib/strategies.ts` says "nothing here is backtested". The playbook turns that into a process:
state the hypothesis, codify with zero discretion, test **≥ 5 years across regimes**, then
spend 80% of the effort trying to break it — parameter sensitivity at 50/75/100/125/150% of
baseline, slippage at 1.5–2×, walk-forward in/out-of-sample, and sample sizes of 30
(minimum) / 100 (preferred) / 200 (high confidence). Verdict is **Deploy / Refine / Abandon**
from a 5-dimension score.

Two of its warnings apply directly to this codebase: OpenStock's universe is a **curated
50-symbol list** (`POPULAR_STOCK_SYMBOLS`), which is survivorship-flavoured if reused as a
backtest universe; and `computeIndicators` needs 200 bars, so a 1-year Yahoo window gives very
few evaluable signals — the history range must be extended first.

**Files:** new `lib/backtest.ts` over `indicators.ts` + `strategies.ts`; a results panel;
`--as-of`-style determinism so results are reproducible.

### F6 — Relative strength as a screener criterion · *medium value, low effort*
`canslim-screener` weights leadership (L) at **20%** with
`RS = 0.40×3m + 0.30×6m + 0.30×12m` versus a benchmark, and `vcp-screener` requires a 7-point
Stage-2 trend template. OpenStock's `lib/strategies.ts` has no benchmark-relative criterion at
all — every strategy is absolute. Adding one RS criterion (vs SPY for stocks, vs BTC for coins)
using the existing history functions is the highest-value single addition to the screener, and
it is the piece both playbooks agree on.
**Files:** `lib/indicators.ts` (relative return helper) + `lib/strategies.ts` (criterion).

### F7 — Trailing stops and R-multiple alerts · *medium value, low effort*
`breakout-trade-planner` supplies the defaults: target **2R**, stop buffer 1% below the
contraction low, max chase 2% above the pivot. Alerts currently store only an absolute
`targetPrice`. Storing an anchor price lets a target be expressed as `−8%` or `2R from entry`.
**Files:** `database/models/alert.model.ts`; `lib/actions/alert.actions.ts`;
`lib/jobs/alert-check.ts`; `components/watchlist/CreateAlertModal.tsx`.

### F8 — Earnings dates as an event-risk gate · *medium value, low effort*
`earnings-calendar` and `pre-trade-discipline-gate` both treat an imminent binary event as a
gate item; today it is permanently "unknown" here. Finnhub (already integrated, free tier)
exposes an earnings calendar, so this is one action + a surface, not a new vendor.
**Files:** `lib/actions/finnhub.actions.ts` + a calendar surface.

### F9 — Account-level circuit breaker · *medium value, medium effort, blocked on F4*
`drawdown-circuit-breaker` ships exact defaults: **daily −2%**, **weekly −5%**, **monthly −8%**,
and a **2-consecutive-loss 24h cooldown**, all on realized P&L only (not unrealized), with
fail-closed behaviour on incomplete state and the rule that an *empty* state allows a new user
to begin. It cannot be built before F4 provides the realized-P&L ledger.

### F10 — Portfolio risk (beta / correlation / concentration) · *medium value, medium effort*
`getPortfolioSummary` computes only value/cost/PnL. Per-asset `volatility` and `maxDrawdown`
exist, and a benchmark series is one call away for both markets, so weighted volatility, max
drawdown, beta and correlation are all derivable. Note: **no vendored playbook covers
cross-asset statistics** — the closest, `portfolio-manager`, is built around Alpaca and
holdings-level allocation rather than risk factors. This one is original work.

### Lower priority
`us-stock-analysis` (a full single-name report format worth copying for the stock page),
`market-environment-analysis` / `market-news-analyst` (macro and impact-ranked news), and
`trade-performance-coach` + `weekly-performance-digest` (expectancy, profit factor, MAE/MFE
cohort stats — all downstream of F4).

### Explicitly not recommended
- **Full CANSLIM.** C, A and I need EPS/revenue growth and institutional ownership. Finnhub can
  supply some of this on the free tier, but a partial implementation would produce a
  confident-looking 0–100 score with three components stubbed — worse than the honest
  technical-only screen that exists now. Take the L component (F6) and leave the rest.
- **Porting the Python scripts.** They are the reference implementation and the tests are
  valuable, but there is no Python runtime in the image and the app's own data layer is the
  right input. Port the *method*, not the code.
- **Real-time streaming, automated execution, options/futures/pair-trading.** Out of scope.

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
| **P0 — now** | S1–S4 (access control). Add the authorization tests (A11) in the same change. |
| **P1 — next** | U1, U2, U3, U12, U13 (cheap and app-wide), A1 (fetch timeouts), A2 (degrade honestly), A7/A9 (validate + guard). |
| **P2 — then** | F3 (position sizing) + F1 (crypto regime) — highest value per unit of effort, and F1 can reuse the existing CoinGecko layer; F6 (relative strength); F4 (journal) to unblock F9; U4–U9, U14, U15, A6, A10. |
| **P3 — later** | F2, F5, F7, F8, F10, remaining minors. |

Every P2+ item has a specified method in `.agents/skills/` and is readable by the running app
through `lib/analysis-skills.ts` — so the same playbook can drive the implementation, the
assistant's answers, and the review of the result.
