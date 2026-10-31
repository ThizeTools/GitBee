import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { graphScrollTarget } from "$lib/stores/graphscroll";
import { rightSelection } from "$lib/stores/rightpanel";
import { BUILTIN_THEMES } from "$lib/stores/ui";
import { makeSources } from "$lib/palette/testSources";
import { actionItems } from "$lib/palette/providers/actions";
import { branchItems, splitRemoteName } from "$lib/palette/providers/branches";
import { commitItems, goToCommit } from "$lib/palette/providers/commits";
import { fileItems } from "$lib/palette/providers/files";
import { repoBasename, repoItems } from "$lib/palette/providers/repos";
import { themeItems } from "$lib/palette/providers/themes";
import { columnItems, panelItems, viewActionItems } from "$lib/palette/providers/actionsView";

const SHA = "abc1234def5678abc1234def5678abc1234def56";

describe("repoBasename", () => {
  test("takes the last segment of a Windows path", () => {
    expect(repoBasename("C:\\work\\GitBee\\")).toBe("GitBee");
  });

  test("takes the last segment of a POSIX path", () => {
    expect(repoBasename("/home/me/app")).toBe("app");
  });

  test("a bare name is its own basename", () => {
    expect(repoBasename("solo")).toBe("solo");
  });
});

describe("repoItems", () => {
  test("titles each recent repo Open <name> and keeps the full path as subtitle", () => {
    const [row] = repoItems(["/work/GitBee"]);
    expect(row.title).toBe("Open GitBee");
    expect(row.subtitle).toBe("/work/GitBee");
    expect(row.category).toBe("Repo");
    expect(row.id).toBe("repo:/work/GitBee");
  });
});

describe("splitRemoteName", () => {
  test("splits at the first slash, so branch names may contain slashes", () => {
    expect(splitRemoteName("origin/feature/x")).toEqual({ remote: "origin", branch: "feature/x" });
  });

  test("a name without a remote part is rejected", () => {
    expect(splitRemoteName("main")).toBeNull();
    expect(splitRemoteName("/x")).toBeNull();
  });
});

describe("branchItems", () => {
  test("local branches read Checkout <name> and carry the local id", () => {
    const [row] = branchItems([{ name: "main", kind: "local" }]);
    expect(row.title).toBe("Checkout main");
    expect(row.subtitle).toBe("local branch");
    expect(row.id).toBe("branch:main");
    expect(row.category).toBe("Branch");
  });

  test("remote branches read Checkout <remote>/<branch>", () => {
    const [row] = branchItems([{ name: "origin/dev", kind: "remote" }]);
    expect(row.title).toBe("Checkout origin/dev");
    expect(row.subtitle).toBe("remote branch");
    expect(row.id).toBe("remote:origin/dev");
  });

  test("a remote name without a slash produces no row", () => {
    expect(branchItems([{ name: "weird", kind: "remote" }])).toEqual([]);
  });
});

describe("fileItems", () => {
  test("gives a History and a Blame row for each file", () => {
    const rows = fileItems(["a.ts"]);
    expect(rows.map((r) => r.title)).toEqual(["History: a.ts", "Blame: a.ts"]);
    expect(rows.map((r) => r.id)).toEqual(["file-history:a.ts", "file-blame:a.ts"]);
    expect(rows.every((r) => r.category === "File")).toBe(true);
  });
});

describe("themeItems", () => {
  test("titles each theme Theme: <name> and marks only the active one", () => {
    const picked = BUILTIN_THEMES.filter((t) => t.id === "dark" || t.id === "nord");
    const rows = themeItems(picked, "nord");
    expect(rows.map((r) => r.title)).toEqual(["Theme: Hive (default)", "Theme: Nord"]);
    expect(rows.map((r) => r.subtitle)).toEqual([undefined, "active"]);
  });
});

describe("commitItems", () => {
  const commits = makeSources().commits;

  test("a plain word lists every commit with a short sha and its subject", () => {
    const rows = commitItems("", commits);
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe("Go to commit abc1234 Add checkout");
    expect(rows[0].id).toBe(`commit:${SHA}`);
  });

  test("a sha-looking text keeps only commits whose sha starts with it", () => {
    expect(commitItems("1234", commits).map((r) => r.id)).toEqual([`commit:1234fedcba4321fedcba4321fedcba4321fedcba`]);
  });

  test("going to a commit selects it and asks the graph to scroll to it", () => {
    goToCommit(SHA);
    expect(get(graphScrollTarget)).toBe(SHA);
    expect(get(rightSelection)).toEqual({ kind: "commit", sha: SHA });
  });
});

describe("actionItems", () => {
  test("with no repo open, repo-bound actions are not offered", () => {
    const titles = actionItems(makeSources({ repoOpen: false })).map((a) => a.title);
    expect(titles).not.toContain("Fetch all remotes");
    expect(titles).not.toContain("Push");
    expect(titles).toContain("Toggle light/dark");
  });

  test("with a repo open, the repo actions are offered with stable ids", () => {
    const ids = actionItems(makeSources()).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining([
      "action:fetch", "action:pull", "action:pull-rebase", "action:push",
      "action:stash-create", "action:stash-pop", "action:branch-create",
    ]));
  });

  test("every action is in the Action category", () => {
    expect(actionItems(makeSources()).every((a) => a.category === "Action")).toBe(true);
  });
});

describe("viewActionItems", () => {
  test("undo and redo subtitles show the label of the next entry, or a fallback", () => {
    const rows = viewActionItems(makeSources({ undoLabel: "Checkout main", redoLabel: null }));
    expect(rows.find((r) => r.id === "action:undo")?.subtitle).toBe("Checkout main");
    expect(rows.find((r) => r.id === "action:redo")?.subtitle).toBe("Nothing to redo");
  });
});

describe("panelItems", () => {
  test("wording follows the current state: Show while collapsed, Hide while open", () => {
    const open = panelItems({ sidebarCollapsed: false, rightPanelCollapsed: true, dimMergeCommits: false, hiddenCols: [] });
    expect(open.find((r) => r.id === "action:toggle-sidebar")?.title).toBe("Hide sidebar");
    expect(open.find((r) => r.id === "action:toggle-right-panel")?.title).toBe("Show right panel");
  });

  test("the dim-merge row's subtitle shows the current state", () => {
    const on = panelItems({ sidebarCollapsed: false, rightPanelCollapsed: false, dimMergeCommits: true, hiddenCols: [] });
    expect(on.find((r) => r.id === "action:toggle-dim-merges")?.subtitle).toBe("on");
  });
});

describe("columnItems", () => {
  test("graph and message are locked, so they get no show/hide row", () => {
    const titles = columnItems([]).map((r) => r.title);
    expect(titles.some((t) => t.includes("Graph") || t.includes("Message"))).toBe(false);
  });

  test("a hidden column offers Show, a visible one offers Hide", () => {
    const rows = columnItems(["sha"]);
    expect(rows.find((r) => r.id === "action:column-sha")?.title).toBe("Show column: SHA");
    expect(rows.find((r) => r.id === "action:column-author")?.title).toBe("Hide column: Author");
  });
});
