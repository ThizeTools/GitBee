import { writable, get } from "svelte/store";

// Persisted UI sizes / zoom. Keys are namespaced under gkp.layout.v1.
const KEY = "gkp.layout.v1";

// The old default scale (1.0) made the UI feel small on modern displays —
// we rebased so 1.2 is the new "100%". Internally `uiScale` is still the
// real zoom multiplier (so the rest of the code that divides clientX by it
// keeps working), but the status-bar picker displays it relative to this
// base so the user sees friendly percentages.
export const ZOOM_BASE = 1.2;
export function displayPercent(scale: number): number {
  return Math.round((scale / ZOOM_BASE) * 100);
}

export type GraphCol = "refs" | "graph" | "msg";

export interface LayoutState {
  sidebarWidth: number;
  rightPanelWidth: number;
  graphRefsWidth: number;
  graphWidth: number;
  graphMsgWidth: number;
  graphColOrder: GraphCol[];
  terminalHeight: number;
  terminalOpen: boolean;
  commitAreaHeight: number;
  unstagedCollapsed: boolean;
  stagedCollapsed: boolean;
  uiScale: number;
  tabOrder: string[]; // remembered repo paths order
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
}

const DEFAULTS: LayoutState = {
  sidebarWidth: 260,
  rightPanelWidth: 380,
  graphRefsWidth: 200,
  graphWidth: 180,
  graphMsgWidth: 360,
  graphColOrder: ["refs", "graph", "msg"],
  terminalHeight: 240,
  terminalOpen: false,
  commitAreaHeight: 290,
  unstagedCollapsed: false,
  stagedCollapsed: false,
  uiScale: 1.2, // = displayed as 100% via ZOOM_BASE
  tabOrder: [],
  sidebarCollapsed: false,
  rightPanelCollapsed: false,
};

function load(): LayoutState {
  if (typeof localStorage === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const merged = { ...DEFAULTS, ...JSON.parse(raw) };
    // One-time migration: anyone whose stored scale matches the previous
    // default (1.0) gets bumped to the new default (1.2). Users who'd
    // explicitly picked 1.0 lose that, which is acceptable — the old 1.0
    // is now reachable as 83% in the picker.
    if (Math.abs(merged.uiScale - 1.0) < 0.001) merged.uiScale = 1.2;
    return merged;
  } catch { return DEFAULTS; }
}

export const layout = writable<LayoutState>(load());

// Column/panel resize drags write the layout on every pointermove; writing
// localStorage each time was measurable jank. The save is trailing-debounced,
// and flushed on unload so the last drag position is not lost.
const LAYOUT_SAVE_DELAY_MS = 250;
let pendingSave: LayoutState | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(s: LayoutState): void {
  pendingSave = s;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, LAYOUT_SAVE_DELAY_MS);
}

function flushSave(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!pendingSave || typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(pendingSave));
  pendingSave = null;
}

if (typeof window !== "undefined") window.addEventListener("beforeunload", flushSave);

layout.subscribe((s) => {
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--ui-scale", String(s.uiScale));
    // Apply UI zoom — Chromium-only "zoom" property scales layout AND fonts.
    // We apply it to .app (set via CSS variable) so .app's own
    // `width/height: calc(100vh / scale)` keeps the layout filling the
    // viewport regardless of zoom level.
    const app = document.querySelector(".app") as HTMLElement | null;
    if (app) app.style.zoom = String(s.uiScale);
    // Reset body just in case a previous version set it.
    document.body.style.zoom = "";
  }
  if (typeof localStorage === "undefined") return;
  scheduleSave(s);
});

// Real zoom multipliers — fed straight into CSS `zoom`. We multiply the old
// 0.8…1.3 picker range by ZOOM_BASE (1.2) so the user-visible labels stay
// "80% / 90% / 100% / 110% / 120% / 130%" but the actual rendered scale at
// each step is bumped by 20%. 1.20 is the new default ("100%").
export const ZOOM_STEPS = [0.96, 1.08, 1.20, 1.32, 1.44, 1.56, 1.68, 1.80, 2.10, 2.40];

export function zoomIn() {
  layout.update((s) => {
    const i = ZOOM_STEPS.findIndex((z) => Math.abs(z - s.uiScale) < 0.01);
    const next = i < 0 ? ZOOM_BASE : ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, i + 1)];
    return { ...s, uiScale: next };
  });
}
export function zoomOut() {
  layout.update((s) => {
    const i = ZOOM_STEPS.findIndex((z) => Math.abs(z - s.uiScale) < 0.01);
    const next = i < 0 ? ZOOM_BASE : ZOOM_STEPS[Math.max(0, i - 1)];
    return { ...s, uiScale: next };
  });
}
export function setZoom(z: number) {
  layout.update((s) => ({ ...s, uiScale: z }));
}
export function setSize<K extends keyof LayoutState>(k: K, v: LayoutState[K]) {
  layout.update((s) => ({ ...s, [k]: v }));
}
export function getLayout(): LayoutState { return get(layout); }
