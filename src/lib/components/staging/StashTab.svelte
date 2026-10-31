<script lang="ts">
  import { currentRepo, status, graph, withBusy } from "$lib/stores/repo";
  import { ipc } from "$lib/ipc";
  import { logAppend } from "$lib/stores/logs";
  import Icon from "$lib/icons/Icon.svelte";
  import { composeMessage, stashTitleFor } from "./stagingHelpers";

  // Stash form for the bottom panel's Stash tab. Title and description are
  // bound from the container so typing survives switching to the Commit tab
  // (this component unmounts when the tab changes).
  interface Props {
    title?: string;
    description?: string;
  }
  let { title = $bindable(""), description = $bindable("") }: Props = $props();

  let stashTitleEl: HTMLInputElement | null = $state(null);

  // Auto-fill stash title (#11/#12) — "WIP on <branch>: <subject>"
  $effect(() => {
    if (title.trim().length > 0) return;
    const branch = $graph?.head_branch ?? "HEAD";
    const subject = $graph?.head_sha
      ? ($graph.nodes.find((n) => n.sha === $graph!.head_sha)?.subject ?? "")
      : "";
    title = stashTitleFor(branch, subject);
  });

  async function stashChanges() {
    if (!$currentRepo) return;
    const msg = composeMessage(title, description);
    const ok = await withBusy(() => ipc.stashCreate($currentRepo!, msg, true));
    if (ok !== null) {
      title = "";
      description = "";
      logAppend("info", `stashed: ${msg.split("\n")[0]}`);
    }
  }
</script>

<div class="commit-body">
  <input
    bind:this={stashTitleEl}
    class="summary"
    placeholder="Stash title"
    bind:value={title}
  />
  <textarea
    class="description"
    placeholder="Description (optional)."
    bind:value={description}
  ></textarea>
  <button
    class="commit-btn stash"
    onclick={stashChanges}
    disabled={!$status.length || !title.trim()}
  >
    <Icon name="stash" size={16} />
    <span>Stash Changes{$status.length > 0 ? ` (${$status.length} file${$status.length === 1 ? "" : "s"})` : ""}</span>
  </button>
</div>

<style>
  /* Mirrors the Commit form in CommitBox.svelte: scoped styles cannot cross
     component boundaries, so the shared primitives are repeated here. */
  .commit-body {
    padding: var(--sp-6) var(--sp-8);
    display: flex; flex-direction: column; gap: var(--sp-4);
    flex: 1;
    /* never scroll — the description shrinks (flex:1 with min-height) */
    overflow: hidden;
    min-height: 0;
  }
  .summary {
    width: 100%; height: 32px;
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 0 var(--sp-5);
    font-size: var(--fs-lg); font-weight: 500;
  }
  .summary:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .description {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-4) var(--sp-5); font: inherit; font-size: var(--fs-md);
    resize: none;
    flex: 1;
    min-height: 80px;
  }
  .description:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  /* Default: translucent fill (low opacity) with the accent border at 100%
     so the button reads as a primary action without dominating the panel.
     Hover: fill goes to 100% and content swaps to the bg for contrast. */
  .commit-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-4);
    width: 100%; height: 36px; flex-shrink: 0;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius); cursor: pointer;
    font-weight: 700; font-size: var(--fs-md);
    transition: background 120ms ease, color 120ms ease;
  }
  .commit-btn:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .commit-btn:disabled {
    background: transparent; color: var(--fg-muted);
    border-color: var(--border); cursor: not-allowed;
  }
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
</style>
