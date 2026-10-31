import { describe, test, expect } from "bun:test";
import type { FileLogEntry } from "$lib/ipc";
import { historyMenu, type HistoryActions } from "./historyMenu";

/** Records each call so a test can see which action a menu item ran. */
class RecordingActions implements HistoryActions {
  calls: string[] = [];
  showInGraph(sha: string): void { this.calls.push(`graph:${sha}`); }
  blameAt(path: string, sha: string): void { this.calls.push(`blame:${path}@${sha}`); }
  copySha(sha: string): void { this.calls.push(`copy:${sha}`); }
}

const renamed: FileLogEntry = {
  sha: "abc1234", parents: [], author_name: "Ann", author_email: "a@x",
  timestamp: 1, subject: "rename", path_at_commit: "old/name.txt", status: "R",
};

describe("historyMenu", () => {
  test("offers show in graph, blame at this commit and copy sha, in that order", () => {
    const labels = historyMenu(renamed, new RecordingActions()).map((i) => i.label);
    expect(labels).toEqual(["Show in graph", "Blame at this commit", "Copy sha"]);
  });

  test("each item runs its action with this commit's sha", () => {
    const actions = new RecordingActions();
    const items = historyMenu(renamed, actions);
    items.forEach((item) => item.onClick?.());
    expect(actions.calls).toEqual([
      "graph:abc1234",
      "blame:old/name.txt@abc1234",
      "copy:abc1234",
    ]);
  });
});
