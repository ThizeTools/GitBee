<script lang="ts">
  import { appVersion } from "$lib/version";
  import { showingInfo } from "$lib/stores/info";

  type Status = "done" | "partial" | "planned";
  interface Feature { title: string; status: Status; note?: string; }
  interface Group { title: string; items: Feature[]; }

  // Hand-curated catalog of what's in / out of the build right now.
  // Update here when you add or finish a feature so this page stays a
  // single source of truth for the user.
  const groups: Group[] = [
    {
      title: "Repository tabs & navigation",
      items: [
        { title: "Multiple repo tabs (drag to reorder)", status: "done" },
        { title: "+ button opens New Tab page (Open / Clone / Create)", status: "done" },
        { title: "Recent repos on New Tab page", status: "done" },
        { title: "Tab right-click: close / close others / close right / reopen closed", status: "done" },
        { title: "Ctrl+T new tab · Ctrl+Shift+T reopen · Ctrl+W close · Ctrl+Tab cycle", status: "done" },
        { title: "Sessions persist across launches", status: "done" },
      ],
    },
    {
      title: "Sidebar (Local / Remote / Worktrees / Tags / Stashes)",
      items: [
        { title: "Live filter (Ctrl+Alt+F)", status: "done" },
        { title: "Single-click to jump graph · double-click to checkout", status: "done" },
        { title: "Double-click a graph row or branch pill to checkout its branch (remote → tracking branch)", status: "done" },
        { title: "Three-dot button + right-click context menu", status: "done" },
        { title: "Stash apply / pop / delete / edit message / hide", status: "done" },
        { title: "Set upstream (modal with remote + branch picker)", status: "done" },
        { title: "Worktree create from branch / remote / commit / tag", status: "done" },
      ],
    },
    {
      title: "Graph",
      items: [
        { title: "Virtualized canvas + HTML rows (28px per row)", status: "done" },
        { title: "Loads 2000 commits, more as you scroll near the end", status: "done" },
        { title: "GitKraken-style lanes: straight lines, rounded corners on the commit line, 10-color palette, avatar nodes", status: "done" },
        { title: "Merge into a branch that kept going joins its line (no duplicate parallel lines)", status: "done" },
        { title: "WIP row above the newest commit, dashed link to HEAD's lane", status: "done" },
        { title: "Stash entries (including older stash@{N})", status: "done" },
        { title: "Branch / Tag / Graph / Message / Author / Date / SHA columns — drag to reorder; right-click header to show/hide (SHA hidden by default)", status: "done" },
        { title: "Relative commit dates with absolute date-time tooltip", status: "done" },
        { title: "Dim merge commits (toggle in the graph header menu)", status: "done" },
        { title: "Hover a ref badge to dim every commit outside that ref's history", status: "done" },
        { title: "Scroll strip marks HEAD, selection, branch tips, stashes and search matches; click to jump", status: "done" },
        { title: "Changes column: files and +/- lines per commit with a bar (hidden by default; loads only visible rows)", status: "done" },
        { title: "Graph keys: h = HEAD, Shift+H = upstream, Home/End, PageUp/PageDown", status: "done" },
        { title: "Resize column widths (last column always fills)", status: "done" },
        { title: "Hover ghost: branches that contain this commit", status: "done" },
        { title: "Detached HEAD pill on the current commit", status: "done" },
        { title: "Search commits (Ctrl+F): SHA / subject / author, next/prev nav", status: "done" },
        { title: "Hide / Solo / Pin to Left filters (per-ref, per-repo, persisted)", status: "done" },
        { title: "Solo collapses graph to one branch's history (drops WIP + HEAD chain)", status: "done" },
        { title: "Pin = single ref, switching unpins previous", status: "done" },
        { title: "Auto-fetch every 5min + on window focus (rate-limited 30s)", status: "done" },
        { title: "Background refresh: coalesced, skips gitignored files, no loading veil; watcher paused while the window is unfocused", status: "done" },
        { title: "File edits refresh only the changes list; the graph reloads only when a branch, tag, HEAD or stash moved", status: "done" },
      ],
    },
    {
      title: "Branch / tag / commit context menus",
      items: [
        { title: "Pull / push / checkout / create branch / reset / revert / cherry-pick", status: "done" },
        { title: "Pull on a branch that is not checked out fast-forwards it from its remote, without checkout", status: "done" },
        { title: "Drag a branch badge or sidebar branch onto another branch to merge, rebase or fast-forward it (menu lists the options)", status: "done" },
        { title: "Create tag (lightweight & annotated) at any commit", status: "done" },
        { title: "Push tag — hidden when tag already exists on origin", status: "done" },
        { title: "Rename / delete branch (local) and remote (via push :refspec)", status: "done" },
        { title: "Copy branch name / sha / commit link / branch link (real URL from origin)", status: "done" },
        { title: "Pin to Left / Solo / Hide (toggle labels reflect current state)", status: "done" },
        { title: "Edit commit message (HEAD only, via amend)", status: "done" },
        { title: "Interactive rebase from a commit: reorder, reword, squash, fixup, drop (needs a clean worktree; merge commits refused)", status: "partial",
          note: "no --rebase-merges, edit action or autosquash" },
        { title: "Set upstream (with remote + remote-branch picker)", status: "done" },
        { title: "Start a pull request — opens GitHub compare URL", status: "done" },
        { title: "Create worktree from branch / remote / commit / tag", status: "done" },
        { title: "Annotate tag (delete + recreate as -a)", status: "done" },
        { title: "Fast-forward tag / Merge tag / Rebase onto tag", status: "done" },
        { title: "Apply patch (via dialog → git apply --3way)", status: "done" },
        { title: "Create patch from commit (format-patch -1 → folder)", status: "done" },
        { title: "Context menu auto-flips when near viewport edge", status: "done" },
        { title: "Share commit as Cloud Patch", status: "planned" },
        { title: "GitHub PR review (inline)", status: "planned" },
      ],
    },
    {
      title: "Right panel — staging & commit",
      items: [
        { title: "Unstaged / Staged with collapsible headers", status: "done" },
        { title: "Single Stage/Unstage hover button", status: "done" },
        { title: "File context menu (Stage, Discard, Ignore, Stash file, History, Blame, …)", status: "done" },
        { title: "Commit / Stash bottom tabs", status: "done" },
        { title: "Amend toggle preserves prior message", status: "done" },
        { title: "Sign commits (default from commit.gpgsign, remembered per repo)", status: "done" },
        { title: "Commit message template (commit.template) fills the box on first focus of a repo", status: "done" },
        { title: "Co-authors picker from the loaded history (Co-authored-by trailers)", status: "done" },
        { title: "AI commit message (Generate): Claude drafts from the staged diff; key kept in the OS credential store", status: "partial",
          note: "Anthropic only; diffs over 200 KB offer a file-summary mode" },
        { title: "Description expands to fill, no manual resize", status: "done" },
        { title: "Tree / Path view of changed files", status: "done" },
        { title: "Conflicts list with Mine / Theirs / Resolve above the changes (labels follow merge vs rebase)", status: "done" },
        { title: "Continue is blocked while files are still conflicted", status: "done" },
      ],
    },
    {
      title: "Right panel — commit details (when a commit is selected)",
      items: [
        { title: "Subject + author + date + parents + refs", status: "done" },
        { title: "Cherry-pick / Revert / Reset (soft/mixed/hard)", status: "done" },
        { title: "File list with +/- counts and status letters (A/M/D/R/C/T, bin) loads first; diffs load per expanded file (\"Show diffs\" = first 30, \"Load all N diffs\" for the rest)", status: "done" },
        { title: "Merge commits diff against their first parent", status: "done" },
        { title: "GitKraken-style header (avatar, modified count, view toggle)", status: "done" },
      ],
    },
    {
      title: "Diff / file view (center pane)",
      items: [
        { title: "Diff viewer (hunks, +/- counts)", status: "done" },
        { title: "Huge file diffs show the first 5000 lines (rest counted, not rendered)", status: "done" },
        { title: "Syntax highlighting for common languages", status: "done" },
        { title: "Changed words highlighted within paired removed/added lines", status: "done" },
        { title: "Unified or Split layout, remembered", status: "done" },
        { title: "Ignore whitespace toggle, remembered (badge while on)", status: "done" },
        { title: "Image diff: old and new side by side (up to 20 MB)", status: "done" },
        { title: "File View — full file contents", status: "done" },
        { title: "Stage / Unstage / Discard from header", status: "done" },
        { title: "Stage, unstage or discard a single hunk or picked lines (Shift/Ctrl+click the gutter); off while Ignore whitespace is on", status: "done" },
        { title: "File History (paged commits with the file's diff) and Blame (gutter with author, date and age bars; drill into previous revision)", status: "done" },
      ],
    },
    {
      title: "GitHub integration",
      items: [
        { title: "OAuth device flow + PAT login", status: "done" },
        { title: "Clone from GitHub repo picker (orgs + personal)", status: "done" },
        { title: "Create new repo directly on GitHub (private/public, owner picker)", status: "done" },
        { title: "Publish existing local repo to GitHub (push + set upstream)", status: "done" },
        { title: "Avatar resolution from email (cached on disk)", status: "done" },
        { title: "Sign-in token kept in the OS credential store (Credential Manager / Keychain / Secret Service)", status: "partial",
          note: "falls back to an obfuscated local value when the OS store is unavailable" },
        { title: "Start a pull request from remote branch menu", status: "done" },
        { title: "Copy commit/branch web link (auto-detect host: github/gitlab/bitbucket)", status: "done" },
        { title: "Inline PR review (comments, files, approve)", status: "planned" },
      ],
    },
    {
      title: "Notifications & logs",
      items: [
        { title: "Toast notifications (info / success / warn / error) with countdown", status: "done" },
        { title: "Hovering a toast pauses its countdown; at most 5 on screen, errors kept over info", status: "done" },
        { title: "Commit success toast with short sha", status: "done" },
        { title: "Logs panel: Application + Repository tabs", status: "done" },
        { title: "Structured action logs (started / finished Nms / failed)", status: "done" },
        { title: "Real git error message surfaced in toast", status: "done" },
      ],
    },
    {
      title: "Layout & UX",
      items: [
        { title: "Resizable sidebar / right panel / commit area / graph columns", status: "done" },
        { title: "Persisted layout (widths, column order, zoom, collapse states)", status: "done" },
        { title: "Ctrl +/- and 80–200% zoom picker in status bar", status: "done" },
        { title: "Status bar (git progress, fetch status, logs, shortcuts, zoom, version)", status: "done" },
        { title: "Live progress for fetch / pull / push: phase and percent in the status bar", status: "done" },
        { title: "Live progress for clone", status: "partial", note: "status bar only; the clone dialog has no progress bar yet" },
        { title: "Auto-fetch status: \"Fetched N min ago\"; warning pill with git's error on failure (click to retry)", status: "done" },
        { title: "Auto-update: background download + signature-verified one-click install", status: "done" },
        { title: "Light / dark theme toggle", status: "done" },
        { title: "Command palette (Ctrl+P): fuzzy finder over actions, branches, repos, files, themes and commits; prefixes > @ # / :", status: "done" },
        { title: "Undo / Redo (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y): commit, checkout, branch/tag create & delete, reset, discard, discard all, stash drop", status: "partial",
          note: "session only; push / fetch / pull are not undoable" },
        { title: "Shortcuts panel lists every shortcut, grouped", status: "done" },
        { title: "In-app confirm / input / choice dialogs (no native popups); reset mode picked from a list", status: "done" },
      ],
    },
    {
      title: "Terminal",
      items: [
        { title: "Open external terminal at repo (Windows Terminal → PowerShell → cmd)", status: "done" },
        { title: "Embedded terminal dock (real PTY, tabs, one set of shells per repo tab; Ctrl+`; external terminal on Ctrl+Shift+`)", status: "done" },
      ],
    },
    {
      title: "Planned next",
      items: [
        { title: "Inline GitHub PR review (comments, approve, files)", status: "planned" },
        { title: "True lane pin (Rust graph engine — beyond soft badge sort)", status: "planned" },
        { title: "Backend-side commit search (search beyond loaded slice)", status: "planned" },
        { title: "Conflict resolver: per-block Mine / Theirs / Both, custom edit, Save & mark resolved", status: "partial",
          note: "base section read-only; no three-pane editing" },
        { title: "Submodule pane", status: "planned" },
        { title: "LFS support beyond detection", status: "planned" },
      ],
    },
  ];

  function dot(s: Status): string {
    return s === "done" ? "●" : s === "partial" ? "◐" : "○";
  }
