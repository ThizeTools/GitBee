<script lang="ts">
  import { contextMenu, closeMenu, type MenuItem } from "$lib/stores/contextmenu";
  import { layout } from "$lib/stores/layout";
  import { onMount, tick } from "svelte";

  let submenuOpen = $state<number | null>(null);
  let menuEl: HTMLDivElement | null = $state(null);
  let pos = $state<{ left: number; top: number } | null>(null);

  // Stored x/y come from MouseEvent.clientX/Y (viewport, post-zoom). The
  // menu is fixed inside `.app`, which has CSS `zoom` applied — so left/top
  // get multiplied by uiScale at paint time. Divide here to compensate.
  const scale = $derived($layout.uiScale);

  // Recompute placement whenever the menu opens or its items change. The
  // pattern: render the menu off-screen at first paint to measure it, then
  // flip it up/left if it would overflow the viewport. `pos: null` keeps
  // the menu hidden until we have a measured placement, avoiding a 1-frame
  // flash at the wrong corner.
  $effect(() => {
    const open = $contextMenu.open;
    const x = $contextMenu.x;
    const y = $contextMenu.y;
    if (!open) { pos = null; return; }
    pos = null; // hide until measured
    void $contextMenu.items; // recompute when items change too
    tick().then(() => {
      if (!menuEl) return;
      const rect = menuEl.getBoundingClientRect();
      // Convert to logical (pre-zoom) px so the math matches our left/top.
      const w = rect.width / scale;
      const h = rect.height / scale;
      const vw = window.innerWidth / scale;
      const vh = window.innerHeight / scale;
      let left = x / scale;
      let top = y / scale;
      const margin = 4;
      // Flip up if the menu would clip the bottom edge AND there's more
      // room above the click point. Otherwise just clamp into view.
      if (top + h + margin > vh) {
        if (y / scale - h - margin >= 0) top = y / scale - h;
        else top = Math.max(margin, vh - h - margin);
      }
      if (left + w + margin > vw) {
        if (x / scale - w - margin >= 0) left = x / scale - w;
        else left = Math.max(margin, vw - w - margin);
      }
      pos = { left, top };
    });
  });

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
  <div
    bind:this={menuEl}
    class="ctx-menu"
    class:measuring={pos === null}
    style={pos
      ? `left: ${pos.left}px; top: ${pos.top}px;`
      : `left: ${$contextMenu.x / scale}px; top: ${$contextMenu.y / scale}px;`}
  >
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
  /* Hide while we measure the natural size on the first paint. Render
     it off-viewport so layout engines still compute a real width/height
     for getBoundingClientRect — `display: none` would give 0×0. */
  .ctx-menu.measuring {
    visibility: hidden;
    pointer-events: none;
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
