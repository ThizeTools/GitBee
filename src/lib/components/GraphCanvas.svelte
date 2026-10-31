<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    graph, selectedSha, refsByCommit, containingByCommit,
    status, currentRepo, stashes, WIP_SHA, visibleGraphNodes,
    loadMoreCommits,
  } from "$lib/stores/repo";
  import GraphSearchBar from "./GraphSearchBar.svelte";
  import SoloBanner from "./SoloBanner.svelte";
  import { searchOpen, matchSet, currentMatchIdx, matchShas } from "$lib/stores/graphSearch";
  import { soloRefs } from "$lib/stores/graphFilter";
  import type { CommitRef } from "$lib/ipc";
  import { showCommit, showStash, showChanges, clearSelection } from "$lib/stores/rightpanel";
  import { layout, setSize, type GraphCol } from "$lib/stores/layout";
  // ClientX/Y and getBoundingClientRect return viewport coords post-zoom.
  // Scroll metrics and our row math are in CSS (logical) px. Divide deltas
  // by uiScale to bridge the two.
  import { graphScrollTarget, checkoutBranchAtCommit } from "$lib/stores/graphscroll";
  import { openMenu } from "$lib/stores/contextmenu";
  import { commitMenu } from "$lib/menus/refMenus";
  import { render } from "$lib/graph/renderer";
  import { ROW_HEIGHT, TOP_PADDING, rowFromY, measure } from "$lib/graph/layout";
  import { buildRowSegments } from "$lib/graph/edges";
  import type { GraphNode } from "$lib/ipc";
  import GraphHeader from "./graph/GraphHeader.svelte";
  import GraphRow from "./graph/GraphRow.svelte";
  import { stashMenuItems } from "./graph/graphRowMenus";
  import {
    buildAvatarRows, buildBranchKindByName, buildContainingRefs,
    buildGridTemplate, buildRowsWithRefs, buildShaToRow, buildStashRows,
    buildWipBreakdown, graphLeftOffset, nonStashRefs, withSyntheticHead,
    type GraphColumnSpec,
  } from "./graph/graphDerive";

  let scrollEl: HTMLDivElement | null = $state(null);
  let canvas: HTMLCanvasElement | null = $state(null);
  let scrollTop = $state(0);
  let viewHeight = $state(600);
  let hoverRow = $state<number | null>(null);

  // Rendered node list — stash-helper + hide/solo filtering lives in the
  // shared `visibleGraphNodes` derived so keyboard-nav and search agree with
  // what's painted here. (audit 2026-05)
  const nodes = $derived($visibleGraphNodes);
  void measure; // metrics no longer used for sizing (#4) but renderer may need it later
  const shaToRow = $derived(buildShaToRow(nodes));
  // Pure derivations live in ./graph/graphDerive.ts (see there for why each
  // row set is built the way it is).
  const rowsWithRefs = $derived(buildRowsWithRefs(nodes, $refsByCommit));
  const avatarRows = $derived(buildAvatarRows(nodes));
  const stashRows = $derived(buildStashRows(nodes, $stashes));

  // Per-row line pieces (pass / in / out) — recomputed only when the node
  // list or stash set changes, not on scroll. See docs/specs/graph-visual-2026-10.md.
  const rowSegments = $derived(buildRowSegments(nodes, stashRows));

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

  // WIP belongs to HEAD, so under solo (which hides everything except the
  // soloed branch's history) it should disappear too — otherwise the user
  // sees a "// WIP" row dangling above a graph that has nothing else from
  // HEAD's chain. Without solo it always shows.
  const wipVisible = $derived($soloRefs.size === 0);
  const totalRows = $derived(nodes.length + (wipVisible ? 1 : 0));
  const totalHeight = $derived(totalRows * ROW_HEIGHT + TOP_PADDING * 2);
  const headRowSha = $derived($graph?.head_sha ?? null);
  const wipChangeCount = $derived($status.length);
  const wipBreakdown = $derived(buildWipBreakdown($status));

  // ------- column layout (reorder + resize) -------
  const order = $derived($layout.graphColOrder);
  const gridTemplate = $derived(buildGridTemplate(order, widthFor));
  // One spec per visible column, read by GraphHeader for its titles and
  // ResizeHandles. Stays a list so new columns need no change here.
  const columnSpecs = $derived(
    order.map((id): GraphColumnSpec => ({
      id,
      width: widthFor(id),
      minWidth: id === "graph" ? graphMinW : 80,
    })),
  );

  // ------- viewport / virtualization -------
  // Start and end are separate primitive deriveds: a primitive only notifies
  // when its value changes, so visibleRows and the badge re-measure below run
  // when a row enters or leaves the window, not on every scroll pixel.
  const rangeStart = $derived(Math.max(0, Math.floor((scrollTop - TOP_PADDING) / ROW_HEIGHT)));
  const rangeEnd = $derived(Math.min(totalRows, Math.ceil((scrollTop + viewHeight - TOP_PADDING) / ROW_HEIGHT)));
  const visibleRange = $derived({ start: rangeStart, end: rangeEnd });

  const visibleRows = $derived.by(() => {
    const list: { row: number; node: GraphNode | null; top: number; isWip: boolean }[] = [];
    // When WIP is hidden (solo mode), row 0 maps directly to nodes[0]; the
    // synthetic WIP slot is gone, and there's no off-by-one shift to worry
    // about in the renderer because the canvas's `wipPresent` flag is also
    // turned off below. (See the `render(...)` call site.)
    const wipShift = wipVisible ? 1 : 0;
    for (let r = visibleRange.start; r < visibleRange.end; r++) {
      const top = TOP_PADDING + r * ROW_HEIGHT;
      if (wipVisible && r === 0) list.push({ row: r, node: null, top, isWip: true });
      else list.push({ row: r, node: nodes[r - wipShift], top, isWip: false });
    }
    return list;
  });

  // One draw per animation frame. Scroll, hover, and resize can each request
  // a draw within the same frame; only the first one schedules work.
  let drawRaf = 0;
  function scheduleDraw(): void {
    if (drawRaf) return;
    drawRaf = requestAnimationFrame(() => {
      drawRaf = 0;
      drawCanvas();
    });
  }

  onMount(() => {
    const ro = new ResizeObserver(() => {
      if (!scrollEl) return;
      viewHeight = scrollEl.clientHeight;
      scheduleDraw();
    });
    if (scrollEl) ro.observe(scrollEl);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(drawRaf);
    };
  });

  // drawCanvas runs inside the rAF callback, where reads are not tracked by
  // this effect. Every reactive value it reads must therefore be listed here,
  // or the canvas silently goes stale when that value changes.
  $effect(() => {
    void nodes; void shaToRow; void rowSegments; void scrollTop; void viewHeight;
    void $selectedSha; void hoverRow; void wipVisible; void headRowSha; void rowsWithRefs;
    void avatarRows; void stashRows; void badgeEndsByRow; void wipChangeCount;
    void canvas; void scrollEl; void graphW; void stubBleed;
    scheduleDraw();
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
    // The WIP synthetic row occupies row 0 only when visible; under solo it's
    // gone, so node `idx` sits at row `idx` not `idx+1`. Hard-coding +1 scrolled
    // one row off when soloing. Use the same shift the layout uses. (audit 2026-05)
    const wipShiftRow = wipVisible ? 1 : 0;
    const y = TOP_PADDING + (idx + wipShiftRow) * ROW_HEIGHT - viewHeight / 2;
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
  const stubBleed = $derived(graphLeftOffset(order, widthFor));

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
      // visibleRows iterates 0=WIP (when wipVisible) then nodes[0]…
      // The renderer keys on the node index, so subtract the WIP shift so
      // a stub for nodes[r] looks up `badgeEndsByRow.get(r)`.
      const visibleRow = Number(cell.dataset.row ?? -1);
      const wipShiftRow = wipVisible ? 1 : 0;
      if (wipVisible && visibleRow === 0) continue; // skip WIP row — drawn separately
      if (visibleRow < 0) continue;
      const nodeRow = visibleRow - wipShiftRow;
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
    // Assigning width/height reallocates and clears the backing store, so it
    // is done only on an actual size change. The renderer clears with clearRect
    // inside save/restore on every frame.
    const backingWidth = Math.floor(width * dpr);
    const backingHeight = Math.floor(viewHeight * dpr);
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    const cssWidth = `${width}px`;
    const cssHeight = `${viewHeight}px`;
    if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
    if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // The renderer's row 0 = nodes[0]. HTML row 0 = WIP when wipVisible,
    // else also nodes[0]. Adjust the scrollTop/hoverRow translation so
    // both coordinate systems stay in sync regardless of the WIP slot.
    const wipShiftPx = wipVisible ? ROW_HEIGHT : 0;
    const wipShiftRow = wipVisible ? 1 : 0;
    render({
      ctx, nodes, shaToRow, segments: rowSegments,
      scrollTop: scrollTop - wipShiftPx,
      viewHeight, width,
      selectedSha: $selectedSha === WIP_SHA ? null : $selectedSha,
      hoverRow: hoverRow == null ? null : hoverRow - wipShiftRow,
      dpr,
      wipPresent: wipVisible,
      wipHeadSha: headRowSha,
      rowsWithRefs,
      avatarRows,
      stashRows,
      extendLeft: bleed,
      badgeEndsByRow,
    });
  }

  // Same threshold as GitKraken's lazy-load offset; spec graph-loading.md.
  const LOAD_MORE_OFFSET_PX = 1400;
  function onScroll() {
    if (!scrollEl) return;
    scrollTop = scrollEl.scrollTop;
    // loadMoreCommits de-duplicates itself, so firing on every scroll event
    // inside this band is cheap.
    if ($graph?.has_more && scrollTop + viewHeight > totalHeight - LOAD_MORE_OFFSET_PX) void loadMoreCommits();
  }
  function onMouseMove(e: MouseEvent) {
    if (!scrollEl) return;
    const rect = scrollEl.getBoundingClientRect();
    const scale = $layout.uiScale || 1;
    const y = (e.clientY - rect.top) / scale + scrollTop;
    const r = rowFromY(y);
    hoverRow = (r >= 0 && r < totalRows) ? r : null;
  }
  function onMouseLeave() { hoverRow = null; }

  // Only the first click of a double-click selects; the second used to toggle the selection back off before the dblclick checkout ran.
  function selectRow(row: number) {
    // Click-toggle: clicking the already-selected row deselects it and
    // collapses the right panel. Clicking a new row selects it and expands
    // the right panel back open.
    const wipShiftRow = wipVisible ? 1 : 0;
    if (wipVisible && row === 0) {
      if ($selectedSha === WIP_SHA) {
        selectedSha.set(null);
        clearSelection();
        setSize("rightPanelCollapsed", true);
      } else {
        selectedSha.set(WIP_SHA);
        showChanges();
        setSize("rightPanelCollapsed", false);
      }
    } else if (nodes[row - wipShiftRow]) {
      const sha = nodes[row - wipShiftRow].sha;
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

  function refsAt(sha: string): CommitRef[] {
    // Stash refs aren't pills — the dashed line + glyph in the graph
    // already say "this is a stash". A redundant "stash" badge in the
    // refs column just adds noise.
    return withSyntheticHead(
      sha,
      nonStashRefs($refsByCommit.get(sha)),
      $graph?.head_sha,
      $graph?.head_branch,
    );
  }

  // Built once per graph load (see buildBranchKindByName).
  const branchKindByName = $derived(buildBranchKindByName($graph?.refs ?? []));
  function containingRefs(sha: string): CommitRef[] {
    return buildContainingRefs(sha, $containingByCommit.get(sha), branchKindByName);
  }
  // Built once per stash change. Called 3-4 times per visible row, so each
  // lookup has to be O(1) rather than a scan of $stashes.
  const stashIndexMap = $derived(new Map($stashes.map((s) => [s.sha, s.index] as const)));
  function stashIndexBySha(sha: string): number | null {
    return stashIndexMap.get(sha) ?? null;
  }

  // ------- stash context menu (#3 stash menu in graph) -------
  let hiddenStashes = $state<Set<number>>(new Set());
  function hideStash(idx: number) { hiddenStashes.add(idx); hiddenStashes = new Set(hiddenStashes); }

  function onRowContext(e: MouseEvent, sha: string | null, isWip: boolean) {
    if (isWip || !sha) return;
    e.preventDefault();
    const idx = stashIndexBySha(sha);
    if (idx !== null) {
      // Stash row → stash-specific menu
      const message = $stashes.find((s) => s.index === idx)?.message ?? "";
      openMenu(e, stashMenuItems({
        getRepo: () => $currentRepo,
        idx,
        message,
        onHide: () => hideStash(idx),
      }));
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
  void tick;
</script>

<div class="wrapper">
  <SoloBanner />
  {#if $searchOpen}
    <GraphSearchBar />
  {/if}
  <GraphHeader
    columns={columnSpecs}
    {gridTemplate}
    onReorder={(next) => setSize("graphColOrder", next)}
    onResize={setWidthFor}
  />

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
      style="left: {graphLeftOffset(order, widthFor) - stubBleed}px; transform: translateY({scrollTop}px)"
    ></canvas>

    <div class="rows">
      {#each visibleRows as { row, node, top, isWip } (isWip ? "wip" : node!.sha)}
        {#if isWip || !hiddenStashes.has(stashIndexBySha(node!.sha) ?? -999)}
          <GraphRow
            {row}
            {node}
            {top}
            {isWip}
            {order}
            {gridTemplate}
            stashIndex={isWip ? null : stashIndexBySha(node!.sha)}
            selectedSha={$selectedSha}
            {headRowSha}
            matchSet={$matchSet}
            currentMatchSha={$matchShas[$currentMatchIdx]}
            isHovered={hoverRow === row}
            hasAvatar={!isWip && avatarRows.has(row - (wipVisible ? 1 : 0))}
            {wipChangeCount}
            {wipBreakdown}
            refsFor={refsAt}
            containingRefsFor={containingRefs}
            onSelect={(e) => { if (e.detail < 2) selectRow(row); }}
            onCheckout={() => checkoutBranchAtCommit(node!.sha)}
            onContextMenu={(e) => onRowContext(e, isWip ? null : node!.sha, isWip)}
          />
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
</style>
