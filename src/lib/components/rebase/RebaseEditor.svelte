<script lang="ts">
  // Interactive rebase editor. Rows are newest first, like the graph. Start
  // sends the list to rebase_interactive, which replays it oldest first.
  // Mounted by lib/rebase/open.ts. Spec: docs/specs/interactive-rebase.md.
  import { tick, untrack } from "svelte";
  import { ipc } from "$lib/ipc";
  import { runAction } from "$lib/menus/menuActions";
  import { pushUndo } from "$lib/stores/history";
  import { interactiveRebaseUndo } from "$lib/stores/undoEntries";
  import { notifySuccess, notifyWarn } from "$lib/stores/notifications";
  import Icon from "$lib/icons/Icon.svelte";
  import {
    editableFlags, firstProblem, indexOfSha, moveRow, shortSha, summary, toItems, updateRow,
  } from "$lib/rebase/model";
  import type { RebaseAction, RebaseEntry, RebaseOutcome } from "$lib/rebase/types";
  import RebaseRow from "./RebaseRow.svelte";

  interface Props {
    repo: string;
    base: string;
    rows: RebaseEntry[];
    onClose: () => void;
  }

  let { repo, base, rows: initialRows, onClose }: Props = $props();
  let rows = $state<RebaseEntry[]>(untrack(() => initialRows));
  let busy = $state(false);
  let error = $state<string | null>(null);
  let dragFrom = $state<number | null>(null);
  let dragOver = $state<number | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  const flags = $derived(editableFlags(rows));
  const problem = $derived(firstProblem(rows));
  const countLabel = $derived(summary(rows));
  const canStart = $derived(problem === null && !busy);

  // Shas whose message is already requested. Kept out of reactive state so
  // the effect below does not re-run when a request is recorded.
  const requested = new Set<string>();

  $effect(() => {
    rows.forEach((entry, index) => {
      if (!flags[index] || entry.fullMessage !== null || entry.loadError !== null) return;
      if (requested.has(entry.sha)) return;
      requested.add(entry.sha);
      void loadMessage(entry.sha);
    });
  });

  async function loadMessage(sha: string): Promise<void> {
    try {
      const text = await ipc.commitShow(repo, sha);
      patchRow(sha, { fullMessage: text.trimEnd() });
    } catch (e) {
      patchRow(sha, { loadError: String(e) });
    }
  }

  function patchRow(sha: string, change: Partial<RebaseEntry>): void {
    rows = updateRow(rows, indexOfSha(rows, sha), change);
  }

  function setAction(index: number, action: RebaseAction): void {
    rows = updateRow(rows, index, { action });
  }

  function setDraft(index: number, draft: string): void {
    rows = updateRow(rows, index, { draft });
  }

  function focusRow(index: number): void {
    const items = listEl?.querySelectorAll<HTMLElement>("[data-row]");
    items?.[index]?.focus();
  }

  // Focus follows the moved row, so Alt+Up can be pressed again at once.
  async function moveAndFocus(from: number, to: number): Promise<void> {
    rows = moveRow(rows, from, to);
    await tick();
    focusRow(to);
  }

  function startDrag(index: number, event: DragEvent): void {
    dragFrom = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      // Firefox will not start a drag without some data set.
      event.dataTransfer.setData("text/plain", rows[index].sha);
    }
  }

  function hoverRow(index: number, event: DragEvent): void {
    if (dragFrom === null) return;
    event.preventDefault();
    dragOver = index;
  }

  function dropOn(index: number, event: DragEvent): void {
    event.preventDefault();
    if (dragFrom !== null) rows = moveRow(rows, dragFrom, index);
    endDrag();
  }

  function endDrag(): void {
    dragFrom = null;
    dragOver = null;
  }

  function closeUnlessBusy(): void {
    if (!busy) onClose();
  }

  // WHY the editor stops key events: the app's shortcuts (graph keys, undo)
  // must not fire while the list has focus.
  function onRootKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      closeUnlessBusy();
    } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void start();
    }
  }

  async function start(): Promise<void> {
    if (!canStart) return;
    busy = true;
    error = null;
    const res = await runAction(`Interactive rebase onto ${shortSha(base)}`, () =>
      ipc.rebaseInteractive(repo, base, toItems(rows)),
    );
    busy = false;
    if (!res.ok) {
      error = res.error;
      return;
    }
    report(res.value);
    onClose();
  }

  // Undo only when the rebase finished. A stopped one is in progress, and the
  // conflict flow owns it from here.
  function report(outcome: RebaseOutcome): void {
    if (outcome.status === "stopped") {
      notifyWarn("Rebase stopped", outcome.message);
      return;
    }
    if (outcome.after !== null) pushUndo(interactiveRebaseUndo(repo, outcome.before, outcome.after));
    notifySuccess("Interactive rebase finished", outcome.message);
  }
