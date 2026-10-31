<script lang="ts">
  // Check runs of the PR's head commit. The summary line is words from
  // `checksLabel`; the list shows each run's name and state, and links to it.
  import type { CheckRun, ChecksSummary } from "$lib/github/pullTypes";
  import { checksLabel, checksTone } from "$lib/github/pulls";
  import { openExternal } from "./pullActions";

  interface Props {
    checks: ChecksSummary;
  }
  let { checks }: Props = $props();

  /** One glyph per run, from its status and conclusion. */
  function glyph(run: CheckRun): string {
    if (run.status !== "completed") return "◌";
    if (run.conclusion === "success") return "✓";
    if (run.conclusion === "neutral" || run.conclusion === "skipped") return "–";
    return "✗";
  }

</script>

<section class="checks">
  <div class="summary tone-{checksTone(checks)}">{checksLabel(checks)}</div>
  {#if checks.runs.length > 0}
    <ul>
      {#each checks.runs as run}
        <li>
          <span class="glyph g-{run.conclusion ?? run.status}">{glyph(run)}</span>
          {#if run.html_url}
            <button class="name link" onclick={() => openExternal(run.html_url)}>{run.name}</button>
          {:else}
            <span class="name">{run.name}</span>
          {/if}
          <span class="state">{run.conclusion ?? run.status}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .checks { display: flex; flex-direction: column; gap: 6px; }
  .summary { font-size: 12px; }
  .tone-bad { color: #f85149; }
  .tone-pending { color: #d29922; }
  .tone-good { color: #3fb950; }
  .tone-none { color: var(--fg-muted); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
  li { display: flex; align-items: center; gap: 8px; font-size: 12px; min-width: 0; }
  .glyph { width: 14px; text-align: center; flex-shrink: 0; color: var(--fg-muted); }
  .g-success { color: #3fb950; }
  .g-failure, .g-timed_out, .g-cancelled, .g-action_required, .g-startup_failure { color: #f85149; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  .link { background: transparent; border: 0; color: var(--fg); cursor: pointer; padding: 0; font-size: 12px; }
  .link:hover { color: var(--accent); text-decoration: underline; }
  .state { color: var(--fg-muted); font-size: 11px; flex-shrink: 0; }
</style>
