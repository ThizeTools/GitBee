<script lang="ts">
  // One visible row of the graph list: the absolutely positioned <button>
  // with the refs, graph and message cells. GraphCanvas owns virtualization,
  // selection and menus; this component paints one row from its props and
  // reports clicks back through callbacks.
  import RefBadges from "../RefBadges.svelte";
  import Avatar from "../Avatar.svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import type { CommitRef, CommitStat, GraphNode } from "$lib/ipc";
  import type { GraphCol } from "$lib/stores/layout";
  import ChangesCell from "./ChangesCell.svelte";
  import { WIP_SHA } from "$lib/stores/repo";
  import { laneColor } from "$lib/graph/renderer";
  import { laneX, AVATAR_SIZE } from "$lib/graph/layout";
  import { displaySubjectFor, isRowDimmed, type WipBreakdown } from "./graphDerive";
  import { formatRelativeDate, formatAbsoluteDate } from "$lib/graph/relativeDate";
  import {
    dragOverRow, dropOnRow, leaveDropHover, rowDropKey, dropHoverKey,
  } from "$lib/stores/refDrag";

  interface Props {
    row: number;
    // null for the synthetic WIP row.
    node: GraphNode | null;
    top: number;
    isWip: boolean;
    order: readonly GraphCol[];
    gridTemplate: string;
    stashIndex: number | null;
    selectedSha: string | null;
    headRowSha: string | null;
    matchSet: ReadonlySet<string>;
    currentMatchSha: string | undefined;
    isHovered: boolean;
    hasAvatar: boolean;
    wipChangeCount: number;
    wipBreakdown: WipBreakdown;
    refsFor: (sha: string) => CommitRef[];
    containingRefsFor: (sha: string) => CommitRef[];
    onSelect: (e: MouseEvent) => void;
    onCheckout: () => void;
    onContextMenu: (e: MouseEvent) => void;
    // Current time for the date cell; GraphCanvas ticks it once a minute.
    nowMs: number;
    // Merge dimming on/off, and the ref-hover highlight (null when inactive).
    dimMerges: boolean;
    highlightSet: ReadonlySet<string> | null;
    // Changes-column stat: null is an empty cell (WIP, stash), undefined is loading.
    stat: CommitStat | null | undefined;
  }
  let {
    row, node, top, isWip, order, gridTemplate, stashIndex,
    selectedSha, headRowSha, matchSet, currentMatchSha, isHovered,
    hasAvatar, wipChangeCount, wipBreakdown,
    refsFor, containingRefsFor, onSelect, onCheckout, onContextMenu,
    nowMs, dimMerges, highlightSet, stat,
  }: Props = $props();
  // Dimmed rows: text and avatars fade; the canvas dims the lane itself.
  const dimmed = $derived(node !== null && isRowDimmed(node, dimMerges, highlightSet));
</script>

<button
  type="button"
  class="row"
  class:selected={isWip ? selectedSha === WIP_SHA : node!.sha === selectedSha}
  class:head={!isWip && node!.sha === headRowSha}
  class:wip={isWip}
  class:dimmed={dimmed}
  class:search-match={!isWip && matchSet.has(node!.sha)}
  class:search-current={!isWip && currentMatchSha === node!.sha}
  style:top="{top}px"
  style:grid-template-columns={gridTemplate}
  style:--row-lane={isWip ? "var(--fg-muted)" : laneColor(node!.lane)}
  onclick={onSelect}
  ondblclick={() => { if (!isWip) onCheckout(); }}
  oncontextmenu={onContextMenu}
  ondragover={(e) => { if (!isWip) dragOverRow(e, node!.sha, refsFor(node!.sha)); }}
  ondragleave={() => { if (!isWip) leaveDropHover(rowDropKey(node!.sha)); }}
  ondrop={(e) => { if (!isWip) dropOnRow(e, refsFor(node!.sha)); }}
  class:drop-target={!isWip && $dropHoverKey === rowDropKey(node!.sha)}
