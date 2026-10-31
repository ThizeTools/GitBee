<script lang="ts">
  // API key settings for the AI commit message. Write-only: the key goes to the
  // OS store and is never read back, so the field starts empty even when a key
  // is saved. Spec: docs/specs/ai-commit-message.md "UI".
  import { ipc } from "$lib/ipc";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { notifyError, notifySuccess } from "$lib/stores/notifications";
  import { confirmDialog } from "$lib/stores/dialog";

  interface Props {
    /** Whether a key is saved now; decides whether "Clear key" is offered. */
    hasKey: boolean;
    /** Called after a save or clear so the parent refreshes its key status. */
    onChanged: () => void;
    onClose: () => void;
  }
  let { hasKey, onChanged, onClose }: Props = $props();

  let key = $state("");
  let saving = $state(false);
  const canSave = $derived(key.trim() !== "" && !saving);

  async function save(): Promise<void> {
    if (!canSave) return;
    saving = true;
    try {
      await ipc.aiKeySave(key);
      key = "";
      notifySuccess("API key saved", "The AI commit message is ready to use.");
      onChanged();
      onClose();
    } catch (e) {
      notifyError("Could not save the API key", String(e));
    } finally {
      saving = false;
    }
  }

  async function clear(): Promise<void> {
    const ok = await confirmDialog({
      title: "Remove the saved Anthropic API key?",
      message: "AI commit messages stop working until you add a key again.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await ipc.aiKeyClear();
      onChanged();
      onClose();
    } catch (e) {
      notifyError("Could not remove the API key", String(e));
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    // Enter saves only from the key field, so Enter on Clear or Cancel keeps its button action.
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) { e.preventDefault(); save(); }
  }

  function openConsole(): void {
    openUrl("https://console.anthropic.com").catch(() => {
      notifyError("Could not open the browser", "https://console.anthropic.com");
    });
  }
</script>

<div class="scrim" role="presentation" onclick={onClose}></div>
<div
  class="dialog"
  role="dialog"
  tabindex="-1"
  aria-modal="true"
  aria-label="AI commit message settings"
  onkeydown={onKey}
>
  <h2>AI commit message</h2>
  <p class="consent">
    Your staged diff will be sent to Anthropic to generate the message.
  </p>
  <label class="field">
    <span>Anthropic API key</span>
    <input
      type="password"
      autocomplete="off"
      spellcheck="false"
      placeholder={hasKey ? "A key is saved. Paste a new one to replace it" : "sk-ant-…"}
      bind:value={key}
    />
  </label>
  <button class="link" onclick={openConsole}>Get a key at console.anthropic.com</button>
  <div class="actions">
    {#if hasKey}
      <button class="ghost danger" onclick={clear} disabled={saving}>Clear key</button>
    {/if}
    <span class="spacer"></span>
    <button class="ghost" onclick={onClose}>Cancel</button>
    <button class="primary" onclick={save} disabled={!canSave}>
      {saving ? "Saving…" : "Save"}
    </button>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.45); }
  .dialog {
    position: fixed; z-index: 1001; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: min(420px, calc(100vw - 32px));
    display: flex; flex-direction: column; gap: 10px;
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 8px; padding: 16px 18px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  }
  h2 { margin: 0; font-size: 14px; font-weight: 700; }
  .consent { margin: 0; font-size: 12px; color: var(--fg-muted); line-height: 1.5; }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--fg-muted); }
  input {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 7px 9px; font: inherit; font-size: 12px;
  }
  input:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .link {
    align-self: flex-start; background: none; border: none; padding: 0;
    color: var(--accent); font-size: 12px; cursor: pointer; text-decoration: underline;
  }
  .actions { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
  .spacer { flex: 1; }
  button { font: inherit; font-size: 12px; border-radius: 4px; padding: 6px 12px; cursor: pointer; }
  .ghost { background: none; border: 1px solid var(--border); color: var(--fg); }
  .ghost:hover { border-color: var(--fg-muted); }
  .danger { color: var(--del); border-color: var(--del); }
  .primary {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent); border: 1px solid var(--accent); font-weight: 700;
  }
  .primary:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
