<script lang="ts">
  import { currentRepo, opState, status } from "$lib/stores/repo";
  import { centerMode } from "$lib/stores/center";
  import { layout, setSize, COMMIT_AREA_MIN } from "$lib/stores/layout";
  import { activeOp, sideNames } from "$lib/conflict/labels";
  import Icon from "$lib/icons/Icon.svelte";
  import ResizeHandle from "./ResizeHandle.svelte";
  import OpBanner from "./staging/OpBanner.svelte";
  import ConflictList from "./staging/ConflictList.svelte";
  import StagingFileList from "./staging/StagingFileList.svelte";
  import CommitBox from "./staging/CommitBox.svelte";
  import StashTab from "./staging/StashTab.svelte";
  import DiscardAllModal from "./staging/DiscardAllModal.svelte";
  import { discardAllChanges } from "./staging/fileActions";
  import { isStaged, type ActiveFile, type SortMode, type ViewMode } from "./staging/stagingHelpers";

  // Changes panel container: header, the Unstaged/Staged lists and the bottom
  // Commit/Stash area. The pieces live in ./staging; this file owns the state
  // they share (view, sort, selections, stash fields).

  interface Props { onClose?: () => void; }
  let { onClose }: Props = $props();

  // #12 — bottom panel tabs: "commit" or "stash"
  let bottomTab = $state<"commit" | "stash">("commit");
  // Stash fields live here, not in StashTab, so they survive a tab switch.
  let stashTitle = $state("");
  let stashDesc = $state("");

  let confirmDiscardAll = $state(false);

  // A conflicted entry has index "conflicted", which isStaged counts as staged,
  // so it is excluded from both lists and shown only in ConflictList.
  const staged = $derived($status.filter((s) => isStaged(s) && !s.conflicted));
  const unstaged = $derived($status.filter((s) => !isStaged(s) && !s.conflicted));
  const conflicted = $derived($status.filter((s) => s.conflicted));
  const names = $derived(sideNames(activeOp($opState)));

  const activeFile: ActiveFile | null = $derived.by(() => {
    if ($centerMode.kind !== "file") return null;
    return { file: $centerMode.file, staged: $centerMode.staged };
  });

  // ---- view mode + sort (mirrors the Commit details panel) ----
  let viewMode = $state<ViewMode>("path");
  let sortMode = $state<SortMode>("asc");
  function cycleSort() { sortMode = sortMode === "asc" ? "desc" : "asc"; }
  function sortLabel(): string { return sortMode === "asc" ? "Sort: A→Z" : "Sort: Z→A"; }

  // ---- Multi-selection (Ctrl/Shift like a file explorer) ----
  // Two independent selections — the staged and unstaged lists are visually
  // separate, so a Shift-range across them would be confusing.
  // Owned here, not by the lists, because a successful commit clears them.
  let unstagedSelection = $state<Set<string>>(new Set());
  let stagedSelection = $state<Set<string>>(new Set());
  let unstagedAnchor = $state<string | null>(null);
  let stagedAnchor = $state<string | null>(null);

  function clearSelections() {
    unstagedSelection = new Set();
    stagedSelection = new Set();
    unstagedAnchor = null;
    stagedAnchor = null;
  }

  // ---- Discard all (trash button + confirm modal) ----
  async function confirmDiscardAllNow() {
    if (!$currentRepo) return;
    confirmDiscardAll = false;
    await discardAllChanges();
  }
</script>

