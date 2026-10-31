<script lang="ts">
  import { onMount } from "svelte";
  import { layout, setZoom, ZOOM_STEPS, displayPercent } from "$lib/stores/layout";
  import { logsPanelOpen } from "$lib/stores/logs";
  import { currentRepo } from "$lib/stores/repo";
  import { showingInfo } from "$lib/stores/info";
  import { ipc } from "$lib/ipc";
  import { logAppend } from "$lib/stores/logs";
  import { appVersion } from "$lib/version";
  import { updateState, installNow } from "$lib/stores/updater";
  import {
    autofetchStatus, absoluteFetchTime, autofetchErrorTooltip, formatFetchAge,
  } from "$lib/stores/autofetchStatus";
  import { retryAutofetch } from "$lib/stores/autofetch";
  import {
    gitProgress, startGitProgress, pickProgressForRepo, progressFraction, progressLabel,
  } from "$lib/stores/gitProgress";
  import ShortcutsPanel from "./ShortcutsPanel.svelte";
  import ProfilesDialog from "./profiles/ProfilesDialog.svelte";
  import { openMenu } from "$lib/stores/contextmenu";
  import { profiles, refreshProfiles } from "$lib/profiles/profilesStore";
  import { identityFor, refreshRepoIdentity, repoIdentity } from "$lib/profiles/identityStore";
  import { identityTone, pillText } from "$lib/profiles/profile";
  import { pillMenuItems } from "$lib/profiles/menu";
  import { applyProfileWithNotice } from "$lib/profiles/applyToRepo";

  // Re-rendered every 30 s so "Fetched 3 min ago" ages without a store event.
  const AGE_TICK_MS = 30_000;

  let zoomMenu = $state(false);
  let shortcutsOpen = $state(false);
  let nowMs = $state(Date.now());

  const progress = $derived(pickProgressForRepo($gitProgress, $currentRepo));
  const fraction = $derived(progress ? progressFraction(progress) : null);
  const fetchState = $derived($currentRepo ? ($autofetchStatus[$currentRepo] ?? null) : null);

  // The identity pill shows what git would commit as in the open repo. It is
  // re-read when the repo changes and after an apply (docs/specs/git-profiles.md).
  const identity = $derived(identityFor($repoIdentity, $currentRepo));
  let profilesOpen = $state(false);

  $effect(() => {
    const repo = $currentRepo;
    if (repo) void refreshRepoIdentity(repo);
  });

  onMount(() => {
    refreshProfiles().catch((e: unknown) => logAppend("error", `profiles: ${e}`));
    const ageTimer = setInterval(() => { nowMs = Date.now(); }, AGE_TICK_MS);
    const stopProgress = startGitProgress();
    return () => {
      clearInterval(ageTimer);
      void stopProgress.then((stop) => stop());
    };
  });

  async function openTerm() {
    if (!$currentRepo) return;
    try { await ipc.openTerminal($currentRepo); }
    catch (e) { logAppend("error", `terminal: ${e}`); }
  }
  function pickZoom(z: number) { setZoom(z); zoomMenu = false; }

  // The pill's menu: one line per saved profile, then the manager.
  function openIdentityMenu(e: MouseEvent): void {
    const repo = $currentRepo;
    if (!repo) return;
    openMenu(e, pillMenuItems($profiles, {
      apply: (profile) => { void applyProfileWithNotice(repo, profile); },
      manage: () => { profilesOpen = true; },
    }));
  }
</script>

