<script lang="ts">
  // Create-a-repository dialog. Two tabs: "Local only" reproduces the
  // old `git init` behavior; "GitHub" calls the API + initializes
  // locally + pushes. See docs/specs/github-create-repo.md.
  import { ipc, type GhOwner, type CreateRepoReq } from "$lib/ipc";
  import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
  import { logAppend } from "$lib/stores/logs";
  import { ghAuth, bootGithubAuth } from "$lib/stores/github";
  import { openRepo } from "$lib/stores/repo";
  import Icon from "$lib/icons/Icon.svelte";
  import GitHubLoginPanel from "./GitHubLoginPanel.svelte";
  import { onMount, untrack } from "svelte";

  type Mode = "new" | "publish-existing";
  interface Props {
    onClose: () => void;
    mode?: Mode;
    /** Required when mode === "publish-existing" */
    repoPath?: string;
    /** Pre-filled repo name (folder basename) for the publish flow */
    initialName?: string;
  }
  let { onClose, mode = "new", repoPath, initialName }: Props = $props();

  type Source = "local" | "github";
  // Publish flow always uses the GitHub tab — local-only doesn't apply
  // because the local repo already exists. The props are read once at mount:
  // the modal is remounted for each open, so a snapshot is the intent.
  let source = $state<Source>(untrack(() => (mode === "publish-existing" ? "github" : "local")));

  let busy = $state(false);
  let busyLabel = $state<string>("");
  let errorBanner = $state<string | null>(null);
  let dest = $state("");

  // GitHub form state.
  let owners = $state<GhOwner[]>([]);
  let ownersLoading = $state(false);
  let owner = $state<string>("");
  let name = $state(untrack(() => initialName ?? ""));
  let description = $state("");
  let isPrivate = $state(true);
  let defaultBranch = $state("main");
  let autoInit = $state(false);

  // Name availability indicator. null = not checked, true = available,
  // false = taken, "checking" = in flight.
  let nameStatus = $state<null | "checking" | "available" | "taken" | "invalid">(null);
  let nameDebounce: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    bootGithubAuth();
    if (mode === "new") {
      ipc.cloneLastDest().then((d) => { if (d && !dest) dest = d; }).catch(() => {});
    }
  });

  // Whenever the user becomes authenticated and we're on the GitHub
  // tab, load the owner list once.
  $effect(() => {
    if ($ghAuth.authenticated && source === "github" && owners.length === 0 && !ownersLoading) {
      void loadOwners();
    }
  });

  async function loadOwners() {
    ownersLoading = true;
    try {
      const list = await ipc.githubListCreateOwners();
      owners = list;
      if (!owner && list.length > 0) owner = list[0].login;
    } catch (e) {
      errorBanner = `Failed to load accounts: ${e}`;
    } finally {
      ownersLoading = false;
    }
  }

  function scheduleNameCheck() {
    nameStatus = null;
    if (nameDebounce) clearTimeout(nameDebounce);
    if (!name.trim() || !owner) return;
    nameDebounce = setTimeout(async () => {
      const checking = name.trim();
      nameStatus = "checking";
      try {
        const ok = await ipc.githubCheckRepoName(owner, checking);
        if (name.trim() !== checking) return; // stale
        nameStatus = ok ? "available" : "taken";
      } catch (e) {
        if (name.trim() !== checking) return;
        const msg = String(e);
        nameStatus = msg.includes("NAME_INVALID") ? "invalid" : null;
      }
    }, 350);
  }

  async function browseDest() {
    const picked = await openFolderDialog({
      directory: true, multiple: false,
      title: source === "local" ? "Create repository in" : "Where to put the new repo",
    });
    if (typeof picked === "string") dest = picked;
  }

  async function submit() {
    errorBanner = null;
    if (busy) return;
    if (source === "local") {
      if (!dest.trim()) return;
      try {
        busy = true; busyLabel = "Initializing local repo…";
        const path = await ipc.repoCreate(dest.trim());
        logAppend("info", `created repo at ${path}`);
        await openRepo(path);
        onClose();
      } catch (e) {
        errorBanner = String(e);
        logAppend("error", `create failed: ${e}`);
      } finally { busy = false; busyLabel = ""; }
      return;
    }

    // GitHub flow
    if (!owner || !name.trim()) return;
    if (mode === "new" && !dest.trim()) return;
    if (nameStatus === "taken" || nameStatus === "invalid") return;

    const req: CreateRepoReq = {
      owner,
      name: name.trim(),
      description: description.trim() || null,
      private: isPrivate,
      auto_init: mode === "new" && autoInit,
      default_branch: defaultBranch.trim() || "main",
      dest_folder: mode === "new" ? dest.trim() : null,
    };

    try {
      busy = true;
      if (mode === "publish-existing") {
        // Backend does API-create + git push in one call with no
        // progress channel, so the label has to cover both phases up
        // front — flipping it after the await is a no-op (the modal
        // closes on the next line).
        busyLabel = "Creating & pushing… (large repos can take a while)";
        const r = await ipc.githubPublishLocal(repoPath!, req);
        logAppend("info", `published to ${r.html_url}`);
        // Refresh the open repo so remotes/graph pick up origin.
        await openRepo(r.local_path);
        onClose();
      } else {
        busyLabel = "Creating & pushing… (large repos can take a while)";
        const r = await ipc.githubCreateRepo(req);
        logAppend("info", `created ${r.html_url}`);
        if (dest.trim()) ipc.cloneSaveDest(dest.trim()).catch(() => {});
        await openRepo(r.local_path);
        onClose();
      }
    } catch (e) {
      const msg = String(e);
      errorBanner = friendlyError(msg);
      logAppend("error", `create failed: ${e}`);
    } finally {
      busy = false; busyLabel = "";
    }
  }

  function friendlyError(msg: string): string {
    if (msg.includes("NAME_TAKEN")) return `That name is already taken in ${owner}.`;
    if (msg.includes("NAME_INVALID")) return `Repo name is invalid. Use letters, digits, '.', '_', '-' (max 100 chars, can't start with '.' or '-').`;
    if (msg.includes("INSUFFICIENT_SCOPES")) return `Your GitHub token can't create repos. Sign out and sign in again to refresh scopes.`;
    if (msg.includes("REMOTE_EXISTS")) return msg.replace(/.*REMOTE_EXISTS:\s*/, "Remote 'origin' already exists: ");
    if (msg.includes("PUSH_REJECTED")) return msg.replace(/.*PUSH_REJECTED:\s*/, "Push rejected: ");
    return msg;
  }

  const submitDisabled = $derived.by(() => {
    if (busy) return true;
    if (source === "local") return !dest.trim();
    if (!$ghAuth.authenticated) return true;
    if (!owner || !name.trim()) return true;
    if (mode === "new" && !dest.trim()) return true;
    if (nameStatus === "taken" || nameStatus === "invalid") return true;
    return false;
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && !busy) { e.preventDefault(); onClose(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" role="presentation" onclick={() => { if (!busy) onClose(); }}>
  <div class="modal" role="dialog" aria-label="Create a Repository" tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}>
    <header class="modal-head">
      <span class="title">
        {mode === "publish-existing" ? "Publish to GitHub" : "Create a Repository"}
      </span>
      <button class="x" onclick={() => { if (!busy) onClose(); }} title="Close" aria-label="Close">
        <Icon name="close" size={16} />
      </button>
    </header>

    <div class="body">
      {#if mode === "new"}
        <nav class="sources">
          <button class="src" class:active={source === "local"} onclick={() => source = "local"}>
            <span class="ico"><Icon name="laptop" size={16} /></span><span>Local only</span>
          </button>
          <button class="src" class:active={source === "github"} onclick={() => source = "github"}>
            <span class="ico"><Icon name="cloud" size={16} /></span><span>On GitHub</span>
          </button>
        </nav>
      {/if}

      <section class="content">
        {#if source === "local"}
          <h2>New local repository</h2>
          <div class="field">
            <label class="field-label" for="dest-local">Folder</label>
            <div class="row">
              <input id="dest-local" placeholder="folder for git init" bind:value={dest} />
              <button class="ghost" onclick={browseDest}>Browse</button>
            </div>
            <div class="hint">Runs <code>git init</code> in the chosen folder.</div>
          </div>
        {:else}
          <h2>{mode === "publish-existing" ? "Publish this repo to GitHub" : "New repository on GitHub"}</h2>
          {#if !$ghAuth.authenticated}
            <GitHubLoginPanel />
          {:else}
            <div class="grid">
              <div class="field">
                <label class="field-label" for="owner">Owner</label>
                <select id="owner" bind:value={owner} disabled={ownersLoading}>
                  {#each owners as o}
                    <option value={o.login}>{o.login}{o.kind === "organization" ? " (org)" : ""}</option>
                  {/each}
                </select>
              </div>
              <div class="field">
                <label class="field-label" for="name">Repository name</label>
                <div class="name-row">
                  <input id="name" placeholder="my-cool-repo" bind:value={name}
                    oninput={scheduleNameCheck} />
                  <span class="name-status" class:ok={nameStatus === "available"}
                    class:bad={nameStatus === "taken" || nameStatus === "invalid"}>
                    {#if nameStatus === "checking"}…
                    {:else if nameStatus === "available"}<Icon name="check" size={14} title="Name is available" />
                    {:else if nameStatus === "taken"}<Icon name="close" size={14} /><span>taken</span>
                    {:else if nameStatus === "invalid"}<Icon name="close" size={14} /><span>invalid</span>
                    {:else}&nbsp;
                    {/if}
                  </span>
                </div>
              </div>
            </div>

            <div class="field">
              <label class="field-label" for="desc">Description (optional)</label>
              <input id="desc" bind:value={description} maxlength={350} />
            </div>

            <div class="grid">
              <div class="field">
                <span class="field-label">Visibility</span>
                <div class="radios">
                  <label class="radio">
                    <input type="radio" bind:group={isPrivate} value={true} />
                    <span>Private</span>
                  </label>
                  <label class="radio">
                    <input type="radio" bind:group={isPrivate} value={false} />
                    <span>Public</span>
                  </label>
                </div>
              </div>
              <div class="field">
                <label class="field-label" for="branch">Default branch</label>
                <input id="branch" bind:value={defaultBranch} placeholder="main" />
              </div>
            </div>

            {#if mode === "new"}
              <div class="field">
                <label class="field-label" for="dest-gh">Where to put it locally</label>
                <div class="row">
                  <input id="dest-gh" placeholder="parent folder" bind:value={dest} />
                  <button class="ghost" onclick={browseDest}>Browse</button>
                </div>
                <label class="checkbox">
                  <input type="checkbox" bind:checked={autoInit} />
                  <span>Initialize with a README on GitHub (clone after create)</span>
                </label>
              </div>
            {/if}
          {/if}
        {/if}

        {#if errorBanner}
          <div class="error-banner">
            <span>{errorBanner}</span>
            <button class="ghost copy" onclick={() => navigator.clipboard.writeText(errorBanner!).catch(() => {})}>Copy</button>
          </div>
        {/if}
      </section>
    </div>

    <footer class="modal-foot">
      <button class="ghost" onclick={onClose} disabled={busy}>Cancel</button>
      <button class="primary" onclick={submit} disabled={submitDisabled}>
        {busy
          ? (busyLabel || "Working…")
          : (source === "local"
            ? "Create"
            : (mode === "publish-existing" ? "Publish" : "Create on GitHub"))}
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
    width: min(720px, 92vw);
    max-height: 88vh;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: 0 18px 50px rgba(0,0,0,0.6);
    display: flex; flex-direction: column;
    overflow: hidden;
    color: var(--fg);
  }
  /* Dialog header: 10 px 20 px padding, bottom border, --fs-lg title. */
  .modal-head {
    display: flex; align-items: center;
    padding: var(--sp-5) var(--sp-20);
    border-bottom: 1px solid var(--border-strong);
    flex-shrink: 0;
  }
  .title { font-weight: 600; font-size: var(--fs-lg); flex: 1; }
  .x {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px;
    background: transparent; border: 0; border-radius: var(--radius);
    color: var(--fg-muted); cursor: pointer;
  }
  .x:hover { color: var(--fg); }

  .body { flex: 1; display: flex; min-height: 0; }
  .sources {
    width: 180px; flex-shrink: 0;
    border-right: 1px solid var(--border-strong);
    padding: var(--sp-6) var(--sp-3);
    display: flex; flex-direction: column; gap: var(--sp-1);
  }
  .src {
    display: flex; align-items: center; gap: var(--sp-5);
    height: 28px;
    padding: 0 var(--sp-6);
    background: transparent; border: 0;
    color: var(--fg-muted);
    cursor: pointer; font-size: var(--fs-md);
    border-radius: var(--radius); text-align: left; width: 100%;
  }
  .src:hover { color: var(--fg); background: rgba(255,255,255,0.04); }
  .src.active {
    color: var(--fg);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .src .ico {
    display: flex; align-items: center; justify-content: center;
    width: var(--icon); color: var(--accent);
  }

  .content {
    flex: 1; min-width: 0;
    padding: var(--sp-15) var(--sp-20);
    overflow-y: auto;
    display: flex; flex-direction: column; gap: var(--sp-6);
  }
  .content h2 {
    margin: 0 0 var(--sp-3); font-size: var(--fs-lg); font-weight: 600;
  }
  .grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-6);
  }
  .field { display: flex; flex-direction: column; gap: var(--sp-3); }
  .field-label {
    font-size: var(--fs-sm); color: var(--fg-muted);
    text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600;
  }
  .field input, .field select {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-3) var(--sp-5); font-size: var(--fs-md); width: 100%;
    font: inherit;
  }
  .field input:focus, .field select:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .row { display: flex; gap: var(--sp-3); }
  .row input { flex: 1; }
  .name-row { display: flex; gap: var(--sp-3); align-items: center; }
  .name-row input { flex: 1; }
  .name-status {
    display: inline-flex; align-items: center; gap: var(--sp-2);
    font-size: var(--fs-sm); min-width: 60px;
    color: var(--fg-muted);
  }
  .name-status.ok { color: var(--add); }
  .name-status.bad { color: var(--del); }
  .radios { display: flex; gap: var(--sp-8); padding-top: var(--sp-2); }
  .radio, .checkbox {
    display: flex; align-items: center; gap: var(--sp-3);
    font-size: var(--fs-md); color: var(--fg);
    cursor: pointer;
  }
  .checkbox { padding-top: var(--sp-3); }
  .ghost {
    height: 28px;
    display: inline-flex; align-items: center;
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 0 var(--sp-6); cursor: pointer; font-size: var(--fs-md);
  }
  .ghost:hover:not(:disabled) { border-color: var(--fg-muted); }
  .ghost:disabled { opacity: 0.5; cursor: not-allowed; }
  .hint { font-size: var(--fs-sm); color: var(--fg-muted); }
  .error-banner {
    display: flex; align-items: center; gap: var(--sp-4);
    padding: var(--sp-4) var(--sp-5);
    background: color-mix(in srgb, var(--del) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--del) 40%, transparent);
    border-radius: var(--radius);
    color: var(--fg);
    font-size: var(--fs-md);
  }
  .error-banner .copy { height: 24px; padding: 0 var(--sp-5); font-size: var(--fs-sm); }
  .error-banner span { flex: 1; }

  /* Footer: right-aligned, 28 px buttons. */
  .modal-foot {
    display: flex; justify-content: flex-end; gap: var(--sp-5);
    padding: var(--sp-5) var(--sp-20);
    border-top: 1px solid var(--border-strong);
    flex-shrink: 0;
  }
  .primary {
    height: 28px;
    display: inline-flex; align-items: center;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    padding: 0 var(--sp-8); cursor: pointer;
    font-weight: 600; font-size: var(--fs-md);
  }
  .primary:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .primary:disabled {
    background: transparent; color: var(--fg-muted);
    border-color: var(--border); cursor: not-allowed;
  }
  code { font-family: "Cascadia Code", Consolas, monospace; }
</style>
