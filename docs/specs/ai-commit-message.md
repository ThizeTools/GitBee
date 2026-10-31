# AI commit message (2026-10)

Neighbors: [commit-box.md](commit-box.md) (the box the button lives in),
[github-integration.md](github-integration.md) "Token storage" (the same OS
store, a different account), [undo-history.md](undo-history.md).

## Purpose

Write the commit message for the staged changes, so a user with a reasonable
diff does not have to compose a summary from scratch. The message is a draft
the user reads and edits before committing. It never commits on its own.

## Contract

### Commands

| Command | Input | Output | Notes |
|---|---|---|---|
| `ai_commit_message` | `path` | message text | full staged patch (`git diff --cached --no-color --no-ext-diff -U3`) plus `--stat` |
| `ai_commit_message_from_stat` | `path` | message text | `--stat` only; the patch is not read |
| `ai_key_status` | none | `bool` | whether a non-empty key is saved |
| `ai_key_save` | `key` | none | trims, validates, stores |
| `ai_key_clear` | none | none | removes the key |

The key is never returned. No command outputs it, and no log line includes it.

### Model request

`POST https://api.anthropic.com/v1/messages` with headers `x-api-key`,
`anthropic-version: 2023-06-01`, `content-type: application/json` and
`anthropic-beta: server-side-fallback-2026-07-01`. Body:

```json
{
  "model": "claude-opus-5-5",
  "max_tokens": 4096,
  "fallbacks": "default",
  "output_config": { "effort": "low" },
  "system": "<SYSTEM_PROMPT>",
  "messages": [{ "role": "user", "content": "<recent subjects, stat, diff>" }]
}
```

The request never includes `temperature`, `top_p`, `top_k` or `thinking`. This
model always thinks, and effort `low` keeps that short. Timeout: 60 s.

The user message is, in order: up to ten recent commit subjects (`git log -10
--format=%s`, labeled "for style only"), the `--stat`, and, in diff mode only,
the patch.

### Reply handling

- Text is the concatenation of the `text` blocks of `content`, in order. Other
  block types are skipped.
- `stop_reason: "refusal"` → error `The model declined: <stop_details.explanation>`
  (or the category, or "no reason given").
- `stop_reason: "max_tokens"` → error asking the user to try again. A cut-off
  message is never returned as if it were finished.
- The reply is trimmed, and one wrapping code fence is removed if present. An
  empty result is an error.

### HTTP errors

| Status | Message |
|---|---|
| 401 | `Invalid Anthropic API key` |
| 429, 529 | `Rate limited / overloaded, try again` |
| other | the API's `error.message`, or `Anthropic API returned HTTP <status>` |

Network failures say `Could not reach Anthropic: <reason>`.

### Errors the command returns

| Situation | Message |
|---|---|
| Nothing staged | `Stage changes first` |
| Staged patch over 200 KiB (204 800 bytes) | `DIFF_TOO_LARGE:<bytes>` |
| No key saved | `No Anthropic API key saved. Add one in the AI settings.` |
| Key empty, or contains spaces | refused, the key is not repeated in the message |

`DIFF_TOO_LARGE:<bytes>` is a marker the UI reads, not a sentence. The UI shows
the size and offers the file-summary mode.

### UI

- **Generate** (✨) in the commit box. Disabled with the tooltip "Stage changes
  first" when nothing is staged.
- **Gear** next to it opens the settings dialog.
- First use with no key opens the same dialog, and the click resumes after save.
- The dialog has a password field, a link-style "Get a key at
  console.anthropic.com" (opens in the browser), and the consent line "Your
  staged diff will be sent to Anthropic to generate the message." It has Save,
  Cancel and, when a key exists, Clear (with a confirmation).
- While generating, the button shows a spinner and "Generating…".
- A draft replaces the summary and description. When either has text, the user
  is asked first. Co-author lines are kept.
- Errors are toasts. An over-size diff opens a confirmation: "Generate from file
  summary only" sends `--stat` only. Cancel does nothing.

## Invariants

