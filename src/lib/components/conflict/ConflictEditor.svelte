<script lang="ts">
  import { get } from "svelte/store";
  import { ipc } from "$lib/ipc";
  import { currentRepo, opState, status } from "$lib/stores/repo";
  import { showConflict, showGraph } from "$lib/stores/center";
  import { saveResolution, takeSide } from "$lib/conflict/actions";
  import {
    canSave, indexSegments, pickNextConflictedPath, resolvedCount, stepConflict,
  } from "$lib/conflict/choices";
  import { activeOp, sideNames } from "$lib/conflict/labels";
  import { looksBinary, parseConflicts, resolveConflicts, type ConflictChoice } from "$lib/conflict/parse";
  import { editFile } from "$lib/components/staging/fileActions";
  import ConflictBlockView from "./ConflictBlockView.svelte";
  import ConflictContext from "./ConflictContext.svelte";

  // Center-pane resolver for one conflicted file. Shows every block with both
  // sides, takes a choice per block, and saves only when none is left undecided.
  // See docs/specs/conflict-resolution.md.
  interface Props { file: string; }
  let { file }: Props = $props();

  let text = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let choices = $state<Record<number, ConflictChoice>>({});
  let current = $state(0);
  let expandedContext = $state<Set<number>>(new Set());
  let saving = $state(false);
  let loadSeq = 0;

  const binary = $derived(text !== null && looksBinary(text));
  const doc = $derived(text === null || binary ? null : parseConflicts(text));
  const rows = $derived(doc ? indexSegments(doc) : []);
  const count = $derived(doc ? doc.conflicts.length : 0);
  const done = $derived(doc ? resolvedCount(doc, choices) : 0);
  const result = $derived(doc ? resolveConflicts(doc, choices) : "");
  const saveable = $derived(doc !== null && canSave(doc, choices));
  const names = $derived(sideNames(activeOp($opState)));
  const saveTip = $derived(saveTooltip(count - done, saveable));

  $effect(() => { void load(file); });

  async function load(path: string): Promise<void> {
    const repo = get(currentRepo);
    if (!repo) return;
    const seq = ++loadSeq;
    choices = {};
    current = 0;
    text = null;
    loadError = null;
    try {
      const body = await ipc.fileRead(repo, path);
      if (seq === loadSeq) text = body;
    } catch (e) {
      if (seq === loadSeq) loadError = String(e);
    }
  }

  function choose(index: number, choice: ConflictChoice): void {
    choices = { ...choices, [index]: choice };
  }

  function toggleContext(i: number): void {
    const next = new Set(expandedContext);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    expandedContext = next;
  }

  function goTo(index: number): void {
    current = index;
    document.getElementById(`conflict-block-${index}`)?.scrollIntoView({ block: "center" });
  }

  function step(dir: 1 | -1): void {
    goTo(stepConflict(current, count, dir));
  }

  /** After a file is resolved or taken, open the next conflicted file or return to the graph. */
  function leaveResolved(): void {
    const next = pickNextConflictedPath(get(status), file);
    if (next === null) showGraph();
    else showConflict(next);
  }

  function stillConflicted(): boolean {
    return get(status).some((s) => s.path === file && s.conflicted);
  }

  async function save(): Promise<void> {
    if (!doc || !saveable || saving) return;
    saving = true;
    const ok = await saveResolution(file, result);
    saving = false;
    if (ok) leaveResolved();
  }

  async function takeWhole(side: "ours" | "theirs"): Promise<void> {
    await takeSide(file, side, names[side]);
    if (!stillConflicted()) leaveResolved();
  }

  function saveTooltip(remaining: number, ok: boolean): string {
    if (ok) return "Write the file and stage it as resolved";
    if (remaining > 0) return `Choose a result for the ${remaining} remaining ${remaining === 1 ? "conflict" : "conflicts"}`;
    return "Conflict markers remain in the file. Fix them by hand or in an external editor";
  }
</script>

