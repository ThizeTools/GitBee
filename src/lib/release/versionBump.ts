// Version bump rules for `bun run bump`. Pure string-in/string-out so bun test
// covers them; scripts/bump-version.ts does the file I/O.
// WHY three files: package.json is the human-facing version, but the updater
// compares latest.json against Cargo's [package].version (compiled into the
// app), and Cargo.lock must agree or the next build rewrites it in CI.
// See docs/specs/release-and-updates.md.

const SEMVER = /^\d+\.\d+\.\d+$/;

/** The version after `bump` ("patch" | "minor" | "major" | "x.y.z").
 * Example: `nextVersion("0.4.0", "patch") === "0.4.1"` */
export function nextVersion(current: string, bump: string): string {
  if (SEMVER.test(bump)) return bump;
  if (!SEMVER.test(current)) throw new Error(`current version "${current}" is not x.y.z`);
  const [maj, min, pat] = current.split(".").map(Number);
  if (bump === "major") return `${maj + 1}.0.0`;
  if (bump === "minor") return `${maj}.${min + 1}.0`;
  if (bump === "patch") return `${maj}.${min}.${pat + 1}`;
  throw new Error(`bump "${bump}" is not patch, minor, major or x.y.z`);
}

/** Cargo.toml with its first `version = "…"` line (the [package] one) set.
 * Example: `setCargoTomlVersion(toml, "0.4.1")` */
export function setCargoTomlVersion(toml: string, version: string): string {
  const line = /^version\s*=\s*"[^"]+"/m;
  if (!line.test(toml)) throw new Error('Cargo.toml has no `version = "x.y.z"` line');
  return toml.replace(line, `version = "${version}"`);
}

/** Cargo.lock with the `name = "<pkg>"` entry's version set.
 * Example: `setCargoLockVersion(lock, "gitbee", "0.4.1")` */
export function setCargoLockVersion(lock: string, pkg: string, version: string): string {
  const entry = new RegExp(`(name = "${pkg}"\\r?\\nversion = )"[^"]+"`);
  if (!entry.test(lock)) throw new Error(`Cargo.lock has no entry for package "${pkg}"`);
  return lock.replace(entry, `$1"${version}"`);
}
