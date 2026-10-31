import { describe, expect, test } from "bun:test";
import { segmentTitle } from "$lib/palette/highlight";

describe("segmentTitle", () => {
  test("groups a leading match run", () => {
    expect(segmentTitle("Pull", [0, 1])).toEqual([
      { text: "Pu", match: true },
      { text: "ll", match: false },
    ]);
  });

  test("splits around scattered matches", () => {
    expect(segmentTitle("Checkout branch", [0, 1, 4])).toEqual([
      { text: "Ch", match: true },
      { text: "ec", match: false },
      { text: "k", match: true },
      { text: "out branch", match: false },
    ]);
  });

  test("with no positions the whole title is one unmatched segment", () => {
    expect(segmentTitle("Pull", [])).toEqual([{ text: "Pull", match: false }]);
  });

  test("an empty title has no segments", () => {
    expect(segmentTitle("", [])).toEqual([]);
  });

  test("a match on the last character is its own segment", () => {
    expect(segmentTitle("Push", [3])).toEqual([
      { text: "Pus", match: false },
      { text: "h", match: true },
    ]);
  });
});
