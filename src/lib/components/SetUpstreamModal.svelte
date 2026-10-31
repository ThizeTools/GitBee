<script lang="ts">
  // Sets the upstream tracking branch for `branch`. Defaults the remote to
  // `origin` (or the only remote if there's exactly one) and the remote
  // branch name to `branch` itself, since 99% of the time that's what
  // users want. Power user can override either, or unset upstream by
  // picking the special "(none)" remote.
  import { ipc } from "$lib/ipc";
  import { withBusy, currentRepo, remotes } from "$lib/stores/repo";
  import { notifySuccess, notifyError } from "$lib/stores/notifications";
  import { closeModal } from "$lib/stores/modals";
  import Icon from "$lib/icons/Icon.svelte";
  import { get } from "svelte/store";
  import { untrack } from "svelte";

  interface Props { branch: string; }
  let { branch }: Props = $props();

  const remoteList = $derived($remotes.map((r) => r.name));
  const defaultRemote = $derived(
    remoteList.includes("origin") ? "origin" : (remoteList[0] ?? ""),
  );

  let remote = $state<string>("");
  let remoteBranch = $state<string>(untrack(() => branch));
  let busy = $state(false);

  // Lazy-initialize remote once `defaultRemote` is computed (remotes load
  // async). Can't use `let remote = $state(defaultRemote)` because
  // `$derived` isn't available at initialization time.
  $effect(() => {
    if (!remote && defaultRemote) remote = defaultRemote;
  });

  const disabled = $derived(busy);

  async function submit() {
    if (disabled) return;
    const r = get(currentRepo);
    if (!r) return;
    busy = true;
    const res = await withBusy(() =>
      ipc.branchSetUpstream(
        r,
        branch,
        remote || undefined,
        remote ? remoteBranch.trim() || branch : undefined,
      ),
    );
    busy = false;
    if (res === null) { notifyError("Set upstream failed", branch); return; }
    if (remote) {
      notifySuccess("Upstream set", `${branch} → ${remote}/${remoteBranch || branch}`);
    } else {
      notifySuccess("Upstream cleared", branch);
    }
    closeModal();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); closeModal(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); submit(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" role="presentation" onclick={closeModal}>
  <div class="modal" role="dialog" aria-label="Set upstream" tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}>
    <header class="modal-head">
      <span class="title">Set upstream for <code>{branch}</code></span>
      <button class="x" onclick={closeModal} title="Close" aria-label="Close">
        <Icon name="close" size={16} />
      </button>
    </header>

    <div class="body">
      <div class="field">
        <label for="remote">Remote</label>
        <select id="remote" bind:value={remote}>
          <option value="">(none — clear upstream)</option>
          {#each remoteList as r}
            <option value={r}>{r}</option>
          {/each}
        </select>
      </div>
      {#if remote}
        <div class="field">
          <label for="rbranch">Remote branch</label>
          <input id="rbranch" bind:value={remoteBranch} placeholder={branch} />
          <div class="hint">Will run: <code>git branch --set-upstream-to={remote}/{remoteBranch || branch} {branch}</code></div>
        </div>
      {:else}
        <div class="hint">Will run: <code>git branch --unset-upstream {branch}</code></div>
      {/if}
    </div>

    <footer class="modal-foot">
      <button class="ghost" onclick={closeModal}>Cancel</button>
      <button class="primary" onclick={submit} disabled={disabled}>
        {busy ? "Applying…" : (remote ? "Set upstream" : "Clear upstream")}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 1500;
  }
  .modal {
    width: min(520px, 92vw);
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: 0 18px 50px rgba(0,0,0,0.6);
    display: flex; flex-direction: column;
    color: var(--fg);
  }
  /* Dialog header: 10 px 20 px padding, bottom border, --fs-lg title. */
  .modal-head {
    display: flex; align-items: center;
    padding: var(--sp-5) var(--sp-20);
    border-bottom: 1px solid var(--border-strong);
  }
  .title { font-weight: 600; font-size: var(--fs-lg); flex: 1; }
  .title code { color: var(--accent); font-family: "Cascadia Code", Consolas, monospace; }
  .x {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px;
    background: transparent; border: 0; border-radius: var(--radius);
    color: var(--fg-muted); cursor: pointer;
  }
  .x:hover { color: var(--fg); }

  /* Dialog body: 15 px 20 px padding. */
  .body {
    padding: var(--sp-15) var(--sp-20);
    display: flex; flex-direction: column; gap: var(--sp-6);
  }
  .field { display: flex; flex-direction: column; gap: var(--sp-3); }
  .field label {
    font-size: var(--fs-sm); color: var(--fg-muted);
    text-transform: uppercase; letter-spacing: 0.4px;
    font-weight: 600;
  }
  .field input, .field select {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-3) var(--sp-5); font-size: var(--fs-md);
  }
  .field input:focus, .field select:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .hint { font-size: var(--fs-sm); color: var(--fg-muted); }
  .hint code { font-family: "Cascadia Code", Consolas, monospace; color: var(--fg); }

  /* Footer: right-aligned, 28 px buttons. */
  .modal-foot {
    display: flex; justify-content: flex-end; gap: var(--sp-4);
    padding: var(--sp-5) var(--sp-20);
    border-top: 1px solid var(--border-strong);
  }
  .ghost {
    height: 28px;
    display: inline-flex; align-items: center;
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 0 var(--sp-6); cursor: pointer; font-size: var(--fs-md);
  }
  .ghost:hover { border-color: var(--fg-muted); }
  .primary {
    height: 28px;
    display: inline-flex; align-items: center;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    padding: 0 var(--sp-8);
    cursor: pointer;
    font-weight: 600; font-size: var(--fs-md);
  }
  .primary:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .primary:disabled { color: var(--fg-muted); border-color: var(--border); cursor: not-allowed; }
</style>
