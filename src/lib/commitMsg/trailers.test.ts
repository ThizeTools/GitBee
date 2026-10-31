import { describe, expect, test } from "bun:test";
import {
  addCoAuthor,
  coAuthorLine,
  parseCoAuthors,
  removeCoAuthor,
} from "./trailers";

const ana = { name: "Ana Lima", email: "ana@x.io" };
const bo = { name: "Bo", email: "bo@x.io" };

describe("coAuthorLine", () => {
  test("formats the trailer with name and email", () => {
    expect(coAuthorLine(ana)).toBe("Co-authored-by: Ana Lima <ana@x.io>");
  });

  test("falls back to the email when the name is empty", () => {
    expect(coAuthorLine({ name: "  ", email: "bo@x.io" })).toBe("Co-authored-by: bo@x.io <bo@x.io>");
  });
});

describe("parseCoAuthors", () => {
  test("reads every trailer line in order", () => {
    const text = "Body\n\nCo-authored-by: Ana Lima <ana@x.io>\nCo-authored-by: Bo <bo@x.io>";
    expect(parseCoAuthors(text)).toEqual([ana, bo]);
  });

  test("is case-insensitive about the key", () => {
    expect(parseCoAuthors("co-authored-by: Ana Lima <ana@x.io>")).toEqual([ana]);
  });

  test("ignores lines that only mention the key", () => {
    expect(parseCoAuthors("Co-authored-by without brackets")).toEqual([]);
  });

  test("returns nothing for an empty description", () => {
    expect(parseCoAuthors("")).toEqual([]);
  });
});

describe("addCoAuthor", () => {
  test("empty description gets the trailer with no leading blank line", () => {
    expect(addCoAuthor("", ana)).toBe("Co-authored-by: Ana Lima <ana@x.io>");
  });

  test("a body gets one blank line before the trailer block", () => {
    expect(addCoAuthor("Fix it.", ana)).toBe("Fix it.\n\nCo-authored-by: Ana Lima <ana@x.io>");
  });

  test("a second person joins the existing block with no blank line", () => {
    const once = addCoAuthor("Fix it.", ana);
    expect(addCoAuthor(once, bo)).toBe(
      "Fix it.\n\nCo-authored-by: Ana Lima <ana@x.io>\nCo-authored-by: Bo <bo@x.io>",
    );
  });

  test("the same email is never added twice, even in another case", () => {
    const once = addCoAuthor("Fix.", ana);
    expect(addCoAuthor(once, { name: "Ana", email: "ANA@x.io" })).toBe(once);
  });

  test("trailing whitespace in the body is dropped before the block", () => {
    expect(addCoAuthor("Fix it.\n\n\n", bo)).toBe("Fix it.\n\nCo-authored-by: Bo <bo@x.io>");
  });

  test("CRLF in the body is normalized", () => {
    expect(addCoAuthor("A\r\nB", bo)).toBe("A\nB\n\nCo-authored-by: Bo <bo@x.io>");
  });
});

describe("removeCoAuthor", () => {
  test("removes only the line for that email", () => {
    const text = "Fix.\n\nCo-authored-by: Ana Lima <ana@x.io>\nCo-authored-by: Bo <bo@x.io>";
    expect(removeCoAuthor(text, "ana@x.io")).toBe("Fix.\n\nCo-authored-by: Bo <bo@x.io>");
  });

  test("removing the last trailer leaves the body with no trailing blank lines", () => {
    expect(removeCoAuthor("Fix.\n\nCo-authored-by: Ana Lima <ana@x.io>", "ana@x.io")).toBe("Fix.");
  });

  test("the email match ignores case", () => {
    expect(removeCoAuthor("Co-authored-by: Ana <ANA@x.io>", "ana@x.io")).toBe("");
  });

  test("an email with no trailer leaves the text as it was", () => {
    expect(removeCoAuthor("Fix.", "nobody@x.io")).toBe("Fix.");
  });

  test("add then remove gives back the original body", () => {
    const body = "Fix it.";
    expect(removeCoAuthor(addCoAuthor(body, bo), "bo@x.io")).toBe(body);
  });
});
