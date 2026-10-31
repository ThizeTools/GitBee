<script lang="ts">
  // Renders the dialog at the head of the queue (stores/dialog.ts). One modal
  // at a time, styled like the other in-app modals. Keyboard: Esc cancels,
  // Tab stays inside the card, Enter activates the focused control. The
  // window-level capture listener keeps global shortcuts (graph arrows,
  // Ctrl+P, ...) from firing behind the modal.
  import { tick } from "svelte";
  import {
    activeDialog, answerDialog, cancelDialog, footerLabels, promptError,
  } from "$lib/stores/dialog";

  const entry = $derived($activeDialog);
  const promptView = $derived.by(() => {
    const view = entry?.view;
    return view?.kind === "prompt" ? view.spec : null;
  });
  const danger = $derived(entry?.view.kind === "confirm" && entry.view.spec.danger === true);
  const labels = $derived(entry === null ? null : footerLabels(entry.view));

  let value = $state("");
  const error = $derived(promptView === null ? null : promptError(promptView, value));
  let card = $state<HTMLDivElement | undefined>(undefined);

  // The element that had focus before the first dialog opened. It gets focus
  // back when the queue drains, so keyboard users land where they were.
  let returnFocus: HTMLElement | null = null;

  $effect(() => {
    if (entry === null) {
      returnFocus?.focus();
      returnFocus = null;
      return;
    }
    if (returnFocus === null && document.activeElement instanceof HTMLElement) {
      returnFocus = document.activeElement;
    }
    value = promptView?.initial ?? "";
    void tick().then(focusInitial);
  });

  $effect(() => {
    window.addEventListener("keydown", onKeyCapture, true);
    return () => window.removeEventListener("keydown", onKeyCapture, true);
  });

  function focusInitial(): void {
    card?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    if (promptView !== null) card?.querySelector("input")?.select();
  }

  function onKeyCapture(e: KeyboardEvent): void {
    if (entry === null) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelDialog();
      return;
    }
    if (e.key === "Tab") keepFocusInside(e);
    // Typing in the prompt input must reach the input; everything else stops
    // here so page shortcuts do not run behind the modal.
    if (!(e.target instanceof HTMLInputElement)) e.stopImmediatePropagation();
  }

  // Wraps Tab / Shift+Tab inside the card. Only the boundary elements need
  // redirecting; the browser moves focus between the rest.
  function keepFocusInside(e: KeyboardEvent): void {
    const items = card?.querySelectorAll<HTMLElement>("button:not([disabled]), input");
    if (items === undefined || items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) cancelDialog();
  }

  // Native submit covers Enter in the prompt input and clicks on the confirm
  // button. The disabled confirm button already blocks an invalid submit, and
  // the guard below keeps the same rule if the form is submitted another way.
  function onSubmit(e: SubmitEvent): void {
    e.preventDefault();
    if (entry === null) return;
    const view = entry.view;
    if (view.kind === "prompt") {
      if (promptError(view.spec, value) === null) answerDialog(value);
    } else if (view.kind === "confirm") {
      answerDialog(true);
    } else if (view.kind === "alert") {
      answerDialog(undefined);
    }
  }
</script>

