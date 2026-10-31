// "History: <file>" and "Blame: <file>" rows. Each file gets both, so typing
// the file name and then "blame" or "history" reaches either view.

import { showFileBlame, showFileHistory } from "$lib/stores/center";
import type { PaletteItem } from "$lib/palette/types";

export function fileItems(files: readonly string[]): PaletteItem[] {
  return files.flatMap((file) => [
    {
      id: `file-history:${file}`,
      title: `History: ${file}`,
      category: "File" as const,
      run: () => showFileHistory(file),
    },
    {
      id: `file-blame:${file}`,
      title: `Blame: ${file}`,
      category: "File" as const,
      run: () => showFileBlame(file),
    },
  ]);
}
