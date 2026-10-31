import { describe, test, expect } from "bun:test";
import { mergeScope, parseScope } from "./refreshScope";

describe("mergeScope", () => {
  test("status + status stays status", () => {
    expect(mergeScope("status", "status")).toBe("status");
  });
  test("status + full widens to full", () => {
    expect(mergeScope("status", "full")).toBe("full");
  });
  test("full + status stays full", () => {
    expect(mergeScope("full", "status")).toBe("full");
  });
  test("full + full stays full", () => {
    expect(mergeScope("full", "full")).toBe("full");
  });
});

describe("parseScope", () => {
  test("scope status is status", () => {
    expect(parseScope({ scope: "status" })).toBe("status");
  });
  test("scope full is full", () => {
    expect(parseScope({ scope: "full" })).toBe("full");
  });
  test("payload without a scope is full", () => {
    expect(parseScope({})).toBe("full");
  });
  test("null payload is full", () => {
    expect(parseScope(null)).toBe("full");
  });
  test("undefined payload is full", () => {
    expect(parseScope(undefined)).toBe("full");
  });
  test("a bare string is full, even when it reads status", () => {
    expect(parseScope("status")).toBe("full");
  });
});
