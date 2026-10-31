<script lang="ts">
  import { currentRepo, graph, withBusy, worktreeTick } from "$lib/stores/repo";
  import { showGraph, centerMode, showFileHistory, showFileBlame } from "$lib/stores/center";
  import { ipc } from "$lib/ipc";
  import DiffViewer from "./DiffViewer.svelte";
  import type { FileDiff } from "$lib/ipc";
  import { logAppend } from "$lib/stores/logs";
  import { confirmDialog } from "$lib/stores/dialog";
  import { diffPrefs } from "$lib/stores/diffPrefs";
  import { commitRevs, stagedRevs, unstagedRevs } from "$lib/diff/revs";
  import { runPatchAction, type PatchAction } from "$lib/diff/patchAction";
  import type { PatchSelection } from "$lib/diff/patchBuilder";
  import type { DiffMode } from "./diff/hunkView";
  import { pushUndo } from "$lib/stores/history";
  import { discardPatchUndo } from "$lib/stores/undoEntries";
  import { renamedFromStats } from "$lib/commit/renamedFrom";
  import Icon from "$lib/icons/Icon.svelte";

  interface Props {
    file: string;
    /** Working-dir mode: pass `staged` (and omit `commitSha`). */
    staged?: boolean;
    /** Commit-file mode: pass the commit sha. Diff = `git show <sha> -- file`
     *  (plus the old name of a rename), File View = `git show <sha>:file`. Read-only. */
    commitSha?: string;
  }
  let { file, staged, commitSha }: Props = $props();

  const isCommitMode = $derived(commitSha != null);
  // Which revisions the image preview reads for each diff mode (diff-viewer spec).
  const imageRevs = $derived(
    commitSha != null ? commitRevs(commitSha) : staged ? stagedRevs() : unstagedRevs(),
  );

  let diffs = $state<FileDiff[]>([]);
  let fileText = $state<string>("");
  let loading = $state(false);
  let toolTab = $state<"diff" | "file">("diff");

  // Commit diffs never change, so they load once per file/commit/tab. Working-
  // tree diffs reload on every refresh tick: an edited-again file keeps an
  // identical status entry, so a status-only dependency would miss it (spec
  // repo-refresh.md).
  $effect(() => {
    void file; void staged; void commitSha; void toolTab; void $diffPrefs.ignoreWs;
    if (!commitSha) void $worktreeTick;
    if ($currentRepo) load();
  });

  async function load() {
    if (!$currentRepo) return;
    loading = true;
    try {
      if (toolTab === "diff") {
        if (commitSha) {
          // Backend limits the commit diff to this path (git show -- <file>),
          // so one file no longer pays for the whole commit. A renamed file
          // also passes its old name, or the rename shows as an added file.
          const oldFile = await oldNameInCommit($currentRepo, commitSha, file);
          diffs = await ipc.diffCommit($currentRepo, commitSha, file, $diffPrefs.ignoreWs, oldFile);
        } else {
          diffs = staged
            ? await ipc.diffIndex($currentRepo, file, $diffPrefs.ignoreWs)
            : await ipc.diffWorkdir($currentRepo, file, $diffPrefs.ignoreWs);
        }
      } else {
        fileText = commitSha
          ? await ipc.fileReadAt($currentRepo, commitSha, file)
          : await ipc.fileRead($currentRepo, file);
      }
    } catch (e) {
      if (toolTab === "diff") diffs = [];
      else fileText = `// failed to read: ${e}`;
      logAppend("warn", `read ${file}: ${e}`);
    } finally { loading = false; }
  }

  /** The file's name before `sha` renamed it, or undefined. centerMode holds
   *  only the new path, so the commit's own file list supplies the old one. */
  async function oldNameInCommit(repo: string, sha: string, path: string): Promise<string | undefined> {
    return renamedFromStats(await ipc.commitFiles(repo, sha), path);
  }

  async function stageThis() {
    if (!$currentRepo) return;
    await withBusy(() => ipc.stageFile($currentRepo!, file));
    centerMode.set({ kind: "file", file, staged: true });
  }
  async function unstageThis() {
    if (!$currentRepo) return;
    await withBusy(() => ipc.unstageFile($currentRepo!, file));
    centerMode.set({ kind: "file", file, staged: false });
  }
  async function discardThis() {
    if (!$currentRepo) return;
    const ok = await confirmDialog({
      title: `Discard changes in ${file}?`,
      confirmLabel: "Discard",
      danger: true,
    });
    if (!ok) return;
    await withBusy(() => ipc.discardFile($currentRepo!, file));
    showGraph();
  }

  // Which hunk actions the viewer offers: none in commit or stash diffs (readonly).
  const viewMode = $derived<DiffMode>(isCommitMode ? "readonly" : staged ? "staged" : "unstaged");

  /** Runs a hunk or line action. Discard asks first, like the file discard, and
   * records an undo entry once git has applied the patch. withBusy refreshes the
   * status, and the worktree tick reloads this diff. */
  async function patchFile(file: FileDiff, selection: PatchSelection, action: PatchAction): Promise<void> {
    const repo = $currentRepo;
    if (!repo) return;
    if (action === "discard") {
      const ok = await confirmDialog({
        title: `Discard the selected changes in ${file.new_path || file.old_path}?`,
        message: "Undo brings them back.",
        confirmLabel: "Discard",
        danger: true,
      });
      if (!ok) return;
    }
    const backup = await withBusy(() => runPatchAction(ipc, repo, file, selection, action));
    if (backup) pushUndo(discardPatchUndo(repo, backup.file, backup.blob, backup.patch));
  }

  const additions = $derived.by(() =>
    diffs.reduce((a, f) => a + f.hunks.reduce((b, h) => b + h.lines.filter((l) => l.kind === "add").length, 0), 0),
  );
  const deletions = $derived.by(() =>
    diffs.reduce((a, f) => a + f.hunks.reduce((b, h) => b + h.lines.filter((l) => l.kind === "del").length, 0), 0),
  );
