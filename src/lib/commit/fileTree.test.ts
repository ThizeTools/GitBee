import { describe, test, expect } from "bun:test";
import {
  buildTree, flattenTree, listOrder, sortFilesByPath, sortedChildren, type TreeNode,
} from "./fileTree";
import type { CommitFileStat } from "$lib/ipc";

function file(path: string): CommitFileStat {
  return { path, old_path: null, status: "M", additions: 1, deletions: 0 };
}

function names(nodes: TreeNode[]): string[] {
  return nodes.map((n) => n.name);
}

describe("buildTree", () => {
  test("nests files under their directories and puts the file on the leaf", () => {
    const root = buildTree([file("src/lib/a.ts")]);
    const src = root.children.get("src");
    const lib = src?.children.get("lib");
    const leaf = lib?.children.get("a.ts");
    expect(src?.path).toBe("src");
    expect(lib?.path).toBe("src/lib");
    expect(leaf?.file?.path).toBe("src/lib/a.ts");
    expect(src?.file).toBeUndefined();
  });

  test("ignores empty path segments", () => {
    const root = buildTree([file("/a//b.txt")]);
    expect(names([...root.children.values()])).toEqual(["a"]);
    expect(root.children.get("a")?.children.get("b.txt")?.file).toBeDefined();
  });
});

describe("sortedChildren", () => {
  const root = buildTree([file("zeta.ts"), file("alpha/x.ts"), file("beta.ts"), file("Gamma/y.ts")]);

  test("lists directories first, then files, A to Z", () => {
    expect(names(sortedChildren(root, "asc"))).toEqual(["alpha", "Gamma", "beta.ts", "zeta.ts"]);
  });

  test("reverses both groups for Z to A", () => {
    expect(names(sortedChildren(root, "desc"))).toEqual(["Gamma", "alpha", "zeta.ts", "beta.ts"]);
  });
});

describe("flattenTree", () => {
  test("walks the tree in render order", () => {
    const files = [file("b/z.ts"), file("a.ts"), file("b/y.ts")];
    expect(flattenTree(buildTree(files), "asc").map((f) => f.path)).toEqual(["b/y.ts", "b/z.ts", "a.ts"]);
  });

  test("reverses within each group for Z to A", () => {
    const files = [file("b/z.ts"), file("a.ts"), file("b/y.ts")];
    expect(flattenTree(buildTree(files), "desc").map((f) => f.path)).toEqual(["b/z.ts", "b/y.ts", "a.ts"]);
  });
});

describe("sortFilesByPath", () => {
  test("sorts full paths and leaves the input array alone", () => {
    const files = [file("b.ts"), file("a/z.ts"), file("a.ts")];
    expect(sortFilesByPath(files, "asc").map((f) => f.path)).toEqual(["a.ts", "a/z.ts", "b.ts"]);
    expect(sortFilesByPath(files, "desc").map((f) => f.path)).toEqual(["b.ts", "a/z.ts", "a.ts"]);
    expect(files[0].path).toBe("b.ts");
  });
});

describe("listOrder", () => {
  const files = [file("b/z.ts"), file("a.ts")];

  test("path view follows full-path order", () => {
    expect(listOrder(files, "path", "asc").map((f) => f.path)).toEqual(["a.ts", "b/z.ts"]);
  });

  test("tree view follows the tree, where directories come first", () => {
    expect(listOrder(files, "tree", "asc").map((f) => f.path)).toEqual(["b/z.ts", "a.ts"]);
  });
});
