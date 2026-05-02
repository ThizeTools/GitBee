import { writable, get } from "svelte/store";

// Each theme is a flat record of CSS custom property values applied to the
// document root. We keep the var keys explicit (not freeform) so the editor
// can render a labeled control per variable and so the type system catches
// drift between theme defs and the styles that consume them.
export interface ThemeVars {
  bg: string;
  bgElev: string;
  sidebarBg: string;
  rightpanelBg: string;
  fg: string;
  fgMuted: string;
  border: string;
  borderStrong: string;
  accent: string;
  // Semantic colors used throughout the UI: diffs, status badges, danger
  // states, sha pills. Keeping them in the theme means the picker can
  // restyle every signal at once and customs can match a specific palette.
  add: string;       // additions / "added" status / success accents
  del: string;       // deletions / "deleted" / danger / error
  modified: string;  // "modified" status / warnings
  renamed: string;   // "renamed" status / info / stashes
  sha: string;       // commit sha pills / parent links
  tag: string;       // tag refs / yellow accents (file modified counter, etc)
  remote: string;    // remote branch refs
  scheme: "dark" | "light";
}

export interface Theme {
  id: string;
  name: string;
  builtin: boolean;
  vars: ThemeVars;
}

// Map ThemeVars keys to the CSS custom properties they paint. Single source
// of truth — both the editor UI and the apply step iterate this list.
export const VAR_MAP: { key: keyof ThemeVars; css: string; label: string }[] = [
  { key: "bg",            css: "--bg",            label: "Background" },
  { key: "bgElev",        css: "--bg-elev",       label: "Elevated bg" },
  { key: "sidebarBg",     css: "--sidebar-bg",    label: "Sidebar bg" },
  { key: "rightpanelBg",  css: "--rightpanel-bg", label: "Right panel bg" },
  { key: "fg",            css: "--fg",            label: "Foreground" },
  { key: "fgMuted",       css: "--fg-muted",      label: "Muted text" },
  { key: "border",        css: "--border",        label: "Border" },
  { key: "borderStrong",  css: "--border-strong", label: "Strong border" },
  { key: "accent",        css: "--accent",        label: "Accent" },
  { key: "add",           css: "--add",           label: "Added / success" },
  { key: "del",           css: "--del",           label: "Deleted / danger" },
  { key: "modified",      css: "--modified",      label: "Modified / warning" },
  { key: "renamed",       css: "--renamed",       label: "Renamed / info" },
  { key: "sha",           css: "--sha",           label: "Commit sha" },
  { key: "tag",           css: "--tag",           label: "Tag refs" },
  { key: "remote",        css: "--remote",        label: "Remote refs" },
];

