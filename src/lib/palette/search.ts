// One search over the palette: collect the mode's rows, then rank them by the
// typed text, or show recent rows first when nothing is typed. The result is
// capped at PALETTE_ROW_LIMIT so the DOM never holds more rows than that.

import { rankItems, type RankedMatch } from "$lib/palette/fuzzy";
import type { PaletteInput } from "$lib/palette/query";
import { collectItems } from "$lib/palette/collect";
import { recentFirst } from "$lib/palette/recent";
import type { PaletteSources } from "$lib/palette/sources";
import type { PaletteItem } from "$lib/palette/types";

export const PALETTE_ROW_LIMIT = 50;

export function searchPalette(
  input: PaletteInput,
  src: PaletteSources,
  recent: readonly string[],
): RankedMatch<PaletteItem>[] {
  const text = input.text.trim();
  const items = collectItems({ mode: input.mode, text }, src);
  if (text === "") {
    const ordered = recentFirst(items, recent).slice(0, PALETTE_ROW_LIMIT);
    return ordered.map((item) => ({ item, score: 0, positions: [] }));
  }
  return rankItems(text, items, PALETTE_ROW_LIMIT);
}
