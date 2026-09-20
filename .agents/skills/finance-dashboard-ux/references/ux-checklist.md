# UI/UX review checklist

Walk every category. Report as `path:line — severity — what to change`. Severity is
**blocker** / **major** / **minor**.

## 1. Density and layout
- [ ] Shell is viewport-height; the page itself does not scroll at any breakpoint.
- [ ] Every content panel uses `min-h-0 flex-1 overflow-y-auto` and scrolls internally.
- [ ] Fixed chrome is `shrink-0`; no panel pushes the page taller than the viewport.
- [ ] No large footer, marketing banner, or sponsor embed.
- [ ] Panels in the same row are equal height via `h-full`, not hard-coded heights.
- [ ] Mobile (`< lg`) still usable: no horizontal overflow, nav reachable.

## 2. Numbers
- [ ] Numeric columns right-aligned; text columns left-aligned.
- [ ] Numeric columns use `tabular-nums`.
- [ ] Decimal places consistent within a column.
- [ ] Change values carry an explicit sign, not colour alone.
- [ ] Missing values render as `—`/`n/a`, never `0`.
- [ ] Crypto precision differs from equity precision (`formatCryptoPrice` vs `formatPrice`).
- [ ] Currency and units are labelled where ambiguity is possible.

## 3. Colour and contrast
- [ ] No meaningful text at `gray-600`/`gray-700` on a near-black surface (≈3.5:1).
- [ ] Green/red states also have a non-colour cue.
- [ ] Focus rings visible on every interactive element, including icon-only buttons.
- [ ] Accent teal used for action/attention, not decoration.

## 4. Accessibility
- [ ] Icon-only buttons have `aria-label` (or `title` at minimum).
- [ ] Data tables are real `<table>` with `<th scope>`; not div grids.
- [ ] Drawers/modals trap focus and close on `Escape`.
- [ ] Touch targets ≥ 44px on mobile.
- [ ] Timer-updated values are `aria-live="polite"` or `aria-hidden`.
- [ ] `prefers-reduced-motion` respected for any animation.
- [ ] Keyboard-only path exists for: strategy select, candidate row expand, conversation
      switch/delete, coin drawer open/close, chat send.

## 5. States
- [ ] **Loading** — a skeleton or spinner that names what is loading ("Fetching market data").
- [ ] **Empty** — invites the action that fills it, does not just state the absence.
- [ ] **Error** — says what happened *and* the next step; no bare "Error".
- [ ] **Degraded** — partial data is labelled (e.g. "3 of 12 assets could not be analysed"),
      and the disclaimer survives a rate-limit.
- [ ] **Stale** — cached/delayed data is marked as such.

## 6. Motion
- [ ] Motion answers an action, not decorates a load.
- [ ] No entrance animation on every section/panel.
- [ ] No auto-scrolling ticker numbers.
- [ ] Transitions are short (< 250ms) and interruptible.

## 7. Copy
- [ ] Sentence case; no ALL-CAPS labels except tiny metadata.
- [ ] Active voice; a control names its outcome ("Send", not "Submit").
- [ ] Action names stay consistent across button → toast → state.
- [ ] Errors are specific and actionable; no apology, no vagueness.
- [ ] No marketing tone inside the product surfaces.

## 8. Evidence and trust (finance-specific)
- [ ] Every number shown can be traced to its source (tool/table/feed).
- [ ] Rule-based screens show *which conditions passed* and the measured value, not only a
      score.
- [ ] The "not investment advice" disclaimer is present where a screen or signal is shown —
      small and persistent, never a modal.
- [ ] Data provenance limits are stated (free-tier delay, unofficial stock source, rate limit).

## 9. Anti-tells (generated-page smell)
- [ ] No ALL-CAPS eyebrow above every heading.
- [ ] No middle-dot meta strings used as a default pattern.
- [ ] No uniform card kit (same radius/shadow on every element regardless of hierarchy).
- [ ] No decorative gradient washes.
- [ ] No `→` appended to every link.
- [ ] No `01 / 02 / 03` numbering where the content is not a sequence.
