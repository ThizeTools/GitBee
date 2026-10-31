import { describe, test, expect } from "bun:test";
import { normTabPath, samePath } from "./repoPath";

describe("normTabPath", () => {
  test("unifies slashes, drops trailing slashes and lowercases", () => {
    expect(normTabPath("C:\\Work\\App\\")).toBe("c:/work/app");
    expect(normTabPath("c:/work/app")).toBe("c:/work/app");
  });

  test("drops every trailing slash, not just one", () => {
    expect(normTabPath("/srv/repo//")).toBe("/srv/repo");
  });
});

describe("samePath", () => {
  test("treats different spellings of one Windows folder as the same repo", () => {
    expect(samePath("C:\\Work\\App", "c:/work/app/")).toBe(true);
  });

  test("keeps different folders apart", () => {
    expect(samePath("C:\\Work\\App", "C:\\Work\\App2")).toBe(false);
  });
});
