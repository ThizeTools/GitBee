# Release and auto-update

## Purpose

Ship a version to Windows and macOS users from a tag push, and let installed
apps update themselves from the public GitHub repo. No release step runs on a
developer machine, and no machine needs the signing key.

Neighbors: [macos-support.md](macos-support.md) (macOS build settings), the
update pill in `src/lib/stores/updater.ts`.

## Public contract

### Cutting a release

| Step | Command | Effect |
| ---- | ------- | ------ |
| 1 | `bun run bump [patch\|minor\|major\|x.y.z]` | Sets the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` |
| 2 | `git commit -am "Release vX.Y.Z"` | |
| 3 | `git tag vX.Y.Z && git push origin main vX.Y.Z` | Triggers `.github/workflows/release.yml` |

The workflow:

1. **create-release** fails if the tag disagrees with `package.json` or
   `Cargo.toml` (error names all three values), then creates a **draft**
   release with generated notes.
2. **build** runs Windows (`msi,nsis`), then macOS (`app,dmg` plus
   `tauri.updater.conf.json`), one at a time. `tauri-action` signs the updater
   artifacts and merges each platform into the release's `latest.json`.
3. **publish** un-drafts the release and marks it latest.

Assets: NSIS `-setup.exe` + `.sig`, `.msi` + `.sig`, `.dmg`,
`GitBee.app.tar.gz` + `.sig`, `latest.json` (`windows-x86_64`,
`darwin-aarch64`).

### Secrets (repo Settings → Secrets → Actions)

- `TAURI_SIGNING_PRIVATE_KEY`: full content of the minisign private key.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: optional; the current key has none.

The public half is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.

### Installed app

`bootUpdater()` checks
`https://github.com/ThizeTools/GitBee/releases/latest/download/latest.json`
on launch on every OS, downloads a newer version in the background, verifies
its signature against the embedded public key and shows "Ready to install".
`installNow()` installs and relaunches. Errors are logged and shown as a
discreet pill; they never block the app.

## Invariants

- Tag, `package.json` and `Cargo.toml` versions are equal for every release
  (the updater compares `latest.json` to Cargo's compiled version).
- `releases/latest` never serves a `latest.json` missing a platform: the
  release stays a draft until every build uploaded.
- Local `bun run build:mac` needs no key: updater artifacts on macOS are
  turned on only by `tauri.updater.conf.json`, which only CI passes.
- An update is installed only if its signature matches the embedded key.

## Key rotation (2026-10-31)

v0.4.1 embeds a new public key (`pubkey` in `tauri.conf.json`). The v0.4.0
key was not available on the release machine. Apps on v0.4.0 trust only the
old key, so they cannot auto-update to v0.4.1: those users install v0.4.1
once from the release page. From v0.4.1 on, updates are automatic.
Losing the private key again forces the same one-time manual reinstall, so a
copy is kept outside GitHub (secrets cannot be read back).

## Out of scope

- Developer ID signing and notarization on macOS. Builds are ad-hoc signed
  (`signingIdentity "-"`): the first install from the `.dmg` needs a manual
  Gatekeeper approval, and each update is a new code identity to macOS (the
  Keychain may ask again for the GitHub token).
- Intel macOS (`darwin-x86_64`) and Linux artifacts.
- Release channels (beta/stable).

## Rejected alternatives

- **Updater without signature verification** (own download-and-replace).
  Anyone able to publish a release or tamper with the download would run code
  on every install. The Tauri updater cannot disable verification, by design.
- **Local release script (`scripts/release.mjs`, removed).** Windows-only,
  needed a Windows machine and the key in a local `.env`; the key was lost
  with that machine. CI builds both platforms and keeps the key in secrets.
- **Parallel platform builds.** Each `tauri-action` job reads, merges and
  re-uploads `latest.json`; two at once can drop a platform. Sequential
  builds cost ~10 extra minutes per release.
- **`createUpdaterArtifacts: true` in `tauri.macos.conf.json`.** Every local
  macOS build would then fail without the private key.
- **Only notify about new versions (no auto-install).** Needs no key, but the
  user still downloads and installs by hand every time.
