#!/usr/bin/env bun
// One-shot release: bumps version, builds + signs all Windows artifacts,
// generates the auto-updater manifest, and publishes a GitHub release.
//
// Usage:
//   bun run release            # bumps patch (0.1.0 → 0.1.1)
//   bun run release minor      # 0.1.0 → 0.2.0
//   bun run release major      # 0.1.0 → 1.0.0
//   bun run release 1.2.3      # explicit version
//   bun run release --notes "Fixed X, added Y"  # custom release notes
//
// Reads TAURI_SIGNING_PRIVATE_KEY_PATH from .env (auto-loaded by Bun).
// Reads RELEASE_REPO from .env or hardcoded default below.
// Requires `gh` CLI authenticated for the release repo.

import { spawn } from "node:child_process";
import { mkdir, copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const TAURI_TARGET = join(ROOT, "src-tauri", "target", "release");
const BUNDLE_DIR = join(TAURI_TARGET, "bundle");
const OUT_DIR = join(ROOT, "release");
const PKG_PATH = join(ROOT, "package.json");

const UPDATER_PLATFORM = "windows-x86_64";
const RELEASE_REPO = process.env.RELEASE_REPO ?? "thize/gitbee-releases";

async function main() {
  // ---- args -----------------------------------------------------------
  const args = process.argv.slice(2);
  let bump = "patch";
  let notes = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--notes") { notes = args[++i] ?? null; continue; }
    if (a === "patch" || a === "minor" || a === "major" || /^\d+\.\d+\.\d+$/.test(a)) {
      bump = a;
    }
  }

  // ---- bump version --------------------------------------------------
  // package.json is the human-facing source of truth (npm convention),
  // and tauri.conf.json + version.ts read from it. But Tauri's *runtime*
  // version (used by the auto-updater to compare against latest.json)
  // comes from Cargo.toml's `[package].version` at compile time. Without
  // bumping Cargo.toml in lockstep, an installed app keeps reporting
  // the old version forever and the updater shows a perpetual
  // "update available". So we update both files atomically here.
  const pkg = JSON.parse(await readFile(PKG_PATH, "utf8"));
  const oldVersion = pkg.version;
  const newVersion = nextVersion(oldVersion, bump);
  pkg.version = newVersion;
  await writeFile(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");

  const cargoPath = join(ROOT, "src-tauri", "Cargo.toml");
  const cargo = await readFile(cargoPath, "utf8");
  const updated = cargo.replace(
    /^version\s*=\s*"[^"]+"/m,
    `version = "${newVersion}"`,
  );
  if (updated === cargo) throw new Error(`could not find version line in ${cargoPath}`);
  await writeFile(cargoPath, updated);

  console.log(`✓ version: ${oldVersion} → ${newVersion}  (package.json + Cargo.toml)`);

  // ---- guard: signing key set ----------------------------------------
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
    throw new Error(
      "Missing TAURI_SIGNING_PRIVATE_KEY in .env. Value must be the path to gitbee.key (or its full content).",
    );
  }

  // ---- build ---------------------------------------------------------
  await runTauriBuild();
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

  const productName = "GitBee";
  const version = newVersion;

  // portable .exe (raw target/release/<name>.exe)
  const portableSrc = join(TAURI_TARGET, `${productName.toLowerCase()}.exe`);
  const portableSrcAlt = join(TAURI_TARGET, `${productName}.exe`);
  const portable = existsSync(portableSrc) ? portableSrc
    : existsSync(portableSrcAlt) ? portableSrcAlt
    : null;
  if (!portable) throw new Error(`portable exe not found in ${TAURI_TARGET}`);
  const portableOut = join(OUT_DIR, `${productName}_${version}_x64-portable.exe`);
  await copyFile(portable, portableOut);
  console.log(`✓ portable → ${portableOut}`);

  // copy MSI + sigs from this version
  const msiDir = join(BUNDLE_DIR, "msi");
  const msiFiles = [];
  if (existsSync(msiDir)) {
    for (const name of await readdir(msiDir)) {
      if (!name.includes(version)) continue;
      const lower = name.toLowerCase();
      if (lower.endsWith(".msi") || lower.endsWith(".msi.sig")) {
        const dest = join(OUT_DIR, name);
        await copyFile(join(msiDir, name), dest);
        msiFiles.push(dest);
        console.log(`✓ msi      → ${dest}`);
      }
    }
  }

  // copy NSIS + sigs from this version
  const nsisDir = join(BUNDLE_DIR, "nsis");
  const nsisFiles = [];
  let nsisExeName = null, nsisSigContent = null;
  if (existsSync(nsisDir)) {
    const names = await readdir(nsisDir);
    for (const name of names) {
      if (!name.includes(version)) continue;
      const lower = name.toLowerCase();
      if (lower.endsWith(".exe") || lower.endsWith(".exe.sig")) {
        const dest = join(OUT_DIR, name);
        await copyFile(join(nsisDir, name), dest);
        nsisFiles.push(dest);
        console.log(`✓ nsis     → ${dest}`);
      }
    }
    nsisExeName = names.find((n) => n.includes(version) && n.toLowerCase().endsWith("-setup.exe"));
    if (nsisExeName) {
      const sigName = `${nsisExeName}.sig`;
      const sigPath = join(nsisDir, sigName);
      if (existsSync(sigPath)) {
        nsisSigContent = (await readFile(sigPath, "utf8")).trim();
      }
    }
  }
  if (!nsisExeName || !nsisSigContent) {
    throw new Error("Could not find signed NSIS .exe + .sig — signing failed?");
  }

  // ---- generate latest.json ------------------------------------------
  const downloadBase = `https://github.com/${RELEASE_REPO}/releases/download/v${version}`;
  const manifest = {
    version,
    notes: notes ?? `GitBee v${version}`,
    pub_date: new Date().toISOString(),
    platforms: {
      [UPDATER_PLATFORM]: {
        signature: nsisSigContent,
        url: `${downloadBase}/${nsisExeName}`,
      },
    },
  };
  const manifestPath = join(OUT_DIR, "latest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`✓ manifest → ${manifestPath}`);

  // ---- publish via gh ------------------------------------------------
  const releaseAssets = [portableOut, ...msiFiles, ...nsisFiles, manifestPath];
  console.log(`\nPublishing v${version} to ${RELEASE_REPO}…`);
  await runGh([
    "release", "create", `v${version}`,
    "--repo", RELEASE_REPO,
    "--title", `GitBee v${version}`,
    "--notes", manifest.notes,
    ...releaseAssets,
  ]);

  console.log(`\n✅ Released GitBee v${version} → https://github.com/${RELEASE_REPO}/releases/tag/v${version}`);
}

function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const [maj, min, pat] = current.split(".").map(Number);
  if (bump === "major") return `${maj + 1}.0.0`;
  if (bump === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

function runTauriBuild() {
  return new Promise((res, rej) => {
    const cmd = process.platform === "win32" ? "bun.exe" : "bun";
    const proc = spawn(cmd, ["run", "tauri", "build", "--bundles", "msi,nsis"], {
      cwd: ROOT, stdio: "inherit", shell: false,
      // Inherit env explicitly so Bun's auto-loaded .env propagates.
      env: process.env,
    });
    proc.on("exit", (code) => code === 0 ? res() : rej(new Error(`tauri build exited ${code}`)));
    proc.on("error", rej);
  });
}

function runGh(args) {
  return new Promise((res, rej) => {
    const cmd = process.platform === "win32" ? "gh.exe" : "gh";
    const proc = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", shell: false, env: process.env });
    proc.on("exit", (code) => code === 0 ? res() : rej(new Error(`gh exited ${code}`)));
    proc.on("error", rej);
  });
}

main().catch((e) => { console.error("\n❌", e.message ?? e); process.exit(1); });
