import { beforeEach, describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import {
  badgeDropKey, dropHoverKey, endRefDrag, leaveDropHover, refDragSource,
  rowDropKey, setDropHover, sidebarDropKey,
} from "./refDrag";

// Bun has no DOM, so beginRefDrag (which builds the drag image) is covered by
// the app check, not here. Everything below is the store and key logic.
beforeEach(() => endRefDrag());

describe("drop highlight", () => {
  test("setDropHover marks one target", () => {
    setDropHover("row:abc");
    expect(get(dropHoverKey)).toBe("row:abc");
  });

  test("leaveDropHover clears the highlight that still belongs to the key", () => {
    setDropHover("row:abc");
    leaveDropHover("row:abc");
    expect(get(dropHoverKey)).toBeNull();
  });

  test("leaveDropHover keeps a highlight that moved on to another target", () => {
    setDropHover("badge:localbranch:main");
    leaveDropHover("row:abc");
    expect(get(dropHoverKey)).toBe("badge:localbranch:main");
  });
});

describe("endRefDrag", () => {
  test("clears the source and the highlight", () => {
    refDragSource.set({ name: "feat", kind: "localbranch" });
    setDropHover("row:abc");
    endRefDrag();
    expect(get(refDragSource)).toBeNull();
    expect(get(dropHoverKey)).toBeNull();
  });
});

describe("drop keys", () => {
  test("rowDropKey is unique per commit", () => {
    expect(rowDropKey("abc")).toBe("row:abc");
  });

  test("a graph badge and a sidebar entry for the same branch get different keys", () => {
    const ref = { name: "main", kind: "localbranch" as const };
    expect(badgeDropKey(ref)).not.toBe(sidebarDropKey(ref));
    expect(badgeDropKey(ref)).toBe("badge:localbranch:main");
    expect(sidebarDropKey(ref)).toBe("sidebar:localbranch:main");
  });
});
