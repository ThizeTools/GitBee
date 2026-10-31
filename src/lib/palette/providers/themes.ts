// "Theme: <name>" rows, one per built-in and custom theme. Running a row applies
// the theme the same way the theme picker does.

import { activeThemeId, type Theme } from "$lib/stores/ui";
import type { PaletteItem } from "$lib/palette/types";

export function themeItems(themes: readonly Theme[], activeId: string): PaletteItem[] {
  return themes.map((t) => ({
    id: `theme:${t.id}`,
    title: `Theme: ${t.name}`,
    subtitle: t.id === activeId ? "active" : undefined,
    category: "Theme" as const,
    run: () => activeThemeId.set(t.id),
  }));
}
