<script lang="ts">
  import type { CommitRef } from "$lib/ipc";
  import { graph, currentRepo } from "$lib/stores/repo";
  import { layout } from "$lib/stores/layout";
  import { checkoutAndJump, checkoutRemoteAndJump } from "$lib/stores/graphscroll";
  import { openMenu } from "$lib/stores/contextmenu";
  import { localBranchMenu, remoteBranchMenu, tagMenu } from "$lib/menus/refMenus";
  import { pinnedRef } from "$lib/stores/graphFilter";
  import { onDestroy } from "svelte";
  import { RefHoverClaim } from "$lib/stores/refHover";
  import { dragRefOf, type DragRef } from "$lib/menus/dragOptions";
  import Icon from "$lib/icons/Icon.svelte";
  import {
    beginRefDrag, endRefDrag, dragOverRef, dropOnRef, leaveDropHover, badgeDropKey, dropHoverKey,
  } from "$lib/stores/refDrag";

  interface Props {
    refs: CommitRef[];
    ghost?: boolean; // #10 — render translucent (hover-preview style)
    /** Lane color of the commit row — drives badge border/text/halo color
     *  so refs read as "belonging" to their graph lane. Defaults to neutral
     *  if not provided. */
    laneColor?: string;
    /** When true, this row is the active/selected one — paint a faint
     *  lane-color background and a thicker outline so the eye latches on.
     *  Independent from `head` (which marks the checked-out branch). */
    selected?: boolean;
  }
  let { refs, ghost = false, laneColor, selected = false }: Props = $props();

  // Build a translucent fill from the hex lane color (rgba with low alpha).
  // Falls back to a neutral white wash if no color is provided.
  function laneColorBg(hex: string | undefined): string {
    if (!hex || !hex.startsWith("#") || hex.length !== 7) return "rgba(255,255,255,0.08)";
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, 0.18)`;
  }

  type DisplayItem = {
    key: string;
    label: string;     // shown name ("main")
    full: string;      // qualified ref name ("main", "origin/main", "v1.0")
    kind: CommitRef["kind"];
    hasLocal: boolean; // local branch present (#7 icon)
    hasRemote: boolean;
    isHead: boolean;
    target_sha: string;
  };

  const items = $derived.by<DisplayItem[]>(() => {
    if (refs.length === 0) return [];
    // #7 — collapse "name" (local) and "<remote>/name" (remote) into one entry.
    // For tags/stashes keep one entry per ref.
    const byKey = new Map<string, DisplayItem>();
    for (const r of refs) {
      let key: string;
      let label: string;
      if (r.kind === "localbranch") {
        key = `branch:${r.name}`;
        label = r.name;
      } else if (r.kind === "remotebranch") {
        const slash = r.name.indexOf("/");
        const branch = slash > 0 ? r.name.slice(slash + 1) : r.name;
        key = `branch:${branch}`;
        label = branch;
      } else if (r.kind === "tag") {
        key = `tag:${r.name}`;
        label = r.name;
      } else if (r.kind === "stash") {
        key = `stash:${r.name}`;
        label = r.name;
      } else {
        // detached HEAD synthetic pill (#1 round 10)
        key = `head:${r.name}`;
        label = "HEAD";
      }
      const cur = byKey.get(key);
      const head = $graph?.head_branch === r.name;
      if (cur) {
        if (r.kind === "localbranch") cur.hasLocal = true;
        if (r.kind === "remotebranch") cur.hasRemote = true;
        cur.isHead = cur.isHead || head;
      } else {
        byKey.set(key, {
          key, label, full: r.name, kind: r.kind,
          hasLocal: r.kind === "localbranch",
          hasRemote: r.kind === "remotebranch",
          isHead: head,
          target_sha: r.target_sha,
        });
      }
    }
    const arr = Array.from(byKey.values());
    const pinned = $pinnedRef;
    // Sort: HEAD first, then the pinned ref, then branches (local/remote
    // merged), then tags, then stashes. Pinning also moves the pinned
    // branch's first-parent chain to lane 0 (Rust assign_lanes, see
    // docs/specs/lane-pin.md), so the pinned badge and its lane agree.
    arr.sort((a, b) => {
      if (a.isHead !== b.isHead) return a.isHead ? -1 : 1;
      const ap = pinned === a.full ? 0 : 1;
      const bp = pinned === b.full ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const order = (k: CommitRef["kind"]) =>
        k === "localbranch" ? 0 : k === "remotebranch" ? 0 : k === "tag" ? 1 : 2;
      return order(a.kind) - order(b.kind);
    });
    return arr;
  });

  let hoverOpen = $state(false);
  let popoverX = $state(0);
  let popoverY = $state(0);
  let popoverMinW = $state(0);
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let primary = $derived(items[0]);
  const hoverClaim = new RefHoverClaim();
  let extras = $derived(items.slice(1));

  // Popover anchors at the badge's top-left and grows downward, with the
  // first row matching the closed badge's slot — so the displayed item
  // stays visually in place and the others appear under it (#3 round 5).
  // Round 6 #1: it MUST visually replace the badge (not float beside it),
  // and pointer events go to it, not to underlying graph rows.
  function onEnter(e: MouseEvent) {
    // Ghost badges preview containing branches on a row with no refs of its own;
    // they must not dim the graph (graph-columns-and-markers spec).
    if (!ghost && primary?.target_sha) hoverClaim.arm(primary.target_sha);
    // #2 round 10: ghost (containing-branches preview on hovered commit row)
    // never opens a popover — only real refs at the row do.
    if (ghost) return;
    if (extras.length === 0) return;
    cancelClose();
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    popoverX = rect.left;
    popoverY = rect.top;
    popoverMinW = Math.max(rect.width, 220);
    hoverOpen = true;
  }
  // Grace period so cursor can travel from the badge into the popover (which
  // is a DOM sibling) without flicker.
  function scheduleClose() {
    cancelClose();
    closeTimer = setTimeout(() => { hoverOpen = false; }, 100);
  }
  function cancelClose() {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  }
  // Leaving the badge ends the dwell and drops any highlight this badge set.
  function onLeave(): void {
    hoverClaim.release();
    scheduleClose();
  }
  // Row unmounted while hovered (scroll, data refresh, tab switch): drop only
  // our own highlight. Never read `primary` here: refHover.ts says why.
  onDestroy(() => hoverClaim.release());
  // A mounted badge can outlive the refs it was hovered for (a refresh moves
  // or deletes them). The open popover was placed from the old rect, so a
  // repo switch or a changed ref set closes it.
  const refsKey = $derived(refs.map((r) => `${r.kind}:${r.name}:${r.target_sha}`).join("|"));
  $effect(() => {
    void $currentRepo;
    void refsKey;
    cancelClose();
    hoverOpen = false;
  });

  function onContext(e: MouseEvent, it: DisplayItem) {
    e.preventDefault();
    e.stopPropagation();
    if (it.kind === "tag") {
      openMenu(e, tagMenu(it.label, it.target_sha ?? ""));
    } else if (it.kind === "remotebranch" && !it.hasLocal) {
      const slash = it.full.indexOf("/");
      const remote = slash > 0 ? it.full.slice(0, slash) : "origin";
      openMenu(e, remoteBranchMenu(remote, it.label, it.target_sha ?? ""));
    } else if (it.kind === "localbranch" || it.kind === "remotebranch") {
      // Local (with or without remote tracking) → local-branch menu.
      openMenu(e, localBranchMenu(it.label, it.target_sha ?? ""));
    }
  }

  // #9 — dblclick a branch pill → checkout that local name (and #1 jump graph)
  async function checkout(it: DisplayItem) {
    if (it.kind === "tag" || it.kind === "stash") return;
    if (it.hasLocal) {
      await checkoutAndJump(it.label);
    } else if (it.hasRemote) {
      const remoteRef = refs.find(
        (r) => r.kind === "remotebranch" && r.name.endsWith("/" + it.label),
      );
      if (remoteRef) {
        // remoteRef.name is "<remote>/<branch>"; split.
        const slash = remoteRef.name.indexOf("/");
        const remote = slash > 0 ? remoteRef.name.slice(0, slash) : "origin";
        await checkoutRemoteAndJump(remote, it.label);
      }
    }
  }

  // The branch a pill stands for, or null for tags, stashes and the detached
  // HEAD pill. A local badge drags as its local branch even with a remote twin.
  function dragRefOfItem(it: DisplayItem): DragRef | null {
    if (it.kind !== "localbranch" && it.kind !== "remotebranch") return null;
    if (it.hasLocal) return { name: it.label, kind: "localbranch" };
    return dragRefOf({ name: it.full, kind: "remotebranch" });
  }
  // Ghost badges are a hover preview, not refs: they neither drag nor take drops.
  function dragPill(it: DisplayItem): DragRef | null {
    return ghost ? null : dragRefOfItem(it);
  }
  // Pills that are not branches let the event bubble, so the row handles them.
  function onPillDragOver(e: DragEvent, it: DisplayItem): void {
    const ref = dragPill(it);
    if (!ref) return;
    e.stopPropagation();
    dragOverRef(e, badgeDropKey(ref), ref);
  }
  function onPillDrop(e: DragEvent, it: DisplayItem): void {
    const ref = dragPill(it);
    if (!ref) return;
    e.stopPropagation();
    dropOnRef(e, ref);
  }
  function onPillDragLeave(it: DisplayItem): void {
    const ref = dragPill(it);
    if (ref) leaveDropHover(badgeDropKey(ref));
  }
  function isDropTarget(it: DisplayItem): boolean {
    const ref = dragPill(it);
    return ref !== null && $dropHoverKey === badgeDropKey(ref);
  }
</script>

{#if items.length > 0}
  <span
    class="badges"
    class:ghost
    onmouseenter={onEnter}
    onmouseleave={onLeave}
    role="presentation"
  >
    <span
      class="ref"
      class:branch={primary.kind === "localbranch" || primary.kind === "remotebranch"}
      class:tag={primary.kind === "tag"}
      class:stash={primary.kind === "stash"}
      class:head-ref={primary.kind === "head"}
      class:head={primary.isHead}
      class:selected
      class:hidden-while-open={hoverOpen}
      style:--lane-color={laneColor ?? "var(--fg-muted)"}
      style:--lane-bg={selected || primary.isHead ? laneColorBg(laneColor) : "transparent"}
      title={primary.full}
      role="button"
      tabindex="0"
      ondblclick={(e) => { e.stopPropagation(); checkout(primary); }}
      oncontextmenu={(e) => onContext(e, primary)}
      draggable={dragPill(primary) ? "true" : "false"}
      ondragstart={(e) => { const ref = dragPill(primary); if (ref) beginRefDrag(e, ref); }}
      ondragend={endRefDrag}
      ondragover={(e) => onPillDragOver(e, primary)}
      ondragleave={() => onPillDragLeave(primary)}
      ondrop={(e) => onPillDrop(e, primary)}
      class:drop-target={isDropTarget(primary)}
    >
      {#if primary.isHead}<span class="head-mark"><Icon name="check" size={14} /></span>{/if}
      <span class="lbl">{primary.label}</span>
      <!-- #7 round 7 — local/remote indicators -->
      {#if primary.kind !== "tag" && primary.kind !== "stash" && primary.kind !== "head"}
        {#if primary.hasLocal}<span class="ind" title="local"><Icon name="laptop" size={14} /></span>{/if}
        {#if primary.hasRemote}<span class="ind" title="remote"><Icon name="cloud" size={14} /></span>{/if}
      {/if}
      {#if primary.kind === "tag"}<span class="kind-ico right" title="tag"><Icon name="tag" size={14} /></span>{/if}
      <!-- +N badge -->
      {#if extras.length > 0}<span class="more">+{extras.length}</span>{/if}
    </span>

  </span>

  {#if hoverOpen}
    <!-- Rendered as a sibling so overflow:hidden on the row's cell can't clip
         it; positioned to overlay the closed badge so the primary stays in
         place and the rest fall below it (#3). -->
    <div
      class="popover"
      style:left="{popoverX / $layout.uiScale}px"
      style:top="{popoverY / $layout.uiScale}px"
      style:min-width="{popoverMinW}px"
      style:--lane-color={laneColor ?? "var(--fg-muted)"}
      style:--lane-bg={laneColorBg(laneColor)}
      onmouseenter={cancelClose}
      onmouseleave={scheduleClose}
      role="presentation"
    >
      {#each items as it, i (it.key)}
        <button
          type="button"
          class="ref pop-row"
          class:branch={it.kind === "localbranch" || it.kind === "remotebranch"}
          class:tag={it.kind === "tag"}
          class:stash={it.kind === "stash"}
          class:head-ref={it.kind === "head"}
          class:head={it.isHead}
          class:primary={i === 0}
          onclick={(e) => e.stopPropagation()}
          ondblclick={(e) => { e.stopPropagation(); checkout(it); }}
          oncontextmenu={(e) => onContext(e, it)}
          draggable={dragPill(it) ? "true" : "false"}
          ondragstart={(e) => { const ref = dragPill(it); if (ref) beginRefDrag(e, ref); }}
          ondragend={endRefDrag}
          ondragover={(e) => onPillDragOver(e, it)}
          ondragleave={() => onPillDragLeave(it)}
          ondrop={(e) => onPillDrop(e, it)}
          class:drop-target={isDropTarget(it)}
          title={it.kind === "tag" ? "Tag" : "Double-click to checkout"}
        >
          {#if it.isHead}<span class="head-mark"><Icon name="check" size={14} /></span>{/if}
          <span class="lbl">{it.label}</span>
          {#if it.kind !== "tag" && it.kind !== "stash" && it.kind !== "head"}
            {#if it.hasLocal}<span class="ind" title="local"><Icon name="laptop" size={14} /></span>{/if}
            {#if it.hasRemote}<span class="ind" title="remote"><Icon name="cloud" size={14} /></span>{/if}
          {/if}
          {#if it.kind === "tag"}<span class="kind-ico right"><Icon name="tag" size={14} /></span>{/if}
        </button>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .badges {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .badges.ghost { opacity: 0.5; }
  /* When the popover for the same badge is open, hide the closed pill so
     the popover visually replaces it (no duplicate sitting behind). */
  .hidden-while-open { visibility: hidden; }

  /* Compact inline ref labels (docs/specs/ui-layout-2026-11.md, Region 4):
     18 px high, --radius-sm, --fs-sm, 4 px gap. The kind is carried by the
     icon (laptop, cloud, tag, check), so every pill shares one shape.
     line-height is set here because .cell-refs uses line-height 0 to stop
     baseline drift; without it the label inherited 0 and rendered empty. */
  .ref {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    height: var(--h-pill);
    line-height: var(--h-pill);
    font-size: var(--fs-sm);
    padding: 0 var(--sp-3);
    white-space: nowrap;
    border: 1px solid;
    border-radius: var(--radius-sm);
    background: transparent;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 220px;
    font-weight: 500;
  }
  /* Label inside the badge gets the actual truncation so head-mark / icons
     stay visible on the ends and only the name itself ellipses on the right. */
  .lbl { overflow: hidden; text-overflow: ellipsis; min-width: 0; }

  /* Lane-aware coloring — badges fill with the lane's full color and use
     white text so the active branch reads loud on the graph (GitKraken
     style). HEAD (the checked-out branch — the one with the check mark)
     gets a bright white outline ring so it stands out across the view. */
  .ref { color: #ffffff; background: var(--lane-color); border-color: var(--lane-color); }
  .ref.head, .ref.head-ref { font-weight: 700; box-shadow: 0 0 0 1.5px #ffffff; }
  .ref.selected { font-weight: 600; }
  .ref.stash { color: #ffffff; background: var(--renamed); border-color: var(--renamed); }
  .head-mark, .ind, .kind-ico { display: inline-flex; flex: 0 0 auto; color: #ffffff; }
  .ind { opacity: 0.85; }
  .kind-ico.right { margin-left: var(--sp-1); order: 99; }
  .more {
    background: rgba(255,255,255,0.25);
    color: #ffffff;
    font-size: var(--fs-xs);
    padding: 0 var(--sp-2);
    border-radius: var(--radius-lg);
    margin-left: var(--sp-1);
  }

  .popover {
    position: fixed;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: 0 6px 20px rgba(0,0,0,0.5);
    padding: var(--sp-1);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    pointer-events: auto;
  }
  /* Popover rows use the same lane-fill look as the closed badge — keep
     the lane color so the popover visually grows out of the badge. */
  .pop-row {
    pointer-events: auto;
    cursor: pointer;
    text-align: left;
    width: 100%;
    justify-content: flex-start;
    max-width: none;
  }
  .pop-row:hover { filter: brightness(1.15); }
  /* Drag-and-drop: the branch badge a dragged branch would land on. */
  .ref[draggable="true"] { cursor: grab; }
  .ref.drop-target { outline: 2px solid #ffffff; outline-offset: 1px; }
</style>
