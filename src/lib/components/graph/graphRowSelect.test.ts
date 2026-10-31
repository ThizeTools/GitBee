import { describe, expect, test } from "bun:test";
import { toggleRowSelection, type RowSelectionView, type RowTarget } from "./graphRowSelect";

// Records every call so a test can assert the exact effect sequence.
class RecordingRowView implements RowSelectionView {
  calls: string[] = [];
  select(sha: string | null): void { this.calls.push(`select:${sha}`); }
  showDetails(target: RowTarget): void { this.calls.push(`show:${target.sha}`); }
  clearDetails(): void { this.calls.push("clear"); }
  setPanelCollapsed(collapsed: boolean): void { this.calls.push(`collapsed:${collapsed}`); }
}

const commit: RowTarget = { sha: "abc123", isWip: false, stashIndex: null };

describe("toggleRowSelection", () => {
  test("clicking a new row selects it and opens the panel", () => {
    const view = new RecordingRowView();
    toggleRowSelection(commit, "other", view);
    expect(view.calls).toEqual(["select:abc123", "show:abc123", "collapsed:false"]);
  });

  test("clicking the selected row deselects it and collapses the panel", () => {
    const view = new RecordingRowView();
    toggleRowSelection(commit, "abc123", view);
    expect(view.calls).toEqual(["select:null", "clear", "collapsed:true"]);
  });

  test("with nothing selected, a click selects", () => {
    const view = new RecordingRowView();
    toggleRowSelection({ sha: "__WIP__", isWip: true, stashIndex: null }, null, view);
    expect(view.calls).toEqual(["select:__WIP__", "show:__WIP__", "collapsed:false"]);
  });
});
