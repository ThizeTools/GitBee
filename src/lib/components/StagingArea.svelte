<script lang="ts">
  import { currentRepo, status, opState, withBusy, graph } from "$lib/stores/repo";
  import { centerMode, showFile } from "$lib/stores/center";
  import { ipc } from "$lib/ipc";
  import { layout, setSize } from "$lib/stores/layout";
  import { openMenu, type MenuItem } from "$lib/stores/contextmenu";
  import { logAppend } from "$lib/stores/logs";
  import ResizeHandle from "./ResizeHandle.svelte";
  import FileTree from "./FileTree.svelte";
  import { tick } from "svelte";
  import type { StatusEntry } from "$lib/ipc";

  interface Props { onClose?: () => void; }
  let { onClose }: Props = $props();

  let summary = $state("");
  let description = $state("");
  let amend = $state(false);

  // #12 — bottom panel tabs: "commit" or "stash"
  let bottomTab = $state<"commit" | "stash">("commit");
  let stashTitle = $state("");
  let stashDesc = $state("");
  let stashTitleEl: HTMLInputElement | null = $state(null);

  // Auto-fill stash title (#11/#12) — "WIP on <branch>: <subject>"
  $effect(() => {
    if (bottomTab !== "stash") return;
    if (stashTitle.trim().length > 0) return;
    const branch = $graph?.head_branch ?? "HEAD";
    const subject = $graph?.head_sha
      ? ($graph.nodes.find((n) => n.sha === $graph!.head_sha)?.subject ?? "")
      : "";
    stashTitle = subject ? `WIP on ${branch}: ${subject}` : `WIP on ${branch}`;
  });

  async function stashChanges() {
    if (!$currentRepo) return;
    const msg = stashDesc.trim()
      ? `${stashTitle.trim()}\n\n${stashDesc.trim()}`
      : stashTitle.trim();
    const ok = await withBusy(() => ipc.stashCreate($currentRepo!, msg, true));
    if (ok !== null) {
      stashTitle = "";
      stashDesc = "";
      logAppend("info", `stashed: ${msg.split("\n")[0]}`);
    }
  }

  // For #16 — preserve user typing when toggling amend.
  let savedSummary = "";
  let savedDescription = "";
  let prevAmend = false;

  let summaryEl: HTMLInputElement | null = $state(null);
  let descriptionEl: HTMLTextAreaElement | null = $state(null);

  const SUMMARY_LIMIT = 72;

  const staged = $derived($status.filter(isStaged));
  const unstaged = $derived($status.filter((s) => !isStaged(s) && !s.conflicted));
  const conflicted = $derived($status.filter((s) => s.conflicted));

  const activeFile = $derived.by(() => {
    if ($centerMode.kind !== "file") return null;
    return { file: $centerMode.file, staged: $centerMode.staged };
  });

  function isStaged(s: StatusEntry): boolean {
    return s.index !== "unmodified" && s.index !== "untracked" && s.index !== "ignored";
  }
  // Symbol-first indicators: a single glyph that reads like the operation
  // performed on the file. `+` for new, `−` for removed, `●` for edits,
  // `→` for renamed, `!` for conflicts. Beats opaque single-letter codes
  // (M/A/D/R/U) that need a legend to interpret.
  function statusChar(s: StatusEntry, side: "index" | "worktree"): string {
    const v = side === "index" ? s.index : s.worktree;
    switch (v) {
      case "modified": return "●"; case "added": return "+";
      case "deleted": return "−"; case "renamed": return "→";
      case "copied": return "⎘"; case "untracked": return "+";
      case "ignored": return "·"; case "conflicted": return "!";
      default: return " ";
    }
  }
  function statusTitle(s: StatusEntry, side: "index" | "worktree"): string {
    const v = side === "index" ? s.index : s.worktree;
    switch (v) {
      case "modified": return "Modified"; case "added": return "Added (new file)";
      case "deleted": return "Deleted"; case "renamed": return "Renamed";
      case "copied": return "Copied"; case "untracked": return "New file (untracked)";
      case "ignored": return "Ignored"; case "conflicted": return "Conflicted";
      default: return "";
    }
  }
  function ext(p: string): string {
    const i = p.lastIndexOf(".");
    return i > 0 ? p.slice(i) : "";
  }

  async function stage(f: string) {
    if (!$currentRepo) return;
    await withBusy(() => ipc.stageFile($currentRepo!, f));
  }
  async function unstage(f: string) {
    if (!$currentRepo) return;
    await withBusy(() => ipc.unstageFile($currentRepo!, f));
  }
  async function discard(f: string) {
    if (!$currentRepo || !confirm(`Discard changes in ${f}?`)) return;
    await withBusy(() => ipc.discardFile($currentRepo!, f));
  }
  async function stageAll() {
    if (!$currentRepo) return;
    await withBusy(() => ipc.stageAll($currentRepo!));
  }
  async function unstageAll() {
    if (!$currentRepo) return;
    await withBusy(() => ipc.unstageAll($currentRepo!));
  }
  async function commit() {
    if (!$currentRepo || !summary.trim()) return;
    const msg = description.trim()
      ? `${summary.trim()}\n\n${description.trim()}`
      : summary.trim();
    const ok = await withBusy(() => ipc.commitCreate($currentRepo!, msg, amend, false));
    if (ok !== null) {
      summary = ""; description = ""; amend = false;
      savedSummary = ""; savedDescription = "";
      logAppend("info", `committed: ${msg.split("\n")[0]}`);
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
          const lines = full.replace(/\r\n/g, "\n").split("\n");
          summary = lines[0] ?? "";
          let i = 1;
          while (i < lines.length && lines[i] === "") i++;
          description = lines.slice(i).join("\n");
        }).catch(() => { /* leave whatever was there */ });
      }
    } else {
      summary = savedSummary;
      description = savedDescription;
    }
    prevAmend = amend;
  });

  async function abortOp(kind: "merge" | "rebase" | "cherry-pick" | "revert") {
    if (!$currentRepo || !confirm(`Abort ${kind}?`)) return;
    await withBusy(() => ipc.opAbort($currentRepo!, kind));
  }
  async function continueOp(kind: "merge" | "rebase" | "cherry-pick" | "revert") {
    if (!$currentRepo) return;
    await withBusy(() => ipc.opContinue($currentRepo!, kind));
  }

  function summaryPercent(): number {
    return Math.min(100, Math.round((summary.length / SUMMARY_LIMIT) * 100));
  }
  function summaryColor(): string {
    if (summary.length > SUMMARY_LIMIT) return "var(--del)";
    if (summary.length > SUMMARY_LIMIT - 12) return "var(--modified)";
    return "var(--fg-muted)";
  }

  // #14 — Enter in summary jumps to description.
  function onSummaryKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      tick().then(() => descriptionEl?.focus());
    }
  }

  // #7 — description expands to fill the commit area; user resizes the whole
  // commit area instead of the textarea individually.

  // #13 — file context menu
  function fileMenu(f: StatusEntry, isStagedSide: boolean): MenuItem[] {
    const path = f.path;
    return [
      isStagedSide
        ? { label: "Unstage File", icon: "−", onClick: () => unstage(path) }
        : { label: "Stage File", icon: "+", onClick: () => stage(path) },
      { label: "Discard Changes", icon: "↺", danger: true, onClick: () => discard(path) },
      { separator: true, label: "" },
      {
        label: "Ignore",
        icon: "⊘",
        submenu: [
          { label: `Ignore "${path}"`, onClick: () => addIgnore(path) },
          ext(path)
            ? { label: `All files with the extension "${ext(path)}"`, onClick: () => addIgnore(`*${ext(path)}`) }
            : { label: "(no file extension)", disabled: true },
        ],
      },
      { label: "Stash File", icon: "⛶", onClick: () => stashOneFile(path) },
      { label: "File History", icon: "🕮", onClick: () => fileHistory(path) },
      { separator: true, label: "" },
      { label: "File Blame", icon: "≡", onClick: () => fileBlame(path) },
      { label: "Show in folder", icon: "📂", onClick: () => showInFolder(path) },
      { label: "Copy file path", icon: "⧉", onClick: () => copyPath(path) },
      { label: "Edit file", icon: "✎", onClick: () => editFile(path) },
      { separator: true, label: "" },
      { label: "Delete file", icon: "🗑", danger: true, onClick: () => deleteFile(path) },
    ];
  }

  async function addIgnore(p: string) {
    if (!$currentRepo) return;
    await withBusy(() => ipc.ignoreAdd($currentRepo!, p));
    logAppend("info", `gitignore: added "${p}"`);
  }
  async function stashOneFile(f: string) {
    if (!$currentRepo) return;
    const m = prompt("Stash message (optional):", `wip: ${f}`) || undefined;
    await withBusy(() => ipc.stashFile($currentRepo!, f, m));
  }
  async function fileHistory(f: string) {
    if (!$currentRepo) return;
    try {
      const rows = await ipc.fileHistory($currentRepo, f, 50);
      logAppend("info", `History for ${f}: ${rows.length} commits`);
      alert(rows.map((r) => `${r.sha.slice(0,7)} ${r.subject}`).join("\n") || "(no history)");
    } catch (e) { logAppend("error", `history: ${e}`); }
  }
  async function fileBlame(f: string) {
    if (!$currentRepo) return;
    try {
      const rows = await ipc.fileBlame($currentRepo, f);
      logAppend("info", `Blame ${f}: ${rows.length} lines`);
      alert(rows.slice(0, 40).map((r) => `${r.sha.slice(0,7)} ${r.author}: ${r.line}`).join("\n"));
    } catch (e) { logAppend("error", `blame: ${e}`); }
  }
  async function showInFolder(f: string) {
    if (!$currentRepo) return;
    try { await ipc.fileShowInFolder($currentRepo, f); }
    catch (e) { logAppend("error", `show in folder: ${e}`); }
  }
  async function copyPath(f: string) {
    try { await navigator.clipboard.writeText(f); logAppend("info", `copied: ${f}`); }
    catch (e) { logAppend("error", `copy: ${e}`); }
  }
  async function editFile(f: string) {
    if (!$currentRepo) return;
    try { await ipc.fileEdit($currentRepo, f); }
    catch (e) { logAppend("error", `edit: ${e}`); }
  }
  async function deleteFile(f: string) {
    if (!$currentRepo || !confirm(`Delete file ${f}?`)) return;
    try { await withBusy(() => ipc.fileDelete($currentRepo!, f)); }
    catch (e) { logAppend("error", `delete: ${e}`); }
  }
  function onFileContext(e: MouseEvent, f: StatusEntry, sideStaged: boolean) {
    openMenu(e, fileMenu(f, sideStaged));
  }

  function toggleUnstaged() { setSize("unstagedCollapsed", !$layout.unstagedCollapsed); }
  function toggleStaged() { setSize("stagedCollapsed", !$layout.stagedCollapsed); }

  // ---- Discard all (trash button + confirm modal) ----
  let confirmDiscardAll = $state(false);
  async function discardAll() {
    if (!$currentRepo) return;
    confirmDiscardAll = false;
    await withBusy(() => ipc.discardAllChanges($currentRepo!));
    logAppend("info", "discarded all changes (reset --hard + clean -fd)");
  }

  // ---- view mode + sort (mirrors the Commit details panel) ----
  let viewMode = $state<"path" | "tree">("path");
  type SortMode = "asc" | "desc";
  let sortMode = $state<SortMode>("asc");
  function cycleSort() { sortMode = sortMode === "asc" ? "desc" : "asc"; }
  function sortIcon(): string { return sortMode === "asc" ? "↓A" : "↑A"; }
  function sortLabel(): string { return sortMode === "asc" ? "Sort: A→Z" : "Sort: Z→A"; }

  // Sort by full path. The Tree view passes sortMode straight to FileTree
  // so its internal sortedChildren() flips direction too.
  function sortFiles(arr: StatusEntry[]): StatusEntry[] {
    const out = arr.slice();
    out.sort((a, b) => sortMode === "asc"
      ? a.path.localeCompare(b.path)
      : b.path.localeCompare(a.path));
    return out;
  }
  const unstagedSorted = $derived(sortFiles(unstaged));
  const stagedSorted = $derived(sortFiles(staged));
  const conflictedSorted = $derived(sortFiles(conflicted));

  // Glue between FileTree's onAction and our existing helpers.
  function onTreeAction(path: string, action: "stage" | "unstage" | "discard") {
    if (action === "stage") stage(path);
    else if (action === "unstage") unstage(path);
    else discard(path);
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

{#if $opState && ($opState.merging || $opState.rebasing || $opState.cherry_picking || $opState.reverting)}
  <div class="op-banner">
    {#if $opState.merging}<span>⚠ Merging</span>
      <button onclick={() => continueOp("merge")}>Continue</button>
      <button class="danger" onclick={() => abortOp("merge")}>Abort</button>
    {:else if $opState.rebasing}<span>⚠ Rebasing</span>
      <button onclick={() => continueOp("rebase")}>Continue</button>
      <button class="danger" onclick={() => abortOp("rebase")}>Abort</button>
    {:else if $opState.cherry_picking}<span>⚠ Cherry-picking</span>
      <button onclick={() => continueOp("cherry-pick")}>Continue</button>
      <button class="danger" onclick={() => abortOp("cherry-pick")}>Abort</button>
    {:else if $opState.reverting}<span>⚠ Reverting</span>
      <button onclick={() => continueOp("revert")}>Continue</button>
      <button class="danger" onclick={() => abortOp("revert")}>Abort</button>
    {/if}
  </div>
{/if}

<div class="files-scroll">
  <section
    class="block"
    class:collapsed={$layout.unstagedCollapsed}
    style:flex={$layout.unstagedCollapsed
      ? "0 0 auto"
      : ($layout.stagedCollapsed ? "1 1 auto" : "1 1 50%")}
  >
    <header class="block-head">
      <button class="head-toggle" onclick={toggleUnstaged} title={$layout.unstagedCollapsed ? "Expand" : "Collapse"}>
        <span class="chev">{$layout.unstagedCollapsed ? "▶" : "▼"}</span>
        <span class="block-title">Unstaged Files</span>
        <span class="block-count">{unstaged.length + conflicted.length}</span>
      </button>
      <button
        class="primary-link"
        onclick={stageAll}
        disabled={unstaged.length === 0 && conflicted.length === 0}
      >Stage All Changes</button>
    </header>
    {#if !$layout.unstagedCollapsed}
      <div class="list-wrap">
        {#if viewMode === "tree"}
          {#if conflicted.length > 0}
            <FileTree files={conflictedSorted} side="worktree" {sortMode}
              selected={activeFile?.staged === false ? activeFile.file : null}
              onSelect={(p) => showFile(p, false)}
              onAction={onTreeAction} actionLabel="stage" />
          {/if}
          {#if unstaged.length === 0 && conflicted.length === 0}
            <div class="empty">working tree clean</div>
          {:else}
            <FileTree files={unstagedSorted} side="worktree" {sortMode}
              selected={activeFile?.staged === false ? activeFile.file : null}
              onSelect={(p) => showFile(p, false)}
              onAction={onTreeAction} actionLabel="stage" />
          {/if}
        {:else}
          {#if conflicted.length > 0}
            <ul class="flat conflicts">
              {#each conflictedSorted as f (f.path)}
                <li
                  class:active={activeFile?.file === f.path && !activeFile?.staged}
                  oncontextmenu={(e) => onFileContext(e, f, false)}
                >
                  <button class="row" onclick={() => showFile(f.path, false)}>
                    <span class="status conflicted" title="Conflicted">!</span>
                    <span class="path conflicted">{f.path}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          <ul class="flat">
            {#each unstagedSorted as f (f.path)}
              <li
                class:active={activeFile?.file === f.path && !activeFile?.staged}
                oncontextmenu={(e) => onFileContext(e, f, false)}
              >
                <button class="row" onclick={() => showFile(f.path, false)}>
                  <span class="status {f.worktree}" title={statusTitle(f, "worktree")}>{statusChar(f, "worktree")}</span>
                  <span class="path {f.worktree}">{f.path}</span>
                </button>
                <button class="hover-btn stage" onclick={() => stage(f.path)} title="Stage File">Stage File</button>
              </li>
            {:else}
              {#if conflicted.length === 0}
                <li class="empty">working tree clean</li>
              {/if}
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </section>

  <section
    class="block"
    class:collapsed={$layout.stagedCollapsed}
    style:flex={$layout.stagedCollapsed
      ? "0 0 auto"
      : ($layout.unstagedCollapsed ? "1 1 auto" : "1 1 50%")}
  >
    <header class="block-head">
      <button class="head-toggle" onclick={toggleStaged} title={$layout.stagedCollapsed ? "Expand" : "Collapse"}>
        <span class="chev">{$layout.stagedCollapsed ? "▶" : "▼"}</span>
        <span class="block-title">Staged Files</span>
        <span class="block-count">{staged.length}</span>
      </button>
      <button class="primary-link danger" onclick={unstageAll} disabled={staged.length === 0}>Unstage All Changes</button>
    </header>
    {#if !$layout.stagedCollapsed}
      <div class="list-wrap">
        {#if viewMode === "tree"}
          {#if staged.length === 0}
            <div class="empty">no staged changes</div>
          {:else}
            <FileTree files={stagedSorted} side="index" {sortMode}
              selected={activeFile?.staged === true ? activeFile.file : null}
              onSelect={(p) => showFile(p, true)}
              onAction={onTreeAction} actionLabel="unstage" />
          {/if}
        {:else}
          <ul class="flat">
            {#each stagedSorted as f (f.path)}
              <li
                class:active={activeFile?.file === f.path && activeFile?.staged}
                oncontextmenu={(e) => onFileContext(e, f, true)}
              >
                <button class="row" onclick={() => showFile(f.path, true)}>
                  <span class="status {f.index}" title={statusTitle(f, "index")}>{statusChar(f, "index")}</span>
                  <span class="path {f.index}">{f.path}</span>
                </button>
                <button class="hover-btn unstage" onclick={() => unstage(f.path)} title="Unstage File">Unstage File</button>
              </li>
            {:else}
              <li class="empty">no staged changes</li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </section>
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
  <header class="block-head commit-head">
    <button class="tab-btn" class:active={bottomTab === "commit"} onclick={() => bottomTab = "commit"}>Commit</button>
    <button class="tab-btn" class:active={bottomTab === "stash"} onclick={() => bottomTab = "stash"}>Stash</button>
  </header>
  {#if bottomTab === "commit"}
    <div class="commit-body">
      <div class="field">
        <input
          bind:this={summaryEl}
          class="summary"
          placeholder="Commit summary"
          bind:value={summary}
          onkeydown={onSummaryKey}
        />
        <span class="counter" style="color: {summaryColor()}">
          {summary.length}/{SUMMARY_LIMIT}
        </span>
      </div>
      <div class="counter-bar">
        <div class="counter-fill" style="width: {summaryPercent()}%; background: {summaryColor()}"></div>
      </div>
      <textarea
        bind:this={descriptionEl}
        class="description"
        placeholder="Description (optional). Press Enter in summary to jump here."
        bind:value={description}
      ></textarea>
      <label class="amend">
        <input type="checkbox" bind:checked={amend} />
        Amend previous commit
      </label>
      <button
        class="commit-btn"
        onclick={commit}
        disabled={!summary.trim() || (staged.length === 0 && !amend)}
      >
        ✓ Commit{amend ? " (amend)" : ""}{staged.length > 0 ? ` ${staged.length} file${staged.length === 1 ? "" : "s"}` : ""}
      </button>
    </div>
  {:else}
    <div class="commit-body">
      <input
        bind:this={stashTitleEl}
        class="summary"
        placeholder="Stash title"
        bind:value={stashTitle}
      />
      <textarea
        class="description"
        placeholder="Description (optional)."
        bind:value={stashDesc}
      ></textarea>
      <button
        class="commit-btn stash"
        onclick={stashChanges}
        disabled={!$status.length || !stashTitle.trim()}
      >
        ⛶ Stash Changes{$status.length > 0 ? ` (${$status.length} file${$status.length === 1 ? "" : "s"})` : ""}
      </button>
    </div>
  {/if}
</section>

{#if confirmDiscardAll}
  <div class="confirm-backdrop" role="presentation"
    onclick={() => (confirmDiscardAll = false)}>
    <div class="confirm-modal" role="dialog" tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === "Escape") confirmDiscardAll = false; }}>
      <h3>Discard all changes?</h3>
      <p>This will discard all staged and unstaged changes, including new
        untracked files. Are you sure you want to discard all changes?</p>
      <div class="confirm-actions">
        <button class="btn cancel" onclick={() => (confirmDiscardAll = false)}>Cancel</button>
        <button class="btn reset-all" onclick={discardAll}>Reset All</button>
      </div>
    </div>
  </div>
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

  .confirm-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 1500;
  }
  .confirm-modal {
    width: min(440px, 92vw);
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    box-shadow: 0 14px 40px rgba(0,0,0,0.5);
    padding: 18px 20px 14px;
    color: var(--fg);
  }
  .confirm-modal h3 {
    margin: 0 0 8px;
    font-size: 14px; font-weight: 600;
    color: var(--del);
  }
  .confirm-modal p {
    margin: 0 0 16px;
    font-size: 12px; line-height: 1.5;
    color: var(--fg-muted);
  }
  .confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .confirm-actions .btn {
    padding: 6px 14px; border-radius: 4px; cursor: pointer;
    font-size: 12px; font-weight: 600;
  }
  .btn.cancel {
    background: transparent; color: var(--fg);
    border: 1px solid var(--border);
  }
  .btn.cancel:hover { background: var(--border); }
  .btn.reset-all {
    background: var(--del); color: var(--bg);
    border: 1px solid var(--del);
  }
  .btn.reset-all:hover { background: color-mix(in srgb, var(--del) 80%, white); }
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
  .op-banner {
    background: color-mix(in srgb, var(--modified) 18%, transparent); color: var(--modified); padding: 10px 14px;
    border-bottom: 1px solid var(--border-strong);
    display: flex; gap: 8px; align-items: center; font-size: 12px; flex-shrink: 0;
  }
  .op-banner button {
    background: var(--bg); color: var(--fg); border: 1px solid var(--border);
    padding: 3px 10px; border-radius: 3px; cursor: pointer; font-size: 11px;
  }
  .op-banner button.danger:hover { background: color-mix(in srgb, var(--del) 22%, transparent); border-color: var(--del); }

  .files-scroll {
    flex: 1; min-height: 0;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .block {
    border-bottom: 1px solid var(--border-strong);
    min-height: 36px;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .block.collapsed { flex: 0 0 auto !important; }
  .list-wrap { flex: 1; overflow: auto; }
  .block-head {
    display: flex; align-items: center; gap: 8px; padding: 6px 12px;
    background: var(--bg-elev); border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    height: 28px;
  }
  .head-toggle {
    background: transparent; border: 0; color: inherit;
    display: flex; align-items: center; gap: 8px;
    padding: 0; cursor: pointer;
    flex: 1; min-width: 0; text-align: left;
  }
  .head-toggle:hover .chev,
  .head-toggle:hover .block-title { color: var(--fg); }
  .chev {
    color: var(--fg-muted);
    font-size: 9px; width: 14px;
    flex-shrink: 0;
  }
  .block-title {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;
    font-weight: 700; color: var(--fg);
  }
  .block-count {
    background: var(--bg); color: var(--fg-muted);
    padding: 1px 8px; border-radius: 10px; font-size: 11px;
    font-weight: 600; border: 1px solid var(--border);
  }
  /* Same look as the Commit button: translucent fill + 100% border by
     default, fully filled on hover. Keeps every primary action across the
     panel visually consistent. */
  .primary-link {
    margin-left: auto;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    border: 1px solid var(--accent);
    padding: 4px 12px; border-radius: 4px; cursor: pointer;
    font-weight: 600; font-size: 11px;
    transition: background 120ms ease, color 120ms ease;
  }
  .primary-link:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .primary-link:disabled {
    background: transparent; color: var(--fg-muted);
    border-color: var(--border); cursor: not-allowed;
  }
  /* Danger variant — same translucent-default / fill-on-hover pattern as
     the Unstage File hover button below, just at section-header scale.
     `:not(:disabled)` lets the disabled rule above win when there's
     nothing staged so the button visibly greys out instead of staying red. */
  .primary-link.danger:not(:disabled) {
    background: color-mix(in srgb, var(--del) 18%, transparent);
    color: var(--del);
    border-color: var(--del);
  }
  .primary-link.danger:hover:not(:disabled) { background: var(--del); color: var(--bg); }
  .link {
    margin-left: auto; background: transparent; border: 0;
    color: var(--fg-muted); cursor: pointer; font-size: 11px;
  }
  .link:hover:not(:disabled) { color: var(--fg); text-decoration: underline; }
  .link:disabled { opacity: 0.4; cursor: not-allowed; }

  .flat { list-style: none; margin: 0; padding: 0; }
  .flat li {
    display: flex; align-items: center; border-bottom: 1px solid var(--border);
    position: relative;
  }
  .flat li:last-child { border-bottom: 0; }
  .flat li.empty {
    padding: 12px 16px; color: var(--fg-muted);
    font-style: italic; font-size: 11px; justify-content: center;
  }
  .flat li.active { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .flat li.active::before {
    content: ""; width: 3px; align-self: stretch; background: var(--accent);
  }
  .row {
    flex: 1; background: transparent; border: 0; color: var(--fg);
    text-align: left; padding: 4px 12px; cursor: pointer;
    display: flex; gap: 8px; align-items: center;
    font-family: "Cascadia Code", Consolas, monospace; font-size: 11px;
    overflow: hidden; min-width: 0;
    line-height: 18px;
  }
  .row:hover { background: rgba(255,255,255,0.04); }
  /* Status glyph: color-only (no badge box). The shape is the message —
     `+` reads as "added", `−` as "removed", `●` as "edited", `→` as
     "renamed", `!` as "conflict". The full word lives in the title attr. */
  .status {
    display: inline-block; width: 12px;
    text-align: center; font-weight: 700; flex-shrink: 0;
    font-size: 12px; line-height: 14px;
  }
  .status.modified, .path.modified   { color: var(--modified); }
  .status.added,    .path.added,
  .status.untracked, .path.untracked { color: var(--add, var(--accent)); }
  .status.deleted,  .path.deleted    { color: var(--del); }
  .status.renamed,  .path.renamed,
  .status.copied,   .path.copied     { color: var(--renamed); }
  .status.conflicted, .path.conflicted { color: var(--del); font-weight: 700; }
  .path.deleted { text-decoration: line-through; text-decoration-thickness: 1px; }
  .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty {
    padding: 12px 16px; color: var(--fg-muted);
    font-style: italic; font-size: 11px; text-align: center;
  }

  .hover-btn {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: var(--bg-elev);
    color: transparent;
    border: 1px solid transparent;
    padding: 4px 12px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    pointer-events: none;
    opacity: 0;
    transition: opacity 100ms;
  }
  .flat li:hover .hover-btn { opacity: 1; pointer-events: auto; }
  .flat li:hover .hover-btn.stage { color: var(--accent); border-color: var(--accent); }
  .flat li:hover .hover-btn.stage:hover { background: var(--accent); color: var(--bg); }
  .flat li:hover .hover-btn.unstage { color: var(--del); border-color: var(--del); }
  .flat li:hover .hover-btn.unstage:hover { background: var(--del); color: var(--bg); }

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
  .commit-head {
    background: transparent;
    border-bottom: 1px solid var(--border);
    gap: 0;
    padding: 0 8px;
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
  /* Stash variant inherits the .commit-btn translucent-default / full-on-hover
     look but uses a fixed blue tint so it stays distinguishable from Commit
     regardless of the active theme accent. */
  .commit-btn.stash {
    background: color-mix(in srgb, var(--renamed) 16%, transparent);
    color: var(--renamed);
    border-color: var(--renamed);
  }
  .commit-btn.stash:hover:not(:disabled) {
    background: var(--renamed);
    color: var(--bg);
  }
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
