<h1 align="center">
  <img src="static/bee-logo.png" alt="GitBee" width="120" />
  <br />
  GitBee
</h1>

<p align="center">
  <b>A fast, lightweight Git client.</b><br />
  Tauri + Svelte + Rust. Native, offline-first, no Electron.
</p>

<p align="center">
  <a href="#download"><img alt="Windows" src="https://img.shields.io/badge/Windows-x64-0078D6?logo=windows&logoColor=white" /></a>
  <a href="#macos"><img alt="macOS" src="https://img.shields.io/badge/macOS-build_from_source-000000?logo=apple&logoColor=white" /></a>
  <a href="#performance"><img alt="RAM" src="https://img.shields.io/badge/RAM-~50_MB_idle-success" /></a>
  <a href="#performance"><img alt="Cold start" src="https://img.shields.io/badge/cold_start-%3C300_ms-success" /></a>
  <a href="#license"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue" /></a>
</p>

---

## Why GitBee?

Most desktop Git clients are Electron apps that ship an entire Chromium runtime
per window — 200–500 MB of RAM, multi-second cold starts, sluggish on older
laptops. GitBee runs the Rust backend natively and uses the OS's existing
WebView, so it behaves like a real native tool: opens instantly, sips memory,
never hangs the UI on a long `git` call.

It's modeled after the GitKraken UX (commit graph, refs as pills, drag-to-resize
panels) but built on a stack that doesn't punish you for opening the window.

## Performance

Measured on a mid-range laptop with a 5k-commit repository loaded.

| Metric                    | GitBee          | Typical Electron Git client |
| ------------------------- | --------------: | --------------------------: |
| **Cold start (to UI)**    | **~280 ms**     | 2.5 – 5 s                   |
| **RAM, idle on a repo**   | **~55 MB**      | 280 – 480 MB                |
| **RAM, 5k-commit graph**  | **~95 MB**      | 450 – 800 MB                |
| **Installer size (NSIS)** | **~9 MB**       | 80 – 150 MB                 |
| **Portable .exe**         | **~10 MB**      | n/a                         |
| **Repo open → graph**     | **<150 ms**     | 0.8 – 2 s                   |

Why so light:

- **No bundled browser.** Tauri uses the system WebView2 (Windows) / WKWebView
  (macOS) / WebKitGTK (Linux). The app doesn't ship Chromium.
- **Rust does the work.** Git plumbing, file watching, and diff parsing run in
  native Rust threads. The UI thread never blocks on git.
- **Single instance.** Reopening the app from the tray doesn't spawn a second
  process — it focuses the existing one.
- **Lazy tab loading.** On startup only the active tab actually loads its repo;
  background tabs stay cold until you click them, the same way Chrome handles
  background tabs after restart.
- **Aggressive release profile.** `opt-level = "z"`, `lto = true`,
  `panic = "abort"`, `codegen-units = 1`, and `strip = true` produce a ~10 MB
  stripped binary instead of the 30+ MB you'd get with the Cargo defaults.

## Features

### Graph
- GitKraken-style commit graph rendered to canvas — readable at thousands of rows.
- Lane-colored ref badges (branches, tags, HEAD, stashes) with a stub line linking
  badge to dot. The active branch (`HEAD`) gets a thicker, brighter stub.
- Click a dot to select; click again to deselect. Right-click for a contextual
  menu (cherry-pick, revert, reset, branch, tag, checkout).
- Smooth bezier transitions between lanes — no jagged elbows.
- Merge commits drawn as donuts so you can spot them at a glance.

### Workflow
- Tabs per repo, drag to reorder, `Ctrl+T` for new, `Ctrl+W` to close,
  `Ctrl+Shift+T` to reopen the last closed.
- Resizable, persistent layout — sidebar, right panel, graph columns, terminal,
  commit area. Everything you drag is saved.
- Working-directory staging with `Stage / Unstage / Discard` per file.
- Right panel shows commit details with file tree + path views; click a file to
  open the diff and the file-at-that-commit side by side.
- Stash, pop, edit-message, hide.
- Undo/redo for the last commit.
- Built-in command palette (`Ctrl+P`).
- Integrated lightweight terminal — line-mode, no PTY, suitable for basic
  commands and most git work.

### Themes
- **8 built-in themes:** Hive (default — black + bee-yellow), GitHub Dark,
  GitHub Light, Dracula, Nord, Monokai, Solarized Light, GitKraken.
- **Custom theme editor** with live preview — pick colors with the OS color
  picker, see them apply across the app instantly.
- **Import / export** themes as JSON files. Native save dialog so you choose
  the folder.

### Keyboard
On macOS, `Cmd` works wherever `Ctrl` is listed.

