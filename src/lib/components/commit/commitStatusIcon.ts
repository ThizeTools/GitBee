import type { IconName } from "$lib/icons/names";

/**
 * Icon for a commit file's status letter (git's A M D R C T), drawn at the
 * start of a commit file row. Letters without a matching change icon, such as
 * a type change, fall back to the plain file icon.
 *
 * @example commitStatusIcon("A") // "file-added"
 */
export function commitStatusIcon(status: string): IconName {
  switch (status) {
    case "A": return "file-added";
    case "M": return "file-modified";
    case "D": return "file-deleted";
    case "R": case "C": return "file-renamed";
    default: return "file";
  }
}
