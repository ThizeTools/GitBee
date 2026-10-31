<script lang="ts">
  // Top of the commit details panel: sha and close button, subject with the
  // message body, then author, parents and refs. Display only: the parent
  // reads the commit and passes in the body.
  import { refsByCommit } from "$lib/stores/repo";
  import Avatar from "../Avatar.svelte";
  import Icon from "$lib/icons/Icon.svelte";
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
  <button class="close" onclick={onClose} title="Back to changes" aria-label="Back to changes">
    <Icon name="close" size={14} />
  </button>
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
    display: flex; align-items: center; gap: var(--sp-3);
    height: var(--h-section);
    padding: 0 var(--sp-6);
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-sm);
  }
  .commit-label { color: var(--fg-muted); }
  .commit-sha {
    color: var(--sha);
    font-family: "Cascadia Code", Consolas, monospace;
  }
  .spacer { flex: 1; }
  .close {
    width: var(--h-row); height: var(--h-row); padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: 0; color: var(--fg-muted);
    border-radius: var(--radius); cursor: pointer;
  }
  .close:hover { color: var(--del); }

  .subject-box {
    padding: var(--sp-6) var(--sp-8);
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
  }
  .subject {
    color: var(--fg);
    font-size: var(--fs-lg);
    font-weight: 600;
    line-height: 1.4;
  }
  .body {
    margin: var(--sp-4) 0 0;
    color: var(--fg-muted);
    font-family: "Cascadia Code", Consolas, monospace;
    font-size: var(--fs-sm);
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
    margin: var(--sp-3) auto;
    opacity: 0.6;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: var(--sp-6);
    padding: var(--sp-4) var(--sp-8);
    border-bottom: 1px solid var(--border);
  }
  .author { display: flex; align-items: center; gap: var(--sp-5); flex: 1; min-width: 0; }
  .author-text { display: flex; flex-direction: column; min-width: 0; }
  .name { font-size: var(--fs-md); color: var(--fg); font-weight: 500; }
  .when { font-size: var(--fs-sm); color: var(--fg-muted); }
  .parents {
    display: flex; align-items: center; gap: var(--sp-2);
    font-size: var(--fs-sm);
    color: var(--fg-muted);
    flex-shrink: 0;
  }
  .parent-label { color: var(--fg-muted); }
  .parent-sha { color: var(--sha); font-family: "Cascadia Code", Consolas, monospace; }

  .refs-row {
    padding: var(--sp-3) var(--sp-8);
    display: flex; gap: var(--sp-2); flex-wrap: wrap;
    border-bottom: 1px solid var(--border);
  }
  .ref {
    font-size: var(--fs-xs); padding: 1px var(--sp-3);
    border-radius: var(--radius-sm); border: 1px solid; line-height: 14px;
  }
  .ref.branch { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
  .ref.remote { color: var(--remote); border-color: color-mix(in srgb, var(--remote) 55%, transparent); }
  .ref.tag { color: var(--tag); border-color: color-mix(in srgb, var(--tag) 55%, transparent); }
</style>
