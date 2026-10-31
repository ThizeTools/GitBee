<script lang="ts">
  // The profile manager: the saved list, add and edit through ProfileForm, and the
  // picker that applies one profile to the open repo. Opened from the status bar
  // pill. Spec: docs/specs/git-profiles.md "Profiles manager".
  import { currentRepo } from "$lib/stores/repo";
  import { confirmDialog } from "$lib/stores/dialog";
  import { notifyError, notifySuccess } from "$lib/stores/notifications";
  import { profiles, saveProfiles } from "$lib/profiles/profilesStore";
  import { applyProfileWithNotice } from "$lib/profiles/applyToRepo";
  import {
    defaultProfile, identityText, makeProfileId, profileLabel, upsertProfile, type Profile,
  } from "$lib/profiles/profile";
  import { profileFromDraft, type ProfileDraft } from "$lib/profiles/draft";
  import Icon from "$lib/icons/Icon.svelte";
  import ProfileForm from "./ProfileForm.svelte";

  interface Props {
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  /** null shows the list. `{ editing: null }` is the add form, `{ editing: p }` the edit form. */
  let form = $state<{ editing: Profile | null } | null>(null);
  let busy = $state(false);
  /** The picker's choice by id. Falls back to the default when that profile is gone. */
  let picked = $state<string | null>(null);

  const pickedProfile = $derived(
    $profiles.find((p) => p.id === picked) ?? defaultProfile($profiles) ?? $profiles[0],
  );
  const others = $derived($profiles.filter((p) => p.id !== (form?.editing?.id ?? null)));

  function startAdd(): void { form = { editing: null }; }
  function startEdit(profile: Profile): void { form = { editing: profile }; }
  function showList(): void { form = null; }

  /** Saves the form's profile. An edit keeps the saved id; a new profile gets a fresh one. */
  async function saveDraft(draft: ProfileDraft): Promise<void> {
    const id = form?.editing?.id ?? makeProfileId();
    await persist(upsertProfile($profiles, profileFromDraft(draft, id)), "Profile saved");
  }

  async function removeProfile(profile: Profile): Promise<void> {
    const ok = await confirmDialog({
      title: `Delete "${profile.name}"?`,
      message: "Repos keep the identity they already have. Only the saved profile is removed.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await persist($profiles.filter((p) => p.id !== profile.id), "Profile deleted");
  }

  /** Writes the whole list and reports the outcome. A failed save keeps the form open. */
  async function persist(next: Profile[], message: string): Promise<void> {
    busy = true;
    try {
      await saveProfiles(next);
      form = null;
      notifySuccess(message);
    } catch (e) {
      notifyError("Could not save profiles", String(e));
    } finally {
      busy = false;
    }
  }

  async function applyPicked(): Promise<void> {
    const repo = $currentRepo;
    if (!repo || !pickedProfile || busy) return;
    busy = true;
    try {
      await applyProfileWithNotice(repo, pickedProfile);
    } finally {
      busy = false;
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    e.preventDefault();
    if (form) showList();
    else onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" role="presentation" onclick={onClose}>
  <div
    class="modal"
    role="dialog"
    aria-label="Git profiles"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <header class="head">
      <span class="title">{form ? (form.editing ? "Edit profile" : "New profile") : "Git profiles"}</span>
      <button class="x" onclick={onClose} title="Close" aria-label="Close">
        <Icon name="close" size={16} />
      </button>
    </header>

    <div class="body">
      {#if form}
        <ProfileForm
          editing={form.editing}
          others={others}
          busy={busy}
          onSave={saveDraft}
          onCancel={showList}
        />
      {:else}
        {#if $currentRepo && pickedProfile}
          <section class="picker">
            <label class="lbl" for="profile-pick">Apply to this repo</label>
            <div class="row">
              <select id="profile-pick" value={pickedProfile.id} onchange={(e) => (picked = e.currentTarget.value)}>
                {#each $profiles as p (p.id)}
                  <option value={p.id}>{profileLabel(p)}{p.isDefault ? " (default)" : ""}</option>
                {/each}
              </select>
              <button class="primary" onclick={applyPicked} disabled={busy}>Apply</button>
            </div>
          </section>
        {/if}

        <ul class="list">
          {#each $profiles as p (p.id)}
            <li class="item">
              <div class="meta">
                <span class="name">
                  {p.name}
                  {#if p.isDefault}<span class="badge">default</span>{/if}
                </span>
                <span class="ident">
                  {identityText(p.userName, p.userEmail)}{p.signingKey ? ` · key ${p.signingKey}` : ""}
                </span>
              </div>
              <button class="ghost" onclick={() => startEdit(p)}>Edit</button>
              <button class="ghost danger" onclick={() => removeProfile(p)} disabled={busy}>Delete</button>
            </li>
          {:else}
            <li class="empty">No profiles yet. Add one for each identity you commit as.</li>
          {/each}
        </ul>
        <button class="add" onclick={startAdd}>
          <Icon name="add" size={14} /> Add profile
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 1500;
  }
  .modal {
    width: min(540px, 92vw); max-height: 85vh;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: 0 18px 50px rgba(0,0,0,0.6);
    display: flex; flex-direction: column;
    color: var(--fg);
  }
  /* Dialog header: 10 px 20 px padding, bottom border, --fs-lg title. */
  .head {
    display: flex; align-items: center;
    padding: var(--sp-5) var(--sp-20);
    border-bottom: 1px solid var(--border-strong);
  }
  .title { font-weight: 600; font-size: var(--fs-lg); flex: 1; }
  .x {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px;
    background: transparent; border: 0; border-radius: var(--radius);
    color: var(--fg-muted); cursor: pointer;
  }
  .x:hover { color: var(--fg); }
  /* Dialog body: 15 px 20 px padding. */
  .body {
    padding: var(--sp-15) var(--sp-20); overflow-y: auto;
    display: flex; flex-direction: column; gap: var(--sp-6);
  }
  .lbl {
    font-size: var(--fs-sm); color: var(--fg-muted);
    text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600;
  }
  .picker { display: flex; flex-direction: column; gap: var(--sp-3); }
  .row { display: flex; gap: var(--sp-4); }
  .row select {
    flex: 1; min-width: 0;
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-3) var(--sp-5); font-size: var(--fs-md);
  }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .item {
    display: flex; align-items: center; gap: var(--sp-4);
    padding: var(--sp-4) 0; border-bottom: 1px solid var(--border);
  }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
  .name { font-weight: 600; font-size: var(--fs-md); display: flex; gap: var(--sp-3); align-items: center; }
  .badge {
    font-size: var(--fs-xs); font-weight: 600; text-transform: uppercase;
    color: var(--accent); border: 1px solid var(--accent); border-radius: var(--radius-sm);
    padding: 0 var(--sp-2);
  }
  .ident {
    font-size: var(--fs-sm); color: var(--fg-muted);
    font-family: "Cascadia Code", Consolas, monospace;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .empty { font-size: var(--fs-md); color: var(--fg-muted); padding: var(--sp-6) 0; }
  /* Buttons in this dialog: 28 px high. */
  button {
    height: 28px;
    display: inline-flex; align-items: center; gap: var(--sp-3);
    padding: 0 var(--sp-6); border-radius: var(--radius); font-size: var(--fs-md); cursor: pointer;
    border: 1px solid var(--border-strong); background: transparent; color: var(--fg);
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .ghost.danger { color: var(--del); }
  .primary {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-color: var(--accent); color: var(--accent); font-weight: 600;
  }
  .primary:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .add {
    align-self: flex-start;
    background: transparent; color: var(--accent); border-color: var(--accent);
  }
</style>
