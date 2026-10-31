// Actions that change the app's view or history and do not need an open repo:
// theme, undo/redo, zoom, panels, logs, shortcuts and graph columns.

import { get } from "svelte/store";
import { activeThemeId, customThemes, resolveTheme } from "$lib/stores/ui";
import { layout, setSize, setZoom, zoomIn, zoomOut, ZOOM_BASE } from "$lib/stores/layout";
import { DEFAULT_COL_ORDER, isLockedCol, toggleHidden, type GraphCol } from "$lib/graph/columns";
import { redoLast, undoLast } from "$lib/stores/history";
import { logsPanelOpen } from "$lib/stores/logs";
import { shortcutsOpen } from "$lib/palette/overlays";
import { paletteAction } from "$lib/palette/providers/item";
import type { PaletteLayout, PaletteSources } from "$lib/palette/sources";
import type { PaletteItem } from "$lib/palette/types";

// Partial so a column added to columns.ts still compiles here; it then shows its raw id.
export const COLUMN_LABEL: Readonly<Partial<Record<GraphCol, string>>> = {
  refs: "Refs",
  graph: "Graph",
  msg: "Message",
  author: "Author",
  date: "Date",
  sha: "SHA",
  changes: "Changes",
};

// WHY it flips by the current scheme, not by id: a custom theme (Dracula, Nord)
// is neither "dark" nor "light", so an id comparison dropped it. (audit 2026-05)
function toggleLightDark(): void {
  activeThemeId.update((id) => {
    const cur = resolveTheme(id, get(customThemes));
    return cur.vars.scheme === "dark" ? "light" : "dark";
  });
}

function historyAndThemeItems(src: PaletteSources): PaletteItem[] {
  return [
    paletteAction("toggle-theme", "Toggle light/dark", toggleLightDark),
    paletteAction("undo", "Undo", () => undoLast(), src.undoLabel ?? "Nothing to undo"),
    paletteAction("redo", "Redo", () => redoLast(), src.redoLabel ?? "Nothing to redo"),
  ];
}

function zoomItems(): PaletteItem[] {
  return [
    paletteAction("zoom-in", "Zoom in", () => zoomIn()),
    paletteAction("zoom-out", "Zoom out", () => zoomOut()),
    paletteAction("zoom-reset", "Reset zoom", () => setZoom(ZOOM_BASE)),
  ];
}

// Titles say what the click will do, so they read "Hide" while the panel is open.
export function panelItems(l: PaletteLayout): PaletteItem[] {
  return [
    paletteAction("toggle-sidebar", l.sidebarCollapsed ? "Show sidebar" : "Hide sidebar",
      () => setSize("sidebarCollapsed", !get(layout).sidebarCollapsed)),
    paletteAction("toggle-right-panel", l.rightPanelCollapsed ? "Show right panel" : "Hide right panel",
      () => setSize("rightPanelCollapsed", !get(layout).rightPanelCollapsed)),
    paletteAction("toggle-dim-merges", "Toggle dim merge commits",
      () => setSize("dimMergeCommits", !get(layout).dimMergeCommits),
      l.dimMergeCommits ? "on" : "off"),
  ];
}

/** One show/hide row per graph column. Graph and message are locked and get no row. */
export function columnItems(hidden: readonly GraphCol[]): PaletteItem[] {
  return DEFAULT_COL_ORDER.filter((col) => !isLockedCol(col)).map((col) => {
    const isHidden = hidden.includes(col);
    const verb = isHidden ? "Show" : "Hide";
    const label = COLUMN_LABEL[col] ?? col;
    return paletteAction(`column-${col}`, `${verb} column: ${label}`,
      () => setSize("hiddenCols", toggleHidden(get(layout).hiddenCols, col)));
  });
}

function openItems(): PaletteItem[] {
  return [
    paletteAction("open-logs", "Open logs", () => logsPanelOpen.set(true)),
    paletteAction("open-shortcuts", "Open shortcuts", () => shortcutsOpen.set(true)),
  ];
}

export function viewActionItems(src: PaletteSources): PaletteItem[] {
  return [
    ...historyAndThemeItems(src),
    ...zoomItems(),
    ...panelItems(src.layout),
    ...columnItems(src.layout.hiddenCols),
    ...openItems(),
  ];
}
