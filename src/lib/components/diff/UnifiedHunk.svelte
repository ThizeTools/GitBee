<script lang="ts">
  import type { DiffLine, Hunk } from "$lib/ipc";
  import { renderLine, linePrefix } from "$lib/diff/lineHtml";
  import { wordRangesByLine } from "$lib/diff/linePairs";
  import { isChangeLine } from "$lib/diff/patchBuilder";
  import HunkHeader from "./HunkHeader.svelte";
  import type { HunkView } from "./hunkView";

  interface Props { hunk: Hunk; lang: string | null; view: HunkView; }
  let { hunk, lang, view }: Props = $props();

  // Highlighting is computed once per hunk, not on every render of the template.
  const rows = $derived.by(() => {
    const ranges = wordRangesByLine(hunk.lines);
    return hunk.lines.map((ln, j) => ({
      ln,
      j,
      html: renderLine(ln.content, lang, ranges.get(j)),
    }));
  });
</script>

{#snippet gutter(no: number | null, line: DiffLine, j: number)}
  {#if view.actionsOn && isChangeLine(line)}
    <button type="button" class="dv-num dv-pick" class:dv-picked={view.picked.has(j)}
      onclick={(e) => view.onLinePick(j, e)}>{no ?? ""}</button>
  {:else}
    <span class="dv-num">{no ?? ""}</span>
  {/if}
{/snippet}

<div class="dv-hunk">
  <HunkHeader header={hunk.header} {view} />
  {#each rows as r (r.j)}
    <div class="dv-line dv-{r.ln.kind}">
      {@render gutter(r.ln.old_no, r.ln, r.j)}
      {@render gutter(r.ln.new_no, r.ln, r.j)}
      <span class="dv-content" class:dv-picked={view.picked.has(r.j)}><span class="dv-sign">{linePrefix(r.ln.kind)}</span>{@html r.html}</span>
    </div>
  {/each}
</div>
