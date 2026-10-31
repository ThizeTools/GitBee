<script lang="ts">
  // Check runs of the PR's head commit. The summary line is words from
  // `checksLabel`; the list shows each run's name and state, and links to it.
  import type { CheckRun, ChecksSummary } from "$lib/github/pullTypes";
  import { checksLabel, checksTone } from "$lib/github/pulls";
  import { openExternal } from "./pullActions";
  import Icon from "$lib/icons/Icon.svelte";
  import type { IconName } from "$lib/icons/names";

  interface Props {
    checks: ChecksSummary;
  }
  let { checks }: Props = $props();

  /** One icon per run, from its status and conclusion: pending = history (waiting),
   *  success = check, neutral or skipped = remove (no verdict), anything else = close. */
  function glyph(run: CheckRun): IconName {
    if (run.status !== "completed") return "history";
    if (run.conclusion === "success") return "check";
    if (run.conclusion === "neutral" || run.conclusion === "skipped") return "remove";
    return "close";
  }

</script>

<section class="checks">
  <div class="summary tone-{checksTone(checks)}">{checksLabel(checks)}</div>
  {#if checks.runs.length > 0}
    <ul>
      {#each checks.runs as run}
        <li>
          <span class="glyph g-{run.conclusion ?? run.status}"><Icon name={glyph(run)} size={12} /></span>
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
  .checks { display: flex; flex-direction: column; gap: var(--sp-3); }
  .summary { font-size: var(--fs-md); }
  .tone-bad { color: var(--del); }
  .tone-pending { color: var(--modified); }
  .tone-good { color: var(--add); }
  .tone-none { color: var(--fg-muted); }
  /* One row per check run, at the 24 px row size. */
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0; }
  li { display: flex; align-items: center; gap: var(--sp-4); min-height: var(--h-row); font-size: var(--fs-md); min-width: 0; }
  .glyph { width: var(--icon-sm); display: inline-flex; justify-content: center; flex-shrink: 0; color: var(--fg-muted); }
  .g-success { color: var(--add); }
  .g-failure, .g-timed_out, .g-cancelled, .g-action_required, .g-startup_failure { color: var(--del); }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  .link { background: transparent; border: 0; color: var(--fg); cursor: pointer; padding: 0; font-size: var(--fs-md); }
  .link:hover { color: var(--accent); text-decoration: underline; }
  .state { color: var(--fg-muted); font-size: var(--fs-sm); flex-shrink: 0; }
</style>
