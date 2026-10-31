/**
 * Icon names used by GitBee's UI, mapped to Lucide export names.
 *
 * Spec: docs/specs/ui-layout-2026-11.md ("Icons"). Components refer to icons
 * only by IconName; `Icon.svelte` turns a name into a glyph.
 *
 * Why this file has no runtime import of @lucide/svelte: `bun test` cannot
 * load the package's .svelte entry files, and this module must stay testable.
 * The only import below is `import type`, which is erased at build time, so
 * a misspelled Lucide name still fails `bun run check`.
 */
import type * as Lucide from "@lucide/svelte";

export type LucideExportName = keyof typeof Lucide;

/** Every icon the UI may request. Add a name here, then map it below. */
export const ICON_NAMES = [
  "undo",
  "redo",
  "pull",
  "push",
  "fetch",
  "branch",
  "merge",
  "stash",
  "pop",
  "terminal",
  "search",
  "palette",
  "theme",
  "settings",
  "more",
  "more-vertical",
  "chevron-right",
  "chevron-down",
  "close",
  "add",
  "remove",
  "check",
  "warning",
  "info",
  "trash",
  "eye",
  "eye-off",
  "pin",
  "tag",
  "cloud",
  "laptop",
  "folder",
  "folder-git",
  "file",
  "file-added",
  "file-deleted",
  "file-modified",
  "file-renamed",
  "conflict",
  "history",
  "user",
  "users",
  "lock",
  "sparkles",
  "keyboard",
  "logs",
  "zoom",
  "download",
  "pull-request",
  "commit",
  "submodule",
  "lfs",
  "copy",
  "external",
  "filter",
  "star",
  "home",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/**
 * IconName -> Lucide export name. Where the spec gives no Lucide name, or
 * gives a deprecated one, the current canonical Lucide export is used:
 * trash -> Trash (Trash2 is deprecated), conflict -> FileExclamationPoint
 * (FileWarning is deprecated), history -> RotateCcwClock (History is
 * deprecated), filter -> Funnel (Filter is deprecated), home -> House (Home
 * is deprecated), undo/redo -> Undo2/Redo2 (no name given in the spec).
 */
export const ICON_LUCIDE_NAMES = {
  undo: "Undo2",
  redo: "Redo2",
  pull: "ArrowDownToLine",
  push: "ArrowUpFromLine",
  fetch: "RefreshCw",
  branch: "GitBranch",
  merge: "GitMerge",
  stash: "Archive",
  pop: "ArchiveRestore",
  terminal: "SquareTerminal",
  search: "Search",
  palette: "Command",
  theme: "Palette",
  settings: "Settings",
  more: "Ellipsis",
  "more-vertical": "EllipsisVertical",
  "chevron-right": "ChevronRight",
  "chevron-down": "ChevronDown",
  close: "X",
  add: "Plus",
  remove: "Minus",
  check: "Check",
  warning: "TriangleAlert",
  info: "Info",
  trash: "Trash",
  eye: "Eye",
  "eye-off": "EyeOff",
  pin: "Pin",
  tag: "Tag",
  cloud: "Cloud",
  laptop: "Laptop",
  folder: "Folder",
  "folder-git": "FolderGit",
  file: "File",
  "file-added": "FilePlus",
  "file-deleted": "FileMinus",
  "file-modified": "FilePen",
  "file-renamed": "FileSymlink",
  conflict: "FileExclamationPoint",
  history: "RotateCcwClock",
  user: "User",
  users: "Users",
  lock: "Lock",
  sparkles: "Sparkles",
  keyboard: "Keyboard",
  logs: "ScrollText",
  zoom: "ZoomIn",
  download: "Download",
  "pull-request": "GitPullRequest",
  commit: "GitCommitHorizontal",
  submodule: "Package",
  lfs: "HardDrive",
  copy: "Copy",
  external: "ExternalLink",
  filter: "Funnel",
  star: "Star",
  home: "House",
} as const satisfies Record<IconName, LucideExportName>;

/** Every Lucide export that Icon.svelte must import (exhaustive, see Icon.svelte). */
export type UsedLucideName = (typeof ICON_LUCIDE_NAMES)[IconName];
