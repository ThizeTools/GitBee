<script lang="ts">
  // The add and edit form for one profile. Field messages appear after the first
  // save attempt, so a fresh form does not open with errors already showing.
  // The rules are in $lib/profiles/validate; the backend repeats them on save.
  import { untrack } from "svelte";
  import { GPG_FORMATS, type GpgFormat, type Profile } from "$lib/profiles/profile";
  import { draftFromProfile, emptyDraft, type ProfileDraft } from "$lib/profiles/draft";
  import { isDraftValid, validateDraft } from "$lib/profiles/validate";

  interface Props {
    /** The profile being edited, or null for a new one. */
    editing: Profile | null;
    /** Every saved profile except the one being edited, for the duplicate-label check. */
    others: Profile[];
    busy: boolean;
    onSave: (draft: ProfileDraft) => void;
    onCancel: () => void;
  }
  let { editing, others, busy, onSave, onCancel }: Props = $props();

  // The form edits its own copy, so typing does not touch the saved list until Save.
  let draft = $state<ProfileDraft>(untrack(() => (editing ? draftFromProfile(editing) : emptyDraft())));
  let attempted = $state(false);
  const errors = $derived(validateDraft(draft, others));

  const FORMAT_LABEL: Record<GpgFormat, string> = { openpgp: "OpenPGP", ssh: "SSH", x509: "X.509" };

  function submit(): void {
    attempted = true;
    if (isDraftValid(errors) && !busy) onSave(draft);
  }
</script>

<form class="form" onsubmit={(e) => { e.preventDefault(); submit(); }}>
  <label class="field">
    <span class="lbl">Label</span>
    <input bind:value={draft.name} placeholder="Work" autocomplete="off" />
    {#if attempted && errors.name}<span class="err">{errors.name}</span>{/if}
  </label>
  <label class="field">
    <span class="lbl">Git name</span>
    <input bind:value={draft.userName} placeholder="Jane Doe" autocomplete="off" />
    {#if attempted && errors.userName}<span class="err">{errors.userName}</span>{/if}
  </label>
  <label class="field">
    <span class="lbl">Git email</span>
    <input bind:value={draft.userEmail} placeholder="jane@work.example" autocomplete="off" />
    {#if attempted && errors.userEmail}<span class="err">{errors.userEmail}</span>{/if}
  </label>
  <label class="field">
    <span class="lbl">Signing key <em>(optional)</em></span>
    <input bind:value={draft.signingKey} placeholder="e.g. ABCD1234" autocomplete="off" />
  </label>
  <label class="field">
    <span class="lbl">Signing format</span>
    <select bind:value={draft.gpgFormat}>
      <option value="">Not set</option>
      {#each GPG_FORMATS as format (format)}
        <option value={format}>{FORMAT_LABEL[format]}</option>
      {/each}
    </select>
  </label>
  <label class="check">
    <input type="checkbox" bind:checked={draft.isDefault} />
    <span>Use as default for new repos</span>
  </label>
  <footer class="foot">
    <button type="button" class="ghost" onclick={onCancel}>Back</button>
    <button type="submit" class="primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
  </footer>
</form>

<style>
  .form { display: flex; flex-direction: column; gap: var(--sp-6); }
  .field { display: flex; flex-direction: column; gap: var(--sp-3); }
  .lbl {
    font-size: var(--fs-sm); color: var(--fg-muted);
    text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600;
  }
  .lbl em { text-transform: none; font-weight: 400; letter-spacing: 0; }
  .field input, .field select {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-3) var(--sp-5); font-size: var(--fs-md);
  }
  .field input:focus, .field select:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .err { font-size: var(--fs-sm); color: var(--del); }
  .check { display: flex; gap: var(--sp-4); align-items: center; font-size: var(--fs-md); color: var(--fg); }
  .foot { display: flex; justify-content: flex-end; gap: var(--sp-4); padding-top: var(--sp-2); }
  /* Footer buttons: 28 px high, right-aligned. */
  .foot button {
    height: 28px;
    display: inline-flex; align-items: center;
    padding: 0 var(--sp-6); border-radius: var(--radius); font-size: var(--fs-md); cursor: pointer;
    border: 1px solid var(--border-strong); background: transparent; color: var(--fg);
  }
  .foot .primary {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-color: var(--accent); color: var(--accent); font-weight: 600;
  }
  .foot .primary:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .foot button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
