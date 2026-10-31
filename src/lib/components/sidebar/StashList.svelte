<script lang="ts">
  import { stashes, currentRepo, withBusy } from "$lib/stores/repo";
  import { ipc } from "$lib/ipc";
  import { showStash, showChanges } from "$lib/stores/rightpanel";
  import { scrollGraphTo } from "$lib/stores/graphscroll";
  import { promptDialog } from "$lib/stores/dialog";
  import { dropStashAt } from "$lib/menus/stashActions";
  import { openMenu, type MenuItem } from "$lib/stores/contextmenu";
  import { matchesFilter } from "$lib/components/sidebar/filter";
  import Icon from "$lib/icons/Icon.svelte";

  // Stash rows. "Hide" only removes a row from this list; the stash itself stays.
  // `count` reports the visible rows to the section header.
  let { filter, count = $bindable(0) }: { filter: string; count?: number } = $props();

  let hiddenStashes = $state<Set<number>>(new Set());
  const visibleStashes = $derived(
    $stashes.filter((s) => !hiddenStashes.has(s.index) && matchesFilter(filter, s.message)),
  );
  $effect(() => { count = visibleStashes.length; });

  function hideStash(idx: number) { hiddenStashes.add(idx); hiddenStashes = new Set(hiddenStashes); }
  function selectStash(idx: number, sha: string) {
    showStash(idx);
    scrollGraphTo(sha);
  }
  async function applyStash(idx: number) {
    if (!$currentRepo) return;
    await withBusy(() => ipc.stashApply($currentRepo!, idx));
  }
  async function popStash(idx: number) {
    if (!$currentRepo) return;
    await withBusy(() => ipc.stashPop($currentRepo!, idx));
    showChanges();
  }
  async function dropStash(idx: number) {
    if (!$currentRepo) return;
    if (await dropStashAt($currentRepo, idx)) showChanges();
  }
  async function editStashMessage(idx: number, current: string) {
    if (!$currentRepo) return;
    const m = await promptDialog({ title: "Edit stash message:", initial: current, confirmLabel: "Save" });
    if (m === null) return;
    await withBusy(() => ipc.stashEditMessage($currentRepo!, idx, m));
  }

  function stashMenu(idx: number, message: string): MenuItem[] {
    return [
      { label: "Apply Stash", icon: "fetch", onClick: () => applyStash(idx) },
      { label: "Pop Stash", icon: "pop", onClick: () => popStash(idx) },
      { label: "Delete Stash", icon: "trash", danger: true, onClick: () => dropStash(idx) },
      { separator: true, label: "" },
      { label: "Edit stash message", icon: "file-modified", onClick: () => editStashMessage(idx, message) },
      { label: "Hide", icon: "eye-off", onClick: () => hideStash(idx) },
    ];
  }
</script>

<ul class="list">
  {#each visibleStashes as s (s.index)}
    <li class="leaf">
      <button
        class="link"
        title={s.message}
        onclick={() => selectStash(s.index, s.sha)}
        oncontextmenu={(e) => openMenu(e, stashMenu(s.index, s.message))}
      >
        <Icon name="stash" size={14} class="ico" />
        <span class="name">{s.message}</span>
      </button>
      <button class="row-action" onclick={() => hideStash(s.index)} title="Hide stash" aria-label="Hide stash">
        <Icon name="eye-off" size={14} />
      </button>
      <button class="row-action" onclick={() => dropStash(s.index)} title="Delete stash" aria-label="Delete stash">
        <Icon name="trash" size={14} />
      </button>
      <button
        class="row-action"
        onclick={(e) => openMenu(e, stashMenu(s.index, s.message))}
        title="More actions"
        aria-label="More actions"
      >
        <Icon name="more" size={14} />
      </button>
    </li>
  {:else}
    <li class="muted">no stashes</li>
  {/each}
</ul>
