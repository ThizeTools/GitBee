<script lang="ts">
  import { currentRepo, status, graph, withBusy } from "$lib/stores/repo";
  import { showGraph } from "$lib/stores/center";
  import { ipc } from "$lib/ipc";
  import { logAppend } from "$lib/stores/logs";
  import { notifySuccess } from "$lib/stores/notifications";
  import { pushUndo } from "$lib/stores/history";
  import { commitUndo } from "$lib/stores/undoEntries";
  import { confirmDialog } from "$lib/stores/dialog";
  import Icon from "$lib/icons/Icon.svelte";
  import { tick } from "svelte";
  import {
    SUMMARY_LIMIT, amendFields, composeMessage, isStaged,
    summaryColor, summaryPercent,
  } from "./stagingHelpers";
  import { gitBool, readSignChoice, resolveSign, writeSignChoice } from "$lib/commitMsg/signing";
  import { claimFirstTemplateRead, splitTemplate } from "$lib/commitMsg/template";
  import { addCoAuthor, parseCoAuthors, removeCoAuthor, type CoAuthor } from "$lib/commitMsg/trailers";
  import { distinctAuthors, type Identity } from "$lib/commitMsg/coAuthors";
  import SignToggle from "./commit/SignToggle.svelte";
  import OptionToggle from "./commit/OptionToggle.svelte";
  import CoAuthorPicker from "./commit/CoAuthorPicker.svelte";
  import AiGenerateButton from "./commit/AiGenerateButton.svelte";
  import { identityFor, repoIdentity } from "$lib/profiles/identityStore";
  import { commitIdentityHint } from "$lib/profiles/profile";

  // The commit message form: summary, description, amend, sign, co-authors,
  // AI draft and the commit action. Self-contained so commit features land
  // here; the pure logic sits in $lib/commitMsg. Spec: docs/specs/commit-box.md.
  interface Props {
    /** Called after a successful commit so the parent can clear list selections. */
    onCommitted?: () => void;
  }
  let { onCommitted }: Props = $props();

  let summary = $state("");
  let description = $state("");
  let amend = $state(false);

  // Sign: the repo's commit.gpgsign is the default, and a user toggle per repo
  // wins over it (signing.ts). Both are loaded when the repo changes.
  let signDefault = $state(false);
  let signChoice = $state<boolean | null>(null);
  const signed = $derived(resolveSign(signDefault, signChoice));
  let identity = $state<Identity>({ name: "", email: "" });

  // For #16 — preserve user typing when toggling amend.
  let savedSummary = "";
  let savedDescription = "";
  let prevAmend = false;

  let summaryEl: HTMLInputElement | null = $state(null);
  let descriptionEl: HTMLTextAreaElement | null = $state(null);

  const stagedCount = $derived($status.filter(isStaged).length);
  const authors = $derived(distinctAuthors($graph?.nodes ?? [], identity));
  const coAuthors = $derived(parseCoAuthors(description));
  // Which identity the commit is made as, from the status bar's read (docs/specs/git-profiles.md).
  const identityHint = $derived(commitIdentityHint(identityFor($repoIdentity, $currentRepo)));

  $effect(() => {
    const repo = $currentRepo;
    if (!repo) return;
    signChoice = readSignChoice(repo);
    void loadRepoConfig(repo);
  });

  // Reads the three config values the box uses. A reply that arrives after the
  // user switched repos is dropped, so one repo's settings never leak into another.
  async function loadRepoConfig(repo: string): Promise<void> {
    const values = await Promise.all([
      ipc.gitConfigGet(repo, "commit.gpgsign"),
      ipc.gitConfigGet(repo, "user.name"),
      ipc.gitConfigGet(repo, "user.email"),
    ]).catch((): [null, null, null] => [null, null, null]);
    if ($currentRepo !== repo) return;
    const [gpgsign, name, email] = values;
    signDefault = gitBool(gpgsign) ?? false;
    identity = { name: name ?? "", email: email ?? "" };
  }

  function clearFields(): void {
    summary = ""; description = ""; amend = false;
    savedSummary = ""; savedDescription = "";
  }

  async function commit() {
    const repo = $currentRepo;
    if (!repo || !summary.trim()) return;
    if (stagedCount === 0 && !amend) return;
    const msg = composeMessage(summary, description);
    const before = $graph?.head_sha ?? null;
    // Captured before the await: the toggle may change during the commit, but
    // the undo redo must re-sign exactly what this commit did.
    const shouldSign = signed;
    if (await createCommit(repo, msg, shouldSign)) {
      afterCommit(repo, msg, before, shouldSign);
    }
  }

  // Tauri serializes Rust `()` returns as JSON null, so the previous
  // `ok !== null` gate falsely treated success as failure and the input
  // was never cleared. Use a local success flag instead. A failed signing
  // attempt surfaces git's own stderr through withBusy's error banner, which
  // is where gpg and ssh explain a missing key.
  async function createCommit(repo: string, msg: string, sign: boolean): Promise<boolean> {
    let ok = false;
    await withBusy(async () => {
      await ipc.commitCreate(repo, msg, amend, sign);
      ok = true;
    });
    return ok;
  }

  function afterCommit(repo: string, msg: string, before: string | null, sign: boolean): void {
    const subject = msg.split("\n")[0];
    // withBusy has refreshed the graph, so HEAD is the new commit here.
    const created = $graph?.head_sha ?? "";
    // Undo needs the HEAD this commit sat on. A first commit has none.
    if (before) pushUndo(commitUndo(repo, before, subject, msg, amend, sign));
    notifySuccess("Committed", `${created.slice(0, 7)}: ${subject}`);
    clearFields();
    onCommitted?.();
    logAppend("info", `committed: ${subject}`);
    // Drop user back on the graph after a successful commit so the new
    // commit is visible immediately. If they were viewing a diff, the
    // diff target is gone (file is now committed) — landing on the
    // graph is the unambiguous next step.
    showGraph();
  }

  // Ctrl+Enter (Cmd+Enter on macOS) anywhere in the summary or description
  // submits the commit. Matches the convention used by GitHub, GitLab,
  // and most native chat/commit UIs.
  function onCommitFieldKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  }

  // #16 — pull HEAD message into summary/description on amend toggle, restore on uncheck.
  $effect(() => {
    if (amend === prevAmend) return;
    if (amend) {
      savedSummary = summary;
      savedDescription = description;
      const headSha = $graph?.head_sha;
      if (headSha && $currentRepo) {
        ipc.commitShow($currentRepo, headSha).then((full) => {
          const fields = amendFields(full);
          summary = fields.summary;
          description = fields.description;
        }).catch(() => { /* leave whatever was there */ });
      }
    } else {
      summary = savedSummary;
      description = savedDescription;
    }
    prevAmend = amend;
  });

  // #14 — Enter in summary jumps to description. Ctrl+Enter submits.
  function onSummaryKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      tick().then(() => descriptionEl?.focus());
    }
  }

  function hasDraftText(): boolean {
    return summary.trim() !== "" || description.trim() !== "";
  }

  // The first focus of the summary in each repo fills an empty box from
  // commit.template. A non-empty box is left alone (docs/specs/commit-box.md).
  async function onSummaryFocus(): Promise<void> {
    const repo = $currentRepo;
    if (!repo || !claimFirstTemplateRead(repo) || hasDraftText()) return;
    const raw = await ipc.commitTemplate(repo).catch(() => null);
    if (raw === null || hasDraftText() || $currentRepo !== repo) return;
    const fields = splitTemplate(raw);
    summary = fields.summary;
    description = fields.description;
  }

  function onSignToggle(value: boolean): void {
    signChoice = value;
    const repo = $currentRepo;
    if (repo) writeSignChoice(repo, value);
  }

  function addPerson(person: CoAuthor): void {
    description = addCoAuthor(description, person);
  }

  function removePerson(email: string): void {
    description = removeCoAuthor(description, email);
  }

  // Puts an AI draft into the fields. Asks first when there is text, and keeps
  // the co-author trailers, which are the user's choice rather than the draft's.
  async function applyDraft(text: string): Promise<void> {
    if (hasDraftText()) {
      const ok = await confirmDialog({
        title: "Replace the commit message?",
        message: "The summary and description will be replaced by the generated message.",
        confirmLabel: "Replace",
      });
      if (!ok) return;
    }
    const fields = amendFields(text);
    const people = parseCoAuthors(description);
    summary = fields.summary;
    description = people.reduce((d, p) => addCoAuthor(d, p), fields.description);
  }
