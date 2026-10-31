// Which rows a mode offers. The unprefixed finder merges every provider, with
// actions first so they win ties. A prefixed mode offers one provider only.

import type { PaletteInput } from "$lib/palette/query";
import { isShaQuery } from "$lib/palette/query";
import type { PaletteSources } from "$lib/palette/sources";
import type { PaletteItem } from "$lib/palette/types";
import { actionItems } from "$lib/palette/providers/actions";
import { branchItems } from "$lib/palette/providers/branches";
import { commitItems } from "$lib/palette/providers/commits";
import { fileItems } from "$lib/palette/providers/files";
import { repoItems } from "$lib/palette/providers/repos";
import { themeItems } from "$lib/palette/providers/themes";

function allItems(text: string, src: PaletteSources): PaletteItem[] {
  // Commits join the unprefixed finder only for a sha-looking text (see isShaQuery).
  const commits = isShaQuery(text) ? commitItems(text, src.commits) : [];
  return [
    ...actionItems(src),
    ...repoItems(src.recentRepos),
    ...branchItems(src.branches),
    ...fileItems(src.files),
    ...themeItems(src.themes, src.activeThemeId),
    ...commits,
  ];
}

/** Every row the given mode can offer for its text, before ranking. */
export function collectItems(input: PaletteInput, src: PaletteSources): PaletteItem[] {
  switch (input.mode) {
    case "actions": return actionItems(src);
    case "branches": return branchItems(src.branches);
    case "commits": return commitItems(input.text, src.commits);
    case "files": return fileItems(src.files);
    case "themes": return themeItems(src.themes, src.activeThemeId);
    case "all": return allItems(input.text, src);
  }
}
