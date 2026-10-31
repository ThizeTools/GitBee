import { describe, test, expect } from "bun:test";
import type { FileDiff } from "$lib/ipc";
import { planFor, runPatchAction, type PatchIo } from "./patchAction";
import { add, ctx, del, hunkOf } from "./testing";

/** Records every git call in order and fails the apply on request. */
class FakePatchIo implements PatchIo {
  readonly calls: string[] = [];
  readonly patches: string[] = [];

  constructor(
    private readonly blob: string | null = "blob-before",
    private readonly failApply = false,
  ) {}

  async applyPatchText(repo: string, patch: string, cached: boolean, reverse: boolean): Promise<void> {
    this.calls.push(`apply ${repo} cached=${cached} reverse=${reverse}`);
    this.patches.push(patch);
    if (this.failApply) throw new Error("patch does not apply");
  }

  async backupFile(repo: string, file: string): Promise<string | null> {
    this.calls.push(`backup ${repo} ${file}`);
    return this.blob;
  }
}

function fileOf(): FileDiff {
  const hunk = hunkOf([ctx("a", 1, 1), del("b", 2), add("B", 2), ctx("c", 3, 3)]);
  return { old_path: "f.txt", new_path: "f.txt", hunks: [hunk], binary: false, omitted_lines: 0 };
}

const WHOLE_HUNK = { kind: "hunk", hunkIndex: 0 } as const;

describe("planFor", () => {
  test("stage works on the index forward; unstage and discard run in reverse", () => {
    expect(planFor("stage")).toEqual({ cached: true, reverse: false });
    expect(planFor("unstage")).toEqual({ cached: true, reverse: true });
    expect(planFor("discard")).toEqual({ cached: false, reverse: true });
  });
});

describe("runPatchAction", () => {
  test("stage applies the patch to the index and returns no undo backup", async () => {
    const io = new FakePatchIo();
    const backup = await runPatchAction(io, "/repo", fileOf(), WHOLE_HUNK, "stage");
    expect(backup).toBeNull();
    expect(io.calls).toEqual(["apply /repo cached=true reverse=false"]);
    expect(io.patches[0]).toContain("+B");
  });

  test("unstage applies the reversed patch to the index", async () => {
    const io = new FakePatchIo();
    await runPatchAction(io, "/repo", fileOf(), WHOLE_HUNK, "unstage");
    expect(io.calls).toEqual(["apply /repo cached=true reverse=true"]);
  });

  test("discard backs the file up before the apply and returns what undo needs", async () => {
    const io = new FakePatchIo("blob-42");
    const backup = await runPatchAction(io, "/repo", fileOf(), WHOLE_HUNK, "discard");
    expect(io.calls).toEqual([
      "backup /repo f.txt",
      "apply /repo cached=false reverse=true",
    ]);
    expect(backup?.file).toBe("f.txt");
    expect(backup?.blob).toBe("blob-42");
    expect(backup?.patch).toBe(io.patches[0]);
  });

  test("a discard of a deleted file names it by its old path", async () => {
    const file = fileOf();
    file.new_path = "";
    file.old_path = "gone.txt";
    const backup = await runPatchAction(new FakePatchIo(), "/repo", file, WHOLE_HUNK, "discard");
    expect(backup?.file).toBe("gone.txt");
  });

  test("an empty selection makes no git call", async () => {
    const io = new FakePatchIo();
    const backup = await runPatchAction(io, "/repo", fileOf(), { kind: "lines", lines: [] }, "discard");
    expect(backup).toBeNull();
    expect(io.calls).toEqual([]);
  });

  test("a failed apply throws, so the caller records no undo entry", async () => {
    const io = new FakePatchIo("blob-1", true);
    await expect(runPatchAction(io, "/repo", fileOf(), WHOLE_HUNK, "discard")).rejects.toThrow("patch does not apply");
    expect(io.calls).toEqual(["backup /repo f.txt", "apply /repo cached=false reverse=true"]);
  });
});
