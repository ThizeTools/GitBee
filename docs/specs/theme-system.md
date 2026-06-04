# Theme System — UI/UX Reference

## Architecture

Centralized in `src/lib/stores/ui.ts`. CSS custom properties set on `document.documentElement` — all 34+ components consume via `var(--bg)`, `var(--accent)`, etc. No prop drilling, no context. Theme change is instant globally.

---

## User Flow

Modal has **2 modes**:

- `editor === null` → **Grid view** (theme list)
- `editor !== null` → **Editor view** (color editor)

---

## Grid View — Theme Selection

**Visual cards** with real color swatches from each theme:

- Row 1: `bg`, `bgElev`, `sidebarBg`, `rightpanelBg`
- Row 2: `fg`, `fgMuted`, `accent`

**Interactions:**

| Action       | Result                                                            |
| ------------ | ----------------------------------------------------------------- |
| Single click | Applies theme immediately (`activeThemeId.set`)                   |
| Double click | Opens editor (built-in → creates copy; custom → edits in-place)   |
| ⬆ Export     | Downloads `.gkptheme.json` via File System API or anchor fallback |
| ✎ Edit       | Only visible on custom themes                                     |
| 🗑 Delete    | Only visible on custom themes, confirm dialog                     |
| ⬇ Import     | Accepts `.json` with single theme or array                        |
| "+ New" card | Creates custom based on the "dark" theme                          |

Active theme marked with: `var(--accent)` border + `●` dot.

---

## Editor View — Live Preview

**Zero latency** — each color change calls `applyTheme(editor)` immediately before saving. The entire app repaints in real time while the user adjusts colors.

**Fields:**

- Name (text input)
- Color scheme: `dark` | `light` (segmented button) → sets `colorScheme` CSS + `data-theme` on root
- 16 color variables via `VAR_MAP`, each with:
  - Native color picker (`<input type="color">`)
  - Synced hex text input

**Cancel** restores the theme that was active before entering the editor (`snapshotBefore`), reverting the live preview.

---

## CSS Variables (16 total)

```
Layout:    --bg, --bg-elev, --sidebar-bg, --rightpanel-bg
Text:      --fg, --fg-muted
Borders:   --border, --border-strong
UI:        --accent
Semantic:  --add, --del, --modified, --renamed, --sha, --tag, --remote
```

Semantic colors (`--add` green, `--del` red, etc.) cover diffs, status badges, SHA pills, branch refs — all customizable per theme.

---

## Built-in Themes (8)

| ID      | Name                |
| ------- | ------------------- |
| `dark`  | Default dark theme  |
| `light` | Default light theme |

---

## Persistence

```
localStorage["gkp.theme.active"]  → active theme ID
localStorage["gkp.theme.custom"]  → JSON[] of custom themes
```

Subscriptions in `ui.ts:228-238` persist + reapply automatically on any change. HMR-safe via `window.__gbStores` singleton.

---

## Export / Import

**Export:** `{ kind: "gkp.theme", version: 1, theme: {...} }` → `.gkptheme.json`.
Uses `showSaveFilePicker` (Chromium/WebView2) with anchor download fallback.

**Import:** Accepts single object, array, or `{ themes: [...] }` wrapper.
Built-in IDs are remapped to `custom-${timestamp}` to avoid collisions.

---

## Command Palette

`CommandPalette.svelte` has a "Toggle theme" command that switches `"dark"` ↔ `"light"` — fast shortcut without opening the picker.

---

## Key Design Decision: Built-ins Are Immutable

Double-clicking a built-in does **not** edit it — creates a **copy** with a new `custom-${Date.now().toString(36)}` ID. This prevents custom themes from sharing IDs with built-ins, which would break Svelte's `{#each}` keying and duplicate cards in the grid.

---
