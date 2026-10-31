<script lang="ts">
  // Detail pane for the selected PR. Everything GitHub sent is shown as text.
  // The PR body goes in as a text node, never as HTML (spec invariant).
  import type { PullDetail } from "$lib/github/pullTypes";
  import {
    labelCssColor, mergeabilityLabel, pullBadge, reviewDecisionLabel, reviewerStateLabel,
  } from "$lib/github/pulls";
  import { formatAbsoluteDate, formatRelativeDate } from "$lib/graph/relativeDate";
  import PullChecks from "./PullChecks.svelte";
  import {
    checkoutPull, copyPullLink, mergePull, openPullOnGitHub, showPullInGraph,
  } from "./pullActions";

  interface Props {
    detail: PullDetail;
    repoPath: string;
    owner: string;
    repo: string;
    onChanged: () => void;
    onReview: () => void;
  }
  let { detail, repoPath, owner, repo, onChanged, onReview }: Props = $props();

  const isOpen = $derived(detail.state === "open" && !detail.merged);
  const badge = $derived(pullBadge(detail));
  const updated = $derived(formatRelativeDate(detail.updated_at, Date.now()));

  async function merge(): Promise<void> {
    const merged = await mergePull(owner, repo, detail);
    if (merged) onChanged();
  }
</script>

<article class="detail">
  <header>
    <div class="heading">
      <span class="num">#{detail.number}</span>
      <h2>{detail.title}</h2>
      <span class="badge badge-{badge.toLowerCase()}">{badge}</span>
    </div>
    <div class="route">
      <code>{detail.head_ref}</code> → <code>{detail.base_ref}</code>
      <span class="muted" title={formatAbsoluteDate(detail.updated_at)}>
        · {detail.author} · updated {updated}
      </span>
    </div>
  </header>

  <div class="actions">
    <button onclick={() => checkoutPull(repoPath, detail)}>Checkout</button>
    <button onclick={() => showPullInGraph(detail.head_sha)}>Show in graph</button>
    <button onclick={() => openPullOnGitHub(detail)}>Open on GitHub</button>
    <button onclick={() => copyPullLink(detail)}>Copy link</button>
    <span class="grow"></span>
    <button onclick={onReview} disabled={!isOpen}>Review…</button>
    <button class="primary" onclick={merge} disabled={!isOpen}>Merge…</button>
  </div>

  <section class="facts">
    <div><span class="k">Review</span> {reviewDecisionLabel(detail.review.decision)}</div>
    <div><span class="k">Merge</span> {mergeabilityLabel(detail.mergeable)}</div>
    <div>
      <span class="k">Changes</span>
      {detail.changed_files} file{detail.changed_files === 1 ? "" : "s"}
      <span class="add">+{detail.additions}</span> <span class="del">−{detail.deletions}</span>
    </div>
  </section>

  {#if detail.labels.length > 0}
    <div class="labels">
      {#each detail.labels as label}
        <span class="chip" style="border-color: {labelCssColor(label.color)}; color: {labelCssColor(label.color)}">{label.name}</span>
      {/each}
    </div>
  {/if}

  {#if detail.review.reviewers.length > 0 || detail.review.requested.length > 0}
    <section class="block">
      <h3>Reviewers</h3>
      <ul class="reviewers">
        {#each detail.review.reviewers as r}
          <li><span>{r.login}</span> <span class="muted">{reviewerStateLabel(r.state)}</span></li>
        {/each}
        {#if detail.review.requested.length > 0}
          <li class="muted">Requested: {detail.review.requested.join(", ")}</li>
        {/if}
      </ul>
    </section>
  {/if}

  <section class="block">
    <h3>Checks</h3>
    <PullChecks checks={detail.checks} />
  </section>

  <section class="block">
    <h3>Description</h3>
    <div class="body">{detail.body.trim() === "" ? "No description." : detail.body}</div>
  </section>
</article>

<style>
  .detail { display: flex; flex-direction: column; gap: var(--sp-6); padding: var(--sp-8); overflow-y: auto; min-height: 0; color: var(--fg); font-size: var(--fs-md); }
  header { display: flex; flex-direction: column; gap: var(--sp-3); }
  .heading { display: flex; align-items: baseline; gap: var(--sp-4); flex-wrap: wrap; }
  h2 { margin: 0; font-size: var(--fs-xl); font-weight: 600; }
  h3 { margin: 0 0 var(--sp-3); font-size: var(--fs-sm); text-transform: uppercase; color: var(--fg-muted); font-weight: 600; letter-spacing: 0.04em; }
  .num { color: var(--fg-muted); }
  .route { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3); }
  .route code { font-family: "Cascadia Code", Consolas, monospace; color: var(--accent); }
  .muted { color: var(--fg-muted); }
  /* State pill: 18 px high (no token), radius-sm. */
  .badge {
    display: inline-flex; align-items: center; height: 18px; font-size: var(--fs-xs);
    padding: 0 var(--sp-3); border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong); color: var(--fg-muted);
  }
  .badge-open { color: var(--add); border-color: color-mix(in srgb, var(--add) 50%, transparent); }
  .badge-merged { color: var(--remote); border-color: color-mix(in srgb, var(--remote) 50%, transparent); }
  .badge-closed { color: var(--del); border-color: color-mix(in srgb, var(--del) 50%, transparent); }
  .actions { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
  .grow { flex: 1; }
  /* Action buttons: 24 px high, the toolbar hit size. */
  .actions button {
    height: var(--h-row); background: transparent; border: 1px solid var(--border-strong); color: var(--fg);
    padding: 0 var(--sp-5); border-radius: var(--radius); cursor: pointer; font-size: var(--fs-sm);
  }
  .actions button:hover:not(:disabled) { background: var(--border); }
  .actions button:disabled { opacity: 0.4; cursor: not-allowed; }
  .actions button.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .facts { display: flex; flex-direction: column; gap: var(--sp-2); }
  .k { display: inline-block; width: 70px; color: var(--fg-muted); }
  .add { color: var(--add); }
  .del { color: var(--del); }
  .labels { display: flex; gap: var(--sp-3); flex-wrap: wrap; }
  .chip { border: 1px solid; border-radius: var(--radius-sm); padding: 0 var(--sp-4); font-size: var(--fs-sm); }
  .reviewers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-1); }
  .body { white-space: pre-wrap; word-break: break-word; line-height: 1.5; font-size: var(--fs-md); }
</style>
