// "Checkout <branch>" rows for local and remote-tracking branches. Both go
// through the graph's checkout helpers, which record an undo entry.

import { checkoutAndJump, checkoutRemoteAndJump } from "$lib/stores/graphscroll";
import type { PaletteItem } from "$lib/palette/types";
import type { BranchRef } from "$lib/palette/sources";

/** Splits "origin/feature/x" at the first slash. Returns null when there is no remote part. */
export function splitRemoteName(name: string): { remote: string; branch: string } | null {
  const slash = name.indexOf("/");
  if (slash <= 0) return null;
  return { remote: name.slice(0, slash), branch: name.slice(slash + 1) };
}

function localItem(name: string): PaletteItem {
  return {
    id: `branch:${name}`,
    title: `Checkout ${name}`,
    subtitle: "local branch",
    category: "Branch",
    run: () => checkoutAndJump(name),
  };
}

function remoteItem(name: string): PaletteItem | null {
  const parts = splitRemoteName(name);
  if (parts === null) return null;
  return {
    id: `remote:${name}`,
    title: `Checkout ${name}`,
    subtitle: "remote branch",
    category: "Branch",
    run: () => checkoutRemoteAndJump(parts.remote, parts.branch),
  };
}

export function branchItems(branches: readonly BranchRef[]): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const b of branches) {
    const item = b.kind === "local" ? localItem(b.name) : remoteItem(b.name);
    if (item !== null) out.push(item);
  }
  return out;
}
