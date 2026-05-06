<script lang="ts">
  import {
    currentRepo, graph, stashes, status, remotes, withBusy,
    refreshActive, busy, errorMessage,
  } from "$lib/stores/repo";
  import CreateRepoModal from "./CreateRepoModal.svelte";
  import { themePickerOpen, paletteOpen } from "$lib/stores/ui";
  import { undoStack, redoStack, moveToRedo, moveFromRedo } from "$lib/stores/history";
  import { ipc } from "$lib/ipc";
  import { logAppend, logAction } from "$lib/stores/logs";
  import { notifySuccess, notifyError, notifyInfo } from "$lib/stores/notifications";

  // Wrap an async git action: show busy spinner, log start/finish/fail,
  // refresh repo state on success, and surface real error messages to the
  // caller. Replaces our older withBusy in places where we want both logs
  // and the actual error string.
  async function runAction<T>(label: string, fn: () => Promise<T>) {
    busy.set(true);
    errorMessage.set(null);
    try {
      const r = await logAction(label, fn);
      if (r.ok) await refreshActive();
      else errorMessage.set(r.error);
      return r;
    } finally {
      busy.set(false);
    }
  }

  // Undo: soft-reset to HEAD@{1}, push current HEAD info onto redoStack.
  // Redo: re-create a commit using the saved message and the (still staged) tree.
  async function undo() {
    if (!$currentRepo) return;
    const head = $graph?.head_sha ?? null;
    if (!head) return;
    if (!confirm("Undo last commit?\n(soft reset to HEAD@{1} — keeps your changes staged.)")) return;
    const node = $graph?.nodes.find((n) => n.sha === head);
    const msg = node?.subject ?? "previous commit";
    const r = await runAction(`Undo last commit ${head.slice(0, 7)}`,
      () => ipc.undoLastCommit($currentRepo!));
    if (r.ok) {
      moveToRedo();
      redoStack.update((s) => [...s, { kind: "commit", sha: head, message: msg }]);
      notifySuccess("Undid last commit", msg);
    } else {
      notifyError("Undo failed", r.error);
    }
  }

  async function redo() {
    if (!$currentRepo) return;
    const top = moveFromRedo();
    if (!top) return;
    const r = await runAction(`Redo commit "${top.message}"`,
      () => ipc.commitCreate($currentRepo!, top.message, false, false));
    if (r.ok) {
      notifySuccess("Redid commit", top.message);
    } else {
      redoStack.update((s) => [...s, top]);
      notifyError("Redo failed", r.error);
    }
  }

  async function pull() {
    if (!$currentRepo) return;
    const branch = $graph?.head_branch ?? "HEAD";
    const before = $graph?.head_sha;
    const r = await runAction(`Pull ${branch}`, () => ipc.remotePull($currentRepo!, false));
    if (!r.ok) { notifyError("Pull failed", r.error); return; }
    const after = $graph?.head_sha;
    if (before === after) {
      notifyInfo("Already Up-to-Date",
        `No merge necessary. Branch origin/${branch} was not moved.`);
    } else {
      notifySuccess("Pulled Successfully");
    }
  }
  async function push() {
    if (!$currentRepo) return;
    const branch = $graph?.head_branch ?? undefined;
    const label = branch ? `Push ${branch}` : "Push";
    const r = await runAction(label, () => ipc.remotePush($currentRepo!, "origin", branch, false));
    if (!r.ok) notifyError("Push failed", r.error);
    else notifySuccess("Pushed Successfully", branch ? `${branch} → origin` : undefined);
  }
  async function newBranch() {
    if (!$currentRepo) return;
    const name = prompt("New branch name:");
    if (!name) return;
    await withBusy(() => ipc.branchCreate($currentRepo!, name));
    await withBusy(() => ipc.branchCheckout($currentRepo!, name));
  }
  async function stash() {
    if (!$currentRepo) return;
    const branch = $graph?.head_branch ?? "HEAD";
    const subject = $graph?.head_sha
      ? ($graph.nodes.find((n) => n.sha === $graph!.head_sha)?.subject ?? "")
      : "";
    const message = subject ? `WIP on ${branch}: ${subject}` : `WIP on ${branch}`;
    const r = await runAction(`Stash all changes "${message}"`,
      () => ipc.stashCreate($currentRepo!, message, true));
    if (r.ok) notifySuccess("Stashed", message);
    else notifyError("Stash failed", r.error);
  }
  async function popStash() {
    if (!$currentRepo) return;
    if (!confirm("Pop stash@{0}?")) return;
    const r = await runAction("Pop stash@{0}",
      () => ipc.stashPop($currentRepo!, 0));
    if (r.ok) notifySuccess("Stash popped", "stash@{0}");
    else notifyError("Pop failed", r.error);
  }
  // #12 — open the OS terminal (PowerShell on Windows) at the repo path.
  async function openTerminal() {
    if (!$currentRepo) return;
    try { await ipc.openTerminal($currentRepo); }
    catch (e) { logAppend("error", `terminal: ${e}`); }
  }

  const undoEnabled = $derived(!!$currentRepo && !!$graph?.head_sha);
  const redoEnabled = $derived(!!$currentRepo && $redoStack.length > 0);
  const stashHasItems = $derived($stashes.length > 0);
  const hasChanges = $derived($status.length > 0);
  // No `origin` remote → Push will fail with the cryptic
  // "'origin' does not appear to be a git repository". Swap the button
  // for "Publish to GitHub" which guides the user through creating the
  // remote repo and wiring up origin in one shot.
  const hasOrigin = $derived($remotes.some((r) => r.name === "origin"));
  let publishOpen = $state(false);
  function repoBasename(p: string | null): string {
    if (!p) return "";
    return p.split(/[\\/]/).filter(Boolean).pop() ?? "";
  }
