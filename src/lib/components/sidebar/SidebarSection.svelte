<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "$lib/icons/Icon.svelte";

  // One collapsible sidebar section: a 30 px header (chevron, title, count) and,
  // while open, its rows. The open flag belongs to the parent so it survives the
  // section being unmounted when no repo is shown. `onMenu` adds a "more" button
  // to the header's hover toolbar for section-level actions.
  let { title, count, open, ontoggle, onMenu, children }: {
    title: string;
    count: number;
    open: boolean;
    ontoggle: () => void;
    onMenu?: (e: MouseEvent) => void;
    children: Snippet;
  } = $props();
</script>

<div class="section">
  <div class="section-head-row">
    <button class="section-head" onclick={ontoggle} aria-expanded={open}>
      <span class="caret"><Icon name={open ? "chevron-down" : "chevron-right"} size={14} /></span>
      <span class="title">{title}</span>
      <span class="count">{count}</span>
    </button>
    {#if onMenu}
      <button class="section-menu" title="{title}: more actions" aria-label="{title}: more actions" onclick={onMenu}>
        <Icon name="more" size={14} />
      </button>
    {/if}
  </div>
  {#if open}
    {@render children()}
  {/if}
</div>
