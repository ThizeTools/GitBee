import { describe, test, expect } from "bun:test";
import { toSplitRows } from "./splitRows";
import { add, ctx, del, hunkOf, noNewline } from "./testing";

describe("toSplitRows", () => {
  test("aligns context on both sides and pairs removals with additions", () => {
    const rows = toSplitRows(hunkOf([
      ctx("a", 1, 1), del("b", 2), del("c", 3),
      add("B", 2), add("X", 3), add("Y", 4), ctx("d", 4, 5),
    ]));
    expect(rows.length).toBe(5);
    expect(rows[0].left?.content).toBe("a");
    expect(rows[0].right?.no).toBe(1);
    expect(rows[1].left?.content).toBe("b");
    expect(rows[1].right?.content).toBe("B");
    expect(rows[2].left?.content).toBe("c");
    expect(rows[2].right?.content).toBe("X");
  });

  test("an unpaired addition leaves the left side empty", () => {
    const rows = toSplitRows(hunkOf([del("a", 1), add("b", 1), add("c", 2)]));
    expect(rows.length).toBe(2);
    expect(rows[1].left).toBeNull();
    expect(rows[1].right?.content).toBe("c");
  });

  test("an unpaired removal leaves the right side empty", () => {
    const rows = toSplitRows(hunkOf([ctx("a", 1, 1), del("b", 2), ctx("c", 3, 2)]));
    expect(rows[1]).toEqual({
      left: { kind: "del", no: 2, index: 1, content: "b" },
      right: null,
    });
  });

  test("cells keep the line index so the view can find word ranges", () => {
    const rows = toSplitRows(hunkOf([del("old", 1), add("new", 1)]));
    expect(rows[0].left?.index).toBe(0);
    expect(rows[0].right?.index).toBe(1);
  });

  test("a no-newline marker sits on the side of the line before it", () => {
    const rows = toSplitRows(hunkOf([del("a", 1), noNewline(), add("b", 1)]));
    expect(rows.length).toBe(2);
    expect(rows[1].left?.kind).toBe("nonewline");
    expect(rows[1].right).toBeNull();
  });
});
