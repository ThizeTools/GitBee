# Commit box: signing, template, co-authors (2026-10)

Neighbors: [undo-history.md](undo-history.md) (the commit entry and its redo),
[ai-commit-message.md](ai-commit-message.md) (the Generate button in the same
box), [repo-refresh.md](repo-refresh.md) (what reloads after a commit).

## Purpose

Three things the commit box did not do before, each small on its own:

- **Sign** a commit from the box, with the repo's own signing setup.
- **Pre-fill** the summary and description from the repo's `commit.template`,
  as `git commit` would open its editor with it.
- **Credit co-authors** for pair work by adding `Co-authored-by` trailers,
  without typing the trailer syntax.

The box is the only UI for these. Each one stays inside the commit form.

## Signing

**Contract**

- The default is the repo's `commit.gpgsign`, read with `git config --get` through
  `git_config_get`. Unset means off.
- A **Sign** checkbox sits beside Amend. Its state is the user's saved choice for
  this repo, or the default when there is none.
- The choice is stored in `localStorage` under `gitbee.commitSign:<repo path>`.
  Reads and writes are wrapped in try/catch. Blocked storage means no saved
  choice, and the toggle still works for the session.
- Commit sends the resolved value as the `sign` flag of `commit_create`, which
  runs `git commit -S`.
- A signing failure is git's failure. Its stderr (gpg or ssh saying which key is
  missing or unusable) goes to the error banner through `withBusy`. The message
  and the fields stay as they were, so nothing is lost and nothing is committed.

**Why this shape**

- Defaulting to the repo's config means a repo that signs everything gets a
  signed commit without a click, and a repo that does not sign is not
  changed.
- A per-repo user choice is kept, not a global one, because signing setups
  differ between repos (work key here, none there).
- GitBee does not pick, create or unlock keys. Signing stays git's job, so the
  same key and agent the terminal uses are the ones used here.

**Undo**

- Undo of a commit is still a soft reset to the HEAD the commit sat on. Signing
  does not change that.
- Redo recommits with the same message, amend flag and sign flag as the original
  (`commitUndo`'s `sign` parameter). Without it, redo of a signed commit would
  quietly produce an unsigned one.

## Config reads

`git_config_get(path, key)` returns the value as git prints it (trimmed), or null
when the key is unset (git exits 1 for "not set", which is not an error).

The key must be on this allow-list:

| Key | Used for |
|---|---|
| `commit.gpgsign` | Sign default |
| `commit.template` | Template path |
| `user.name`, `user.email` | Co-author picker excludes the current user |
| `gpg.format` | Allowed; no box UI reads it yet |
| `user.signingkey` | Allowed; no box UI reads it yet |

Other keys are refused with a message that names the key and the allowed list.
Matching ignores case, since git config keys do.

**Why an allow-list:** the command is reachable from the webview. An open read
would expose any setting, including credential helpers and URL rewrites, to a
frontend bug or to content injected into it.

Booleans are read by the frontend (`gitBool`): `true`, `yes`, `on`, `1` are true
and `false`, `no`, `off`, `0` and empty are false, in any case, as git does.

## Commit template

**Contract**

- `commit_template(path)` returns the text of the file named by `commit.template`,
  or null when the key is unset or the file cannot be read.
- `~` and `~/…` expand to the home directory. A relative path is resolved against
  the repo root (`git rev-parse --show-toplevel`), as git documents for this key.
  An absolute path is used as is.
- The text is split by `splitTemplate`: `#` comment lines are dropped (git's
  default comment character), the first non-blank line is the summary, and the
  rest, with outer blank lines removed, is the description.
- The first focus of the summary field in each repo, per app session, fills the
  fields from the template, and only when both fields are empty. A later focus
  does nothing, so a box the user cleared is not refilled.

**Why these rules**

- Best effort: an unreadable template returns null and logs a warning. Git reads
  the same file when it commits, so a broken path still shows up there, but it
  must not block typing.
- The fill happens on focus, not on open, so the template does not appear over
  a box the user is not using.
- Once per session, not on every focus: a user who clears the box expects it to
  stay empty.

## Co-authors

**Contract**

- The **+ Co-authors** button opens a popover (fixed to the viewport, so the
  commit area does not clip it) with a search field.
- Candidates are the distinct authors in the graph nodes already loaded: one per
  email, compared case-insensitively, the most recent commit first. The current
  user is left out when the email or the name matches `user.email` or `user.name`.
- Search matches name or email, ignoring case.
- Choosing a person appends `Co-authored-by: <name> <email>` to the end of the
  description. A blank line separates a body from a new trailer block. A trailer
  added to an existing block goes directly under it. The same email is never
  added twice.
- Choosing a selected person again, or the × on its chip, removes that line.
  Every line for that email goes, so a duplicate cannot survive a removal.
- Chips are read from the description, not stored beside it. A trailer typed or
  pasted by hand shows up as a chip too.
- An AI draft that replaces the description keeps the co-author lines.

**Why the text is the source of truth**

Keeping a separate list of chips would drift from the description, for example
after a manual edit or an amend. Git reads trailers from the message itself, so
the message is the only state that has to be right.

**Why the authors come from the graph**

The graph already holds every loaded commit's author. Reading `git log` for
authors again would cost a git process per open, for the same people. The
trade-off: only authors in the loaded history are offered, which is the list a
user usually means.

## Invariants

- Co-author state lives only in the description text. The chips are derived.
- The template never overwrites text the user typed or the amend pre-fill.
- `git_config_get` returns only allow-listed keys.
- A repo's config reply that arrives after the user switched repos is dropped.
- A signed commit is only ever produced by `commit_create` with `sign` true. The
  box never signs a commit by any other route.
- The commit undo entry keeps its soft-reset undo, and its redo keeps the sign
  flag of the commit it redoes.

## Out of scope

- Choosing, creating, or unlocking a signing key from GitBee. The box does not
  read `gpg.format` or `user.signingkey`; both are allowed keys for later use.
- Writing `user.*`, `commit.gpgsign` or `commit.template` from GitBee.
- Templates with variables or placeholders (git has none).
- Co-authors who are not in the loaded history, and mailmap resolution. A
  GitHub user search would need the network and a token for an everyday
  action.
- Signing tags or other objects.

## Rejected alternatives

- **Storing chips as their own state.** It would drift from the description
  after any manual edit or amend. Rejected for the parsed-text model above.
- **Sign always on, or always off.** Always on fails for every repo without
  keys. Always off ignores the repo's policy. The repo default plus a per-repo
  choice covers both.
- **Reading `commit.template` again on every focus.** It refills a box the user
  cleared on purpose. Rejected for once-per-session.

## Tests

- `src/lib/commitMsg/template.test.ts`: comment stripping, splitting, CRLF,
  first-focus claim.
- `src/lib/commitMsg/trailers.test.ts`: parse, add (blank-line rule, no
  duplicates, case), remove, add-then-remove round trip.
- `src/lib/commitMsg/coAuthors.test.ts`: distinct authors, current-user
  exclusion, recency sort, search.
- `src/lib/commitMsg/signing.test.ts`: git boolean spellings, default vs user
  choice, storage key per repo.
- `src-tauri/src/commands/commits.rs` tests: allow-list accepts every box key,
  refuses others and option-like keys, ignores case; template path resolution
  for relative, `~`, absolute and no-home cases.
