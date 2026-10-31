import { describe, expect, test } from "bun:test";
import { queuePaths, takeReadyBatches, type PendingPaths } from "$lib/lfs/pending";

const NOTHING_KNOWN = (): boolean => false;

describe("queuePaths", () => {
  test("a path asked twice is queued once", () => {
    const pending: PendingPaths = new Map();
    queuePaths(pending, "/r", ["a.bin", "a.bin", "b.bin"], NOTHING_KNOWN);
    expect([...(pending.get("/r") ?? [])]).toEqual(["a.bin", "b.bin"]);
  });

  test("paths whose answer is known are not queued", () => {
    const pending: PendingPaths = new Map();
    queuePaths(pending, "/r", ["a.bin", "b.txt"], (p) => p === "b.txt");
    expect([...(pending.get("/r") ?? [])]).toEqual(["a.bin"]);
  });

  test("when every path is known the repo gets no queue at all", () => {
    const pending: PendingPaths = new Map();
    queuePaths(pending, "/r", ["a.bin"], () => true);
    expect(pending.has("/r")).toBe(false);
  });
});

describe("takeReadyBatches", () => {
  test("ready repos come out as batches and leave the queue", () => {
    const pending: PendingPaths = new Map();
    queuePaths(pending, "/one", ["a.bin"], NOTHING_KNOWN);
    queuePaths(pending, "/two", ["b.bin"], NOTHING_KNOWN);
    const batches = takeReadyBatches(pending, (repo) => repo === "/one");
    expect(batches).toEqual([{ repo: "/one", paths: ["a.bin"] }]);
    expect(pending.has("/one")).toBe(false);
  });

  test("a repo that is not ready keeps its queue for the next flush", () => {
    const pending: PendingPaths = new Map();
    queuePaths(pending, "/later", ["c.bin"], NOTHING_KNOWN);
    expect(takeReadyBatches(pending, () => false)).toEqual([]);
    expect([...(pending.get("/later") ?? [])]).toEqual(["c.bin"]);
  });
});
