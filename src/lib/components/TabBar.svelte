<script lang="ts">
  import {
    tabs, activeTabId, activateTab, closeTab, moveTab,
    closeOtherTabs, closeTabsToRight, reopenLastClosedTab,
  } from "$lib/stores/repo";
  import { showingNewTab } from "$lib/stores/newtab";
  import { showingInfo } from "$lib/stores/info";
  import { openMenu, type MenuItem } from "$lib/stores/contextmenu";
  import Icon from "$lib/icons/Icon.svelte";
  import { ghAuth, bootGithubAuth, logoutGithub } from "$lib/stores/github";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";

  // Boot auth on mount so the avatar appears as soon as the app does,
  // not only after the user opens the clone/create modal.
  onMount(() => { bootGithubAuth(); });

  function profileMenu(): MenuItem[] {
    if (!$ghAuth.authenticated) {
      return [
        {
          label: "Sign in to GitHub…",
          icon: "user",
          onClick: () => { showingNewTab.set(true); },
        },
      ];
    }
    const login = $ghAuth.login ?? "";
    return [
      {
        label: login ? `Signed in as ${login}` : "GitHub",
        icon: "user",
        disabled: true,
      },
      { separator: true, label: "" },
      {
        label: "Open profile on GitHub",
        icon: "external",
        onClick: () => { if (login) openUrl(`https://github.com/${login}`).catch(() => {}); },
      },
      {
        label: "Your repositories",
        icon: "folder",
        onClick: () => { if (login) openUrl(`https://github.com/${login}?tab=repositories`).catch(() => {}); },
      },
      {
        label: "Manage app authorizations",
        icon: "lock",
        onClick: () => { openUrl("https://github.com/settings/connections/applications/Ov23li9Byp22UMrMNVdb").catch(() => {}); },
      },
      { separator: true, label: "" },
      {
        label: "New repository…",
        icon: "add",
        onClick: () => { showingNewTab.set(true); },
      },
      {
        label: "Clone repository…",
        icon: "download",
        onClick: () => { showingNewTab.set(true); },
      },
      { separator: true, label: "" },
      {
        label: "Sign out",
        icon: "sign-out",
        danger: true,
        onClick: () => { void logoutGithub(); },
      },
    ];
  }
  function onProfileClick(e: MouseEvent) {
    // openMenu uses clientX/clientY; passing the click event positions
    // the popover under the avatar.
    openMenu(e, profileMenu());
  }
  function profileInitials(login: string | null): string {
    if (!login) return "?";
    return login.slice(0, 2).toUpperCase();
  }

  let dragId = $state<string | null>(null);
  let dragOver = $state<string | null>(null);

  function onClick(id: string) {
    // Clicking a real repo tab always returns to the repo view, even if
    // the Info or New-tab page is currently overlaid. Without resetting
    // these flags the click would activate the tab in state but the
    // overlay would keep covering the workspace.
    showingNewTab.set(false);
    showingInfo.set(false);
    activateTab(id);
  }
  function onClose(e: MouseEvent, id: string) {
    e.stopPropagation();
    closeTab(id);
  }
  function onMiddleClick(e: MouseEvent, id: string) {
    if (e.button === 1) { e.preventDefault(); closeTab(id); }
  }
  function openNew() { showingNewTab.set(true); }

  function tabMenu(id: string): MenuItem[] {
    const list = $tabs;
    const idx = list.findIndex((t) => t.id === id);
    return [
      { label: "Close tab", icon: "close", onClick: () => closeTab(id) },
      {
        label: "Close other tabs",
        icon: "remove",
        disabled: list.length < 2,
        onClick: () => closeOtherTabs(id),
      },
      {
        label: "Close tabs to the right",
        icon: "chevron-right",
        disabled: idx < 0 || idx >= list.length - 1,
        onClick: () => closeTabsToRight(id),
      },
      { separator: true, label: "" },
      {
        label: "Reopen closed tab",
        icon: "undo",
        onClick: () => reopenLastClosedTab(),
      },
    ];
  }
  function onContext(e: MouseEvent, id: string) { openMenu(e, tabMenu(id)); }

  function onDragStart(e: DragEvent, id: string) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    dragId = id;
  }
  function onDragOver(e: DragEvent, id: string) {
    if (dragId && dragId !== id) { e.preventDefault(); dragOver = id; }
  }
  function onDrop(e: DragEvent, id: string) {
    e.preventDefault();
    if (dragId && dragId !== id) moveTab(dragId, id);
    dragId = null; dragOver = null;
  }
  function onDragEnd() { dragId = null; dragOver = null; }
</script>

