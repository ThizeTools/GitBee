<script lang="ts">
  // Unchanged lines between two conflict blocks. Long runs show only the three
  // lines on each side of the gap, so the blocks stay the focus.
  interface Props {
    lines: string[];
    expanded: boolean;
    onToggle: () => void;
  }
  let { lines, expanded, onToggle }: Props = $props();

  const EDGE = 3;
  const collapsible = $derived(lines.length > EDGE * 2);
  const head = $derived(lines.slice(0, EDGE).join("\n"));
  const tail = $derived(lines.slice(-EDGE).join("\n"));
  const hidden = $derived(lines.length - EDGE * 2);
</script>

{#if !collapsible || expanded}
  <pre class="ctx">{lines.join("\n")}</pre>
  {#if collapsible}
    <button class="gap" onclick={onToggle}>Collapse unchanged lines</button>
  {/if}
{:else}
  <pre class="ctx">{head}</pre>
  <button class="gap" onclick={onToggle}>⋯ {hidden} unchanged lines · show all</button>
  <pre class="ctx">{tail}</pre>
{/if}

<style>
  .ctx {
    margin: 0 14px; padding: 2px 10px;
    font-family: "Cascadia Code", Consolas, monospace; font-size: 12px; line-height: 18px;
    white-space: pre; color: var(--fg-muted); overflow: hidden;
  }
  .gap {
    display: block; width: calc(100% - 28px); margin: 2px 14px;
    background: transparent; border: 1px dashed var(--border); color: var(--fg-muted);
    padding: 2px 10px; border-radius: 3px; cursor: pointer; font-size: 11px; text-align: left;
  }
  .gap:hover { color: var(--fg); border-color: var(--accent); }
</style>
