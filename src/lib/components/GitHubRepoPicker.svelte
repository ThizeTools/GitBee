<script lang="ts">
  import { ghAuth, ghRepos, ghReposLoading, ghReposError, fetchRepos, logoutGithub } from "$lib/stores/github";
  import { onMount } from "svelte";
  import Avatar from "./Avatar.svelte";
  import Icon from "$lib/icons/Icon.svelte";
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
      <button class:active={viewMode === "list"} onclick={() => viewMode = "list"}
        title="Grouped list" aria-label="Grouped list"><Icon name="logs" size={14} /></button>
      <button class:active={viewMode === "tabs"} onclick={() => viewMode = "tabs"}
        title="Tabs by owner" aria-label="Tabs by owner"><Icon name="folder" size={14} /></button>
    </span>
    <button class="ghost" onclick={() => fetchRepos(true)}
      title="Refresh repo list" aria-label="Refresh repo list"><Icon name="fetch" size={14} /></button>
    <button class="ghost danger" onclick={logoutGithub}
      title="Sign out" aria-label="Sign out"><Icon name="sign-out" size={14} /></button>
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
            <span class="caret">
              <Icon name={isCollapsed(g.owner) ? "chevron-right" : "chevron-down"} size={14} />
            </span>
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
                    {#if r.private}<Icon name="lock" size={12} title="Private" />{/if}
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
                  {#if r.private}<Icon name="lock" size={12} title="Private" />{/if}
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
    border-radius: var(--radius-lg);
    overflow: hidden;
    min-height: 280px;
    max-height: 480px;
  }
  .picker-head {
    display: flex; align-items: center; gap: var(--sp-4);
    padding: var(--sp-4) var(--sp-6);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .signed { font-weight: 600; font-size: var(--fs-md); }
  .spacer { flex: 1; }
  /* Icon buttons: 24 px hit target (--h-row). */
  .ghost {
    display: inline-flex; align-items: center; justify-content: center;
    height: var(--h-row); min-width: var(--h-row);
    background: transparent; color: var(--fg-muted);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 0 var(--sp-4); cursor: pointer;
  }
  .ghost:hover { color: var(--fg); border-color: var(--fg-muted); }
  .ghost.danger:hover { color: var(--del); border-color: var(--del); }

  .filter {
    margin: var(--sp-4) var(--sp-6);
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-3) var(--sp-5); font-size: var(--fs-md);
  }
  .filter:focus { outline: 1px solid var(--accent); outline-offset: -1px; }

  .list { flex: 1; overflow-y: auto; padding: 0 var(--sp-2) var(--sp-4); }
  .empty {
    flex: 1; display: flex; align-items: center; justify-content: center;
    gap: var(--sp-5); color: var(--fg-muted); font-size: var(--fs-md); padding: var(--sp-8);
  }
  .empty.err { color: var(--del); }

  .group { margin: var(--sp-2) 0; }
  .group-head {
    width: 100%;
    display: flex; align-items: center; gap: var(--sp-4);
    height: var(--h-row);
    padding: 0 var(--sp-4);
    background: transparent; border: 0; cursor: pointer;
    color: var(--fg);
    text-align: left;
    border-radius: var(--radius-sm);
  }
  .group-head:hover { background: rgba(255,255,255,0.04); }
  .caret {
    display: flex; align-items: center; justify-content: center;
    width: var(--icon-sm); color: var(--fg-muted);
  }
  .owner-avatar { width: 18px; height: 18px; border-radius: 50%; }
  .owner-name { font-weight: 600; font-size: var(--fs-md); }
  .count { color: var(--fg-muted); font-size: var(--fs-sm); margin-left: auto; }

  ul { list-style: none; margin: 0; padding: 0; }
  li { border-radius: var(--radius-sm); }
  li.selected { background: color-mix(in srgb, var(--accent) 20%, transparent); }
  .row {
    display: flex; align-items: center; gap: var(--sp-4);
    width: 100%;
    height: var(--h-row);
    padding: 0 var(--sp-5) 0 calc(var(--sp-8) * 2);
    background: transparent; border: 0;
    color: var(--fg); cursor: pointer;
    text-align: left;
    font-size: var(--fs-md);
  }
  .row:hover { background: rgba(255,255,255,0.04); }
  li.selected .row { background: transparent; }
  .name { font-weight: 600; }
  .desc {
    color: var(--fg-muted); font-size: var(--fs-sm);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1; min-width: 0;
  }
  .when {
    color: var(--fg-muted); font-size: var(--fs-xs);
    font-family: "Cascadia Code", Consolas, monospace;
  }

  .spinner {
    width: var(--icon); height: var(--icon);
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
    border-radius: var(--radius);
    overflow: hidden;
  }
  .view-seg button {
    display: inline-flex; align-items: center; justify-content: center;
    height: var(--h-row); min-width: var(--h-row);
    background: transparent; color: var(--fg-muted); border: 0;
    padding: 0 var(--sp-4); cursor: pointer;
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
    height: var(--h-tabbar);
  }
  .tabstrip::-webkit-scrollbar { height: 0; }
  .tab {
    display: inline-flex; align-items: center; gap: var(--sp-3);
    padding: 0 var(--sp-6);
    background: transparent;
    border: 0;
    border-right: 1px solid var(--border);
    color: var(--fg-muted);
    cursor: pointer;
    font-size: var(--fs-md);
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
    border-radius: var(--radius-lg);
    padding: 0 var(--sp-3);
    font-size: var(--fs-xs);
    flex-shrink: 0;
  }
  .tab.active .tab-count {
    background: var(--bg);
    color: var(--fg);
  }
  .tab-body { flex: 1; overflow-y: auto; padding: var(--sp-2); }
  .row.tabrow { padding-left: var(--sp-6); }
</style>
