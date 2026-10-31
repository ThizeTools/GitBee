import { describe, expect, test } from "bun:test";
import { ICON_NAMES } from "../icons/names";
import { MENU_GLYPH_ICONS, resolveMenuIcon } from "./contextmenu";

describe("resolveMenuIcon", () => {
  test("an IconName passes through unchanged", () => {
    expect(resolveMenuIcon("pull")).toBe("pull");
  });

  test("a legacy glyph maps to its IconName", () => {
    expect(resolveMenuIcon("↓")).toBe("pull");
    expect(resolveMenuIcon("🗑")).toBe("trash");
    expect(resolveMenuIcon("⧉")).toBe("copy");
  });

  test("an unknown glyph, an empty string or no icon renders nothing", () => {
    expect(resolveMenuIcon("→")).toBeNull();
    expect(resolveMenuIcon("not-an-icon")).toBeNull();
    expect(resolveMenuIcon("")).toBeNull();
    expect(resolveMenuIcon(undefined)).toBeNull();
  });

  test("every mapped glyph targets a real IconName", () => {
    for (const name of MENU_GLYPH_ICONS.values()) {
      expect(ICON_NAMES).toContain(name);
    }
  });
});
