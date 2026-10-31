<script lang="ts">
  // Review dialog: one text box and three verdicts. Approve may go without
  // text; Comment and Request changes need it (checked here and again in the
  // backend). Inline comments and review threads are out of scope (spec).
  import type { ReviewEvent } from "$lib/github/pullTypes";
  import { reviewBodyError } from "$lib/github/pulls";

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
      <button class="x" onclick={onClose} title="Close">×</button>
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
  .backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center; z-index: 1500;
  }
  .modal {
    width: min(560px, 92vw); background: var(--bg-elev);
    border: 1px solid var(--border-strong); border-radius: 8px;
    box-shadow: 0 18px 50px rgba(0,0,0,0.6); display: flex; flex-direction: column; color: var(--fg);
  }
  header { display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border-strong); }
  .title { font-weight: 700; font-size: 13px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .muted { color: var(--fg-muted); font-weight: 400; }
  .x { background: transparent; border: 0; color: var(--fg-muted); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
  .x:hover { color: var(--fg); }
  .body { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
  textarea {
    background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 4px;
    padding: 8px 10px; font-size: 12px; resize: vertical; min-height: 120px; font-family: inherit;
  }
  textarea:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .error { font-size: 11px; color: #f85149; }
  footer { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--border-strong); }
  .grow { flex: 1; }
  button {
    background: transparent; border: 1px solid var(--border-strong); color: var(--fg);
    padding: 5px 12px; border-radius: 3px; cursor: pointer; font-size: 12px;
  }
  button:hover:not(:disabled) { background: var(--border); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  button.ghost { border-color: transparent; color: var(--fg-muted); }
</style>
