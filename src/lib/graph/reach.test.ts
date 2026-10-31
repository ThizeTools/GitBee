import { describe, expect, test } from "bun:test";
import { highlightFor, reachableFrom } from "./reach";
import { makeNode } from "./nodeFixtures";

// Newest first, like the backend. "m" is a merge of "a" (first parent) and "b".
//   t -> m -> a -> root
//             m -> b -> root
//   u (unrelated side branch) -> x (parent not loaded)
const graph = [
  makeNode("t", ["m"]),
  makeNode("m", ["a", "b"]),
  makeNode("a", ["root"]),
  makeNode("b", ["root"]),
  makeNode("root", []),
  makeNode("u", ["x"]),
];

describe("reachableFrom", () => {
  test("follows every parent of a merge, including the second parent", () => {
    const set = reachableFrom("m", graph);
    expect([...set].sort()).toEqual(["a", "b", "m", "root"]);
  });

  test("a leaf tip reaches only itself", () => {
    expect([...reachableFrom("root", graph)]).toEqual(["root"]);
  });

  test("walks down from the tip, never into descendants", () => {
    expect(reachableFrom("a", graph).has("t")).toBe(false);
    expect(reachableFrom("a", graph).has("m")).toBe(false);
  });

  test("a start sha that is not loaded yields an empty set", () => {
    expect(reachableFrom("not-loaded", graph).size).toBe(0);
  });

  test("a parent outside the loaded nodes ends the walk without error", () => {
    expect([...reachableFrom("u", graph)]).toEqual(["u"]);
  });

  test("a shared ancestor is visited once even when reached twice", () => {
    const set = reachableFrom("m", graph);
    expect(set.size).toBe(4);
  });

  test("handles a long linear history without recursion", () => {
    const chain = Array.from({ length: 20_000 }, (_, i) =>
      makeNode(`c${i}`, i + 1 < 20_000 ? [`c${i + 1}`] : []));
    expect(reachableFrom("c0", chain).size).toBe(20_000);
  });
});

describe("highlightFor", () => {
  test("returns null for a sha that is not loaded", () => {
    expect(highlightFor("not-loaded", graph)).toBeNull();
  });

  test("returns the ancestry set for a loaded sha", () => {
    expect(highlightFor("a", graph)?.has("root")).toBe(true);
  });
});
