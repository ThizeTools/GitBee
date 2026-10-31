<script lang="ts">
  import {
    notices, dismiss, pauseNotice, resumeNotice, type Notice,
  } from "$lib/stores/notifications";
  import Icon from "$lib/icons/Icon.svelte";
  import type { IconName } from "$lib/icons/names";

  // The progress bar drains with a CSS animation lasting the toast's TTL. A
  // rAF loop used to re-render this component every frame forever, even with
  // no toasts. Each toast mounts once (keyed by id), so an animation started
  // at mount matches its TTL without any per-frame work.
  //
  // Hover pauses both clocks: the store stops the dismiss timer, and the
  // `paused` class sets animation-play-state so the bar stops where it is.
  // Leaving resumes both from the same point, so they never drift apart.

  function icon(k: Notice["kind"]): IconName {
    switch (k) {
      case "success": return "check";
      case "warn": return "warning";
      case "error": return "close";
      default: return "info";
    }
  }
</script>

<div class="toaster" aria-live="polite" aria-atomic="false">
  {#each $notices as n (n.id)}
    <div
      class="toast {n.kind}"
      class:paused={n.runningSince === null}
      role="status"
      onmouseenter={() => pauseNotice(n.id)}
      onmouseleave={() => resumeNotice(n.id)}
    >
      <button class="close" onclick={() => dismiss(n.id)} title="Dismiss" aria-label="Dismiss">
        <Icon name="close" size={14} />
      </button>
      <div class="row">
        <span class="ico"><Icon name={icon(n.kind)} size={16} /></span>
        <div class="text">
          <div class="title">{n.title}</div>
          {#if n.message}<div class="msg">{n.message}</div>{/if}
        </div>
      </div>
      <div class="bar">
        <div class="bar-fill" style="animation-duration: {n.ttlMs}ms"></div>
      </div>
    </div>
  {/each}
</div>

<style>
  .toaster {
    position: fixed;
    left: var(--sp-8);
    /* Sits above the status bar: its height plus one 12 px step. */
    bottom: calc(var(--h-statusbar) + var(--sp-6));
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
    z-index: 900;
    pointer-events: none;
    max-width: 360px;
  }
  .toast {
    pointer-events: auto;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-left: 4px solid;
    border-radius: var(--radius-lg);
    box-shadow: 0 6px 18px rgba(0,0,0,0.45);
    padding: var(--sp-6) var(--sp-8) 0;
    overflow: hidden;
    position: relative;
    min-width: 280px;
    animation: slidein 160ms ease-out;
  }
  @keyframes slidein {
    from { transform: translateX(-12px); opacity: 0; }
    to   { transform: translateX(0); opacity: 1; }
  }
  .toast.info    { border-left-color: var(--renamed); }
  .toast.success { border-left-color: var(--accent); }
  .toast.warn    { border-left-color: var(--modified); }
  .toast.error   { border-left-color: var(--del); }

  .row {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-5);
    padding-right: var(--h-row); /* room for the close button */
  }
  .ico {
    display: flex; align-items: center; justify-content: center;
    width: var(--icon); height: var(--icon); flex-shrink: 0;
    margin-top: var(--sp-1);
  }
  .toast.info    .ico { color: var(--renamed); }
  .toast.success .ico { color: var(--accent); }
  .toast.warn    .ico { color: var(--modified); }
  .toast.error   .ico { color: var(--del); }

  .text { flex: 1; min-width: 0; }
  .title { font-weight: 600; font-size: var(--fs-md); color: var(--fg); }
  .msg { font-size: var(--fs-md); color: var(--fg-muted); margin-top: var(--sp-2); line-height: 1.4; }

  /* 24 px hit target, pinned to the top-right corner. */
  .close {
    position: absolute;
    top: var(--sp-3); right: var(--sp-3);
    display: inline-flex; align-items: center; justify-content: center;
    width: var(--h-row); height: var(--h-row);
    background: transparent;
    border: 0;
    border-radius: var(--radius);
    color: var(--fg-muted);
    cursor: pointer;
  }
  .close:hover { color: var(--fg); background: rgba(255,255,255,0.06); }

  .bar {
    margin-top: var(--sp-5);
    height: 3px;
    background: rgba(255,255,255,0.06);
  }
  /* Width is driven by toast-drain, started at mount and lasting the toast's
     TTL (set inline on each bar). No transition: the animation is the timer. */
  .bar-fill {
    height: 100%;
    width: 100%;
    background: currentColor;
    animation-name: toast-drain;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }
  @keyframes toast-drain {
    from { width: 100%; }
    to   { width: 0%; }
  }
  .toast.info    .bar-fill { background: var(--renamed); }
  .toast.success .bar-fill { background: var(--accent); }
  .toast.warn    .bar-fill { background: var(--modified); }
  .toast.error   .bar-fill { background: var(--del); }
  /* Mirrors pauseNotice(): the bar holds its place while the toast is hovered. */
  .toast.paused .bar-fill { animation-play-state: paused; }
</style>
