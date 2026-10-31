import { describe, test, expect } from "bun:test";
import type { CommitRef } from "$lib/ipc";
import {
  emptyRepoFilters, getRepoFilters, parseFilterMap, repoFilterKey,
  pinnedShaFor, seedRepoFilters, serializeFilterMap, setRepoFilters, type RepoFilters,
} from "./graphFilterMap";

const LEGACY: RepoFilters = { hidden: ["gh-pages"], solo: [], pinned: "main" };

describe("repoFilterKey", () => {
  test("lowercases and unifies slashes", () => {
    expect(repoFilterKey("C:\\Code\\App")).toBe("c:/code/app");
    expect(repoFilterKey("c:/code/app")).toBe("c:/code/app");
  });
  test("drops trailing separators", () => {
    expect(repoFilterKey("C:\\Code\\App\\")).toBe("c:/code/app");
    expect(repoFilterKey("/home/me/app//")).toBe("/home/me/app");
  });
  test("keeps distinct repos distinct", () => {
    expect(repoFilterKey("C:/a/app")).not.toBe(repoFilterKey("C:/b/app"));
  });
});

describe("parseFilterMap", () => {
  test("null, empty and corrupt input yield an empty map", () => {
    expect(parseFilterMap(null)).toEqual({});
    expect(parseFilterMap("")).toEqual({});
    expect(parseFilterMap("{not json")).toEqual({});
    expect(parseFilterMap("[1,2,3]")).toEqual({});
    expect(parseFilterMap("null")).toEqual({});
  });
  test("round-trips a valid map", () => {
    const map = { "c:/a": { hidden: ["x"], solo: ["y"], pinned: "main" } };
    expect(parseFilterMap(serializeFilterMap(map))).toEqual(map);
  });
  test("drops malformed fields but keeps valid ones", () => {
    const raw = JSON.stringify({
      "c:/a": { hidden: ["x", 3, null], solo: "nope", pinned: 7 },
      "c:/b": "garbage",
    });
    expect(parseFilterMap(raw)).toEqual({
      "c:/a": { hidden: ["x"], solo: [], pinned: null },
      "c:/b": emptyRepoFilters(),
    });
  });
  test("an empty pinned string is no pin", () => {
    const raw = JSON.stringify({ "c:/a": { hidden: [], solo: [], pinned: "" } });
    expect(parseFilterMap(raw)["c:/a"].pinned).toBeNull();
  });
});

describe("getRepoFilters / setRepoFilters", () => {
  test("missing key returns null, not empty filters", () => {
    expect(getRepoFilters({}, "c:/a")).toBeNull();
  });
  test("set then get returns the stored filters", () => {
    const map = setRepoFilters({}, "c:/a", { hidden: ["x"], solo: [], pinned: null });
    expect(getRepoFilters(map, "c:/a")).toEqual({ hidden: ["x"], solo: [], pinned: null });
  });
  test("set does not mutate the input map", () => {
    const before = {};
    setRepoFilters(before, "c:/a", emptyRepoFilters());
    expect(before).toEqual({});
  });
  test("does not treat inherited keys as entries", () => {
    expect(getRepoFilters({}, "constructor")).toBeNull();
    expect(getRepoFilters({}, "toString")).toBeNull();
  });
});

describe("seedRepoFilters", () => {
  test("a repo with no entry takes the legacy values", () => {
    const map = seedRepoFilters({}, "c:/a", LEGACY);
    expect(getRepoFilters(map, "c:/a")).toEqual(LEGACY);
  });
  test("an existing entry is never overwritten by legacy values", () => {
    const existing = { "c:/a": { hidden: [], solo: [], pinned: null } };
    expect(seedRepoFilters(existing, "c:/a", LEGACY)).toBe(existing);
  });
  test("an existing empty entry blocks reseeding (user cleared filters)", () => {
    const cleared = setRepoFilters({}, "c:/a", emptyRepoFilters());
    expect(getRepoFilters(seedRepoFilters(cleared, "c:/a", LEGACY), "c:/a"))
      .toEqual(emptyRepoFilters());
  });
  test("seeding one repo leaves others untouched", () => {
    const map = seedRepoFilters({}, "c:/a", LEGACY);
    expect(getRepoFilters(map, "c:/b")).toBeNull();
  });
});

describe("pinnedShaFor", () => {
  const refs: CommitRef[] = [
    { name: "main", kind: "localbranch", target_sha: "aaa" },
    { name: "origin/main", kind: "remotebranch", target_sha: "bbb" },
    { name: "v1", kind: "tag", target_sha: "ccc" },
    { name: "stash", kind: "stash", target_sha: "ddd" },
  ];

  test("returns the target of the pinned ref", () => {
    expect(pinnedShaFor("origin/main", refs)).toBe("bbb");
    expect(pinnedShaFor("main", refs)).toBe("aaa");
  });

  test("null when nothing is pinned", () => {
    expect(pinnedShaFor(null, refs)).toBeNull();
    expect(pinnedShaFor("", refs)).toBeNull();
  });

  test("null when the pinned ref vanished, so HEAD takes lane 0", () => {
    expect(pinnedShaFor("feature/gone", refs)).toBeNull();
  });

  test("never resolves a stash entry as a pin", () => {
    expect(pinnedShaFor("stash", refs)).toBeNull();
  });
});
