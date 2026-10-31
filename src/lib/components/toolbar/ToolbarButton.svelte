<script lang="ts">
  /**
   * Toolbar action: a 48x47 icon-over-label target (spec "Toolbar", region 2).
   * `trailing` renders extra controls in the label row, used by Pull's chevron.
   */
  import type { Snippet } from "svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import type { IconName } from "$lib/icons/names";

  interface Props {
    icon: IconName;
    label: string;
    title: string;
    disabled?: boolean;
    onclick: () => void;
    trailing?: Snippet;
  }

  let { icon, label, title, disabled = false, onclick, trailing }: Props = $props();
</script>

<button type="button" class="tb-btn" {title} {disabled} {onclick}>
  <Icon name={icon} size={16} />
  <span class="row">
    <span class="lbl">{label}</span>
    {#if trailing}{@render trailing()}{/if}
  </span>
</button>

<style>
  /* 48 px wide and 47 px tall (the 48 px toolbar minus its bottom border).
     GitKraken's measured target size; no size token covers it. */
  .tb-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-1);
    width: 48px;
    height: calc(var(--h-toolbar) - 1px);
    margin: 0 var(--sp-1);
    padding: 0;
    flex-shrink: 0;
    background: transparent;
    color: var(--fg-muted);
    border: 0;
    border-radius: var(--radius);
    cursor: pointer;
  }
  .tb-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--fg) 6%, transparent);
    color: var(--fg);
  }
  .tb-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    line-height: 1;
  }
  .lbl { font-size: var(--fs-sm); white-space: nowrap; }
</style>
