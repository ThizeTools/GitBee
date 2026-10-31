<script lang="ts">
  import { tagsList } from "$lib/stores/repo";
  import { scrollGraphTo } from "$lib/stores/graphscroll";
  import { tagMenu } from "$lib/menus/refMenus";
  import { openMenu } from "$lib/stores/contextmenu";
  import { matchesFilter } from "$lib/components/sidebar/filter";

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
      ><span class="ico">🏷</span><span class="name">{t.name}</span></button>
    </li>
  {:else}
    <li class="muted">no tags</li>
  {/each}
</ul>
