<script lang="ts">
  // Center pane for the pull requests of the active repo's origin on GitHub.
  // Loads the list when the view opens, when the tab or repo changes, and on
  // Refresh. Nothing polls in the background (spec: rejected alternatives).
  // Spec: docs/specs/github-pull-requests.md.
  import { untrack } from "svelte";
  import { currentRepo, remotes } from "$lib/stores/repo";
  import { ghAuth, ghRepos } from "$lib/stores/github";
  import { ipc } from "$lib/ipc";
  import { logAction } from "$lib/stores/logs";
  import { originGitHubRepo } from "$lib/github/url";
  import { signInIfScopeError } from "$lib/github/githubErrors";
  import type { PullDetail, PullRow, ReviewEvent } from "$lib/github/pullTypes";
  import PullRequestList from "./PullRequestList.svelte";
  import PullRequestDetail from "./PullRequestDetail.svelte";
  import ReviewDialog from "./ReviewDialog.svelte";
  import NewPullRequestDialog from "./NewPullRequestDialog.svelte";
  import { submitReview } from "./pullActions";

  type Tab = "open" | "closed";
  interface Repo { owner: string; name: string; }

  let tab = $state<Tab>("open");
  let rows = $state<PullRow[] | null>(null);
  let listError = $state<string | null>(null);
  let selected = $state<number | null>(null);
  let detail = $state<PullDetail | null>(null);
  let detailError = $state<string | null>(null);
  let reviewing = $state(false);
  let creating = $state(false);
  let nowMs = $state(Date.now());
  let reloadTick = $state(0);
  // Sequence numbers drop replies from a request that a newer one overtook.
  let listSeq = 0;
  let detailSeq = 0;

  const origin = $derived(originGitHubRepo($remotes));
  const originKey = $derived(origin ? `${origin.owner}/${origin.name}` : null);
  const defaultBase = $derived(
    $ghRepos?.find((r) => origin !== null && r.owner === origin.owner && r.name === origin.name)
      ?.default_branch ?? "main",
  );

  // Changing repo or tab starts from a clean selection, so a PR from the
  // previous scope never stays on screen.
  let scopeKey: string | null = null;
  $effect(() => {
    const key = originKey;
    const t = tab;
    const authed = $ghAuth.authenticated;
    void reloadTick;
    const scope = `${key}|${t}`;
    if (scope !== scopeKey) {
      scopeKey = scope;
      untrack(() => {
        selected = null;
        detail = null;
        detailError = null;
      });
    }
    if (key === null || !authed) return;
    untrack(() => {
      if (origin) void loadList(origin, t);
    });
  });

  async function loadList(gh: Repo, t: Tab): Promise<void> {
    const seq = ++listSeq;
    listError = null;
    const r = await logAction(`List ${t} pull requests`, () =>
      ipc.githubListPulls(gh.owner, gh.name, t),
    );
    if (seq !== listSeq) return;
    nowMs = Date.now();
    if (!r.ok) {
      rows = [];
      listError = signInIfScopeError(r.error) ?? r.error;
      return;
    }
    rows = r.value;
  }

  function select(n: number): void {
    selected = n;
    detail = null;
    void loadDetail(n);
  }

  async function loadDetail(n: number): Promise<void> {
    const gh = origin;
    if (!gh) return;
    const seq = ++detailSeq;
    detailError = null;
    const r = await logAction(`Load pull request #${n}`, () =>
      ipc.githubPullDetail(gh.owner, gh.name, n),
    );
    if (seq !== detailSeq || selected !== n) return;
    if (!r.ok) {
      detailError = signInIfScopeError(r.error) ?? r.error;
      return;
    }
    detail = r.value;
  }

  function refresh(): void {
    reloadTick += 1;
    if (selected !== null) void loadDetail(selected);
  }

  async function onReview(event: ReviewEvent, text: string): Promise<boolean> {
    const gh = origin;
    if (!gh || selected === null) return false;
    const ok = await submitReview(gh.owner, gh.name, selected, event, text);
    if (ok) void loadDetail(selected);
    return ok;
  }

  function onCreated(pr: PullRow): void {
    creating = false;
    tab = "open";
    reloadTick += 1;
    select(pr.number);
  }
