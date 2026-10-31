<script lang="ts">
  import type { FileDiff } from "$lib/ipc";
  import { ipc } from "$lib/ipc";
  import { currentRepo } from "$lib/stores/repo";
  import { imageDataUrl } from "$lib/diff/image";
  import { revArg, type ImageRevs, type RevSide } from "$lib/diff/revs";

  interface Props { file: FileDiff; revs: ImageRevs; }
  let { file, revs }: Props = $props();

  type Pane =
    | { status: "loading" }
    | { status: "none" }
    | { status: "ready"; src: string }
    | { status: "error"; message: string };

  let oldPane = $state<Pane>({ status: "loading" });
  let newPane = $state<Pane>({ status: "loading" });
  // Each reload gets a number; a slower earlier response must not overwrite a newer one.
  let generation = 0;

  $effect(() => {
    const repo = $currentRepo;
    if (!repo) return;
    const gen = ++generation;
    oldPane = { status: "loading" };
    newPane = { status: "loading" };
    void loadPane(repo, file.old_path, revs.old).then((p) => {
      if (gen === generation) oldPane = p;
    });
    void loadPane(repo, file.new_path, revs.new).then((p) => {
      if (gen === generation) newPane = p;
    });
  });

  /** An empty path is how the diff marks a side that does not exist (added or deleted file). */
  async function loadPane(repo: string, path: string, side: RevSide): Promise<Pane> {
    if (path === "") return { status: "none" };
    try {
      const bytes = await ipc.fileBytesBase64(repo, revArg(side), path);
      return { status: "ready", src: imageDataUrl(bytes.mime, bytes.base64) };
    } catch (e) {
      return { status: "error", message: String(e) };
    }
  }
</script>

{#snippet pane(label: string, p: Pane)}
  <figure class="dv-img-pane">
    <figcaption>{label}</figcaption>
    {#if p.status === "ready"}
      <img src={p.src} alt="{label} version of {file.new_path || file.old_path}" />
    {:else if p.status === "none"}
      <div class="dv-img-none">(none)</div>
    {:else if p.status === "error"}
      <div class="dv-img-none">{p.message}</div>
    {:else}
      <div class="dv-img-none">Loading…</div>
    {/if}
  </figure>
{/snippet}

<div class="dv-image-diff">
  {@render pane("Old", oldPane)}
  {@render pane("New", newPane)}
</div>
