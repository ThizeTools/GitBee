// Prefix modes of the palette input. The first typed character picks a mode
// (">" actions, "@" branches, "#" commits, "/" files, ":" themes); the prefix is
// not kept in the text, it lives in the mode chip. Spec: docs/specs/command-palette.md.

import type { PaletteMode } from "$lib/palette/types";

export interface PaletteInput {
  mode: PaletteMode;
  text: string;
}

export const MODE_PREFIX: Readonly<Partial<Record<string, PaletteMode>>> = {
  ">": "actions",
  "@": "branches",
  "#": "commits",
  "/": "files",
  ":": "themes",
};

export const MODE_LABEL: Readonly<Record<PaletteMode, string>> = {
  all: "All",
  actions: "Actions",
  branches: "Branches",
  commits: "Commits",
  files: "Files",
  themes: "Themes",
};

// WHY only from "all": once a mode is chosen, a typed "@" or "/" is part of the
// search text (a branch named "@x", a path starting with "/").
/** Resolves one input change. A prefix character typed into the unprefixed box switches the mode. */
export function applyTypedInput(raw: string, mode: PaletteMode): PaletteInput {
  const typed = mode === "all" ? MODE_PREFIX[raw.charAt(0)] : undefined;
  if (typed !== undefined) return { mode: typed, text: raw.slice(1) };
  return { mode, text: raw };
}

const SHA_PREFIX = /^[0-9a-f]{4,40}$/i;

/**
 * True when the text looks like a commit sha prefix (4 to 40 hex digits).
 * Only then does the unprefixed finder offer commits, so ordinary words never
 * flood the list with "Go to commit" rows.
 */
export function isShaQuery(text: string): boolean {
  return SHA_PREFIX.test(text.trim());
}
