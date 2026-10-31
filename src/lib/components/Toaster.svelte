<script lang="ts">
  import { notices, dismiss, type Notice } from "$lib/stores/notifications";

  // The progress bar drains with a CSS animation lasting the toast's TTL. A
  // rAF loop used to re-render this component every frame forever, even with
  // no toasts. Each toast mounts once (keyed by id), so an animation started
  // at mount matches its TTL without any per-frame work.

  function icon(k: Notice["kind"]): string {
    switch (k) {
      case "success": return "✓";
      case "warn": return "⚠";
      case "error": return "✕";
      default: return "ⓘ";
    }
  }
</script>

<div class="toaster" aria-live="polite" aria-atomic="false">
  {#each $notices as n (n.id)}
    <div class="toast {n.kind}" role="status">
      <button class="close" onclick={() => dismiss(n.id)} title="Dismiss">×</button>
      <div class="row">
        <span class="ico">{icon(n.kind)}</span>
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
    left: 16px;
    bottom: 38px; /* above status bar */
    display: flex;
    flex-direction: column;
    gap: 10px;
    z-index: 900;
    pointer-events: none;
    max-width: 360px;
  }
  .toast {
    pointer-events: auto;
    background: var(--bg-elev);
    border: 1px solid var(--border-strong);
    border-left: 4px solid;
    border-radius: 8px;
    box-shadow: 0 6px 18px rgba(0,0,0,0.45);
    padding: 12px 14px 0;
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
    gap: 10px;
    padding-right: 24px; /* room for close */
  }
  .ico { font-size: 16px; line-height: 20px; width: 18px; text-align: center; flex-shrink: 0; }
  .toast.info    .ico { color: var(--renamed); }
  .toast.success .ico { color: var(--accent); }
  .toast.warn    .ico { color: var(--modified); }
  .toast.error   .ico { color: var(--del); }

  .text { flex: 1; min-width: 0; }
  .title { font-weight: 600; font-size: 13px; color: var(--fg); }
  .msg { font-size: 12px; color: var(--fg-muted); margin-top: 3px; line-height: 1.4; }

  .close {
    position: absolute;
    top: 6px; right: 8px;
    background: transparent;
    border: 0;
    color: var(--fg-muted);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .close:hover { color: var(--fg); background: rgba(255,255,255,0.06); }

  .bar {
    margin-top: 10px;
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
</style>
