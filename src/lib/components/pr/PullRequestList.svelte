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
  /* Two-line row at the 28 px list-row size: title line, then the meta line. */
  .row {
    display: flex; flex-direction: column; justify-content: center; width: 100%;
    min-height: 28px; gap: 0; background: transparent; border: 0; border-bottom: 1px solid var(--border);
    color: var(--fg); text-align: left; padding: 0 var(--sp-5); cursor: pointer;
    font-size: var(--fs-md); line-height: 1.2; min-width: 0;
  }
  .row:hover { background: color-mix(in srgb, var(--fg) 4%, transparent); }
  .row.selected { background: var(--border); }
  .top { display: flex; align-items: center; gap: var(--sp-3); min-width: 0; }
  .num { color: var(--fg-muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .meta { display: flex; align-items: center; gap: var(--sp-3); color: var(--fg-muted); font-size: var(--fs-sm); min-width: 0; }
  .avatar { border-radius: 50%; flex-shrink: 0; }
  .author { flex-shrink: 0; }
  .route { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: "Cascadia Code", Consolas, monospace; }
  .fork { border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 0 var(--sp-2); flex-shrink: 0; }
  .when { flex-shrink: 0; }
  /* State pill: 18 px high (no token), radius-sm. */
  .badge {
    display: inline-flex; align-items: center; height: 18px; font-size: var(--fs-xs);
    padding: 0 var(--sp-3); border-radius: var(--radius-sm); flex-shrink: 0;
    border: 1px solid var(--border-strong); color: var(--fg-muted);
  }
  .badge-open { color: var(--add); border-color: color-mix(in srgb, var(--add) 50%, transparent); }
  .badge-merged { color: var(--remote); border-color: color-mix(in srgb, var(--remote) 50%, transparent); }
  .badge-closed { color: var(--del); border-color: color-mix(in srgb, var(--del) 50%, transparent); }
  .badge-draft { color: var(--fg-muted); }
</style>
