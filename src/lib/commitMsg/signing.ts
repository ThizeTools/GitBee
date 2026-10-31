// The Sign toggle's state. The repo's `commit.gpgsign` is the default; a user
// toggle is kept per repo path in localStorage and wins over the default.
// Spec: docs/specs/commit-box.md "Signing".

const STORAGE_PREFIX = "gitbee.commitSign:";

/**
 * Reads a git boolean the way git does: true, yes, on and 1 are true (any
 * case), false, no, off, 0 and the empty string are false. Unset gives null.
 *
 * @example gitBool("yes") // true
 */
export function gitBool(value: string | null): boolean | null {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(v)) return true;
  if (["false", "no", "off", "0", ""].includes(v)) return false;
  return null;
}

/**
 * The toggle to show: the user's choice for this repo if there is one, else
 * the repo's configured default.
 *
 * @example resolveSign(true, null) // true
 */
export function resolveSign(repoDefault: boolean, userChoice: boolean | null): boolean {
  return userChoice ?? repoDefault;
}

/** localStorage key for one repo's Sign choice. */
export function signStorageKey(repoPath: string): string {
  return `${STORAGE_PREFIX}${repoPath}`;
}

/**
 * The saved choice for this repo, or null. Storage can be blocked or missing
 * (private windows, cleared site data); then there is no choice to read.
 */
export function readSignChoice(repoPath: string): boolean | null {
  try {
    const raw = globalThis.localStorage?.getItem(signStorageKey(repoPath)) ?? null;
    return raw === null ? null : raw === "true";
  } catch {
    return null;
  }
}

/** Saves the user's choice for this repo. A failed write only loses the choice. */
export function writeSignChoice(repoPath: string, value: boolean): void {
  try {
    globalThis.localStorage?.setItem(signStorageKey(repoPath), value ? "true" : "false");
  } catch {
    // Storage unavailable: the toggle still works for this session.
  }
}
