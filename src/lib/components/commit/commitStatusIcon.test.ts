import { describe, expect, test } from "bun:test";
import { commitStatusIcon } from "./commitStatusIcon";

describe("commitStatusIcon", () => {
  test("maps git's change letters to the status icons", () => {
    expect(commitStatusIcon("A")).toBe("file-added");
    expect(commitStatusIcon("M")).toBe("file-modified");
    expect(commitStatusIcon("D")).toBe("file-deleted");
  });
  test("renamed and copied share the renamed icon", () => {
    expect(commitStatusIcon("R")).toBe("file-renamed");
    expect(commitStatusIcon("C")).toBe("file-renamed");
  });
  test("other letters fall back to the plain file icon", () => {
    expect(commitStatusIcon("T")).toBe("file");
    expect(commitStatusIcon("?")).toBe("file");
  });
});
