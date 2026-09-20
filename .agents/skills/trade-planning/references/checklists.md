# Pre-trade gate and post-trade review

Adapted from the `pre-trade-discipline-gate`, `position-sizer`, `drawdown-circuit-breaker`
and `signal-postmortem` methodologies in `tradermonty/claude-trading-skills` (MIT).

## Pre-trade gate — all items must pass

Evaluate every row explicitly and report the result. **One failure blocks the entry.** The
gate is deliberately fail-closed: when data is unavailable, treat the item as failed and say
which data was missing.

| # | Check | Passes when | Fails when |
|---|---|---|---|
| 1 | Stop defined | A level is derivable from indicators | No stop, or a "mental stop" |
| 2 | Size calculated | Shares derived from stop distance | Round number, or "what feels right" |
| 3 | Position cap | Notional ≤ 20% of equity | Concentration beyond the cap |
| 4 | Trade risk cap | Planned risk ≤ 2% of equity | Oversized relative to the 1% default |
| 5 | Portfolio heat | Existing heat + new ≤ 6% | Adding risk to an already-hot book |
| 6 | Regime allows it | Stance is Risk-on or Neutral | Stance is Risk-off (hard veto) |
| 7 | Reward:risk | ≥ 2R to first target | Sub-2R into an unknown win rate |
| 8 | Not revenge | No loss in the last 24h, or a calm, planned entry | Entering straight after a loss to "make it back" |
| 9 | Not chasing | Entry within the planned zone, not after a vertical move | Buying an extended candle |
| 10 | Loss streak | Fewer than 3 consecutive losses | 3+ losses → mandatory cooldown |
| 11 | Daily loss limit | Account not down ≥ 3% today | Breached → no new risk today |
| 12 | Event risk | No known binary event imminent | Earnings/FOMC imminent — **note: OpenStock has no earnings calendar, so this item is usually "unknown"**. Treat unknowns as a caution, not a pass, and say so. |

### Verdict

- **PASS** — every item passes → plan may be taken at the sized amount.
- **REDUCE** — only caps/heat/regime-at-neutral fail → halve the size, re-check.
- **BLOCK** — stop missing, size cap breached, regime Risk-off, or a discipline item (8–11)
  fails → do not take the trade. Give the specific item that blocked it.

## Post-trade review template

Fill this in for every closed trade. The point is to separate **process** from **outcome**.

```
Symbol / asset type:
Plan: entry __  stop __  size __  target1 __  target2 __  regime stance __
Fill: entry __  exit __  size __
Outcome: R = (exit − entry) / (entry − stop) = __
Stop honoured? yes / no
Process verdict: followed plan / broke plan
What would I do the same next time:
What would I change:
```

### Cohort stats (report only at n ≥ 20)

```
trades: __          win rate: __%
avg win R: __       avg loss R: __
expectancy = winRate × avgWinR − lossRate × avgLossR = __
max consecutive losses: __
```

Below 20 trades, any win rate is noise. Say so instead of quoting a percentage.

### The two failure patterns worth naming

- **Resulting** — judging the plan by whether it won. A plan-following loss is a good trade.
- **Revenge escalation** — increasing size after a loss. Detectable as rising `plannedRisk`
  across consecutive losing trades; the gate's items 8, 10 and 11 exist to stop it.

## What this skill must never do

OpenStock holds no account balance, no cash and no broker connection. Never invent an account
size, never assume a fill price, and never present the plan as an instruction. Every number
that could move money is an input from the user or a fetched market level.
