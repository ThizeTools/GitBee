<script lang="ts">
  import { onMount, untrack } from "svelte";
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
  import { visibleCols, toggleHidden, COL_WIDTH_KEY, COL_MIN_WIDTH } from "$lib/graph/columns";
  import { hoveredRefSha, clearRefHover } from "$lib/stores/refHover";
  import { highlightFor } from "$lib/graph/reach";
  import { visibleStatShas, changesStatFor } from "$lib/graph/changes";
  import { requestVisibleStats, cancelStatsRequest, statsTick, statsLookup } from "$lib/stores/commitStatsCache";
  import ScrollMarkers from "./graph/ScrollMarkers.svelte";
  import { measureBadgeEnds } from "./graph/badgeEnds";
  import { sizeCanvasBacking } from "./graph/canvasBacking";
  import { shouldResyncScroll, logMissingScrollTarget } from "./graph/scrollSync";
  // ClientX/Y and getBoundingClientRect return viewport coords post-zoom.
  // Scroll metrics and our row math are in CSS (logical) px. Divide deltas
  // by uiScale to bridge the two.
  import { graphScrollTarget, checkoutBranchAtCommit } from "$lib/stores/graphscroll";
  import { openMenu } from "$lib/stores/contextmenu";
  import { commitMenu } from "$lib/menus/refMenus";
  import { render } from "$lib/graph/renderer";
  import { ROW_HEIGHT, TOP_PADDING, rowFromY } from "$lib/graph/layout";
  import { buildRowSegments } from "$lib/graph/edges";
  import GraphHeader from "./graph/GraphHeader.svelte";
  import GraphRow from "./graph/GraphRow.svelte";
  import { stashMenuItems } from "./graph/graphRowMenus";
  import {
    buildAvatarRows, buildBranchKindByName, buildColumnSpecs, buildContainingRefs,
    buildGridTemplate, buildRowsWithRefs, buildShaToRow, buildStashRows,
    buildVisibleRows, buildWipBreakdown, graphLeftOffset, nonStashRefs, withSyntheticHead,
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
  const shaToRow = $derived(buildShaToRow(nodes));
  // Pure derivations live in ./graph/graphDerive.ts (see there for why each
  // row set is built the way it is).
  const rowsWithRefs = $derived(buildRowsWithRefs(nodes, $refsByCommit));
  const avatarRows = $derived(buildAvatarRows(nodes));
  const stashRows = $derived(buildStashRows(nodes, $stashes));

  // Per-row line pieces (pass / in / out) — recomputed only when the node
  // list or stash set changes, not on scroll. See docs/specs/graph-visual-2026-10.md.
  const rowSegments = $derived(buildRowSegments(nodes, stashRows));

  // Hard min for the graph track: the canvas is clipped by the column width and
  // lanes must never be narrower than one node.
  const graphW = $derived(Math.max(COL_MIN_WIDTH.graph, $layout.graphWidth));

  // Widths and mins come from graph/columns.ts so a new column needs no edit here.
  function widthFor(col: GraphCol): number {
    return $layout[COL_WIDTH_KEY[col]];
  }
  function setWidthFor(col: GraphCol, v: number) {
    setSize(COL_WIDTH_KEY[col], Math.max(COL_MIN_WIDTH[col], v));
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
  // `order` is the full layout order (hidden columns included); `visibleOrder`
  // is what is painted. The last VISIBLE column takes the 1fr track.
  const order = $derived($layout.graphColOrder);
  const hiddenCols = $derived($layout.hiddenCols);
  const dimMerges = $derived($layout.dimMergeCommits);
  const visibleOrder = $derived(visibleCols(order, hiddenCols));
  const gridTemplate = $derived(buildGridTemplate(visibleOrder, widthFor));
  // One spec per visible column, read by GraphHeader for its titles and
  // ResizeHandles. Stays a list so new columns need no change here.
  const columnSpecs = $derived(buildColumnSpecs(visibleOrder, widthFor, COL_MIN_WIDTH));

  // ------- viewport / virtualization -------
  // Start and end are separate primitive deriveds: a primitive only notifies
  // when its value changes, so visibleRows and the badge re-measure below run
  // when a row enters or leaves the window, not on every scroll pixel.
  const rangeStart = $derived(Math.max(0, Math.floor((scrollTop - TOP_PADDING) / ROW_HEIGHT)));
  const rangeEnd = $derived(Math.min(totalRows, Math.ceil((scrollTop + viewHeight - TOP_PADDING) / ROW_HEIGHT)));
  const visibleRange = $derived({ start: rangeStart, end: rangeEnd });
  // Changes-column stats; the lookup is re-made per batch so the cells repaint.
  const statsView = $derived(statsLookup($currentRepo, $statsTick));

  // Date cell clock: "3 h ago" must not go stale, so a 60 s tick repaints the
  // visible rows. It is not read by drawCanvas, so the canvas is not redrawn.
  let nowMs = $state(Date.now());

  // Commits in the hovered ref's history, or null when no ref is hovered or the
  // ref is not loaded. $derived memoizes it by (hovered sha, nodes), so scroll
  // never recomputes it.
  const highlightSet = $derived($hoveredRefSha ? highlightFor($hoveredRefSha, nodes) : null);

  // Row mapping lives in buildVisibleRows (graphDerive.ts). Under solo the
  // canvas's `wipPresent` flag is also off (see the `render(...)` call site).
  const visibleRows = $derived(buildVisibleRows(visibleRange, nodes, wipVisible));

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
      // A height change can clamp scrollTop too, so it is re-read here.
      resyncViewport();
      scheduleDraw();
    });
    if (scrollEl) ro.observe(scrollEl);
    const clock = setInterval(() => { nowMs = Date.now(); }, 60_000);
    return () => {
      ro.disconnect();
      clearInterval(clock);
      cancelAnimationFrame(drawRaf);
    };
  });

  // WebKit clamps scrollTop when the spacer shrinks and fires no scroll event,
  // so the state can run ahead of the DOM (decision in scrollSync.ts). Bug:
  // rows 1-3 lost their avatar and text after a repo tab switch.
  function resyncViewport(): void {
    if (!scrollEl) return;
    if (shouldResyncScroll(scrollTop, scrollEl.scrollTop)) scrollTop = scrollEl.scrollTop;
    viewHeight = scrollEl.clientHeight;
  }
  // Runs a frame later, so the spacer has its new height when it is read.
  $effect(() => {
    void totalHeight; void nodes;
    requestAnimationFrame(resyncViewport);
  });

  // GraphCanvas stays mounted across repo tabs, so per-repo view state would
  // leak. lastRepo is a plain variable: the mount run is not a change.
  let lastRepo: string | null | undefined;
  $effect(() => {
    const repo = $currentRepo;
    if (lastRepo !== undefined && lastRepo !== repo) untrack(resetViewForRepo);
    lastRepo = repo;
  });
  // Each field here is per-repo. hiddenStashes is keyed by stash INDEX, which
  // names a different stash in another repo.
  function resetViewForRepo(): void {
    if (scrollEl) scrollEl.scrollTop = 0;
    scrollTop = 0;
    hoverRow = null;
    hiddenStashes = new Set();
    badgeEndsByRow = new Map();
    clearRefHover();
    scheduleDraw();
  }

  // drawCanvas runs inside the rAF callback, where reads are not tracked by
  // this effect. Every reactive value it reads must therefore be listed here,
  // or the canvas silently goes stale when that value changes.
  $effect(() => {
    void highlightSet; void nodes; void shaToRow; void rowSegments; void scrollTop; void viewHeight;
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
      logMissingScrollTarget(target);
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

  // Bleed the canvas leftward by exactly the distance from the graph
  // column's left edge back to the parent container's left edge — so
  // the stub line can travel across the gutter and through the entire
  // refs cell.
  const stubBleed = $derived(graphLeftOffset(visibleOrder, widthFor));

  // Per-row badge end (in canvas-x coords). Stub line stops exactly there
  // so the line visually plugs into the badge instead of overshooting to
  // the panel edge. Re-measured whenever rows or layout change.
  let badgeEndsByRow = $state<Map<number, number>>(new Map());
  function remeasureBadges(): void {
    if (scrollEl) badgeEndsByRow = measureBadgeEnds(scrollEl, wipVisible, $layout.uiScale || 1);
  }
  $effect(() => {
    void visibleRows; void $refsByCommit; void hoverRow; void stubBleed; void $selectedSha;
    queueMicrotask(remeasureBadges);
  });

  function drawCanvas() {
    if (!canvas || !scrollEl) return;
    const dpr = window.devicePixelRatio || 1;
    const bleed = stubBleed;
    const width = graphW + bleed;
    // Resizes the backing store only on an actual size change (canvasBacking.ts).
    sizeCanvasBacking(canvas, width, viewHeight, dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // The renderer's row 0 = nodes[0]. HTML row 0 = WIP when wipVisible,
    // else also nodes[0]. Adjust the scrollTop/hoverRow translation so
    // both coordinate systems stay in sync regardless of the WIP slot.
    const wipShiftPx = wipVisible ? ROW_HEIGHT : 0;
    const wipShiftRow = wipVisible ? 1 : 0;
    render({
      ctx, nodes, shaToRow, segments: rowSegments,
      highlightSet,
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
    clearRefHover();
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

  // Changes column: git runs only while the column is painted, and only for the
  // rows in view (graph-columns spec). Hidden means nothing is requested.
  $effect(() => {
    const repo = $currentRepo;
    if (repo === null || !visibleOrder.includes("changes")) {
      cancelStatsRequest();
      return;
    }
    requestVisibleStats(repo, visibleStatShas(nodes, visibleRange.start, visibleRange.end, wipVisible ? 1 : 0, stashIndexMap));
  });

  // Marker-strip click: row 0 is the WIP row when it is shown (scroll to top);
  // any other row reuses the graph's scroll-to-sha path, which centers the row.
  function jumpToRow(row: number): void {
    const wipShift = wipVisible ? 1 : 0;
    if (wipShift && row === 0) {
      if (scrollEl) scrollEl.scrollTop = 0;
      return;
    }
    const node = nodes[row - wipShift];
    if (node) graphScrollTarget.set(node.sha);
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

</script>

<div class="wrapper">
  <SoloBanner />
  {#if $searchOpen}
    <GraphSearchBar />
  {/if}
  <GraphHeader
    columns={columnSpecs}
    {gridTemplate}
    allCols={order}
    hidden={hiddenCols}
    {dimMerges}
    onReorder={(next) => setSize("graphColOrder", next)}
    onResize={setWidthFor}
    onToggleHidden={(col) => setSize("hiddenCols", toggleHidden(hiddenCols, col))}
    onToggleDim={() => setSize("dimMergeCommits", !dimMerges)}
  />

  <div class="scroll-wrap">
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
      style="left: {graphLeftOffset(visibleOrder, widthFor) - stubBleed}px; transform: translateY({scrollTop}px)"
    ></canvas>

    <div class="rows">
      {#each visibleRows as { row, node, top, isWip } (isWip ? "wip" : node!.sha)}
        {#if isWip || !hiddenStashes.has(stashIndexBySha(node!.sha) ?? -999)}
          <GraphRow
            {row}
            {node}
            {top}
            {isWip}
            order={visibleOrder}
            {gridTemplate}
            stashIndex={isWip ? null : stashIndexBySha(node!.sha)}
            selectedSha={$selectedSha}
            {headRowSha}
            {nowMs}
            {dimMerges}
            {highlightSet}
            stat={changesStatFor(node, stashIndexMap, statsView)}
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
    <ScrollMarkers
      nodes={nodes}
      shaToRow={shaToRow}
      refsByCommit={$refsByCommit}
      wipVisible={wipVisible}
      wipSha={WIP_SHA}
      headSha={headRowSha}
      selectedSha={$selectedSha}
      stashRows={stashRows}
      matchShas={$matchShas}
      {scrollEl}
      height={viewHeight}
      onJump={jumpToRow}
    />
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
  .scroll-wrap { flex: 1; min-height: 0; position: relative; display: flex; flex-direction: column; }
  .scroll-wrap > .scroll { flex: 1; min-height: 0; }
</style>
