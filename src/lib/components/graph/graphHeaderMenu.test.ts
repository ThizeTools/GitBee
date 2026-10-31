import { describe, expect, test } from "bun:test";
import { columnMenuItems } from "./graphHeaderMenu";
import type { GraphCol } from "$lib/graph/columns";

const ORDER: GraphCol[] = ["refs", "graph", "msg", "author", "date", "sha"];

function build(hidden: GraphCol[], dimMerges: boolean) {
  const toggled: GraphCol[] = [];
  let dimToggles = 0;
  const items = columnMenuItems({
    order: ORDER,
    hidden,
    dimMerges,
    onToggleHidden: (c) => toggled.push(c),
    onToggleDim: () => { dimToggles++; },
  });
  return { items, toggled, dimToggles: () => dimToggles };
}

describe("columnMenuItems", () => {
  test("one row per column in layout order, then a separator and the dim toggle", () => {
    const { items } = build([], false);
    expect(items.slice(0, 6).map((i) => i.label)).toEqual([
      "Branch / tag", "Graph", "Commit message", "Author", "Date", "SHA",
    ]);
    expect(items.slice(0, 6).map((i) => i.icon)).toEqual(Array(6).fill("check"));
    expect(items[6].separator).toBe(true);
    expect(items[7].label).toBe("Dim merge commits");
  });

  test("a hidden column has no check icon", () => {
    const { items } = build(["sha", "author"], false);
    expect(items.find((i) => i.label === "Author")?.icon).toBeUndefined();
    expect(items.find((i) => i.label === "SHA")?.icon).toBeUndefined();
  });

  test("graph and message are listed, checked and disabled", () => {
    const { items } = build([], false);
    const graph = items.find((i) => i.label === "Graph");
    const msg = items.find((i) => i.label === "Commit message");
    expect(graph?.disabled).toBe(true);
    expect(msg?.disabled).toBe(true);
    expect(graph?.icon).toBe("check");
  });

  test("clicking a column calls onToggleHidden with that column", () => {
    const { items, toggled } = build([], false);
    items.find((i) => i.label.includes("Date"))?.onClick?.();
    expect(toggled).toEqual(["date"]);
  });

  test("the dim item reflects the flag and calls onToggleDim", () => {
    const on = build([], true);
    expect(on.items[7].icon).toBe("check");
    on.items[7].onClick?.();
    expect(on.dimToggles()).toBe(1);
    expect(build([], false).items[7].icon).toBeUndefined();
  });
});
