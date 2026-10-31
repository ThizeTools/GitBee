<script lang="ts">
  /**
   * Left side of the toolbar: repository and branch, each a small uppercase
   * label stacked over its value, separated by a chevron.
   */
  import Icon from "$lib/icons/Icon.svelte";

  interface Props {
    /** Folder name of the open repository. */
    repoName: string;
    /** Branch name, "(detached)" or "—", as TopBar computes it. */
    branchName: string;
    /** Full branch name for the tooltip; empty when detached. */
    branchTitle: string;
  }

  let { repoName, branchName, branchTitle }: Props = $props();
</script>

<div class="crumb">
  <div class="col">
    <span class="label">repository</span>
    <span class="repo">{repoName}</span>
  </div>
  <span class="chev"><Icon name="chevron-right" size={14} /></span>
  <div class="col">
    <span class="label">branch</span>
    <span class="branch" title={branchTitle}>{branchName}</span>
  </div>
</div>

<style>
  .crumb {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    min-width: 0;
  }
  .col {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .label {
    font-size: var(--fs-xs);
    line-height: 1.2;
    text-transform: uppercase;
    color: var(--fg-muted);
  }
  /* 15 px and 13 px are the spec's sizes; the --fs-* scale has no step for them. */
  .repo, .branch {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.2;
  }
  .repo { color: var(--fg); font-weight: 700; font-size: 15px; }
  .branch { color: var(--accent); font-weight: 500; font-size: 13px; }
  .chev { display: inline-flex; color: var(--fg-muted); }
</style>
