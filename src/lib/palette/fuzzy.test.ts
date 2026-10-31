import { describe, expect, test } from "bun:test";
import { fuzzyScore, rankItems } from "$lib/palette/fuzzy";

function titles(query: string, names: string[]): string[] {
  return rankItems(query, names.map((title) => ({ title })), 50).map((r) => r.item.title);
}

describe("fuzzyScore: matching", () => {
  test("an empty query matches any title with score 0 and no positions", () => {
    expect(fuzzyScore("", "Pull")).toEqual({ score: 0, positions: [] });
  });

  test("returns null when a query character is missing", () => {
    expect(fuzzyScore("xyz", "Checkout")).toBeNull();
  });

  test("returns null when the characters appear in the wrong order", () => {
    expect(fuzzyScore("kc", "Checkout")).toBeNull();
  });

  test("returns null when the query is longer than the title", () => {
    expect(fuzzyScore("checkouts", "Checkout")).toBeNull();
  });

  test("ignores case in both directions", () => {
    expect(fuzzyScore("PULL", "pull")).not.toBeNull();
    expect(fuzzyScore("pull", "PULL")).not.toBeNull();
  });

  test("reports the title index of every matched character", () => {
    expect(fuzzyScore("chk", "Checkout branch")?.positions).toEqual([0, 1, 4]);
  });

  test("positions are ascending and point at matching characters", () => {
    const cases: [string, string][] = [
      ["gb", "Go to branch"], ["pl", "Pull (rebase)"], ["td", "Theme: Dracula"],
    ];
    for (const [q, t] of cases) {
      const m = fuzzyScore(q, t);
      expect(m).not.toBeNull();
      const pos = m!.positions;
      expect(pos).toEqual([...pos].sort((a, b) => a - b));
      pos.forEach((p, i) => expect(t[p].toLowerCase()).toBe(q[i].toLowerCase()));
    }
  });

  test("finds the best alignment, not the first greedy one", () => {
    // Greedy would take the 'a' at index 1 (mid-word). The best alignment is the
    // word-start "ab" at indexes 4 and 5.
    expect(fuzzyScore("ab", "xab ab")?.positions).toEqual([4, 5]);
  });
});

describe("fuzzyScore: scoring", () => {
  test("a word-start match outscores a mid-word match", () => {
    const wordStart = fuzzyScore("rb", "Remove branch")!.score;
    const midWord = fuzzyScore("rb", "Verbose")!.score;
    expect(wordStart).toBeGreaterThan(midWord);
  });

  test("consecutive characters outscore scattered ones", () => {
    const run = fuzzyScore("ab", "xab")!.score;
    const scattered = fuzzyScore("ab", "xaxb")!.score;
    expect(run).toBeGreaterThan(scattered);
  });

  test("a camel-case hump counts as a word start", () => {
    const hump = fuzzyScore("fb", "fooBar")!;
    const plain = fuzzyScore("fb", "foxxbar")!;
    expect(hump.positions).toEqual([0, 3]);
    expect(hump.score).toBeGreaterThan(plain.score);
  });

  test("a character after a separator outscores the same character mid-word", () => {
    const afterSeparator = fuzzyScore("c", "git-checkout")!.score;
    const midWord = fuzzyScore("c", "gitxcheckout")!.score;
    expect(afterSeparator).toBeGreaterThan(midWord);
  });

  test("an exact prefix beats a subsequence match elsewhere in the title", () => {
    const prefix = fuzzyScore("fetch", "Fetch all remotes")!.score;
    const inside = fuzzyScore("fetch", "Show fetch")!.score;
    expect(prefix).toBeGreaterThan(inside);
  });

  test("a shorter title beats a longer one with the same prefix match", () => {
    const exact = fuzzyScore("pull", "Pull")!.score;
    const longer = fuzzyScore("pull", "Pull (rebase)")!.score;
    expect(exact).toBeGreaterThan(longer);
  });
});

describe("rankItems", () => {
  test("chk ranks Checkout branch above Cherry-pick", () => {
    expect(titles("chk", ["Cherry-pick commit", "Checkout branch", "Fetch all remotes"]))
      .toEqual(["Checkout branch", "Cherry-pick commit"]);
  });

  test("an exact prefix ranks above a mid-word match", () => {
    expect(titles("fetch", ["Show fetch", "Fetch all remotes"]))
      .toEqual(["Fetch all remotes", "Show fetch"]);
  });

  test("equal scores keep the input order", () => {
    const items = [{ title: "Pull", id: "a" }, { title: "Pull", id: "b" }];
    const ranked = rankItems("pull", items, 10).map((r) => r.item.id);
    expect(ranked).toEqual(["a", "b"]);
  });

  test("drops items that do not match", () => {
    expect(titles("zzz", ["Pull", "Push"])).toEqual([]);
  });

  test("an empty query returns the first items unranked, with no positions", () => {
    const ranked = rankItems("", [{ title: "A" }, { title: "B" }, { title: "C" }], 2);
    expect(ranked.map((r) => r.item.title)).toEqual(["A", "B"]);
    expect(ranked.every((r) => r.positions.length === 0)).toBe(true);
  });

  test("never returns more than the limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ title: `Branch ${i}` }));
    expect(rankItems("branch", many, 5)).toHaveLength(5);
  });
});
