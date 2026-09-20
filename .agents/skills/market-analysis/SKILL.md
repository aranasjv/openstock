---
name: market-analysis
description: Assess market regime, breadth, sector rotation and individual asset condition for stocks and crypto using OpenStock's own data layer. Use when asked "what is the market doing", "is this risk-on or risk-off", "review my watchlist/holdings", "is X overbought", "where is the trend", or whenever a market or asset judgement is needed. Never recall prices from memory.
license: MIT. Methodology adapted from tradermonty/claude-trading-skills (MIT).
metadata:
  author: openstock
  version: "1.0.0"
  adapted-from: https://github.com/tradermonty/claude-trading-skills
---

# Market Analysis

Produce a defensible read of a market or an asset, built only from data the application can
actually fetch right now. This is a **conditions report, not a prediction and not advice**.

## Non-negotiables

1. **Never state a price, percentage, indicator or market cap from memory.** Your training
   data is stale and any recalled figure is wrong. Fetch it (step 1) or say it is unavailable.
2. **Never present the read as advice.** Report what the rules show and what would invalidate
   the read. No buy/sell/hold, no price targets, no projected returns.
3. **The screener ranking is authoritative.** `lib/strategies.ts` scores deterministically.
   Report its output; do not re-rank with your own scoring.
4. **Say when data is delayed, cached or degraded.** The stock history source is unofficial;
   crypto data may be rate limited; quotes may be 15+ minutes delayed on free tiers.

## Step 0 — Fix the scope before fetching

Decide which of the three shapes applies, because each fetches a different amount:

| Scope | Example ask | What to gather |
|---|---|---|
| Single asset | "is NVDA overbought" | one history + indicators |
| A list | "review my watchlist" | one history per symbol, plus the screener |
| The whole market | "what's the market doing" | screener for **both** markets + news + crypto market breadth |

For a whole-market read, always run **both** `run_screener('stock')` and
`run_screener('crypto')`. Reporting one market as if it were "the market" is a common and
misleading shortcut.

## Step 1 — Fetch through the application's own surface

Use the assistant's tools (or the underlying server functions) — never a raw web search for
prices. This is what keeps every figure reproducible.

| Question | Assistant tool | Underlying function |
|---|---|---|
| Resolve a name/ticker/coin | `search_assets` | `searchStocks` / `searchCrypto` |
| Stock price + day change | `get_stock_quote` | `getQuote`, `getCompanyProfile` |
| Top coins by cap | `get_crypto_markets` | `getCryptoMarkets` |
| One coin's detail | `get_crypto_coin` | `getCryptoCoinDetail` |
| Indicators for any asset | `get_indicators` | `computeIndicators` + price history |
| Rules-based screen | `run_screener` | `runScreener` |
| Headlines | `get_market_news` | `getNews` / `getCryptoNews` |
| The user's positions | `get_my_holdings` | `getPortfolioSummary` |
| The user's watchlist | `get_my_watchlist` | `getUserWatchlist` |

Crypto identifiers are **CoinGecko ids** (`bitcoin`, `solana`), not tickers (`BTC`). Resolve
with `search_assets` first if unsure — a wrong id silently returns nothing.

## Step 2 — Read condition with the project's own indicators

`get_indicators` returns the `IndicatorBundle` from `lib/indicators.ts`. Interpret it with the
thresholds the app already uses — do not invent your own:

| Signal | Read |
|---|---|
| `sma50 > sma200`, price above both, `sma200` rising | Established uptrend |
| price > `sma50`, `rsi14` 50–70 | Constructive momentum, not stretched |
| `rsi14` ≤ 40 and price > `sma200` | Pullback inside an uptrend |
| price ≥ `high20` (within ~0.1%) on volume > 1.5× `avgVolume20` | Breakout attempt |
| price ≤ `sma200 * 0.85`, `rsi14` ≤ 35 | Stretched to the downside |
| `volatility` high **and** `maxDrawdown` deep | Position-sizing risk, not a buy signal |

A `null` field means *insufficient history*, not zero. For assets younger than ~200 daily
bars, say the long-term trend is undeterminable rather than guessing it.

For the screener, report per candidate: `symbol`, `score` (`matched/total`), `tier`, the
`passed` conditions with their measured detail, and the standing disclaimer. A score is the
share of conditions met, **not** a probability of gain.

## Step 3 — Add a regime read

For a whole-market question, assemble the regime picture using
[`references/regime-framework.md`](references/regime-framework.md): participation breadth,
trend posture, rotation, and the resulting exposure stance. That file also defines the
risk-on / neutral / risk-off bands so the verdict is consistent between runs.

## Step 4 — Report in a fixed shape

Always answer in this order, briefly:

1. **As of** — timestamp and the freshness/limitations of each source used.
2. **Facts** — the figures, each attributed to the tool that produced it.
3. **Condition** — what the indicators/screener show, using the vocabulary in step 2.
4. **Counter-case** — the strongest reading *against* the one above, and what would confirm it.
5. **Invalidation** — the specific level or event that would flip the read.
6. **What is missing** — degraded feeds, unpriced symbols, insufficient history.

Skipping the counter-case and invalidation is what turns analysis into a sales pitch. Both
are mandatory.

## Edge cases

- **Rate limiting / empty results.** Say data is unavailable and that it usually clears; do
  not estimate to fill the gap.
- **`unpricedSymbols` non-empty.** Portfolio totals exclude those positions. State this
  rather than reporting the total as if it were complete.
- **`unavailableReason` set.** The stock feed is unofficial and can be blocked; a partial
  screen is not evidence that nothing matched.
- **Question unrelated to markets.** Say so and steer back.

## Worked example

> **Ask:** "Is bitcoin overbought right now?"

1. `search_assets` is unnecessary — the CoinGecko id is `bitcoin`.
2. `get_indicators({ symbol: "bitcoin", assetType: "crypto" })` → e.g. RSI 71.4, MACD above
   signal, price above SMA50/SMA200, 12% off the 20-day high.
3. Read: momentum is positive and price is in an uptrend, but RSI above 70 is the
   "stretched" band — overbought *as a condition*, not a forecast.
4. Report: as-of time, the figures with the tool named, the condition, the counter-case
   (uptrend plus bullish MACD can persist while RSI stays high), invalidation (a close back
   below the 20-day low with expanding volume), and the crypto rate-limit caveat.

## Reference

- [`references/regime-framework.md`](references/regime-framework.md) — posture bands, breadth,
  rotation, and the exposure stance vocabulary.
- `lib/indicators.ts`, `lib/strategies.ts` — the authoritative formulas and criteria.
- `AGENTS.md` — data-source reliability and rate-limit notes.
