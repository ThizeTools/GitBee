<script lang="ts">
  import { tagsList } from "$lib/stores/repo";
  import { scrollGraphTo } from "$lib/stores/graphscroll";
  import { tagMenu } from "$lib/menus/refMenus";
  import { openMenu } from "$lib/stores/contextmenu";
  import { matchesFilter } from "$lib/components/sidebar/filter";
  import Icon from "$lib/icons/Icon.svelte";

  // Tags: a click jumps the graph to the tagged commit.
  let { filter }: { filter: string } = $props();
  const shown = $derived($tagsList.filter((t) => matchesFilter(filter, t.name)));
</script>

<ul class="list">
  {#each shown as t (t.name)}
    <li class="leaf">
      <button
        class="link"
        onclick={() => scrollGraphTo(t.target_sha)}
        oncontextmenu={(e) => openMenu(e, tagMenu(t.name, t.target_sha))}
        title="Jump to {t.name}"
      >
        <Icon name="tag" size={14} class="ico" />
        <span class="name">{t.name}</span>
      </button>
      <button
        class="row-action"
        onclick={(e) => openMenu(e, tagMenu(t.name, t.target_sha))}
        title="More actions"
        aria-label="More actions"
      >
        <Icon name="more" size={14} />
      </button>
    </li>
  {:else}
    <li class="muted">no tags</li>
  {/each}
</ul>
