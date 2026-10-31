<script lang="ts">
  // Co-author chips and the search popover that adds them. The description
  // text is the source of truth: `coAuthors` is parsed from it and each
  // add/remove is reported up so the parent edits the trailer lines.
  // Spec: docs/specs/commit-box.md "Co-authors".
  import { tick } from "svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import type { CoAuthor } from "$lib/commitMsg/trailers";
  import { filterAuthors, type AuthorOption } from "$lib/commitMsg/coAuthors";

  interface Props {
    /** People from the loaded graph, the current user already left out. */
    authors: AuthorOption[];
    /** Trailers currently in the description, as chips. */
    coAuthors: CoAuthor[];
    onAdd: (person: CoAuthor) => void;
    onRemove: (email: string) => void;
  }
  let { authors, coAuthors, onAdd, onRemove }: Props = $props();

  let open = $state(false);
  let query = $state("");
  let anchor: HTMLButtonElement | null = $state(null);
  let searchEl: HTMLInputElement | null = $state(null);
  let popoverStyle = $state("");

  const matches = $derived(filterAuthors(authors, query));
  const picked = $derived(new Set(coAuthors.map((p) => p.email.toLowerCase())));

  // The popover is fixed to the viewport, so the commit area's overflow:hidden
  // cannot clip it. It opens above the button, where the commit box sits.
  function toggle(): void {
    if (open) return close();
    const rect = anchor?.getBoundingClientRect();
    if (rect) {
      popoverStyle = `left: ${rect.left}px; bottom: ${window.innerHeight - rect.top + 6}px;`;
    }
    open = true;
    // The search box is mounted by the open flag, so focus it after the DOM update.
    tick().then(() => searchEl?.focus());
  }

  function close(): void {
    open = false;
    query = "";
  }

  function onPopoverKey(e: KeyboardEvent): void {
    if (e.key === "Escape") { e.preventDefault(); close(); }
  }

  function choose(a: AuthorOption): void {
    const email = a.email.toLowerCase();
    if (picked.has(email)) onRemove(a.email);
    else onAdd({ name: a.name, email: a.email });
  }

  function chipLabel(p: CoAuthor): string {
    return p.name || p.email;
  }
</script>

<div class="co-authors">
  {#each coAuthors as person (person.email.toLowerCase())}
    <span class="chip" title={person.email}>
      {chipLabel(person)}
      <button
        class="x"
        title={`Remove ${chipLabel(person)}`}
        aria-label={`Remove ${chipLabel(person)} from co-authors`}
        onclick={() => onRemove(person.email)}
      >
        <Icon name="close" size={14} />
      </button>
    </span>
  {/each}
  <button bind:this={anchor} class="add" aria-expanded={open} onclick={toggle}>
    <Icon name="users" size={14} />
    <span>Co-authors</span>
  </button>
</div>

{#if open}
  <div class="scrim" role="presentation" onclick={close}></div>
  <div
    class="popover"
    role="dialog"
    tabindex="-1"
    aria-label="Pick co-authors"
    style={popoverStyle}
    onkeydown={onPopoverKey}
  >
    <input
      bind:this={searchEl}
      class="search"
      placeholder="Search people in this history"
      bind:value={query}
    />
    <ul class="list">
      {#each matches as a (a.email)}
        <li>
          <button
            class="row"
            class:picked={picked.has(a.email.toLowerCase())}
            onclick={() => choose(a)}
          >
            <span class="mark">
              {#if picked.has(a.email.toLowerCase())}<Icon name="check" size={14} />{/if}
            </span>
            <span class="who">{a.name || a.email}</span>
            <span class="mail">{a.email}</span>
          </button>
        </li>
      {:else}
        <li class="empty">No matching people in the loaded history</li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .co-authors { display: flex; flex-wrap: wrap; gap: var(--sp-3); align-items: center; }
  .chip {
    display: inline-flex; align-items: center; gap: var(--sp-2);
    height: var(--h-row);
    font-size: var(--fs-sm); color: var(--fg);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    padding: 0 0 0 var(--sp-4); max-width: 220px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .x {
    display: inline-flex; align-items: center; justify-content: center;
    background: none; border: none; color: var(--fg-muted);
    cursor: pointer; padding: 0; border-radius: var(--radius-sm);
    width: var(--h-row); height: var(--h-row);
  }
  .x:hover { color: var(--fg); }
  .add {
    display: inline-flex; align-items: center; gap: var(--sp-3);
    height: var(--h-row);
    background: none; border: 1px dashed var(--border); border-radius: var(--radius-sm);
    color: var(--fg-muted); font-size: var(--fs-sm); padding: 0 var(--sp-4); cursor: pointer;
  }
  .add:hover { color: var(--fg); border-color: var(--fg-muted); }
  .scrim { position: fixed; inset: 0; z-index: 900; background: transparent; }
  .popover {
    position: fixed; z-index: 901; width: 300px; max-height: 320px;
    display: flex; flex-direction: column; gap: var(--sp-3); padding: var(--sp-4);
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius-lg);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .search {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-3) var(--sp-4); font: inherit; font-size: var(--fs-md);
  }
  .search:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .list { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
  .row {
    width: 100%; display: grid; grid-template-columns: var(--icon-sm) 1fr; gap: 0 var(--sp-3);
    background: none; border: none; color: inherit; text-align: left;
    padding: var(--sp-3) var(--sp-4); border-radius: var(--radius); cursor: pointer;
    font: inherit; font-size: var(--fs-md);
  }
  .row:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .row.picked .who { color: var(--accent); }
  .mark { color: var(--accent); grid-row: span 2; display: inline-flex; align-items: center; }
  .who { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mail {
    grid-column: 2; color: var(--fg-muted); font-size: var(--fs-sm);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .empty { color: var(--fg-muted); font-size: var(--fs-sm); padding: var(--sp-3) var(--sp-4); }
</style>
