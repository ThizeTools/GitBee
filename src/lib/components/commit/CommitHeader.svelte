<script lang="ts">
  // Top of the commit details panel: sha and close button, subject with the
  // message body, then author, parents and refs. Display only: the parent
  // reads the commit and passes in the body.
  import { refsByCommit } from "$lib/stores/repo";
  import Avatar from "../Avatar.svelte";
  import type { GraphNode } from "$lib/ipc";
  import { formatCommitDate } from "$lib/commit/format";

  interface Props {
    sha: string;
    node: GraphNode;
    body: string;
    onClose: () => void;
  }
  let { sha, node, body, onClose }: Props = $props();

  const refs = $derived($refsByCommit.get(sha) ?? []);
</script>

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
      <div class="when">authored {formatCommitDate(node.timestamp)}</div>
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

{#if refs.length > 0}
  <div class="refs-row">
    {#each refs as r (r.name)}
      <span class="ref" class:branch={r.kind === "localbranch"}
        class:remote={r.kind === "remotebranch"} class:tag={r.kind === "tag"}>{r.name}</span>
    {/each}
  </div>
{/if}

<style>
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
</style>
