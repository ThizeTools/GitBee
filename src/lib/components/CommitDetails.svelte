<script lang="ts">
  import { graph, selectedSha, currentRepo, refsByCommit, withBusy } from "$lib/stores/repo";
  import { checkoutShaAutoStash } from "$lib/stores/graphscroll";
  import { notifyError } from "$lib/stores/notifications";
  import { ipc } from "$lib/ipc";
  import DiffViewer from "./DiffViewer.svelte";
  import type { FileDiff, GraphNode } from "$lib/ipc";

  let diffs = $state<FileDiff[]>([]);
  let loading = $state(false);

  const node = $derived.by<GraphNode | null>(() => {
    if (!$selectedSha || !$graph) return null;
    return $graph.nodes.find((n) => n.sha === $selectedSha) ?? null;
  });

  $effect(() => {
    if ($selectedSha && $currentRepo) loadDiff($currentRepo, $selectedSha);
    else diffs = [];
  });

  async function loadDiff(repo: string, sha: string) {
    loading = true;
    try {
      diffs = await ipc.diffCommit(repo, sha);
    } catch (e) {
      diffs = [];
      console.error(e);
    } finally {
      loading = false;
    }
  }

  async function cherryPick() {
    if (!$selectedSha || !$currentRepo) return;
    if (!confirm(`Cherry-pick ${$selectedSha.slice(0,7)}?`)) return;
    await withBusy(() => ipc.cherryPick($currentRepo!, $selectedSha!));
  }
  async function revert() {
    if (!$selectedSha || !$currentRepo) return;
    if (!confirm(`Revert ${$selectedSha.slice(0,7)}?`)) return;
    await withBusy(() => ipc.revert($currentRepo!, $selectedSha!, true));
  }
  async function resetTo(mode: "soft" | "mixed" | "hard") {
    if (!$selectedSha || !$currentRepo) return;
    if (!confirm(`Reset --${mode} to ${$selectedSha.slice(0,7)}?`)) return;
    await withBusy(() => ipc.reset($currentRepo!, $selectedSha!, mode));
  }
  async function checkoutDetached() {
    if (!$selectedSha || !$currentRepo) return;
    const r = await checkoutShaAutoStash($currentRepo, $selectedSha);
    if (r !== true) notifyError("Checkout failed", `${$selectedSha.slice(0, 7)}: ${r}`);
  }
  async function createTag() {
    if (!$selectedSha || !$currentRepo) return;
    const name = prompt("Tag name:");
    if (!name) return;
    const message = prompt("Message (empty for lightweight):") || undefined;
    await withBusy(() => ipc.tagCreate($currentRepo!, name, $selectedSha!, message));
  }
  async function createBranch() {
    if (!$selectedSha || !$currentRepo) return;
    const name = prompt("New branch name:");
    if (!name) return;
    await withBusy(() => ipc.branchCreate($currentRepo!, name, $selectedSha!));
  }

  function fmtTs(ts: number): string {
    return new Date(ts * 1000).toLocaleString();
  }
</script>

<div class="details">
  {#if !node}
    <div class="empty">Select a commit to see details.</div>
  {:else}
    <header class="head">
      <div class="subject">{node.subject}</div>
      <div class="sha-line">
        <span class="sha">{node.sha}</span>
        {#each $refsByCommit.get(node.sha) ?? [] as r (r.name)}
          <span class="ref" class:branch={r.kind === "localbranch"} class:remote={r.kind === "remotebranch"} class:tag={r.kind === "tag"}>{r.name}</span>
        {/each}
      </div>
      <div class="author-line">
        <span>{node.author_name} &lt;{node.author_email}&gt;</span>
        <span class="ts">{fmtTs(node.timestamp)}</span>
      </div>
      {#if node.parents.length > 0}
        <div class="parents">parents: {node.parents.map(p => p.slice(0,7)).join(" + ")}</div>
      {/if}
      <div class="actions">
        <button onclick={cherryPick}>Cherry-pick</button>
        <button onclick={revert}>Revert</button>
        <button onclick={createBranch}>+ Branch</button>
        <button onclick={createTag}>+ Tag</button>
        <button onclick={checkoutDetached}>Checkout</button>
        <span class="divider"></span>
        <span class="reset-group">
          Reset:
          <button onclick={() => resetTo("soft")}>soft</button>
          <button onclick={() => resetTo("mixed")}>mixed</button>
          <button onclick={() => resetTo("hard")} class="danger">hard</button>
        </span>
      </div>
    </header>

    <div class="diff-area">
      {#if loading}
        <div class="empty">Loading diff…</div>
      {:else if diffs.length === 0}
        <div class="empty">No changes (or empty commit).</div>
      {:else}
        <DiffViewer diffs={diffs} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .details {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .empty {
    color: var(--fg-muted);
    padding: 24px;
    text-align: center;
    font-style: italic;
  }
  .head {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev);
  }
  .subject { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
  .sha-line {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 11px;
    color: var(--fg-muted);
    margin-bottom: 4px;
  }
  .sha { color: var(--sha); }
  .ref {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 9px;
    border: 1px solid;
    background: var(--bg);
  }
  .ref.branch { color: var(--accent); border-color: var(--accent); }
  .ref.remote { color: var(--remote); border-color: var(--remote); }
  .ref.tag    { color: var(--modified); border-color: var(--modified); }
  .author-line {
    font-size: 12px;
    color: var(--fg-muted);
    display: flex;
    gap: 12px;
  }
  .parents {
    font-size: 11px;
    color: var(--fg-muted);
    font-family: "Cascadia Code", Consolas, monospace;
    margin-top: 4px;
  }
  .actions {
    margin-top: 10px;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .actions button {
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: 3px 9px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
  }
  .actions button:hover { background: var(--border); }
  .actions button.danger:hover { background: color-mix(in srgb, var(--del) 22%, transparent); border-color: var(--del); }
  .divider {
    width: 1px;
    background: var(--border);
    height: 18px;
    margin: 0 4px;
  }
  .reset-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--fg-muted);
  }
  .diff-area { flex: 1; overflow: hidden; }
</style>
