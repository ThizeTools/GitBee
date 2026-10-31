// Human-readable byte counts for the LFS card. Spec: docs/specs/git-lfs.md.

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
// WHY 1024: the sizes match what Windows Explorer reports for the same file.
const STEP = 1024;

/**
 * "512 B", "1.5 KB", "12 MB". One decimal below 10 in a unit, whole numbers
 * above. Throws on a negative or non-finite count, which the pointer parser
 * never produces, so a throw means a caller bug.
 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new Error(`formatSize expects a finite byte count >= 0, got ${bytes}`);
  }
  if (bytes < STEP) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP;
    unit += 1;
  }
  const text = value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value).toString();
  return `${text} ${UNITS[unit]}`;
}
