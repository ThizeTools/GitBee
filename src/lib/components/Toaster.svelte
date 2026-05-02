<script lang="ts">
  import { onMount } from "svelte";
  import { notices, dismiss, type Notice } from "$lib/stores/notifications";

  // We re-render the progress bars at ~30fps via a requestAnimationFrame loop
  // so the countdown is smooth without each Notice owning a timer.
  let now = $state(performance.now());
  let raf: number;
  onMount(() => {
    const tick = () => { now = performance.now(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  function pct(n: Notice): number {
    const elapsed = now - n.startedAt;
    return Math.max(0, Math.min(100, 100 - (elapsed / n.ttlMs) * 100));
  }

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
        <div class="bar-fill" style="width: {pct(n)}%"></div>
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
  .bar-fill {
    height: 100%;
    background: currentColor;
    transition: width 60ms linear;
  }
  .toast.info    .bar-fill { background: var(--renamed); }
  .toast.success .bar-fill { background: var(--accent); }
  .toast.warn    .bar-fill { background: var(--modified); }
  .toast.error   .bar-fill { background: var(--del); }
</style>