>
  {#each order as col, i (col)}
    {#if col === "refs"}
      <div class="cell-refs" data-row={row}>
        {#if isWip}
          <!-- Empty: WIP breakdown moved next to "// WIP" in the
               message column so it reads as a status line, not
               as a fake branch tag. -->
        {:else}
          {@const direct = refsFor(node!.sha)}
          {@const lc = laneColor(node!.lane)}
          {@const isSel = node!.sha === selectedSha}
          {#if direct.length > 0}
            <RefBadges refs={direct} laneColor={lc} selected={isSel} />
          {:else if isHovered}
            <!-- #10 — on hover with no own refs, show containing branches -->
            {@const ghosts = containingRefsFor(node!.sha)}
            {#if ghosts.length > 0}
              <RefBadges refs={ghosts} ghost laneColor={lc} />
            {/if}
          {/if}
        {/if}
      </div>
    {:else if col === "graph"}
      <div class="cell-graph">
        {#if hasAvatar}
          {@const lx = laneX(node!.lane)}
          {@const AVATAR = AVATAR_SIZE}
          <!-- Center via flexbox on the parent (.cell-graph is
               display:flex; align-items:center). Horizontal
               placement uses `margin-left` from the lane offset
               so the avatar lands exactly at laneX(lane), the
               same x the canvas uses for the dot/halo. -->
          <div class="lane-avatar" style="margin-left: {lx - AVATAR / 2}px;">
            <Avatar email={node!.author_email} name={node!.author_name} size={AVATAR} />
          </div>
        {/if}
      </div>
    {:else if col === "msg"}
      <div class="cell-msg">
        <span class="msg-text">{isWip ? "// WIP" : displaySubjectFor(node!.subject, stashIndex)}</span>
        {#if isWip && wipChangeCount > 0}
          <span class="wip-stats" title="{wipChangeCount} uncommitted change{wipChangeCount === 1 ? '' : 's'}">
            {#if wipBreakdown.edits > 0}
              <span class="wip-stat edits"><Icon name="file-modified" size={14} />{wipBreakdown.edits}</span>
            {/if}
            {#if wipBreakdown.news > 0}
              <span class="wip-stat news"><Icon name="file-added" size={14} />{wipBreakdown.news}</span>
            {/if}
            {#if wipBreakdown.dels > 0}
              <span class="wip-stat dels"><Icon name="file-deleted" size={14} />{wipBreakdown.dels}</span>
            {/if}
            {#if wipBreakdown.conflicts > 0}
              <span class="wip-stat conflicts"><Icon name="conflict" size={14} />{wipBreakdown.conflicts}</span>
            {/if}
          </span>
        {/if}
      </div>
    {:else if col === "author"}
      <div class="cell-author" title={isWip ? "" : node!.author_name}>
        <span class="cell-text">{isWip ? "" : node!.author_name}</span>
      </div>
    {:else if col === "date"}
      <div class="cell-date" title={isWip ? "" : formatAbsoluteDate(node!.timestamp)}>
        <span class="cell-text">{isWip ? "" : formatRelativeDate(node!.timestamp, nowMs)}</span>
      </div>
    {:else if col === "changes"}
      <ChangesCell {stat} />
    {:else}
      <div class="cell-sha" title={isWip ? "" : node!.sha}>
        <span class="cell-text">{isWip ? "" : node!.sha.slice(0, 7)}</span>
      </div>
    {/if}
    {#if i < order.length - 1}
      <div class="cell-gutter"></div>
    {/if}
  {/each}
</button>

<style>
  /* Cell paddings, gaps and font sizes come from the layout tokens
     (docs/specs/ui-layout-2026-11.md, Regions 4). The row height and lane
     geometry stay raw: they must match ROW_HEIGHT in $lib/graph/layout.ts. */
  .row {
    position: absolute;
    left: 0; right: 0;
    /* must match ROW_HEIGHT in $lib/graph/layout.ts — used by rowFromY */
    height: 28px;
    display: grid;
    align-items: stretch;
    color: var(--fg);
    background: transparent;
    border: 0;
    /* Buttons carry browser-default padding (~1-2px). With `box-sizing:
       border-box; height: 28px`, that padding eats into the inner content
       area, which collapses the cell-graph below the canvas-drawn dot
       (which uses the full 28px). Force padding/margin to 0 so the cell
       grid maps 1:1 to the row's outer 28px. */
    padding: 0;
    margin: 0;
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
  /* Drag-and-drop target: a branch dragged over this row would land here. */
  .row.drop-target { outline: 2px dashed var(--accent); outline-offset: -2px; }

  /* Search highlight: every match gets a soft yellow tint, the active
     cursor row gets a brighter band so the user can see which match
     Enter/Up/Down lands on next. Layered above selection so a
     selected-AND-matched row still reads as a match. */
  .row.search-match {
    background: rgba(255, 213, 102, 0.10);
    box-shadow: inset 2px 0 0 #f5c451;
  }
  .row.search-current {
    background: rgba(255, 213, 102, 0.22);
    box-shadow: inset 3px 0 0 #f5c451;
  }
  .row.search-match:hover, .row.search-current:hover {
    background: rgba(255, 213, 102, 0.30);
  }

  .cell-refs {
    display: flex;
    gap: var(--sp-2);
    padding: 0 var(--sp-5);
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
  /* Cell-graph is a flex container so the avatar can be centered with
     no math: align-items:center handles vertical, margin-left handles
     the lane offset. This avoids the absolute-positioning trap where
     the cell's percentage height resolved against an auto-sized grid
     track and collapsed the relative origin off the row center. */
  .cell-graph {
    pointer-events: none;
    border-right: 1px solid var(--border);
    height: 28px;
    display: flex;
    align-items: center;
  }
  .lane-avatar {
    flex: 0 0 18px;
    width: 18px; height: 18px;
    pointer-events: none;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 0;
    background: var(--bg);
    /* 2px lane ring → 22px node, matching LANE_WIDTH (graph-visual-2026-10). */
    box-shadow: 0 0 0 2px var(--row-lane);
  }
  /* Don't force `display: block` here — the fallback span uses
     `display: inline-flex` to center its initials. Block would break
     that centering and the initials would land at the top of the ring,
     reading as "avatar misaligned". The outer .lane-avatar (also
     display:flex) takes care of centering the inner element on the
     row. */
  .lane-avatar :global(.avatar) {
    width: 18px !important;
    height: 18px !important;
    border-radius: 50%;
  }
  .cell-msg {
    display: flex; align-items: center; gap: var(--sp-4);
    overflow: hidden;
    padding: 0 var(--sp-5);
    font-size: var(--fs-md);
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
    font-family: "Cascadia Code", Consolas, monospace; font-size: var(--fs-sm);
  }
  /* On the WIP row, "// WIP" hugs its content so the breakdown stats
     sit immediately to the right instead of being pushed to the panel
     edge by the default flex:1 that gives normal commit subjects their
     full width. */
  .row.wip .cell-msg .msg-text { flex: 0 0 auto; }
  .wip-stats { margin-left: var(--sp-2); }
  /* Author / date / sha cells: one line each, ellipsis on overflow. */
  .cell-author, .cell-date, .cell-sha {
    display: flex; align-items: center;
    overflow: hidden; min-width: 0;
    padding: 0 var(--sp-5); height: 100%;
    font-size: var(--fs-sm); color: var(--fg-muted);
  }
  .cell-text {
    display: block; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; min-width: 0;
  }
  .cell-sha { font-family: "Cascadia Code", Consolas, monospace; font-size: var(--fs-sm); }
  /* Dimmed rows: merge commits (dimMerges) and rows outside a hovered ref's history. */
  .row.dimmed .cell-msg, .row.dimmed .cell-refs,
  .row.dimmed .cell-author, .row.dimmed .cell-date, .row.dimmed .cell-sha { opacity: 0.4; }
  .row.dimmed .lane-avatar { opacity: 0.25; }
  /* ChangesCell is its own component, so its root is reached with :global. */
  .row.dimmed :global(.cell-changes) { opacity: 0.4; }
  /* gutter cells fall in the resize-handle slots — empty 6px column */
  .cell-gutter { height: 100%; }

  /* Ref pills moved to RefBadges.svelte. */

  /* WIP breakdown sits inline next to "// WIP" in the message column —
     reads as a status line (light, monospace counters) rather than a
     branch-tag pill. Each color is the same one used by the file status
     icons in the staging area, for visual consistency. */
  .wip-stats {
    display: inline-flex; align-items: center; gap: var(--sp-4);
  }
  .wip-stat {
    display: inline-flex; align-items: center; gap: var(--sp-1);
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: var(--fs-sm); font-weight: 600;
  }
  .wip-stat.edits { color: var(--modified); }
  .wip-stat.news { color: var(--add, var(--accent)); }
  .wip-stat.dels { color: var(--del); }
  .wip-stat.conflicts { color: var(--del); font-weight: 700; }
</style>
