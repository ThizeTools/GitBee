<script lang="ts">
  // "Generate" writes a commit message from the staged changes through the
  // backend (docs/specs/ai-commit-message.md). This owns the key check, the
  // first-use settings dialog, the too-large offer and the gear. The parent
  // decides whether to overwrite its text, so it receives the draft through
  // `onDraft`.
  import { onMount } from "svelte";
  import { ipc } from "$lib/ipc";
  import { confirmDialog } from "$lib/stores/dialog";
  import { notifyError } from "$lib/stores/notifications";
  import Icon from "$lib/icons/Icon.svelte";
  import { formatKiB, parseDiffTooLarge } from "$lib/commitMsg/aiErrors";
  import AiSettingsDialog from "./AiSettingsDialog.svelte";

  interface Props {
    repo: string;
    /** False when nothing is staged; the button then explains why it is off. */
    canGenerate: boolean;
    onDraft: (text: string) => void;
  }
  let { repo, canGenerate, onDraft }: Props = $props();

  // null until the first status read returns.
  let hasKey: boolean | null = $state(null);
  let generating = $state(false);
  let settingsOpen = $state(false);
  // Runs once a key is saved from the first-use dialog, so the click that
  // opened it is not lost. Reset by every open, so a cancelled dialog leaves nothing behind.
  let afterSave: (() => void) | null = null;

  onMount(() => { void refreshKeyStatus(); });

  async function refreshKeyStatus(): Promise<void> {
    try {
      hasKey = await ipc.aiKeyStatus();
    } catch {
      hasKey = false;
    }
  }

  function openSettings(next: (() => void) | null): void {
    afterSave = next;
    settingsOpen = true;
  }

  async function onKeyChanged(): Promise<void> {
    await refreshKeyStatus();
    const next = afterSave;
    afterSave = null;
    if (hasKey === true) next?.();
  }

  function generate(): void {
    if (generating || !canGenerate) return;
    if (hasKey !== true) {
      openSettings(() => { void run(); });
      return;
    }
    void run();
  }

  async function run(): Promise<void> {
    generating = true;
    try {
      const text = await requestDraft();
      if (text !== null) onDraft(text);
    } catch (e) {
      notifyError("Could not generate a message", String(e));
    } finally {
      generating = false;
    }
  }

  // The full diff goes first. When it is over the limit, the user is asked
  // before only the file summary is sent. Declining gives null.
  async function requestDraft(): Promise<string | null> {
    try {
      return await ipc.aiCommitMessage(repo);
    } catch (e) {
      const size = parseDiffTooLarge(String(e));
      if (size === null) throw e;
      return confirmSummaryOnly(size);
    }
  }

  async function confirmSummaryOnly(size: number): Promise<string | null> {
    const ok = await confirmDialog({
      title: `The staged diff is ${formatKiB(size)}, over the 200 KB limit`,
      message:
        "Generate from the file summary only? Only the changed file names and line counts are sent, not the changes themselves.",
      confirmLabel: "Generate from file summary only",
    });
    return ok ? ipc.aiCommitMessageFromStat(repo) : null;
  }
</script>

<div class="ai">
  <button
    class="generate"
    onclick={generate}
    disabled={!canGenerate || generating}
    title={canGenerate
      ? "Write a commit message from the staged changes with Claude"
      : "Stage changes first"}
  >
    {#if generating}
      <span class="spinner" aria-hidden="true"></span>
      <span>Generating…</span>
    {:else}
      <Icon name="sparkles" size={14} />
      <span>Generate</span>
    {/if}
  </button>
  <button
    class="gear"
    onclick={() => openSettings(null)}
    title="AI commit message settings"
    aria-label="AI commit message settings"
  >
    <Icon name="settings" size={14} />
  </button>
</div>

{#if settingsOpen}
  <AiSettingsDialog
    hasKey={hasKey === true}
    onChanged={onKeyChanged}
    onClose={() => (settingsOpen = false)}
  />
{/if}

<style>
  .ai { display: flex; gap: var(--sp-2); align-items: center; }
  .generate {
    height: var(--h-row);
    background: none; border: 1px solid var(--border); border-radius: var(--radius);
    color: var(--fg); font-size: var(--fs-sm); padding: 0 var(--sp-5); cursor: pointer;
    display: inline-flex; align-items: center; gap: var(--sp-3);
  }
  .generate:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .generate:disabled { opacity: 0.5; cursor: not-allowed; }
  .gear {
    width: var(--h-row); height: var(--h-row); padding: 0;
    background: none; border: none; border-radius: var(--radius);
    color: var(--fg-muted); cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .gear:hover { color: var(--fg); background: var(--border); }
  .spinner {
    width: 10px; height: 10px; border-radius: 50%;
    border: 2px solid var(--border); border-top-color: var(--accent);
    animation: ai-spin 0.8s linear infinite; display: inline-block;
  }
  @keyframes ai-spin { to { transform: rotate(360deg); } }
</style>
