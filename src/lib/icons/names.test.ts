import { describe, expect, test } from "bun:test";
import { ICON_LUCIDE_NAMES, ICON_NAMES } from "./names";

describe("icon name map", () => {
  test("every IconName has a Lucide mapping", () => {
    for (const name of ICON_NAMES) {
      expect(typeof ICON_LUCIDE_NAMES[name]).toBe("string");
    }
  });

  test("the map has no entries beyond ICON_NAMES", () => {
    expect(Object.keys(ICON_LUCIDE_NAMES).sort()).toEqual([...ICON_NAMES].sort());
  });

  test("IconName values are unique", () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });
});
