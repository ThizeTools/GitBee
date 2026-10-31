# Git profiles: named identities per repo (2026-10)

Neighbors: [commit-box.md](commit-box.md) (the box shows the identity it commits
as, and reads the same `user.*` keys), [command-palette.md](command-palette.md)
(not wired here yet), [repo-refresh.md](repo-refresh.md) (what a repo switch
reloads).

## Purpose

A user with a work and a personal email keeps both in GitBee. A profile is a
named git identity: a label, a name, an email, and optionally a signing key.
Applying a profile writes that identity into the current repo's `.git/config`,
so commits from that repo are authored as the profile says. The status bar
shows which identity a repo commits as, and the commit box says so above the
commit button.

Git already does this with `user.name` and `user.email`. GitBee adds the
named list, the one-click switch, and the visible answer to "who am I
committing as here".

## Storage

- Profiles live in the app's SQLite `settings` table under the key
  `profiles.v1`, as a JSON array. Missing key means an empty list.
- Shape of one stored profile:

  ```json
  { "id": "…", "name": "Work", "userName": "Jane Doe", "userEmail": "jane@work.example",
    "signingKey": "ABCD1234", "gpgFormat": "openpgp", "isDefault": true }
  ```

  `signingKey`, `gpgFormat` and `isDefault` are optional. Absent means unset.
- `isDefault` is one field beyond the shape the feature was first described
  with. It marks the profile the picker pre-selects for new repos. At most one
  profile is the default.

