<script lang="ts">
  import "./diff/diff.css";
  import type { FileDiff } from "$lib/ipc";
  import { langForPath } from "$lib/diff/highlight";
  import { isImagePath } from "$lib/diff/image";
  import type { ImageRevs } from "$lib/diff/revs";
  import type { PatchAction } from "$lib/diff/patchAction";
  import type { LineRef, PatchSelection } from "$lib/diff/patchBuilder";
  import {
    NO_PICK, extendPick, linesSelection, pickOnly, pickedInHunk, toggleLine, type LinePick,
  } from "$lib/diff/lineSelection";
  import { diffPrefs } from "$lib/stores/diffPrefs";
  import DiffToolbar from "./diff/DiffToolbar.svelte";
  import UnifiedHunk from "./diff/UnifiedHunk.svelte";
  import SplitHunk from "./diff/SplitHunk.svelte";
  import ImageDiff from "./diff/ImageDiff.svelte";
  import LineSelectionBar from "./diff/LineSelectionBar.svelte";
  import LfsPointerCard from "./diff/LfsPointerCard.svelte";
  import { pointerPairOf } from "$lib/lfs/pointer";
  import type { DiffMode, HunkView } from "./diff/hunkView";

  interface Props {
    diffs: FileDiff[];
    /** Image revisions. Without them image files show "Binary file". */
    revs?: ImageRevs | null;
    loading?: boolean;
    /** unstaged: stage or discard hunks and lines. staged: unstage them. readonly: no actions. */
    mode?: DiffMode;
    /** Runs a hunk or line action on one file. The caller runs git and refreshes. */
    onPatch?: (file: FileDiff, selection: PatchSelection, action: PatchAction) => void;
  }
  let { diffs, revs = null, loading = false, mode = "readonly", onPatch }: Props = $props();

  let collapsed = $state<Record<string, boolean>>({});
  function toggle(key: string): void { collapsed[key] = !collapsed[key]; }

  // Picked lines belong to one load of the diff. A reload (after an action, a
  // refresh or a whitespace toggle) clears them, so no pick names a moved line.
  let picks = $state<Record<string, LinePick>>({});
  $effect(() => { void diffs; picks = {}; });

  // Hunk actions need the exact diff: -w hides changes that the file really has.
  const stagingOn = $derived(mode !== "readonly" && !$diffPrefs.ignoreWs);
  const stagingOff = $derived(mode !== "readonly" && $diffPrefs.ignoreWs);

  /** A deleted file's new side is "", so the old path names it. */
  function pathOf(f: FileDiff): string { return f.new_path || f.old_path; }

  function pathLabel(f: FileDiff): string {
    const renamed = f.old_path !== "" && f.new_path !== "" && f.old_path !== f.new_path;
    return renamed ? `${f.old_path} → ${f.new_path}` : pathOf(f);
  }

  function countKind(f: FileDiff, kind: "add" | "del"): number {
    return f.hunks.reduce((a, h) => a + h.lines.filter((l) => l.kind === kind).length, 0);
  }

  function pickOf(path: string): LinePick { return picks[path] ?? NO_PICK; }
  function setPick(path: string, next: LinePick): void { picks[path] = next; }

  /** Shift+click extends the range from the anchor, Ctrl+click toggles one line,
   * and a plain click picks that line alone. */
  function pickLine(f: FileDiff, ref: LineRef, e: MouseEvent): void {
    const path = pathOf(f);
    const current = pickOf(path);
    if (e.shiftKey) setPick(path, extendPick(current, ref, f.hunks));
    else if (e.ctrlKey || e.metaKey) setPick(path, toggleLine(current, ref));
    else setPick(path, pickOnly(ref));
  }

  /** The hunk's view for the hunk components. A truncated diff (omitted lines)
   * is not offered for actions, because its hunks may be partial. */
  function viewFor(f: FileDiff, hunkIndex: number): HunkView {
    return {
      mode,
      actionsOn: stagingOn && f.omitted_lines === 0,
      picked: pickedInHunk(pickOf(pathOf(f)), hunkIndex),
      onHunkAction: (action) => onPatch?.(f, { kind: "hunk", hunkIndex }, action),
      onLinePick: (line, e) => pickLine(f, { hunk: hunkIndex, line }, e),
    };
  }
</script>

<div class="dv-root">
  <DiffToolbar stagingOff={stagingOff} />
  {#if loading}
    <div class="dv-empty">Loading…</div>
  {:else if diffs.length === 0}
    <div class="dv-empty">No changes{$diffPrefs.ignoreWs ? " (whitespace hidden)" : ""}.</div>
  {:else}
    {#each diffs as f (pathOf(f))}
      {@const path = pathOf(f)}
      {@const lang = langForPath(path)}
      {@const pointer = pointerPairOf(f)}
      <div class="dv-file">
        <button class="dv-file-head" onclick={() => toggle(path)}>
          <span class="dv-caret">{collapsed[path] ? "▶" : "▼"}</span>
          <span class="dv-path">{pathLabel(f)}</span>
          <span class="dv-stats">+{countKind(f, "add")} -{countKind(f, "del")}</span>
        </button>
        {#if !collapsed[path]}
          <div class="dv-hunks">
            {#if f.binary && isImagePath(path) && revs}
              <ImageDiff file={f} {revs} />
            {:else if f.binary}
              <div class="dv-note">Binary file</div>
            {:else if pointer}
              <LfsPointerCard {pointer} />
            {:else}
              {#each f.hunks as h, i (i)}
                {#if $diffPrefs.layout === "split"}
                  <SplitHunk hunk={h} {lang} view={viewFor(f, i)} />
                {:else}
                  <UnifiedHunk hunk={h} {lang} view={viewFor(f, i)} />
                {/if}
              {/each}
              {#if f.omitted_lines > 0}
                <div class="dv-note">{f.omitted_lines.toLocaleString()} more lines not shown (diff too large)</div>
              {/if}
              {#if stagingOn && f.omitted_lines === 0 && pickOf(path).refs.length > 0}
                <LineSelectionBar
                  count={pickOf(path).refs.length}
                  staged={mode === "staged"}
                  onAction={(action) => onPatch?.(f, linesSelection(pickOf(path)), action)}
                  onClear={() => setPick(path, NO_PICK)}
                />
              {/if}
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>
