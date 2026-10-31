<script lang="ts">
  import ResizeHandle from "../ResizeHandle.svelte";
  import type { GraphCol } from "$lib/stores/layout";
  import type { GraphColumnSpec } from "./graphDerive";

  // Column titles keyed by column id. A new column (author, date, sha) gets
  // one entry here and one entry in the column list the parent passes in.
  const COLUMN_TITLES: Record<GraphCol, string> = {
    refs: "BRANCH / TAG",
    graph: "GRAPH",
    msg: "COMMIT MESSAGE",
  };

  interface Props {
    columns: readonly GraphColumnSpec[];
    gridTemplate: string;
    onReorder: (next: GraphCol[]) => void;
    onResize: (col: GraphCol, value: number) => void;
  }
  let { columns, gridTemplate, onReorder, onResize }: Props = $props();

  // ------- column drag/reorder -------
  let dragCol: GraphCol | null = $state(null);
  let dragOver: GraphCol | null = $state(null);

  function onColDragStart(e: DragEvent, col: GraphCol) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", col);
    dragCol = col;
  }
  function onColDragOver(e: DragEvent, col: GraphCol) {
    if (dragCol && dragCol !== col) {
      e.preventDefault();
      dragOver = col;
    }
  }
  function onColDrop(e: DragEvent, col: GraphCol) {
    e.preventDefault();
    if (!dragCol || dragCol === col) { dragCol = null; dragOver = null; return; }
    const next = columns.map((c) => c.id);
    const from = next.indexOf(dragCol);
    const to = next.indexOf(col);
    if (from < 0 || to < 0) { dragCol = null; dragOver = null; return; }
    next.splice(from, 1);
    next.splice(to, 0, dragCol);
    onReorder(next);
    dragCol = null;
    dragOver = null;
  }
</script>

<!-- header row: drag-to-reorder column titles -->
<div class="header" style:grid-template-columns={gridTemplate}>
  {#each columns as column, i (column.id)}
    <div
      class="col-head"
      class:drop-target={dragOver === column.id}
      class:dragging={dragCol === column.id}
      draggable="true"
      role="columnheader"
      tabindex="0"
      ondragstart={(e) => onColDragStart(e, column.id)}
      ondragover={(e) => onColDragOver(e, column.id)}
      ondrop={(e) => onColDrop(e, column.id)}
      ondragend={() => { dragCol = null; dragOver = null; }}
      title="Drag to reorder column"
    >
      <span class="lbl">
        {COLUMN_TITLES[column.id]}
      </span>
    </div>
    {#if i < columns.length - 1}
      <ResizeHandle
        direction="v"
        value={column.width}
        min={column.minWidth}
        max={1000}
        onChange={(v) => onResize(column.id, v)}
      />
    {/if}
  {/each}
</div>

<style>
  .header {
    display: grid;
    align-items: stretch;
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border-strong);
    font-size: 9px;
    text-transform: uppercase;
    color: var(--fg-muted);
    flex-shrink: 0;
    letter-spacing: 0.6px;
    font-weight: 600;
    height: 22px;
  }
  .col-head {
    display: flex;
    align-items: center;
    padding: 0 12px;
    cursor: grab;
    border-right: 1px solid var(--border);
    user-select: none;
    -webkit-user-select: none;
  }
  .col-head:active { cursor: grabbing; }
  .col-head:last-child { border-right: 0; }
  .col-head.dragging { opacity: 0.5; }
  .col-head.drop-target { background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--fg); box-shadow: inset 0 -2px 0 var(--accent); }
</style>
