// Per-tab graph scroll offsets. GraphCanvas used to stay mounted across tab
// switches, so every tab inherited the previous tab's scroll offset: the new
// graph opened at a random row, and when that offset was past the new graph's
// end the rows and lanes were laid out off screen (blank or misaligned graph
// until the user scrolled). It is now remounted per tab, and this keeps each
// tab's position across those remounts. See docs/specs/graph-loading.md.

/** Remembers the last graph scroll offset (CSS px) of each tab.
 * Example: `memory.remember(tabId, el.scrollTop); el.scrollTop = memory.offsetFor(otherId)` */
export class TabScrollMemory {
  private readonly offsets = new Map<string, number>();
  private lastShown: string | null | undefined;

  /** Stores `top` for `tabId`. A null id (no active tab) is ignored. */
  remember(tabId: string | null, top: number): void {
    if (tabId === null) return;
    this.offsets.set(tabId, Math.max(0, top));
  }

  /** The stored offset, or 0 for a tab never scrolled (or no tab). */
  offsetFor(tabId: string | null): number {
    if (tabId === null) return 0;
    return this.offsets.get(tabId) ?? 0;
  }

  /** Call when the graph of `tabId` mounts. Drops closed tabs (`liveIds` are
   * the open ones) and says where to scroll and whether this is another tab
   * than the last one shown; the first mount is not a switch.
   * Example: `const { top, tabChanged } = memory.enter(tabId, $tabs.map((t) => t.id))` */
  enter(tabId: string | null, liveIds: Iterable<string>): { top: number; tabChanged: boolean } {
    const tabChanged = this.lastShown !== undefined && this.lastShown !== tabId;
    this.lastShown = tabId;
    this.retain(liveIds);
    return { top: this.offsetFor(tabId), tabChanged };
  }

  /** Drops offsets of tabs not in `liveIds`, so closed tabs don't accumulate. */
  retain(liveIds: Iterable<string>): void {
    const live = new Set(liveIds);
    for (const id of [...this.offsets.keys()]) {
      if (!live.has(id)) this.offsets.delete(id);
    }
  }
}
