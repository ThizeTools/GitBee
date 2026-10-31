<script lang="ts">
  // Blame of one file: a row per line, a gutter that names the commit of each
  // run of lines, and a bar whose shade shows how old that commit is. Only the
  // rows on screen are drawn, so a long file scrolls without building every
  // row. See docs/specs/file-history-blame.md.
  import "../diff/diff.css";
  import { currentRepo, worktreeTick } from "$lib/stores/repo";
  import { showFileHistory, showGraph } from "$lib/stores/center";
  import { ipc, type BlameCommit, type BlameResult } from "$lib/ipc";
  import { highlightCode, langForPath } from "$lib/diff/highlight";
  import { formatAbsoluteDate, formatRelativeDate } from "$lib/graph/relativeDate";
  import { visibleRows } from "$lib/history/virtualRange";
  import {
    BLAME_ROW_HEIGHT, blameRowViews, isUncommittedSha, resultAgeBounds,
  } from "$lib/history/blameRows";
  import { blamePreviousRevision, showCommitInGraph } from "$lib/history/historyActions";

  interface Props {
    file: string;
    /** Revision to blame at. Omitted means the working tree. */
    rev?: string;
  }
  let { file, rev }: Props = $props();

  /** The group tooltip: the commit of the hovered gutter, placed at the pointer. */
  interface Tip { sha: string; x: number; y: number; }

  let result = $state<BlameResult | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let scrollTop = $state(0);
  let viewportHeight = $state(0);
  let tip = $state<Tip | null>(null);
  // Plain, not $state: the load effect reads it, and a reactive read would rerun the load.
  let body: HTMLDivElement | undefined;

  // A load takes a number, so a slow reply never replaces a newer blame.
  let loadSeq = 0;
  // The file and revision the shown result belongs to. A change of either drops
  // the old result at once; a working-tree refresh keeps it until the reload lands.
  let loadedKey = "";
  // Read once per mount: relative dates only need to be roughly current.
  const now = Date.now();

  const lines = $derived(result?.lines ?? []);
  const commits = $derived<Record<string, BlameCommit>>(result?.commits ?? {});
  const lang = $derived(langForPath(file));
  const range = $derived(visibleRows(scrollTop, viewportHeight, BLAME_ROW_HEIGHT, lines.length));
  const bounds = $derived(result ? resultAgeBounds(result) : { oldest: 0, newest: 0 });
  const views = $derived(result ? blameRowViews(result, range, bounds) : []);
  const tipCommit = $derived<BlameCommit | undefined>(tip ? commits[tip.sha] : undefined);

  $effect(() => {
    const repo = $currentRepo;
    const key = `${file}\u0000${rev ?? ""}`;
    // A commit's blame never changes, so only the working tree reloads on refresh.
    if (!rev) void $worktreeTick;
    if (!repo) return;
    if (key !== loadedKey) resetView(key);
    void load(repo, file, rev);
  });

  function resetView(key: string): void {
    loadedKey = key;
    result = null;
    scrollTop = 0;
    if (body) body.scrollTop = 0;
  }

  async function load(repo: string, path: string, at: string | undefined): Promise<void> {
    const seq = ++loadSeq;
    loading = true;
    error = null;
    try {
      const next = await ipc.fileBlame(repo, path, at);
      if (seq === loadSeq) result = next;
    } catch (e) {
      if (seq === loadSeq) {
        result = null;
        error = String(e);
      }
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  function showTip(e: MouseEvent, sha: string): void {
    tip = { sha, x: e.clientX, y: e.clientY };
  }
</script>

<div class="blame">
  <header class="fb-head">
    <span class="path" title={file}>{file}</span>
    <span class="at">{rev ? `at ${rev}` : "working tree"}</span>
    {#if result}
      <span class="count">{result.lines.length.toLocaleString()} lines</span>
    {/if}
    <button class="link" type="button" onclick={() => showFileHistory(file)}>History</button>
    <button class="close" type="button" title="Close (Esc)" onclick={() => showGraph()}>×</button>
  </header>

  <div
    class="fb-body"
    bind:this={body}
    bind:clientHeight={viewportHeight}
    onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
  >
    {#if error}
      <div class="note err">{error}</div>
    {:else if !result}
      <div class="note">{loading ? "Blaming…" : ""}</div>
    {:else if lines.length === 0}
      <div class="note">This file has no lines.</div>
    {:else}
      <div class="spacer" style="height: {lines.length * BLAME_ROW_HEIGHT}px">
        {#each views as v (v.index)}
          {@const commit = commits[v.line.sha]}
          {@const uncommitted = isUncommittedSha(v.line.sha)}
          <div class="row" class:group-start={v.startsGroup} style="top: {v.index * BLAME_ROW_HEIGHT}px">
            <div
              class="gutter"
              role="presentation"
              onmouseenter={(e) => showTip(e, v.line.sha)}
              onmouseleave={() => (tip = null)}
            >
              <span class="bar" style="opacity: {v.opacity}"></span>
              {#if v.showInfo && commit}
                <button
                  class="sha"
                  type="button"
                  disabled={uncommitted}
                  title={uncommitted ? "Not committed yet" : "Show in graph"}
                  onclick={() => showCommitInGraph(v.line.sha)}
                >{uncommitted ? "uncommitted" : v.line.sha.slice(0, 7)}</button>
                <span class="who">{commit.author_name}</span>
                {#if !uncommitted}
                  <span class="when">{formatRelativeDate(commit.author_time, now)}</span>
                  <button
                    class="prev"
                    type="button"
                    title="Blame the previous revision (sha^)"
                    onclick={() => blamePreviousRevision(file, v.line.sha)}
                  >↶</button>
                {/if}
              {/if}
            </div>
            <span class="lno">{v.line.final_line}</span>
            <span class="code dv-content">{@html highlightCode(v.line.content, lang)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if tip && tipCommit}
    <div class="tip" style="left: {tip.x + 14}px; top: {tip.y + 14}px">
      <div class="tip-summary">{tipCommit.summary}</div>
      <div class="tip-line">{tipCommit.author_name} &lt;{tipCommit.author_email}&gt;</div>
      {#if !isUncommittedSha(tip.sha)}
        <div class="tip-line">{formatAbsoluteDate(tipCommit.author_time)}</div>
        <div class="tip-line sha-full">{tip.sha}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .blame { height: 100%; display: flex; flex-direction: column; background: var(--bg); overflow: hidden; }
  .fb-head {
    display: flex; align-items: center; gap: 12px; padding: 8px 14px;
    background: var(--bg-elev); border-bottom: 1px solid var(--border-strong); flex-shrink: 0;
  }
  .path {
    font-family: "Cascadia Code", Consolas, monospace; font-size: 13px; font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
  }
  .at, .count { font-size: 11px; color: var(--fg-muted); white-space: nowrap; }
  .fb-head .path { flex: 1; }
  .link {
    background: var(--bg); color: var(--fg); border: 1px solid var(--border);
    padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;
  }
  .link:hover { background: var(--border); }
  .close {
    background: transparent; border: 0; color: var(--fg-muted); font-size: 18px;
    width: 30px; line-height: 1; cursor: pointer;
  }
  .close:hover { color: var(--del); }

  .fb-body { flex: 1; min-height: 0; overflow: auto; position: relative; }
  .spacer { position: relative; min-width: 100%; }
  .row {
    position: absolute; left: 0; min-width: 100%; width: max-content;
    height: 18px; box-sizing: border-box; display: flex; align-items: center;
    font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; line-height: 18px;
    white-space: pre;
  }
  .row.group-start { border-top: 1px solid var(--border); }
  .gutter {
    position: relative; width: 300px; flex-shrink: 0; height: 100%; box-sizing: border-box;
    display: flex; align-items: center; gap: 6px; padding-left: 10px;
    font-size: 11px; color: var(--fg-muted); background: var(--bg-elev);
  }
  .bar { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--accent); }
  .sha {
    background: transparent; border: 0; padding: 0; cursor: pointer; flex-shrink: 0;
    font-family: inherit; font-size: 11px; color: var(--sha);
  }
  .sha:disabled { color: var(--fg-muted); cursor: default; }
  .who { flex: 0 1 90px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .when { flex-shrink: 0; white-space: nowrap; }
  .prev { background: transparent; border: 0; padding: 0 2px; cursor: pointer; color: var(--fg-muted); }
  .prev:hover { color: var(--fg); }
  .lno { width: 48px; flex-shrink: 0; text-align: right; padding-right: 12px; color: var(--fg-muted); }
  /* The diff palette (.dv-content) clips long lines; the blame row scrolls them. */
  .code { overflow: visible; min-width: max-content; }

  .tip {
    position: fixed; z-index: 50; pointer-events: none; max-width: 360px;
    background: var(--bg-elev); color: var(--fg); border: 1px solid var(--border-strong);
    border-radius: 4px; padding: 6px 8px; font-size: 11px; white-space: normal;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  }
  .tip-summary { font-weight: 600; margin-bottom: 2px; }
  .tip-line { color: var(--fg-muted); }
  .sha-full { font-family: "Cascadia Code", Consolas, monospace; word-break: break-all; }

  .note { padding: 12px; font-size: 12px; color: var(--fg-muted); font-style: italic; }
  .note.err { color: var(--del); font-style: normal; }
</style>
