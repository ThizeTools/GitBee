<script lang="ts">
  import { localBranches, graph } from "$lib/stores/repo";
  import { scrollGraphTo, checkoutAndJump } from "$lib/stores/graphscroll";
  import { localBranchMenu } from "$lib/menus/refMenus";
  import { soloRefs, toggleSolo } from "$lib/stores/graphFilter";
  import type { DragRef } from "$lib/menus/dragOptions";
  import {
    beginRefDrag, endRefDrag, dragOverRef, dropOnRef, leaveDropHover, sidebarDropKey, dropHoverKey,
  } from "$lib/stores/refDrag";
  import { openMenu } from "$lib/stores/contextmenu";
  import { matchesFilter } from "$lib/components/sidebar/filter";
  import Icon from "$lib/icons/Icon.svelte";

  // Local branch rows: click jumps the graph, double-click checks out, and the
  // rows are drag sources and drop targets for ref drag-and-drop.
  let { filter }: { filter: string } = $props();

  // True while the user is soloing at least one ref. Shows the eye toggle
  // on every row so one click adds another ref to the solo set.
  const soloActive = $derived($soloRefs.size > 0);
  const shown = $derived($localBranches.filter((b) => matchesFilter(filter, b.name)));

  function isHead(name: string): boolean { return $graph?.head_branch === name; }
  function localRef(name: string): DragRef { return { name, kind: "localbranch" }; }
</script>

<ul class="list">
  {#each shown as b (b.name)}
    {@const inSolo = $soloRefs.has(b.name)}
    {@const ref = localRef(b.name)}
    {@const soloLabel = inSolo ? `Remove ${b.name} from solo` : `Add ${b.name} to solo`}
    <li
      class="leaf" class:active={isHead(b.name)} class:solo-row={soloActive} class:solo-on={inSolo}
      draggable="true"
      class:drop-target={$dropHoverKey === sidebarDropKey(ref)}
      ondragstart={(e) => beginRefDrag(e, ref)}
      ondragend={endRefDrag}
      ondragover={(e) => dragOverRef(e, sidebarDropKey(ref), ref)}
      ondragleave={() => leaveDropHover(sidebarDropKey(ref))}
      ondrop={(e) => dropOnRef(e, ref)}
    >
      {#if soloActive}
        <button
          class="eye"
          class:on={inSolo}
          onclick={(e) => { e.stopPropagation(); toggleSolo(b.name); }}
          title={soloLabel}
          aria-label={soloLabel}
        >
          <Icon name={inSolo ? "eye" : "eye-off"} size={14} />
        </button>
      {/if}
      <button
        class="link"
        onclick={() => scrollGraphTo(b.target_sha)}
        ondblclick={() => checkoutAndJump(b.name)}
        oncontextmenu={(e) => openMenu(e, localBranchMenu(b.name, b.target_sha))}
        title="Click to jump · double-click to checkout: {b.name}"
      >
        <Icon name={isHead(b.name) ? "star" : "laptop"} size={14} class="ico" />
        <span class="name">{b.name}</span>
      </button>
      <button
        class="row-action"
        onclick={(e) => openMenu(e, localBranchMenu(b.name, b.target_sha))}
        title="More actions"
        aria-label="More actions"
      >
        <Icon name="more" size={14} />
      </button>
    </li>
  {:else}
    <li class="muted">no branches</li>
  {/each}
</ul>