**Why the settings table:** the backend already keeps app data there (the
recent repos' clone destination, the git executable path). One JSON value is
small and changes as a whole, so a single key with whole-list writes is enough.

## Contract

### Commands (`src-tauri/src/commands/profiles.rs`)

| Command | Input | Output | Errors |
|---|---|---|---|
| `profiles_list` | none | `Profile[]` | stored JSON does not parse |
| `profiles_save` | `list: Profile[]` | none | a rule below fails; the message names the rule and the value |
| `profile_apply` | `path`, `profile` | none | profile fails validation; a `git config` write fails |
| `repo_identity` | `path` | `{ name, email, source }` | git fails for a reason other than "not set" |

`source` is `"local"`, `"global"` or `"none"`. `name` and `email` are `""` when
unset.

### Validation

Applied to every profile by `profiles_save` and `profile_apply`. Fields are
trimmed first; an empty optional field becomes absent.

- `id` is non-empty and unique in the list.
- `name` (the label) is non-empty and unique in the list, ignoring case.
- `userName` is non-empty.
- `userEmail` has an `@` with text on both sides.
- No field contains a line break (git config values are one line).
- `gpgFormat`, when present, is `openpgp`, `ssh` or `x509`.
- `signingKey`, when present, is non-empty after trimming.
- At most one profile has `isDefault` true.

The frontend runs the same rules on the form so the errors show next to the
fields. The backend check is the one that counts; the form copy exists so the
user does not need a round trip to learn a field is wrong.

### Applying a profile

`profile_apply(path, profile)` runs these `git config --local` writes, in this
order:

| Key | Value |
|---|---|
| `user.name` | `userName` |
| `user.email` | `userEmail` |
| `user.signingkey` | `signingKey`, or unset when absent |
| `gpg.format` | `gpgFormat`, or unset when absent |

Unsetting an absent key ignores git's "key not found" exit status (5). A
failed write stops the sequence and the error names the key that failed. Keys
already written stay written; the next apply sets them again.

### Reading the identity

`repo_identity(path)` runs `git config --show-origin --get` for `user.name` and
`user.email`. Exit status 1 means "not set" and is not an error.

The origin git prints (`file:<path>`) decides the source of each value:

- A path ending in `.git/config` or `config.worktree` is **local** (the repo's
  own config, including linked worktrees).
- Any other file, or a non-file origin, is **global**.

`source` for the whole identity:

- `none` when either name or email is unset.
- `local` when either value comes from a local origin.
- `global` otherwise.

Known limit: a repo whose git directory is outside the work tree
(`--separate-git-dir`) stores its local config at a path that does not end in
`.git/config`. Its local identity reads as global. The apply still writes to
the right file.

## UI

### Status bar pill (`StatusBar.svelte`)

- Shown when a repo is open. Text is `Name <email>`, or `No git identity`.
- A dot before the text takes its color from `source`: local is the accent,
  global is muted, none is the warning color.
- Click opens the context menu: one item per profile (`Apply Work: Jane Doe
  <jane@work.example>`, with `(default)` on the default), a separator, then
  `Manage profiles…`. With no profiles, a disabled `No profiles yet` item
  stands in for the list.
- Applying a profile writes the repo config, then re-reads the identity. A
  failure shows the error toast. The identity is re-read anyway, because keys
  written before the failure stay written.

### Commit box hint (`CommitBox.svelte`)

- One muted line above the commit button: `Committing as Name <email>`, for
  every source. The pill already says where the identity comes from.
- With no identity: a warning line, `No git identity set for this repo`.
- The hint reads the identity the status bar loaded. It does not load its own.

### Profiles manager (`components/profiles/ProfilesDialog.svelte`)

- Opened from the pill menu. A modal in the style of the shortcuts panel: a
  list of profiles, and an add or edit form.
- The list shows the label, `Name <email>`, the signing key when set, and a
  `default` badge.
- **Apply to this repo** picker: a select with the profiles, pre-selected to
  the default (the first profile when none is the default), with an Apply
  button. Shown only when a repo is open. The user's last pick holds until
  that profile is deleted.
- Form fields: label, name, email, signing key (optional), GPG format
  (optional: none, OpenPGP, SSH, X.509), and a "Use as default for new repos"
  checkbox. Saving sets `isDefault` on this profile and clears it on the
  others.
- Delete asks first through the app dialog. Deleting the default leaves no
  default.
- Saving or deleting rewrites the whole list through `profiles_save`.

### Refresh

The identity is read when a repo becomes the active tab and after an apply.
Changing the identity in a terminal shows in the pill after the next repo
switch. Watching `.git/config` for that is out of scope.

## Invariants

- Applying a profile writes only `.git/config` of the repo, through
  `git config --local`. Global and system config are never written.
- The four keys written are fixed in code (`PROFILE_CONFIG_KEYS`). The apply
  plan refuses any other key, and a test pins the list.
- Profiles are stored only in the settings table. The git config is written
  only by `profile_apply`, and the list is never copied into a repo.
- Identity is never remembered per repo in the app. The source of truth for
  "who this repo commits as" is git's config, read each time.
- An identity response for repo A that arrives after the user switched to repo
  B is dropped.
- Validation runs in the backend on save and apply. A profile that fails it is
  never written.

## Out of scope

- Per-profile SSH keys, credential helpers, or switching the HTTPS credentials
  used to push. Switching the signing key is in scope; switching who the
  remote believes you are is not.
- GitHub account switching. The GitHub login is separate from git identity.
- Includes-based global configuration (`includeIf`). See the rejected
  alternatives.
- Importing identities from the global config or from other tools.
- Applying a profile to several repos at once.
- Showing a per-commit identity other than the current one.

## Rejected alternatives

- **`includeIf`-based global config editing.** It is powerful: git picks the
  identity by directory. But it edits the user's global `.gitconfig`, which
  GitBee does not own, and an include mistake changes every repo on the
  machine. Undoing it means finding and removing lines in a file the user
  edits by hand. A repo-local write is one file and one key set, and the
  previous values are simply replaced.
- **Storing identities in `localStorage`.** Each webview profile has its own
  storage, so the list would vanish on a reinstall or a second window profile.
  App data already lives in the backend settings table, which survives both.
- **Storing the default in its own settings key.** One more command pair for
  one id. A flag on the profile keeps the list one value, and saving it stays
  one write.
- **Reading `.git/config` directly instead of `git config`.** It would miss
  includes, the global file and the system file, and would parse git's
  quoting rules again. `git config` already answers each of those.

## Tests

- `src-tauri/src/commands/profiles/rules.rs`: normalization of empty optional
  fields; a good list passes; each required field, the email shape, a line
  break, duplicate ids and labels (ignoring case), two defaults, and an unknown
  `gpgFormat` are refused with the value in the message.
- `src-tauri/src/commands/profiles/apply_plan.rs`: the plan writes the four keys
  in order, unsets absent keys, every write is `--local` and never global or
  system, and keys outside the allow-list are refused.
- `src-tauri/src/commands/profiles/identity.rs`: `--show-origin` parsing (a
  value, a missing tab), the local rule for repo and worktree config against
  global and system files, and the source rule for none, local and global.
- `src-tauri/src/commands/profiles.rs`: a missing stored value is an empty list,
  a corrupt one is an error, the stored JSON round trips in camel case. Two git
  round trips in a scratch repo: apply then read back as local, and switching
  to a profile without a signing key unsets the old one.
- `src/lib/profiles/validate.test.ts`: the form's rules, with the messages shown
  next to each field.
- `src/lib/profiles/draft.test.ts`: draft to profile trims and drops empty
  optionals; profile to draft round trip.
- `src/lib/profiles/profile.test.ts`: identity text, pill text, dot tone, the
  commit hint for each source, default lookup, upsert with one default, ids.
- `src/lib/profiles/menu.test.ts`: pill menu items for profiles, the default
  badge, the empty state, and the manage item.
- `src/lib/profiles/applyToRepo.test.ts`: a successful apply announces the
  profile; a failed one shows the backend message as an error.
- `src/lib/profiles/stores.test.ts`: with a `FakeProfilesApi`: a slow identity
  read for a repo the user left does not replace the newer one; a failed read
  stores no identity; apply re-reads the identity, also after a failed write;
  save sends the list and holds what the backend returns.
