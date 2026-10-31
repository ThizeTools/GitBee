import { describe, test, expect } from "bun:test";
import { checkCloneForm, parseDepth, type CloneForm } from "./cloneOptions";

const plain: CloneForm = { shallow: false, depthText: "1", singleBranch: false, branchText: "" };

describe("parseDepth", () => {
  test("accepts whole numbers of at least 1", () => {
    expect(parseDepth("1")).toBe(1);
    expect(parseDepth(" 25 ")).toBe(25);
  });

  test("refuses zero, negatives, fractions and words", () => {
    expect(parseDepth("0")).toBeNull();
    expect(parseDepth("-2")).toBeNull();
    expect(parseDepth("1.5")).toBeNull();
    expect(parseDepth("deep")).toBeNull();
    expect(parseDepth("")).toBeNull();
  });
});

describe("checkCloneForm", () => {
  test("a plain clone sends no depth and no branch", () => {
    expect(checkCloneForm(plain)).toEqual({
      options: { depth: null, branch: null, singleBranch: false },
      error: null,
    });
  });

  test("a shallow clone sends the typed depth", () => {
    const result = checkCloneForm({ ...plain, shallow: true, depthText: "3" });
    expect(result.options.depth).toBe(3);
    expect(result.error).toBeNull();
  });

  test("a bad depth is an error that names the value, and the form is not sent", () => {
    const result = checkCloneForm({ ...plain, shallow: true, depthText: "0" });
    expect(result.error).toContain('"0"');
  });

  test("the depth field is ignored while shallow is off", () => {
    const result = checkCloneForm({ ...plain, shallow: false, depthText: "bogus" });
    expect(result.options.depth).toBeNull();
    expect(result.error).toBeNull();
  });

  test("single branch sends the trimmed branch name", () => {
    const result = checkCloneForm({ ...plain, singleBranch: true, branchText: "  main " });
    expect(result.options).toEqual({ depth: null, branch: "main", singleBranch: true });
  });

  test("single branch with an empty name sends no branch", () => {
    const result = checkCloneForm({ ...plain, singleBranch: true, branchText: "  " });
    expect(result.options.branch).toBeNull();
    expect(result.error).toBeNull();
  });

  test("a branch name starting with a dash is refused, naming the value", () => {
    const result = checkCloneForm({ ...plain, singleBranch: true, branchText: "--evil" });
    expect(result.error).toContain("--evil");
  });

  test("a branch typed while single branch is off is not sent", () => {
    const result = checkCloneForm({ ...plain, singleBranch: false, branchText: "--evil" });
    expect(result.options.branch).toBeNull();
    expect(result.error).toBeNull();
  });
});
