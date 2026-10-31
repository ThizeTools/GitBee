<script lang="ts">
  import { worktrees, currentRepo, openRepo } from "$lib/stores/repo";
  import { matchesFilter } from "$lib/components/sidebar/filter";
  import Icon from "$lib/icons/Icon.svelte";

  // Worktrees of the repo; a click opens the worktree as its own tab.
  let { filter }: { filter: string } = $props();
  const shown = $derived($worktrees.filter((w) => matchesFilter(filter, w.branch ?? w.path)));
</script>

<ul class="list">
  {#each shown as w (w.path)}
    <li class="leaf" class:active={w.path === $currentRepo}>
      <button class="link" title={w.path} onclick={() => openRepo(w.path)}>
        <Icon name="folder-git" size={14} class="ico" />
        <span class="name">{w.branch ?? w.path.split(/[\\/]/).filter(Boolean).pop()}</span>
      </button>
    </li>
  {:else}
    <li class="muted">none</li>
  {/each}
</ul>
