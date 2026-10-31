<script lang="ts">
  // Unchanged lines between two conflict blocks. Long runs show only the three
  // lines on each side of the gap, so the blocks stay the focus.
  import Icon from "$lib/icons/Icon.svelte";

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
  <button class="gap" onclick={onToggle}><Icon name="more" size={12} /> {hidden} unchanged lines · show all</button>
  <pre class="ctx">{tail}</pre>
{/if}

<style>
  .ctx {
    margin: 0 var(--sp-8); padding: var(--sp-1) var(--sp-5);
    font-family: "Cascadia Code", Consolas, monospace; font-size: var(--fs-md); line-height: 18px;
    white-space: pre; color: var(--fg-muted); overflow: hidden;
  }
  /* Gap row: 24 px high, the toolbar hit size. */
  .gap {
    display: flex; align-items: center; gap: var(--sp-3);
    width: calc(100% - 2 * var(--sp-8)); height: var(--h-row); margin: var(--sp-1) var(--sp-8);
    background: transparent; border: 1px dashed var(--border); color: var(--fg-muted);
    padding: 0 var(--sp-5); border-radius: var(--radius); cursor: pointer; font-size: var(--fs-sm); text-align: left;
  }
  .gap:hover { color: var(--fg); border-color: var(--accent); }
</style>
