<script lang="ts">
  // The commits that touched one file, with the selected commit's diff beside
  // them. Commits load one page at a time: `skip` passes over the ones already
  // shown, so a long history never reaches the view at once.
  // See docs/specs/file-history-blame.md.
  import { currentRepo } from "$lib/stores/repo";
  import { diffPrefs } from "$lib/stores/diffPrefs";
  import { showGraph } from "$lib/stores/center";
  import { logAppend } from "$lib/stores/logs";
  import { ipc, type FileDiff, type FileLogEntry } from "$lib/ipc";
  import { commitRevs } from "$lib/diff/revs";
  import { renamedFromLog } from "$lib/commit/renamedFrom";
  import { formatCommitDate } from "$lib/commit/format";
  import DiffViewer from "../DiffViewer.svelte";
  import HistoryRow from "./HistoryRow.svelte";
  import {
    blameAtCommit, copyCommitSha, showCommitInGraph,
  } from "$lib/history/historyActions";

  interface Props {
    file: string;
  }
  let { file }: Props = $props();

  /** Commits per request. "Load more" asks for the next page. */
  const PAGE_SIZE = 200;

  let entries = $state<FileLogEntry[]>([]);
  let selected = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let hasMore = $state(false);
  let diffs = $state<FileDiff[]>([]);
  let diffLoading = $state(false);

  // Each load takes a number. A reply for an older file or repo is dropped, so a
  // slow load never replaces the list of the file open now.
  let listSeq = 0;
  let diffSeq = 0;

  const selectedEntry = $derived(entries.find((e) => e.sha === selected) ?? null);
  // The name before the selected commit renamed the file, when its older entry is loaded.
  const selectedOldFile = $derived(
    selectedEntry ? renamedFromLog(entries, entries.indexOf(selectedEntry)) : undefined,
  );

  $effect(() => {
    const repo = $currentRepo;
    if (repo) void loadFirstPage(repo, file);
  });

  $effect(() => {
    const repo = $currentRepo;
    const entry = selectedEntry;
    const oldFile = selectedOldFile;
    const ignoreWs = $diffPrefs.ignoreWs;
    if (repo && entry) void loadDiff(repo, entry, oldFile, ignoreWs);
    else diffs = [];
  });

  async function loadFirstPage(repo: string, path: string): Promise<void> {
    const seq = ++listSeq;
    entries = [];
    selected = null;
    error = null;
    hasMore = false;
    loading = true;
    try {
      const page = await ipc.fileHistory(repo, path, PAGE_SIZE, 0);
      if (seq !== listSeq) return;
      entries = page;
      hasMore = page.length === PAGE_SIZE;
      selected = page[0]?.sha ?? null;
    } catch (e) {
      if (seq === listSeq) error = String(e);
    } finally {
      if (seq === listSeq) loading = false;
    }
  }

  async function loadMore(): Promise<void> {
    const repo = $currentRepo;
    if (!repo || loading) return;
    const seq = listSeq;
    loading = true;
    try {
      const page = await ipc.fileHistory(repo, file, PAGE_SIZE, entries.length);
      if (seq !== listSeq) return;
      entries = [...entries, ...page];
      hasMore = page.length === PAGE_SIZE;
    } catch (e) {
      if (seq === listSeq) error = String(e);
    } finally {
      if (seq === listSeq) loading = false;
    }
  }

  // The diff of one commit, limited to the file's name at that commit. For a
  // rename the old name goes too, so the commit shows as a rename, not an add.
  async function loadDiff(
    repo: string, entry: FileLogEntry, oldFile: string | undefined, ignoreWs: boolean,
  ): Promise<void> {
    const seq = ++diffSeq;
    diffLoading = true;
    try {
      const result = await ipc.diffCommit(repo, entry.sha, entry.path_at_commit, ignoreWs, oldFile);
      if (seq === diffSeq) diffs = result;
    } catch (e) {
      if (seq !== diffSeq) return;
      diffs = [];
      logAppend("warn", `history diff ${entry.sha.slice(0, 7)}: ${e}`);
    } finally {
      if (seq === diffSeq) diffLoading = false;
    }
  }
