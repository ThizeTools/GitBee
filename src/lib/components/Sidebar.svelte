<script lang="ts">
  import { currentRepo, localBranches, remoteBranches, tagsList, worktrees } from "$lib/stores/repo";
  import { setSize } from "$lib/stores/layout";
  import { openMenu } from "$lib/stores/contextmenu";
  import { activeSubmodules } from "$lib/stores/submodules";
  import { onMount } from "svelte";
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

  type SectionKey = "local" | "remote" | "worktrees" | "submodules" | "tags" | "stashes";
  // Kept here, not in the sections, so the open state survives a repo switch.
  let openSections = $state<Record<SectionKey, boolean>>({
    local: true, remote: true, worktrees: true, submodules: true, tags: false, stashes: true,
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
    <span class="collapse-ico">‹</span>
  </button>

  {#if !$currentRepo}
    <div class="muted-pad">Open a repository from a tab to begin.</div>
  {:else}
    <div class="filter-bar">
      <span class="filter-ico">⌕</span>
      <input
        bind:this={filterEl}
        bind:value={filter}
        placeholder="Filter (Ctrl+Alt+F)"
        spellcheck="false"
      />
      {#if filter}
        <button class="filter-clear" onclick={() => filter = ""} title="Clear">×</button>
      {/if}
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

    {#if $activeSubmodules.length > 0}
      <SidebarSection title="Submodules" count={$activeSubmodules.length}
        open={openSections.submodules} ontoggle={() => toggleSection("submodules")}
        onMenu={(e) => openMenu(e, submoduleHeaderMenu($currentRepo ?? ""))}>
        <SubmoduleList repo={$currentRepo ?? ""} {filter} />
      </SidebarSection>
    {/if}

    <SidebarSection title="Tags" count={$tagsList.length}
      open={openSections.tags} ontoggle={() => toggleSection("tags")}>
      <TagList {filter} />
    </SidebarSection>

    <SidebarSection title="Stashes" count={stashCount}
      open={openSections.stashes} ontoggle={() => toggleSection("stashes")}>
      <StashList {filter} bind:count={stashCount} />
    </SidebarSection>
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
  .brand {
    display: flex; align-items: center; gap: 10px;
    padding: 14px 16px; border: 0; border-bottom: 1px solid var(--border-strong);
    font-size: 14px; background: transparent; color: var(--fg);
    cursor: pointer; text-align: left; width: 100%;
  }
  .brand:hover { background: var(--bg-elev); }
  .brand .logo { width: 32px; height: 32px; object-fit: contain; flex-shrink: 0; }
  .brand strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .collapse-ico { color: var(--fg-muted); font-size: 16px; line-height: 1; }

  .muted-pad { padding: 16px; color: var(--fg-muted); font-style: italic; font-size: 12px; }

  .filter-bar {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 12px;
    background: transparent;
    border-bottom: 1px solid var(--border);
  }
  .filter-bar .filter-ico { color: var(--fg-muted); font-size: 12px; }
  .filter-bar input {
    flex: 1; min-width: 0;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 5px 8px;
    font-size: 12px;
  }
  .filter-bar input:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .filter-clear {
    background: transparent; border: 0; color: var(--fg-muted);
    font-size: 16px; line-height: 1; cursor: pointer; padding: 0 4px;
  }
  .filter-clear:hover { color: var(--fg); }
</style>
