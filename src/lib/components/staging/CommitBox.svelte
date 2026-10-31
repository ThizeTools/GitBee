<script lang="ts">
  import { currentRepo, status, graph, withBusy } from "$lib/stores/repo";
  import { showGraph } from "$lib/stores/center";
  import { ipc } from "$lib/ipc";
  import { logAppend } from "$lib/stores/logs";
  import { tick } from "svelte";
  import {
    SUMMARY_LIMIT, amendFields, composeMessage, isStaged,
    summaryColor, summaryPercent,
  } from "./stagingHelpers";

  // The commit message form: summary, description, amend and the commit
  // action. Self-contained so future commit features (signing, templates,
  // co-authors, AI message) land here.
  interface Props {
    /** Called after a successful commit so the parent can clear list selections. */
    onCommitted?: () => void;
  }
  let { onCommitted }: Props = $props();

  let summary = $state("");
  let description = $state("");
  let amend = $state(false);

  // For #16 — preserve user typing when toggling amend.
  let savedSummary = "";
  let savedDescription = "";
  let prevAmend = false;

  let summaryEl: HTMLInputElement | null = $state(null);
  let descriptionEl: HTMLTextAreaElement | null = $state(null);

  const stagedCount = $derived($status.filter(isStaged).length);

  async function commit() {
    if (!$currentRepo || !summary.trim()) return;
    if (stagedCount === 0 && !amend) return;
    const msg = composeMessage(summary, description);
    // Tauri serializes Rust `()` returns as JSON null, so the previous
    // `ok !== null` gate falsely treated success as failure and the input
    // was never cleared. Use a local success flag instead.
    let ok = false;
    await withBusy(async () => {
      await ipc.commitCreate($currentRepo!, msg, amend, false);
      ok = true;
    });
    if (ok) {
      summary = ""; description = ""; amend = false;
      savedSummary = ""; savedDescription = "";
      onCommitted?.();
      logAppend("info", `committed: ${msg.split("\n")[0]}`);
      // Drop user back on the graph after a successful commit so the new
      // commit is visible immediately. If they were viewing a diff, the
      // diff target is gone (file is now committed) — landing on the
      // graph is the unambiguous next step.
      showGraph();
    }
  }

  // Ctrl+Enter (Cmd+Enter on macOS) anywhere in the summary or description
  // submits the commit. Matches the convention used by GitHub, GitLab,
  // and most native chat/commit UIs.
  function onCommitFieldKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  }

  // #16 — pull HEAD message into summary/description on amend toggle, restore on uncheck.
  $effect(() => {
    if (amend === prevAmend) return;
    if (amend) {
      savedSummary = summary;
      savedDescription = description;
      const headSha = $graph?.head_sha;
      if (headSha && $currentRepo) {
        ipc.commitShow($currentRepo, headSha).then((full) => {
          const fields = amendFields(full);
          summary = fields.summary;
          description = fields.description;
        }).catch(() => { /* leave whatever was there */ });
      }
    } else {
      summary = savedSummary;
      description = savedDescription;
    }
    prevAmend = amend;
  });

  // #14 — Enter in summary jumps to description. Ctrl+Enter submits.
  function onSummaryKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      tick().then(() => descriptionEl?.focus());
    }
  }

  // #7 — description expands to fill the commit area; user resizes the whole
  // commit area instead of the textarea individually.
</script>

<div class="commit-body">
  <div class="field">
    <input
      bind:this={summaryEl}
      class="summary"
      placeholder="Commit summary"
      bind:value={summary}
      onkeydown={onSummaryKey}
    />
    <span class="counter" style="color: {summaryColor(summary.length)}">
      {summary.length}/{SUMMARY_LIMIT}
    </span>
  </div>
  <div class="counter-bar">
    <div class="counter-fill" style="width: {summaryPercent(summary.length)}%; background: {summaryColor(summary.length)}"></div>
  </div>
  <textarea
    bind:this={descriptionEl}
    class="description"
    placeholder="Description (optional). Press Enter in summary to jump here. Ctrl+Enter to commit."
    bind:value={description}
    onkeydown={onCommitFieldKey}
  ></textarea>
  <label class="amend">
    <input type="checkbox" bind:checked={amend} />
    Amend previous commit
  </label>
  <button
    class="commit-btn"
    onclick={commit}
    disabled={!summary.trim() || (stagedCount === 0 && !amend)}
  >
    ✓ Commit{amend ? " (amend)" : ""}{stagedCount > 0 ? ` ${stagedCount} file${stagedCount === 1 ? "" : "s"}` : ""}
  </button>
</div>

<style>
  .commit-body {
    padding: 12px 14px;
    display: flex; flex-direction: column; gap: 8px;
    flex: 1;
    /* never scroll — the description shrinks (flex:1 with min-height) */
    overflow: hidden;
    min-height: 0;
  }
  .field { position: relative; }
  .summary {
    width: 100%; background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 8px 60px 8px 10px; font-size: 13px; font-weight: 500;
  }
  .summary:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .counter {
    position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
    font-size: 10px; font-family: "Cascadia Code", Consolas, monospace;
    pointer-events: none;
  }
  .counter-bar { height: 2px; background: var(--border); border-radius: 1px; overflow: hidden; }
  .counter-fill { height: 100%; transition: width 100ms; }
  .description {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 8px 10px; font: inherit; font-size: 12px;
    resize: none;
    flex: 1;
    min-height: 50px;
  }
  .description:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .amend {
    font-size: 11px; color: var(--fg-muted);
    display: flex; gap: 6px; align-items: center;
  }
  /* Default: translucent fill (low opacity) with the accent border at 100%
     so the button reads as a primary action without dominating the panel.
     Hover: fill goes to 100% and content swaps to the bg for contrast. */
  .commit-btn {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    border: 1px solid var(--accent);
    padding: 10px 14px; border-radius: 4px; cursor: pointer;
    font-weight: 700; font-size: 12px;
    transition: background 120ms ease, color 120ms ease;
  }
  .commit-btn:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .commit-btn:disabled {
    background: transparent; color: var(--fg-muted);
    border-color: var(--border); cursor: not-allowed;
  }
</style>
