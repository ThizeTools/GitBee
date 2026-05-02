<script lang="ts">
  import { ghAuth, ghRepos, ghReposLoading, ghReposError, fetchRepos, logoutGithub } from "$lib/stores/github";
  import { onMount } from "svelte";
  import Avatar from "./Avatar.svelte";
  import type { GhRepo } from "$lib/ipc";

  interface Props {
    selected: GhRepo | null;
    onSelect: (r: GhRepo | null) => void;
  }
  let { selected, onSelect }: Props = $props();

  let filter = $state("");
  let collapsed = $state<Record<string, boolean>>({});
  // #19 — two view modes: "list" stacks every group vertically (current),
  // "tabs" shows one tab per owner with that owner's repos in the body.
  let viewMode = $state<"list" | "tabs">("list");
  let activeTab = $state<string | null>(null);

  onMount(() => { fetchRepos(); });

  // Group by owner. Auth user's own repos first, then orgs alphabetical.
  const groups = $derived.by(() => {
    const all = $ghRepos ?? [];
    const f = filter.trim().toLowerCase();
    const filtered = f
      ? all.filter((r) =>
          r.name.toLowerCase().includes(f) ||
          r.owner.toLowerCase().includes(f) ||
          (r.description ?? "").toLowerCase().includes(f),
        )
      : all;
    const map = new Map<string, { owner: string; avatar: string; repos: GhRepo[] }>();
    for (const r of filtered) {
      const g = map.get(r.owner) ?? { owner: r.owner, avatar: r.owner_avatar, repos: [] };
      g.repos.push(r);
      map.set(r.owner, g);
    }
    const me = $ghAuth.login;
    const arr = [...map.values()];
    arr.sort((a, b) => {
      if (a.owner === me) return -1;
      if (b.owner === me) return 1;
      return a.owner.localeCompare(b.owner);
    });
    return arr;
  });

  function relative(ts: number): string {
    if (!ts) return "";
    const secs = Math.max(0, Math.floor(Date.now() / 1000) - ts);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    if (secs < 86400 * 30) return `${Math.floor(secs / 86400)}d ago`;
    if (secs < 86400 * 365) return `${Math.floor(secs / 86400 / 30)}mo ago`;
    return `${Math.floor(secs / 86400 / 365)}y ago`;
  }

  function toggle(owner: string) {
    collapsed[owner] = !collapsed[owner];
  }

  // When the user is filtering, show every group expanded — too noisy
  // otherwise; collapsed=true is only respected when filter is empty.
  function isCollapsed(owner: string): boolean {
    if (filter.trim().length > 0) return false;
    return !!collapsed[owner];
  }

  // Keep activeTab valid as the groups list changes (filtering, refresh).
  $effect(() => {
    if (groups.length === 0) { activeTab = null; return; }
    if (!activeTab || !groups.find((g) => g.owner === activeTab)) {
      activeTab = groups[0].owner;
    }
  });

  const activeGroup = $derived(
    activeTab ? groups.find((g) => g.owner === activeTab) ?? null : null
  );
</script>

