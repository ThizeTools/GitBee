<script lang="ts">
  // One commit in the file history list. A click selects it. The right-click
  // menu, or the more (…) icon button, offers the row actions (see historyMenu.ts).
  import Avatar from "../Avatar.svelte";
  import type { FileLogEntry } from "$lib/ipc";
  import { openMenu } from "$lib/stores/contextmenu";
  import { formatRelativeDate } from "$lib/graph/relativeDate";
  import { statusName } from "$lib/commit/fileStatus";
  import { historyMenu } from "$lib/history/historyMenu";
  import { storeHistoryActions } from "$lib/history/historyActions";
  import Icon from "$lib/icons/Icon.svelte";

  interface Props {
    entry: FileLogEntry;
    selected: boolean;
    onSelect: () => void;
  }
  let { entry, selected, onSelect }: Props = $props();

  // Read once per mount. Relative dates only need to be roughly current.
  const now = Date.now();
</script>

<li class="row" class:selected>
  <button
    class="pick"
    type="button"
    title={entry.subject}
    onclick={onSelect}
    oncontextmenu={(e) => openMenu(e, historyMenu(entry, storeHistoryActions))}
  >
    <Avatar email={entry.author_email} name={entry.author_name} size={18} />
    <span class="text">
      <span class="subject">{entry.subject}</span>
      <span class="meta">{entry.author_name} · {formatRelativeDate(entry.timestamp, now)}</span>
    </span>
    {#if entry.status !== "M"}
      <span class="status" title={statusName(entry.status)}>{entry.status}</span>
    {/if}
    <span class="sha">{entry.sha.slice(0, 7)}</span>
  </button>
  <button
    class="more"
    type="button"
    title="Actions"
    aria-label="Actions for {entry.sha.slice(0, 7)}"
    onclick={(e) => openMenu(e, historyMenu(entry, storeHistoryActions))}
  ><Icon name="more" size={14} /></button>
</li>

<style>
  /* Two-line row: 28 px, the list-row size in the layout spec. */
  .row {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--border);
  }
  .row.selected { background: var(--border-strong); }
  .pick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    min-height: 28px;
    padding: 0 var(--sp-3) 0 var(--sp-6);
    background: transparent;
    border: 0;
    color: var(--fg);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .pick:hover { background: color-mix(in srgb, var(--fg) 5%, transparent); }
  .text { display: flex; flex-direction: column; min-width: 0; flex: 1; line-height: 1.2; }
  .subject {
    font-size: var(--fs-md); font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .meta { font-size: var(--fs-sm); color: var(--fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status {
    font-size: var(--fs-xs); font-weight: 700; color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: var(--radius-sm); padding: 0 var(--sp-2); flex-shrink: 0;
  }
  .sha {
    font-family: "Cascadia Code", Consolas, monospace; font-size: var(--fs-sm);
    color: var(--sha); flex-shrink: 0;
  }
  .more {
    align-self: center;
    display: inline-flex; align-items: center; justify-content: center;
    width: var(--h-row); height: var(--h-row); margin-right: var(--sp-2);
    padding: 0; flex-shrink: 0;
    background: transparent; border: 0; border-radius: var(--radius);
    color: var(--fg-muted); cursor: pointer;
  }
  .more:hover { color: var(--fg); background: var(--border); }
</style>
