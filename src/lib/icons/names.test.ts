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

  // Pins the Lucide export behind each icon that replaced a glyph stand-in, so
  // a silent remap shows up here as well as in the Icon.svelte type check.
  test("replacement icons map to the expected Lucide exports", () => {
    expect(ICON_LUCIDE_NAMES).toMatchObject({
      "sign-out": "LogOut",
      export: "Upload",
      grip: "GripVertical",
      "arrow-left": "ArrowLeft",
      "arrow-right": "ArrowRight",
      "chevron-up": "ChevronUp",
      "chevron-left": "ChevronLeft",
      sort: "ArrowDownAZ",
      blame: "FileUser",
      reset: "RotateCcw",
      "cherry-pick": "Cherry",
      checkout: "ArrowRightLeft",
    });
  });
});
