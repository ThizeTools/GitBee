<script lang="ts">
  // Scroll-strip marks for HEAD, selection, branch tips, stashes and search
  // matches, drawn on a DPR-aware canvas. It sits over the graph's right edge,
  // just left of the native scrollbar, so the scrollbar stays draggable.
  // The canvas only repaints when its inputs change; scrolling never reaches
  // it. See docs/specs/graph-columns-and-markers.md.
  import type { CommitRef, GraphNode } from "$lib/ipc";
  import { markerRows, nearestMarkerRow, buildMarkerInput, type Marker, type MarkerKind } from "$lib/graph/scrollMarkers";

  interface Props {
    nodes: readonly GraphNode[];
    shaToRow: ReadonlyMap<string, number>;
    refsByCommit: ReadonlyMap<string, readonly CommitRef[]>;
    wipVisible: boolean;
    wipSha: string;
    headSha: string | null;
    selectedSha: string | null;
    stashRows: ReadonlySet<number>;
    matchShas: readonly string[];
    scrollEl: HTMLDivElement | null;
    // Strip height in CSS px: the visible height of the graph scroll area.
    height: number;
    /** Called with the display row of the marker nearest a click. */
    onJump: (row: number) => void;
  }
  let {
    nodes, shaToRow, refsByCommit, wipVisible, wipSha, headSha, selectedSha,
    stashRows, matchShas, scrollEl, height, onJump,
  }: Props = $props();

  const STRIP_WIDTH = 10;

  let canvas: HTMLCanvasElement | null = $state(null);
  let scrollbarWidth = $state(0);

  // Derived only from data inputs. Scroll position is not an input, which is
  // what keeps scrolling from recomputing the marks.
  const input = $derived(buildMarkerInput({
    nodes, shaToRow, wipVisible, headSha, selectedSha, wipSha, refsByCommit, stashRows, matchShas,
  }));
  const markers = $derived(markerRows(input));

  // Native scrollbar width, so the strip can sit left of it instead of over
  // its thumb. Overlay scrollbars report 0 and the strip sits at the edge.
  // An effect, not onMount: scrollEl is bound after this child mounts.
  $effect(() => {
    const el = scrollEl;
    if (!el) return;
    const measure = (): void => { scrollbarWidth = el.offsetWidth - el.clientWidth; };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Theme colors are read from CSS at paint time, so a theme switch takes
  // effect on the next repaint without recomputing the markers.
  const THEME_VAR: Record<MarkerKind, string> = {
    head: "--accent", selected: "--fg", stash: "--fg-muted", match: "--modified", branch: "--fg",
  };
  function colorFor(m: Marker): string {
    if (m.color) return m.color;
    const v = getComputedStyle(document.documentElement).getPropertyValue(THEME_VAR[m.kind]).trim();
    return v || "#888888";
  }

  function paint(): void {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = STRIP_WIDTH;
    const h = Math.max(1, height);
    // Resizing the backing store clears it, so only do it on a real change.
    if (canvas.width !== Math.floor(w * dpr)) canvas.width = Math.floor(w * dpr);
    if (canvas.height !== Math.floor(h * dpr)) canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const total = Math.max(1, input.totalRows);
    for (const m of markers) {
      ctx.fillStyle = colorFor(m);
      const y = (m.row / total) * h;
      ctx.fillRect(0, y - m.thickness / 2, w, m.thickness);
    }
  }

  // Repaints on marker or size changes only. `markers` and `height` are the
  // only reads, so this effect does not run per scroll event.
  $effect(() => {
    void markers; void height; void canvas;
    paint();
  });

  // Click anywhere on the strip jumps to the marked row nearest the pointer.
  // The strip is a thin overlay, so no marker hit-testing is needed.
  function onClick(e: MouseEvent): void {
    if (!canvas || height <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.height / height || 1;
    const yCss = (e.clientY - rect.top) / scale;
    const rowAt = (yCss / height) * Math.max(1, input.totalRows);
    const row = nearestMarkerRow(markers, rowAt);
    if (row !== null) onJump(row);
  }
</script>

<canvas
  class="strip"
  bind:this={canvas}
  style:right="{scrollbarWidth}px"
  style:height="{height}px"
  onclick={onClick}
  aria-hidden="true"
></canvas>

<style>
  .strip {
    position: absolute;
    top: 0;
    width: 10px;
    z-index: 3;
    cursor: pointer;
    display: block;
  }
</style>
