// "Open <repo>" rows for the Recents list. The subtitle keeps the full path, so
// two repos with the same folder name stay distinguishable.

import { openRepo } from "$lib/stores/repo";
import type { PaletteItem } from "$lib/palette/types";

/** Last non-empty segment of a path, for both "/" and "\" separators. */
export function repoBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

export function repoItems(paths: readonly string[]): PaletteItem[] {
  return paths.map((path) => ({
    id: `repo:${path}`,
    title: `Open ${repoBasename(path)}`,
    subtitle: path,
    category: "Repo",
    run: () => openRepo(path),
  }));
}
