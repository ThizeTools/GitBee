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
  /* Always-on hairline using the strong-border color so it doubles as the
     visual separator between panes. Hover/drag swaps to the accent. */
  .handle {
    background: var(--border-strong);
    flex-shrink: 0;
    z-index: 5;
    transition: background 120ms;
  }
  /* 2px visual hairline. Pseudo-element provides a 12px transparent hit
     zone centered on the line so dragging is comfortable without making
     the visible separator look chunky. */
  .handle.v {
    width: 2px;
    cursor: col-resize;
    align-self: stretch;
    position: relative;
  }
  .handle.h {
    height: 2px;
    cursor: row-resize;
    width: 100%;
    position: relative;
  }
  .handle::before {
    content: "";
    position: absolute;
  }
  .handle.v::before { top: 0; bottom: 0; left: -5px; right: -5px; }
  .handle.h::before { left: 0; right: 0; top: -5px; bottom: -5px; }
  .handle:hover, .handle.dragging {
    background: var(--accent);
  }
</style>
