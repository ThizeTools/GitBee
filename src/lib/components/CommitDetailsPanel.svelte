<script lang="ts">
  import { graph, currentRepo, refsByCommit, withBusy } from "$lib/stores/repo";
  import { ipc } from "$lib/ipc";
  import DiffViewer from "./DiffViewer.svelte";
  import Avatar from "./Avatar.svelte";
  import { showCommitFile } from "$lib/stores/center";
  import type { FileDiff, GraphNode } from "$lib/ipc";
  import { commitFiles, selectedFileIndex, focusMode } from "$lib/stores/graphNav";

  interface Props { sha: string; onClose: () => void; }
  let { sha, onClose }: Props = $props();

  let diffs = $state<FileDiff[]>([]);
  let loading = $state(false);
  let viewMode = $state<"path" | "tree">("tree");
  // Sort cycles between two states: A→Z and Z→A, by full path. Used by
  // both the Path list and the Tree's `sortedChildren()` so the toggle
  // visibly affects either view.
  type SortMode = "asc" | "desc";
  let sortMode = $state<SortMode>("asc");
  let body = $state("");
  let allExpanded = $state(true);

  function cycleSort() {
    sortMode = sortMode === "asc" ? "desc" : "asc";
  }
  function sortIcon(): string {
    return sortMode === "asc" ? "↓A" : "↑A";
  }
  function sortLabel(): string {
    return sortMode === "asc" ? "Sort: A→Z" : "Sort: Z→A";
  }
  function pathOf(f: FileDiff): string { return f.new_path || f.old_path; }
  const sortedDiffs = $derived.by<FileDiff[]>(() => {
    const arr = diffs.slice();
    arr.sort((a, b) => sortMode === "asc"
      ? pathOf(a).localeCompare(pathOf(b))
      : pathOf(b).localeCompare(pathOf(a)));
    return arr;
  });

  const node = $derived.by<GraphNode | null>(() => {
    if (!$graph) return null;
    return $graph.nodes.find((n) => n.sha === sha) ?? null;
  });

  $effect(() => {
    void sha;
    if ($currentRepo) load();
    // New commit selected → reset nav state so ArrowRight starts on the
    // first file again. Keeps focus state consistent as user steps
    // through commits with ArrowUp/Down.
    selectedFileIndex.set(0);
    focusMode.set("graph");
  });

  // Publish the visible-order file list to the navigation store so the
  // global ArrowUp/Down handler can highlight + open files. Order has to
  // match what the user sees on screen (same sort + tree-flatten), or
  // ArrowDown jumps to the wrong row.
  $effect(() => {
    commitFiles.set(visibleFileOrder());
    if ($selectedFileIndex >= visibleFileOrder().length) selectedFileIndex.set(0);
  });

  function visibleFileOrder(): FileDiff[] {
    if (viewMode === "path") return sortedDiffs;
    // Tree mode: depth-first walk in the same order the template renders.
    const out: FileDiff[] = [];
    const walk = (n: TreeNode) => {
      if (n.file) { out.push(n.file); return; }
      for (const ch of sortedChildren(n)) walk(ch);
    };
    for (const ch of sortedChildren(root)) walk(ch);
    return out;
  }

  // Path of the currently highlighted file (used by template to add the
  // .nav-current class to the matching button).
  const navCurrentPath = $derived.by<string | null>(() => {
    const f = visibleFileOrder()[$selectedFileIndex];
    return f ? (f.new_path || f.old_path) : null;
  });

  // Auto-scroll the highlighted file button into view when index changes
  // via ArrowUp/Down. Only fires while in "files" focus mode so opening
  // the panel doesn't yank the user's manual scroll position.
  $effect(() => {
    void $selectedFileIndex;
    if ($focusMode !== "files") return;
    queueMicrotask(() => {
      document.querySelector(".file-btn.nav-current")?.scrollIntoView({ block: "nearest" });
    });
  });

  async function load() {
    if (!$currentRepo) return;
    loading = true;
    try {
      const [d, full] = await Promise.all([
        ipc.diffCommit($currentRepo, sha),
        ipc.commitShow($currentRepo, sha).catch(() => ""),
      ]);
      diffs = d;
      const lines = (full ?? "").replace(/\r\n/g, "\n").split("\n");
      // skip the subject line + blank line, the rest is the body
      let i = 1;
      while (i < lines.length && lines[i] === "") i++;
      body = lines.slice(i).join("\n").trim();
    } catch { diffs = []; body = ""; }
    finally { loading = false; }
  }

  // ----- actions (kept compact in a toolbar) -----
  async function cherryPick() {
    if (!$currentRepo || !confirm(`Cherry-pick ${sha.slice(0, 7)}?`)) return;
    await withBusy(() => ipc.cherryPick($currentRepo!, sha));
  }
  async function revert() {
    if (!$currentRepo || !confirm(`Revert ${sha.slice(0, 7)}?`)) return;
    await withBusy(() => ipc.revert($currentRepo!, sha, true));
  }
  async function resetTo(mode: "soft" | "mixed" | "hard") {
    if (!$currentRepo || !confirm(`Reset --${mode} to ${sha.slice(0, 7)}?`)) return;
    await withBusy(() => ipc.reset($currentRepo!, sha, mode));
  }
  async function checkoutDetached() {
    if (!$currentRepo) return;
    await withBusy(() => ipc.checkoutSha($currentRepo!, sha));
  }
  async function createBranch() {
    if (!$currentRepo) return;
    const name = prompt("New branch name:");
    if (!name) return;
    await withBusy(() => ipc.branchCreate($currentRepo!, name, sha));
  }
  async function createTag() {
    if (!$currentRepo) return;
    const name = prompt("Tag name:");
    if (!name) return;
    const message = prompt("Message (empty for lightweight):") || undefined;
    await withBusy(() => ipc.tagCreate($currentRepo!, name, sha, message));
  }

  function fmtDate(ts: number): string {
    const d = new Date(ts * 1000);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yy} @ ${hh}:${mi}`;
  }
  function initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "").join("");
  }
  function avatarColor(seed: string): string {
    let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360}, 45%, 42%)`;
  }

  // ----- file tree (path-style or nested) -----
  type TreeNode = {
    name: string; path: string;
    file?: FileDiff;
    children: Map<string, TreeNode>;
  };
  const root = $derived.by<TreeNode>(() => {
    const r: TreeNode = { name: "", path: "", children: new Map() };
    for (const f of diffs) {
      const fp = f.new_path || f.old_path;
      const parts = fp.split("/").filter(Boolean);
      let cur = r;
      for (let i = 0; i < parts.length; i++) {
        const isLeaf = i === parts.length - 1;
        const seg = parts[i];
        let child = cur.children.get(seg);
        if (!child) {
          child = { name: seg, path: parts.slice(0, i + 1).join("/"), children: new Map() };
          cur.children.set(seg, child);
        }
        if (isLeaf) child.file = f;
        cur = child;
      }
    }
    return r;
  });

  // Directories first, then files — alphabetical within each group, with
  // direction driven by `sortMode` so the toggle in the toolbar affects
  // both Path and Tree views.
  function sortedChildren(n: TreeNode): TreeNode[] {
    return [...n.children.values()].sort((a, b) => {
      const aIsDir = !a.file;
      const bIsDir = !b.file;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return sortMode === "asc"
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name);
    });
  }

  let collapsed = $state<Record<string, boolean>>({});
  function toggle(p: string) { collapsed[p] = !collapsed[p]; }
  function expandAll() {
    collapsed = {};
    allExpanded = !allExpanded;
    if (!allExpanded) {
      // collapse everything: walk tree and mark every dir collapsed
      const c: Record<string, boolean> = {};
      const walk = (n: TreeNode) => {
        if (!n.file && n.path) c[n.path] = true;
        for (const ch of n.children.values()) walk(ch);
      };
      walk(root);
      collapsed = c;
    }
  }

  function fileChanges(f: FileDiff): { add: number; del: number } {
    let add = 0, del = 0;
    for (const h of f.hunks) for (const l of h.lines) {
      if (l.kind === "add") add++;
      else if (l.kind === "del") del++;
    }
    return { add, del };
  }

  let showDiffs = $state(false);
