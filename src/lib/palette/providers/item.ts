// Row builder shared by the action providers. Every action id starts with
// "action:" so recently used actions can be found again after a restart.

import type { PaletteItem } from "$lib/palette/types";

export function paletteAction(
  key: string,
  title: string,
  run: () => void | Promise<unknown>,
  subtitle?: string,
): PaletteItem {
  return { id: `action:${key}`, title, subtitle, category: "Action", run };
}