<div class="tabbar">
  {#each $tabs as t (t.id)}
    {@const isActive = !$showingNewTab && !$showingInfo && t.id === $activeTabId}
    <button
      type="button"
      class="tab"
      class:active={isActive}
      class:drop-target={dragOver === t.id}
      title={t.path}
      draggable="true"
      onclick={() => onClick(t.id)}
      onmousedown={(e) => onMiddleClick(e, t.id)}
      oncontextmenu={(e) => onContext(e, t.id)}
      ondragstart={(e) => onDragStart(e, t.id)}
      ondragover={(e) => onDragOver(e, t.id)}
      ondrop={(e) => onDrop(e, t.id)}
      ondragend={onDragEnd}
    >
      <span class="name">{t.name}</span>
      <span
        class="close"
        class:visible={isActive}
        role="button"
        tabindex="0"
        draggable="false"
        onmousedown={(e) => e.stopPropagation()}
        onclick={(e) => onClose(e, t.id)}
        onkeydown={(e) => e.key === "Enter" && onClose(e as unknown as MouseEvent, t.id)}
        title="Close tab"
        aria-label="Close tab"
      ><Icon name="close" size={14} /></span>
    </button>
  {/each}
  {#if $showingInfo}
    <button
      type="button"
      class="tab info-tab"
      class:active={$showingInfo}
      onclick={() => { showingNewTab.set(false); }}
      title="GitBee info"
    >
      <span class="info-ico"><Icon name="info" size={14} /></span>
      <span class="name">Info</span>
      <span
        class="close visible"
        role="button"
        tabindex="0"
        draggable="false"
        onmousedown={(e) => e.stopPropagation()}
        onclick={(e) => { e.stopPropagation(); showingInfo.set(false); }}
        onkeydown={(e) => e.key === "Enter" && showingInfo.set(false)}
        title="Close"
        aria-label="Close"
      ><Icon name="close" size={14} /></span>
    </button>
  {/if}
  <button
    type="button"
    class="add-tab"
    class:active={$showingNewTab}
    onclick={openNew}
    title="New tab"
    aria-label="New tab"
  ><Icon name="add" size={16} /></button>
  <span class="spacer"></span>
  <button
    type="button"
    class="profile"
    onclick={onProfileClick}
    title={$ghAuth.authenticated ? `Signed in as ${$ghAuth.login}` : "Sign in to GitHub"}
    aria-label={$ghAuth.authenticated ? `Signed in as ${$ghAuth.login}` : "Sign in to GitHub"}
  >
    {#if $ghAuth.authenticated && $ghAuth.avatarUrl}
      <img src={$ghAuth.avatarUrl} alt={$ghAuth.login ?? ""} referrerpolicy="no-referrer" />
    {:else}
      <span class="initials">{profileInitials($ghAuth.login)}</span>
    {/if}
  </button>
</div>

<style>
  .tabbar {
    display: flex;
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    overflow-y: hidden;
    flex-shrink: 0;
    height: var(--h-tabbar);
    align-items: stretch;
  }
  .tabbar::-webkit-scrollbar { height: 0; }
  /* Tab padding and the 300 px cap are the spec's values. 25 px on the right has
     no size token, so it stays raw. The tab fills the bar height by stretching. */
  .tab {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-4);
    padding: 0 25px 0 var(--sp-20);
    background: transparent;
    color: var(--fg-muted);
    border: 0;
    border-right: 1px solid var(--border);
    border-radius: var(--radius) var(--radius) 0 0;
    cursor: pointer;
    font-size: var(--fs-md);
    max-width: 300px;
    flex-shrink: 0;
    position: relative;
  }
  .tab:hover { color: var(--fg); background: color-mix(in srgb, var(--fg) 4%, transparent); }
  /* The active tab sits on the workspace surface and has no divider. */
  .tab.active { color: var(--fg); background: var(--bg); border-right-color: transparent; }
  .tab.active::after {
    content: ""; position: absolute; left: 0; right: 0; top: 0;
    height: 2px; background: var(--accent);
  }
  .tab.drop-target { background: color-mix(in srgb, var(--accent) 18%, transparent); }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

  /* #10 — close button hidden by default; visible on the active tab; visible
     on inactive tabs only on hover. */
  .close {
    display: inline-flex; align-items: center; justify-content: center;
    width: var(--h-row); height: var(--h-row); flex-shrink: 0;
    border-radius: var(--radius-sm); color: var(--fg-muted);
    user-select: none; cursor: pointer;
    opacity: 0;
    transition: opacity 80ms;
  }
  .close.visible { opacity: 0.85; }
  .tab:hover .close { opacity: 0.85; }
  .close:hover { background: color-mix(in srgb, var(--fg) 10%, transparent); color: var(--fg); opacity: 1; }

  .info-ico { display: inline-flex; color: var(--accent); }

  /* "+" is 34 x 34: the tab bar's height, square. */
  .add-tab {
    display: inline-flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    width: var(--h-tabbar); height: var(--h-tabbar); padding: 0;
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer;
    border-right: 1px solid var(--border);
  }
  .add-tab:hover, .add-tab.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .add-tab.active { box-shadow: inset 0 2px 0 var(--accent); }

  /* Pushes the profile button to the far right of the tab bar without
     interfering with horizontal scroll of the tab list itself. */
  .spacer { flex: 1; min-width: 0; }
  .profile {
    background: transparent; border: 0;
    padding: 0 var(--sp-4);
    height: var(--h-tabbar);
    display: inline-flex; align-items: center; justify-content: center;
    cursor: pointer;
    border-left: 1px solid var(--border);
    flex-shrink: 0;
  }
  .profile:hover { background: color-mix(in srgb, var(--fg) 5%, transparent); }
  /* 20 px avatar: no size token; the spec's measured avatar size. */
  .profile img {
    width: 20px; height: 20px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }
  .profile .initials {
    width: 20px; height: 20px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    color: var(--accent);
    font-size: var(--fs-xs); font-weight: 700;
    display: inline-flex; align-items: center; justify-content: center;
  }
</style>
