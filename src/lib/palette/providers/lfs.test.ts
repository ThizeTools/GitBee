import { describe, expect, test } from "bun:test";
import type { LfsInfo } from "$lib/ipc";
import { lfsItemsFor } from "$lib/palette/providers/lfs";

const INSTALLED: LfsInfo = { installed: true, version: "3.4.1", used: true, patterns: ["*.psd"] };

describe("lfsItemsFor", () => {
  test("no rows while the open repo has no status", () => {
    expect(lfsItemsFor(null)).toEqual([]);
  });

  test("no rows when git-lfs is not installed, so none can fail", () => {
    expect(lfsItemsFor({ ...INSTALLED, installed: false, version: null })).toEqual([]);
  });

  test("an installed git-lfs offers the five LFS rows in the LFS category", () => {
    const rows = lfsItemsFor(INSTALLED);
    expect(rows.map((r) => r.title)).toEqual([
      "LFS: Pull",
      "LFS: Fetch",
      "LFS: Track pattern…",
      "LFS: Untrack pattern…",
      "LFS: Install hooks in this repo",
    ]);
    expect(rows.every((r) => r.category === "LFS")).toBe(true);
  });

  test("each row has its own stable id", () => {
    const ids = lfsItemsFor(INSTALLED).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("lfs:pull");
  });
});