- **The diff is sent only on an explicit click** on Generate, and only for the
  staged changes at that moment. Nothing is sent on box focus, on staging or on
  opening the app.
- **The key stays in the OS store.** It is written through `SecretStore` under
  account `anthropic-api-key` (service `GitBee`, the same service as the GitHub
  token), read in Rust for each request, and never returned, logged or echoed in
  an error.
- **Never truncates silently.** A diff over the limit is refused with
  `DIFF_TOO_LARGE`. The file-summary mode is the only alternative, and the user
  chooses it. A message written from half a diff would read as complete.
- **No commit is made by the feature.** The draft fills the fields. The user
  commits.
- **The generated text is a draft.** It is trimmed and fence-stripped and never
  empty. An empty reply is an error, so the user's text is never replaced with
  nothing.
- **The diff is data.** The system prompt tells the model to ignore instructions
  found in the diff or the file list.

## Why these choices

- **Raw HTTP with reqwest, not an SDK.** The project has no official Rust SDK.
  reqwest is already a dependency for GitHub, so the new code adds no client
  stack. The HTTP call sits behind `MessageGenerator` (`ai/generator.rs`), so a
  second provider is a second impl, and tests never touch the network.
- **Opus with low effort by default.** A commit message is short, and low effort
  keeps the always-on thinking short too. Changing the model is a user decision,
  so the model is a constant with nothing in the UI to change it.
- **`fallbacks`, the beta header and the body fields** follow the request shape
  set in the feature brief for this model. Their server-side behavior is
  Anthropic's and is not checked by the tests.
- **Sampling parameters and `thinking` are not sent.** The request shape for
  this model leaves them out. `request_never_sends_sampling_params_or_thinking`
  keeps them out.
- **Ten recent subjects.** They show the repo's style (scope prefixes, tense).
  They are labeled "for style only" so the model does not copy an old subject.
- **The system prompt is a const.** A change to the rules shows in review as a
  diff of the rules.
- **The error is `AppError::Ai`.** The text is shown as is. `Other` would
  prefix "other:" on every toast.

## Out of scope

- Other providers (OpenAI, local models). The trait allows one; none is wired.
- Streaming. A commit message is short, and a spinner covers the wait.
- PR descriptions, review comments, or any text other than the commit message.
- Choosing the model in the UI.
- Sending anything other than the staged changes (no file contents outside the
  diff, no history beyond ten subjects).
- Storing generated messages or usage history.

## Rejected alternatives

- **Calling the API from the frontend with the TypeScript SDK.** The key would
  have to live in the webview, where any script on the page could read it.
  Rejected for the Rust-only call.
- **Truncating large diffs and sending the rest.** A message written from half
  the change describes a change that was not made. Rejected for the
  refuse-and-offer rule.
- **A cheaper model by default.** The project default is `claude-opus-5-5` with
  low effort. Choosing a cheaper model is a user decision and is not made here.
- **A `Other` error variant.** It would prefix every message. A dedicated `Ai`
  variant carries the user-facing text unchanged.

## Tests

- `src-tauri/src/ai/response.rs`: JSON fixtures for text joining, refusal
  (explanation, category, none), max tokens, 401, 429/529, other statuses, bad
  JSON, missing content list, empty text.
- `src-tauri/src/ai/anthropic.rs`: request body has the project model and
  effort, the system and user text, and no sampling params or thinking.
- `src-tauri/src/ai/draft.rs`: `FakeGenerator` checks the system prompt and the
  user message, passes errors through, rejects empty replies, strips fences.
- `src-tauri/src/ai/prompt.rs`: prompt rules, subject section, diff-or-stat
  mode.
- `src-tauri/src/ai/limits.rs`: exact limit accepted, one byte over refused
  with its size.
- `src-tauri/src/ai/key.rs`: status, trim and validation, no key echoed on
  failure, load and clear, store unavailable.
- `src-tauri/src/github/secret_store.rs`: the GitHub account and message
  unchanged, and a second account named in its errors.
- `src/lib/commitMsg/aiErrors.test.ts`: the size marker parsed, other errors
  ignored.
- No test calls the network.
