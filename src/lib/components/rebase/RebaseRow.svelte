<script lang="ts">
  // One commit of the rebase editor: drag handle, action, subject, and the
  // message box when the row has one. Keys act only while the row itself has
  // focus, so typing in the message box or the select keeps its own keys.
  import { REBASE_ACTIONS, type RebaseAction, type RebaseEntry } from "$lib/rebase/types";
  import { keyAction, parseAction, shortSha } from "$lib/rebase/model";
  import Icon from "$lib/icons/Icon.svelte";

  interface Props {
    index: number;
    entry: RebaseEntry;
    editable: boolean;
    dropTarget: boolean;
    onAction: (action: RebaseAction) => void;
    onDraft: (text: string) => void;
    onMove: (to: number) => void;
    onFocus: (index: number) => void;
    onDragStart: (event: DragEvent) => void;
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
    onDragEnd: () => void;
  }

  let {
    index, entry, editable, dropTarget,
    onAction, onDraft, onMove, onFocus,
    onDragStart, onDragOver, onDrop, onDragEnd,
  }: Props = $props();

  // A message is shown only once it is loaded or typed; until then the box is disabled.
  const messageText = $derived(entry.draft ?? entry.fullMessage ?? "");
  const messageReady = $derived(entry.draft !== null || entry.fullMessage !== null);

  // WHY Alt+Up/Down move the row and plain Up/Down only move focus: the
  // editor needs both, and the hint line in the modal names both.
  function onKey(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const step = event.key === "ArrowUp" ? -1 : 1;
      if (event.altKey) onMove(index + step);
      else onFocus(index + step);
      return;
    }
    const action = keyAction(event.key);
    if (action !== null) {
      event.preventDefault();
      onAction(action);
    }
  }

  function onSelect(event: Event): void {
    const action = parseAction((event.currentTarget as HTMLSelectElement).value);
    if (action !== null) onAction(action);
  }

  function onType(event: Event): void {
    onDraft((event.currentTarget as HTMLTextAreaElement).value);
  }
</script>

<!-- The row is the focus stop for keyboard reordering (Up/Down, Alt+Up/Down, p/r/s/f/d),
     so it must take focus and read the keys. Its controls keep their own keys. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="item"
  class:dropped={entry.action === "drop"}
  class:target={dropTarget}
  role="listitem"
  tabindex="0"
  data-row
  onkeydown={onKey}
  ondragover={onDragOver}
  ondrop={onDrop}
>
  <div class="line">
    <span
      class="handle"
      role="button"
      tabindex="-1"
      draggable="true"
      title="Drag to reorder"
      aria-label="Drag to reorder"
      ondragstart={onDragStart}
      ondragend={onDragEnd}
    ><Icon name="grip" size={14} /></span>
    <select class="action" aria-label="Action for {shortSha(entry.sha)}" value={entry.action} onchange={onSelect}>
      {#each REBASE_ACTIONS as action (action)}
        <option value={action}>{action}</option>
      {/each}
    </select>
    <code class="sha">{shortSha(entry.sha)}</code>
    <span class="subject" title={entry.subject}>{entry.subject}</span>
    <span class="author">{entry.author}</span>
  </div>
  {#if editable}
    <textarea
      class="message"
      rows="4"
      spellcheck="false"
      aria-label="Message for {shortSha(entry.sha)}"
      placeholder={messageReady ? "Commit message" : "Loading message…"}
      value={messageText}
      disabled={!messageReady}
      oninput={onType}
    ></textarea>
    {#if entry.loadError !== null}
      <div class="error">Could not load the message: {entry.loadError}</div>
    {/if}
  {/if}
</div>

<style>
  .item {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    padding: var(--sp-3) var(--sp-4);
    display: flex; flex-direction: column; gap: var(--sp-3);
  }
  .item:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .item.target { border-color: var(--accent); }
  .item.dropped .subject, .item.dropped .sha { text-decoration: line-through; color: var(--fg-muted); }
  .line { display: flex; align-items: center; gap: var(--sp-4); min-width: 0; font-size: var(--fs-md); }
  .handle {
    display: flex; align-items: center;
    cursor: grab; color: var(--fg-muted); user-select: none; padding: 0 var(--sp-1);
  }
  .action {
    background: var(--bg-elev); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-1) var(--sp-2); font-size: var(--fs-sm); width: 88px;
  }
  .sha { color: var(--accent); font-family: "Cascadia Code", Consolas, monospace; font-size: var(--fs-sm); }
  .subject { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .author { color: var(--fg-muted); font-size: var(--fs-sm); white-space: nowrap; }
  .message {
    background: var(--bg-elev); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-3) var(--sp-4); font-size: var(--fs-md); resize: vertical;
    font-family: "Cascadia Code", Consolas, monospace;
  }
  .message:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .message:disabled { color: var(--fg-muted); }
  .error { font-size: var(--fs-sm); color: var(--del); }
</style>
