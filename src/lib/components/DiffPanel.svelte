<script lang="ts">
  import { currentRepo, graph, withBusy, status } from "$lib/stores/repo";
  import { showGraph, centerMode } from "$lib/stores/center";
  import { ipc } from "$lib/ipc";
  import DiffViewer from "./DiffViewer.svelte";
  import type { FileDiff } from "$lib/ipc";
  import { logAppend } from "$lib/stores/logs";

  interface Props {
    file: string;
    /** Working-dir mode: pass `staged` (and omit `commitSha`). */
    staged?: boolean;
    /** Commit-file mode: pass the commit sha. Diff = `git show <sha> -- file`,
     *  File View = `git show <sha>:file`. Read-only. */
    commitSha?: string;
  }
  let { file, staged, commitSha }: Props = $props();

  const isCommitMode = $derived(commitSha != null);

  let diffs = $state<FileDiff[]>([]);
  let fileText = $state<string>("");
  let loading = $state(false);
  let toolTab = $state<"diff" | "file">("diff");

  $effect(() => {
    void file; void staged; void commitSha; void $status; void toolTab;
    if ($currentRepo) load();
  });

  async function load() {
    if (!$currentRepo) return;
    loading = true;
    try {
      if (toolTab === "diff") {
        if (commitSha) {
          // diff_commit returns every file in the commit; filter to ours.
          const all = await ipc.diffCommit($currentRepo, commitSha);
          diffs = all.filter((d) => (d.new_path || d.old_path) === file);
        } else {
          diffs = staged
            ? await ipc.diffIndex($currentRepo, file)
            : await ipc.diffWorkdir($currentRepo, file);
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
    if (!confirm(`Discard changes in ${file}?`)) return;
    await withBusy(() => ipc.discardFile($currentRepo!, file));
    showGraph();
  }

  const additions = $derived.by(() =>
    diffs.reduce((a, f) => a + f.hunks.reduce((b, h) => b + h.lines.filter((l) => l.kind === "add").length, 0), 0),
  );
  const deletions = $derived.by(() =>
    diffs.reduce((a, f) => a + f.hunks.reduce((b, h) => b + h.lines.filter((l) => l.kind === "del").length, 0), 0),
  );
</script>

<div class="diff-panel">
  <header class="dp-header">
    <div class="left">
      <span class="ico">📄</span>
      <span class="path" title={file}>{file}</span>
      <span class="branch" title="branch">{$graph?.head_branch ?? ""}</span>
    </div>
    <div class="center">
      <span class="stat add">+{additions}</span>
      <span class="stat del">−{deletions}</span>
    </div>
    <div class="right">
      {#if isCommitMode}
        <span class="sha-pill" title="commit">@{commitSha!.slice(0, 7)}</span>
      {:else if staged}
        <button class="btn" onclick={unstageThis}>Unstage File</button>
      {:else}
        <button class="btn primary" onclick={stageThis}>Stage File</button>
        <button class="btn danger" onclick={discardThis}>Discard</button>
      {/if}
      <button class="btn close" onclick={showGraph} title="Close diff (Esc)">×</button>
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
    {#if loading}
      <div class="empty">Loading…</div>
    {:else if toolTab === "file"}
      <pre class="file-view">{fileText}</pre>
    {:else if diffs.length === 0}
      <div class="empty">No changes for this file.</div>
    {:else}
      <DiffViewer diffs={diffs} />
    {/if}
  </div>
</div>

<style>
  .diff-panel { height: 100%; display: flex; flex-direction: column; background: var(--bg); overflow: hidden; }
  .dp-header { display: flex; align-items: center; gap: 16px; padding: 10px 16px;
    background: var(--bg-elev); border-bottom: 1px solid var(--border-strong); flex-shrink: 0; }
  .left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
  .ico { font-size: 18px; }
  .path { font-family: "Cascadia Code", Consolas, monospace; font-size: 13px;
    color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .branch { font-size: 11px; color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); padding: 2px 8px; border-radius: 10px; }
  .center { display: flex; gap: 8px; }
  .stat { font-size: 12px; font-weight: 600; font-family: "Cascadia Code", Consolas, monospace; }
  .stat.add { color: var(--add); }
  .stat.del { color: var(--del); }
  .right { display: flex; gap: 6px; align-items: center; }
  .btn { background: var(--bg); color: var(--fg); border: 1px solid var(--border);
    padding: 5px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500; }
  .btn:hover { background: var(--border); }
  .btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 600; }
  .btn.primary:hover { background: color-mix(in srgb, var(--accent) 80%, white); }
  .btn.danger:hover {
    background: color-mix(in srgb, var(--del) 22%, transparent);
    border-color: var(--del);
    color: var(--del);
  }
  .sha-pill {
    font-size: 11px; color: var(--sha);
    font-family: "Cascadia Code", Consolas, monospace;
    background: color-mix(in srgb, var(--sha) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--sha) 35%, transparent);
    padding: 2px 8px; border-radius: 10px;
  }
  .btn.close { width: 30px; padding: 4px 0; text-align: center; font-size: 18px; line-height: 1;
    margin-left: 8px; color: var(--fg-muted); }
  .btn.close:hover { color: var(--del); background: color-mix(in srgb, var(--del) 10%, transparent); }

  .toolbar { display: flex; align-items: center; gap: 12px; padding: 6px 16px;
    background: var(--bg); border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .seg { display: inline-flex; gap: 0; }
  .seg button { background: transparent; color: var(--fg-muted);
    border: 1px solid var(--border); padding: 4px 12px; cursor: pointer;
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; }
  .seg button:first-child { border-radius: 3px 0 0 3px; }
  .seg button:last-child { border-radius: 0 3px 3px 0; border-left: 0; }
  .seg button.active { background: var(--border-strong); color: var(--fg); }
  .seg button:hover:not(.active) { color: var(--fg); }
  .sep { width: 1px; align-self: stretch; background: var(--border); }

  .dp-body { flex: 1; overflow: auto; }
  .empty { padding: 40px; text-align: center; color: var(--fg-muted); font-style: italic; }
  .file-view {
    margin: 0;
    padding: 12px 16px;
    color: var(--fg);
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre;
    overflow: auto;
    min-height: 100%;
  }
</style>
