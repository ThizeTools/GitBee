<script lang="ts">
  // The diff of a Git LFS pointer file: the object's size and oid in one card,
  // in place of the three pointer lines. Spec: docs/specs/git-lfs.md.
  import { describePointer, type LfsPointerPair } from "$lib/lfs/pointer";

  interface Props { pointer: LfsPointerPair; }
  let { pointer }: Props = $props();
  const label = $derived(describePointer(pointer));
</script>

<div class="lfs-card">
  <span class="lfs-tag">LFS object</span>
  <span class="sep">·</span>
  <span class="lfs-size">{label.size}</span>
  <span class="sep">·</span>
  <span class="lfs-oid">oid {label.oid}</span>
</div>

<style>
  .lfs-card {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    margin: 8px 12px; padding: 8px 12px;
    border: 1px solid var(--border); border-radius: 4px;
    background: var(--bg-elev);
    font-size: 11px; color: var(--fg-muted);
  }
  .lfs-tag { color: var(--accent); font-weight: 700; }
  .lfs-size { color: var(--fg); }
  .lfs-oid { font-family: "Cascadia Code", Consolas, monospace; }
  .sep { opacity: 0.6; }
</style>
