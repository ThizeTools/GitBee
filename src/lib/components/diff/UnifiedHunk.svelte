<script lang="ts">
  import type { Hunk } from "$lib/ipc";
  import { renderLine, linePrefix } from "$lib/diff/lineHtml";
  import { wordRangesByLine } from "$lib/diff/linePairs";

  interface Props { hunk: Hunk; lang: string | null; }
  let { hunk, lang }: Props = $props();

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

<div class="dv-hunk">
  <div class="dv-hunk-header">{hunk.header}</div>
  {#each rows as r (r.j)}
    <div class="dv-line dv-{r.ln.kind}">
      <span class="dv-num">{r.ln.old_no ?? ""}</span>
      <span class="dv-num">{r.ln.new_no ?? ""}</span>
      <span class="dv-content"><span class="dv-sign">{linePrefix(r.ln.kind)}</span>{@html r.html}</span>
    </div>
  {/each}
</div>
