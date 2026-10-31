<script lang="ts">
  // One palette row: the title with the matched characters marked, an optional
  // subtitle, and the category on the right. Mouse hover moves the selection.
  import type { PaletteItem } from "$lib/palette/types";
  import { segmentTitle } from "$lib/palette/highlight";

  interface Props {
    item: PaletteItem;
    positions: number[];
    index: number;
    active: boolean;
    onRun: () => void;
    onHover: () => void;
  }

  let { item, positions, index, active, onRun, onHover }: Props = $props();
  const segments = $derived(segmentTitle(item.title, positions));
</script>

<li data-idx={index} class:active>
  <button type="button" onclick={onRun} onmouseenter={onHover}>
    <span class="title">{#each segments as seg, s (s)}{#if seg.match}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}</span>
    {#if item.subtitle}<span class="subtitle">{item.subtitle}</span>{/if}
    <span class="category">{item.category}</span>
  </button>
</li>

<style>
  li { list-style: none; }
  /* Palette rows are 28 px high, with the category on the right. */
  button {
    width: 100%;
    height: 28px;
    background: transparent;
    border: 0;
    color: var(--fg);
    font: inherit;
    text-align: left;
    padding: 0 var(--sp-5);
    cursor: pointer;
    border-radius: var(--radius);
    display: flex;
    gap: var(--sp-5);
    align-items: center;
  }
  li.active button,
  button:hover { background: color-mix(in srgb, var(--renamed) 40%, transparent); }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  mark {
    background: none;
    color: var(--accent);
    font-weight: 600;
  }
  .subtitle {
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .category {
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    flex-shrink: 0;
  }
</style>
