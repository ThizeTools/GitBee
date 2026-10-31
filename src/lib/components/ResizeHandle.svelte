<script lang="ts">
  // Generic drag handle. The parent owns the value; we report deltas.
  // Direction "h" → horizontal handle (vertical drag, resizes height).
  // Direction "v" → vertical handle (horizontal drag, resizes width).
  interface Props {
    direction: "h" | "v";
    value: number;
    min?: number;
    max?: number;
    invert?: boolean; // true: dragging left/up increases value
    onChange: (next: number) => void;
  }
  let { direction, value, min = 80, max = 1200, invert = false, onChange }: Props = $props();

  let dragging = $state(false);
  let startPos = 0;
  let startVal = 0;

  function onDown(e: PointerEvent) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
    startPos = direction === "v" ? e.clientX : e.clientY;
    startVal = value;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }
  function onMove(e: PointerEvent) {
    if (!dragging) return;
    const cur = direction === "v" ? e.clientX : e.clientY;
    let delta = cur - startPos;
    if (invert) delta = -delta;
    const next = Math.max(min, Math.min(max, startVal + delta));
    onChange(next);
  }
  function onUp() {
    dragging = false;
    window.removeEventListener("pointermove", onMove);
  }
</script>

<div
  class="handle {direction}"
  class:dragging
  onpointerdown={onDown}
  role="separator"
  aria-orientation={direction === "v" ? "vertical" : "horizontal"}
></div>

<style>
  /* GitKraken-style handle (spec: docs/specs/ui-layout-2026-11.md, Region 3).
     The hit area is 7 px wide, but the handle takes only 1 px of layout: the
     negative margins pull its hit area over the panes on both sides. The
     visible line is 1 px and appears only on hover or drag, in the accent. */
  .handle {
    background: transparent;
    flex-shrink: 0;
    z-index: 5;
    position: relative;
  }
  .handle.v {
    width: 7px;
    margin: 0 -3px;
    cursor: col-resize;
    align-self: stretch;
  }
  .handle.h {
    height: 7px;
    margin: -3px 0;
    cursor: row-resize;
    width: 100%;
  }
  .handle::before {
    content: "";
    position: absolute;
    background: transparent;
    transition: background 120ms;
  }
  .handle.v::before { top: 0; bottom: 0; left: 3px; width: 1px; }
  .handle.h::before { left: 0; right: 0; top: 3px; height: 1px; }
  .handle:hover::before, .handle.dragging::before {
    background: var(--accent);
  }
</style>
