<script lang="ts">
  import type { Hunk, LineKind } from "$lib/ipc";
  import { renderLine, linePrefix } from "$lib/diff/lineHtml";
  import { wordRangesByLine } from "$lib/diff/linePairs";
  import { toSplitRows, type SplitCell } from "$lib/diff/splitRows";
  import type { CharRange } from "$lib/diff/wordDiff";
  import HunkHeader from "./HunkHeader.svelte";
  import type { HunkView } from "./hunkView";

  interface Props { hunk: Hunk; lang: string | null; view: HunkView; }
  let { hunk, lang, view }: Props = $props();

  /** `index` is the line in the hunk. A picked row uses it on either side. */
  interface RenderedCell { kind: LineKind; no: number | null; index: number; html: string; }

  // Rows and highlighting are derived once per hunk, like UnifiedHunk.
  const rows = $derived.by(() => {
    const ranges = wordRangesByLine(hunk.lines);
    return toSplitRows(hunk).map((row) => ({
      left: renderCell(row.left, lang, ranges),
      right: renderCell(row.right, lang, ranges),
    }));
  });

  function renderCell(
    cell: SplitCell | null,
    language: string | null,
    ranges: ReadonlyMap<number, CharRange[]>,
  ): RenderedCell | null {
    if (cell === null) return null;
    return {
      kind: cell.kind,
      no: cell.no,
      index: cell.index,
      html: renderLine(cell.content, language, ranges.get(cell.index)),
    };
  }
</script>

{#snippet side(c: RenderedCell | null)}
  {#if c}
    {#if view.actionsOn && (c.kind === "add" || c.kind === "del")}
      <button type="button" class="dv-num dv-{c.kind} dv-pick" class:dv-picked={view.picked.has(c.index)}
        onclick={(e) => view.onLinePick(c.index, e)}>{c.no ?? ""}</button>
    {:else}
      <span class="dv-num dv-{c.kind}">{c.no ?? ""}</span>
    {/if}
    <span class="dv-content dv-{c.kind}" class:dv-picked={view.picked.has(c.index)}><span class="dv-sign">{linePrefix(c.kind)}</span>{@html c.html}</span>
  {:else}
    <span class="dv-num dv-blank"></span>
    <span class="dv-content dv-blank"></span>
  {/if}
{/snippet}

<div class="dv-hunk">
  <HunkHeader header={hunk.header} {view} />
  {#each rows as r, k (k)}
    <div class="dv-split-row">
      {@render side(r.left)}
      {@render side(r.right)}
    </div>
  {/each}
</div>
