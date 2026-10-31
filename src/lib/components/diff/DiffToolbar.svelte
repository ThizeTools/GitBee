<script lang="ts">
  import { diffPrefs, setDiffLayout, setIgnoreWs } from "$lib/stores/diffPrefs";

  interface Props {
    /** True when hunk actions are off because ignore-whitespace is on. Shows the hint. */
    stagingOff?: boolean;
  }
  let { stagingOff = false }: Props = $props();

  function onIgnoreWs(e: Event): void {
    setIgnoreWs((e.currentTarget as HTMLInputElement).checked);
  }
</script>

<div class="dv-toolbar">
  <span class="dv-seg" role="group" aria-label="Diff layout">
    <button class:active={$diffPrefs.layout === "unified"} onclick={() => setDiffLayout("unified")}>Unified</button>
    <button class:active={$diffPrefs.layout === "split"} onclick={() => setDiffLayout("split")}>Split</button>
  </span>
  <label class="dv-check" title="Pass -w to git: whitespace-only changes disappear from the diff">
    <input type="checkbox" checked={$diffPrefs.ignoreWs} onchange={onIgnoreWs} />
    Ignore whitespace
  </label>
  {#if $diffPrefs.ignoreWs}
    <span class="dv-badge" title="Whitespace-only changes are hidden. Hunk staging still uses the exact diff.">whitespace hidden</span>
  {/if}
  {#if stagingOff}
    <span class="dv-hint">Turn off ignore whitespace to stage hunks</span>
  {/if}
</div>