| Shortcut              | Action                                |
| --------------------- | ------------------------------------- |
| `Ctrl+B`              | Toggle left sidebar                   |
| `Ctrl+Alt+B`          | Toggle right panel                    |
| `Ctrl+P`              | Command palette                       |
| `Ctrl+L`              | Logs panel                            |
| `` Ctrl+` ``          | External terminal at repo             |
| `Ctrl+T`              | New tab page                          |
| `Ctrl+W`              | Close current tab                     |
| `Ctrl+Shift+T`        | Reopen last closed tab                |
| `Ctrl+Tab`            | Next tab (`Shift` to reverse)         |
| `Ctrl +/-` / `Ctrl 0` | Zoom UI                               |
| `Esc`                 | Close diff / collapse selection       |

## Download

Grab the latest signed build from the
[**Releases**](https://github.com/ThizeTools/GitBee/releases/latest) page —
three flavors per release:

- **`GitBee_<ver>_x64-setup.exe`** — NSIS installer, the friendly default.
- **`GitBee_<ver>_x64_en-US.msi`** — MSI installer, for managed environments.
- **`GitBee_<ver>_x64-portable.exe`** — single executable, no install, leaves
  no system traces. Drop it on a USB stick if you want.

> **Requirements:** Windows 10/11 with WebView2 (preinstalled on Win11) and
> `git` available on `PATH`.

### macOS

There is no prebuilt macOS download. Build it yourself (see below):

```bash
bun run build:mac
```

This writes `GitBee.app` to `src-tauri/target/release/bundle/macos/` and a
`.dmg` to `src-tauri/target/release/bundle/dmg/`. Drag the app into
`/Applications`.

The build is **unsigned** (ad-hoc signed only, no Apple Developer ID, no
notarization). It runs on the Mac that built it. Copied to another Mac,
Gatekeeper blocks it as "damaged"; strip the quarantine flag there with
`xattr -cr /Applications/GitBee.app` if you trust the build.

macOS notes:

- Auto-update is off on macOS. Rebuild to update.
- Closing the window hides GitBee to the menu bar. Click the Dock icon or the
  menu-bar bee to bring it back; quit with `Cmd+Q` or the menu-bar "Quit".
- `git` comes from Xcode Command Line Tools (`/usr/bin/git`) or Homebrew
  (`/opt/homebrew/bin/git`). Both are found even when the app is launched
  from Finder with a minimal `PATH`.

## Build from source

```bash
# install dependencies
bun install

# dev (hot reload)
bun run tauri dev

# Windows: build all 3 distributables → release/
bun run release

# macOS: unsigned .app + .dmg → src-tauri/target/release/bundle/
bun run build:mac
```

The release script wraps `tauri build --bundles msi,nsis` and copies the three
artifacts into `release/` with consistent names. See
[`scripts/release.mjs`](scripts/release.mjs). It is Windows-only; macOS
settings live in
[`src-tauri/tauri.macos.conf.json`](src-tauri/tauri.macos.conf.json), which
Tauri merges automatically on macOS.

### Toolchain

- **Node**: not used at runtime — [Bun](https://bun.sh) is the package manager
  and script runner.
- **Rust**: stable toolchain via `rustup`.
- **MSVC**: Visual Studio Build Tools with "Desktop development with C++"
  (Windows only).
- **Xcode Command Line Tools** (`xcode-select --install`) — macOS only.
  If `rustup` comes from Homebrew it is keg-only: add
  `/opt/homebrew/opt/rustup/bin` to your `PATH` so `cargo` is found.

The Tauri CLI auto-downloads NSIS and the WiX toolset on the first build.

## Project structure

```
src/                       # Svelte frontend (UI + stores + IPC bindings)
  routes/                  # SvelteKit pages
  lib/
    components/            # All Svelte UI components
    graph/                 # Canvas graph renderer + layout math
    stores/                # Reactive state (tabs, repo, layout, themes)
    ipc/                   # Typed wrappers around Tauri invoke()
src-tauri/                 # Rust backend
  src/
    commands/              # Each #[tauri::command] grouped by domain
    git/runner.rs          # The single git.exe wrapper everyone calls
    cache/store.rs         # SQLite cache (recents, etc.)
    watcher.rs             # File watcher → repo-changed event
docs/specs/                # One spec per feature (spec-driven, see CLAUDE.md)
scripts/release.mjs        # Build + collect artifacts
```

## Spec-driven

Every feature in this project starts with a short spec in
[`docs/specs/`](docs/specs/) describing intent, public contract, invariants,
and rejected alternatives. PRs change code and spec together. See
[`CLAUDE.md`](CLAUDE.md) for the full convention.

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgements

The graph design is inspired by [GitKraken Desktop](https://www.gitkraken.com/);
the implementation is original and shares no code with it. The bee mascot is
project art and is not affiliated with GitKraken Inc. or Axosoft.
