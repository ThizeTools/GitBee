import { describe, expect, it } from "bun:test";
import { pullNotice } from "./pullNotice";

describe("pullNotice", () => {
  it("reports success when HEAD moved", () => {
    expect(pullNotice({ stash_kept: false }, "main", true)).toEqual({
      kind: "success",
      title: "Pulled Successfully",
    });
  });

  it("reports up-to-date with the branch name when HEAD did not move", () => {
    const n = pullNotice({ stash_kept: false }, "dev", false);
    expect(n.title).toBe("Already Up-to-Date");
    expect(n.message).toContain("origin/dev");
  });

  it("puts a kept stash ahead of success", () => {
    const n = pullNotice({ stash_kept: true }, "main", true);
    expect(n.title).toBe("Pulled, but stash kept");
    expect(n.message).toContain("stash@{0}");
  });
});