</script>

<div class="history">
  <header class="fh-head">
    <span class="path" title={file}>{file}</span>
    <span class="count">
      {entries.length} commit{entries.length === 1 ? "" : "s"}{hasMore ? "+" : ""}
    </span>
    <button class="close" type="button" title="Close (Esc)" onclick={() => showGraph()}>×</button>
  </header>

  <div class="fh-body">
    <div class="list">
      {#if error}
        <div class="note err">{error}</div>
      {/if}
      <ul>
        {#each entries as entry (entry.sha)}
          <HistoryRow
            {entry}
            selected={entry.sha === selected}
            onSelect={() => (selected = entry.sha)}
          />
        {/each}
      </ul>
      {#if loading}
        <div class="note">Loading…</div>
      {:else if entries.length === 0 && !error}
        <div class="note">No commits touch this file.</div>
      {:else if hasMore}
        <button class="more" type="button" onclick={() => loadMore()}>Load more</button>
      {/if}
    </div>

    <section class="detail">
      {#if selectedEntry}
        {@const sel = selectedEntry}
        <header class="d-head">
          <div class="d-text">
            <span class="subject">{sel.subject}</span>
            <span class="meta">{sel.author_name} · {formatCommitDate(sel.timestamp)}</span>
          </div>
          <div class="actions">
            <button type="button" onclick={() => showCommitInGraph(sel.sha)}>Show in graph</button>
            <button type="button" onclick={() => blameAtCommit(sel.path_at_commit, sel.sha)}>
              Blame at this commit
            </button>
            <button type="button" onclick={() => copyCommitSha(sel.sha)}>Copy sha</button>
          </div>
        </header>
        <div class="d-body">
          <DiffViewer
            {diffs}
            loading={diffLoading}
            revs={commitRevs(sel.sha)}
            mode="readonly"
          />
        </div>
      {:else if !loading}
        <div class="empty">Select a commit to see the change to this file.</div>
      {/if}
    </section>
  </div>
</div>

<style>
  .history { height: 100%; display: flex; flex-direction: column; background: var(--bg); overflow: hidden; }
  .fh-head {
    display: flex; align-items: center; gap: 12px; padding: 8px 14px;
    background: var(--bg-elev); border-bottom: 1px solid var(--border-strong); flex-shrink: 0;
  }
  .path {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: "Cascadia Code", Consolas, monospace; font-size: 13px; font-weight: 500;
  }
  .count { font-size: 11px; color: var(--fg-muted); }
  .close {
    background: transparent; border: 0; color: var(--fg-muted); font-size: 18px;
    width: 30px; line-height: 1; cursor: pointer;
  }
  .close:hover { color: var(--del); }

  .fh-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(240px, 320px) 1fr; }
  .list { border-right: 1px solid var(--border-strong); overflow: auto; min-height: 0; }
  .list ul { list-style: none; margin: 0; padding: 0; }
  .detail { display: flex; flex-direction: column; min-width: 0; min-height: 0; }

  .d-head {
    display: flex; align-items: center; gap: 12px; padding: 8px 12px;
    border-bottom: 1px solid var(--border); flex-shrink: 0; flex-wrap: wrap;
  }
  .d-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .d-text .subject { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .d-text .meta { font-size: 11px; color: var(--fg-muted); }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .actions button, .more {
    background: var(--bg); color: var(--fg); border: 1px solid var(--border);
    padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;
  }
  .actions button:hover, .more:hover { background: var(--border); }
  .more { display: block; width: calc(100% - 24px); margin: 8px 12px; }
  .d-body { flex: 1; min-height: 0; overflow: auto; }
  .note { padding: 12px; font-size: 12px; color: var(--fg-muted); font-style: italic; }
  .note.err { color: var(--del); font-style: normal; }
  .empty { padding: 40px; text-align: center; color: var(--fg-muted); font-style: italic; }
</style>
