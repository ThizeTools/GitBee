<script lang="ts">
  import {
    currentRepo, graph, stashes, status, remotes,
  } from "$lib/stores/repo";
  import CreateRepoModal from "./CreateRepoModal.svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import Breadcrumb from "./toolbar/Breadcrumb.svelte";
  import ToolbarButton from "./toolbar/ToolbarButton.svelte";
  import PullButton from "./toolbar/PullButton.svelte";
  import { themePickerOpen, paletteOpen } from "$lib/stores/ui";
  import {
    canUndo, canRedo, nextUndoLabel, nextRedoLabel, undoLast, redoLast, pushUndo,
  } from "$lib/stores/history";
  import { branchCreateUndo, checkoutUndo } from "$lib/stores/undoEntries";
  import { checkoutTargetOf } from "$lib/stores/refLookup";
  import { ipc } from "$lib/ipc";
  import { logAppend } from "$lib/stores/logs";
  import { notifySuccess, notifyError, notifyInfo } from "$lib/stores/notifications";
  import { confirmDialog, promptDialog, requireName } from "$lib/stores/dialog";
  import { ghAuth } from "$lib/stores/github";
  import { originGitHubRepo } from "$lib/github/url";
  import { showGraph, showPullRequests } from "$lib/stores/center";
  import { runAction } from "$lib/menus/menuActions";

  async function pull(rebase: boolean) {
    if (!$currentRepo) return;
    const branch = $graph?.head_branch ?? "HEAD";
    const before = $graph?.head_sha;
    const label = rebase ? `Pull (rebase) ${branch}` : `Pull ${branch}`;
    const r = await runAction(label, () => ipc.remotePull($currentRepo!, rebase));
    if (!r.ok) { notifyError("Pull failed", r.error); return; }
    const after = $graph?.head_sha;
    if (before === after) {
      notifyInfo("Already Up-to-Date",
        `No merge necessary. Branch origin/${branch} was not moved.`);
    } else {
      notifySuccess("Pulled Successfully");
    }
  }
  async function fetchAll() {
    if (!$currentRepo) return;
    const r = await runAction("Fetch all remotes", () => ipc.remoteFetch($currentRepo!));
    if (!r.ok) notifyError("Fetch failed", r.error);
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
    const repo = $currentRepo;
    if (!repo) return;
    const name = await promptDialog({ title: "New branch name:", validate: requireName });
    if (!name) return;
    const sha = $graph?.head_sha ?? undefined;
    const previous = checkoutTargetOf($graph?.head_branch ?? null, $graph?.head_sha ?? null);
    const created = await runAction(`Create branch ${name}`, () => ipc.branchCreate(repo, name));
    if (!created.ok) return;
    pushUndo(branchCreateUndo(repo, name, sha));
    const checkedOut = await runAction(`Checkout ${name}`, () => ipc.branchCheckout(repo, name));
    if (checkedOut.ok && previous) {
      pushUndo(checkoutUndo(repo, previous, name, () => ipc.branchCheckout(repo, name)));
    }
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
    const ok = await confirmDialog({ title: "Pop stash@{0}?", confirmLabel: "Pop" });
    if (!ok) return;
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
  // Ctrl+F only opens the bar on the graph view, so the button switches there first.
  // Loaded on demand like the Ctrl+F path in +page.svelte.
  function openGraphSearch() {
    if (!$currentRepo) return;
    showGraph();
    import("$lib/stores/graphSearch").then(({ openSearch }) => openSearch());
  }

  const stashHasItems = $derived($stashes.length > 0);
  const hasChanges = $derived($status.length > 0);
  // No `origin` remote → Push will fail with the cryptic
  // "'origin' does not appear to be a git repository". Swap the button
  // for "Publish to GitHub" which guides the user through creating the
  // remote repo and wiring up origin in one shot.
  const hasOrigin = $derived($remotes.some((r) => r.name === "origin"));
  // The PRs button shows only when origin is a github.com remote and the user is
  // signed in. Spec: docs/specs/github-pull-requests.md.
  const prsAvailable = $derived($ghAuth.authenticated && originGitHubRepo($remotes) !== null);
  const branchLabel = $derived(
    $graph?.head_branch ?? ($graph?.head_sha ? "(detached)" : "—"),
  );
  let publishOpen = $state(false);
  function repoBasename(p: string | null): string {
    if (!p) return "";
    return p.split(/[\\/]/).filter(Boolean).pop() ?? "";
  }
</script>

<header class="topbar">
  <div class="left">
    {#if $currentRepo}
      <Breadcrumb
        repoName={repoBasename($currentRepo)}
        branchName={branchLabel}
        branchTitle={$graph?.head_branch ?? ""}
      />
    {:else}
      <span class="muted">No repository open</span>
    {/if}
  </div>

  <div class="actions">
    <ToolbarButton icon="undo" label="Undo" title={$nextUndoLabel ? `Undo: ${$nextUndoLabel}` : "Undo"} onclick={undoLast} disabled={!$canUndo} />
    <ToolbarButton icon="redo" label="Redo" title={$nextRedoLabel ? `Redo: ${$nextRedoLabel}` : "Redo"} onclick={redoLast} disabled={!$canRedo} />
    <span class="vsep"></span>
    <PullButton
      disabled={!$currentRepo}
      onPull={() => pull(false)}
      onPullRebase={() => pull(true)}
      onFetchAll={fetchAll}
    />
    {#if $currentRepo && !hasOrigin}
      <ToolbarButton icon="cloud" label="Publish" title="Publish this repo to GitHub" onclick={() => publishOpen = true} />
    {:else}
      <ToolbarButton icon="push" label="Push" title="Push" onclick={push} disabled={!$currentRepo} />
    {/if}
    <span class="vsep"></span>
    <ToolbarButton icon="branch" label="Branch" title="New branch" onclick={newBranch} disabled={!$currentRepo} />
    <ToolbarButton icon="stash" label="Stash" title={hasChanges ? "Stash all changes" : "Nothing to stash"} onclick={stash} disabled={!$currentRepo || !hasChanges} />
    <ToolbarButton icon="pop" label="Pop" title="Pop latest stash" onclick={popStash} disabled={!$currentRepo || !stashHasItems} />
    <span class="vsep"></span>
    <ToolbarButton icon="terminal" label="Terminal" title="Open external terminal at repo" onclick={openTerminal} disabled={!$currentRepo} />
    {#if prsAvailable}
      <span class="vsep"></span>
      <ToolbarButton icon="pull-request" label="PRs" title="Pull requests on GitHub" onclick={showPullRequests} />
    {/if}
  </div>

  <div class="right">
    {#if import.meta.env.DEV}
      <button
        type="button"
        class="tool"
        onclick={async () => {
          const ok = await confirmDialog({
            title: "Clear ALL local data?",
            message: "Tabs, layout, themes, recents — gone. Reload required.",
            confirmLabel: "Clear",
            danger: true,
          });
          if (!ok) return;
          try { localStorage.clear(); } catch { /* ignore */ }
          location.reload();
        }}
        title="Dev: clear localStorage + reload (only visible in dev)"
        aria-label="Dev: clear localStorage + reload"
      ><Icon name="trash" size={16} /></button>
    {/if}
    <button
      type="button"
      class="tool"
      onclick={openGraphSearch}
      disabled={!$currentRepo}
      title="Search commits (Ctrl+F)"
      aria-label="Search commits"
    ><Icon name="search" size={16} /></button>
    <button
      type="button"
      class="tool"
      onclick={() => paletteOpen.set(true)}
      title="Command palette (Ctrl+P)"
      aria-label="Command palette"
    ><Icon name="palette" size={16} /></button>
    <button
      type="button"
      class="tool"
      onclick={() => themePickerOpen.set(true)}
      title="Themes"
      aria-label="Themes"
    ><Icon name="theme" size={16} /></button>
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
  /* The 220 px minimum on the left column is a layout width, not a size token. */
  .topbar {
    display: grid;
    grid-template-columns: minmax(220px, max-content) 1fr auto;
    align-items: center;
    gap: var(--sp-8);
    padding: 0 var(--sp-6);
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
    height: var(--h-toolbar);
    flex-shrink: 0;
  }
  .left {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .muted { color: var(--fg-muted); font-style: italic; font-size: var(--fs-md); }

  .actions {
    display: flex;
    justify-content: center;
    gap: 0;
    flex-wrap: nowrap;
    overflow-x: auto;
    align-items: center;
    min-width: 0;
  }
  .actions::-webkit-scrollbar { height: 0; }
  /* 26 px is the divider's height; no size token matches it. */
  .vsep {
    width: 1px;
    height: 26px;
    background: var(--border);
    margin: 0 var(--sp-2);
    flex-shrink: 0;
  }

  .right { display: flex; align-items: center; gap: var(--sp-1); }
  /* 32 x 32 icon-only buttons, the spec's right-side size. */
  .tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: var(--radius);
    color: var(--fg-muted);
    cursor: pointer;
  }
  .tool:hover:not(:disabled) {
    color: var(--fg);
    background: color-mix(in srgb, var(--fg) 6%, transparent);
  }
  .tool:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
