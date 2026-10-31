<script lang="ts">
  import "./diff/diff.css";
  import type { FileDiff } from "$lib/ipc";
  import { langForPath } from "$lib/diff/highlight";
  import { isImagePath } from "$lib/diff/image";
  import type { ImageRevs } from "$lib/diff/revs";
  import { diffPrefs } from "$lib/stores/diffPrefs";
  import DiffToolbar from "./diff/DiffToolbar.svelte";
  import UnifiedHunk from "./diff/UnifiedHunk.svelte";
  import SplitHunk from "./diff/SplitHunk.svelte";
  import ImageDiff from "./diff/ImageDiff.svelte";

  interface Props {
    diffs: FileDiff[];
    /** Image revisions. Without them image files show "Binary file". */
    revs?: ImageRevs | null;
    loading?: boolean;
  }
  let { diffs, revs = null, loading = false }: Props = $props();

  let collapsed = $state<Record<string, boolean>>({});
  function toggle(key: string): void { collapsed[key] = !collapsed[key]; }

  /** A deleted file's new side is "", so the old path names it. */
  function pathOf(f: FileDiff): string { return f.new_path || f.old_path; }

  function pathLabel(f: FileDiff): string {
    const renamed = f.old_path !== "" && f.new_path !== "" && f.old_path !== f.new_path;
    return renamed ? `${f.old_path} → ${f.new_path}` : pathOf(f);
  }

  function countKind(f: FileDiff, kind: "add" | "del"): number {
    return f.hunks.reduce((a, h) => a + h.lines.filter((l) => l.kind === kind).length, 0);
  }
</script>

<div class="dv-root">
  <DiffToolbar />
  {#if loading}
    <div class="dv-empty">Loading…</div>
  {:else if diffs.length === 0}
    <div class="dv-empty">No changes{$diffPrefs.ignoreWs ? " (whitespace hidden)" : ""}.</div>
  {:else}
    {#each diffs as f (pathOf(f))}
      {@const path = pathOf(f)}
      {@const lang = langForPath(path)}
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
            {:else}
              {#each f.hunks as h, i (i)}
                {#if $diffPrefs.layout === "split"}
                  <SplitHunk hunk={h} {lang} />
                {:else}
                  <UnifiedHunk hunk={h} {lang} />
                {/if}
              {/each}
              {#if f.omitted_lines > 0}
                <div class="dv-note">{f.omitted_lines.toLocaleString()} more lines not shown (diff too large)</div>
              {/if}
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>
