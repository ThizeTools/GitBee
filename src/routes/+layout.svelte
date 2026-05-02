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
    font-size: 13px;
    color-scheme: dark;
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
