<script lang="ts">
  interface Shortcut { keys: string; desc: string; }
  const SHORTCUTS: Shortcut[] = [
    { keys: "Ctrl+P", desc: "Command palette" },
    { keys: "Ctrl+W", desc: "Close current tab" },
    { keys: "Ctrl+Tab", desc: "Next tab" },
    { keys: "Ctrl+Shift+Tab", desc: "Previous tab" },
    { keys: "Ctrl++", desc: "Zoom in" },
    { keys: "Ctrl+-", desc: "Zoom out" },
    { keys: "Ctrl+0", desc: "Reset zoom" },
    { keys: "Ctrl+`", desc: "Toggle terminal" },
    { keys: "Ctrl+L", desc: "Open logs" },
    { keys: "Esc", desc: "Close diff / commit / overlays" },
    { keys: "Enter (summary)", desc: "Move focus to description" },
  ];

  interface Props { open: boolean; onClose: () => void; }
  let { open, onClose }: Props = $props();
</script>

{#if open}
  <div class="overlay" onclick={onClose} role="presentation"></div>
  <div class="panel" role="dialog" aria-label="Shortcuts">
    <header class="head">
      <span class="title">Keyboard shortcuts</span>
      <button class="close" onclick={onClose}>×</button>
    </header>
    <div class="body">
      <ul>
        {#each SHORTCUTS as s (s.keys)}
          <li>
            <kbd>{s.keys}</kbd>
            <span>{s.desc}</span>
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 800; }
  .panel {
    position: fixed; right: 16px; bottom: 40px;
    width: 420px; max-width: calc(100vw - 32px);
    background: var(--bg-elev); border: 1px solid var(--border-strong);
    border-radius: 8px; box-shadow: 0 12px 32px rgba(0,0,0,0.55);
    z-index: 801; display: flex; flex-direction: column;
  }
  .head { display: flex; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--border); }
  .title { font-weight: 600; flex: 1; }
  .close { background: transparent; border: 0; color: var(--fg-muted); cursor: pointer; font-size: 20px; }
  .close:hover { color: var(--fg); }
  .body { padding: 8px 0; max-height: 60vh; overflow: auto; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: grid; grid-template-columns: 140px 1fr; gap: 14px; padding: 6px 14px; align-items: center; }
  li:hover { background: var(--bg); }
  kbd {
    background: var(--bg); border: 1px solid var(--border);
    padding: 2px 8px; border-radius: 3px; font-size: 11px;
    font-family: "Cascadia Code", Consolas, monospace;
    color: var(--fg);
  }
</style>
