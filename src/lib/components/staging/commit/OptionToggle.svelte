<script lang="ts">
  // A checkbox drawn as a 24 px pill with an icon, for the options row of the
  // commit box (Amend, Sign). The native checkbox stays inside so keyboard
  // toggling and screen readers see a plain checkbox; the pill only mirrors it.
  import Icon from "$lib/icons/Icon.svelte";
  import type { IconName } from "$lib/icons/names";

  interface Props {
    icon: IconName;
    label: string;
    checked: boolean;
    title?: string;
    onChange: (value: boolean) => void;
  }
  let { icon, label, checked, title, onChange }: Props = $props();
</script>

<label class="option" class:on={checked} {title}>
  <input type="checkbox" {checked} onchange={(e) => onChange(e.currentTarget.checked)} />
  <Icon name={icon} size={14} />
  <span>{label}</span>
</label>

<style>
  .option {
    position: relative;
    display: inline-flex; align-items: center; gap: var(--sp-3);
    height: var(--h-row); padding: 0 var(--sp-5);
    border: 1px solid var(--border); border-radius: var(--radius);
    color: var(--fg-muted); font-size: var(--fs-sm);
    cursor: pointer; user-select: none;
  }
  .option:hover { color: var(--fg); border-color: var(--border-strong); }
  .option.on {
    color: var(--accent); border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .option:focus-within { outline: 1px solid var(--accent); outline-offset: 1px; }
  /* The native checkbox keeps focus and Space-to-toggle but is not drawn. */
  .option input {
    position: absolute; opacity: 0; width: 0; height: 0; margin: 0;
    pointer-events: none;
  }
</style>
