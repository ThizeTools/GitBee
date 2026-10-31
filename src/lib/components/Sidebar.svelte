<script lang="ts">
  import {
    currentRepo, localBranches, remoteBranches, tagsList,
    stashes, worktrees, graph, withBusy, openRepo,
  } from "$lib/stores/repo";
  import { ipc } from "$lib/ipc";
  import { showStash, showChanges } from "$lib/stores/rightpanel";
  import { layout, setSize } from "$lib/stores/layout";
  import { scrollGraphTo, checkoutAndJump, checkoutRemoteAndJump } from "$lib/stores/graphscroll";
  import { localBranchMenu, remoteBranchMenu, tagMenu } from "$lib/menus/refMenus";
  import { soloRefs, toggleSolo } from "$lib/stores/graphFilter";
  import { confirmDialog, promptDialog } from "$lib/stores/dialog";
  import { onMount } from "svelte";

  // True when the user is currently soloing at least one ref. Drives the
  // eye-icon affordance shown next to every branch row — letting the
  // user one-click-add another ref to the active solo set without
  // diving into the context menu. Hidden by default to avoid visual
  // noise when nobody's soloing.
  const soloActive = $derived($soloRefs.size > 0);

  // #5 round 7: filter input above the sections.
  let filter = $state("");
  let filterEl: HTMLInputElement | null = $state(null);

  function matches(s: string): boolean {
    if (!filter.trim()) return true;
    return s.toLowerCase().includes(filter.trim().toLowerCase());
  }

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
  import { openMenu, type MenuItem } from "$lib/stores/contextmenu";

  type SectionKey = "local" | "remote" | "worktrees" | "tags" | "stashes";
  let openSections = $state<Record<SectionKey, boolean>>({
    local: true, remote: true, worktrees: true, tags: false, stashes: true,
  });

  async function checkout(name: string) {
    await checkoutAndJump(name);
  }
  async function fetchRemote(name?: string) {
    if (!$currentRepo) return;
    await withBusy(() => ipc.remoteFetch($currentRepo!, name));
  }

  // #13 — double-click on a remote branch creates/switches to a local
  // tracking branch with the same name (last segment), then jumps the graph.
  async function checkoutRemote(remote: string, branch: string) {
    await checkoutRemoteAndJump(remote, branch);
  }

  function isHead(name: string): boolean { return $graph?.head_branch === name; }
  function toggleSection(k: SectionKey) { openSections[k] = !openSections[k]; }

  // Stash actions
  function selectStash(idx: number, sha: string) {
    showStash(idx);
    scrollGraphTo(sha);
  }
  async function applyStash(idx: number) {
    if (!$currentRepo) return;
    await withBusy(() => ipc.stashApply($currentRepo!, idx));
  }
  async function popStash(idx: number) {
    if (!$currentRepo) return;
    await withBusy(() => ipc.stashPop($currentRepo!, idx));
    showChanges();
  }
  async function dropStash(idx: number) {
    if (!$currentRepo) return;
    const ok = await confirmDialog({ title: `Drop stash@{${idx}}?`, confirmLabel: "Drop", danger: true });
    if (!ok) return;
    await withBusy(() => ipc.stashDrop($currentRepo!, idx));
    showChanges();
  }
  async function editStashMessage(idx: number, current: string) {
    if (!$currentRepo) return;
    const m = await promptDialog({ title: "Edit stash message:", initial: current, confirmLabel: "Save" });
    if (m === null) return;
    await withBusy(() => ipc.stashEditMessage($currentRepo!, idx, m));
  }

  let hiddenStashes = $state<Set<number>>(new Set());
  function hideStash(idx: number) { hiddenStashes.add(idx); hiddenStashes = new Set(hiddenStashes); }

  function stashMenu(idx: number, message: string): MenuItem[] {
    return [
      { label: "Apply Stash", icon: "↻", onClick: () => applyStash(idx) },
      { label: "Pop Stash", icon: "⤴", onClick: () => popStash(idx) },
      { label: "Delete Stash", icon: "🗑", danger: true, onClick: () => dropStash(idx) },
      { separator: true, label: "" },
      { label: "Edit stash message", icon: "✎", onClick: () => editStashMessage(idx, message) },
      { label: "Hide", icon: "○", onClick: () => hideStash(idx) },
    ];
  }

  function onStashContext(e: MouseEvent, idx: number, message: string) {
    openMenu(e, stashMenu(idx, message));
  }

  // Group remote branches by remote name for hierarchical display.
  // Keep the CommitRef so we have access to target_sha for single-click jump.
  type RemoteEntry = { name: string; sha: string };
  const remoteGroups = $derived.by(() => {
    const m = new Map<string, RemoteEntry[]>();
    for (const b of $remoteBranches) {
      const slash = b.name.indexOf("/");
      const remote = slash > 0 ? b.name.slice(0, slash) : "origin";
      const branch = slash > 0 ? b.name.slice(slash + 1) : b.name;
      const arr = m.get(remote) ?? [];
      arr.push({ name: branch, sha: b.target_sha });
      m.set(remote, arr);
    }
    return m;
  });

  const visibleStashes = $derived($stashes.filter((s) => !hiddenStashes.has(s.index) && matches(s.message)));
  const filteredLocal = $derived($localBranches.filter((b) => matches(b.name)));
  const filteredTags = $derived($tagsList.filter((t) => matches(t.name)));
  const filteredWorktrees = $derived($worktrees.filter((w) => matches(w.branch ?? w.path)));
  const filteredRemoteGroups = $derived.by(() => {
    if (!filter.trim()) return remoteGroups;
    const out = new Map<string, typeof remoteGroups extends Map<string, infer V> ? V : never>();
    for (const [remote, items] of remoteGroups) {
      const kept = items.filter((b) => matches(b.name) || matches(`${remote}/${b.name}`));
      if (kept.length > 0 || matches(remote)) out.set(remote, kept);
    }
    return out;
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

    <div class="section">
      <button class="section-head" onclick={() => toggleSection("local")}>
        <span class="caret">{openSections.local ? "▼" : "▶"}</span>
        <span class="title">Local</span>
        <span class="count">{$localBranches.length}</span>
      </button>
      {#if openSections.local}
        <ul class="list">
          {#each filteredLocal as b (b.name)}
            {@const inSolo = $soloRefs.has(b.name)}
            <li class="leaf" class:active={isHead(b.name)} class:solo-row={soloActive} class:solo-on={inSolo}>
              {#if soloActive}
                <button
                  class="eye"
                  class:on={inSolo}
                  onclick={(e) => { e.stopPropagation(); toggleSolo(b.name); }}
                  title={inSolo ? `Remove ${b.name} from solo` : `Add ${b.name} to solo`}
                >{inSolo ? "👁" : "👁‍🗨"}</button>
              {/if}
              <button
                class="link"
                onclick={() => scrollGraphTo(b.target_sha)}
                ondblclick={() => checkout(b.name)}
                oncontextmenu={(e) => openMenu(e, localBranchMenu(b.name, b.target_sha))}
                title="Click to jump · double-click to checkout: {b.name}"
              >
                <span class="ico">{isHead(b.name) ? "★" : "⎇"}</span>
                <span class="name">{b.name}</span>
              </button>
              <button
                class="dots"
                onclick={(e) => openMenu(e, localBranchMenu(b.name, b.target_sha))}
                title="More actions"
              >⋯</button>
            </li>
          {:else}
            <li class="muted">no branches</li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="section">
      <button class="section-head" onclick={() => toggleSection("remote")}>
        <span class="caret">{openSections.remote ? "▼" : "▶"}</span>
        <span class="title">Remote</span>
        <span class="count">{$remoteBranches.length}</span>
      </button>
      {#if openSections.remote}
        <ul class="list">
          {#each [...filteredRemoteGroups.entries()] as [remote, branches] (remote)}
            <li class="group">
              <button class="link group-head" onclick={() => fetchRemote(remote)} title="Click to fetch">
                <span class="ico">☁</span><span class="name">{remote}</span>
                <span class="count-inline">{branches.length}</span>
              </button>
              <ul class="nested">
                {#each branches as b (b.name)}
                  {@const qname = `${remote}/${b.name}`}
                  {@const inSolo = $soloRefs.has(qname)}
                  <li class="leaf" class:solo-row={soloActive} class:solo-on={inSolo}>
                    {#if soloActive}
                      <button
                        class="eye"
                        class:on={inSolo}
                        onclick={(e) => { e.stopPropagation(); toggleSolo(qname); }}
                        title={inSolo ? `Remove ${qname} from solo` : `Add ${qname} to solo`}
                      >{inSolo ? "👁" : "👁‍🗨"}</button>
                    {/if}
                    <button
                      class="link"
                      onclick={() => scrollGraphTo(b.sha)}
                      ondblclick={() => checkoutRemote(remote, b.name)}
                      oncontextmenu={(e) => openMenu(e, remoteBranchMenu(remote, b.name, b.sha))}
                      title="Click to jump · double-click to checkout {remote}/{b.name} locally"
                    ><span class="ico">⎇</span><span class="name">{b.name}</span></button>
                    <button
                      class="dots"
                      onclick={(e) => openMenu(e, remoteBranchMenu(remote, b.name, b.sha))}
                      title="More actions"
                    >⋯</button>
                  </li>
                {/each}
              </ul>
            </li>
          {:else}
            <li class="muted">no remotes</li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="section">
      <button class="section-head" onclick={() => toggleSection("worktrees")}>
        <span class="caret">{openSections.worktrees ? "▼" : "▶"}</span>
        <span class="title">Worktrees</span>
        <span class="count">{$worktrees.length}</span>
      </button>
      {#if openSections.worktrees}
        <ul class="list">
          {#each filteredWorktrees as w (w.path)}
            <li class="leaf" class:active={w.path === $currentRepo}>
              <button class="link" title={w.path} onclick={() => openRepo(w.path)}>
                <span class="ico">📂</span>
                <span class="name">{w.branch ?? w.path.split(/[\\/]/).filter(Boolean).pop()}</span>
              </button>
            </li>
          {:else}
            <li class="muted">none</li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="section">
      <button class="section-head" onclick={() => toggleSection("tags")}>
        <span class="caret">{openSections.tags ? "▼" : "▶"}</span>
        <span class="title">Tags</span>
        <span class="count">{$tagsList.length}</span>
      </button>
      {#if openSections.tags}
        <ul class="list">
          {#each filteredTags as t (t.name)}
            <li class="leaf">
              <button
                class="link"
                onclick={() => scrollGraphTo(t.target_sha)}
                oncontextmenu={(e) => openMenu(e, tagMenu(t.name, t.target_sha))}
                title="Jump to {t.name}"
              ><span class="ico">🏷</span><span class="name">{t.name}</span></button>
            </li>
          {:else}
            <li class="muted">no tags</li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="section">
      <button class="section-head" onclick={() => toggleSection("stashes")}>
        <span class="caret">{openSections.stashes ? "▼" : "▶"}</span>
        <span class="title">Stashes</span>
        <span class="count">{visibleStashes.length}</span>
      </button>
      {#if openSections.stashes}
        <ul class="list">
          {#each visibleStashes as s (s.index)}
            <li class="leaf">
              <button
                class="link"
                title={s.message}
                onclick={() => selectStash(s.index, s.sha)}
                oncontextmenu={(e) => onStashContext(e, s.index, s.message)}
              >
                <span class="ico">⛶</span>
                <span class="name">{s.message}</span>
              </button>
            </li>
          {:else}
            <li class="muted">no stashes</li>
          {/each}
        </ul>
      {/if}
    </div>
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

  .section { border-bottom: 1px solid var(--border); padding-bottom: 4px; }
  .section-head {
    display: flex; align-items: center; gap: 8px; width: 100%;
    background: transparent; border: 0; color: var(--fg-muted);
    padding: 6px 14px; font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.7px; font-weight: 700; cursor: pointer; text-align: left;
  }
  .section-head:hover { color: var(--fg); }
  .section-head .caret { font-size: 9px; width: 10px; }
  .section-head .title { flex: 1; }
  .count {
    font-size: 11px; background: var(--bg); color: var(--fg-muted);
    padding: 1px 8px; border-radius: 10px; font-weight: 600; border: 1px solid var(--border);
  }
  .count-inline { font-size: 10px; color: var(--fg-muted); margin-left: auto; }

  .list { list-style: none; margin: 0; padding: 0; }
  .nested { list-style: none; margin: 0; padding: 0 0 0 22px; }
  .leaf, .group { display: flex; align-items: center; padding-right: 8px; }
  .group { display: block; }
  .leaf .link, .group-head {
    flex: 1; background: transparent; border: 0; color: var(--fg);
    text-align: left; padding: 3px 14px 3px 26px; cursor: pointer;
    overflow: hidden; display: flex; gap: 8px; align-items: center;
    font-size: 12px; border-left: 2px solid transparent; width: 100%;
    line-height: 18px;
  }
  .group-head { padding-left: 28px; }
  /* readonly variant kept for future use (tags / remote heads). */
  .leaf .link:hover:not(.readonly), .group-head:hover {
    background: var(--bg); border-left-color: var(--border);
  }
  .leaf.active .link {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border-left-color: var(--accent); color: var(--accent); font-weight: 500;
  }
  .leaf .ico { width: 14px; text-align: center; flex-shrink: 0; font-size: 12px; color: var(--fg-muted); }
  .leaf.active .ico { color: var(--accent); }
  .leaf .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .muted { padding: 6px 28px; color: var(--fg-muted); font-style: italic; font-size: 11px; }
  .dots {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; padding: 0 8px; visibility: hidden;
    font-size: 16px; line-height: 1; border-radius: 3px;
  }
  .leaf:hover .dots { visibility: visible; }
  .dots:hover { color: var(--fg); background: rgba(255,255,255,0.06); }

  /* Eye toggle: only present while soloing. Sits at the left edge of the
     row (outside the .link's padding) so it reads as the "include this"
     affordance. Hover paints the whole row in accent so the click target
     is unambiguous; rows already in the solo set get the same fill but
     persistent. */
  .eye {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; padding: 0 4px 0 12px; line-height: 1;
    font-size: 13px; flex-shrink: 0;
    filter: grayscale(1) opacity(0.55);
  }
  .leaf.solo-row:hover .eye { filter: none; color: var(--accent); }
  .eye.on { filter: none; color: var(--accent); }
  .eye:hover { color: var(--accent); filter: none !important; }
  .leaf.solo-row:hover {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .leaf.solo-on {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .leaf.solo-on:hover {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
  }
  /* Strip the link's own bg/border-left under solo highlight so the row
     paints as a single colored strip — easier to scan when picking which
     branches to add. */
  .leaf.solo-row .link:hover { background: transparent; border-left-color: transparent; }
</style>