<footer class="status">
  <div class="left">
    <button class="bi" onclick={openTerm} disabled={!$currentRepo} title="Open external terminal (Ctrl+`)">
      <span class="ico">▶_</span>
    </button>
    {#if progress}
      <span class="prog" class:done={progress.done} title="git {progress.op}">
        <span class="prog-text">{progressLabel(progress)}</span>
        <span class="prog-track">
          <span
            class="prog-fill"
            class:indet={fraction === null}
            style:width={fraction === null ? undefined : `${Math.round(fraction * 100)}%`}
          ></span>
        </span>
      </span>
    {/if}
  </div>
  <div class="right">
    {#if identity}
      <button
        class="bi ident"
        class:none={identity.source === "none"}
        onclick={openIdentityMenu}
        title={identity.source === "none"
          ? "Git has no name or email for this repo. Click to apply a profile."
          : `Commits here are made as this identity (${identity.source}). Click to switch profile.`}
      >
        <span class="dot tone-{identityTone(identity.source)}"></span>
        <span class="ident-text">{pillText(identity)}</span>
      </button>
    {/if}
    {#if fetchState?.lastFetchError}
      <button
        class="bi af err"
        onclick={() => retryAutofetch()}
        title={autofetchErrorTooltip(fetchState.lastFetchError)}
      >
        <span class="ico">⚠</span><span>Auto-fetch failed</span>
      </button>
    {:else if fetchState?.lastFetchAt}
      <span class="af" title={absoluteFetchTime(fetchState.lastFetchAt)}>
        Fetched {formatFetchAge(fetchState.lastFetchAt, nowMs)}
      </span>
    {/if}
    <button class="bi" onclick={() => logsPanelOpen.update((v) => !v)} title="Logs (Ctrl+L)">
      <span class="ico">≡</span><span>Logs</span>
    </button>
    <button class="bi" onclick={() => shortcutsOpen = true} title="Keyboard shortcuts">
      <span class="ico">⌨</span><span>Shortcuts</span>
    </button>
    <button class="bi" onclick={() => showingInfo.update((v) => !v)} title="Features / about">
      <span class="ico">ⓘ</span><span>Info</span>
    </button>
    {#if $updateState.kind === "downloading"}
      <span class="upd downloading" title="Downloading update v{$updateState.version}">
        <span class="upd-spin"></span>
        <span>Downloading update… {$updateState.progress}%</span>
      </span>
    {:else if $updateState.kind === "ready"}
      <button class="bi upd ready" onclick={installNow}
        title={$updateState.notes ?? `v${$updateState.version} ready to install`}>
        <span class="ico">⤓</span>
        <span>Update v{$updateState.version} — click to install</span>
      </button>
    {:else if $updateState.kind === "error"}
      <span class="upd err" title={$updateState.message}>
        <span class="ico">⚠</span><span>Update check failed</span>
      </span>
    {/if}
    <div class="zoom">
      <button class="bi" onclick={() => zoomMenu = !zoomMenu} title="UI zoom">
        <span class="ico">⊕</span>
        <span>{displayPercent($layout.uiScale)}%</span>
      </button>
      {#if zoomMenu}
        <div class="zoom-menu">
          {#each [...ZOOM_STEPS].reverse() as z (z)}
            <button
              class:active={Math.abs(z - $layout.uiScale) < 0.01}
              onclick={() => pickZoom(z)}
            >{displayPercent(z)}%</button>
          {/each}
        </div>
      {/if}
    </div>
    <span class="version">v{appVersion}</span>
  </div>
</footer>

<ShortcutsPanel open={shortcutsOpen} onClose={() => shortcutsOpen = false} />
{#if profilesOpen}
  <ProfilesDialog onClose={() => profilesOpen = false} />
{/if}

<style>
  .status {
    display: flex;
    align-items: center;
    height: 22px;
    background: var(--bg-elev);
    border-top: 1px solid var(--border-strong);
    font-size: 10px;
    flex-shrink: 0;
    z-index: 50;
  }
  .left { display: flex; padding-left: 4px; }
  .right { margin-left: auto; display: flex; align-items: center; gap: 2px; padding-right: 8px; }
  .bi {
    background: transparent;
    border: 0;
    color: var(--fg-muted);
    cursor: pointer;
    padding: 0 8px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    border-radius: 0;
  }
  .bi:hover { color: var(--fg); background: rgba(255,255,255,0.05); }
  .bi .ico { font-size: 13px; }
  .version {
    color: var(--fg-muted);
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 10px;
    padding: 0 8px 0 12px;
    border-left: 1px solid var(--border);
    margin-left: 4px;
  }
  .zoom { position: relative; }
  .zoom-menu {
    position: absolute;
    bottom: 100%;
    right: 0;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.5);
    padding: 4px;
    margin-bottom: 4px;
    display: flex;
    flex-direction: column;
    min-width: 90px;
  }
  .zoom-menu button {
    background: transparent;
    border: 0;
    color: var(--fg);
    padding: 6px 12px;
    cursor: pointer;
    text-align: right;
    border-radius: 3px;
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 11px;
  }
  .zoom-menu button.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .zoom-menu button:hover { background: rgba(255,255,255,0.06); }

  /* Update pill — three states. Downloading is informational (no click),
     ready is an inviting accent-colored CTA, error is a quiet warning. */
  .upd {
    display: inline-flex; align-items: center; gap: 6px;
    height: 22px;
    padding: 0 10px;
    font-size: 10px;
    margin-right: 4px;
  }
  .upd.downloading {
    color: var(--fg-muted);
  }
  .upd.ready {
    background: color-mix(in srgb, var(--add, var(--accent)) 18%, transparent);
    color: var(--add, var(--accent));
    border: 1px solid var(--add, var(--accent));
    border-radius: 3px;
    cursor: pointer;
    font-weight: 600;
  }
  .upd.ready:hover {
    background: var(--add, var(--accent));
    color: var(--bg);
  }
  .upd.err {
    color: var(--del);
  }
  .upd-spin {
    width: 10px; height: 10px;
    border: 1.5px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: upd-spin 0.8s linear infinite;
  }
  @keyframes upd-spin { to { transform: rotate(360deg); } }

  /* Git progress pill: label plus a thin bar. Indeterminate (no percent yet)
     slides a short segment instead of showing a fake fraction. */
  .prog {
    display: inline-flex; align-items: center; gap: 6px;
    height: 22px; padding: 0 8px;
    color: var(--fg-muted);
    white-space: nowrap;
  }
  .prog.done { color: var(--add, var(--accent)); }
  .prog-track {
    position: relative;
    width: 72px; height: 3px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }
  .prog-fill {
    position: absolute; top: 0; bottom: 0; left: 0;
    background: var(--accent);
    transition: width 0.2s linear;
  }
  .prog-fill.indet {
    width: 35%;
    transition: none;
    animation: prog-slide 1.2s ease-in-out infinite;
  }
  @keyframes prog-slide {
    from { transform: translateX(-100%); }
    to { transform: translateX(290%); }
  }

  /* Identity pill: a dot for the source, then "Name <email>" cut short with an
     ellipsis. An unset identity turns the text the warning color. */
  .ident { max-width: 320px; }
  .ident-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ident.none { color: var(--modified); }
  .dot {
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
    background: var(--fg-muted);
  }
  .dot.tone-accent { background: var(--accent); }
  .dot.tone-warn { background: var(--modified); }

  /* Auto-fetch status: quiet age text, or a warning pill that retries on click. */
  .af {
    display: inline-flex; align-items: center; gap: 5px;
    height: 22px; padding: 0 8px;
    color: var(--fg-muted);
    white-space: nowrap;
  }
  .bi.af.err { color: var(--del); }
</style>
