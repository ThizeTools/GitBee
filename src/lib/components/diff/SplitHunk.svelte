<script lang="ts">
  import type { Hunk, LineKind } from "$lib/ipc";
  import { renderLine, linePrefix } from "$lib/diff/lineHtml";
  import { wordRangesByLine } from "$lib/diff/linePairs";
  import { toSplitRows, type SplitCell } from "$lib/diff/splitRows";
  import type { CharRange } from "$lib/diff/wordDiff";

  interface Props { hunk: Hunk; lang: string | null; }
  let { hunk, lang }: Props = $props();

  interface RenderedCell { kind: LineKind; no: number | null; html: string; }

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
      html: renderLine(cell.content, language, ranges.get(cell.index)),
    };
  }
</script>

{#snippet side(c: RenderedCell | null)}
  {#if c}
    <span class="dv-num dv-{c.kind}">{c.no ?? ""}</span>
    <span class="dv-content dv-{c.kind}"><span class="dv-sign">{linePrefix(c.kind)}</span>{@html c.html}</span>
  {:else}
    <span class="dv-num dv-blank"></span>
    <span class="dv-content dv-blank"></span>
  {/if}
{/snippet}

<div class="dv-hunk">
  <div class="dv-hunk-header">{hunk.header}</div>
  {#each rows as r, k (k)}
    <div class="dv-split-row">
      {@render side(r.left)}
      {@render side(r.right)}
    </div>
  {/each}
</div>