</script>

<div class="backdrop" role="presentation" onclick={closeUnlessBusy}>
  <div
    class="modal"
    role="dialog"
    aria-label="Interactive rebase"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={onRootKey}
  >
    <header class="modal-head">
      <span class="title">Interactive rebase <code>onto {shortSha(base)}</code></span>
      <button class="x" onclick={closeUnlessBusy} title="Close" aria-label="Close" disabled={busy}>
        <Icon name="close" size={16} />
      </button>
    </header>

    <div class="hint">
      Newest first. Drag the handle, or press Alt+Up / Alt+Down, to reorder.
      Up / Down move focus. p pick · r reword · s squash · f fixup · d drop.
    </div>

    <div class="list" role="list" bind:this={listEl}>
      {#each rows as entry, index (entry.sha)}
        <RebaseRow
          {index}
          {entry}
          editable={flags[index]}
          dropTarget={dragOver === index && dragFrom !== null && dragFrom !== index}
          onAction={(action) => setAction(index, action)}
          onDraft={(text) => setDraft(index, text)}
          onMove={(to) => void moveAndFocus(index, to)}
          onFocus={focusRow}
          onDragStart={(event) => startDrag(index, event)}
          onDragOver={(event) => hoverRow(index, event)}
          onDrop={(event) => dropOn(index, event)}
          onDragEnd={endDrag}
        />
      {/each}
    </div>

    {#if error !== null}
      <div class="error">{error}</div>
    {/if}

    <footer class="modal-foot">
      <span class="count">{countLabel}</span>
      {#if problem !== null}
        <span class="problem">{problem}</span>
      {/if}
      <span class="spacer"></span>
      <button class="ghost" onclick={closeUnlessBusy} disabled={busy}>Cancel</button>
      <button class="primary" onclick={start} disabled={!canStart}>
        {busy ? "Rebasing…" : "Start rebase"}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 1500;
  }
  .modal {
    width: min(720px, 94vw);
    max-height: 86vh;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: 0 18px 50px rgba(0,0,0,0.6);
    display: flex; flex-direction: column;
    color: var(--fg);
    min-height: 0;
  }
  /* Dialog header: 10 px 20 px padding, bottom border, --fs-lg title. */
  .modal-head {
    display: flex; align-items: center;
    padding: var(--sp-5) var(--sp-20);
    border-bottom: 1px solid var(--border-strong);
  }
  .title { font-weight: 600; font-size: var(--fs-lg); flex: 1; }
  .title code { color: var(--accent); font-family: "Cascadia Code", Consolas, monospace; }
  .x {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px;
    background: transparent; border: 0; border-radius: var(--radius);
    color: var(--fg-muted); cursor: pointer;
  }
  .x:hover:not(:disabled) { color: var(--fg); }
  .hint {
    font-size: var(--fs-sm); color: var(--fg-muted);
    padding: var(--sp-4) var(--sp-20) 0;
  }
  .list {
    display: flex; flex-direction: column; gap: var(--sp-3);
    padding: var(--sp-5) var(--sp-20);
    overflow: auto;
    min-height: 0;
  }
  .error {
    font-size: var(--fs-sm); color: var(--del);
    margin: 0 var(--sp-20) var(--sp-4);
  }
  /* Footer: right-aligned, 28 px buttons. */
  .modal-foot {
    display: flex; align-items: center; gap: var(--sp-4);
    padding: var(--sp-5) var(--sp-20);
    border-top: 1px solid var(--border-strong);
    font-size: var(--fs-md);
  }
  .count { font-weight: 600; white-space: nowrap; }
  .problem { color: var(--modified); font-size: var(--fs-sm); }
  .spacer { flex: 1; }
  .ghost {
    height: 28px;
    display: inline-flex; align-items: center;
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 0 var(--sp-6); cursor: pointer; font-size: var(--fs-md);
  }
  .ghost:hover:not(:disabled) { border-color: var(--fg-muted); }
  .primary {
    height: 28px;
    display: inline-flex; align-items: center;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    padding: 0 var(--sp-8);
    cursor: pointer;
    font-weight: 600; font-size: var(--fs-md);
  }
  .primary:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .primary:disabled {
    background: transparent; color: var(--fg-muted);
    border-color: var(--border); cursor: not-allowed;
  }
</style>
