<script lang="ts">
  import { currentRepo, opState, status } from "$lib/stores/repo";
  import { centerMode } from "$lib/stores/center";
  import { layout, setSize } from "$lib/stores/layout";
  import { activeOp, sideNames } from "$lib/conflict/labels";
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
  function sortIcon(): string { return sortMode === "asc" ? "↓A" : "↑A"; }
  function sortLabel(): string { return sortMode === "asc" ? "Sort: A→Z" : "Sort: Z→A"; }

  // ---- Multi-selection (Ctrl/Shift like a file explorer) ----
  // Two independent selections — the staged and unstaged lists are
  // visually separate, so a Shift-range across them would be confusing.
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
  <button class="trash" onclick={() => (confirmDiscardAll = true)}
    disabled={$status.length === 0}
    title="Discard all changes">🗑</button>
  <span class="spacer"></span>
  <button class="bb" onclick={cycleSort} title={sortLabel()}>{sortIcon()}</button>
  <span class="seg view-seg">
    <button class:active={viewMode === "path"} onclick={() => viewMode = "path"}>≡ Path</button>
    <button class:active={viewMode === "tree"} onclick={() => viewMode = "tree"}>⌘ Tree</button>
  </span>
  {#if onClose}
    <button class="close-x" onclick={onClose} title="Close panel (Ctrl+Alt+B)">×</button>
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
  min={290}
  max={620}
  onChange={(v) => setSize("commitAreaHeight", v)}
/>

<section class="commit-block" style="height: {Math.max(290, $layout.commitAreaHeight)}px">
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
  .panel-header {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 14px; background: var(--bg-elev);
    border-bottom: 1px solid var(--border-strong); flex-shrink: 0;
    height: 30px;
  }
  .title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: var(--fg-muted); }
  .spacer { flex: 1; }
  .close-x {
    background: transparent; border: 0; color: var(--fg-muted);
    font-size: 18px; cursor: pointer; padding: 0 6px; line-height: 1;
    border-radius: 3px;
  }
  .close-x:hover { color: var(--del); background: color-mix(in srgb, var(--del) 10%, transparent); }
  .badge {
    background: var(--accent); color: var(--bg);
    padding: 1px 8px; border-radius: 10px; font-size: 11px; font-weight: 700;
  }
  .trash {
    background: transparent; border: 0; color: var(--del);
    cursor: pointer; padding: 2px 6px; font-size: 13px; line-height: 1;
    border-radius: 3px;
  }
  .trash:hover:not(:disabled) {
    background: color-mix(in srgb, var(--del) 18%, transparent);
  }
  .trash:disabled { color: var(--fg-muted); cursor: not-allowed; opacity: 0.5; }

  .bb {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; padding: 2px 6px; font-size: 11px;
    font-family: "Cascadia Code", Consolas, monospace;
    border-radius: 3px;
  }
  .bb:hover { color: var(--fg); background: var(--border); }
  .view-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
  .view-seg button {
    background: transparent; color: var(--fg-muted); border: 0;
    padding: 2px 8px; cursor: pointer; font-size: 10px;
  }
  .view-seg button.active { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--fg); }
  .view-seg button:hover:not(.active) { color: var(--fg); }

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
       amend + button + gaps + padding without ever needing to scroll. */
    min-height: 290px;
  }
  /* Same geometry as the list headers in StagingFileList, with the
     transparent background and 0 gap of the commit tab bar. */
  .commit-head {
    display: flex; align-items: center;
    background: transparent;
    border-bottom: 1px solid var(--border);
    gap: 0;
    padding: 0 8px;
    flex-shrink: 0;
    height: 28px;
  }
  .tab-btn {
    background: transparent;
    border: 0;
    color: var(--fg-muted);
    padding: 10px 16px;
    cursor: pointer;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    font-weight: 700;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tab-btn:hover { color: var(--fg); }
  .tab-btn.active { color: var(--fg); border-bottom-color: var(--accent); }
</style>
