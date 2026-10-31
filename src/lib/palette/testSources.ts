// Fixture for palette tests: a fully populated PaletteSources that each test
// overrides field by field. Test-only; nothing in the app imports it.

import { BUILTIN_THEMES } from "$lib/stores/ui";
import type { PaletteSources } from "$lib/palette/sources";

export function makeSources(over: Partial<PaletteSources> = {}): PaletteSources {
  return {
    repoOpen: true,
    branches: [
      { name: "main", kind: "local" },
      { name: "dev", kind: "local" },
      { name: "origin/feature/x", kind: "remote" },
    ],
    recentRepos: ["/work/GitBee", "/work/other"],
    files: ["src/app.ts", "README.md"],
    commits: [
      { sha: "abc1234def5678abc1234def5678abc1234def56", subject: "Add checkout" },
      { sha: "1234fedcba4321fedcba4321fedcba4321fedcba", subject: "Fix pull" },
    ],
    themes: BUILTIN_THEMES,
    activeThemeId: "dark",
    layout: { sidebarCollapsed: false, rightPanelCollapsed: false, dimMergeCommits: false, hiddenCols: ["sha"] },
    undoLabel: null,
    redoLabel: null,
    ...over,
  };
}
