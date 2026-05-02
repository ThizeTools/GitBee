<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    graph, selectedSha, refsByCommit, containingByCommit, status, currentRepo, withBusy, stashes, WIP_SHA,
  } from "$lib/stores/repo";
  import RefBadges from "./RefBadges.svelte";
  import Avatar from "./Avatar.svelte";
  import type { CommitRef } from "$lib/ipc";
  import { showCommit, showStash, showChanges, clearSelection } from "$lib/stores/rightpanel";
  import { layout, setSize, type GraphCol } from "$lib/stores/layout";
  // ClientX/Y and getBoundingClientRect return viewport coords post-zoom.
  // Scroll metrics and our row math are in CSS (logical) px. Divide deltas
  // by uiScale to bridge the two.
  import { graphScrollTarget } from "$lib/stores/graphscroll";
  import { openMenu, type MenuItem } from "$lib/stores/contextmenu";
  import { commitMenu } from "$lib/menus/refMenus";
  import { ipc } from "$lib/ipc";
  import { render, laneColor } from "$lib/graph/renderer";
  import { ROW_HEIGHT, TOP_PADDING, rowFromY, measure } from "$lib/graph/layout";
  import type { GraphNode } from "$lib/ipc";
  import ResizeHandle from "./ResizeHandle.svelte";

  let scrollEl: HTMLDivElement | null = $state(null);
  let canvas: HTMLCanvasElement | null = $state(null);
  let scrollTop = $state(0);
  let viewHeight = $state(600);
  let hoverRow = $state<number | null>(null);

  // `git stash` produces helper commits ("index on <branch>: …" and
  // "untracked files on <branch>: …") as extra parents of the actual
  // stash commit. They clutter the graph — GitKraken hides them, so do
  // we. Filter at the data layer so all derived sets (lanes, refs, edges)
  // see the same trimmed list. Edges from the stash commit to these
  // hidden parents naturally drop out (their shas aren't in shaToRow).
  function isStashHelper(subject: string): boolean {
    return /^(?:index|untracked files)\s+on\s+\S/i.test(subject);
  }
  const nodes = $derived(
    ($graph?.nodes ?? []).filter((n) => !isStashHelper(n.subject)),
  );
  void measure; // metrics no longer used for sizing (#4) but renderer may need it later
  const shaToRow = $derived.by(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < nodes.length; i++) m.set(nodes[i].sha, i);
    return m;
  });
  // Rows whose refs cell will paint a badge — the renderer draws a stub
  // line from the dot toward the badge in the lane color so badge and
  // graph visually plug together (#2 of the 2026-04-30 batch).
  // Same filter as `refsAt()`: stash refs aren't rendered as badges, so
  // they shouldn't trigger the lane→badge stub line either. Without
  // this filter, a row whose only ref is `refs/stash` gets a stub drawn
  // toward a badge that never appears — line ends mid-air on the left.
  const rowsWithRefs = $derived.by(() => {
    const s = new Set<number>();
    for (let i = 0; i < nodes.length; i++) {
      const refs = ($refsByCommit.get(nodes[i].sha) ?? []).filter((r) => r.kind !== "stash");
      if (refs.length > 0) s.add(i);
    }
    return s;
  });

  // Rows that should render an HTML <Avatar> overlay instead of a canvas
  // dot — every regular commit with an author email. Merges keep the
  // filled circle so the donut/avatar doesn't fight visually with the
  // multi-parent edges joining at it.
  const avatarRows = $derived.by(() => {
    const s = new Set<number>();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.parents.length >= 2) continue;
      if (!n.author_email) continue;
      s.add(i);
    }
    return s;
  });

  // Set of stash row indices for the renderer (dashed edges + stash
  // glyph). The mapping uses the sha→stash-index lookup that already
  // powers the right-panel switch.
  const stashRows = $derived.by(() => {
    const s = new Set<number>();
    const stashShas = new Set($stashes.map((st) => st.sha));
    for (let i = 0; i < nodes.length; i++) {
      if (stashShas.has(nodes[i].sha)) s.add(i);
    }
    return s;
  });

  const refsW = $derived($layout.graphRefsWidth);
  // Hard min — never auto-grow beyond this. The canvas is clipped by the
  // column width.
  const graphMinW = 80;
  const graphW = $derived(Math.max(graphMinW, $layout.graphWidth));
  const msgW = $derived($layout.graphMsgWidth);

  function widthFor(col: GraphCol): number {
    if (col === "refs") return refsW;
    if (col === "graph") return graphW;
    return msgW;
  }
  function setWidthFor(col: GraphCol, v: number) {
    if (col === "refs") setSize("graphRefsWidth", v);
    else if (col === "graph") setSize("graphWidth", Math.max(graphMinW, v));
    else setSize("graphMsgWidth", v);
  }

  const totalRows = $derived(nodes.length + 1);
  const totalHeight = $derived(totalRows * ROW_HEIGHT + TOP_PADDING * 2);
  const headRowSha = $derived($graph?.head_sha ?? null);
  const wipChangeCount = $derived($status.length);
  // WIP pill breakdown — GitKraken-style. Group `git status` entries by
  // semantic kind so the user knows at a glance what's pending without
  // opening the changes panel: edits, new files, deletions, conflicts.
  const wipBreakdown = $derived.by(() => {
    let edits = 0, news = 0, dels = 0, conflicts = 0;
    for (const s of $status) {
      if (s.conflicted) { conflicts++; continue; }
      const v = s.index !== "unmodified" && s.index !== "untracked" ? s.index : s.worktree;
      switch (v) {
        case "added": case "untracked": case "copied":
          news++; break;
        case "deleted":
          dels++; break;
        case "renamed": case "modified":
        default:
          edits++; break;
      }
    }
    return { edits, news, dels, conflicts };
  });

  // ------- column layout (reorder + resize) -------
  const order = $derived($layout.graphColOrder);

  function widthOf(col: GraphCol, isLast: boolean): string {
    if (isLast) return "1fr"; // last column always absorbs remainder
    return `${widthFor(col)}px`;
  }

  // grid template like "200px 6px 140px 6px 1fr"
  const gridTemplate = $derived.by(() => {
    const parts: string[] = [];
    for (let i = 0; i < order.length; i++) {
      const isLast = i === order.length - 1;
      parts.push(widthOf(order[i], isLast));
      if (!isLast) parts.push("6px");
    }
    return parts.join(" ");
  });

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
    const next = order.slice();
    const from = next.indexOf(dragCol);
    const to = next.indexOf(col);
    if (from < 0 || to < 0) { dragCol = null; dragOver = null; return; }
    next.splice(from, 1);
    next.splice(to, 0, dragCol);
    setSize("graphColOrder", next);
    dragCol = null;
    dragOver = null;
  }

  // ------- viewport / virtualization -------
  const visibleRange = $derived.by(() => {
    const start = Math.max(0, Math.floor((scrollTop - TOP_PADDING) / ROW_HEIGHT));
    const end = Math.min(totalRows, Math.ceil((scrollTop + viewHeight - TOP_PADDING) / ROW_HEIGHT));
    return { start, end };
  });

  const visibleRows = $derived.by(() => {
    const list: { row: number; node: GraphNode | null; top: number; isWip: boolean }[] = [];
    for (let r = visibleRange.start; r < visibleRange.end; r++) {
      const top = TOP_PADDING + r * ROW_HEIGHT;
      if (r === 0) list.push({ row: r, node: null, top, isWip: true });
      else list.push({ row: r, node: nodes[r - 1], top, isWip: false });
    }
    return list;
  });

  onMount(() => {
    const ro = new ResizeObserver(() => {
      if (!scrollEl) return;
      viewHeight = scrollEl.clientHeight;
      drawCanvas();
    });
    if (scrollEl) ro.observe(scrollEl);
    return () => ro.disconnect();
  });

  $effect(() => {
    void nodes; void scrollTop; void viewHeight; void $selectedSha; void hoverRow; void wipChangeCount;
    void graphW; void avatarRows; void stashRows;
    drawCanvas();
  });

  // #14 — scroll the graph to a target sha when something asks (e.g., tag click).
  // Round 3 #1: instant, not smooth.
  $effect(() => {
    const target = $graphScrollTarget;
    if (!target || !scrollEl) return;
    const idx = shaToRow.get(target);
    if (idx === undefined) {
      // Not in the loaded slice. Leave the request and log.
      logAppendMissing(target);
      graphScrollTarget.set(null);
      return;
    }
    const y = TOP_PADDING + (idx + 1) * ROW_HEIGHT - viewHeight / 2;
    scrollEl.scrollTop = Math.max(0, y);
    selectedSha.set(target);
    graphScrollTarget.set(null);
  });

  function logAppendMissing(sha: string) {
    // Imported lazily to avoid pulling logs into a hot path.
    import("$lib/stores/logs").then(({ logAppend }) =>
      logAppend("warn", `commit ${sha.slice(0, 7)} not in current graph slice`)
    );
  }

  // Bleed the canvas leftward by exactly the distance from the graph
  // column's left edge back to the parent container's left edge — so
  // the stub line can travel across the gutter and through the entire
  // refs cell.
  const stubBleed = $derived(graphLeftOffset(order));

  // Per-row badge end (in canvas-x coords). Stub line stops exactly there
  // so the line visually plugs into the badge instead of overshooting to
  // the panel edge. Re-measured whenever rows or layout change.
  let badgeEndsByRow = $state<Map<number, number>>(new Map());
  function measureBadges() {
    if (!scrollEl) return;
    const parentRect = scrollEl.getBoundingClientRect();
    const scale = $layout.uiScale || 1;
    const next = new Map<number, number>();
    const cells = scrollEl.querySelectorAll<HTMLElement>(".cell-refs[data-row]");
    for (const cell of cells) {
      // visibleRows iterates 0=WIP, 1=nodes[0], 2=nodes[1]…  The renderer
      // keys on the node index, so subtract 1 here so a stub for nodes[r]
      // looks up `badgeEndsByRow.get(r)`.
      const visibleRow = Number(cell.dataset.row ?? -1);
      if (visibleRow <= 0) continue; // skip WIP row — it has its own draw path
      const nodeRow = visibleRow - 1;
      const badge = cell.querySelector<HTMLElement>(".badges, .wip-inline");
      if (!badge) continue;
      const r = badge.getBoundingClientRect();
      if (r.width === 0) continue;
      // getBoundingClientRect is in viewport (post-zoom) px; the canvas
      // sits inside the same zoomed container so we want CSS px relative
      // to the parent's left edge. Divide deltas by uiScale.
      const xCanvas = (r.right - parentRect.left) / scale;
      next.set(nodeRow, xCanvas);
    }
    badgeEndsByRow = next;
  }
  $effect(() => {
    void visibleRows; void $refsByCommit; void hoverRow; void stubBleed; void $selectedSha;
    queueMicrotask(measureBadges);
  });

  function drawCanvas() {
    if (!canvas || !scrollEl) return;
    const dpr = window.devicePixelRatio || 1;
    const bleed = stubBleed;
    const width = graphW + bleed;
    canvas.width = width * dpr;
    canvas.height = viewHeight * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${viewHeight}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    render({
      ctx, nodes, shaToRow,
      scrollTop: scrollTop - ROW_HEIGHT,
      viewHeight, width,
      selectedSha: $selectedSha === WIP_SHA ? null : $selectedSha,
      hoverRow: hoverRow == null ? null : hoverRow - 1,
      dpr,
      wipPresent: true,
      wipHeadSha: headRowSha,
      rowsWithRefs,
      avatarRows,
      stashRows,
      extendLeft: bleed,
      badgeEndsByRow,
    });
  }

  function onScroll() { if (scrollEl) scrollTop = scrollEl.scrollTop; }
  function onMouseMove(e: MouseEvent) {
    if (!scrollEl) return;
    const rect = scrollEl.getBoundingClientRect();
    const scale = $layout.uiScale || 1;
    const y = (e.clientY - rect.top) / scale + scrollTop;
    const r = rowFromY(y);
    hoverRow = (r >= 0 && r < totalRows) ? r : null;
  }
  function onMouseLeave() { hoverRow = null; }

  function selectRow(row: number) {
    // Click-toggle: clicking the already-selected row deselects it and
    // collapses the right panel. Clicking a new row selects it and expands
    // the right panel back open.
    if (row === 0) {
      if ($selectedSha === WIP_SHA) {
        selectedSha.set(null);
        clearSelection();
        setSize("rightPanelCollapsed", true);
      } else {
        selectedSha.set(WIP_SHA);
        showChanges();
        setSize("rightPanelCollapsed", false);
      }
    } else if (nodes[row - 1]) {
      const sha = nodes[row - 1].sha;
      if ($selectedSha === sha) {
        selectedSha.set(null);
        clearSelection();
        setSize("rightPanelCollapsed", true);
        return;
      }
      selectedSha.set(sha);
      const stashIdx = stashIndexBySha(sha);
      if (stashIdx !== null) showStash(stashIdx);
      else showCommit(sha);
      setSize("rightPanelCollapsed", false);
    }
  }

  function refsAt(sha: string) {
    // Stash refs aren't pills — the dashed line + glyph in the graph
    // already say "this is a stash". A redundant "stash" badge in the
    // refs column just adds noise.
    const direct = ($refsByCommit.get(sha) ?? []).filter((r) => r.kind !== "stash");
    // #1 round 10: when HEAD is detached (or just checked out a commit), show
    // a synthetic "HEAD" pill on the row even if no branch ref points there.
    const headSha = $graph?.head_sha;
    const headBranch = $graph?.head_branch;
    if (headSha === sha && !headBranch) {
      // detached: synthesize a HEAD ref so RefBadges renders it as a pill.
      return [
        { name: "HEAD", kind: "head" as const, target_sha: sha },
        ...direct,
      ];
    }
    return direct;
  }

  // #1 round 9: stash commits get an autogenerated subject like
  //   "WIP on master: 53deb12 Merge pull request #137"
  //   "index on master: 53deb12 ..."
  //   "untracked files on master: ..."
  // Strip that boilerplate so the row reads as the underlying commit.
  function displaySubject(sha: string, subject: string): string {
    if (stashIndexBySha(sha) === null) return subject;
    // Git's autogenerated subjects come in several spellings depending on
    // version and which entry of the stash family this is:
    //   "WIP on <branch>: <sha> <subject>"
    //   "On <branch>: <user message>"
    //   "index on <branch>: <sha> <subject>"
    //   "untracked files on <branch>: ..."
    // Strip whichever prefix matches.
    const m = subject.match(
      /^(?:WIP|wip|On|on|Index|index|Untracked files|untracked files)\s+on\s+[^:]+:\s*(.+)$/,
    ) ?? subject.match(/^On\s+[^:]+:\s*(.+)$/i);
    return m ? m[1] : subject;
  }

  // #10 — synthesize fake CommitRef[] from the containing-branches set so
  // RefBadges can render them with the same look (just ghosted).
  function containingRefs(sha: string) {
    const names = $containingByCommit.get(sha);
    if (!names || names.size === 0) return [];
    const out = [];
    for (const n of names) {
      // Find original ref to determine kind (local vs remote vs branch).
      const orig = $graph?.refs.find(
        (r) => r.name === n && (r.kind === "localbranch" || r.kind === "remotebranch"),
      );
      if (!orig) continue;
      out.push({ name: n, kind: orig.kind, target_sha: sha });
    }
    return out;
  }
  function stashIndexBySha(sha: string): number | null {
    const found = $stashes.find((s) => s.sha === sha);
    return found?.index ?? null;
  }

  // ------- stash context menu (#3 stash menu in graph) -------
  async function applyStash(idx: number) {
    if (!$currentRepo) return;
    await withBusy(() => ipc.stashApply($currentRepo!, idx));
  }
  async function popStash(idx: number) {
    if (!$currentRepo) return;
    await withBusy(() => ipc.stashPop($currentRepo!, idx));
    showChanges();
  }
  async function dropStash(idx: number) {
    if (!$currentRepo || !confirm(`Drop stash@{${idx}}?`)) return;
    await withBusy(() => ipc.stashDrop($currentRepo!, idx));
    showChanges();
  }
  async function editStashMessage(idx: number, current: string) {
    if (!$currentRepo) return;
    const m = prompt("Edit stash message:", current);
    if (m === null) return;
    await withBusy(() => ipc.stashEditMessage($currentRepo!, idx, m));
  }
  let hiddenStashes = $state<Set<number>>(new Set());
  function hideStash(idx: number) { hiddenStashes.add(idx); hiddenStashes = new Set(hiddenStashes); }

  function onRowContext(e: MouseEvent, sha: string | null, isWip: boolean) {
    if (isWip || !sha) return;
    e.preventDefault();
    const idx = stashIndexBySha(sha);
    if (idx !== null) {
      // Stash row → stash-specific menu
      const message = $stashes.find((s) => s.index === idx)?.message ?? "";
      const items: MenuItem[] = [
        { label: "Apply Stash", icon: "↻", onClick: () => applyStash(idx) },
        { label: "Pop Stash", icon: "⤴", onClick: () => popStash(idx) },
        { label: "Delete Stash", icon: "🗑", danger: true, onClick: () => dropStash(idx) },
        { separator: true, label: "" },
        { label: "Edit stash message", icon: "✎", onClick: () => editStashMessage(idx, message) },
        { label: "Hide", icon: "○", onClick: () => hideStash(idx) },
      ];
      openMenu(e, items);
      return;
    }
    // Plain commit menu (#7 of round 6)
    openMenu(e, commitMenu(sha));
  }

  // ------- column body slot indices (for grid placement) -------
  function colIndex(col: GraphCol): number {
    // returns css grid-column index (1-based; gutters take their own slots)
    const i = order.indexOf(col);
    return i * 2 + 1;
  }

  // Px offset of the "graph" column's left edge given the current column order.
  function graphLeftOffset(o: GraphCol[]): number {
    const GUTTER = 6;
    let x = 0;
    for (const c of o) {
      if (c === "graph") return x;
      x += widthFor(c) + GUTTER;
    }
    return x;
  }
  void tick;