export const BUILTIN_THEMES: Theme[] = [
  {
    // Default theme — black background + bee-yellow accent, picked from the
    // app icon so the in-app accent reinforces the brand.
    id: "dark", name: "Hive (default)", builtin: true,
    vars: {
      bg: "#0a0a0a", bgElev: "#181818", sidebarBg: "#050505", rightpanelBg: "#101010",
      fg: "#f5f5f5", fgMuted: "#8a8a8a", border: "#222222", borderStrong: "#3a3a3a",
      accent: "#f5cc1c",
      add: "#46c46e", del: "#f08080", modified: "#dcdcaa", renamed: "#073a55", sha: "#ce9178",
      tag: "#dcdcaa", remote: "#c586c0",
      scheme: "dark",
    },
  },
  {
    id: "github-dark", name: "GitHub Dark", builtin: true,
    vars: {
      bg: "#0d1117", bgElev: "#161b22", sidebarBg: "#0a0e13", rightpanelBg: "#11161d",
      fg: "#e6edf3", fgMuted: "#7d8590", border: "#21262d", borderStrong: "#30363d",
      accent: "#4ec9b0",
      add: "#3fb950", del: "#f85149", modified: "#d29922", renamed: "#58a6ff", sha: "#ce9178",
      tag: "#d29922", remote: "#bc8cff",
      scheme: "dark",
    },
  },
  {
    id: "light", name: "GitHub Light", builtin: true,
    vars: {
      bg: "#ffffff", bgElev: "#f6f8fa", sidebarBg: "#f0f3f6", rightpanelBg: "#f6f8fa",
      fg: "#1f2328", fgMuted: "#59636e", border: "#d1d9e0", borderStrong: "#afb8c1",
      accent: "#0969da",
      add: "#1a7f37", del: "#cf222e", modified: "#9a6700", renamed: "#0969da", sha: "#a4501e",
      tag: "#9a6700", remote: "#8250df",
      scheme: "light",
    },
  },
  {
    id: "dracula", name: "Dracula", builtin: true,
    vars: {
      bg: "#282a36", bgElev: "#343746", sidebarBg: "#21222c", rightpanelBg: "#2e303e",
      fg: "#f8f8f2", fgMuted: "#a8aac0", border: "#3a3d4d", borderStrong: "#4d5066",
      accent: "#bd93f9",
      add: "#50fa7b", del: "#ff5555", modified: "#f1fa8c", renamed: "#8be9fd", sha: "#ffb86c",
      tag: "#f1fa8c", remote: "#ff79c6",
      scheme: "dark",
    },
  },
  {
    id: "nord", name: "Nord", builtin: true,
    vars: {
      bg: "#2e3440", bgElev: "#3b4252", sidebarBg: "#262b35", rightpanelBg: "#343a47",
      fg: "#eceff4", fgMuted: "#9aa3b3", border: "#3b4252", borderStrong: "#4c566a",
      accent: "#88c0d0",
      add: "#a3be8c", del: "#bf616a", modified: "#ebcb8b", renamed: "#81a1c1", sha: "#d08770",
      tag: "#ebcb8b", remote: "#b48ead",
      scheme: "dark",
    },
  },
  {
    id: "monokai", name: "Monokai", builtin: true,
    vars: {
      bg: "#272822", bgElev: "#33342c", sidebarBg: "#1f201b", rightpanelBg: "#2d2e27",
      fg: "#f8f8f2", fgMuted: "#a59f85", border: "#3e3d32", borderStrong: "#5a5849",
      accent: "#a6e22e",
      add: "#a6e22e", del: "#f92672", modified: "#e6db74", renamed: "#66d9ef", sha: "#fd971f",
      tag: "#e6db74", remote: "#ae81ff",
      scheme: "dark",
    },
  },
  {
    id: "solarized-light", name: "Solarized Light", builtin: true,
    vars: {
      bg: "#fdf6e3", bgElev: "#eee8d5", sidebarBg: "#f4ecd2", rightpanelBg: "#eee8d5",
      fg: "#073642", fgMuted: "#586e75", border: "#d8d2bd", borderStrong: "#b5af9b",
      accent: "#268bd2",
      add: "#859900", del: "#dc322f", modified: "#b58900", renamed: "#268bd2", sha: "#cb4b16",
      tag: "#b58900", remote: "#6c71c4",
      scheme: "light",
    },
  },
  {
    // Eyeballed from the official GitKraken Desktop dark UI — dark navy
    // base with a slight purple undertone, teal accent matching their
    // selection highlight.
    id: "gitkraken", name: "GitKraken", builtin: true,
    vars: {
      bg: "#1c1f2e", bgElev: "#262a3e", sidebarBg: "#181a28", rightpanelBg: "#1c1f2e",
      fg: "#e8eaf3", fgMuted: "#8b90a8", border: "#2a2e44", borderStrong: "#3d4256",
      accent: "#4ec9d1",
      add: "#7bd66e", del: "#e57373", modified: "#f2c94c", renamed: "#5aa3f0", sha: "#f39a4d",
      tag: "#f2c94c", remote: "#b084eb",
      scheme: "dark",
    },
  },
];

const LS_ACTIVE = "gkp.theme.active";
const LS_CUSTOM = "gkp.theme.custom";

function loadCustom(): Theme[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_CUSTOM) ?? "[]");
    // Defensive: if a stale value isn't an array (older versions, manual
    // edits, etc.), fall back to empty so spreading later doesn't blow up.
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch { return []; }
}
function loadActiveId(): string {
  if (typeof localStorage === "undefined") return "dark";
  // Backward-compat with the original "gkp.theme" string ("dark" | "light").
  const old = localStorage.getItem("gkp.theme");
  return localStorage.getItem(LS_ACTIVE) ?? old ?? "dark";
}

