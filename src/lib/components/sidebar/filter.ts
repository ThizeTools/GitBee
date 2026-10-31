// Sidebar filter rule, shared by every section. A row stays visible when any of
// its labels contains the typed text, ignoring case and outer spaces.

/** True when the filter is blank or one of `texts` contains it.
 * Example: matchesFilter("feat", "main", "feature/x") === true */
export function matchesFilter(filter: string, ...texts: string[]): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return texts.some((t) => t.toLowerCase().includes(needle));
}