</script>

<div class="info">
  <header class="hd">
    <div class="title-row">
      <img class="logo" src="/bee-logo.png" alt="" />
      <h1>GitBee</h1>
      <span class="ver">v{appVersion}</span>
      <span class="spacer"></span>
      <button class="close-x" onclick={() => showingInfo.set(false)} title="Close (Esc)">×</button>
    </div>
    <p class="tag">Fast, lightweight Git client — Tauri + Svelte + Rust.</p>
  </header>

  <section class="legend">
    <span class="lg done">●</span> Done&nbsp;&nbsp;
    <span class="lg partial">◐</span> Partial&nbsp;&nbsp;
    <span class="lg planned">○</span> Planned
  </section>

  {#each groups as g (g.title)}
    <section class="group">
      <h2>{g.title}</h2>
      <ul>
        {#each g.items as it (it.title)}
          <li class={it.status}>
            <span class="mark" aria-label={it.status}>{dot(it.status)}</span>
            <div class="txt">
              <span class="t">{it.title}</span>
              {#if it.note}<span class="n">{it.note}</span>{/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

<style>
  .info {
    flex: 1;
    overflow: auto;
    background: var(--bg);
    padding: 28px;
  }
  .hd {
    max-width: 920px;
    margin: 0 auto 20px;
  }
  .title-row { display: flex; align-items: center; gap: 12px; }
  .title-row .logo { width: 96px; height: 96px; object-fit: contain; flex-shrink: 0; }
  .hd h1 {
    font-size: 56px;
    margin: 0;
    color: var(--accent);
    font-weight: 800;
    letter-spacing: 0.3px;
    line-height: 1;
  }
  .ver {
    color: var(--fg-muted);
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 12px;
  }
  .spacer { flex: 1; }
  .close-x {
    background: transparent; border: 0; color: var(--fg-muted);
    font-size: 22px; cursor: pointer; padding: 0 8px; line-height: 1;
    border-radius: 4px;
  }
  .close-x:hover { color: var(--fg); background: var(--bg-elev); }
  .tag { color: var(--fg-muted); margin: 8px 0 0 108px; font-size: 14px; }

  .legend {
    max-width: 920px;
    margin: 0 auto 18px;
    color: var(--fg-muted);
    font-size: 13px;
  }
  .lg { font-weight: 700; margin-right: 4px; font-size: 16px; }
  .lg.done    { color: var(--accent); }
  .lg.partial { color: var(--tag); }
  .lg.planned { color: var(--fg-muted); }

  .group {
    max-width: 920px;
    margin: 0 auto 22px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 18px;
  }
  .group h2 {
    margin: 0 0 10px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--fg);
    font-weight: 600;
  }
  .group ul { list-style: none; margin: 0; padding: 0; }
  .group li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    font-size: 13px;
    line-height: 1.4;
  }
  .group li:last-child { border-bottom: 0; }
  .mark { width: 20px; flex-shrink: 0; text-align: center; font-weight: 700; font-size: 16px; }
  li.done    .mark { color: var(--accent); }
  li.partial .mark { color: var(--tag); }
  li.planned .mark { color: var(--fg-muted); }
  .txt { display: flex; flex-direction: column; gap: 1px; }
  .t { color: var(--fg); }
  li.planned .t { color: var(--fg-muted); }
  .n { color: var(--fg-muted); font-size: 11px; }
</style>
