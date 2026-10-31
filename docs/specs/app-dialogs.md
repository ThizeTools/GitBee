# In-app dialogs (2026-10)

Neighbors: [repo-refresh.md](repo-refresh.md) (the refresh and checkout
flows that most of these confirms guard), [theme-system.md](theme-system.md)
(theme delete and import use these dialogs).

## Purpose
Every destructive or input step used the browser's `window.confirm`,
`prompt` and `alert`. Those calls:

1. Block the whole webview: no repaint, no toast, no hover while open.
2. Look OS-styled, unlike the rest of the app.
3. Cannot show a choice list or inline validation.

There were 58 call sites. Reset mode was the worst case: the user typed
`soft`, `mixed` or `hard` into a free-text prompt, and a typo was rejected
only after the prompt had closed.

## Public contract

### Store: `src/lib/stores/dialog.ts`
Every helper returns a promise that settles once, when the user answers
or dismisses the dialog.

| Helper | Resolves with | On cancel (Cancel, Esc, backdrop) |
|---|---|---|
| `confirmDialog({ title, message?, confirmLabel?, cancelLabel?, danger? })` | `true` / `false` | `false` |
| `promptDialog({ title, message?, initial?, placeholder?, confirmLabel?, validate? })` | the text as typed, untrimmed | `null` |
| `choiceDialog<T>({ title, message?, choices: { label, value, description?, danger? }[] })` | the chosen `value` | `null` |
| `alertDialog({ title, message? })` | `void` | `undefined` |

- `validate(value)` returns an error string or `null`. A string is
  shown inline and the confirm button is disabled. The validator sees
  the raw text; the promise still returns it untrimmed.
- `requireName(value)` blocks blank names (branch, tag). Used by the
  name prompts only.
- `footerLabels(view)` decides the buttons per kind: confirm and prompt
  have Cancel + confirm; choice has Cancel only (its buttons answer);
  alert has OK only.
- Queue: `DialogQueue` is a plain class with no DOM. It keeps one active
  entry and a FIFO of waiting entries. `answer(outcome)` shows the next
  entry before it settles the caller, so a caller that opens another
  dialog in response finds the queue already moved on.
- The active entry lives in the `activeDialog` store. `answerDialog`
  and `cancelDialog` are the only ways the view talks back to the queue.

### Component: `src/lib/components/AppDialog.svelte`
- Mounted once in `src/routes/+page.svelte`, next to `Toaster` and
  `ContextMenu`. z-index 1600, above the 1500 modals.
- Initial focus: the prompt input (text selected); the confirm button, or
  Cancel for `danger` confirms; the first choice; OK for alerts.
- Esc cancels. Tab and Shift+Tab wrap inside the card.
- Enter activates the focused control. In a prompt the form submits on
  Enter, and only while `validate` passes.
- While a dialog is open, window-level keys (graph arrows, Ctrl+P, Ctrl+T,
  ...) do not run. Typing in the prompt input still works.
- Focus returns to the element that had it before the first dialog
  opened.
- `danger` styles the confirm button and title with `--del`. A danger
  choice gets a red label.
- `message` keeps its newlines and scrolls past half the viewport. The
  File History and File Blame alerts rely on this.

### Call-site rules
- Destructive actions use `danger: true` and name the action on the
  button: Discard, Delete, Drop, Reset, Abort, Clear.
- Reset mode is a three-way `choiceDialog<ResetMode>`. Mixed is first (the
  old default). Hard is `danger`; choosing it opens a second confirm.
- `alert()` placeholders for File History and File Blame use
  `alertDialog`. A later task replaces them with real viewers.

## Invariants
- No `window.confirm`, `window.prompt` or `window.alert` call in `src/`.
  The only dialog surface is `AppDialog.svelte`.
- At most one dialog is on screen. Requests made while one is open wait
  and show in call order.
- Each helper's promise settles exactly once.
- Dialog text is rendered as text, never as HTML.

## Out of scope
- Multi-line input. Prompts are single-line; a tag annotation is one line
  too (see Open questions).
- Stacked dialogs (a dialog opened from inside another one stays queued).
- The staging `DiscardAllModal` is a custom modal, not a native call. It
  keeps its own component for now.
- Toast and notification behavior.

## Open questions
Some prompts keep their old behavior on cancel, because the native code
did the same and this change should not alter behavior:
- "Create annotated tag" (commit menu) and the "Message (empty for
  lightweight)" prompt in the commit panel: Cancel on the message prompt
  still creates the tag, as a lightweight one (`promptDialog(...) || undefined`).
- "Stash all changes" in the command palette and "Stash file": Cancel on the
  message prompt still stashes, with no message.

Both look like bugs: Cancel should abort. They need a decision before
the behavior changes.

## Rejected alternatives
- **Tauri's dialog plugin (`ask` / `message`).** Still OS-styled, and it
  cannot host a choice list or inline validation. `@tauri-apps/plugin-dialog`
  stays in use for the native file picker only.
- **One modal component per call site.** 58 near-duplicate modals, each
  with its own focus and Escape handling. One queue-driven component
  gives the same behavior everywhere.
- **Keep native `confirm` for "quick" confirms.** Inconsistent, and still
  blocks the event loop, so a quick confirm freezes the window just as
  much as a long one.
- **Single "reset mode" text prompt with validation on submit.** The
  error shows after the prompt has closed. A choice list cannot be
  mistyped.
