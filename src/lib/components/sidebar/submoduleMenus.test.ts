import { describe, test, expect } from "bun:test";
import type { Submodule } from "$lib/ipc";
import type { MenuItem } from "$lib/stores/contextmenu";
import { submoduleHeaderMenu, submoduleMenu } from "./submoduleMenus";

const sub: Submodule = {
  name: "foo", path: "libs/foo", url: "https://x/foo.git", branch: null, sha: null, state: "clean",
};

/** Labels of the actionable items, in order; separators have no label. */
function labels(items: MenuItem[]): string[] {
  return items.filter((i) => !i.separator).map((i) => i.label);
}

describe("submoduleMenu", () => {
  test("row menu lists update, sync, open and copy in order", () => {
    expect(labels(submoduleMenu("C:\\work\\app", sub))).toEqual([
      "Update", "Update (init)", "Sync URLs", "Open in new tab", "Open folder", "Copy path",
    ]);
  });
});

describe("submoduleHeaderMenu", () => {
  test("header menu offers update-all and add", () => {
    expect(labels(submoduleHeaderMenu("C:\\work\\app"))).toEqual([
      "Update all (init, recursive)", "Add submodule…",
    ]);
  });
});