</script>

<div class="commit-panel">
  {#if !node}
    <div class="empty">Loading commit…</div>
  {:else}
    <header class="bar">
      <span class="commit-label">commit:</span>
      <span class="commit-sha">{sha.slice(0, 7)}</span>
      <span class="spacer"></span>
      <button class="close" onclick={onClose} title="Back to changes">×</button>
    </header>

    <div class="subject-box">
      <div class="subject">{node.subject}</div>
      {#if body}
        <pre class="body">{body}</pre>
      {/if}
    </div>

    <div class="grip"></div>

    <div class="meta">
      <div class="author">
        <Avatar email={node.author_email} name={node.author_name} size={32} />
        <div class="author-text">
          <div class="name">{node.author_name}</div>
          <div class="when">authored {fmtDate(node.timestamp)}</div>
        </div>
      </div>
      <div class="parents">
        {#if node.parents.length === 1}
          <span class="parent-label">parent:</span>
          <span class="parent-sha">{node.parents[0].slice(0, 7)}</span>
        {:else if node.parents.length > 1}
          <span class="parent-label">parents:</span>
          {#each node.parents as p (p)}
            <span class="parent-sha">{p.slice(0, 7)}</span>
          {/each}
        {/if}
      </div>
    </div>

    {#if ($refsByCommit.get(sha) ?? []).length > 0}
      <div class="refs-row">
        {#each $refsByCommit.get(sha) ?? [] as r (r.name)}
          <span class="ref" class:branch={r.kind === "localbranch"}
            class:remote={r.kind === "remotebranch"} class:tag={r.kind === "tag"}>{r.name}</span>
        {/each}
      </div>
    {/if}

    <div class="files-bar">
      <span class="modified">
        <span class="m-ico">✎</span>
        <span class="m-count">{diffs.length}</span>
        <span class="m-lbl">modified</span>
      </span>
      <button class="bb" onclick={cycleSort} title={sortLabel()}>{sortIcon()}</button>
      <span class="seg">
        <button class:active={viewMode === "path"} onclick={() => viewMode = "path"}>≡ Path</button>
        <button class:active={viewMode === "tree"} onclick={() => viewMode = "tree"}>⌘ Tree</button>
      </span>
      <label class="ck">
        <input type="checkbox" bind:checked={showDiffs} />
        Show diffs
      </label>
    </div>

    <div class="files-body">
      {#if loading}
        <div class="empty">Loading…</div>
      {:else if diffs.length === 0}
        <div class="empty">No changes (or empty commit).</div>
      {:else if showDiffs}
        <DiffViewer diffs={diffs} />
      {:else}
        <div class="expand-row">
          <button class="link" onclick={expandAll}>{allExpanded ? "Collapse All" : "Expand All"}</button>
        </div>
        {#if viewMode === "tree"}
          <ul class="tree">
            {#each sortedChildren(root) as child (child.path)}
              {@render treeNode(child, 0)}
            {/each}
          </ul>
        {:else}
          <ul class="flat">
            {#each sortedDiffs as f (f.new_path || f.old_path)}
              {@const c = fileChanges(f)}
              {@const fp = f.new_path || f.old_path}
              <li>
                <button class="file-btn" type="button"
                  class:nav-current={navCurrentPath === fp}
                  onclick={() => showCommitFile(sha, fp)}>
                  <span class="f-ico">✎</span>
                  <span class="f-count">{c.add + c.del}</span>
                  <span class="f-path">{fp}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>

    <nav class="actions">
      <button onclick={cherryPick}>Cherry-pick</button>
      <button onclick={revert}>Revert</button>
      <button onclick={createBranch}>+ Branch</button>
      <button onclick={createTag}>+ Tag</button>
      <button onclick={checkoutDetached}>Checkout</button>
      <span class="reset-group">
        Reset:
        <button onclick={() => resetTo("soft")}>soft</button>
        <button onclick={() => resetTo("mixed")}>mixed</button>
        <button class="danger" onclick={() => resetTo("hard")}>hard</button>
      </span>
    </nav>
  {/if}
</div>

{#snippet treeNode(node: TreeNode, depth: number)}
  {#if node.file}
    {@const c = fileChanges(node.file)}
    {@const fp = node.file.new_path || node.file.old_path}
    <li class="file">
      <button class="file-btn" type="button"
        class:nav-current={navCurrentPath === fp}
        style="padding-left: {12 + depth * 14}px"
        onclick={() => showCommitFile(sha, fp)}>
        <span class="f-ico">✎</span>
        <span class="f-count">{c.add + c.del}</span>
        <span class="f-path">{node.name}</span>
      </button>
    </li>
  {:else}
    <li class="dir" style="padding-left: {12 + depth * 14}px">
      <button class="dir-toggle" onclick={() => toggle(node.path)}>
        <span class="caret">{collapsed[node.path] ? "▶" : "▼"}</span>
        <span class="name">{node.name}</span>
      </button>
    </li>
    {#if !collapsed[node.path]}
      {#each sortedChildren(node) as ch (ch.path)}
        {@render treeNode(ch, depth + 1)}
      {/each}
    {/if}
  {/if}
{/snippet}

<style>
  .commit-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    overflow: hidden;
  }
  .empty { padding: 30px; text-align: center; color: var(--fg-muted); font-style: italic; }

  .bar {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 12px;
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
    font-size: 11px;
  }
  .commit-label { color: var(--fg-muted); }
  .commit-sha {
    color: var(--sha);
    font-family: "Cascadia Code", Consolas, monospace;
  }
  .spacer { flex: 1; }
  .close {
    background: transparent; border: 0; color: var(--fg-muted);
    font-size: 18px; cursor: pointer; padding: 0 8px; line-height: 1;
  }
  .close:hover { color: var(--del); }

  .subject-box {
    padding: 14px 16px;
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
  }
  .subject {
    color: var(--fg);
    font-size: 16px;
    font-weight: 500;
    line-height: 1.4;
  }
  .body {
    margin: 8px 0 0;
    color: var(--fg-muted);
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    max-height: 220px;
    overflow: auto;
  }
  .grip {
    height: 4px;
    width: 38px;
    background: var(--border-strong);
    border-radius: 2px;
    margin: 6px auto;
    opacity: 0.6;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
  }
  .author { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
  .author-text { display: flex; flex-direction: column; min-width: 0; }
  .name { font-size: 12px; color: var(--fg); font-weight: 500; }
  .when { font-size: 11px; color: var(--fg-muted); }
  .parents {
    display: flex; align-items: center; gap: 4px;
    font-size: 11px;
    color: var(--fg-muted);
    flex-shrink: 0;
  }
  .parent-label { color: var(--fg-muted); }
  .parent-sha { color: var(--sha); font-family: "Cascadia Code", Consolas, monospace; }

  .refs-row {
    padding: 6px 14px;
    display: flex; gap: 4px; flex-wrap: wrap;
    border-bottom: 1px solid var(--border);
  }
  .ref {
    font-size: 10px; padding: 1px 7px;
    border-radius: 3px; border: 1px solid; line-height: 14px;
  }
  .ref.branch { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
  .ref.remote { color: var(--remote); border-color: color-mix(in srgb, var(--remote) 55%, transparent); }
  .ref.tag { color: var(--tag); border-color: color-mix(in srgb, var(--tag) 55%, transparent); border-radius: 8px; }

  .files-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev);
    font-size: 11px;
  }
  .modified { display: flex; align-items: center; gap: 6px; color: var(--fg-muted); }
  .m-ico { color: var(--tag); }
  .m-count { color: var(--fg); font-weight: 600; }
  .bb {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; padding: 2px 6px; font-size: 13px;
  }
  .bb:hover { color: var(--fg); }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
  .seg button {
    background: transparent; color: var(--fg-muted); border: 0;
    padding: 3px 10px; cursor: pointer; font-size: 11px;
  }
  .seg button.active { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--fg); }
  .ck { display: flex; align-items: center; gap: 5px; color: var(--fg-muted); font-size: 11px; margin-left: auto; }

  .files-body {
    flex: 1;
    overflow: auto;
  }
  .expand-row {
    padding: 6px 14px;
    border-bottom: 1px solid var(--border);
    background: transparent;
  }
  .link {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; font-size: 11px;
  }
  .link:hover { color: var(--fg); text-decoration: underline; }

  .tree, .flat { list-style: none; margin: 0; padding: 0; }
  .file, .dir {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0;
    font-size: 11px;
    color: var(--fg);
  }
  .dir { padding: 3px 12px; }
  .file-btn {
    display: flex; align-items: center; gap: 8px;
    width: 100%;
    padding: 3px 12px;
    background: transparent; border: 0; color: inherit;
    text-align: left; font: inherit; cursor: pointer;
  }
  .file-btn:hover { background: rgba(255,255,255,0.06); }
  /* ArrowUp/Down highlight while in "files" focus mode — uses accent
     so it reads as keyboard-driven, distinct from mouse hover. */
  .file-btn.nav-current {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    outline: 1px solid var(--accent);
  }
  .f-ico { color: var(--tag); font-size: 11px; }
  .f-count { color: var(--fg-muted); font-size: 10px; min-width: 14px; }
  .f-path {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: "Cascadia Code", Consolas, monospace; font-size: 11px;
  }
  .dir-toggle {
    background: transparent; border: 0; color: var(--fg-muted);
    cursor: pointer; padding: 0; display: inline-flex; align-items: center; gap: 6px;
    font-size: 11px;
  }
  .dir-toggle:hover { color: var(--fg); }
  .caret { font-size: 9px; width: 10px; }

  .actions {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-elev);
  }
  .actions button {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); padding: 4px 10px;
    border-radius: 3px; cursor: pointer; font-size: 11px;
  }
  .actions button:hover:not(.danger) { background: var(--border-strong); }
  .actions button.danger:hover { background: color-mix(in srgb, var(--del) 22%, transparent); border-color: var(--del); color: var(--del); }
  .reset-group {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 11px; color: var(--fg-muted); margin-left: auto;
  }
</style>
