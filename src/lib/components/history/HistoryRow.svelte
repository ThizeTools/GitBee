<script lang="ts">
  // One commit in the file history list. A click selects it. The right-click
  // menu, or the ⋯ button, offers the row actions (see historyMenu.ts).
  import Avatar from "../Avatar.svelte";
  import type { FileLogEntry } from "$lib/ipc";
  import { openMenu } from "$lib/stores/contextmenu";
  import { formatRelativeDate } from "$lib/graph/relativeDate";
  import { statusName } from "$lib/commit/fileStatus";
  import { historyMenu } from "$lib/history/historyMenu";
  import { storeHistoryActions } from "$lib/history/historyActions";

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
  >⋯</button>
</li>

<style>
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
    gap: 8px;
    padding: 6px 8px 6px 12px;
    background: transparent;
    border: 0;
    color: var(--fg);
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .pick:hover { background: rgba(255, 255, 255, 0.05); }
  .text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .subject {
    font-size: 12px; font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .meta { font-size: 11px; color: var(--fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status {
    font-size: 10px; font-weight: 700; color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: 3px; padding: 0 4px; flex-shrink: 0;
  }
  .sha {
    font-family: "Cascadia Code", Consolas, monospace; font-size: 11px;
    color: var(--sha); flex-shrink: 0;
  }
  .more {
    background: transparent; border: 0; color: var(--fg-muted);
    padding: 0 10px; cursor: pointer; font-size: 14px;
  }
  .more:hover { color: var(--fg); }
</style>
