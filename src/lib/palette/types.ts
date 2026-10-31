// Shared shapes for the command palette (Ctrl+P). Spec: docs/specs/command-palette.md.

export type PaletteCategory = "Action" | "Repo" | "Branch" | "File" | "Theme" | "Commit";

// One row of the finder. `id` is stable across sessions because recently used
// ids are stored in localStorage and matched against the next session's items.
export interface PaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  category: PaletteCategory;
  run: () => void | Promise<unknown>;
}

// "all" is the unprefixed finder; the others are chosen with a leading prefix
// character (see query.ts) and show as a chip in the input.
export type PaletteMode = "all" | "actions" | "branches" | "commits" | "files" | "themes";
