<script lang="ts">
  import { untrack } from "svelte";
  import { graph, currentRepo } from "$lib/stores/repo";
  import { ipc } from "$lib/ipc";
  import type { CommitFileStat, FileDiff, GraphNode } from "$lib/ipc";
  import { diffPrefs } from "$lib/stores/diffPrefs";
  import { showCommitFile } from "$lib/stores/center";
  import { commitFiles, selectedFileIndex, focusMode } from "$lib/stores/graphNav";
  import { buildTree, listOrder, type SortMode, type ViewMode } from "$lib/commit/fileTree";
  import { commitDiffCache } from "$lib/commit/commitDiffs";
  import type { DiffKey } from "$lib/commit/diffCache";
  import { commitBody } from "$lib/commit/format";
  import { EXPAND_ALL_CAP, expandAllPaths, notRequested } from "$lib/commit/diffRequests";
  import CommitHeader from "./commit/CommitHeader.svelte";
  import CommitFileList from "./commit/CommitFileList.svelte";
  import CommitInlineDiffs from "./commit/CommitInlineDiffs.svelte";
  import CommitActions from "./commit/CommitActions.svelte";

  interface Props { sha: string; onClose: () => void; }
  let { sha, onClose }: Props = $props();

  // Files come from commit_files (names and counts only). A file's diff
  // loads when its row is expanded, so selecting a big commit stays cheap.
  let files = $state<CommitFileStat[]>([]);
  let loading = $state(false);
  let viewMode = $state<ViewMode>("tree");
  // Sort cycles between two states: A→Z and Z→A, by full path. Used by
  // both the Path list and the Tree's `sortedChildren()` so the toggle
  // visibly affects either view.
  let sortMode = $state<SortMode>("asc");
  let body = $state("");
  // "Show diffs" in the toolbar. On requests the first EXPAND_ALL_CAP diffs.
  let showDiffs = $state(false);
  // Paths whose diff is shown below the list, the loaded diffs, and the
  // paths still loading.
  let requested = $state<Record<string, true>>({});
  let diffsByPath = $state<Record<string, FileDiff[]>>({});
  let pendingPaths = $state<Record<string, true>>({});
  // Each load gets a number, so a slow load for an earlier commit cannot
  // overwrite the files of the one selected now.
  let loadSeq = 0;

  function sortIcon(): string {
    return sortMode === "asc" ? "↓A" : "↑A";
  }
  function sortLabel(): string {
    return sortMode === "asc" ? "Sort: A→Z" : "Sort: Z→A";
  }
  function cycleSort() {
    sortMode = sortMode === "asc" ? "desc" : "asc";
  }

  const node = $derived.by<GraphNode | null>(() => {
    if (!$graph) return null;
    return $graph.nodes.find((n) => n.sha === sha) ?? null;
  });

  const tree = $derived(buildTree(files));
  // Visible order: the same order the list draws. Keyboard nav and the
  // "first N" requests both follow it, or they would pick the wrong rows.
  const order = $derived(listOrder(files, viewMode, sortMode));
  const navPath = $derived(order[$selectedFileIndex]?.path ?? null);
  const inlinePaths = $derived(order.filter((f) => requested[f.path]));
  const inlineDiffs = $derived(inlinePaths.flatMap((f) => diffsByPath[f.path] ?? []));
  const inlineLoading = $derived(inlinePaths.some((f) => pendingPaths[f.path]));
  const loadAllTotal = $derived(
    showDiffs && order.length > EXPAND_ALL_CAP && notRequested(order, requested).length > 0
      ? order.length
      : null,
  );

  $effect(() => {
    void sha;
    resetDiffs();
    if ($currentRepo) load();
    // New commit selected → reset nav state so ArrowRight starts on the
    // first file again. Keeps focus state consistent as user steps
    // through commits with ArrowUp/Down.
    selectedFileIndex.set(0);
    focusMode.set("graph");
  });

  // -w changes the diffs, not the file list, so only the requested diffs reload.
  $effect(() => {
    void $diffPrefs.ignoreWs;
    untrack(() => reloadRequested());
  });

  // Publish the visible-order file list to the navigation store so the
  // global ArrowUp/Down handler can highlight + open files. Order has to
  // match what the user sees on screen (same sort + tree-flatten), or
  // ArrowDown jumps to the wrong row.
  $effect(() => {
    commitFiles.set(order);
    if ($selectedFileIndex >= order.length) selectedFileIndex.set(0);
  });

  // Auto-scroll the highlighted file button into view when index changes
  // via ArrowUp/Down. Only fires while in "files" focus mode so opening
  // the panel doesn't yank the user's manual scroll position.
  $effect(() => {
    void $selectedFileIndex;
    if ($focusMode !== "files") return;
    queueMicrotask(() => {
      document.querySelector(".file-btn.nav-current")?.scrollIntoView({ block: "nearest" });
    });
  });

  async function load(): Promise<void> {
    const repo = $currentRepo;
    if (!repo) return;
    const seq = ++loadSeq;
    loading = true;
    try {
      const [list, message] = await Promise.all([
        ipc.commitFiles(repo, sha),
        ipc.commitShow(repo, sha).catch(() => ""),
      ]);
      if (seq === loadSeq) applyLoaded(list, message);
    } catch {
      if (seq === loadSeq) applyLoaded([], "");
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  function applyLoaded(list: CommitFileStat[], message: string): void {
    files = list;
    body = commitBody(message);
    // "Show diffs" stays on across commits, so the new list gets its first diffs.
    if (showDiffs) requestPaths(expandAllPaths(listOrder(list, viewMode, sortMode)));
  }

  function resetDiffs(): void {
    requested = {};
    diffsByPath = {};
    pendingPaths = {};
  }

  function setShowDiffs(on: boolean): void {
    showDiffs = on;
    if (on) requestPaths(expandAllPaths(order));
    else resetDiffs();
  }

  function loadAll(): void {
    requestPaths(notRequested(order, requested));
  }

  function toggleDiff(path: string): void {
    if (!requested[path]) {
      requestPaths([path]);
      return;
    }
    delete requested[path];
    delete diffsByPath[path];
  }

  /** Requests the diffs of `paths` that are not requested yet. */
  function requestPaths(paths: string[]): void {
    for (const p of paths) {
      if (requested[p]) continue;
      requested[p] = true;
      fetchDiff(p);
    }
  }

  function reloadRequested(): void {
    for (const p of Object.keys(requested)) {
      delete diffsByPath[p];
      fetchDiff(p);
    }
  }

  /**
   * Loads one file's diff into `diffsByPath`. A result is dropped when the
   * user has moved to another commit, changed the `-w` setting, or collapsed
   * the row meanwhile. The cache keeps the diff either way.
   */
  function fetchDiff(path: string): void {
    const repo = $currentRepo;
    if (!repo) return;
    const key: DiffKey = { repo, sha, file: path, ignoreWs: $diffPrefs.ignoreWs };
    pendingPaths[path] = true;
    commitDiffCache.get(key)
      .then((list) => {
        if (isWanted(key)) diffsByPath[path] = list;
      })
      .catch(() => {
        // A failed diff leaves the row expanded with nothing under it; the
        // next expand asks git again, because the cache drops failures.
      })
      .finally(() => {
        delete pendingPaths[path];
      });
  }

  function isWanted(key: DiffKey): boolean {
    return key.sha === sha
      && key.repo === $currentRepo
      && key.ignoreWs === $diffPrefs.ignoreWs
      && requested[key.file] === true;
  }
</script>

<div class="commit-panel">
  {#if !node}
    <div class="empty">Loading commit…</div>
  {:else}
    <CommitHeader {sha} {node} {body} {onClose} />

    <div class="files-bar">
      <span class="modified">
        <span class="m-ico">✎</span>
        <span class="m-count">{files.length}</span>
        <span class="m-lbl">modified</span>
      </span>
      <button class="bb" onclick={cycleSort} title={sortLabel()}>{sortIcon()}</button>
      <span class="seg">
        <button class:active={viewMode === "path"} onclick={() => viewMode = "path"}>≡ Path</button>
        <button class:active={viewMode === "tree"} onclick={() => viewMode = "tree"}>⌘ Tree</button>
      </span>
      <label class="ck">
        <input type="checkbox" checked={showDiffs}
          onchange={(e) => setShowDiffs(e.currentTarget.checked)} />
        Show diffs
      </label>
    </div>

    <div class="files-body">
      {#if loading}
        <div class="empty">Loading…</div>
      {:else if files.length === 0}
        <div class="empty">No changes (or empty commit).</div>
      {:else}
        <CommitFileList
          {viewMode} {sortMode} {tree} pathRows={order} {requested} {navPath} {loadAllTotal}
          onToggleDiff={toggleDiff}
          onOpen={(path) => showCommitFile(sha, path)}
          onLoadAll={loadAll}
        />
        {#if inlinePaths.length > 0}
          <CommitInlineDiffs {sha} diffs={inlineDiffs} loading={inlineLoading && inlineDiffs.length === 0} />
        {/if}
      {/if}
    </div>

    <CommitActions {sha} />
  {/if}
</div>

<style>
  .commit-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    overflow: hidden;
  }
  .empty { padding: 30px; text-align: center; color: var(--fg-muted); font-style: italic; }

  .files-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev);
    font-size: 11px;
  }
  .modified { display: flex; align-items: center; gap: 6px; color: var(--fg-muted); }
  .m-ico { color: var(--tag); }
  .m-count { color: var(--fg); font-weight: 600; }
  .bb {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; padding: 2px 6px; font-size: 13px;
  }
  .bb:hover { color: var(--fg); }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
  .seg button {
    background: transparent; color: var(--fg-muted); border: 0;
    padding: 3px 10px; cursor: pointer; font-size: 11px;
  }
  .seg button.active { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--fg); }
  .ck { display: flex; align-items: center; gap: 5px; color: var(--fg-muted); font-size: 11px; margin-left: auto; }

  .files-body {
    flex: 1;
    overflow: auto;
  }
</style>
