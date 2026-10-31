import { describe, expect, test } from "bun:test";
import {
  claimFirstTemplateRead,
  splitTemplate,
  stripTemplateComments,
} from "./template";

describe("stripTemplateComments", () => {
  test("drops lines that start with #", () => {
    expect(stripTemplateComments("# hint\nfix: x\n# more")).toBe("fix: x");
  });

  test("keeps a # that is not at the start of the line", () => {
    expect(stripTemplateComments("fix: issue #12")).toBe("fix: issue #12");
  });

  test("normalizes CRLF before splitting", () => {
    expect(stripTemplateComments("a\r\nb")).toBe("a\nb");
  });
});

describe("splitTemplate", () => {
  test("first line is the summary, the rest is the description", () => {
    expect(splitTemplate("fix: x\n\nBody line.")).toEqual({
      summary: "fix: x",
      description: "Body line.",
    });
  });

  test("comment lines do not reach either field", () => {
    expect(splitTemplate("# Subject below\nfeat: y\n# Body below\nDetails.")).toEqual({
      summary: "feat: y",
      description: "Details.",
    });
  });

  test("leading blank lines before the summary are skipped", () => {
    expect(splitTemplate("\n\nfix: z").summary).toBe("fix: z");
  });

  test("a template of only comments fills nothing", () => {
    expect(splitTemplate("# one\n# two\n")).toEqual({ summary: "", description: "" });
  });

  test("a summary-only template has an empty description", () => {
    expect(splitTemplate("chore: bump")).toEqual({ summary: "chore: bump", description: "" });
  });

  test("blank lines around the description are trimmed", () => {
    expect(splitTemplate("fix\n\n\nBody\n\n").description).toBe("Body");
  });

  test("CRLF template splits like an LF one", () => {
    expect(splitTemplate("fix: a\r\n\r\nBody")).toEqual({ summary: "fix: a", description: "Body" });
  });
});

describe("claimFirstTemplateRead", () => {
  test("the first claim for a repo wins, later ones lose", () => {
    expect(claimFirstTemplateRead("/repo/first")).toBe(true);
    expect(claimFirstTemplateRead("/repo/first")).toBe(false);
  });

  test("each repo gets its own first claim", () => {
    expect(claimFirstTemplateRead("/repo/second")).toBe(true);
    expect(claimFirstTemplateRead("/repo/third")).toBe(true);
  });
});
