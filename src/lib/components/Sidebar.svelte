<script lang="ts">
  import { currentRepo, localBranches, remoteBranches, tagsList, worktrees } from "$lib/stores/repo";
  import { setSize } from "$lib/stores/layout";
  import { openMenu } from "$lib/stores/contextmenu";
  import { activeSubmodules } from "$lib/stores/submodules";
  import { onMount } from "svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import SidebarSection from "$lib/components/sidebar/SidebarSection.svelte";
  import LocalBranches from "$lib/components/sidebar/LocalBranches.svelte";
  import RemoteBranches from "$lib/components/sidebar/RemoteBranches.svelte";
  import WorktreeList from "$lib/components/sidebar/WorktreeList.svelte";
  import SubmoduleList from "$lib/components/sidebar/SubmoduleList.svelte";
  import TagList from "$lib/components/sidebar/TagList.svelte";
  import StashList from "$lib/components/sidebar/StashList.svelte";
  import { submoduleHeaderMenu } from "$lib/components/sidebar/submoduleMenus";
  import "$lib/components/sidebar/sidebar-rows.css";

  // #5 round 7: filter input above the sections.
  let filter = $state("");
  let filterEl: HTMLInputElement | null = $state(null);
  let stashCount = $state(0);

  type SectionKey = "local" | "remote" | "worktrees" | "stashes" | "tags" | "submodules";
  // Kept here, not in the sections, so the open state survives a repo switch.
  // The render order below follows docs/specs/ui-layout-2026-11.md (Region 3).
  let openSections = $state<Record<SectionKey, boolean>>({
    local: true, remote: true, worktrees: true, stashes: true, tags: false, submodules: true,
  });
  function toggleSection(k: SectionKey) { openSections[k] = !openSections[k]; }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        filterEl?.focus();
        filterEl?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
</script>

<aside class="sidebar">
  <button class="brand" title="Collapse sidebar (Ctrl+B)"
    onclick={() => setSize("sidebarCollapsed", true)}>
    <img class="logo" src="/bee-logo.png" alt="" />
    <strong>GitBee</strong>
    <span class="collapse-ico"><Icon name="chevron-right" size={14} /></span>
  </button>

  {#if !$currentRepo}
    <div class="muted-pad">Open a repository from a tab to begin.</div>
  {:else}
    <div class="filter-bar">
      <div class="filter-field">
        <span class="filter-ico"><Icon name="search" size={14} /></span>
        <input
          bind:this={filterEl}
          bind:value={filter}
          placeholder="Filter (Ctrl+Alt+F)"
          aria-label="Filter sidebar"
          spellcheck="false"
        />
        {#if filter}
          <button class="filter-clear" onclick={() => filter = ""} title="Clear filter" aria-label="Clear filter">
            <Icon name="close" size={14} />
          </button>
        {/if}
      </div>
    </div>

    <SidebarSection title="Local" count={$localBranches.length}
      open={openSections.local} ontoggle={() => toggleSection("local")}>
      <LocalBranches {filter} />
    </SidebarSection>

    <SidebarSection title="Remote" count={$remoteBranches.length}
      open={openSections.remote} ontoggle={() => toggleSection("remote")}>
      <RemoteBranches {filter} />
    </SidebarSection>

    <SidebarSection title="Worktrees" count={$worktrees.length}
      open={openSections.worktrees} ontoggle={() => toggleSection("worktrees")}>
      <WorktreeList {filter} />
    </SidebarSection>

    <SidebarSection title="Stashes" count={stashCount}
      open={openSections.stashes} ontoggle={() => toggleSection("stashes")}>
      <StashList {filter} bind:count={stashCount} />
    </SidebarSection>

    <SidebarSection title="Tags" count={$tagsList.length}
      open={openSections.tags} ontoggle={() => toggleSection("tags")}>
      <TagList {filter} />
    </SidebarSection>

    {#if $activeSubmodules.length > 0}
      <SidebarSection title="Submodules" count={$activeSubmodules.length}
        open={openSections.submodules} ontoggle={() => toggleSection("submodules")}
        onMenu={(e) => openMenu(e, submoduleHeaderMenu($currentRepo ?? ""))}>
        <SubmoduleList repo={$currentRepo ?? ""} {filter} />
      </SidebarSection>
    {/if}
  {/if}
</aside>

<style>
  .sidebar {
    width: 100%;
    height: 100%;
    background: var(--sidebar-bg);
    border-right: 1px solid var(--border-strong);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex-shrink: 0;
  }
  /* The brand is a header row, never taller than a section (--h-section). */
  .brand {
    display: flex; align-items: center; gap: var(--sp-4);
    height: var(--h-section); padding: 0 var(--sp-6);
    border: 0; border-bottom: 1px solid var(--border-strong);
    font-size: var(--fs-lg); background: transparent; color: var(--fg);
    cursor: pointer; text-align: left; width: 100%; flex-shrink: 0;
  }
  .brand:hover { background: var(--bg-elev); }
  .brand .logo { width: var(--icon); height: var(--icon); object-fit: contain; flex-shrink: 0; }
  .brand strong {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* Points left: the chevron-right icon turned around. */
  .collapse-ico { display: inline-flex; color: var(--fg-muted); transform: rotate(180deg); flex-shrink: 0; }

  .muted-pad { padding: var(--sp-8); color: var(--fg-muted); font-style: italic; font-size: var(--fs-md); }

  .filter-bar {
    padding: var(--sp-4) var(--sp-6);
    border-bottom: 1px solid var(--border);
  }
  .filter-field { position: relative; height: 28px; display: flex; align-items: center; }
  .filter-ico {
    position: absolute; left: var(--sp-4);
    display: inline-flex; color: var(--fg-muted); pointer-events: none;
  }
  .filter-field input {
    flex: 1; min-width: 0; height: 100%;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    /* Left: search icon (margin + 14 px icon + gap). Right: room for the clear button. */
    padding: 0 var(--h-row) 0 calc(var(--sp-4) + var(--icon-sm) + var(--sp-3));
    font-size: var(--fs-md);
  }
  .filter-field input:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .filter-clear {
    position: absolute; right: var(--sp-1); top: 50%; transform: translateY(-50%);
    width: var(--h-row); height: var(--h-row); padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: 0; color: var(--fg-muted);
    border-radius: var(--radius); cursor: pointer;
  }
  .filter-clear:hover { color: var(--fg); }
</style>
