<script lang="ts">
  import { paletteOpen, activeThemeId, resolveTheme, customThemes } from "$lib/stores/ui";
  import { currentRepo, refreshAll, withBusy, recent, openRepo, graph } from "$lib/stores/repo";
  import { runAction } from "$lib/menus/menuActions";
  import { pushUndo } from "$lib/stores/history";
  import { branchCreateUndo } from "$lib/stores/undoEntries";
  import { ipc } from "$lib/ipc";
  import { promptDialog, requireName } from "$lib/stores/dialog";
  import { get } from "svelte/store";

  interface PaletteCmd {
    id: string;
    label: string;
    detail?: string;
    run: () => void | Promise<unknown>;
  }

  let query = $state("");
  let inputEl = $state<HTMLInputElement | undefined>(undefined);
  let activeIdx = $state(0);

  const commands = $derived.by<PaletteCmd[]>(() => {
    const list: PaletteCmd[] = [
      { id: "refresh", label: "Refresh repo", run: refreshAll },
      { id: "theme", label: "Toggle light/dark",
        // Flip between the two default builtins based on the CURRENT theme's
        // scheme — the old code string-compared the id to "dark"/"light" and so
        // discarded any custom/other theme (Dracula, Nord, …). (audit 2026-05)
        run: () => activeThemeId.update((id) => {
          const cur = resolveTheme(id, get(customThemes));
          return cur.vars.scheme === "dark" ? "light" : "dark";
        }) },
    ];
    if ($currentRepo) {
      list.push(
        { id: "fetch", label: "Fetch all remotes",
          run: () => withBusy(() => ipc.remoteFetch($currentRepo!)) },
        { id: "pull", label: "Pull",
          run: () => withBusy(() => ipc.remotePull($currentRepo!, false)) },
        { id: "pull-rebase", label: "Pull (rebase)",
          run: () => withBusy(() => ipc.remotePull($currentRepo!, true)) },
        { id: "stash-create", label: "Stash all changes",
          run: async () => {
            const m = await promptDialog({ title: "Stash message:", confirmLabel: "Stash" });
            // Cancelling (null) aborts the stash. An empty message means no message.
            if (m === null) return;
            await withBusy(() => ipc.stashCreate($currentRepo!, m || undefined, true));
          } },
        { id: "branch-create", label: "Create branch from HEAD",
          run: async () => {
            const repo = $currentRepo;
            const n = await promptDialog({ title: "Branch name:", validate: requireName });
            if (!n || !repo) return;
            const sha = get(graph)?.head_sha ?? undefined;
            const res = await runAction(`Create branch ${n}`, () => ipc.branchCreate(repo, n));
            if (res.ok) pushUndo(branchCreateUndo(repo, n, sha));
          } },
      );
    }
    for (const r of $recent) {
      list.push({
        id: `open-${r.id}`,
        label: `Open: ${r.path.split(/[\\/]/).pop() || r.path}`,
        detail: r.path,
        run: () => openRepo(r.path),
      });
    }
    return list;
  });

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      (c.detail?.toLowerCase().includes(q) ?? false)
    );
  });

  $effect(() => {
    if ($paletteOpen) {
      query = "";
      activeIdx = 0;
      setTimeout(() => inputEl?.focus(), 0);
    }
  });

  $effect(() => {
    void filtered;
    if (activeIdx >= filtered.length) activeIdx = 0;
  });

  function close() { paletteOpen.set(false); }

  async function run(cmd: PaletteCmd) {
    close();
    await cmd.run();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { close(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(filtered.length - 1, activeIdx + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = filtered[activeIdx];
      if (c) run(c);
    }
  }
</script>

{#if $paletteOpen}
  <div
    class="backdrop"
    role="presentation"
    onclick={close}
    onkeydown={(e) => e.key === "Escape" && close()}
  >
    <div
      class="palette"
      role="dialog"
      tabindex="-1"
      aria-label="Command palette"
      onclick={(e) => e.stopPropagation()}
      onkeydown={onKey}
    >
      <input
        bind:this={inputEl}
        bind:value={query}
        placeholder="Type a command…"
        spellcheck="false"
      />
      <ul>
        {#each filtered as c, i (c.id)}
          <li class:active={i === activeIdx}>
            <button onclick={() => run(c)} onmouseenter={() => activeIdx = i}>
              <span class="label">{c.label}</span>
              {#if c.detail}<span class="detail">{c.detail}</span>{/if}
            </button>
          </li>
        {:else}
          <li class="muted">no matches</li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    z-index: 1000;
    padding-top: 80px;
  }
  .palette {
    width: 560px;
    max-width: 90vw;
    max-height: 60vh;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  input {
    background: var(--bg);
    color: var(--fg);
    border: 0;
    border-bottom: 1px solid var(--border);
    padding: 12px 14px;
    font-size: 14px;
  }
  input:focus { outline: none; }
  ul { list-style: none; margin: 0; padding: 4px; overflow-y: auto; }
  li.muted { color: var(--fg-muted); padding: 12px; font-style: italic; }
  li button {
    width: 100%;
    background: transparent;
    border: 0;
    color: var(--fg);
    text-align: left;
    padding: 6px 10px;
    cursor: pointer;
    border-radius: 3px;
    display: flex;
    gap: 10px;
    align-items: center;
  }
  li.active button { background: color-mix(in srgb, var(--renamed) 40%, transparent); }
  li button:hover { background: color-mix(in srgb, var(--renamed) 40%, transparent); }
  .label { flex: 1; }
  .detail {
    color: var(--fg-muted);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 50%;
  }
</style>
