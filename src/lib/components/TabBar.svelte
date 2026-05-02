<script lang="ts">
  import {
    tabs, activeTabId, activateTab, closeTab, moveTab,
    closeOtherTabs, closeTabsToRight, reopenLastClosedTab,
  } from "$lib/stores/repo";
  import { showingNewTab } from "$lib/stores/newtab";
  import { showingInfo } from "$lib/stores/info";
  import { openMenu, type MenuItem } from "$lib/stores/contextmenu";

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
      { label: "Close tab", icon: "×", onClick: () => closeTab(id) },
      {
        label: "Close other tabs",
        icon: "−",
        disabled: list.length < 2,
        onClick: () => closeOtherTabs(id),
      },
      {
        label: "Close tabs to the right",
        icon: "→",
        disabled: idx < 0 || idx >= list.length - 1,
        onClick: () => closeTabsToRight(id),
      },
      { separator: true, label: "" },
      {
        label: "Reopen closed tab",
        icon: "↶",
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
      >×</span>
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
      <span class="info-ico">ⓘ</span>
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
      >×</span>
    </button>
  {/if}
  <button
    type="button"
    class="add-tab"
    class:active={$showingNewTab}
    onclick={openNew}
    title="New tab"
  >＋</button>
</div>

<style>
  .tabbar {
    display: flex;
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    overflow-y: hidden;
    flex-shrink: 0;
    height: 28px;
    align-items: stretch;
  }
  .tabbar::-webkit-scrollbar { height: 0; }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    background: transparent;
    color: var(--fg-muted);
    border: 0;
    border-right: 1px solid var(--border);
    cursor: pointer;
    font-size: 12px;
    height: 28px;
    max-width: 220px;
    flex-shrink: 0;
    position: relative;
  }
  .tab:hover { color: var(--fg); background: rgba(255,255,255,0.04); }
  .tab.active { color: var(--fg); background: var(--bg); }
  .tab.active::after {
    content: ""; position: absolute; left: 0; right: 0; top: 0;
    height: 2px; background: var(--accent);
  }
  .tab.drop-target { background: color-mix(in srgb, var(--accent) 18%, transparent); }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px; }

  /* #10 — close button hidden by default; visible on the active tab; visible
     on inactive tabs only on hover. */
  .close {
    width: 16px; height: 16px; line-height: 14px; text-align: center;
    border-radius: 3px; color: var(--fg-muted); font-size: 14px;
    user-select: none; cursor: pointer;
    opacity: 0;
    transition: opacity 80ms;
  }
  .close.visible { opacity: 0.85; }
  .tab:hover .close { opacity: 0.85; }
  .close:hover { background: rgba(255,255,255,0.1); color: var(--fg); opacity: 1; }

  .info-tab .info-ico { color: var(--accent); font-size: 14px; }

  .add-tab {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; padding: 0 12px; height: 32px;
    border-right: 1px solid var(--border);
    font-size: 16px; line-height: 1;
  }
  .add-tab:hover, .add-tab.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .add-tab.active { box-shadow: inset 0 2px 0 var(--accent); }
</style>
