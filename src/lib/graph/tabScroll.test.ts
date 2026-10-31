import { describe, expect, test } from "bun:test";
import { TabScrollMemory } from "./tabScroll";

describe("TabScrollMemory", () => {
  test("a tab never scrolled starts at the top", () => {
    expect(new TabScrollMemory().offsetFor("tab-a")).toBe(0);
  });

  test("each tab keeps its own offset", () => {
    const m = new TabScrollMemory();
    m.remember("tab-a", 4200);
    m.remember("tab-b", 90);
    expect(m.offsetFor("tab-a")).toBe(4200);
    expect(m.offsetFor("tab-b")).toBe(90);
  });

  test("regression: switching to a fresh tab does not inherit the previous offset", () => {
    const m = new TabScrollMemory();
    m.remember("tab-a", 30000);
    expect(m.offsetFor("tab-b")).toBe(0);
  });

  test("a null tab id is ignored and reads as the top", () => {
    const m = new TabScrollMemory();
    m.remember(null, 500);
    expect(m.offsetFor(null)).toBe(0);
  });

  test("negative offsets (overscroll) are stored as 0", () => {
    const m = new TabScrollMemory();
    m.remember("tab-a", -12);
    expect(m.offsetFor("tab-a")).toBe(0);
  });

  test("enter: the first mount is not a tab switch", () => {
    expect(new TabScrollMemory().enter("tab-a", ["tab-a"])).toEqual({ top: 0, tabChanged: false });
  });

  test("enter: remounting the same tab (diff view closed) keeps its offset, no switch", () => {
    const m = new TabScrollMemory();
    m.enter("tab-a", ["tab-a"]);
    m.remember("tab-a", 640);
    expect(m.enter("tab-a", ["tab-a"])).toEqual({ top: 640, tabChanged: false });
  });

  test("regression: entering another tab is a switch and restores that tab's offset", () => {
    const m = new TabScrollMemory();
    m.enter("tab-a", ["tab-a", "tab-b"]);
    m.remember("tab-a", 9000);
    expect(m.enter("tab-b", ["tab-a", "tab-b"])).toEqual({ top: 0, tabChanged: true });
    m.remember("tab-b", 120);
    expect(m.enter("tab-a", ["tab-a", "tab-b"])).toEqual({ top: 9000, tabChanged: true });
  });

  test("enter drops offsets of closed tabs", () => {
    const m = new TabScrollMemory();
    m.remember("tab-a", 300);
    m.enter("tab-b", ["tab-b"]);
    expect(m.offsetFor("tab-a")).toBe(0);
  });

  test("retain drops closed tabs and keeps live ones", () => {
    const m = new TabScrollMemory();
    m.remember("tab-a", 100);
    m.remember("tab-b", 200);
    m.retain(["tab-b"]);
    expect(m.offsetFor("tab-a")).toBe(0);
    expect(m.offsetFor("tab-b")).toBe(200);
  });
});
