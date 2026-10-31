import { describe, test, expect } from "bun:test";
import { originGitHubRepo, parseGitHubRepo } from "./url";

describe("parseGitHubRepo", () => {
  test("reads the four URL shapes users paste", () => {
    expect(parseGitHubRepo("git@github.com:acme/app.git")).toEqual({ owner: "acme", name: "app" });
    expect(parseGitHubRepo("ssh://git@github.com/acme/app.git")).toEqual({ owner: "acme", name: "app" });
    expect(parseGitHubRepo("https://github.com/acme/app.git")).toEqual({ owner: "acme", name: "app" });
    expect(parseGitHubRepo("https://github.com/acme/app/")).toEqual({ owner: "acme", name: "app" });
  });

  test("returns null for a host that is not github.com", () => {
    expect(parseGitHubRepo("https://gitlab.com/acme/app.git")).toBeNull();
    expect(parseGitHubRepo("")).toBeNull();
  });
});

describe("originGitHubRepo", () => {
  test("uses the origin remote, ignoring other remotes", () => {
    const remotes = [
      { name: "upstream", url: "https://github.com/other/lib.git" },
      { name: "origin", url: "https://github.com/acme/app.git" },
    ];
    expect(originGitHubRepo(remotes)).toEqual({ owner: "acme", name: "app" });
  });

  test("is null when there is no origin remote", () => {
    expect(originGitHubRepo([{ name: "upstream", url: "https://github.com/a/b.git" }])).toBeNull();
    expect(originGitHubRepo([])).toBeNull();
  });

  test("is null when origin points at a non-GitHub host", () => {
    expect(originGitHubRepo([{ name: "origin", url: "https://gitlab.com/a/b.git" }])).toBeNull();
  });
});
