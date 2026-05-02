<script lang="ts">
  import type { FileDiff } from "$lib/ipc";

  interface Props { diffs: FileDiff[]; }
  let { diffs }: Props = $props();

  let collapsed = $state<Record<string, boolean>>({});
  function toggle(p: string) { collapsed[p] = !collapsed[p]; }

  function prefix(kind: string): string {
    switch (kind) {
      case "add": return "+";
      case "del": return "-";
      case "context": return " ";
      case "nonewline": return "\\";
      default: return " ";
    }
  }
</script>

<div class="diff-root">
  {#each diffs as f (f.new_path)}
    <div class="file">
      <button class="file-head" onclick={() => toggle(f.new_path)}>
        <span class="caret">{collapsed[f.new_path] ? "▶" : "▼"}</span>
        <span class="path">
          {#if f.old_path !== f.new_path}{f.old_path} → {/if}{f.new_path}
        </span>
        <span class="stats">
          +{f.hunks.reduce((a, h) => a + h.lines.filter(l => l.kind === "add").length, 0)}
          -{f.hunks.reduce((a, h) => a + h.lines.filter(l => l.kind === "del").length, 0)}
        </span>
      </button>
      {#if !collapsed[f.new_path]}
        <div class="hunks">
          {#if f.binary}
            <div class="binary">Binary file</div>
          {:else}
            {#each f.hunks as h, i (i)}
              <div class="hunk">
                <div class="hunk-header">{h.header}</div>
                {#each h.lines as ln, j (j)}
                  <div class="line {ln.kind}">
                    <span class="num">{ln.old_no ?? ""}</span>
                    <span class="num">{ln.new_no ?? ""}</span>
                    <span class="content">{prefix(ln.kind)}{ln.content}</span>
                  </div>
                {/each}
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .diff-root {
    height: 100%;
    overflow: auto;
    background: var(--bg);
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 12px;
  }
  .file { border-bottom: 1px solid var(--border); }
  .file-head {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--bg-elev);
    color: var(--fg);
    border: 0;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    text-align: left;
    font-family: inherit;
  }
  .file-head:hover { background: var(--border); }
  .caret { width: 12px; color: var(--fg-muted); }
  .path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stats { font-size: 11px; color: var(--fg-muted); }
  .hunks { padding: 0; }
  .binary { padding: 12px; color: var(--fg-muted); font-style: italic; }
  .hunk-header {
    background: color-mix(in srgb, var(--renamed) 12%, transparent);
    color: var(--renamed);
    padding: 2px 10px;
    font-size: 11px;
  }
  .line {
    display: grid;
    grid-template-columns: 50px 50px 1fr;
    line-height: 1.5;
    white-space: pre;
  }
  .line .num {
    color: var(--fg-muted);
    text-align: right;
    padding: 0 6px;
    user-select: none;
    font-size: 11px;
    background: var(--bg-elev);
    border-right: 1px solid var(--border);
  }
  .line .content { padding: 0 10px; overflow: hidden; }
  /* Diff colors are intentionally NOT theme-tied — added always reads green
     and removed always red, regardless of accent, so the diff stays
     universally readable across themes. */
  .line.add { background: color-mix(in srgb, var(--add) 10%, transparent); }
  .line.add .content { color: var(--add); }
  .line.del { background: color-mix(in srgb, var(--del) 10%, transparent); }
  .line.del .content { color: var(--del); }
  .line.context .content { color: var(--fg); }
  .line.nonewline .content { color: var(--fg-muted); font-style: italic; }
</style>
