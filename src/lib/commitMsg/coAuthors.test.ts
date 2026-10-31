import { describe, expect, test } from "bun:test";
import { distinctAuthors, filterAuthors, type AuthorSample } from "./coAuthors";

const me = { name: "Giovani", email: "giovani@x.io" };

function sample(name: string, email: string, timestamp: number): AuthorSample {
  return { author_name: name, author_email: email, timestamp };
}

describe("distinctAuthors", () => {
  test("keeps one option per email, with its most recent commit", () => {
    const out = distinctAuthors(
      [sample("Ana", "ana@x.io", 10), sample("Ana L.", "ana@x.io", 30)],
      me,
    );
    expect(out).toEqual([{ name: "Ana L.", email: "ana@x.io", lastSeen: 30 }]);
  });

  test("orders the most recent author first", () => {
    const out = distinctAuthors(
      [sample("Old", "old@x.io", 1), sample("New", "new@x.io", 9)],
      me,
    );
    expect(out.map((a) => a.email)).toEqual(["new@x.io", "old@x.io"]);
  });

  test("the same email in another case is one person", () => {
    const out = distinctAuthors(
      [sample("Ana", "Ana@X.io", 5), sample("Ana", "ana@x.io", 2)],
      me,
    );
    expect(out).toHaveLength(1);
  });

  test("leaves out the current user by email, ignoring case", () => {
    const out = distinctAuthors([sample("Someone", "GIOVANI@x.io", 3)], me);
    expect(out).toEqual([]);
  });

  test("leaves out the current user by name", () => {
    const out = distinctAuthors([sample("Giovani", "other@x.io", 3)], me);
    expect(out).toEqual([]);
  });

  test("a missing user identity excludes nothing by name", () => {
    const out = distinctAuthors([sample("Ana", "ana@x.io", 3)], { name: "", email: "" });
    expect(out).toHaveLength(1);
  });

  test("skips commits without an email", () => {
    expect(distinctAuthors([sample("Ghost", "  ", 3)], me)).toEqual([]);
  });

  test("ties in time fall back to name order", () => {
    const out = distinctAuthors(
      [sample("Zed", "z@x.io", 5), sample("Amy", "a@x.io", 5)],
      me,
    );
    expect(out.map((a) => a.name)).toEqual(["Amy", "Zed"]);
  });
});

describe("filterAuthors", () => {
  const people = distinctAuthors(
    [sample("Ana Lima", "ana@x.io", 2), sample("Bo", "bo@corp.dev", 1)],
    me,
  );

  test("matches on name, ignoring case", () => {
    expect(filterAuthors(people, "ANA").map((a) => a.email)).toEqual(["ana@x.io"]);
  });

  test("matches on email", () => {
    expect(filterAuthors(people, "corp").map((a) => a.name)).toEqual(["Bo"]);
  });

  test("a blank query returns everyone", () => {
    expect(filterAuthors(people, "   ")).toHaveLength(2);
  });

  test("no match returns an empty list", () => {
    expect(filterAuthors(people, "nobody")).toEqual([]);
  });
});
