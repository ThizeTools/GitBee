<script lang="ts">
  import type { Snippet } from "svelte";

  // One collapsible sidebar section: a header (caret, title, count) and, while
  // open, its rows. The open flag belongs to the parent so it survives the
  // section being unmounted when no repo is shown. `onMenu` adds a "⋯" button
  // for section-level actions.
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
    <button class="section-head" onclick={ontoggle}>
      <span class="caret">{open ? "▼" : "▶"}</span>
      <span class="title">{title}</span>
      <span class="count">{count}</span>
    </button>
    {#if onMenu}
      <button class="section-menu" title="{title}: more actions" onclick={onMenu}>⋯</button>
    {/if}
  </div>
  {#if open}
    {@render children()}
  {/if}
</div>
