# macOS support

## Purpose

Make GitBee build and run on macOS (Apple Silicon and Intel) for a developer
who builds it on their own Mac. Distribution to other Macs is explicitly not a
goal yet: the build is unsigned and that is acceptable.

Windows remains the primary, released platform. Neighbors:
[repo-refresh.md](repo-refresh.md) (watcher), and the auto-update flow
described in `src/lib/stores/updater.ts`.

## Public contract

### Build

| Input                | Output                                                     |
| -------------------- | ---------------------------------------------------------- |
| `bun run build:mac`  | `src-tauri/target/release/bundle/macos/GitBee.app`         |
|                      | `src-tauri/target/release/bundle/dmg/GitBee_<ver>_<arch>.dmg` |

- `src-tauri/tauri.macos.conf.json` is merged by the Tauri CLI on macOS only.
  It sets:
  - `bundle.macOS.signingIdentity = "-"` → ad-hoc code signature.
  - `bundle.createUpdaterArtifacts = false` → no minisign key needed.
- Errors: missing Xcode Command Line Tools or `cargo` not on `PATH` fail the
  Tauri CLI before compiling; nothing project-specific is added.

### Runtime

- **Dock reopen.** Closing the window hides it (tray behavior shared with
  Windows). Clicking the Dock icon fires `RunEvent::Reopen`, which
  `tray::handle_run_event` answers by showing, unminimizing and focusing the
  `main` window. On other OSes `handle_run_event` is a no-op.
- **Auto-update off.** `bootUpdater()` returns immediately when
  `isMacOS()` is true; the status-bar pill stays `idle`.
- **Shortcuts.** Every keyboard handler accepts `metaKey` alongside
  `ctrlKey`, so `Cmd` works wherever `Ctrl` is documented.
- **Shell integration.** External terminal → `open -a Terminal <repo>`;
  reveal → `open -R`; edit → `open`; embedded terminal → `$SHELL -i`.
- **git lookup.** `PATH` first, then `/usr/bin/git`, `/usr/local/bin/git`,
  `/opt/homebrew/bin/git` — Finder-launched apps get a minimal `PATH`.

### Platform detection (frontend)

`src/lib/platform.ts` exports `isWindows(nav?)` and `isMacOS(nav?)`, reading
`navigator.platform` with `userAgent` as fallback. The optional argument
exists so tests inject a fake navigator.

## Invariants

- The Windows build is unaffected: no shared config value changes;
  `tauri.macos.conf.json` is never read on Windows.
- `handle_run_event` never exits or restarts the app; it only shows a window.
- `isWindows` must not match "Darwin" (anchored `^win` on `platform`).

## Out of scope

- Developer ID signing, notarization, stapling.
- A macOS update channel (`darwin-*` entries in `latest.json`).
- `scripts/release.mjs` producing macOS artifacts.
- Native macOS menu customization beyond Tauri's default app menu.
- Linux packaging (code paths exist but are untested).

## Rejected alternatives

- **Leave `signingIdentity` unset.** Apple Silicon refuses to launch arm64
  code with no signature at all. Unset, we would depend on the linker's
  implicit ad-hoc signature surviving bundling; `"-"` makes the bundler sign
  the whole `.app` ad-hoc, explicitly, with no Apple account.
- **Pass `--config '{…}'` inline in the `build:mac` script.** Works, but
  `tauri dev` would not see it, and JSON-in-shell quoting differs between
  shells. The platform config file is the documented Tauri mechanism.
- **Keep the updater on and let it fail.** `latest.json` lists only
  `windows-x86_64`, so every launch would end in a permanent
  "Update check failed" warning — noise for a state the user cannot fix.
- **Quit on window close (native macOS for single-window apps).** Diverges
  from Windows behavior and kills the background watcher/auto-fetch the tray
  mode exists for. Reopen-from-Dock gives the macOS feel without that cost.