</script>

<div class="diff-panel">
  <!-- View header: one 30 px row, the path as the title and icon-button actions. -->
  <header class="dp-header">
    <div class="left">
      <span class="ico"><Icon name="file" size={14} /></span>
      <span class="path" title={file}>{file}</span>
      <span class="branch" title="branch">{$graph?.head_branch ?? ""}</span>
    </div>
    <div class="center">
      <span class="stat add">+{additions}</span>
      <span class="stat del">−{deletions}</span>
    </div>
    <div class="right">
      <button class="icon-btn" type="button" title="Commit history of this file" aria-label="Commit history of this file"
        onclick={() => showFileHistory(file)}><Icon name="history" size={14} /></button>
      <!-- Commit mode blames the file as that commit has it; otherwise the working tree. -->
      <button class="icon-btn" type="button" title="Blame this file" aria-label="Blame this file"
        onclick={() => showFileBlame(file, commitSha)}><Icon name="blame" size={14} /></button>
      {#if isCommitMode}
        <span class="sha-pill" title="commit">@{commitSha!.slice(0, 7)}</span>
      {:else if staged}
        <button class="btn" type="button" onclick={unstageThis}>Unstage File</button>
      {:else}
        <button class="btn primary" type="button" onclick={stageThis}>Stage File</button>
        <button class="icon-btn danger" type="button" title="Discard changes in this file" aria-label="Discard changes in this file"
          onclick={discardThis}><Icon name="trash" size={14} /></button>
      {/if}
      <button class="icon-btn" type="button" onclick={showGraph} title="Close diff (Esc)" aria-label="Close diff"
        ><Icon name="close" size={14} /></button>
    </div>
  </header>

  <nav class="toolbar">
    {#if !isCommitMode}
      <span class="seg">
        <button class:active={!staged} onclick={() => centerMode.set({ kind: "file", file, staged: false })}>Unstaged</button>
        <button class:active={staged} onclick={() => centerMode.set({ kind: "file", file, staged: true })}>Staged</button>
      </span>
      <span class="sep"></span>
    {/if}
    <span class="seg">
      <button class:active={toolTab === "file"} onclick={() => toolTab = "file"}>File View</button>
      <button class:active={toolTab === "diff"} onclick={() => toolTab = "diff"}>Diff View</button>
    </span>
  </nav>

  <div class="dp-body">
    {#if toolTab === "file"}
      {#if loading}
        <div class="empty">Loading…</div>
      {:else}
        <pre class="file-view">{fileText}</pre>
      {/if}
    {:else}
      <!-- DiffViewer owns the empty state so its toolbar stays reachable: turning
           on whitespace-hiding can empty a diff that the toggle must still undo. -->
      <DiffViewer {diffs} {loading} revs={imageRevs} mode={viewMode} onPatch={patchFile} />
    {/if}
  </div>
</div>

<style>
  .diff-panel { height: 100%; display: flex; flex-direction: column; background: var(--bg); overflow: hidden; }
  .dp-header {
    display: flex; align-items: center; gap: var(--sp-6);
    height: var(--h-section); padding: 0 var(--sp-8);
    background: var(--bg-elev); border-bottom: 1px solid var(--border-strong); flex-shrink: 0;
  }
  .left { display: flex; align-items: center; gap: var(--sp-4); flex: 1; min-width: 0; }
  .ico { display: inline-flex; color: var(--fg-muted); }
  .path { font-family: "Cascadia Code", Consolas, monospace; font-size: var(--fs-lg);
    color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  /* Ref pill: 18 px high, the spec's pill size (no token for it). */
  .branch { display: inline-flex; align-items: center; height: 18px; padding: 0 var(--sp-4);
    font-size: var(--fs-sm); color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); border-radius: var(--radius-sm);
    white-space: nowrap; }
  .center { display: flex; gap: var(--sp-4); }
  .stat { font-size: var(--fs-md); font-weight: 600; font-family: "Cascadia Code", Consolas, monospace; }
  .stat.add { color: var(--add); }
  .stat.del { color: var(--del); }
  .right { display: flex; gap: var(--sp-3); align-items: center; }
  .btn {
    display: inline-flex; align-items: center; height: var(--h-row); padding: 0 var(--sp-6);
    background: var(--bg); color: var(--fg); border: 1px solid var(--border);
    border-radius: var(--radius); cursor: pointer; font-size: var(--fs-sm); font-weight: 500; white-space: nowrap;
  }
  .btn:hover { background: var(--border); }
  .btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 600; }
  .btn.primary:hover { background: color-mix(in srgb, var(--accent) 80%, white); }
  /* Icon-only action: 24 x 24, the toolbar hit size. */
  .icon-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: var(--h-row); height: var(--h-row); padding: 0;
    background: transparent; color: var(--fg-muted); border: 1px solid transparent;
    border-radius: var(--radius); cursor: pointer;
  }
  .icon-btn:hover { color: var(--fg); background: var(--border); }
  .icon-btn.danger:hover {
    color: var(--del); border-color: var(--del);
    background: color-mix(in srgb, var(--del) 22%, transparent);
  }
  .sha-pill {
    display: inline-flex; align-items: center; height: 18px; padding: 0 var(--sp-4);
    font-size: var(--fs-sm); color: var(--sha);
    font-family: "Cascadia Code", Consolas, monospace;
    background: color-mix(in srgb, var(--sha) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--sha) 35%, transparent);
    border-radius: var(--radius-sm);
  }

  .toolbar { display: flex; align-items: center; gap: var(--sp-6); padding: var(--sp-2) var(--sp-8);
    background: var(--bg); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .seg { display: inline-flex; gap: 0; }
  .seg button { height: var(--h-row); padding: 0 var(--sp-6); background: transparent; color: var(--fg-muted);
    border: 1px solid var(--border); cursor: pointer;
    font-size: var(--fs-sm); text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; }
  .seg button:first-child { border-radius: var(--radius) 0 0 var(--radius); }
  .seg button:last-child { border-radius: 0 var(--radius) var(--radius) 0; border-left: 0; }
  .seg button.active { background: var(--border-strong); color: var(--fg); }
  .seg button:hover:not(.active) { color: var(--fg); }
  .sep { width: 1px; align-self: stretch; background: var(--border); }

  .dp-body { flex: 1; overflow: auto; }
  .empty { padding: var(--sp-20) var(--sp-8); text-align: center; color: var(--fg-muted); font-style: italic; }
  .file-view {
    margin: 0;
    padding: var(--sp-6) var(--sp-8);
    color: var(--fg);
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: var(--fs-md);
    line-height: 1.5;
    white-space: pre;
    overflow: auto;
    min-height: 100%;
  }
</style>
