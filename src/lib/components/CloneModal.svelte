<script lang="ts">
  // GitKraken-style clone dialog. Lives in a modal overlay so it never
  // distorts the surrounding NewTabPage layout. Source list on the left,
  // selected source's form on the right, single Clone action at bottom.
  import { ipc, type GhRepo } from "$lib/ipc";
  import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
  import { logAppend } from "$lib/stores/logs";
  import { ghAuth, bootGithubAuth } from "$lib/stores/github";
  import { openRepo } from "$lib/stores/repo";
  import {
    gitProgress, pickProgressForRepo, progressFraction, progressLabel,
  } from "$lib/stores/gitProgress";
  import { checkCloneForm, DEFAULT_CLONE_DEPTH } from "$lib/clone/cloneOptions";
  import GitHubLoginPanel from "./GitHubLoginPanel.svelte";
  import GitHubRepoPicker from "./GitHubRepoPicker.svelte";
  import { onMount } from "svelte";

  interface Props { onClose: () => void; }
  let { onClose }: Props = $props();

  type Source = "url" | "github";
  let source = $state<Source>("url");

  let cloneUrl = $state("");
  let dest = $state("");
  let busy = $state(false);
  let ghPicked = $state<GhRepo | null>(null);

  // Shallow and single-branch apply to the URL source only; github_clone takes none.
  let shallow = $state(false);
  // Text, not a number: the field is validated as typed (see cloneOptions.ts).
  let depthText = $state(String(DEFAULT_CLONE_DEPTH));
  let singleBranch = $state(false);
  let branchText = $state("");
  const cloneCheck = $derived(checkCloneForm({ shallow, depthText, singleBranch, branchText }));

  // The clone reports progress under its target folder, which the dialog does
  // not know yet, so it shows the clone entry while this dialog is busy.
  const progress = $derived(busy ? pickProgressForRepo($gitProgress, null) : null);
  const fraction = $derived(progress ? progressFraction(progress) : null);

  onMount(() => {
    bootGithubAuth();
    // Restore last-used destination so repeated clones default to the
    // same folder. Empty string from backend = never set.
    ipc.cloneLastDest().then((d) => { if (d && !dest) dest = d; }).catch(() => {});
  });

  async function browseDest() {
    const picked = await openFolderDialog({ directory: true, multiple: false, title: "Clone destination" });
    if (typeof picked === "string") dest = picked;
  }

  async function doClone() {
    if (!dest.trim()) return;
    const url = source === "github"
      ? (ghPicked?.clone_url ?? "")
      : cloneUrl.trim();
    if (!url) return;
    if (source === "url" && cloneCheck.error) return;
    try {
      busy = true;
      const path = source === "github"
        ? await ipc.githubClone(url, dest.trim())
        : await ipc.repoClone(url, dest.trim(), cloneCheck.options);
      logAppend("info", `cloned ${url} into ${path}`);
      // Persist destination so the next clone defaults to the same parent.
      ipc.cloneSaveDest(dest.trim()).catch(() => {});
      await openRepo(path);
      onClose();
    } catch (e) {
      logAppend("error", `clone failed: ${e}`);
    } finally { busy = false; }
  }

  const cloneDisabled = $derived(
    busy || !dest.trim() || (source === "url" ? !cloneUrl.trim() || cloneCheck.error !== null : !ghPicked),
  );

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" role="presentation" onclick={onClose}>
  <div class="modal" role="dialog" aria-label="Clone a Repository" tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}>
    <header class="modal-head">
      <span class="title">Clone a Repository</span>
      <button class="x" onclick={onClose} title="Close">×</button>
    </header>

    <div class="body">
      <nav class="sources">
        <button class="src" class:active={source === "url"} onclick={() => source = "url"}>
          <span class="ico">⌘</span>
          <span>Clone with URL</span>
        </button>
        <button class="src" class:active={source === "github"} onclick={() => source = "github"}>
          <span class="ico">⎈</span>
          <span>GitHub.com</span>
        </button>
      </nav>

      <section class="content">
        {#if source === "url"}
          <h2>Clone with URL</h2>
          <div class="field">
            <label for="dest">Where to clone to</label>
            <div class="row">
              <input id="dest" placeholder="destination folder" bind:value={dest} />
              <button class="ghost" onclick={browseDest}>Browse</button>
            </div>
          </div>
          <div class="field">
            <label for="url">URL</label>
            <input id="url" placeholder="git@github.com:user/repo.git" bind:value={cloneUrl} />
          </div>
          <div class="field options">
            <label class="check">
              <input type="checkbox" bind:checked={shallow} />
              Shallow clone
            </label>
            {#if shallow}
              <div class="sub">
                <label for="depth">Depth</label>
                <input id="depth" inputmode="numeric" bind:value={depthText} />
              </div>
            {/if}
            <label class="check">
              <input type="checkbox" bind:checked={singleBranch} />
              Single branch
            </label>
            {#if singleBranch}
              <div class="sub">
                <label for="branch">Branch (optional)</label>
                <input id="branch" placeholder="e.g. main" bind:value={branchText} />
              </div>
            {/if}
            {#if cloneCheck.error}
              <div class="option-error">{cloneCheck.error}</div>
            {/if}
          </div>
        {:else}
          <h2>Clone from GitHub</h2>
          {#if !$ghAuth.authenticated}
            <GitHubLoginPanel />
          {:else}
            <div class="field gh-picker">
              <GitHubRepoPicker
                selected={ghPicked}
                onSelect={(r) => ghPicked = r}
              />
            </div>
            <div class="field">
              <label for="dest">Where to clone to</label>
              <div class="row">
                <input id="dest" placeholder="destination folder" bind:value={dest} />
                <button class="ghost" onclick={browseDest}>Browse</button>
              </div>
            </div>
            {#if ghPicked}
              <div class="picked">Selected: <code>{ghPicked.owner}/{ghPicked.name}</code></div>
            {/if}
          {/if}
        {/if}
      </section>
    </div>

    <footer class="modal-foot">
      {#if progress}
        <div class="progress" role="status">
          <span class="progress-text">{progressLabel(progress)}</span>
          <div class="bar">
            <div class="fill" class:indeterminate={fraction === null}
              style:width={fraction === null ? "30%" : `${fraction * 100}%`}></div>
          </div>
        </div>
      {/if}
      <button class="ghost" onclick={onClose}>Cancel</button>
      <button class="primary" onclick={doClone} disabled={cloneDisabled}>
        {busy ? "Cloning…" : "Clone the repo!"}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 1500;
  }
  .modal {
    width: min(900px, 92vw);
    height: min(620px, 88vh);
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    box-shadow: 0 18px 50px rgba(0,0,0,0.6);
    display: flex; flex-direction: column;
    overflow: hidden;
    color: var(--fg);
  }
  .modal-head {
    display: flex; align-items: center;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-strong);
    flex-shrink: 0;
  }
  .title { font-weight: 700; font-size: 14px; flex: 1; }
  .x {
    background: transparent; border: 0; color: var(--fg-muted);
    font-size: 22px; line-height: 1; cursor: pointer;
    padding: 0 6px; border-radius: 3px;
  }
  .x:hover { color: var(--fg); }

  .body { flex: 1; display: flex; min-height: 0; }
  .sources {
    width: 220px; flex-shrink: 0;
    border-right: 1px solid var(--border-strong);
    padding: 12px 6px;
    display: flex; flex-direction: column; gap: 2px;
  }
  .src {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px;
    background: transparent; border: 0;
    color: var(--fg-muted);
    cursor: pointer;
    font-size: 12px;
    border-radius: 4px;
    text-align: left;
    width: 100%;
  }
  .src:hover { color: var(--fg); background: rgba(255,255,255,0.04); }
  .src.active {
    color: var(--fg);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .src .ico { font-size: 14px; color: var(--accent); width: 16px; text-align: center; }

  .content {
    flex: 1; min-width: 0;
    padding: 18px 22px;
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 14px;
  }
  .content h2 {
    margin: 0 0 6px; font-size: 14px; font-weight: 700;
    color: var(--fg);
  }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field.gh-picker { flex: 1; min-height: 0; }
  .field label {
    font-size: 11px; color: var(--fg-muted);
    text-transform: uppercase; letter-spacing: 0.4px;
    font-weight: 600;
  }
  .field input {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 7px 10px; font-size: 12px;
    width: 100%;
  }
  .field input:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .row { display: flex; gap: 6px; }
  .row input { flex: 1; }
  .ghost {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 6px 14px; cursor: pointer; font-size: 12px;
  }
  .ghost:hover { border-color: var(--fg-muted); }
  .picked {
    font-size: 11px; color: var(--fg-muted);
    padding: 4px 0;
  }
  .picked code {
    font-family: "Cascadia Code", Consolas, monospace;
    color: var(--accent);
  }
  .field label.check {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; color: var(--fg); font-weight: 500;
    text-transform: none; letter-spacing: 0;
  }
  .sub { display: flex; flex-direction: column; gap: 6px; padding-left: 24px; }
  .option-error { font-size: 11px; color: var(--del); }

  .progress { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .progress-text {
    font-size: 11px; color: var(--fg-muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .bar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
  .fill { height: 100%; background: var(--accent); transition: width 0.2s; }
  .fill.indeterminate { animation: slide 1.2s ease-in-out infinite; }
  @keyframes slide {
    from { transform: translateX(-100%); }
    to { transform: translateX(340%); }
  }

  .modal-foot {
    display: flex; justify-content: flex-end; gap: 10px;
    padding: 12px 18px;
    border-top: 1px solid var(--border-strong);
    flex-shrink: 0;
  }
  .primary {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 7px 18px;
    cursor: pointer;
    font-weight: 700; font-size: 12px;
  }
  .primary:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .primary:disabled {
    background: transparent; color: var(--fg-muted);
    border-color: var(--border); cursor: not-allowed;
  }
</style>
