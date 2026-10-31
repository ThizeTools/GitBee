// Reads the AI error messages the backend sends. The size refusal carries the
// diff size, so the UI can show it in the offer to use the file summary.
// Spec: docs/specs/ai-commit-message.md "Errors". Keep the marker in step with
// `ai::limits::DIFF_TOO_LARGE_PREFIX` in src-tauri.

const DIFF_TOO_LARGE = /DIFF_TOO_LARGE:(\d+)/;

/**
 * The staged diff size in bytes when `message` is the too-large refusal, else
 * null.
 *
 * @example parseDiffTooLarge("other: DIFF_TOO_LARGE:250000") // 250000
 */
export function parseDiffTooLarge(message: string): number | null {
  const match = DIFF_TOO_LARGE.exec(message);
  return match ? Number(match[1]) : null;
}

/**
 * A size in KiB for the dialog text, rounded to the nearest whole KiB.
 *
 * @example formatKiB(250000) // "244 KB"
 */
export function formatKiB(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}