<div class="panel-header">
  <span class="title">Changes</span>
  <span class="badge">{$status.length}</span>
  <span class="spacer"></span>
  <button class="icon-btn danger" onclick={() => (confirmDiscardAll = true)}
    disabled={$status.length === 0}
    title="Discard all changes" aria-label="Discard all changes">
    <Icon name="trash" size={14} />
  </button>
  <button class="sort-btn" onclick={cycleSort} title={sortLabel()} aria-label={sortLabel()}><span class:sort-flip={sortMode === "desc"}><Icon name="sort" size={14} /></span></button>
  <span class="view-seg" role="group" aria-label="View mode">
    <button class="seg-btn" class:active={viewMode === "path"} onclick={() => viewMode = "path"}
      title="Path view" aria-label="Path view">
      <Icon name="file" size={14} />
    </button>
    <button class="seg-btn" class:active={viewMode === "tree"} onclick={() => viewMode = "tree"}
      title="Tree view" aria-label="Tree view">
      <Icon name="folder" size={14} />
    </button>
  </span>
  {#if onClose}
    <button class="icon-btn" onclick={onClose} title="Close panel (Ctrl+Alt+B)" aria-label="Close panel">
      <Icon name="close" size={14} />
    </button>
  {/if}
</div>

<OpBanner />

{#if conflicted.length > 0}
  <ConflictList files={conflicted} {names} {sortMode} />
{/if}

<div class="files-scroll">
  <StagingFileList
    kind="unstaged"
    files={unstaged}
    {viewMode}
    {sortMode}
    {activeFile}
    collapsed={$layout.unstagedCollapsed}
    otherCollapsed={$layout.stagedCollapsed}
    bind:selection={unstagedSelection}
    bind:anchor={unstagedAnchor}
  />
  <StagingFileList
    kind="staged"
    files={staged}
    {viewMode}
    {sortMode}
    {activeFile}
    collapsed={$layout.stagedCollapsed}
    otherCollapsed={$layout.unstagedCollapsed}
    bind:selection={stagedSelection}
    bind:anchor={stagedAnchor}
  />
</div>

<ResizeHandle
  direction="h"
  invert
  value={$layout.commitAreaHeight}
  min={COMMIT_AREA_MIN}
  max={620}
  onChange={(v) => setSize("commitAreaHeight", v)}
/>

<section class="commit-block" style="height: {Math.max(COMMIT_AREA_MIN, $layout.commitAreaHeight)}px">
  <header class="commit-head">
    <button class="tab-btn" class:active={bottomTab === "commit"} onclick={() => bottomTab = "commit"}>Commit</button>
    <button class="tab-btn" class:active={bottomTab === "stash"} onclick={() => bottomTab = "stash"}>Stash</button>
  </header>
  {#if bottomTab === "commit"}
    <CommitBox onCommitted={clearSelections} />
  {:else}
    <StashTab bind:title={stashTitle} bind:description={stashDesc} />
  {/if}
</section>

{#if confirmDiscardAll}
  <DiscardAllModal
    onCancel={() => (confirmDiscardAll = false)}
    onConfirm={confirmDiscardAllNow}
  />
{/if}

<style>
  /* Header is the region-5 title bar: 30 px, title --fs-lg, actions as icon buttons. */
  .panel-header {
    display: flex; align-items: center; gap: var(--sp-4);
    padding: 0 var(--sp-6); background: var(--bg-elev);
    border-bottom: 1px solid var(--border-strong); flex-shrink: 0;
    height: var(--h-section);
  }
  .title { font-size: var(--fs-lg); font-weight: 600; color: var(--fg); }
  .spacer { flex: 1; }
  .badge {
    background: var(--accent); color: var(--bg);
    padding: 0 var(--sp-4); border-radius: var(--radius-lg);
    font-size: var(--fs-xs); font-weight: 700; line-height: 14px;
  }

  .icon-btn, .seg-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: var(--h-row); height: var(--h-row); padding: 0;
    background: transparent; border: 0; border-radius: var(--radius);
    color: var(--fg-muted); cursor: pointer;
  }
  .icon-btn:hover:not(:disabled) { color: var(--fg); background: var(--border); }
  .icon-btn.danger { color: var(--del); }
  .icon-btn.danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--del) 18%, transparent);
  }
  .icon-btn:disabled { color: var(--fg-muted); cursor: not-allowed; opacity: 0.5; }

  .sort-btn {
    height: var(--h-row); padding: 0 var(--sp-3);
    background: transparent; border: 0; border-radius: var(--radius);
    color: var(--fg-muted); cursor: pointer;
    font-family: "Cascadia Code", Consolas, monospace; font-size: var(--fs-sm);
  }
  .sort-btn:hover { color: var(--fg); background: var(--border); }
  .sort-flip { display: inline-flex; transform: scaleY(-1); }
  .view-seg {
    display: inline-flex; height: var(--h-row);
    border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden;
  }
  .seg-btn { width: var(--h-row); border-radius: 0; }
  .seg-btn.active { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--fg); }
  .seg-btn:hover:not(.active) { color: var(--fg); }

  .files-scroll {
    flex: 1; min-height: 0;
    display: flex; flex-direction: column;
    overflow: hidden;
  }

  .commit-block {
    flex-shrink: 0;
    background: var(--bg-elev);
    border-top: 2px solid var(--border-strong);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    /* Calibrated to fit header + summary + counter + description (min 80) +
       options + button + gaps + padding without ever needing to scroll. */
    min-height: 350px; /* = COMMIT_AREA_MIN */
  }
  /* Same geometry as the list headers in StagingFileList, with the
     transparent background and 0 gap of the commit tab bar. */
  .commit-head {
    display: flex; align-items: center;
    background: transparent;
    border-bottom: 1px solid var(--border);
    padding: 0 var(--sp-4);
    flex-shrink: 0;
    height: 28px;
  }
  .tab-btn {
    background: transparent;
    border: 0;
    color: var(--fg-muted);
    height: 100%;
    padding: 0 var(--sp-8);
    cursor: pointer;
    font-size: var(--fs-sm);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 700;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tab-btn:hover { color: var(--fg); }
  .tab-btn.active { color: var(--fg); border-bottom-color: var(--accent); }
</style>
