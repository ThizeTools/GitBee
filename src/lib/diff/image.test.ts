import { describe, test, expect } from "bun:test";
import { imageDataUrl, isImagePath } from "./image";
import { revArg, commitRevs, stagedRevs, stashRevs, unstagedRevs } from "./revs";

describe("isImagePath", () => {
  test("accepts every previewed image extension, any case", () => {
    for (const p of ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.bmp", "g.ico", "h.svg"]) {
      expect(isImagePath(p)).toBe(true);
    }
  });

  test("rejects other files and extensionless names", () => {
    expect(isImagePath("main.rs")).toBe(false);
    expect(isImagePath("doc.pdf")).toBe(false);
    expect(isImagePath("png")).toBe(false);
  });
});

describe("imageDataUrl", () => {
  test("builds a base64 data URL with the given MIME type", () => {
    expect(imageDataUrl("image/png", "AAA=")).toBe("data:image/png;base64,AAA=");
  });
});

describe("revision sides", () => {
  test("unstaged: old is the index, new is the working tree", () => {
    const r = unstagedRevs();
    expect(revArg(r.old)).toBe("INDEX");
    expect(revArg(r.new)).toBeNull();
  });

  test("staged: old is HEAD, new is the index", () => {
    const r = stagedRevs();
    expect(revArg(r.old)).toBe("HEAD");
    expect(revArg(r.new)).toBe("INDEX");
  });

  test("commit: parent against the commit", () => {
    const r = commitRevs("abc123");
    expect(revArg(r.old)).toBe("abc123^");
    expect(revArg(r.new)).toBe("abc123");
  });

  test("stash: base against the stash entry", () => {
    const r = stashRevs(2);
    expect(revArg(r.old)).toBe("stash@{2}^");
    expect(revArg(r.new)).toBe("stash@{2}");
  });
});
