// Checks a pattern typed into the "LFS: Track pattern" prompt before it is sent.
// It mirrors validate_pattern in src-tauri/src/git/lfs.rs, which stays the
// authority. Spec: docs/specs/git-lfs.md.

/** The inline error for a typed pattern, or null when the pattern can be tracked. */
export function patternError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return "Enter a pattern, such as *.psd";
  if (trimmed.startsWith("-")) return "A pattern must not start with '-'";
  if (/[\r\n]/.test(trimmed)) return "A pattern must be one line";
  return null;
}
