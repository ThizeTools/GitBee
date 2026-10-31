<script lang="ts">
  /**
   * Pull with its options chevron. The main button pulls with the default
   * strategy; the chevron opens the context menu with Fetch all and both pull
   * strategies. Spec: docs/specs/ui-layout-2026-11.md, region 2.
   */
  import Icon from "$lib/icons/Icon.svelte";
  import { openMenu, type MenuItem } from "$lib/stores/contextmenu";
  import ToolbarButton from "./ToolbarButton.svelte";

  interface Props {
    disabled: boolean;
    onPull: () => void;
    onPullRebase: () => void;
    onFetchAll: () => void;
  }

  let { disabled, onPull, onPullRebase, onFetchAll }: Props = $props();

  function pullMenu(): MenuItem[] {
    return [
      { label: "Fetch all", onClick: onFetchAll },
      { label: "Pull (fast-forward if possible)", onClick: onPull },
      { label: "Pull (rebase)", onClick: onPullRebase },
    ];
  }

  function openPullMenu(e: MouseEvent) {
    if (disabled) return;
    openMenu(e, pullMenu());
  }

  // Keyboard path: the menu needs a screen position, so anchor it under the chevron.
  function onChevronKey(e: KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openPullMenu(new MouseEvent("click", { clientX: r.left, clientY: r.bottom }));
  }
</script>

<ToolbarButton icon="pull" label="Pull" title="Pull" {disabled} onclick={onPull}>
  {#snippet trailing()}
    <!-- Nested in the Pull button like the tab close icon; openMenu stops
         the click, so the Pull handler does not also run. -->
    <span
      class="chev"
      role="button"
      tabindex={disabled ? -1 : 0}
      title="Pull options"
      aria-label="Pull options"
      aria-disabled={disabled}
      onclick={openPullMenu}
      onkeydown={onChevronKey}
    >
      <Icon name="chevron-down" size={14} />
    </span>
  {/snippet}
</ToolbarButton>

<style>
  /* 24 px hit box around a 14 px chevron. Negative vertical margin keeps the
     label row at its text height, so Pull's label lines up with its neighbours. */
  .chev {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--h-row);
    height: var(--h-row);
    margin: -6px calc(-1 * var(--sp-3)) -6px 0;
    border-radius: var(--radius-sm);
    color: var(--fg-muted);
    cursor: pointer;
  }
  .chev:hover { color: var(--fg); background: color-mix(in srgb, var(--fg) 8%, transparent); }
</style>
