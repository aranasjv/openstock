# Regime framework

Turn a pile of individual indicators into one consistent market posture. Adapted from the
breadth / uptrend / exposure-coach / sector-analyst methodology in
`tradermonty/claude-trading-skills` (MIT), restricted to what OpenStock can compute from its
own data.

Everything below is a **proxy**. OpenStock has no exchange-wide breadth feed, so breadth is
measured over the screener universe (`POPULAR_STOCK_SYMBOLS`, top coins by market cap). Say
so when reporting: "breadth over the 12-name screen", not "market breadth".

## Inputs and how to get them

Run `run_screener` for both markets and `get_indicators` for the index/asset proxies.

| Input | Source |
|---|---|
| `pctAbove200` — share of universe with price > `sma200` | `get_indicators` per symbol |
| `pctGolden` — share with `sma50 > sma200` | `get_indicators` per symbol |
| `pctAtHigh` — share within 0.1% of `high20` | `get_indicators` per symbol |
| `netAdvancers` — (# up 24h) − (# down 24h) | `run_screener` candidates' `changePercent24h`, or `get_crypto_markets` |
| `indexPosture` — trend state of SPY (stocks) / BTC (crypto) | `get_indicators` |

## Scoring — 0 to 8

Score each row, then sum. Keep the row values in the report so the verdict is auditable.

| Component | 0 points | 1 point | 2 points |
|---|---|---|---|
| `pctAbove200` | < 40% | 40–60% | > 60% |
| `pctGolden` | < 30% | 30–50% | > 50% |
| `pctAtHigh` | < 10% | 10–25% | > 25% |
| `netAdvancers` | negative | flat (±2) | positive |

Plus the index proxy, scored separately (0–2):

| `indexPosture` | Points |
|---|---|
| price below `sma200` and `sma200` falling | 0 |
| mixed (price above/below `sma200`, flat slope) | 1 |
| price above `sma200`, `sma50 > sma200`, `sma200` rising | 2 |

**Total = breadth score (0–8) + index score (0–2), out of 10.**

## Bands → exposure stance

| Total | Stance | What it means for new risk |
|---|---|---|
| 8–10 | **Risk-on** | New entries allowed at plan size; the tape is cooperating |
| 5–7 | **Neutral** | New entries at half size, highest-quality setups only |
| 3–4 | **Defensive** | No new risk; manage existing positions |
| 0–2 | **Risk-off** | No new entries; prioritise capital preservation |

This stance is the hand-off into the `trade-planning` skill: it caps size and can veto an
entry outright. A stance is never a reason to *sell* — it gates new risk only.

## Rotation

Approximate rotation by grouping the universe and comparing `change30d` within each group.
Groups come from the TradingView widget definitions in `lib/constants.ts`:

- Stocks: `Financial`, `Technology`, `Services`
- Crypto: `Layer 1`, `Layer 2 & DeFi`, `Meme & Payments`

Report the strongest and weakest group and the spread between them. A wide spread (leaders
well ahead of laggards) is a trending, rotational tape; a narrow spread is a
risk-on/risk-off tape where everything moves together. Note the group sizes are tiny
(4–6 names), so treat this as directional only.

## Reporting the regime

```
As of <UTC timestamp>
Breadth (12-name screen): above 200d 58% (1), golden cross 50% (1), at 20d high 17% (1), net advancers +3 (2)
Index (SPY): above 200d, 50>200, 200d rising (2)
Total 7/10 → Neutral
Rotation: Technology +4.1% / Services −1.2% over 30d (wide spread)
Read: ...  Counter-case: ...  Invalidation: ...
```

## Failure modes to avoid

- **Universes of different sizes.** Never compare a breadth % across markets as if they were
  one pool. Report stocks and crypto separately.
- **Missing data counted as bearish.** Symbols returning `null` indicators are *unknown*.
  Report the count of unknowns and exclude them from the denominator, or the score drifts
  with provider outages.
- **A single day read as a regime.** Regime is a multi-week posture. One down day moves
  `netAdvancers`, not the band.
