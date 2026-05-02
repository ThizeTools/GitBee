<script lang="ts">
  import { contextMenu, closeMenu, type MenuItem } from "$lib/stores/contextmenu";
  import { layout } from "$lib/stores/layout";
  import { onMount } from "svelte";

  let submenuOpen = $state<number | null>(null);

  // Stored x/y come from MouseEvent.clientX/Y (viewport, post-zoom). The
  // menu is fixed inside `.app`, which has CSS `zoom` applied — so left/top
  // get multiplied by uiScale at paint time. Divide here to compensate.
  const scale = $derived($layout.uiScale);

  onMount(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".ctx-menu")) closeMenu();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  });

  function run(it: MenuItem) {
    if (it.disabled || it.separator) return;
    if (it.submenu) return;
    closeMenu();
    it.onClick?.();
  }
</script>

{#if $contextMenu.open}
  <div class="ctx-menu" style="left: {$contextMenu.x / scale}px; top: {$contextMenu.y / scale}px">
    {#each $contextMenu.items as it, i (i)}
      {#if it.hidden}
        <!-- entry suppressed -->
      {:else if it.separator}
        <div class="sep"></div>
      {:else}
        <div class="row" onmouseenter={() => submenuOpen = it.submenu ? i : null} role="presentation">
          <button
            type="button"
            class="item"
            class:danger={it.danger}
            class:disabled={it.disabled}
            disabled={it.disabled}
            onclick={() => run(it)}
          >
            {#if it.icon}<span class="ico">{it.icon}</span>{/if}
            <span class="lbl">{it.label}</span>
            {#if it.submenu}<span class="caret">▸</span>{/if}
          </button>
          {#if it.submenu && submenuOpen === i}
            <div class="sub">
              {#each it.submenu as sub, j (j)}
                {#if sub.separator}
                  <div class="sep"></div>
                {:else}
                  <button
                    type="button"
                    class="item"
                    class:danger={sub.danger}
                    class:disabled={sub.disabled}
                    disabled={sub.disabled}
                    onclick={(e) => { e.stopPropagation(); run(sub); }}
                  >
                    {#if sub.icon}<span class="ico">{sub.icon}</span>{/if}
                    <span class="lbl">{sub.label}</span>
                  </button>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .ctx-menu {
    position: fixed;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.45);
    padding: 4px;
    z-index: 1000;
    min-width: 200px;
    font-size: 12px;
  }
  .row { position: relative; }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    background: transparent;
    color: var(--fg);
    border: 0;
    text-align: left;
    padding: 6px 10px;
    cursor: pointer;
    border-radius: 4px;
  }
  .item:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--fg); }
  .item.danger { color: var(--del); }
  .item.disabled, .item:disabled { opacity: 0.4; cursor: not-allowed; }
  .ico { width: 14px; text-align: center; color: var(--fg-muted); }
  .lbl { flex: 1; }
  .caret { font-size: 9px; color: var(--fg-muted); }
  .sep { height: 1px; background: var(--border); margin: 4px 6px; }
  .sub {
    position: absolute;
    left: 100%;
    top: 0;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.45);
    padding: 4px;
    min-width: 240px;
  }
</style>
