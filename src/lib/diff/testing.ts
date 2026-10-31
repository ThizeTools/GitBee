// Builders for DiffLine/Hunk fixtures in tests. Not imported by app code.
import type { DiffLine, Hunk } from "$lib/ipc";

export function ctx(content: string, oldNo: number, newNo: number): DiffLine {
  return { kind: "context", content, old_no: oldNo, new_no: newNo };
}

export function del(content: string, oldNo: number): DiffLine {
  return { kind: "del", content, old_no: oldNo, new_no: null };
}

export function add(content: string, newNo: number): DiffLine {
  return { kind: "add", content, old_no: null, new_no: newNo };
}

export function noNewline(): DiffLine {
  return { kind: "nonewline", content: " No newline at end of file", old_no: null, new_no: null };
}

export function hunkOf(lines: DiffLine[]): Hunk {
  return { header: "@@ -1 +1 @@", old_start: 1, old_lines: 1, new_start: 1, new_lines: 1, lines };
}