</script>

<section class="pulls">
  <header class="bar">
    <span class="title">Pull requests</span>
    {#if origin}<span class="repo">{origin.owner}/{origin.name}</span>{/if}
    <div class="tabs" role="tablist">
      <button class:active={tab === "open"} onclick={() => (tab = "open")} role="tab" aria-selected={tab === "open"}>Open</button>
      <button class:active={tab === "closed"} onclick={() => (tab = "closed")} role="tab" aria-selected={tab === "closed"}>Closed</button>
    </div>
    <span class="grow"></span>
    <button onclick={refresh} disabled={!origin || !$ghAuth.authenticated}>Refresh</button>
    <button class="primary" onclick={() => (creating = true)} disabled={!origin || !$currentRepo || !$ghAuth.authenticated}>
      New pull request…
    </button>
  </header>

  {#if !$ghAuth.authenticated}
    <div class="empty">Sign in to GitHub to see pull requests.</div>
  {:else if !origin}
    <div class="empty">The origin remote of this repository is not on github.com.</div>
  {:else}
    <div class="split">
      <div class="listcol">
        {#if listError}<div class="error">{listError}</div>{/if}
        {#if rows === null}
          <div class="empty">Loading…</div>
        {:else if rows.length === 0}
          {#if !listError}<div class="empty">No {tab} pull requests.</div>{/if}
        {:else}
          <PullRequestList rows={rows} selected={selected} nowMs={nowMs} onSelect={select} />
        {/if}
      </div>
      <div class="detailcol">
        {#if detailError}<div class="error">{detailError}</div>{/if}
        {#if detail && $currentRepo && selected === detail.number}
          <PullRequestDetail
            detail={detail}
            repoPath={$currentRepo}
            owner={origin.owner}
            repo={origin.name}
            onChanged={refresh}
            onReview={() => (reviewing = true)}
          />
        {:else if selected !== null}
          <div class="empty">Loading #{selected}…</div>
        {:else}
          <div class="empty">Select a pull request to see its checks, reviews and description.</div>
        {/if}
      </div>
    </div>
  {/if}
</section>

{#if reviewing && detail}
  <ReviewDialog
    number={detail.number}
    title={detail.title}
    onSubmit={onReview}
    onClose={() => (reviewing = false)}
  />
{/if}

{#if creating && origin && $currentRepo}
  <NewPullRequestDialog
    owner={origin.owner}
    repo={origin.name}
    repoPath={$currentRepo}
    defaultBase={defaultBase}
    onCreated={onCreated}
    onClose={() => (creating = false)}
  />
{/if}

<style>
  .pulls { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--bg); color: var(--fg); }
  .bar {
    display: flex; align-items: center; gap: 10px; padding: 6px 12px;
    border-bottom: 1px solid var(--border); background: var(--bg-elev); flex-shrink: 0; flex-wrap: wrap;
  }
  .title { font-weight: 600; font-size: 13px; }
  .repo { color: var(--fg-muted); font-size: 12px; font-family: "Cascadia Code", Consolas, monospace; }
  .tabs { display: flex; gap: 2px; }
  .tabs button, .bar button {
    background: transparent; border: 1px solid transparent; color: var(--fg-muted);
    padding: 3px 9px; border-radius: 3px; cursor: pointer; font-size: 11px;
  }
  .tabs button.active { color: var(--fg); border-color: var(--border-strong); }
  .bar button { border-color: var(--border-strong); color: var(--fg); }
  .bar button.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .bar button:disabled { opacity: 0.4; cursor: not-allowed; }
  .grow { flex: 1; }
  .split { display: flex; flex: 1; min-height: 0; }
  .listcol { width: 360px; flex-shrink: 0; display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--border); }
  .detailcol { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .empty { padding: 24px 16px; color: var(--fg-muted); font-size: 12px; }
  .error { margin: 8px 10px; font-size: 11px; color: #f85149; }
</style>
