<script lang="ts">
  // "New pull request" form. Head defaults to the checked-out branch and base
  // to the repo's default branch. GitHub only sees branches that exist on
  // origin, so the head is checked there first, and "Push first" pushes it
  // before the create is allowed. Spec: docs/specs/github-pull-requests.md.
  import { untrack } from "svelte";
  import { ipc } from "$lib/ipc";
  import { graph, localBranches, remoteBranches } from "$lib/stores/repo";
  import { logAction } from "$lib/stores/logs";
  import { notifySuccess } from "$lib/stores/notifications";
  import { newPullError } from "$lib/github/pulls";
  import { signInIfScopeError } from "$lib/github/githubErrors";
  import type { NewPull, PullRow } from "$lib/github/pullTypes";

  interface Props {
    owner: string;
    repo: string;
    repoPath: string;
    defaultBase: string;
    onCreated: (pr: PullRow) => void;
    onClose: () => void;
  }
  let { owner, repo, repoPath, defaultBase, onCreated, onClose }: Props = $props();

  let head = $state($graph?.head_branch ?? "");
  let base = $state(untrack(() => defaultBase));
  let title = $state(headSubject());
  let body = $state("");
  let draft = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  // null while checking; true when the head exists on origin.
  let onRemote = $state<boolean | null>(null);
  let checkSeq = 0;

  const headOptions = $derived($localBranches.map((r) => r.name));
  const baseOptions = $derived($remoteBranches.map((r) => r.name.replace(/^origin\//, "")));
  const problem = $derived(newPullError({ title, head, base }));
  const canSubmit = $derived(problem === null && onRemote === true && !busy);

  function headSubject(): string {
    const g = $graph;
    if (!g?.head_sha) return "";
    return g.nodes.find((n) => n.sha === g.head_sha)?.subject ?? "";
  }

  $effect(() => {
    void checkRemote(head);
  });

  async function checkRemote(branch: string): Promise<void> {
    const seq = ++checkSeq;
    onRemote = null;
    if (branch.trim() === "") {
      onRemote = false;
      return;
    }
    try {
      const yes = await ipc.githubBranchOnRemote(owner, repo, branch);
      if (seq === checkSeq) onRemote = yes;
    } catch (e) {
      if (seq === checkSeq) error = signInIfScopeError(e) ?? String(e);
    }
  }

  async function pushHead(): Promise<void> {
    const r = await logAction(`Push ${head}`, () =>
      ipc.remotePush(repoPath, "origin", head, false),
    );
    if (!r.ok) {
      error = r.error;
      return;
    }
    await checkRemote(head);
  }

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    busy = true;
    error = null;
    const req: NewPull = { title: title.trim(), head: head.trim(), base: base.trim(), body, draft };
    const r = await logAction(`Create pull request ${req.head} → ${req.base}`, () =>
      ipc.githubCreatePull(owner, repo, req),
    );
    busy = false;
    if (!r.ok) {
      error = signInIfScopeError(r.error) ?? r.error;
      return;
    }
    notifySuccess(`Opened #${r.value.number}`, req.title);
    onCreated(r.value);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" role="presentation" onclick={onClose}>
  <div class="modal" role="dialog" aria-label="New pull request" tabindex="-1"
    onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
    <header>
      <span class="title">New pull request</span>
      <button class="x" onclick={onClose} title="Close">×</button>
    </header>

    <div class="body">
      <div class="row">
        <label for="pr-head">Head</label>
        <select id="pr-head" bind:value={head}>
          {#each headOptions as b}<option value={b}>{b}</option>{/each}
        </select>
        <span class="arrow">→</span>
        <label for="pr-base">Base</label>
        <input id="pr-base" list="pr-base-options" bind:value={base} />
        <datalist id="pr-base-options">
          {#each baseOptions as b}<option value={b}></option>{/each}
        </datalist>
      </div>

      {#if onRemote === null && head.trim() !== ""}
        <div class="hint">Checking that {head} exists on origin…</div>
      {:else if onRemote === false}
        <div class="notice">
          <span>{head.trim() === "" ? "Choose a head branch." : `${head} is not on GitHub yet.`}</span>
          {#if head.trim() !== ""}
            <button onclick={pushHead} disabled={busy}>Push first</button>
          {/if}
        </div>
      {/if}

      <input class="title-input" placeholder="Title" bind:value={title} />
      <textarea rows="7" placeholder="Description (plain text)" bind:value={body}></textarea>
      <label class="draft"><input type="checkbox" bind:checked={draft} /> Create as draft</label>
      {#if problem}<div class="hint">{problem}</div>{/if}
      {#if error}<div class="error">{error}</div>{/if}
    </div>

    <footer>
      <button class="ghost" onclick={onClose} disabled={busy}>Cancel</button>
      <span class="grow"></span>
      <button class="primary" onclick={submit} disabled={!canSubmit}>
        {busy ? "Creating…" : "Create pull request"}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center; z-index: 1500;
  }
  .modal {
    width: min(620px, 94vw); max-height: 88vh; background: var(--bg-elev);
    border: 1px solid var(--border-strong); border-radius: 8px;
    box-shadow: 0 18px 50px rgba(0,0,0,0.6); display: flex; flex-direction: column; color: var(--fg);
  }
  header { display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border-strong); }
  .title { font-weight: 700; font-size: 13px; flex: 1; }
  .x { background: transparent; border: 0; color: var(--fg-muted); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
  .x:hover { color: var(--fg); }
  .body { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
  .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; }
  .row label { color: var(--fg-muted); }
  .row select, .row input, .title-input, textarea {
    background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 4px;
    padding: 5px 8px; font-size: 12px; font-family: inherit;
  }
  .row input, .row select { min-width: 0; }
  .arrow { color: var(--fg-muted); }
  .title-input { width: 100%; box-sizing: border-box; }
  textarea { resize: vertical; min-height: 110px; width: 100%; box-sizing: border-box; }
  .draft { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-muted); }
  .hint { font-size: 11px; color: var(--fg-muted); }
  .error { font-size: 11px; color: #f85149; }
  .notice {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    font-size: 12px; color: #d29922; background: rgba(210, 153, 34, 0.08);
    border: 1px solid rgba(210, 153, 34, 0.4); border-radius: 3px; padding: 6px 8px;
  }
  footer { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--border-strong); }
  .grow { flex: 1; }
  button {
    background: transparent; border: 1px solid var(--border-strong); color: var(--fg);
    padding: 5px 12px; border-radius: 3px; cursor: pointer; font-size: 12px;
  }
  button:hover:not(:disabled) { background: var(--border); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  button.ghost { border-color: transparent; color: var(--fg-muted); }
</style>
