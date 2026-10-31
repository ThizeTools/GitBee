// Every action row. Repo-bound actions are left out when no repo is open, so a
// "Pull" row never appears in a state where it cannot run.

import type { PaletteSources } from "$lib/palette/sources";
import type { PaletteItem } from "$lib/palette/types";
import { repoActionItems } from "$lib/palette/providers/actionsRepo";
import { viewActionItems } from "$lib/palette/providers/actionsView";

export function actionItems(src: PaletteSources): PaletteItem[] {
  const repoOnly = src.repoOpen ? repoActionItems() : [];
  return [...repoOnly, ...viewActionItems(src)];
}