</script>

<div class="commit-body">
  <div class="field">
    <input
      bind:this={summaryEl}
      class="summary"
      placeholder="Commit summary"
      bind:value={summary}
      onkeydown={onSummaryKey}
      onfocus={onSummaryFocus}
    />
    <span class="counter" style="color: {summaryColor(summary.length)}">
      {summary.length}/{SUMMARY_LIMIT}
    </span>
  </div>
  <div class="counter-bar">
    <div class="counter-fill" style="width: {summaryPercent(summary.length)}%; background: {summaryColor(summary.length)}"></div>
  </div>
  <textarea
    bind:this={descriptionEl}
    class="description"
    placeholder="Description (optional). Press Enter in summary to jump here. Ctrl+Enter to commit."
    bind:value={description}
    onkeydown={onCommitFieldKey}
  ></textarea>
  <div class="options">
    <OptionToggle
      icon="history"
      label="Amend"
      checked={amend}
      title="Replace the previous commit instead of adding a new one"
      onChange={(v) => (amend = v)}
    />
    <SignToggle signed={signed} onToggle={onSignToggle} />
    <CoAuthorPicker
      {authors}
      {coAuthors}
      onAdd={addPerson}
      onRemove={removePerson}
    />
    <span class="spacer"></span>
    {#if $currentRepo}
      {@const repo = $currentRepo}
      <AiGenerateButton {repo} canGenerate={stagedCount > 0} onDraft={applyDraft} />
    {/if}
  </div>
  {#if identityHint}
    <div class="identity-hint" class:warn={identityHint.warn}>{identityHint.text}</div>
  {/if}
  <button
    class="commit-btn"
    onclick={commit}
    disabled={!summary.trim() || (stagedCount === 0 && !amend)}
  >
    <Icon name="check" size={16} />
    <span>Commit{amend ? " (amend)" : ""}{stagedCount > 0 ? ` ${stagedCount} file${stagedCount === 1 ? "" : "s"}` : ""}</span>
  </button>
</div>

<style>
  .commit-body {
    padding: var(--sp-6) var(--sp-8);
    display: flex; flex-direction: column; gap: var(--sp-4);
    flex: 1;
    /* never scroll — the description shrinks (flex:1 with min-height) */
    overflow: hidden;
    min-height: 0;
  }
  .field { position: relative; }
  .summary {
    width: 100%; height: 32px;
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 0 60px 0 var(--sp-5);
    font-size: var(--fs-lg); font-weight: 500;
  }
  .summary:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .counter {
    position: absolute; right: var(--sp-5); top: 50%; transform: translateY(-50%);
    font-size: var(--fs-xs); font-family: "Cascadia Code", Consolas, monospace;
    pointer-events: none;
  }
  .counter-bar { height: 2px; background: var(--border); border-radius: 1px; overflow: hidden; }
  .counter-fill { height: 100%; transition: width 100ms; }
  .description {
    background: var(--bg); color: var(--fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: var(--sp-4) var(--sp-5); font: inherit; font-size: var(--fs-md);
    resize: none;
    flex: 1;
    min-height: 80px;
  }
  .description:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .options {
    display: flex; gap: var(--sp-4); align-items: center; flex-wrap: wrap;
  }
  .spacer { flex: 1; }
  .identity-hint { font-size: var(--fs-sm); color: var(--fg-muted); }
  .identity-hint.warn { color: var(--modified); }
  /* Default: translucent fill (low opacity) with the accent border at 100%
     so the button reads as a primary action without dominating the panel.
     Hover: fill goes to 100% and content swaps to the bg for contrast. */
  .commit-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-4);
    width: 100%; height: 36px; flex-shrink: 0;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius); cursor: pointer;
    font-weight: 700; font-size: var(--fs-md);
    transition: background 120ms ease, color 120ms ease;
  }
  .commit-btn:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .commit-btn:disabled {
    background: transparent; color: var(--fg-muted);
    border-color: var(--border); cursor: not-allowed;
  }
</style>
