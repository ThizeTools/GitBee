import { describe, test, expect } from "bun:test";
import { LruMap } from "./lruMap";

describe("LruMap", () => {
  test("stores and returns values", () => {
    const map = new LruMap<string, number>(3);
    map.set("a", 1);
    expect(map.get("a")).toBe(1);
    expect(map.has("a")).toBe(true);
    expect(map.get("missing")).toBeUndefined();
  });

  test("never holds more entries than its limit", () => {
    const map = new LruMap<number, number>(2000);
    for (let i = 0; i < 2500; i++) map.set(i, i);
    expect(map.size).toBe(2000);
    expect(map.has(0)).toBe(false);
    expect(map.has(2499)).toBe(true);
  });

  test("evicts the least recently used entry, not the oldest inserted", () => {
    const map = new LruMap<string, number>(2);
    map.set("a", 1);
    map.set("b", 2);
    map.get("a");
    map.set("c", 3);
    expect(map.has("a")).toBe(true);
    expect(map.has("b")).toBe(false);
    expect(map.has("c")).toBe(true);
  });

  test("setting an existing key replaces the value without growing the map", () => {
    const map = new LruMap<string, number>(2);
    map.set("a", 1);
    map.set("b", 2);
    map.set("a", 10);
    expect(map.size).toBe(2);
    expect(map.get("a")).toBe(10);
  });

  test("delete removes one entry", () => {
    const map = new LruMap<string, number>(2);
    map.set("a", 1);
    expect(map.delete("a")).toBe(true);
    expect(map.has("a")).toBe(false);
    expect(map.delete("a")).toBe(false);
  });

  test("refuses a limit that cannot hold an entry, and names the value", () => {
    expect(() => new LruMap<string, number>(0)).toThrow("got 0");
    expect(() => new LruMap<string, number>(1.5)).toThrow("got 1.5");
  });
});
