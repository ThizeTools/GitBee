import { describe, test, expect } from "bun:test";
import {
  applyProgressEvent,
  clearFinished,
  pickProgressForRepo,
  progressFraction,
  progressLabel,
  type GitProgressEvent,
  type ProgressMap,
  type RepoProgress,
} from "./gitProgress";

function ev(over: Partial<GitProgressEvent> & Pick<GitProgressEvent, "op">): GitProgressEvent {
  return { repo: "/r", phase: null, percent: null, done: false, ...over };
}

const PUSH_45: RepoProgress = { op: "push", phase: "Writing objects", percent: 45, done: false };

describe("applyProgressEvent", () => {
  test("a progress event creates or replaces the repo entry", () => {
    const map = applyProgressEvent({}, ev({ op: "push", phase: "Writing objects", percent: 45 }));
    expect(map["/r"]).toEqual(PUSH_45);
  });

  test("a newer op replaces the entry of an older one in the same repo", () => {
    const map = applyProgressEvent({ "/r": PUSH_45 }, ev({ op: "fetch", phase: "Receiving objects", percent: 3 }));
    expect(map["/r"].op).toBe("fetch");
  });

  test("a done event marks the shown op as done and keeps its last phase", () => {
    const map = applyProgressEvent({ "/r": PUSH_45 }, ev({ op: "push", done: true }));
    expect(map["/r"]).toEqual({ ...PUSH_45, done: true });
  });

  test("a done event for another op leaves the shown op untouched", () => {
    const before: ProgressMap = { "/r": PUSH_45 };
    const after = applyProgressEvent(before, ev({ op: "fetch", done: true }));
    expect(after).toBe(before);
  });

  test("a done event for a repo with no entry is ignored", () => {
    const before: ProgressMap = {};
    expect(applyProgressEvent(before, ev({ op: "push", done: true }))).toBe(before);
  });
});

describe("clearFinished", () => {
  test("removes a finished entry of the same op", () => {
    const done: ProgressMap = { "/r": { ...PUSH_45, done: true } };
    expect(clearFinished(done, "/r", "push")).toEqual({});
  });

  test("keeps an entry that is still running", () => {
    const running: ProgressMap = { "/r": PUSH_45 };
    expect(clearFinished(running, "/r", "push")).toBe(running);
  });

  test("keeps a finished entry that belongs to a different op", () => {
    const done: ProgressMap = { "/r": { ...PUSH_45, done: true } };
    expect(clearFinished(done, "/r", "fetch")).toBe(done);
  });
});

describe("pickProgressForRepo", () => {
  test("returns the entry for the current repo", () => {
    expect(pickProgressForRepo({ "/r": PUSH_45 }, "/r")).toEqual(PUSH_45);
  });

  test("falls back to a clone in progress when the current repo has none", () => {
    const clone: RepoProgress = { op: "clone", phase: "Receiving objects", percent: 10, done: false };
    expect(pickProgressForRepo({ "/target": clone }, "/other")).toEqual(clone);
  });

  test("returns null when nothing is running for the repo or as a clone", () => {
    expect(pickProgressForRepo({ "/r": PUSH_45 }, "/other")).toBeNull();
    expect(pickProgressForRepo({}, null)).toBeNull();
  });
});

describe("progressLabel", () => {
  test("names the op, the phase and the percent", () => {
    expect(progressLabel(PUSH_45)).toBe("Pushing… Writing objects 45%");
  });

  test("omits the phase and percent until git reports them", () => {
    expect(progressLabel({ op: "pull", phase: null, percent: null, done: false })).toBe("Pulling…");
    expect(progressLabel({ op: "fetch", phase: "Counting objects", percent: null, done: false }))
      .toBe("Fetching… Counting objects");
  });

  test("shows a finished label for each op", () => {
    expect(progressLabel({ ...PUSH_45, done: true })).toBe("Push finished");
    expect(progressLabel({ op: "clone", phase: null, percent: null, done: true })).toBe("Clone finished");
  });
});

describe("progressFraction", () => {
  test("is the percent as a fraction, null when unknown, and 1 when done", () => {
    expect(progressFraction(PUSH_45)).toBeCloseTo(0.45);
    expect(progressFraction({ op: "push", phase: null, percent: null, done: false })).toBeNull();
    expect(progressFraction({ ...PUSH_45, done: true })).toBe(1);
  });
});