</script>

<div class="wrapper">
  <!-- header row: drag-to-reorder column titles -->
  <div class="header" style:grid-template-columns={gridTemplate}>
    {#each order as col, i (col)}
      <div
        class="col-head"
        class:drop-target={dragOver === col}
        class:dragging={dragCol === col}
        draggable="true"
        role="columnheader"
        tabindex="0"
        ondragstart={(e) => onColDragStart(e, col)}
        ondragover={(e) => onColDragOver(e, col)}
        ondrop={(e) => onColDrop(e, col)}
        ondragend={() => { dragCol = null; dragOver = null; }}
        title="Drag to reorder column"
      >
        <span class="lbl">
          {col === "refs" ? "BRANCH / TAG" : col === "graph" ? "GRAPH" : "COMMIT MESSAGE"}
        </span>
      </div>
      {#if i < order.length - 1}
        <ResizeHandle
          direction="v"
          value={widthFor(col)}
          min={col === "graph" ? graphMinW : 80}
          max={1000}
          onChange={(v) => setWidthFor(col, v)}
        />
      {/if}
    {/each}
  </div>

  <div
    class="scroll"
    role="grid"
    tabindex="0"
    bind:this={scrollEl}
    onscroll={onScroll}
    onmousemove={onMouseMove}
    onmouseleave={onMouseLeave}
    style:grid-template-columns={gridTemplate}
  >
    <div class="spacer" style="height: {totalHeight}px"></div>

    <canvas
      class="lanes"
      bind:this={canvas}
      style="left: {graphLeftOffset(order) - stubBleed}px; transform: translateY({scrollTop}px)"
    ></canvas>

    <div class="rows">
      {#each visibleRows as { row, node, top, isWip } (isWip ? "wip" : node!.sha)}
        {#if isWip || !hiddenStashes.has(stashIndexBySha(node!.sha) ?? -999)}
          <button
            type="button"
            class="row"
            class:selected={isWip ? $selectedSha === WIP_SHA : node!.sha === $selectedSha}
            class:head={!isWip && node!.sha === headRowSha}
            class:wip={isWip}
            style:top="{top}px"
            style:grid-template-columns={gridTemplate}
            style:--row-lane={isWip ? "var(--fg-muted)" : laneColor(node!.lane)}
            onclick={() => selectRow(row)}
            oncontextmenu={(e) => onRowContext(e, isWip ? null : node!.sha, isWip)}
          >
            {#each order as col, i (col)}
              {#if col === "refs"}
                <div class="cell-refs" data-row={row}>
                  {#if isWip}
                    <!-- Empty: WIP breakdown moved next to "// WIP" in the
                         message column so it reads as a status line, not
                         as a fake branch tag. -->
                  {:else}
                    {@const direct = refsAt(node!.sha)}
                    {@const lc = laneColor(node!.lane)}
                    {@const isSel = node!.sha === $selectedSha}
                    {#if direct.length > 0}
                      <RefBadges refs={direct} laneColor={lc} selected={isSel} />
                    {:else if hoverRow === row}
                      <!-- #10 — on hover with no own refs, show containing branches -->
                      {@const ghosts = containingRefs(node!.sha)}
                      {#if ghosts.length > 0}
                        <RefBadges refs={ghosts} ghost laneColor={lc} />
                      {/if}
                    {/if}
                  {/if}
                </div>
              {:else if col === "graph"}
                <div class="cell-graph">
                  {#if !isWip && avatarRows.has(row - 1)}
                    {@const lx = 14 + node!.lane * 18}
                    <div class="lane-avatar" style="left: {lx - 7}px">
                      <Avatar email={node!.author_email} name={node!.author_name} size={14} />
                    </div>
                  {/if}
                </div>
              {:else}
                <div class="cell-msg">
                  <span class="msg-text">{isWip ? "// WIP" : displaySubject(node!.sha, node!.subject)}</span>
                  {#if isWip && wipChangeCount > 0}
                    <span class="wip-stats" title="{wipChangeCount} uncommitted change{wipChangeCount === 1 ? '' : 's'}">
                      {#if wipBreakdown.edits > 0}
                        <span class="wip-stat edits">✎ {wipBreakdown.edits}</span>
                      {/if}
                      {#if wipBreakdown.news > 0}
                        <span class="wip-stat news">+ {wipBreakdown.news}</span>
                      {/if}
                      {#if wipBreakdown.dels > 0}
                        <span class="wip-stat dels">− {wipBreakdown.dels}</span>
                      {/if}
                      {#if wipBreakdown.conflicts > 0}
                        <span class="wip-stat conflicts">! {wipBreakdown.conflicts}</span>
                      {/if}
                    </span>
                  {/if}
                </div>
              {/if}
              {#if i < order.length - 1}
                <div class="cell-gutter"></div>
              {/if}
            {/each}
          </button>
        {/if}
      {/each}
    </div>
  </div>
</div>

<style>
  .wrapper {
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    position: relative;
  }
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

  .scroll {
    position: relative;
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    display: grid; /* used only for sizing context; rows are absolutely positioned */
    grid-template-rows: 1fr;
  }
  .spacer { width: 1px; grid-column: 1 / -1; }
  .lanes { position: absolute; pointer-events: none; z-index: 1; top: 0; }
  .rows { position: absolute; inset: 0; z-index: 2; grid-column: 1 / -1; }
  .row {
    position: absolute;
    left: 0; right: 0;
    /* must match ROW_HEIGHT in $lib/graph/layout.ts — used by rowFromY */
    height: 24px;
    display: grid;
    align-items: center;
    color: var(--fg);
    background: transparent;
    border: 0;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover { background: rgba(255,255,255,0.04); }
  /* Both the mouse-selected row and the HEAD row tint with the lane color
     so the active commit AND the checked-out branch are easy to spot.
     HEAD wins when both apply (slightly stronger fill + ring). */
  .row.selected, .row.head {
    background: color-mix(in srgb, var(--row-lane) 16%, transparent);
    box-shadow: inset 2px 0 0 var(--row-lane);
  }
  .row.head {
    background: color-mix(in srgb, var(--row-lane) 22%, transparent);
    box-shadow: inset 3px 0 0 var(--row-lane);
  }
  .row.selected:hover, .row.head:hover {
    background: color-mix(in srgb, var(--row-lane) 28%, transparent);
  }
  .row.wip { border-bottom: 1px dashed var(--border); }

  .cell-refs {
    display: flex;
    gap: 4px;
    padding: 0 8px 0 12px;
    overflow: hidden;
    align-items: center;
    border-right: 1px solid var(--border);
    height: 100%;
    /* Left-aligned so when the branch name is wider than the column, the
       left side stays visible and the right side gets ellipsis — matches
       how every other table cell in the app truncates. */
    justify-content: flex-start;
    line-height: 0; /* prevent baseline drift from pushing pills upward (#2) */
  }
  .cell-graph {
    pointer-events: none;
    border-right: 1px solid var(--border);
    height: 100%;
    position: relative;
  }
  /* Avatar overlay sits on top of the canvas at the lane position.
     - Flex-centered so the inner <img> doesn't drift on the inline-block
       baseline (visible as the avatar landing 1-2px below the ring).
     - The bg-colored ring sits between the lane border and the avatar
       so the lane line behind doesn't bleed into the photo edge.
     - All three layers (canvas selection halo, colored ring, image) end
       up concentric on the same lane center (laneX(lane), rowY(row)). */
  .lane-avatar {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 14px; height: 14px;
    pointer-events: none;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow:
      0 0 0 1px var(--bg),
      0 0 0 2px var(--row-lane);
  }
  .lane-avatar :global(.avatar) {
    display: block;
    width: 14px !important;
    height: 14px !important;
    border-radius: 50%;
  }
  .cell-msg {
    display: flex; align-items: center; gap: 8px;
    overflow: hidden;
    padding: 0 10px;
    font-size: 12px;
    text-align: left;
    height: 100%;
    color: var(--fg);
    min-width: 0;
  }
  .cell-msg .msg-text {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1; min-width: 0;
  }
  .row.wip .cell-msg {
    color: var(--fg-muted); font-style: italic;
    font-family: "Cascadia Code", Consolas, monospace; font-size: 11px;
  }
  /* On the WIP row, "// WIP" hugs its content so the breakdown stats
     sit immediately to the right instead of being pushed to the panel
     edge by the default flex:1 that gives normal commit subjects their
     full width. */
  .row.wip .cell-msg .msg-text { flex: 0 0 auto; }
  .wip-stats { margin-left: 4px; }
  /* gutter cells fall in the resize-handle slots — empty 6px column */
  .cell-gutter { height: 100%; }

  /* Ref pills moved to RefBadges.svelte. */

  /* WIP inline label — same visual weight as a small ref pill, never larger
     (#6 of round 8). */
  /* WIP breakdown sits inline next to "// WIP" in the message column —
     reads as a status line (light, monospace counters) rather than a
     branch-tag pill. Each color is the same one used by the file status
     glyphs in the staging area, for visual consistency. */
  .wip-stats {
    display: inline-flex; align-items: center; gap: 8px;
  }
  .wip-stat {
    display: inline-flex; align-items: center; gap: 3px;
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 11px; font-weight: 600;
  }
  .wip-stat.edits { color: var(--modified); }
  .wip-stat.news { color: var(--add, var(--accent)); }
  .wip-stat.dels { color: var(--del); }
  .wip-stat.conflicts { color: var(--del); font-weight: 700; }
</style>
