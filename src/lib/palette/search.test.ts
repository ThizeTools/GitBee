import { describe, expect, test } from "bun:test";
import { searchPalette, PALETTE_ROW_LIMIT } from "$lib/palette/search";
import { makeSources } from "$lib/palette/testSources";
import type { PaletteItem } from "$lib/palette/types";

function ids(rows: { item: PaletteItem }[]): string[] {
  return rows.map((r) => r.item.id);
}

describe("searchPalette: prefix modes", () => {
  test("the actions mode offers only action rows", () => {
    const rows = searchPalette({ mode: "actions", text: "" }, makeSources(), []);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.item.category === "Action")).toBe(true);
  });

  test("the branches mode offers only branch rows", () => {
    const rows = searchPalette({ mode: "branches", text: "" }, makeSources(), []);
    expect(rows.every((r) => r.item.category === "Branch")).toBe(true);
    expect(rows.map((r) => r.item.title)).toContain("Checkout origin/feature/x");
  });

  test("the files mode gives a history and a blame row for each file", () => {
    const rows = searchPalette({ mode: "files", text: "" }, makeSources(), []);
    expect(rows.map((r) => r.item.title)).toEqual([
      "History: src/app.ts", "Blame: src/app.ts",
      "History: README.md", "Blame: README.md",
    ]);
  });

  test("the themes mode offers only theme rows", () => {
    const rows = searchPalette({ mode: "themes", text: "" }, makeSources(), []);
    expect(rows.every((r) => r.item.category === "Theme")).toBe(true);
  });

  test("the commits mode lists every commit, not only sha matches", () => {
    const rows = searchPalette({ mode: "commits", text: "" }, makeSources(), []);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.item.category === "Commit")).toBe(true);
  });
});

describe("searchPalette: the unprefixed finder", () => {
  test("offers actions, repos, branches, files and themes together", () => {
    const categories = new Set(
      searchPalette({ mode: "all", text: "" }, makeSources(), []).map((r) => r.item.category),
    );
    expect(categories).toEqual(new Set(["Action", "Repo", "Branch", "File", "Theme"]));
  });

  test("leaves commits out for a plain word, so ordinary text does not flood the list", () => {
    const rows = searchPalette({ mode: "all", text: "pull" }, makeSources(), []);
    expect(rows.some((r) => r.item.category === "Commit")).toBe(false);
  });

  test("adds commits whose sha starts with a hex text", () => {
    const rows = searchPalette({ mode: "all", text: "abc1234" }, makeSources(), []);
    expect(rows.map((r) => r.item.id)).toEqual(["commit:abc1234def5678abc1234def5678abc1234def56"]);
  });

  test("ranks by the typed text, so the best match comes first", () => {
    const rows = searchPalette({ mode: "all", text: "chk" }, makeSources(), []);
    expect(rows[0].item.title.startsWith("Checkout")).toBe(true);
  });

  test("trims the typed text before matching", () => {
    const plain = ids(searchPalette({ mode: "all", text: "dev" }, makeSources(), []));
    const padded = ids(searchPalette({ mode: "all", text: "  dev  " }, makeSources(), []));
    expect(padded).toEqual(plain);
  });

  test("an exact action title outranks longer titles that also match", () => {
    const rows = searchPalette({ mode: "all", text: "pull" }, makeSources(), []);
    expect(rows[0].item.title).toBe("Pull");
    expect(rows[0].item.category).toBe("Action");
  });
});

describe("searchPalette: recent items and the row cap", () => {
  test("with an empty text, recent rows come first in recency order", () => {
    const rows = searchPalette({ mode: "all", text: "" }, makeSources(), ["branch:dev", "branch:main"]);
    expect(ids(rows).slice(0, 2)).toEqual(["branch:dev", "branch:main"]);
  });

  test("recent ids that are not in this mode are skipped", () => {
    const rows = searchPalette({ mode: "files", text: "" }, makeSources(), ["branch:dev"]);
    expect(rows.every((r) => r.item.category === "File")).toBe(true);
  });

  test("recent rows are not moved to the top once something is typed", () => {
    const rows = searchPalette({ mode: "all", text: "dev" }, makeSources(), ["repo:/work/other"]);
    expect(rows[0].item.id).not.toBe("repo:/work/other");
  });

  test("never returns more than PALETTE_ROW_LIMIT rows, with or without text", () => {
    const branches = Array.from({ length: 120 }, (_, i) => ({ name: `feature-${i}`, kind: "local" as const }));
    const src = makeSources({ branches });
    expect(searchPalette({ mode: "branches", text: "" }, src, [])).toHaveLength(PALETTE_ROW_LIMIT);
    expect(searchPalette({ mode: "branches", text: "feat" }, src, [])).toHaveLength(PALETTE_ROW_LIMIT);
  });
});
