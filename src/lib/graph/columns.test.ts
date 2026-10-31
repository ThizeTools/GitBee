import { describe, expect, test } from "bun:test";
import {
  DEFAULT_COL_ORDER, migrateColOrder, normalizeHidden, toggleHidden, visibleCols,
  type GraphCol,
} from "./columns";

describe("migrateColOrder", () => {
  test("appends author, date and sha after a pre-existing refs/graph/msg order", () => {
    expect(migrateColOrder(["refs", "graph", "msg"])).toEqual([...DEFAULT_COL_ORDER]);
  });

  test("keeps a user's custom order and appends only what is missing", () => {
    expect(migrateColOrder(["msg", "refs", "graph"])).toEqual(
      ["msg", "refs", "graph", "author", "date", "sha"],
    );
  });

  test("drops unknown and duplicate ids", () => {
    expect(migrateColOrder(["refs", "bogus", "refs", "graph", "msg", 7])).toEqual(
      ["refs", "graph", "msg", "author", "date", "sha"],
    );
  });

  test("a non-array value falls back to the default order", () => {
    expect(migrateColOrder(undefined)).toEqual([...DEFAULT_COL_ORDER]);
    expect(migrateColOrder("refs")).toEqual([...DEFAULT_COL_ORDER]);
  });
});

describe("normalizeHidden", () => {
  test("a missing list uses the default (sha hidden)", () => {
    expect(normalizeHidden(undefined)).toEqual(["sha"]);
  });

  test("locked columns are removed even if stored", () => {
    expect(normalizeHidden(["graph", "msg", "author"])).toEqual(["author"]);
  });

  test("unknown and duplicate entries are removed", () => {
    expect(normalizeHidden(["date", "date", "nope"])).toEqual(["date"]);
  });

  test("an empty stored list means nothing is hidden", () => {
    expect(normalizeHidden([])).toEqual([]);
  });
});

describe("visibleCols", () => {
  test("keeps layout order and skips hidden columns", () => {
    const order: GraphCol[] = ["refs", "graph", "msg", "author", "date", "sha"];
    expect(visibleCols(order, ["sha", "author"])).toEqual(["refs", "graph", "msg", "date"]);
  });

  test("a hidden column keeps its slot in the full order", () => {
    const order: GraphCol[] = ["author", "refs", "graph", "msg", "date"];
    visibleCols(order, ["author"]);
    expect(order[0]).toBe("author");
  });
});

describe("toggleHidden", () => {
  test("hides a visible column", () => {
    expect(toggleHidden([], "author")).toEqual(["author"]);
  });

  test("shows a hidden column again", () => {
    expect(toggleHidden(["sha", "author"], "sha")).toEqual(["author"]);
  });

  test("graph and msg can never be hidden", () => {
    expect(toggleHidden([], "graph")).toEqual([]);
    expect(toggleHidden([], "msg")).toEqual([]);
  });

  test("does not mutate the input list", () => {
    const hidden: GraphCol[] = ["sha"];
    toggleHidden(hidden, "date");
    expect(hidden).toEqual(["sha"]);
  });
});
