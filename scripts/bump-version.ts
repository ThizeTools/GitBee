#!/usr/bin/env bun
// Sets the app version in package.json, src-tauri/Cargo.toml and Cargo.lock.
// Publishing happens in CI on tag push (.github/workflows/release.yml).
//
// Usage:
//   bun run bump            # 0.4.0 -> 0.4.1
//   bun run bump minor      # 0.4.0 -> 0.5.0
//   bun run bump 1.0.0      # explicit
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { nextVersion, setCargoLockVersion, setCargoTomlVersion } from "../src/lib/release/versionBump";

const ROOT = resolve(import.meta.dirname, "..");
const PKG = join(ROOT, "package.json");
const CARGO_TOML = join(ROOT, "src-tauri", "Cargo.toml");
const CARGO_LOCK = join(ROOT, "src-tauri", "Cargo.lock");

async function rewrite(path: string, edit: (text: string) => string): Promise<void> {
  await writeFile(path, edit(await readFile(path, "utf8")));
}

async function main(): Promise<void> {
  const pkg = JSON.parse(await readFile(PKG, "utf8")) as { version: string };
  const version = nextVersion(pkg.version, process.argv[2] ?? "patch");
  await rewrite(PKG, (t) => t.replace(`"version": "${pkg.version}"`, `"version": "${version}"`));
  await rewrite(CARGO_TOML, (t) => setCargoTomlVersion(t, version));
  await rewrite(CARGO_LOCK, (t) => setCargoLockVersion(t, "gitbee", version));
  console.log(`version ${pkg.version} -> ${version}`);
  console.log(`next: git commit -am "Release v${version}" && git tag v${version} && git push origin main v${version}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