<section class="editor">
  <header class="top">
    <div class="id">
      <span class="kind">Conflict</span>
      <span class="file" title={file}>{file}</span>
    </div>
    <span class="progress">
      {#if doc === null || count === 0}
        {binary ? "binary file" : "no conflict blocks"}
      {:else}
        {done} of {count} conflicts resolved
      {/if}
    </span>
    <div class="nav">
      <button onclick={() => step(-1)} disabled={count === 0 || current === 0}>◀ Previous</button>
      <button onclick={() => step(1)} disabled={count === 0 || current >= count - 1}>Next ▶</button>
    </div>
    <span class="spacer"></span>
    <button class="cancel" onclick={showGraph}>Cancel</button>
    {#if !binary}
      <span class="save-wrap" title={saveTip}>
        <button class="save" onclick={save} disabled={!saveable || saving}>Save &amp; mark resolved</button>
      </span>
    {/if}
  </header>

  <div class="body">
    {#if loadError}
      <div class="notice err">Could not read {file}: {loadError}</div>
    {:else if text === null}
      <div class="notice">Loading…</div>
    {:else if binary}
      <div class="notice">binary — choose Mine or Theirs for the whole file.</div>
      <div class="whole">
        <button onclick={() => takeWhole("ours")}>{`Take ${names.ours.toLowerCase()}`}</button>
        <button onclick={() => takeWhole("theirs")}>{`Take ${names.theirs.toLowerCase()}`}</button>
      </div>
    {:else if doc}
      {#if doc.malformed}
        <div class="notice warn">
          A conflict marker is not part of a complete block, so it is shown as plain text.
          Remove it in an external editor. Save stays disabled while any marker remains.
          <button onclick={() => editFile(file)}>Open in external editor</button>
        </div>
      {/if}
      {#if count === 0}
        <div class="notice">No conflict blocks in this file. Save marks it resolved.</div>
      {/if}
      {#each rows as row, i (i)}
        {#if row.segment.kind === "text"}
          <ConflictContext
            lines={row.segment.lines}
            expanded={expandedContext.has(i)}
            onToggle={() => toggleContext(i)}
          />
        {:else}
          <ConflictBlockView
            block={row.segment}
            index={row.blockIndex}
            total={count}
            {names}
            choice={choices[row.blockIndex]}
            active={row.blockIndex === current}
            onChoose={(c) => choose(row.blockIndex, c)}
          />
        {/if}
      {/each}
    {/if}
  </div>
</section>

<style>
  .editor { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg); }
  .top {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 8px 14px; background: var(--bg-elev); border-bottom: 1px solid var(--border-strong);
    flex-shrink: 0;
  }
  .id { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 40%; }
  .kind {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700;
    color: var(--del);
  }
  .file {
    font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; color: var(--fg);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .progress { font-size: 11px; color: var(--fg-muted); }
  .nav { display: flex; gap: 6px; }
  .spacer { flex: 1; }
  .top button {
    background: var(--bg); color: var(--fg); border: 1px solid var(--border);
    padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 11px;
  }
  .top button:disabled { opacity: 0.45; cursor: not-allowed; }
  .top button.save {
    background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); border-color: var(--accent);
  }
  .top button.save:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .body { flex: 1; min-height: 0; overflow: auto; padding-bottom: 14px; }
  .notice {
    margin: 12px 14px 0; padding: 8px 12px; border-radius: 4px; font-size: 12px;
    color: var(--fg-muted); border: 1px solid var(--border);
  }
  .notice.warn { color: var(--modified); border-color: var(--modified); }
  .notice.err { color: var(--del); border-color: var(--del); }
  .notice button { margin-left: 8px; }
  .whole { display: flex; gap: 8px; margin: 12px 14px; }
  .whole button {
    background: var(--bg-elev); color: var(--fg); border: 1px solid var(--border);
    padding: 6px 12px; border-radius: 3px; cursor: pointer; font-size: 12px;
  }
</style>