<div class="picker">
  <header class="picker-head">
    <Avatar email={null} name={$ghAuth.login} size={20} />
    <span class="signed">{$ghAuth.login}</span>
    <span class="spacer"></span>
    <span class="view-seg">
      <button class:active={viewMode === "list"} onclick={() => viewMode = "list"} title="Grouped list">≡</button>
      <button class:active={viewMode === "tabs"} onclick={() => viewMode = "tabs"} title="Tabs by owner">⊞</button>
    </span>
    <button class="ghost" onclick={() => fetchRepos(true)} title="Refresh repo list">↻</button>
    <button class="ghost danger" onclick={logoutGithub} title="Sign out">⏻</button>
  </header>

  <input
    class="filter"
    placeholder="Filter repos…"
    bind:value={filter}
  />

  {#if $ghReposLoading && !$ghRepos}
    <div class="empty"><div class="spinner"></div> Loading repos…</div>
  {:else if $ghReposError}
    <div class="empty err">Failed to load: {$ghReposError}</div>
  {:else if groups.length === 0}
    <div class="empty">No repos match "{filter}".</div>
  {:else if viewMode === "list"}
    <div class="list">
      {#each groups as g (g.owner)}
        <div class="group">
          <button class="group-head" onclick={() => toggle(g.owner)}>
            <span class="caret">{isCollapsed(g.owner) ? "▶" : "▼"}</span>
            <img class="owner-avatar" src={g.avatar} alt="" />
            <span class="owner-name">{g.owner}</span>
            <span class="count">{g.repos.length}</span>
          </button>
          {#if !isCollapsed(g.owner)}
            <ul>
              {#each g.repos as r (`${r.owner}/${r.name}`)}
                <li class:selected={selected?.clone_url === r.clone_url}>
                  <button class="row" onclick={() => onSelect(r)}>
                    <span class="name">{r.name}</span>
                    {#if r.private}<span class="lock" title="Private">🔒</span>{/if}
                    {#if r.description}<span class="desc">{r.description}</span>{/if}
                    <span class="when">{relative(r.pushed_at)}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <!-- Tabs view: one tab per owner, body shows that owner's repos -->
    <div class="tabs">
      <div class="tabstrip">
        {#each groups as g (g.owner)}
          <button
            class="tab"
            class:active={activeTab === g.owner}
            onclick={() => activeTab = g.owner}
            title={g.owner}
          >
            <img class="tab-avatar" src={g.avatar} alt="" />
            <span class="tab-name">{g.owner}</span>
            <span class="tab-count">{g.repos.length}</span>
          </button>
        {/each}
      </div>
      <div class="tab-body">
        {#if activeGroup}
          <ul>
            {#each activeGroup.repos as r (`${r.owner}/${r.name}`)}
              <li class:selected={selected?.clone_url === r.clone_url}>
                <button class="row tabrow" onclick={() => onSelect(r)}>
                  <span class="name">{r.name}</span>
                  {#if r.private}<span class="lock" title="Private">🔒</span>{/if}
                  {#if r.description}<span class="desc">{r.description}</span>{/if}
                  <span class="when">{relative(r.pushed_at)}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .picker {
    display: flex; flex-direction: column;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    min-height: 280px;
    max-height: 480px;
  }
  .picker-head {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .signed { font-weight: 600; font-size: 12px; }
  .spacer { flex: 1; }
  .ghost {
    background: transparent; color: var(--fg-muted);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 4px 8px; cursor: pointer; font-size: 11px;
  }
  .ghost:hover { color: var(--fg); border-color: var(--fg-muted); }
  .ghost.danger:hover { color: var(--del); border-color: var(--del); }

  .filter {
    margin: 8px 12px;
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 6px 10px; font-size: 12px;
  }
  .filter:focus { outline: 1px solid var(--accent); outline-offset: -1px; }

  .list { flex: 1; overflow-y: auto; padding: 0 4px 8px; }
  .empty {
    flex: 1; display: flex; align-items: center; justify-content: center;
    gap: 10px; color: var(--fg-muted); font-size: 12px; padding: 30px;
  }
  .empty.err { color: var(--del); }

  .group { margin: 4px 0; }
  .group-head {
    width: 100%;
    display: flex; align-items: center; gap: 8px;
    padding: 6px 8px;
    background: transparent; border: 0; cursor: pointer;
    color: var(--fg);
    text-align: left;
    border-radius: 3px;
  }
  .group-head:hover { background: rgba(255,255,255,0.04); }
  .caret { color: var(--fg-muted); font-size: 9px; width: 10px; }
  .owner-avatar { width: 18px; height: 18px; border-radius: 50%; }
  .owner-name { font-weight: 700; font-size: 12px; }
  .count { color: var(--fg-muted); font-size: 11px; margin-left: auto; }

  ul { list-style: none; margin: 0; padding: 0; }
  li { border-radius: 3px; }
  li.selected { background: color-mix(in srgb, var(--accent) 20%, transparent); }
  .row {
    display: flex; align-items: center; gap: 8px;
    width: 100%;
    padding: 5px 10px 5px 32px;
    background: transparent; border: 0;
    color: var(--fg); cursor: pointer;
    text-align: left;
    font-size: 12px;
  }
  .row:hover { background: rgba(255,255,255,0.04); }
  li.selected .row { background: transparent; }
  .name { font-weight: 600; }
  .lock { font-size: 10px; }
  .desc {
    color: var(--fg-muted); font-size: 11px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1; min-width: 0;
  }
  .when {
    color: var(--fg-muted); font-size: 10px;
    font-family: "Cascadia Code", Consolas, monospace;
  }

  .spinner {
    width: 16px; height: 16px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* View toggle in the header */
  .view-seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }
  .view-seg button {
    background: transparent; color: var(--fg-muted); border: 0;
    padding: 3px 8px; cursor: pointer; font-size: 12px;
    line-height: 1;
  }
  .view-seg button.active {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--fg);
  }
  .view-seg button:hover:not(.active) { color: var(--fg); }

  /* Tabs view */
  .tabs {
    flex: 1; display: flex; flex-direction: column; min-height: 0;
  }
  .tabstrip {
    display: flex;
    overflow-x: auto;
    border-bottom: 1px solid var(--border-strong);
    background: var(--bg);
    flex-shrink: 0;
    height: 34px;
  }
  .tabstrip::-webkit-scrollbar { height: 0; }
  .tab {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 0 12px;
    background: transparent;
    border: 0;
    border-right: 1px solid var(--border);
    color: var(--fg-muted);
    cursor: pointer;
    font-size: 12px;
    height: 100%;
    flex-shrink: 0;
    max-width: 200px;
    position: relative;
  }
  .tab:hover { color: var(--fg); background: rgba(255,255,255,0.04); }
  .tab.active { color: var(--fg); background: var(--bg-elev); }
  .tab.active::after {
    content: ""; position: absolute; left: 0; right: 0; top: 0;
    height: 2px; background: var(--accent);
  }
  .tab-avatar { width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0; }
  .tab-name {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-weight: 600;
  }
  .tab-count {
    color: var(--fg-muted);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0 6px;
    font-size: 10px;
    flex-shrink: 0;
  }
  .tab.active .tab-count {
    background: var(--bg);
    color: var(--fg);
  }
  .tab-body { flex: 1; overflow-y: auto; padding: 4px; }
  .row.tabrow { padding-left: 12px; }
</style>
