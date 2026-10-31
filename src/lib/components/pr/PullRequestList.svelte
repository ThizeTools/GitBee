<script lang="ts">
  // The left column of the pull-request view: one row per PR. Review and check
  // status are not in the list (they cost a request per PR); the detail pane
  // loads them for the selected row only.
  import type { PullRow } from "$lib/github/pullTypes";
  import { pullRowModel } from "$lib/github/pulls";

  interface Props {
    rows: PullRow[];
    selected: number | null;
    nowMs: number;
    onSelect: (number: number) => void;
  }
  let { rows, selected, nowMs, onSelect }: Props = $props();
</script>

<ul class="list">
  {#each rows as pr (pr.number)}
    {@const m = pullRowModel(pr, nowMs)}
    <li>
      <button
        class="row"
        class:selected={selected === pr.number}
        onclick={() => onSelect(pr.number)}
        title={pr.title}
      >
        <div class="top">
          <span class="num">{m.numberLabel}</span>
          <span class="title">{m.title}</span>
          <span class="badge badge-{m.badge.toLowerCase()}">{m.badge}</span>
        </div>
        <div class="meta">
          {#if pr.author_avatar}
            <img class="avatar" src={pr.author_avatar} alt="" width="14" height="14" />
          {/if}
          <span class="author">{m.author}</span>
          <span class="route" title={m.route}>{m.route}</span>
          {#if m.crossRepo}<span class="fork" title="Opened from a fork">fork</span>{/if}
          <span class="when">{m.updated}</span>
        </div>
      </button>
    </li>
  {/each}
</ul>

<style>
  .list { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; min-height: 0; }
  .row {
    display: flex; flex-direction: column; gap: 3px; width: 100%;
    background: transparent; border: 0; border-bottom: 1px solid var(--border);
    color: var(--fg); text-align: left; padding: 8px 10px; cursor: pointer;
    font-size: 12px; min-width: 0;
  }
  .row:hover { background: rgba(255,255,255,0.04); }
  .row.selected { background: var(--border); }
  .top { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .num { color: var(--fg-muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .meta { display: flex; align-items: center; gap: 6px; color: var(--fg-muted); font-size: 11px; min-width: 0; }
  .avatar { border-radius: 50%; flex-shrink: 0; }
  .author { flex-shrink: 0; }
  .route { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: "Cascadia Code", Consolas, monospace; }
  .fork { border: 1px solid var(--border-strong); border-radius: 3px; padding: 0 4px; flex-shrink: 0; }
  .when { flex-shrink: 0; }
  .badge {
    font-size: 10px; padding: 1px 6px; border-radius: 9px; flex-shrink: 0;
    border: 1px solid var(--border-strong); color: var(--fg-muted);
  }
  .badge-open { color: #3fb950; border-color: rgba(63, 185, 80, 0.5); }
  .badge-merged { color: #a371f7; border-color: rgba(163, 113, 247, 0.5); }
  .badge-closed { color: #f85149; border-color: rgba(248, 81, 73, 0.5); }
  .badge-draft { color: var(--fg-muted); }
</style>
