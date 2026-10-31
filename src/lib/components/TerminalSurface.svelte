<script lang="ts">
  // One xterm view bound to one session. Surfaces of every session stay
  // mounted, so output keeps arriving while the dock is hidden or another repo
  // tab is open. Hidden surfaces are display:none and do not fit.
  import { onMount } from "svelte";
  import { createXtermView, type XtermView } from "$lib/terminal/xtermView";
  import { readTerminalColors } from "$lib/terminal/theme";
  import {
    attachOutputSink, detachOutputSink, resizeSession, sendInput,
  } from "$lib/stores/terminal";
  import { logAppend } from "$lib/stores/logs";

  // WHY 50 ms: dragging the dock handle fires many resize events. Debouncing
  // sends the shell one size change per pause, not one per pixel.
  const RESIZE_DEBOUNCE_MS = 50;

  interface Props { id: number; shown: boolean; }
  let { id, shown }: Props = $props();

  let host: HTMLDivElement;
  let view: XtermView | null = $state.raw(null);
  let lastSize = "";

  onMount(() => {
    const created = createXtermView(host, {
      colors: readTerminalColors(cssVar),
      onClipboard: (action) => void runClipboard(action),
    });
    view = created;
    attachOutputSink(id, (data) => created.write(data));
    created.onData((data) => sendInput(id, data));
    const stopWatching = watchSize(host, syncSize);
    return () => {
      stopWatching();
      detachOutputSink(id);
      created.dispose();
      view = null;
    };
  });

  $effect(() => {
    if (shown && view) view.focus();
  });

  function cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name);
  }

  /** Fits the grid and reports it only when it changed. */
  function syncSize(): void {
    const size = view?.fit();
    if (!size) return;
    const key = `${size.cols}x${size.rows}`;
    if (key === lastSize) return;
    lastSize = key;
    resizeSession(id, size.cols, size.rows);
  }

  async function runClipboard(action: "copy" | "paste"): Promise<void> {
    try {
      if (action === "copy") await copySelection();
      else await pasteClipboard();
    } catch (err) {
      logAppend("error", `terminal clipboard: ${err}`);
    }
  }

  async function copySelection(): Promise<void> {
    const text = view?.getSelection() ?? "";
    if (text) await navigator.clipboard.writeText(text);
  }

  async function pasteClipboard(): Promise<void> {
    const text = await navigator.clipboard.readText();
    view?.paste(text);
  }

  /** Calls `onSize` once the element's size has settled. Returns the stop function. */
  function watchSize(el: HTMLElement, onSize: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(onSize, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }
</script>

<div class="terminal-surface" class:hidden={!shown} bind:this={host}></div>

<style>
  .terminal-surface {
    flex: 1;
    min-height: 0;
    min-width: 0;
    padding: 4px 8px;
    overflow: hidden;
    background: var(--bg);
  }
  .terminal-surface.hidden { display: none; }
  .terminal-surface :global(.xterm) { height: 100%; }
</style>