// Hoist mutable stores onto a window-level singleton so Vite HMR — which
// re-evaluates the module and otherwise produces fresh writable instances
// — doesn't strand subscribers attached to the old copy. Without this,
// clicking 🎨 in TopBar called set() on the new writable while
// ThemePicker's $effect was subscribed to the old one. Symptoms: the
// effect logged once at mount and never again on click.
type Bag = {
  customThemes: ReturnType<typeof writable<Theme[]>>;
  activeThemeId: ReturnType<typeof writable<string>>;
  themePickerOpen: ReturnType<typeof writable<boolean>>;
  paletteOpen: ReturnType<typeof writable<boolean>>;
};
const G = (typeof window !== "undefined" ? window : ({} as Window)) as Window & { __gbStores?: Bag };
const stores: Bag = G.__gbStores ?? {
  customThemes: writable<Theme[]>(loadCustom()),
  activeThemeId: writable<string>(loadActiveId()),
  themePickerOpen: writable<boolean>(false),
  paletteOpen: writable<boolean>(false),
};
if (typeof window !== "undefined") G.__gbStores = stores;

export const customThemes = stores.customThemes;
export const activeThemeId = stores.activeThemeId;
export const themePickerOpen = stores.themePickerOpen;
export const paletteOpen = stores.paletteOpen;

export type RightPaneTab = "details" | "diff" | "staging";
export const rightTab = writable<RightPaneTab>("details");

// Resolve the active theme. If the stored id no longer exists (custom theme
// was deleted), fall back to the first builtin so the UI never goes black.
export function resolveTheme(id: string, custom: Theme[]): Theme {
  return [...BUILTIN_THEMES, ...custom].find((t) => t.id === id) ?? BUILTIN_THEMES[0];
}

export function applyTheme(t: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const { key, css } of VAR_MAP) {
    const v = t.vars?.[key];
    // Skip missing vars (older saved customs) so setProperty(name, undefined)
    // doesn't risk a downstream consumer reading `null` on a CSS var that
    // expects a color.
    if (typeof v === "string" && v.length > 0) root.style.setProperty(css, v);
  }
  if (t.vars?.scheme) {
    root.style.colorScheme = t.vars.scheme;
    root.dataset.theme = t.vars.scheme;
  }
}

// Persist + apply on every change. Guarded against HMR re-runs so we don't
// stack up duplicate subscribers each time this module is hot-reloaded.
const Gflag = G as Window & { __gbSubsRegistered?: boolean };
if (typeof window !== "undefined" && !Gflag.__gbSubsRegistered) {
  Gflag.__gbSubsRegistered = true;
  activeThemeId.subscribe((id) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(LS_ACTIVE, id);
    applyTheme(resolveTheme(id, get(customThemes)));
  });
  customThemes.subscribe((list) => {
    if (typeof localStorage !== "undefined") localStorage.setItem(LS_CUSTOM, JSON.stringify(list));
    // Re-apply in case the active theme was edited live.
    applyTheme(resolveTheme(get(activeThemeId), list));
  });
}

export function saveCustomTheme(t: Theme): void {
  customThemes.update((list) => {
    const i = list.findIndex((x) => x.id === t.id);
    if (i >= 0) { const next = list.slice(); next[i] = t; return next; }
    return [...list, t];
  });
}
export function deleteCustomTheme(id: string): void {
  customThemes.update((list) => list.filter((x) => x.id !== id));
  // If the deleted theme was active, fall back to dark.
  if (get(activeThemeId) === id) activeThemeId.set("dark");
}

// Backwards-compat shim so anything still importing `theme` keeps building.
// Reads/writes the active id; "light"/"dark" map to the builtin pair.
export const theme = {
  subscribe: activeThemeId.subscribe,
  set: (v: string) => activeThemeId.set(v),
  update: (fn: (v: string) => string) => activeThemeId.update(fn),
};
