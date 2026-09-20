---
name: trade-planning
description: Build a risk-first trade plan for stocks and crypto — stop placement, position size, R-multiple targets, portfolio heat, a pre-trade gate and a post-trade review. Use when asked to "size a position", "plan a trade", "where should my stop be", "review my risk", "how much should I buy", or to journal/postmortem a closed trade. Produces a plan, never an order, and never advice.
license: MIT. Methodology adapted from tradermonty/claude-trading-skills (MIT).
metadata:
  author: openstock
  version: "1.0.0"
  adapted-from: https://github.com/tradermonty/claude-trading-skills
---

# Trade Planning

Decide **how much to risk before deciding what to buy**. The order here is deliberate and
non-negotiable: a plan that starts from conviction and works backwards to a stop is how
accounts get damaged.

OpenStock is not a broker and executes nothing. This produces a **plan the user acts on or
ignores** — never a recommendation to take the trade, never an order.

## Non-negotiables

1. **No plan without a stop.** If a stop level cannot be defined from the data, there is no
   plan and the answer is "this setup has no definable risk, so it cannot be sized".
2. **Size comes from the stop, not from confidence.** Conviction changes *whether* to trade
   (the gate), never *how much*.
3. **Every figure is fetched.** Entry and stop levels come from `get_indicators` output
   (`price`, `low20`, `high20`, `sma50`, `sma200`, `volatility`). Never recall them.
4. **This is not advice.** Present the plan, the risk, and what invalidates it. Do not say
   "you should buy".

## Inputs you must ask for (the app does not store them)

| Input | Default | Why it cannot be assumed |
|---|---|---|
| Account equity | — | Sizing is meaningless without it |
| Risk per trade | 1% | Cap at 2% unless the user insists |
| Max position size | 20% of equity | Prevents concentration |
| Max portfolio heat | 6% | Total open risk across all positions |

Optionally read `get_my_holdings` to compute existing heat and avoid stacking correlated
risk. Never treat a missing holding price as zero — `unpricedSymbols` means the total is
partial.

## Step 1 — Establish the risk level

Fetch `get_indicators({ symbol, assetType })`. Then pick a stop by setup type:

| Setup | Stop basis |
|---|---|
| Breakout (`price ≥ high20`) | Just below the breakout base: `low20`, or `entry − 2 × volatility%` |
| Pullback (`rsi14 ≤ 40`, above `sma200`) | Below the pullback low (`low20`) — a close below invalidates the pullback |
| Trend continuation | Below `sma50`; if the stop distance exceeds the size cap, the trade is too far extended |
| Crypto | Historically more volatile — use the same rules but expect wider stops and smaller size |

Compute `stopDistance = entry − stop` (long only; this skill does not plan shorts).

## Step 2 — Size the position

```
riskAmount   = equity × riskPct
shares       = riskAmount / stopDistance          # the binding constraint
maxShares    = (equity × maxPositionPct) / entry  # concentration cap
shares       = min(shares, maxShares)             # floor to whole units where sensible
plannedRisk  = shares × stopDistance              # what is actually at risk
```

If `shares` is driven by the concentration cap rather than the risk cap, say so — the
position is then **larger than 1R** and the user is taking more risk than intended.

## Step 3 — Set targets in R, not in hope

Define targets as multiples of the risk, so outcomes are comparable across trades:

```
R         = stopDistance
target1   = entry + 2R      # first scale-out
target2   = entry + 3R      # runner
rewardRisk = (target1 - entry) / R
```

Reject the plan if `rewardRisk < 2` **and** the win rate assumption is not unusually high.
State the arithmetic; do not assert "good odds".

## Step 4 — Compute portfolio heat

```
heat = Σ plannedRisk across open + new positions
```

If `heat + plannedRisk > maxHeat`, the correct output is "this trade cannot be added at
plan size" — either skip it or reduce size. Do not bend the heat limit to fit the setup.

## Step 5 — Run the pre-trade gate

Load [`references/checklists.md`](references/checklists.md) and evaluate **every** item. Any
single failure blocks the entry. The gate exists to catch planless, oversized, revenge and
regime-blocked entries — the failure modes that actually lose money.

The regime stance comes from the `market-analysis` skill: a **Risk-off** stance vetoes new
entries outright, and a **Neutral** stance caps size at half.

## Step 6 — Hand off to the app

A finished plan can be wired into OpenStock without any new feature:

- Create alerts at the stop and target with the existing alert feature (`createAlert`:
  `ABOVE`/`BELOW` + `targetPrice`) so the levels fire in Telegram.
- Record the position in Holdings once filled, so `get_my_holdings` reflects real heat.

## Step 7 — Journal and review

Log every plan and its outcome so the *process* can be judged separately from the *result*:

- thesis in one sentence, entry, stop, target, size, and the regime stance at entry;
- outcome in R (`(exit − entry) / stopDistance`), and whether the stop was honoured;
- a process verdict: **followed the plan** vs **broke the plan** — a winning trade that broke
  the plan is a process failure, and a losing trade that followed it is not.

Aggregate over ≥20 trades: win rate, average win R, average loss R, expectancy
(`winRate × avgWinR − lossRate × avgLossR`). Fewer than 20 trades is noise — say so.

## Worked example

> **Ask:** "Plan a trade in AAPL." Equity 50,000, risk 1%, entry 200.00.

1. `get_indicators` → `low20` 191.00, `volatility` 1.6%, price 200.00.
2. Stop = 191.00 → `stopDistance = 9.00`.
3. `riskAmount = 500` → `shares = 55`. `maxShares = 10,000/200 = 50`. **Concentration cap
   binds**, so size = 50 shares; `plannedRisk = 450` (0.9R, slightly under the 1% target).
4. `target1 = 218`, `target2 = 227`; `rewardRisk = 2.0`.
5. Existing heat 2.1% + 0.9% = 3.0% ≤ 6% → fits.
6. Gate: stop defined, size within caps, regime Neutral (halve to 25 shares), no loss streak,
   no revenge flag → **plan passes at reduced size**.
7. Report entry, stop, size, both targets, planned risk in $ and %, what invalidates it, and
   that this is a plan rather than a recommendation.

## Reference

- [`references/checklists.md`](references/checklists.md) — the pre-trade gate and the
  post-trade review template.
- `market-analysis` skill — the regime stance that feeds step 5.