{#if entry !== null && labels !== null}
  <div class="backdrop" role="presentation" onclick={onBackdropClick}>
    <div class="card" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title"
      tabindex="-1" bind:this={card}>
      <form onsubmit={onSubmit}>
        <h3 id="app-dialog-title" class:danger>{entry.view.spec.title}</h3>

        <div class="body">
          {#if entry.view.spec.message}
            <p class="message">{entry.view.spec.message}</p>
          {/if}

          {#if entry.view.kind === "prompt"}
            <input type="text" class="input" bind:value
              placeholder={entry.view.spec.placeholder ?? ""}
              aria-invalid={error !== null}
              data-autofocus=""
              autocomplete="off" spellcheck="false" />
            {#if error !== null}
              <div class="error" role="alert">{error}</div>
            {/if}
          {:else if entry.view.kind === "choice"}
            <div class="choices">
              {#each entry.view.spec.choices as choice, i (i)}
                <button type="button" class="choice" class:danger={choice.danger === true}
                  data-autofocus={i === 0 ? "" : undefined}
                  onclick={() => answerDialog(choice.value)}>
                  <span class="choice-label">{choice.label}</span>
                  {#if choice.description}
                    <span class="choice-desc">{choice.description}</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <footer class="actions">
          {#if labels.cancel !== null}
            <button type="button" class="btn cancel" onclick={cancelDialog}
              data-autofocus={danger ? "" : undefined}>{labels.cancel}</button>
          {/if}
          {#if labels.confirm !== null}
            <button type="submit" class="btn confirm" class:danger
              disabled={error !== null}
              data-autofocus={danger ? undefined : ""}>{labels.confirm}</button>
          {/if}
        </footer>
      </form>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 1600;
  }
  .card {
    width: min(440px, 92vw);
    max-height: 80vh;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: 0 14px 40px rgba(0,0,0,0.5);
    color: var(--fg);
    overflow: hidden;
  }
  .card:focus { outline: none; }
  form {
    display: flex; flex-direction: column;
    max-height: 80vh;
    min-height: 0;
  }
  /* Dialog header: 10 px 20 px padding, bottom border, --fs-lg title. */
  h3 {
    margin: 0;
    padding: var(--sp-5) var(--sp-20);
    border-bottom: 1px solid var(--border-strong);
    font-size: var(--fs-lg); font-weight: 600;
    color: var(--fg);
  }
  h3.danger { color: var(--del); }
  /* Dialog body: 15 px 20 px padding. */
  .body {
    display: flex; flex-direction: column;
    gap: var(--sp-5);
    padding: var(--sp-15) var(--sp-20);
    min-height: 0;
    overflow-y: auto;
  }
  .message {
    margin: 0;
    font-size: var(--fs-md); line-height: 1.5;
    color: var(--fg-muted);
    white-space: pre-wrap;
    overflow-y: auto;
    min-height: 0;
    max-height: 50vh;
  }
  .input {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-3) var(--sp-5);
    font-size: var(--fs-md);
    font-family: "Cascadia Code", Consolas, monospace;
  }
  .input:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .input[aria-invalid="true"] { border-color: var(--del); }
  .error { font-size: var(--fs-sm); color: var(--del); }

  .choices { display: flex; flex-direction: column; gap: var(--sp-3); }
  .choice {
    display: flex; flex-direction: column; align-items: flex-start;
    gap: var(--sp-1);
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-4) var(--sp-5);
    text-align: left; cursor: pointer;
  }
  .choice:hover, .choice:focus-visible { border-color: var(--accent); outline: none; }
  .choice-label { font-size: var(--fs-md); font-weight: 600; }
  .choice-desc { font-size: var(--fs-sm); color: var(--fg-muted); }
  .choice.danger .choice-label { color: var(--del); }

  /* Footer: right-aligned, 28 px buttons. */
  .actions {
    display: flex; justify-content: flex-end; gap: var(--sp-4);
    padding: var(--sp-5) var(--sp-20);
  }
  .btn {
    height: 28px;
    display: inline-flex; align-items: center;
    padding: 0 var(--sp-6); border-radius: var(--radius); cursor: pointer;
    font-size: var(--fs-md); font-weight: 600;
  }
  .btn.cancel {
    background: transparent; color: var(--fg);
    border: 1px solid var(--border);
  }
  .btn.cancel:hover { background: var(--border); }
  .btn.confirm {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    border: 1px solid var(--accent);
  }
  .btn.confirm:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .btn.confirm.danger {
    background: var(--del); color: var(--bg);
    border-color: var(--del);
  }
  .btn.confirm.danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--del) 80%, white);
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
</style>
