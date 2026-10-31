# UI layout, spacing and icons (2026-11)

Neighbors: [ui-overhaul-2026-04.md](ui-overhaul-2026-04.md) (previous layout),
[theme-system.md](theme-system.md) (colors — untouched by this spec),
[graph-visual-2026-10.md](graph-visual-2026-10.md) (graph painting).

## Purpose
Make GitBee's *structure* match GitKraken's: where things sit, how big they
are, how much room they get, and which icons they use. Colors and themes are
out of scope — every color still comes from the theme variables.

Problems in v0.4.x (from the UI inventory):
- No size tokens: 25 distinct padding values, header heights of 22/28/28/30/40 px.
- Icons are unicode glyphs and emoji (↓ ⇪ ⎇ ⛶ ⤴ 🏷 🗑 👁 ⊕ …): they render
  differently per OS font (the macOS build showed it), have uneven sizes and
  baselines, and some read as decoration rather than actions.
- Toolbar buttons are small text pills; GitKraken's are 48 px icon-over-label
  targets that read at a glance.

Reference numbers come from GitKraken 12.6.1's own CSS and constants
(`.research/gitkraken-12.6.1`, extracted read-only; no GitKraken code or
assets are copied).

## Public contract

### Tokens (`src/routes/+layout.svelte` `:root`, non-color)
| Token | Value | Use |
|---|---|---|
| `--sp-1` … `--sp-6` | 2, 4, 6, 8, 10, 12 px | gaps inside controls |
| `--sp-8` | 16 px | panel padding |
| `--sp-15` / `--sp-20` | 15 / 20 px | dialog body / header and tab padding |
| `--fs-xs` / `--fs-sm` / `--fs-md` / `--fs-lg` / `--fs-xl` | 10 / 11 / 12 / 14 / 16 px | type scale (body = `--fs-md`) |
| `--radius-sm` / `--radius` / `--radius-lg` | 2 / 4 / 6 px | pills / controls / menus & dialogs |
| `--h-tabbar` | 34 px | repo tabs |
| `--h-toolbar` | 48 px | main toolbar |
| `--h-statusbar` | 26 px | status bar |
| `--h-section` | 30 px | sidebar section headers, panel headers |
| `--h-row` | 24 px | sidebar rows, file rows, menu items (26) |
| `--h-graph-header` | 26 px | graph column header |
| `--icon-sm` / `--icon` / `--icon-lg` | 14 / 16 / 18 px | icon sizes |
`--sp-15`/`--sp-20` break the index naming on purpose: they are GitKraken's
15/20 px modal and tab paddings, named by value so they never drift.

Components use tokens, not raw px, for every height, padding, gap, radius
and font size this spec lists. Remaining raw px must be geometry that has no
token (e.g. the canvas lane math in `src/lib/graph/layout.ts`).

### Icons (`src/lib/icons/Icon.svelte`)
- `<Icon name="pull" size={16} />` renders an inline SVG from one icon set
  (Lucide, ISC license, via the pinned `@lucide/svelte` package wrapped by a
  project-owned name map in `src/lib/icons/names.ts`). Components never import
  the package directly — only `Icon.svelte` does.
- Stroke icons, `currentColor`, default stroke width 1.75, aligned to the text
  baseline by the component (no per-site nudging).
- Emoji and decorative glyphs are not used as UI icons anywhere. Text arrows
  inside sentences ("head → base") stay text.
- Name map (action → icon): undo, redo, pull (arrow-down-to-line), push
  (arrow-up-from-line), fetch (refresh-cw), branch (git-branch), merge
  (git-merge), stash (archive), pop (archive-restore), terminal
  (square-terminal), search, palette (command), theme (palette), settings,
  more (ellipsis), more-vertical, chevron-right/down, close (x), add (plus),
  remove (minus), check, warning (triangle-alert), info, trash, eye, eye-off,
  pin, tag, cloud (remote), laptop (local), folder, folder-git (worktree),
  file, file-added (file-plus), file-deleted (file-minus), file-modified
  (file-pen), file-renamed (file-symlink), conflict (file-exclamation-point), history,
  user, users, lock (sign), sparkles (AI), keyboard, logs (scroll-text),
  zoom (zoom-in), download (update), pull-request (git-pull-request),
  commit (git-commit-horizontal), submodule (package), lfs (hard-drive),
  copy, external (external-link), filter, star (HEAD), home, sign-out
  (log-out), export (upload), grip (grip-vertical), arrow-left / arrow-right,
  chevron-up / chevron-left, sort (arrow-down-a-z; Z→A is the same glyph flipped
  by CSS, the label carries the meaning), blame (file-user; Lucide has no
  per-line author icon), reset (rotate-ccw), cherry-pick (cherry), checkout
  (arrow-right-left; log-in was rejected because it reads as sign-in).
