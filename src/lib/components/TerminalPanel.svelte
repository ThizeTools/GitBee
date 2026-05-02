<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { currentRepo } from "$lib/stores/repo";
  import { layout, setSize } from "$lib/stores/layout";
  import { termText, termRunning, termSessionId,
    startTerminal, stopTerminal, writeTerminal } from "$lib/stores/terminal";
  import { logAppend } from "$lib/stores/logs";
  import ResizeHandle from "./ResizeHandle.svelte";

  const CWD_MARK = "@@__GKP_CWD__@@";

  let scrollEl: HTMLDivElement | null = $state(null);
  let inputEl: HTMLInputElement | null = $state(null);
  let cmd = $state("");
  let history: string[] = [];
  let histIdx = -1;
  let cwd = $state<string>("");

  // Filter the CWD-marker lines out of the visible buffer and update cwd.
  let lastSeenLen = 0;
  $effect(() => {
    const text = $termText;
    if (text.length < lastSeenLen) lastSeenLen = 0; // buffer was cleared/trimmed
    if (text.length === lastSeenLen) return;
    const fresh = text.slice(lastSeenLen);
    lastSeenLen = text.length;
    const lines = fresh.split(/\r?\n/);
    for (const l of lines) {
      const i = l.indexOf(CWD_MARK);
      if (i >= 0) {
        cwd = l.slice(i + CWD_MARK.length).trim();
      }
    }
    tick().then(() => { if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight; });
  });

  async function ensureRunning() {
    if (!$currentRepo) return;
    if (!$termRunning) {
      try {
        await startTerminal($currentRepo);
        cwd = $currentRepo;
        // Ask the shell to emit the cwd marker once after startup.
        await pingCwd();
      } catch (e) { logAppend("error", `terminal start: ${e}`); }
    }
  }

  // Track the panel's previous open state so we only spawn on the open
  // edge (false → true). Without this, if the shell exits — which it can
  // do at any moment on its own — the effect would re-fire on every
  // termRunning change and respawn instantly, leading to an infinite
  // spawn loop in release builds (observed with cmd.exe under no console).
  let wasOpen = $state(false);
  $effect(() => {
    const open = $layout.terminalOpen;
    if (open && !wasOpen && $currentRepo && !$termRunning) {
      ensureRunning();
    }
    wasOpen = open;
  });

  async function pingCwd() {
    // cmd.exe-friendly marker: `cd` alone prints the current directory.
    if (isWindows()) {
      await writeTerminal(`echo ${CWD_MARK}%CD%`);
    } else {
      await writeTerminal(`printf "%s%s\\n" "${CWD_MARK}" "$(pwd)"`);
    }
  }
  function isWindows(): boolean {
    return typeof navigator !== "undefined" &&
      /win/i.test(navigator.platform || navigator.userAgent || "");
  }

  async function submit() {
    const line = cmd;
    if (!line.trim()) return;
    history.push(line); histIdx = history.length;
    cmd = "";
    // Echo the prompt+command into the buffer so the user sees what they ran.
    termText.update((t) => t + promptString() + line + "\n");
    await writeTerminal(line);
    // After every command, ask the shell to update cwd.
    await pingCwd();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    else if (e.key === "ArrowUp") {
      if (history.length === 0) return;
      e.preventDefault();
      histIdx = Math.max(0, histIdx - 1);
      cmd = history[histIdx] ?? "";
    } else if (e.key === "ArrowDown") {
      if (history.length === 0) return;
      e.preventDefault();
      histIdx = Math.min(history.length, histIdx + 1);
      cmd = history[histIdx] ?? "";
    }
  }
  function close() { setSize("terminalOpen", false); stopTerminal(); }
  function clear() { termText.set(""); lastSeenLen = 0; }

  function promptString(): string {
    return isWindows() ? `PS ${cwd || $currentRepo || ""}> ` : `${cwd || $currentRepo || ""}$ `;
  }

  // Visible text strips the marker lines.
  const visibleText = $derived(
    $termText.split(/\r?\n/).filter((l) => !l.includes(CWD_MARK)).join("\n")
  );

  onDestroy(() => stopTerminal());
</script>

{#if $layout.terminalOpen}
  <ResizeHandle
    direction="h"
    invert
    value={$layout.terminalHeight}
    min={120}
    max={600}
    onChange={(v) => setSize("terminalHeight", v)}
  />
  <div class="term" style="height: {$layout.terminalHeight}px">
    <header class="head">
      <span class="title">▶_ Terminal</span>
      <button class="ghost" onclick={clear} title="Clear">⌫</button>
      <button class="ghost" onclick={close} title="Close terminal">×</button>
    </header>
    <div class="body" bind:this={scrollEl}>
      <pre>{visibleText}</pre>
    </div>
    <div class="prompt">
      <span class="pline">{promptString()}</span>
      <input
        bind:this={inputEl}
        bind:value={cmd}
        onkeydown={onKey}
        spellcheck="false"
        placeholder={$termRunning ? "" : "(starting shell…)"}
      />
    </div>
  </div>
{/if}

<style>
  .term {
    display: flex;
    flex-direction: column;
    background: #050709;
    border-top: 1px solid var(--border-strong);
    flex-shrink: 0;
    min-height: 80px;
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 10px;
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    font-size: 11px;
  }
  .title { font-weight: 600; flex: 1; }
  .ghost {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; padding: 2px 8px; font-size: 13px; border-radius: 3px;
  }
  .ghost:hover { color: var(--fg); background: var(--border); }
  .body { flex: 1; overflow: auto; padding: 8px 10px; }
  pre {
    margin: 0;
    color: #d4d4d4;
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .prompt {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 4px 10px 6px;
    background: #050709;
    flex-shrink: 0;
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 12px;
  }
  .pline {
    color: #d4d4d4;
    white-space: pre;
  }
  input {
    flex: 1;
    background: transparent;
    color: #d4d4d4;
    border: 0;
    outline: none;
    font: inherit;
  }
</style>
