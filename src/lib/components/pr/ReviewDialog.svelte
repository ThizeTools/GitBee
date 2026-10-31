<script lang="ts">
  // Review dialog: one text box and three verdicts. Approve may go without
  // text; Comment and Request changes need it (checked here and again in the
  // backend). Inline comments and review threads are out of scope (spec).
  import type { ReviewEvent } from "$lib/github/pullTypes";
  import { reviewBodyError } from "$lib/github/pulls";
  import Icon from "$lib/icons/Icon.svelte";

  interface Props {
    number: number;
    title: string;
    onSubmit: (event: ReviewEvent, body: string) => Promise<boolean>;
    onClose: () => void;
  }
  let { number, title, onSubmit, onClose }: Props = $props();

  let body = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function send(event: ReviewEvent): Promise<void> {
    if (busy) return;
    error = reviewBodyError(event, body);
    if (error !== null) return;
    busy = true;
    const ok = await onSubmit(event, body.trim());
    busy = false;
    if (ok) onClose();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" role="presentation" onclick={onClose}>
  <div class="modal" role="dialog" aria-label="Review pull request" tabindex="-1"
    onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
    <header>
      <span class="title">Review #{number} <span class="muted">{title}</span></span>
      <button class="x" type="button" onclick={onClose} title="Close" aria-label="Close review"><Icon name="close" size={14} /></button>
    </header>

    <div class="body">
      <textarea bind:value={body} rows="8" placeholder="Leave a comment (required for Comment and Request changes)"></textarea>
      {#if error}<div class="error">{error}</div>{/if}
    </div>

    <footer>
      <button class="ghost" onclick={onClose} disabled={busy}>Cancel</button>
      <span class="grow"></span>
      <button onclick={() => send("comment")} disabled={busy}>Comment</button>
      <button onclick={() => send("request_changes")} disabled={busy}>Request changes</button>
      <button class="primary" onclick={() => send("approve")} disabled={busy}>Approve</button>
    </footer>
  </div>
</div>

<style>
  /* Dialog layout: header 10 / 20 px with a bottom border, body 15 / 20 px,
     footer buttons 28 px high, radius-lg (layout spec, Region 7). */
  .backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center; z-index: 1500;
  }
  .modal {
    width: min(560px, 92vw); background: var(--bg-elev);
    border: 1px solid var(--border-strong); border-radius: var(--radius-lg);
    box-shadow: 0 18px 50px rgba(0,0,0,0.6); display: flex; flex-direction: column; color: var(--fg);
  }
  header {
    display: flex; align-items: center; gap: var(--sp-4);
    padding: var(--sp-5) var(--sp-20); border-bottom: 1px solid var(--border-strong);
  }
  .title { font-weight: 600; font-size: var(--fs-lg); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .muted { color: var(--fg-muted); font-weight: 400; }
  .x {
    display: inline-flex; align-items: center; justify-content: center;
    width: var(--h-row); height: var(--h-row); padding: 0;
    background: transparent; border: 0; border-radius: var(--radius);
    color: var(--fg-muted); cursor: pointer;
  }
  .x:hover { color: var(--fg); background: var(--border); }
  .body { padding: var(--sp-15) var(--sp-20); display: flex; flex-direction: column; gap: var(--sp-4); }
  textarea {
    background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-4) var(--sp-5); font-size: var(--fs-md); resize: vertical; min-height: 120px; font-family: inherit;
  }
  textarea:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .error { font-size: var(--fs-sm); color: var(--del); }
  footer {
    display: flex; align-items: center; gap: var(--sp-4);
    padding: var(--sp-5) var(--sp-20); border-top: 1px solid var(--border-strong);
  }
  .grow { flex: 1; }
  button {
    height: 28px; background: transparent; border: 1px solid var(--border-strong); color: var(--fg);
    padding: 0 var(--sp-6); border-radius: var(--radius); cursor: pointer; font-size: var(--fs-md);
  }
  button:hover:not(:disabled) { background: var(--border); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  button.ghost { border-color: transparent; color: var(--fg-muted); }
</style>
