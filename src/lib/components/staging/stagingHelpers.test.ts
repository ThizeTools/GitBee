import { describe, expect, test } from "bun:test";
import type { StatusEntry } from "$lib/ipc";
import {
  amendFields,
  batchLabelFor,
  blockFlex,
  collapseKeyFor,
  composeMessage,
  fileExtension,
  isStaged,
  multiSelectionFor,
  shiftRange,
  sideOf,
  sortByPath,
  stashTitleFor,
  statusIconFor,
  statusTitle,
  summaryColor,
  summaryPercent,
} from "./stagingHelpers";

function entry(path: string, index: string, worktree: string, conflicted = false): StatusEntry {
  return { path, index, worktree, conflicted } as StatusEntry;
}

describe("isStaged", () => {
  test("modified index is staged", () => {
    expect(isStaged(entry("a", "modified", "unmodified"))).toBe(true);
  });
  test("untracked, ignored and unmodified index are not staged", () => {
    expect(isStaged(entry("a", "untracked", "untracked"))).toBe(false);
    expect(isStaged(entry("a", "ignored", "ignored"))).toBe(false);
    expect(isStaged(entry("a", "unmodified", "modified"))).toBe(false);
  });
});

describe("statusIconFor and statusTitle", () => {
  test("icon follows the requested side", () => {
    const e = entry("a", "added", "modified");
    expect(statusIconFor(e, "index")).toBe("file-added");
    expect(statusIconFor(e, "worktree")).toBe("file-modified");
  });
  test("unmodified side has no icon and no title", () => {
    const e = entry("a", "unmodified", "unmodified");
    expect(statusIconFor(e, "index")).toBeNull();
    expect(statusTitle(e, "index")).toBe("");
  });
  test("deleted and renamed sides get their own icons", () => {
    expect(statusIconFor(entry("a", "deleted", "unmodified"), "index")).toBe("file-deleted");
    expect(statusIconFor(entry("a", "renamed", "unmodified"), "index")).toBe("file-renamed");
  });
  test("untracked files read as added, ignored files as plain files", () => {
    expect(statusIconFor(entry("a", "untracked", "untracked"), "worktree")).toBe("file-added");
    expect(statusIconFor(entry("a", "ignored", "ignored"), "worktree")).toBe("file");
  });
  test("conflicted side uses the conflict icon and its title", () => {
    const e = entry("a", "conflicted", "conflicted", true);
    expect(statusIconFor(e, "worktree")).toBe("conflict");
    expect(statusTitle(e, "worktree")).toBe("Conflicted");
  });
});

describe("fileExtension", () => {
  test("returns the last extension with its dot", () => {
    expect(fileExtension("src/app.svelte")).toBe(".svelte");
    expect(fileExtension("archive.tar.gz")).toBe(".gz");
  });
  test("returns empty for no extension or a leading dot only", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(".gitignore")).toBe("");
  });
});

describe("sideOf and collapseKeyFor", () => {
  test("staged list reads index and uses the staged flag", () => {
    expect(sideOf("staged")).toBe("index");
    expect(collapseKeyFor("staged")).toBe("stagedCollapsed");
  });
  test("unstaged list reads worktree and uses the unstaged flag", () => {
    expect(sideOf("unstaged")).toBe("worktree");
    expect(collapseKeyFor("unstaged")).toBe("unstagedCollapsed");
  });
});

describe("sortByPath", () => {
  const files = [entry("b.ts", "unmodified", "modified"), entry("a.ts", "unmodified", "modified")];
  test("ascending sorts A to Z without mutating the input", () => {
    expect(sortByPath(files, "asc").map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(files[0].path).toBe("b.ts");
  });
  test("descending sorts Z to A", () => {
    expect(sortByPath(files, "desc").map((f) => f.path)).toEqual(["b.ts", "a.ts"]);
  });
});

describe("blockFlex", () => {
  test("folded section keeps only its header", () => {
    expect(blockFlex(true, false)).toBe("0 0 auto");
    expect(blockFlex(true, true)).toBe("0 0 auto");
  });
  test("open section fills the space left by a folded sibling", () => {
    expect(blockFlex(false, true)).toBe("1 1 auto");
  });
  test("two open sections split the space evenly", () => {
    expect(blockFlex(false, false)).toBe("1 1 50%");
  });
});

describe("multi-selection helpers", () => {
  test("multiSelectionFor returns targets only for a batch that includes the row", () => {
    expect(multiSelectionFor(new Set(["a", "b"]), "a")).toEqual(["a", "b"]);
    expect(multiSelectionFor(new Set(["a", "b"]), "c")).toBeNull();
    expect(multiSelectionFor(new Set(["a"]), "a")).toBeNull();
  });
  test("batchLabelFor counts the batch only when the row is in it", () => {
    const sel = new Set(["a", "b", "c"]);
    expect(batchLabelFor(sel, "a", "Stage")).toBe("Stage 3 Files");
    expect(batchLabelFor(sel, "z", "Stage")).toBe("Stage File");
    expect(batchLabelFor(new Set(), "a", "Unstage")).toBe("Unstage File");
  });
  test("shiftRange fills the span between anchor and target, keeping prior picks", () => {
    const next = shiftRange(["a", "b", "c", "d"], "d", "b", new Set(["z"]));
    expect(next && Array.from(next).sort()).toEqual(["b", "c", "d", "z"]);
  });
  test("shiftRange returns null when either end is not visible", () => {
    expect(shiftRange(["a", "b"], "a", "missing", new Set())).toBeNull();
    expect(shiftRange(["a", "b"], "missing", "b", new Set())).toBeNull();
  });
});

describe("composeMessage", () => {
  test("summary alone is trimmed", () => {
    expect(composeMessage("  fix: null  ", "  ")).toBe("fix: null");
  });
  test("summary and body are separated by a blank line", () => {
    expect(composeMessage("fix", " why ")).toBe("fix\n\nwhy");
  });
});

describe("summary counter helpers", () => {
  test("percent scales to the 72 limit and caps at 100", () => {
    expect(summaryPercent(0)).toBe(0);
    expect(summaryPercent(36)).toBe(50);
    expect(summaryPercent(200)).toBe(100);
  });
  test("color switches at 60 (amber) and past 72 (red)", () => {
    expect(summaryColor(60)).toBe("var(--fg-muted)");
    expect(summaryColor(61)).toBe("var(--modified)");
    expect(summaryColor(72)).toBe("var(--modified)");
    expect(summaryColor(73)).toBe("var(--del)");
  });
});

describe("amendFields", () => {
  test("splits summary from body, skipping blank separator lines", () => {
    expect(amendFields("subject\n\n\nbody one\nbody two")).toEqual({
      summary: "subject",
      description: "body one\nbody two",
    });
  });
  test("normalizes CRLF before splitting", () => {
    expect(amendFields("subject\r\n\r\nbody")).toEqual({ summary: "subject", description: "body" });
  });
  test("subject-only message has an empty description", () => {
    expect(amendFields("subject")).toEqual({ summary: "subject", description: "" });
  });
});

describe("stashTitleFor", () => {
  test("includes the HEAD subject when there is one", () => {
    expect(stashTitleFor("main", "fix: x")).toBe("WIP on main: fix: x");
  });
  test("falls back to the branch name alone", () => {
    expect(stashTitleFor("main", "")).toBe("WIP on main");
  });
});
