# Vendored skills — provenance

The skills in [`skills/`](skills/) are **third-party content, copied verbatim**. They are not
written by this project and — deliberately — not summarised or adapted. Copying them whole
means the full methodology (including the `references/`, `assets/`, `schemas/` and `scripts/`
each skill ships) is present and can be followed exactly.

If you change one, you are diverging from upstream: do it in a separate commit that says so.

This file sits outside `skills/` on purpose: a loose `.md` file inside the skills root is
reported as a skipped entry by skill loaders.

## Sources

| Repository | Commit | Licence |
|---|---|---|
| [tradermonty/claude-trading-skills](https://github.com/tradermonty/claude-trading-skills) | `a7a46f099fdced13067a558a08e65c44a6d78e99` | MIT |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | `063bee94c3f4df8453406c830b0a7df0f2860278` | MIT |
| [anthropics/skills](https://github.com/anthropics/skills) | `34040c9c568585f6929bedeaad110ad08f079624` | see `frontend-design/LICENSE.txt` |

Refresh with:

```bash
git clone --depth 1 https://github.com/<owner>/<repo>.git
cp -r <repo>/skills/<name> .agents/skills/<name>
```

## What was vendored

### Market & regime — tradermonty
`market-breadth-analyzer` · `uptrend-analyzer` · `exposure-coach` · `crypto-regime-analyzer` ·
`market-environment-analysis` · `market-news-analyst`

### Single-asset analysis — tradermonty
`technical-analyst` · `us-stock-analysis`

### Screening & trade planning — tradermonty
`vcp-screener` · `canslim-screener` · `breakout-trade-planner`

### Risk & discipline — tradermonty
`position-sizer` · `pre-trade-discipline-gate` · `drawdown-circuit-breaker`

### Journal & review — tradermonty
`trader-memory-core` · `signal-postmortem` · `trade-performance-coach` ·
`weekly-performance-digest`

### Research — tradermonty
`backtest-expert`

### Calendar — tradermonty
`earnings-calendar`

### Development & design
`vercel-react-best-practices` · `web-design-guidelines` (vercel-labs) · `frontend-design`
(anthropics)

## Deliberate exclusions

`tradermonty/claude-trading-skills` publishes ~74 skills. The ones **not** vendored fall into
three groups, and the reasoning is recorded so this is a decision rather than an oversight:

- **Out of domain for this app** — futures, options, MT5 robot testing, pair-trading stat-arb,
  crypto DeFi pipelines, dividend tax accounting, short-selling planners. OpenStock is a
  long-only stocks-and-crypto dashboard with no broker connection.
- **Agent/meta tooling** — `skill-designer`, `skill-idea-miner`, `dual-axis-skill-reviewer`,
  `skill-integration-tester`, `trading-skills-navigator`. These build and review other skills;
  they are not analysis methods.
- **Chart-image driven and very large** — `breadth-chart-analyst` (~1.8 MB) and `sector-analyst`
  (~1.7 MB) are mostly sample chart images and require the user to supply chart screenshots,
  which this app cannot capture.

Add any of them the same way (`cp -r`) if a use appears.

## Local deviation from upstream

One rename, and nothing else:

- `vercel-labs/agent-skills/skills/react-best-practices` → **`vercel-react-best-practices`**.
  The upstream directory is `react-best-practices` but its frontmatter declares
  `name: vercel-react-best-practices`. The Agent Skills specification requires the two to
  match, and a mismatch makes tools skip the skill with a warning. The directory was renamed
  to match the declared name; **the file contents are untouched.**

## How these are consumed

1. **By an agent working in the repo** — `.agents/skills/<name>/SKILL.md` is discovered and
   loaded by description. Only the frontmatter enters context until the skill activates.
2. **By the running app** — [`lib/analysis-skills.ts`](../lib/analysis-skills.ts) reads the
   same files at request time, so the assistant can pull a playbook instead of guessing:
   - the chat lists every playbook in its system prompt and pulls one with the
     `get_analysis_playbook` tool;
   - the screener's "Explain" action can be driven by one via the `ANALYSIS_PLAYBOOK` setting.

   This is why the Dockerfile copies `.agents` into the runtime image — Next's standalone
   tracing follows imports, not directories read with `fs`.

Note on the `scripts/`: most tradermonty skills ship Python helpers that call FMP, Alpaca or
public CSVs. **This app does not run them** — there is no Python runtime in the image. They
are vendored because they are part of the skill and document exactly how each method computes
its numbers. The assistant applies the *methodology* to figures it fetches through its own
tools.
