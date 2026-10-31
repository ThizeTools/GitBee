<script lang="ts">
  import { remoteBranches, currentRepo, withBusy } from "$lib/stores/repo";
  import { ipc } from "$lib/ipc";
  import { scrollGraphTo, checkoutRemoteAndJump } from "$lib/stores/graphscroll";
  import { remoteBranchMenu } from "$lib/menus/refMenus";
  import { soloRefs, toggleSolo } from "$lib/stores/graphFilter";
  import type { DragRef } from "$lib/menus/dragOptions";
  import {
    beginRefDrag, endRefDrag, dragOverRef, dropOnRef, leaveDropHover, sidebarDropKey, dropHoverKey,
  } from "$lib/stores/refDrag";
  import { openMenu } from "$lib/stores/contextmenu";
  import { matchesFilter } from "$lib/components/sidebar/filter";
  import Icon from "$lib/icons/Icon.svelte";

  // Remote branches grouped under their remote. Clicking the remote name
  // fetches it; double-click on a branch checks out a local tracking branch.
  let { filter }: { filter: string } = $props();

  type RemoteEntry = { name: string; sha: string };

  const soloActive = $derived($soloRefs.size > 0);

  // Group remote branches by remote name for hierarchical display.
  // Keep the sha so a single click can jump the graph.
  const remoteGroups = $derived.by(() => {
    const m = new Map<string, RemoteEntry[]>();
    for (const b of $remoteBranches) {
      const slash = b.name.indexOf("/");
      const remote = slash > 0 ? b.name.slice(0, slash) : "origin";
      const branch = slash > 0 ? b.name.slice(slash + 1) : b.name;
      const arr = m.get(remote) ?? [];
      arr.push({ name: branch, sha: b.target_sha });
      m.set(remote, arr);
    }
    return m;
  });

  const filteredGroups = $derived.by(() => {
    if (!filter.trim()) return remoteGroups;
    const out = new Map<string, RemoteEntry[]>();
    for (const [remote, items] of remoteGroups) {
      const kept = items.filter((b) => matchesFilter(filter, b.name, `${remote}/${b.name}`));
      if (kept.length > 0 || matchesFilter(filter, remote)) out.set(remote, kept);
    }
    return out;
  });

  async function fetchRemote(name?: string) {
    if (!$currentRepo) return;
    await withBusy(() => ipc.remoteFetch($currentRepo!, name));
  }
  function remoteRef(remote: string, branch: string): DragRef {
    return { name: `${remote}/${branch}`, kind: "remotebranch" };
  }
</script>

<ul class="list">
  {#each [...filteredGroups.entries()] as [remote, branches] (remote)}
    <li class="group">
      <button class="link group-head" onclick={() => fetchRemote(remote)} title="Click to fetch">
        <Icon name="cloud" size={14} class="ico" />
        <span class="name">{remote}</span>
        <span class="count-inline">{branches.length}</span>
      </button>
      <ul class="nested">
        {#each branches as b (b.name)}
          {@const qname = `${remote}/${b.name}`}
          {@const inSolo = $soloRefs.has(qname)}
          {@const ref = remoteRef(remote, b.name)}
          {@const soloLabel = inSolo ? `Remove ${qname} from solo` : `Add ${qname} to solo`}
          <li
            class="leaf" class:solo-row={soloActive} class:solo-on={inSolo}
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
                onclick={(e) => { e.stopPropagation(); toggleSolo(qname); }}
                title={soloLabel}
                aria-label={soloLabel}
              >
                <Icon name={inSolo ? "eye" : "eye-off"} size={14} />
              </button>
            {/if}
            <button
              class="link"
              onclick={() => scrollGraphTo(b.sha)}
              ondblclick={() => checkoutRemoteAndJump(remote, b.name)}
              oncontextmenu={(e) => openMenu(e, remoteBranchMenu(remote, b.name, b.sha))}
              title="Click to jump · double-click to checkout {remote}/{b.name} locally"
            >
              <Icon name="branch" size={14} class="ico" />
              <span class="name">{b.name}</span>
            </button>
            <button
              class="row-action"
              onclick={(e) => openMenu(e, remoteBranchMenu(remote, b.name, b.sha))}
              title="More actions"
              aria-label="More actions"
            >
              <Icon name="more" size={14} />
            </button>
          </li>
        {/each}
      </ul>
    </li>
  {:else}
    <li class="muted">no remotes</li>
  {/each}
</ul>
