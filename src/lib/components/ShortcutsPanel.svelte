<script lang="ts">
  // The Shortcuts panel lists every key and mouse gesture the app answers to.
  // It is the user-facing half of docs/specs/keyboard-and-toasts.md: when a
  // handler is added, changed or removed, its row changes here in the same PR.
  // WHY a data table instead of markup: the spec quotes the same table, and
  // one array keeps the two from drifting apart.

  interface Shortcut { keys: string; desc: string; }
  interface ShortcutGroup { title: string; items: Shortcut[]; }

  const GROUPS: ShortcutGroup[] = [
    {
      title: "Tabs",
      items: [
        { keys: "Ctrl+T", desc: "New tab page" },
        { keys: "Ctrl+W", desc: "Close current tab (not while the terminal has focus)" },
        { keys: "Ctrl+Shift+T", desc: "Reopen last closed tab" },
        { keys: "Ctrl+Tab / Ctrl+Shift+Tab", desc: "Next / previous tab" },
        { keys: "Ctrl+1 … Ctrl+8", desc: "Jump to tab N" },
        { keys: "Ctrl+9", desc: "Jump to last tab" },
        { keys: "Middle-click tab", desc: "Close that tab" },
      ],
    },
    {
      title: "Panels",
      items: [
        { keys: "Ctrl+P", desc: "Command palette" },
        { keys: "Ctrl+L", desc: "Logs panel" },
        { keys: "Ctrl+`", desc: "Show or hide the embedded terminal for the repo" },
        { keys: "Ctrl+Shift+`", desc: "Open the system terminal at the repo" },
        { keys: "Ctrl+B", desc: "Toggle left sidebar" },
        { keys: "Ctrl+Alt+B", desc: "Toggle right panel" },
        { keys: "Ctrl+Alt+F", desc: "Focus the sidebar filter" },
        { keys: "Esc", desc: "Close the topmost menu, palette, dialog or search; from a diff or file view, back to the graph" },
        { keys: "Palette: ↑ / ↓, Enter", desc: "Move through commands, run the highlighted one" },
        { keys: "Ctrl+Enter", desc: "Submit edit-message, set-upstream and new-worktree dialogs" },
        { keys: "Terminal: Ctrl+Shift+C / V", desc: "Copy the selection / paste from the clipboard (in the terminal)" },
        { keys: "GitHub login: Enter", desc: "Submit the access token" },
        { keys: "Theme picker: Enter / Space", desc: "Apply theme (double-click a theme to edit it)" },
        { keys: "Hover a notice", desc: "Pause its auto-dismiss timer" },
      ],
    },
    {
      title: "Graph",
      items: [
        { keys: "↑ / ↓", desc: "Newer / older commit (graph focus); previous / next file (file focus)" },
        { keys: "→ / ←", desc: "Open the commit's file list / back to the graph" },
        { keys: "Enter", desc: "Open the highlighted file (file focus)" },
        { keys: "h", desc: "Select the HEAD commit" },
        { keys: "Shift+H", desc: "Select the upstream commit (origin/<branch>)" },
        { keys: "Home / End", desc: "First / last commit" },
        { keys: "PageUp / PageDown", desc: "Move one page up / down" },
        { keys: "Double-click commit", desc: "Check out the branch at that commit" },
        { keys: "Double-click branch", desc: "Check out the branch (sidebar and ref badges)" },
      ],
    },
    {
      title: "Search",
      items: [
        { keys: "Ctrl+F", desc: "Find a commit in the graph" },
        { keys: "Enter / F3", desc: "Next match" },
        { keys: "Shift+Enter / Shift+F3", desc: "Previous match" },
        { keys: "Esc", desc: "Close search" },
      ],
    },
    {
      title: "Commit",
      items: [
        { keys: "Enter (summary)", desc: "Move to the description" },
        { keys: "Ctrl+Enter", desc: "Commit (from summary or description)" },
        { keys: "Ctrl+click / Shift+click file", desc: "Select several files, or a range, in the staging list" },
      ],
    },
    {
      title: "Zoom",
      items: [
        { keys: "Ctrl+= / Ctrl++", desc: "Zoom in" },
        { keys: "Ctrl+-", desc: "Zoom out" },
        { keys: "Ctrl+0", desc: "Reset zoom" },
      ],
    },
    {
      title: "Undo",
      items: [
        { keys: "Ctrl+Z", desc: "Undo last commit (not in text fields)" },
        { keys: "Ctrl+Shift+Z / Ctrl+Y", desc: "Redo" },
      ],
    },
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
      {#each GROUPS as group (group.title)}
        <section>
          <h3>{group.title}</h3>
          <ul>
            {#each group.items as s (s.keys)}
              <li>
                <kbd>{s.keys}</kbd>
                <span>{s.desc}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  </div>
{/if}

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 800; }
  .panel {
    position: fixed; right: 16px; bottom: 40px;
    width: 460px; max-width: calc(100vw - 32px);
    background: var(--bg-elev); border: 1px solid var(--border-strong);
    border-radius: 8px; box-shadow: 0 12px 32px rgba(0,0,0,0.55);
    z-index: 801; display: flex; flex-direction: column;
  }
  .head { display: flex; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--border); }
  .title { font-weight: 600; flex: 1; }
  .close { background: transparent; border: 0; color: var(--fg-muted); cursor: pointer; font-size: 20px; }
  .close:hover { color: var(--fg); }
  .body { padding: 4px 0 8px; max-height: 60vh; overflow: auto; }
  section + section { border-top: 1px solid var(--border); margin-top: 4px; }
  h3 {
    margin: 8px 14px 4px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.6px; color: var(--fg-muted);
  }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: grid; grid-template-columns: 170px 1fr; gap: 14px; padding: 5px 14px; align-items: center; }
  li:hover { background: var(--bg); }
  li span { font-size: 12px; line-height: 1.4; }
  kbd {
    background: var(--bg); border: 1px solid var(--border);
    padding: 2px 8px; border-radius: 3px; font-size: 11px;
    font-family: "Cascadia Code", Consolas, monospace;
    color: var(--fg); justify-self: start; white-space: nowrap;
  }
</style>
