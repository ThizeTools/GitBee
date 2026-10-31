// Pure path comparison for repo tabs and stored repo keys. Kept free of Svelte
// and Tauri imports so both repoState.ts and graphFilterMap.ts can use it
// without a cycle (repoState imports graphFilter, which imports this).

/** Key used to compare repo paths: slashes unified, trailing slashes dropped,
 * lowercased, so `C:\\Work\\App\\` and `c:/work/app` are the same repo.
 * Windows paths are case-insensitive and may use either slash.
 * Example: normTabPath("C:\\Code\\App\\") → "c:/code/app" */
export function normTabPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** True when two repo paths name the same folder (see `normTabPath`).
 * Example: `samePath(t.path, opened.path)` */
export function samePath(a: string, b: string): boolean {
  return normTabPath(a) === normTabPath(b);
}