- Menu rows (`MenuItem.icon`) take an IconName only. Legacy glyphs are kept in
  `resolveMenuIcon` as a safety net, not as call-site syntax.

### Regions (top → bottom, left → right)
1. **Tab bar** (`--h-tabbar` 34): tabs `padding: 0 25px 0 20px`, max 300 px,
   top radius 4, 1 px divider between inactive tabs, active tab on the
   elevated background with no divider; close icon 14 px shown on hover/active,
   placed in the 25 px right padding against the tab's right edge;
   "+" button 34×34.
2. **Toolbar** (`--h-toolbar` 48):
   - Left: breadcrumb — two stacked labels ("repository" / "branch", `--fs-xs`
     muted, uppercase) over the values (repo 15 px bold, branch 13 px), each a
     dropdown target, separated by a chevron.
   - Center: action buttons 48×47 (2 px margin), icon 16 px above a label
     `--fs-sm` muted; order Undo · Redo | Pull ▾ · Push | Branch | Stash · Pop
     | Terminal. Pull has a 14 px chevron opening Fetch all / Pull (ff if
     possible) / Pull (rebase). Disabled buttons dim to 40 %.
   - Right: Search (opens graph search), Palette, Theme, as 32×32 icon buttons.
3. **Left panel** (default 220 px, min 180, max 500): no brand block taller
   than a section (logo shrinks into a 30 px header row with the collapse
   chevron); filter input 28 px with a search icon; sections LOCAL, REMOTE,
   WORKTREES, PULL REQUESTS (link to the PR view when signed in), STASHES,
   TAGS, SUBMODULES. Section header `--h-section` 30, `--fs-sm` bold uppercase,
   letter-spacing .04em, count badge right-aligned (`--fs-xs`, radius 8),
   hover toolbar of 24×24 icon buttons. Rows `--h-row` 24, 16 px indent per
   tree level, 14 px leading icon, hover action icons 24×24 at the right.
4. **Graph** (center): header `--h-graph-header` 26, `--fs-xs` uppercase
   600, cells padded `0 var(--sp-5)`; rows stay 28 (lane math); ref pills 18
   high, radius `--radius-sm`, `--fs-sm`, 14 px icons, 4 px gap; message
   `--fs-md`; author/date/sha `--fs-sm` muted.
5. **Right panel** (default 400 px, min 340): header `--h-section` with title
   `--fs-lg` 600 and actions as icon buttons; file list headers 28 with the
   count and a primary "Stage All Changes" / secondary "Unstage All Changes"
   button (`--fs-sm`, 24 high); file rows `--h-row` 24 with a 16 px status
   icon (file-added/modified/deleted/renamed/conflict, colored by the existing
   status color variables), hover action button at the right; commit box:
   summary input 32 high `--fs-lg`, description min 80, options row (Amend,
   Sign, Co-authors, Generate) as 24 high toggles with icons, commit button
   full width 36 high.
6. **Status bar** (`--h-statusbar` 26): items `--fs-xs`/`--fs-sm`, 14 px icons,
   `0 var(--sp-4)` padding, left = terminal toggle + git progress, right =
   identity, fetch status, logs, shortcuts, info, update, zoom, version.
7. **Menus and dialogs**: context menu items 26 high, padding `0 var(--sp-5)`,
   16 px icon column, separators 5 px margin, radius `--radius-lg`; dialogs
   header `10px 20px` with a bottom border and the title `--fs-lg`, body
   `15px 20px`, footer right-aligned buttons 28 high.

## Invariants
- No color values introduced: only theme variables.
- Every interactive icon-only control has a `title` (tooltip) and an
  `aria-label`.
- Graph row height (28) and lane geometry are unchanged, so the canvas math
  and the virtualization contract stay valid.
- Hit targets ≥ 24×24 px.

## Out of scope
- Colors, theme presets, fonts (GitKraken uses Open Sans; we keep the system
  UI stack).
- Changing the zoom model (`uiScale`) — sizes here are at 100 %.
- Native OS context menus.

## Rejected alternatives
- **FontAwesome Pro icons (GitKraken's set).** Commercial license; not
  redistributable.
- **Hand-written SVG paths per component.** Inconsistent stroke widths and
  sizes, and no single place to swap the set.
- **Keeping glyphs with a fixed font.** Still renders per-OS for emoji, and
  glyph metrics can't match a 16 px icon grid.
- **Copying GitKraken's CSS.** Proprietary; we reproduce measurements only.
