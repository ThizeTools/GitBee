<script lang="ts">
  import { onMount } from "svelte";
  import {
    currentRepo, errorMessage, busyVisible, refreshRecent, restoreTabs,
    tabs, activeTabId, activateTab, closeTab, reopenLastClosedTab,
  } from "$lib/stores/repo";
  import { showingNewTab } from "$lib/stores/newtab";
  import { showingInfo } from "$lib/stores/info";
  import InfoPage from "$lib/components/InfoPage.svelte";
  import { paletteOpen } from "$lib/stores/ui";
  import { showGraph, centerMode, showCommitFile } from "$lib/stores/center";
  import { showChanges } from "$lib/stores/rightpanel";
  import { layout, setSize, zoomIn, zoomOut, setZoom } from "$lib/stores/layout";
  import { logsPanelOpen, logAppend } from "$lib/stores/logs";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import TabBar from "$lib/components/TabBar.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import CenterPanel from "$lib/components/CenterPanel.svelte";
  import RightPanel from "$lib/components/RightPanel.svelte";
  import NewTabPage from "$lib/components/NewTabPage.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import ThemePicker from "$lib/components/ThemePicker.svelte";
  import StatusBar from "$lib/components/StatusBar.svelte";
  import LogsPanel from "$lib/components/LogsPanel.svelte";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import ResizeHandle from "$lib/components/ResizeHandle.svelte";
  import Toaster from "$lib/components/Toaster.svelte";
  import EditCommitMessageModal from "$lib/components/EditCommitMessageModal.svelte";
  import SetUpstreamModal from "$lib/components/SetUpstreamModal.svelte";
  import WorktreeCreateModal from "$lib/components/WorktreeCreateModal.svelte";
  import { activeModal } from "$lib/stores/modals";
  import { get } from "svelte/store";
  import { graph, selectedSha, activeTab, WIP_SHA } from "$lib/stores/repo";
  import { graphScrollTarget } from "$lib/stores/graphscroll";
  import { showCommit, showChanges as showRightChanges } from "$lib/stores/rightpanel";
  import {
    focusMode as navFocusMode,
    selectedFileIndex as navSelectedFileIndex,
    commitFiles as navCommitFiles,
    setFocus as navSetFocus,
  } from "$lib/stores/graphNav";

  // Move the selected commit by `dir` (+1 = older/below, -1 = newer/above)
  // in the loaded slice. WIP slot above row 0 is reachable with ArrowUp on
  // the topmost commit; pressing ArrowDown on WIP enters the first commit.
  function moveGraphSelection(dir: 1 | -1) {
    const g = get(graph);
    if (!g || g.nodes.length === 0) return;
    const cur = get(selectedSha);
    if (cur === WIP_SHA) {
      if (dir === 1) {
        const next = g.nodes[0];
        if (next) {
          selectedSha.set(next.sha);
          showCommit(next.sha);
          graphScrollTarget.set(next.sha);
        }
      }
      return;
    }
    if (cur === null) {
      // No selection yet — start at HEAD if known, else top of slice.
      const sha = g.head_sha ?? g.nodes[0]?.sha ?? null;
      if (sha) {
        selectedSha.set(sha);
        showCommit(sha);
        graphScrollTarget.set(sha);
      }
      return;
    }
    const idx = g.nodes.findIndex((n) => n.sha === cur);
    if (idx < 0) return;
    const next = idx + dir;
    if (next < 0) {
      // Above the topmost commit → land on the WIP row.
      selectedSha.set(WIP_SHA);
      showRightChanges();
      return;
    }
    if (next >= g.nodes.length) return;
    const sha = g.nodes[next].sha;
    selectedSha.set(sha);
    showCommit(sha);
    graphScrollTarget.set(sha);
  }

  // Cycle the highlighted file index AND open that file's diff in the
  // center pane — same effect as clicking the file. ArrowUp/Down should
  // feel like flipping through files, not just moving a highlight.
  function moveFileSelectionAndOpen(dir: 1 | -1) {
    const files = get(navCommitFiles);
    if (files.length === 0) return;
    const cur = get(navSelectedFileIndex);
    const next = (cur + dir + files.length) % files.length;
    navSelectedFileIndex.set(next);
    openFileAtIndex(next);
  }

  function openFileAtIndex(idx: number) {
    const files = get(navCommitFiles);
    const f = files[idx];
    if (!f) return;
    const t = get(activeTab);
    const sha = t?.selectedSha;
    if (!sha || sha === WIP_SHA) return;
    showCommitFile(sha, f.new_path || f.old_path);
  }

  // Reset center to Graph and right to Changes whenever the active tab changes.
  let lastTabId: string | null = null;
  $effect(() => {
    const id = $activeTabId;
    if (id !== lastTabId) {
      lastTabId = id;
      showGraph();
      showChanges();
      if (id !== null) {
        showingNewTab.set(false);
        showingInfo.set(false);
      }
    }
  });

  $effect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--ui-scale", String($layout.uiScale));
    const app = document.querySelector(".app") as HTMLElement | null;
    if (app) app.style.zoom = String($layout.uiScale);
    document.body.style.zoom = "";
  });

  onMount(() => {
    refreshRecent();
    restoreTabs();
    logAppend("info", "GitBee session started");
    // Background-prefetch GitHub auth + repo list as soon as the app
    // starts so the clone picker is already populated by the time the
    // user opens it. Fire-and-forget — errors stay quiet until the
    // user actually navigates somewhere that surfaces them.
    import("$lib/stores/github").then(({ bootGithubAuth }) => bootGithubAuth());
    // Same pattern for auto-update — silent check, silent download,
    // status bar pill turns green when there's something to install.
    import("$lib/stores/updater").then(({ bootUpdater }) => bootUpdater());
    // Auto-fetch active repo every 5 minutes so remote-tracking refs
    // (e.g. origin/gh-pages pushed externally) stay current without manual pulls.
    import("$lib/stores/autofetch").then(({ startAutoFetch }) => startAutoFetch());
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      // Arrow-key navigation across the graph + commit file list.
      // Skipped while typing in any text input/textarea/contenteditable
      // so search, commit message, and prompts keep their native arrow
      // behavior. No modifiers — modifier+arrow combos still bubble.
      if (
        !ctrl && !e.altKey && !e.shiftKey &&
        (e.key === "ArrowUp" || e.key === "ArrowDown" ||
         e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Enter")
      ) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        const editable =
          tag === "input" || tag === "textarea" || tag === "select" ||
          target?.isContentEditable;
        if (!editable && $currentRepo) {
          // Synchronous handling: dynamic-import path made preventDefault
          // arrive after the browser had already scrolled the graph. All
          // nav stores are statically imported above so the entire branch
          // runs in this tick.
          const mode = get(navFocusMode);
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            const dir = e.key === "ArrowDown" ? 1 : -1;
            if (mode === "graph") {
              e.preventDefault();
              moveGraphSelection(dir);
              return;
            } else if (mode === "files") {
              e.preventDefault();
              moveFileSelectionAndOpen(dir);
              return;
            }
          } else if (e.key === "ArrowRight" && mode === "graph") {
            const files = get(navCommitFiles);
            if (files.length > 0) {
              e.preventDefault();
              navSetFocus("files");
              navSelectedFileIndex.set(0);
              openFileAtIndex(0);
              return;
            }
          } else if (e.key === "ArrowLeft" && mode === "files") {
            e.preventDefault();
            navSetFocus("graph");
            // Drop user back on the graph view too — matches the
            // ArrowLeft "go back" mental model from #3 of this batch.
            showGraph();
            return;
          } else if (e.key === "Enter" && mode === "files") {
            const idx = get(navSelectedFileIndex);
            e.preventDefault();
            openFileAtIndex(idx);
            return;
          }
        }
      }
      // Zoom #7
      if (ctrl && (e.key === "+" || e.key === "=")) {
        e.preventDefault(); zoomIn(); return;
      }
      if (ctrl && (e.key === "-" || e.key === "_")) {
        e.preventDefault(); zoomOut(); return;
      }
      if (ctrl && e.key === "0") {
        e.preventDefault(); setZoom(1.2); return;
      }
      if (e.key === "Escape" && $centerMode.kind !== "graph") {
        e.preventDefault();
        showGraph();
      } else if (ctrl && e.key.toLowerCase() === "p") {
        e.preventDefault();
        paletteOpen.update((v) => !v);
      } else if (ctrl && e.key.toLowerCase() === "l") {
        e.preventDefault();
        logsPanelOpen.update((v) => !v);
      } else if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        // Ctrl+F → graph search bar. Only meaningful when the graph is
        // showing (DiffPanel has its own search affordances and shouldn't
        // get hijacked); the bar component handles its own focus + Esc.
        if ($currentRepo && $centerMode.kind === "graph") {
          e.preventDefault();
          import("$lib/stores/graphSearch").then(({ openSearch }) => openSearch());
        }
      } else if (ctrl && e.key === "`") {
        e.preventDefault();
        if ($currentRepo) {
          import("$lib/ipc").then(({ ipc }) => ipc.openTerminal($currentRepo!).catch(() => {}));
        }
      } else if (ctrl && e.key.toLowerCase() === "w") {
        // #1 round 7: if the "+" tab page is showing, dismiss it and
        // fall back to the active real tab. When no real tabs exist,
        // there's nothing to fall back to — keep New Tab visible (and
        // its indicator lit) instead of leaving an unhighlighted view.
        if ($showingNewTab) {
          e.preventDefault();
          if ($tabs.length > 0) showingNewTab.set(false);
          return;
        }
        const id = $activeTabId;
        if (id) { e.preventDefault(); closeTab(id); }
      } else if (ctrl && e.key.toLowerCase() === "t" && !e.shiftKey) {
        // Ctrl+T → open new tab page (#3)
        e.preventDefault();
        showingNewTab.set(true);
      } else if (ctrl && e.shiftKey && e.key.toLowerCase() === "t") {
        // Ctrl+Shift+T → reopen last closed tab (#2)
        e.preventDefault();
        reopenLastClosedTab();
      } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === "b" && !e.altKey) {
        // Ctrl+B → toggle left sidebar
        e.preventDefault();
        setSize("sidebarCollapsed", !$layout.sidebarCollapsed);
      } else if (ctrl && e.altKey && e.key.toLowerCase() === "b") {
        // Ctrl+Alt+B → toggle right panel
        e.preventDefault();
        setSize("rightPanelCollapsed", !$layout.rightPanelCollapsed);
      } else if (ctrl && e.key === "Tab") {
        const list = $tabs;
        const idx = list.findIndex((t) => t.id === $activeTabId);
        if (list.length > 1 && idx >= 0) {
          e.preventDefault();
          const dir = e.shiftKey ? -1 : 1;
          const next = list[(idx + dir + list.length) % list.length];
          activateTab(next.id);
        }
      } else if (ctrl && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        // Browser-style tab jump: Ctrl+1..8 picks the Nth tab; Ctrl+9
        // jumps to the last tab regardless of count, matching Chrome/Firefox.
        const list = $tabs;
        if (list.length === 0) return;
        const n = Number(e.key);
        const target = n === 9 ? list[list.length - 1] : list[n - 1];
        if (target) {
          e.preventDefault();
          showingNewTab.set(false);
          showingInfo.set(false);
          activateTab(target.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
</script>

<div class="app">
  <!-- #19 — topbar/tabbar span the full width above the sidebar -->
  <TabBar />
  <TopBar />

  {#if $errorMessage}
    <div class="error-bar">
      <span>{$errorMessage}</span>
      <button onclick={() => errorMessage.set(null)}>×</button>
    </div>
  {/if}

  <main class="row">
    {#if $showingInfo}
      <InfoPage />
    {:else if $showingNewTab || !$currentRepo}
      <NewTabPage />
    {:else}
      {#if $layout.sidebarCollapsed}
        <button class="rail" title="Expand sidebar"
          onclick={() => setSize("sidebarCollapsed", false)}>›</button>
      {:else}
        <aside class="left-pane" style:width="{$layout.sidebarWidth}px">
          <Sidebar />
          {#if $busyVisible}
            <!-- Lock the sidebar during git operations so the user can't
                 stack actions while one is running. The overlay catches
                 pointer events and shows a centered spinner. -->
            <div class="busy-veil" aria-hidden="true">
              <div class="spinner"></div>
              <div class="lbl">Working…</div>
            </div>
          {/if}
        </aside>
        <ResizeHandle direction="v" value={$layout.sidebarWidth} min={180} max={500}
          onChange={(v) => setSize("sidebarWidth", v)} />
      {/if}
      <div class="center-wrap">
        <CenterPanel />
      </div>
      {#if !$layout.rightPanelCollapsed}
        <ResizeHandle direction="v" invert value={$layout.rightPanelWidth} min={280} max={720}
          onChange={(v) => setSize("rightPanelWidth", v)} />
        <aside class="right-pane" style:width="{$layout.rightPanelWidth}px">
          <RightPanel />
        </aside>
      {/if}
    {/if}
  </main>

  <StatusBar />

  <CommandPalette />
  <ThemePicker />
  <LogsPanel />
  <ContextMenu />
  <Toaster />

  {#if $activeModal?.kind === "edit-commit-message"}
    <EditCommitMessageModal sha={$activeModal.sha} current={$activeModal.current} />
  {:else if $activeModal?.kind === "set-upstream"}
    <SetUpstreamModal branch={$activeModal.branch} />
  {:else if $activeModal?.kind === "worktree-create"}
    <WorktreeCreateModal
      reference={$activeModal.reference}
      refLabel={$activeModal.refLabel}
      isRemoteBranch={$activeModal.isRemoteBranch}
    />
  {/if}
</div>

<style>
  /* CSS `zoom` scales rendering but does NOT scale `vh/vw`. So we
     pre-divide the .app size by uiScale; after zoom the visual is back
     to filling the viewport. */
  .app {
    display: flex;
    flex-direction: column;
    height: calc(100vh / var(--ui-scale, 1));
    width: calc(100vw / var(--ui-scale, 1));
    overflow: hidden;
  }
  .row {
    flex: 1;
    display: flex;
    overflow: hidden;
    min-height: 0;
  }
  .left-pane {
    flex-shrink: 0;
    overflow: hidden;
    display: flex;
    position: relative; /* anchor for .busy-veil */
  }
  .busy-veil {
    position: absolute; inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(1px);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 12px;
    z-index: 50;
    color: var(--fg);
    cursor: progress;
  }
  .busy-veil .lbl {
    font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.6px;
    color: var(--fg-muted);
  }
  .spinner {
    width: 28px; height: 28px;
    border: 3px solid rgba(255, 255, 255, 0.12);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .rail {
    width: 22px;
    flex-shrink: 0;
    background: var(--bg-elev);
    border: 0;
    border-right: 1px solid var(--border-strong);
    color: var(--fg-muted);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0;
  }
  .rail:hover { background: var(--border); color: var(--fg); }
  .center-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }
  .right-pane {
    flex-shrink: 0;
    overflow: hidden;
    display: flex;
  }
  .error-bar {
    background: color-mix(in srgb, var(--del) 22%, transparent);
    color: var(--del);
    padding: 8px 16px;
    border-bottom: 1px solid var(--del);
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 12px;
    flex-shrink: 0;
  }
  .error-bar button {
    margin-left: auto;
    background: transparent;
    border: 0;
    color: var(--del);
    font-size: 18px;
    cursor: pointer;
  }
</style>
