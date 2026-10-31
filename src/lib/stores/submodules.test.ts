import { describe, test, expect } from "bun:test";
import { get } from "svelte/store";
import type { Submodule } from "$lib/ipc";
import { activeDialog, answerDialog } from "$lib/stores/dialog";
import {
  canOpenSubmodule, defaultSubPath, joinRepoPath, openSubmoduleTab, shortSha,
} from "./submodules";

function sub(state: Submodule["state"]): Submodule {
  return { name: "foo", path: "libs/foo", url: "u", branch: null, sha: null, state };
}

describe("shortSha", () => {
  test("keeps the first seven characters", () => {
    expect(shortSha("abcdef0123456789")).toBe("abcdef0");
  });

  test("is empty when the submodule has no sha", () => {
    expect(shortSha(null)).toBe("");
  });
});

describe("joinRepoPath", () => {
  test("uses backslashes for a Windows repo and converts the sub path", () => {
    expect(joinRepoPath("C:\\work\\app", "libs/foo")).toBe("C:\\work\\app\\libs\\foo");
  });

  test("uses slashes for a POSIX repo", () => {
    expect(joinRepoPath("/home/me/app", "libs/foo")).toBe("/home/me/app/libs/foo");
  });

  test("drops a trailing separator on the repo path", () => {
    expect(joinRepoPath("/home/me/app/", "libs/foo")).toBe("/home/me/app/libs/foo");
  });
});

describe("canOpenSubmodule", () => {
  test("refuses only uninitialized submodules", () => {
    expect(canOpenSubmodule(sub("uninitialized"))).toBe(false);
    expect(canOpenSubmodule(sub("clean"))).toBe(true);
    expect(canOpenSubmodule(sub("modified"))).toBe(true);
    expect(canOpenSubmodule(sub("out_of_sync"))).toBe(true);
    expect(canOpenSubmodule(sub("conflict"))).toBe(true);
  });
});

describe("openSubmoduleTab refusal", () => {
  test("an uninitialized submodule gets an Initialize-first alert and no tab", async () => {
    const pending = openSubmoduleTab("C:\\work\\app", sub("uninitialized"));
    const shown = get(activeDialog);
    expect(shown?.view.kind).toBe("alert");
    if (shown?.view.kind !== "alert") throw new Error("expected an alert dialog");
    expect(shown.view.spec.title).toBe("foo is not initialized");
    expect(shown.view.spec.message).toContain("Initialize first");
    answerDialog(undefined);
    await pending;
    expect(get(activeDialog)).toBeNull();
  });
});

describe("defaultSubPath", () => {
  test("takes the last URL segment without .git", () => {
    expect(defaultSubPath("https://x/team/foo.git")).toBe("foo");
  });

  test("handles a trailing slash and a local Windows path", () => {
    expect(defaultSubPath("https://x/team/foo/")).toBe("foo");
    expect(defaultSubPath("C:\\repos\\bar.git")).toBe("bar");
  });
});