</script>

<header class="topbar">
  <div class="left">
    {#if $currentRepo}
      <span class="label">repository</span>
      <span class="repo">{$currentRepo.split(/[\\/]/).filter(Boolean).pop()}</span>
      <span class="sep"></span>
      <span class="label">branch</span>
      <span class="branch" title={$graph?.head_branch ?? ""}>
        {$graph?.head_branch ?? ($graph?.head_sha ? "(detached)" : "—")}
      </span>
    {:else}
      <span class="muted">No repository open</span>
    {/if}
  </div>

  <div class="actions">
    <button class="icon-btn" title="Undo last commit" onclick={undo} disabled={!undoEnabled}>
      <span class="ico">↶</span><span class="lbl">Undo</span>
    </button>
    <button class="icon-btn" title="Redo (recommit last undone)" onclick={redo} disabled={!redoEnabled}>
      <span class="ico">↷</span><span class="lbl">Redo</span>
    </button>
    <span class="vsep"></span>
    <button class="icon-btn" title="Pull" onclick={pull} disabled={!$currentRepo}>
      <span class="ico">↓</span><span class="lbl">Pull</span>
    </button>
    {#if $currentRepo && !hasOrigin}
      <button class="icon-btn" title="Publish this repo to GitHub" onclick={() => publishOpen = true}>
        <span class="ico">⇪</span><span class="lbl">Publish</span>
      </button>
    {:else}
      <button class="icon-btn" title="Push" onclick={push} disabled={!$currentRepo}>
        <span class="ico">↑</span><span class="lbl">Push</span>
      </button>
    {/if}
    <span class="vsep"></span>
    <button class="icon-btn" title="New branch" onclick={newBranch} disabled={!$currentRepo}>
      <span class="ico">⎇</span><span class="lbl">Branch</span>
    </button>
    <button class="icon-btn" title={hasChanges ? "Stash all changes" : "Nothing to stash"} onclick={stash} disabled={!$currentRepo || !hasChanges}>
      <span class="ico">⛶</span><span class="lbl">Stash</span>
    </button>
    <button class="icon-btn" title="Pop latest stash" onclick={popStash} disabled={!$currentRepo || !stashHasItems}>
      <span class="ico">⤴</span><span class="lbl">Pop</span>
    </button>
    <span class="vsep"></span>
    <button class="icon-btn" title="Open external terminal at repo" onclick={openTerminal} disabled={!$currentRepo}>
      <span class="ico">▶_</span><span class="lbl">Terminal</span>
    </button>
  </div>

  <div class="right">
    {#if import.meta.env.DEV}
      <button
        class="ghost dev"
        onclick={() => {
          if (!confirm("Clear ALL local data? Tabs, layout, themes, recents — gone. Reload required.")) return;
          try { localStorage.clear(); } catch { /* ignore */ }
          location.reload();
        }}
        title="Dev: clear localStorage + reload (only visible in dev)"
      >🧹</button>
    {/if}
    <button
      class="ghost"
      onclick={() => themePickerOpen.set(true)}
      title="Themes"
    >🎨</button>
    <button class="ghost" onclick={() => paletteOpen.set(true)} title="Command palette (Ctrl+P)">⌘</button>
  </div>
</header>

{#if publishOpen && $currentRepo}
  <CreateRepoModal
    mode="publish-existing"
    repoPath={$currentRepo}
    initialName={repoBasename($currentRepo)}
    onClose={() => publishOpen = false}
  />
{/if}

<style>
  .topbar {
    display: grid;
    grid-template-columns: minmax(220px, max-content) 1fr auto;
    align-items: center;
    gap: 16px;
    padding: 4px 12px;
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
    height: 40px;
    flex-shrink: 0;
  }
  .left {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .label { font-size: 10px; text-transform: uppercase; color: var(--fg-muted); }
  .repo { color: var(--fg); font-weight: 500; font-size: 13px; }
  .branch { color: var(--accent); font-weight: 500; font-size: 13px; }
  .sep { width: 1px; height: 14px; background: var(--border); margin: 0 4px; }
  .muted { color: var(--fg-muted); font-style: italic; }

  .actions { display: flex; justify-content: center; gap: 4px; flex-wrap: nowrap; overflow-x: auto; align-items: center; }
  .actions::-webkit-scrollbar { height: 0; }
  .vsep { width: 1px; height: 26px; background: var(--border); margin: 0 4px; }
  .icon-btn {
    display: flex; flex-direction: row; align-items: center; justify-content: center;
    gap: 6px; background: transparent; color: var(--fg); border: 0;
    padding: 3px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;
    min-width: 0; height: 28px;
  }
  .icon-btn .ico { font-size: 13px; line-height: 1; color: var(--fg-muted); }
  .icon-btn .lbl { color: var(--fg-muted); text-transform: none; font-size: 11px; }
  .icon-btn:hover:not(:disabled) { background: rgba(255,255,255,0.06); }
  .icon-btn:hover:not(:disabled) .ico, .icon-btn:hover:not(:disabled) .lbl { color: var(--fg); }
  .icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  /* .icon-btn.active style removed — terminal is now external (#12). */

  .right { display: flex; gap: 4px; }
  .ghost {
    background: transparent; border: 1px solid var(--border); color: var(--fg-muted);
    padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 11px;
  }
  .ghost:hover { color: var(--fg); background: var(--border); }
</style>
