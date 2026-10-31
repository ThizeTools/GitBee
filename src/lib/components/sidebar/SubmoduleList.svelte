<script lang="ts">
  import { activeSubmodules, openSubmoduleTab, shortSha, SUBMODULE_STATE_LABEL, canOpenSubmodule } from "$lib/stores/submodules";
  import { openMenu } from "$lib/stores/contextmenu";
  import { submoduleMenu } from "$lib/components/sidebar/submoduleMenus";
  import { matchesFilter } from "$lib/components/sidebar/filter";
  import Icon from "$lib/icons/Icon.svelte";

  // One row per submodule in .gitmodules. Double-click opens it as a repo tab.
  let { repo, filter }: { repo: string; filter: string } = $props();
  const shown = $derived($activeSubmodules.filter((s) => matchesFilter(filter, s.name, s.path)));
</script>

<ul class="list">
  {#each shown as s (s.path)}
    <li class="leaf">
      <button
        class="link"
        class:uninit={!canOpenSubmodule(s)}
        title={canOpenSubmodule(s)
          ? `${s.path} · double-click to open in a new tab`
          : `${s.path} · not initialized: choose Update (init)`}
        ondblclick={() => openSubmoduleTab(repo, s)}
        oncontextmenu={(e) => openMenu(e, submoduleMenu(repo, s))}
      >
        <Icon name="submodule" size={14} class="ico" />
        <span class="name">{s.name}</span>
        <span class="sha">{shortSha(s.sha)}</span>
        <span class="state state-{s.state}">{SUBMODULE_STATE_LABEL[s.state]}</span>
      </button>
      <button
        class="row-action"
        onclick={(e) => openMenu(e, submoduleMenu(repo, s))}
        title="More actions"
        aria-label="More actions"
      >
        <Icon name="more" size={14} />
      </button>
    </li>
  {:else}
    <li class="muted">no matches</li>
  {/each}
</ul>
