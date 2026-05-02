# Graph visual (2026-04)

Match the GitKraken commit graph as closely as possible. The graph is
the *centerpiece* of the app and must read instantly: where am I, which
lane is which branch, what merged into what.

## Purpose
Replace the desaturated, thin-line graph with GitKraken's signature
look: vibrant lane colors, prominent filled dots, merge donut rings,
smooth bezier transitions, and a high-contrast selection halo.

## Public contract
`render(args: RenderArgs)` in `src/lib/graph/renderer.ts`. Same input
shape as before — only the painted output changes.

Inputs unchanged: `nodes`, `shaToRow`, scroll/view rect, `selectedSha`,
`hoverRow`, `dpr`, `wipPresent`, `wipHeadSha`.

## Invariants
- Lane colors come from a fixed 8-entry palette modulo lane index.
  Same lane → same color across the entire graph view.
- Dot center is exactly at `(laneX(lane), rowY(row))`. The HTML rows
  in `GraphCanvas.svelte` align to `ROW_HEIGHT` so canvas and text
  stay locked.
- Merge commits (`parents.length >= 2`) render as a donut: outer
  colored ring + inner bg-colored fill. Never as a plain dot.
- Selected commit gets a bright halo ring outside the dot. Hover gets
  a subtler halo. Selection wins if both apply.

## Visual constants
- Palette: GitKraken-inspired, high-saturation, in lane order
  (teal, gold, magenta, green, blue, orange, purple, red).
- `DOT_RADIUS` 5.0 (was 4.5). Merge inner radius `DOT_RADIUS - 1.8`.
- `LINE_WIDTH` 2.0 (was 1.6). `lineCap: round`.
- Selection halo: 2px white-ish ring at `DOT_RADIUS + 3`, plus a
  faint outer glow (2px alpha) so it pops over any lane color.
- WIP "ghost" dot stays dashed at the head lane color.

## Out of scope
- Per-branch user color overrides.
- Animations on commit add/remove.
- Lane reordering / branch grouping changes — that's layout, not paint.

## Rejected alternatives
- **SVG instead of canvas.** Canvas already handles thousands of
  rows at 60fps; SVG would regress on large repos.
- **Theme-aware palette.** GitKraken's palette is its identity; we
  pick colors that read on both light and dark backgrounds and keep
  one palette.
