import { describe, test, expect } from "bun:test";
import type { CommitFileStat, FileLogEntry } from "$lib/ipc";
import { renamedFromLog, renamedFromStats } from "./renamedFrom";

function stat(path: string, oldPath: string | null): CommitFileStat {
  return { path, old_path: oldPath, status: oldPath ? "R" : "M", additions: 1, deletions: 0 };
}

function log(path: string, status: string): FileLogEntry {
  return {
    sha: `sha-${path}-${status}`, parents: [], author_name: "a", author_email: "a@x",
    timestamp: 0, subject: "s", path_at_commit: path, status,
  };
}

describe("renamedFromStats", () => {
  test("returns the old name of a renamed file", () => {
    expect(renamedFromStats([stat("src/new.ts", "src/old.ts")], "src/new.ts")).toBe("src/old.ts");
  });

  test("returns undefined for a file the commit did not rename", () => {
    expect(renamedFromStats([stat("src/a.ts", null)], "src/a.ts")).toBeUndefined();
  });

  test("returns undefined for a path the commit does not list", () => {
    expect(renamedFromStats([stat("src/a.ts", null)], "src/missing.ts")).toBeUndefined();
  });
});

describe("renamedFromLog", () => {
  test("a rename commit takes its old name from the next older entry", () => {
    const entries = [log("new.ts", "R"), log("old.ts", "M")];
    expect(renamedFromLog(entries, 0)).toBe("old.ts");
  });

  test("a commit that is not a rename has no old name", () => {
    const entries = [log("a.ts", "M"), log("a.ts", "A")];
    expect(renamedFromLog(entries, 0)).toBeUndefined();
  });

  test("a rename at the end of the loaded page has no older entry to read", () => {
    expect(renamedFromLog([log("new.ts", "R")], 0)).toBeUndefined();
  });

  test("an index past the list has no old name", () => {
    expect(renamedFromLog([log("a.ts", "M")], 5)).toBeUndefined();
  });
});
