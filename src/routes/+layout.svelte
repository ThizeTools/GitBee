<script module lang="ts">
  // DEV only: the browser IPC mock (src/lib/dev/mockIpc.ts) must exist before the
  // first invoke. The await holds this module, and every child, until it is
  // installed. import.meta.env.DEV is false in production, so the import is dropped.
  if (import.meta.env.DEV) {
    const { startDevMock } = await import("$lib/dev/mockIpc");
    await startDevMock();
  }
</script>

<script lang="ts">
  import { activeThemeId, customThemes, resolveTheme, applyTheme } from "$lib/stores/ui";
  import { onMount } from "svelte";

  let { children } = $props();

  // Apply the persisted theme on first mount. Subsequent changes are picked
  // up by the subscriptions inside ui.ts.
  onMount(() => {
    applyTheme(resolveTheme($activeThemeId, $customThemes));
  });
</script>

<svelte:head>
  <title>GitBee</title>
</svelte:head>

{@render children()}

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    height: 100vh;
    overflow: hidden;
  }
  /* Defaults match the Hive theme (default); ui.ts overrides these via
     inline style on documentElement when a different theme is active. */
  :global(:root) {
    --bg: #0a0a0a;
    --bg-elev: #181818;
    --sidebar-bg: #050505;
    --rightpanel-bg: #101010;
    --fg: #f5f5f5;
    --fg-muted: #8a8a8a;
    --border: #222222;
    --border-strong: #3a3a3a;
    --accent: #f5cc1c;
    --add: #46c46e;
    --del: #f08080;
    --modified: #dcdcaa;
    --renamed: #073a55;
    --sha: #ce9178;
    --tag: #dcdcaa;
    --remote: #c586c0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
    font-size: var(--fs-md);
    color-scheme: dark;

    /* Non-color size tokens from docs/specs/ui-layout-2026-11.md ("Tokens").
       Themes only override the color variables above, never these.
       --sp-15 / --sp-20 are named by value on purpose: GitKraken's 15/20 px
       dialog and tab paddings, so they never drift from the index names. */
    --sp-1: 2px;
    --sp-2: 4px;
    --sp-3: 6px;
    --sp-4: 8px;
    --sp-5: 10px;
    --sp-6: 12px;
    --sp-8: 16px;
    --sp-15: 15px;
    --sp-20: 20px;

    --fs-xs: 10px;
    --fs-sm: 11px;
    --fs-md: 12px;
    --fs-lg: 14px;
    --fs-xl: 16px;

    --radius-sm: 2px;
    --radius: 4px;
    --radius-lg: 6px;

    --h-tabbar: 34px;
    --h-toolbar: 48px;
    --h-statusbar: 26px;
    --h-section: 30px;
    --h-row: 24px;
    --h-graph-header: 26px;
    --h-pill: 18px;

    --icon-sm: 14px;
    --icon: 16px;
    --icon-lg: 18px;
  }
  :global(body) {
    background: var(--bg);
    color: var(--fg);
  }
  :global(*) { box-sizing: border-box; }
  :global(button) { font-family: inherit; }
  :global(::-webkit-scrollbar) { width: 10px; height: 10px; }
  :global(::-webkit-scrollbar-track) { background: transparent; }
  :global(::-webkit-scrollbar-thumb) {
    background: var(--border);
    border-radius: 5px;
  }
  :global(::-webkit-scrollbar-thumb:hover) { background: var(--border-strong); }
</style>
