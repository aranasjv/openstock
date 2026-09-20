---
name: finance-dashboard-ux
description: Review or design UI for OpenStock's dense, dark financial dashboards — data density, numeric readability, accessibility of live-updating figures, motion restraint and copy voice. Use when asked to "review my UI", "improve the dashboard", "check accessibility", "audit UX", "make this look better", or when building any new panel, table, chart or drawer in this app.
license: MIT. Review method adapted from vercel-labs/agent-skills; design direction adapted from anthropics/skills.
metadata:
  author: openstock
  version: "1.0.0"
  adapted-from: https://github.com/vercel-labs/agent-skills, https://github.com/anthropics/skills
---

# Financial Dashboard UX

OpenStock is a **glanceable instrument**, not a marketing page. The user is scanning numbers
to make a decision. Every rule below serves that: get the data on screen, make it legible,
make it trustworthy, and get out of the way.

## The design brief (this project's line)

- **Dark, low-chroma, teal-accented.** Surfaces: `#0F0F0F` / `#141414` / `bg-gray-900/30`
  panels with `border-gray-800` hairlines. Accent: teal (`teal-600` action, `teal-300` link).
  Text ramp: `text-white` → `text-gray-400` → `text-gray-500` → `text-gray-600`.
- **Dense, single-screen.** The shell is viewport-height; panels scroll **internally**; the
  page itself never scrolls. No large footers or marketing banners — if something is needed,
  it goes in the left sidebar. Reclaiming vertical space always beats adding chrome.
- **Numbers are the content.** Everything else — titles, labels, chrome — is subordinate.
- Do not delete a functional view (a chart, a data panel) to save space. Remove chrome first,
  and ask before cutting a feature.

## Review procedure

1. Read the target files (or the files matching the user's pattern).
2. Walk [`references/ux-checklist.md`](references/ux-checklist.md) — every category.
3. Report findings as `path:line — rule — what to change`, most severe first. Terse; no
   preamble, no praise padding.
4. Fix only what the user asked to fix. A review is not an invitation to redesign the app.

Severity: **blocker** (unusable/inaccessible) · **major** (hurts the decision) · **minor**
(polish). Say which each finding is.

## Density and layout

- Panels fill available height and scroll internally (`.min-h-0 flex-1 overflow-y-auto`).
  A panel that grows with its content pushes the dashboard into page scroll — a regression.
- Fixed chrome (headers, filters, disclaimers) is `shrink-0`; the scrolling region is
  `min-h-0 flex-1`. Without `min-h-0` a flex child refuses to shrink and the layout blows out.
- Equal-height panels in a row: use the same row with `h-full`, not per-panel heights.
- Prefer a compact header line over a hero section. The stock dashboard's one-line header with
  the Ask AI entry is the pattern to copy.
- Do not add a page title, breadcrumb, or eyebrow label where the sidebar already says it.

## Numeric readability (the thing finance UI gets wrong)

- **Right-align numeric columns; left-align text columns.** Misaligned numerals are the single
  most common defect in a data table.
- **Use tabular figures** for any column of numbers: `tabular-nums` (or
  `font-variant-numeric: tabular-nums`) so digits do not jitter between refreshes.
- **Fixed decimal places per column.** A price column that alternates `$1.5` and `$1.50` reads
  as noise. Crypto needs more precision than equities (`formatCryptoPrice` vs `formatPrice`).
- **Always show the sign** on change values (`+1.2%` / `−0.8%`), not colour alone.
- **Never colour-only.** Green/red must be paired with a sign, an arrow, or a label — colour
  is inaccessible to ~8% of men and invisible in greyscale.
- A `null` figure renders as an explicit `—` or `n/a`, never as `0`. Zero is a *value*; a
  missing price rendered as 0 reads as a total loss (see `unpricedSymbols` in holdings).

## Accessibility

- **Contrast.** `text-gray-600` on `#0F0F0F` is roughly 3.5:1 — below AA for body text. Use it
  only for genuinely decorative microcopy; anything the user must read goes to `text-gray-400`
  or lighter. Flag every `gray-600`/`gray-700` usage that carries meaning.
- **Focus.** Every interactive element needs a visible `focus-visible` ring. Icon-only buttons
  (`Trash2` in the conversation list, the send button) are the usual offenders.
- **Keyboard.** Tables, drawers and the command palette must be fully operable without a
  mouse; the coin drawer should trap focus and close on `Escape`.
- **Touch targets** ≥ 44×44px on mobile; the compact dashboard shrinks controls below this —
  check the `lg:hidden` header path.
- **Semantics.** Data tables use real `<table>`/`<th scope>`; a grid of `<div>`s is not a
  table. Give icon-only buttons `aria-label`.
- **Live regions.** Values that update on a timer should be `aria-live="polite"` (or explicitly
  `aria-hidden` if decorative) so a screen reader is not spammed with every tick.
- **Reduced motion.** Wrap any non-essential animation in
  `@media (prefers-reduced-motion: reduce)`.

## Motion

Motion must answer a user action (open, expand, confirm) — never decorate.
- One orchestrated page-load moment beats an entrance animation on every panel.
- No fade-and-slide-up on each section; no hover lift on every card.
- The chat panel's "Fetching market data…" spinner is the right kind: it shows *what changed*.
- Ticker-style auto-scrolling numbers are a tell; do not add them.

## Copy

Voice is the interface's, not a person's. Match what the codebase already does.
- Sentence case, active voice, plain verbs. A control says what it does: "Send", "New
  conversation", "Delete conversation" (title attr).
- An action keeps its name through the flow: a "Publish" button produces a "Published" toast.
- **Errors say what happened and how to fix it.** The assistant's rate-limit message
  ("Try again in about 42s — each turn can make several model calls") is the standard: no
  apology, no vagueness.
- **Empty states invite action.** "No conversations yet." is weak; offer the button that fixes
  it. Compare the chat panel's empty state, which prompts with example questions.
- Never leave a bare "Error" or "Something went wrong" with no next step.

## Avoid the generated-page tells

These read as AI-generated regardless of subject. Several already exist in the codebase —
do not add more, and prefer removing them when touching the area:
- ALL-CAPS tracked eyebrow labels above every section (must be reserved for genuinely tiny
  metadata, if used at all).
- Meta strings joined with middle dots (`A · B · C`) as a default; `git config` style.
- Soft grey shadow (`rgba(0,0,0,.1)`) under every card + one border-radius on everything
  regardless of hierarchy.
- Gradient washes used as decoration rather than to encode data.
- A `→` appended to every link/button.
- Numbered markers (`01 / 02 / 03`) where the content is not actually a sequence.

## What good looks like here

`components/screener/MustBuySection.tsx` + `CandidateRow` is the reference implementation:
- header line carries the scan counts and the strategy selector, nothing more;
- every candidate shows *why* it scored — passed conditions with measured values — so the
  ranking is auditable rather than trusted;
- the disclaimer is a small, persistent footnote, not a modal;
- the list scrolls internally and the panel height never changes.

## Reference

- [`references/ux-checklist.md`](references/ux-checklist.md) — the full review checklist to
  walk, category by category.
- `AGENTS.md` — the density/layout rules stated as project constraints.
