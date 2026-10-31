import { describe, test, expect } from "bun:test";
import {
  HISTORY_LIMIT,
  HistoryStacks,
  redoNewest,
  undoNewest,
  type StepRunner,
  type UndoEntry,
} from "./historyStack";

/** Fake entry: its undo and redo append to `log`, so tests can see order. */
function fakeEntry(label: string, log: string[], withRedo = true): UndoEntry {
  return {
    label,
    undo: async () => { log.push(`undo ${label}`); },
    redo: withRedo ? async () => { log.push(`redo ${label}`); } : undefined,
  };
}

/** Named fake for the step runner. Records "<kind>:<label>" and reports
 * failure, without running the step, for any label in `failing`. */
class FakeStepRunner {
  readonly calls: string[] = [];

  constructor(private readonly failing: readonly string[] = []) {}

  readonly run: StepRunner = async (kind, entry, step) => {
    this.calls.push(`${kind}:${entry.label}`);
    if (this.failing.includes(entry.label)) return false;
    await step();
    return true;
  };
}

describe("HistoryStacks ordering", () => {
  test("takeUndo returns the newest entry first", () => {
    const stacks = new HistoryStacks();
    const log: string[] = [];
    stacks.record(fakeEntry("a", log));
    stacks.record(fakeEntry("b", log));
    expect(stacks.takeUndo()?.label).toBe("b");
    expect(stacks.takeUndo()?.label).toBe("a");
    expect(stacks.takeUndo()).toBeUndefined();
  });

  test("record clears the redo stack", () => {
    const stacks = new HistoryStacks();
    const log: string[] = [];
    stacks.record(fakeEntry("a", log));
    const a = stacks.takeUndo();
    if (a) stacks.fileRedo(a);
    expect(stacks.redoEntries().map((e) => e.label)).toEqual(["a"]);
    stacks.record(fakeEntry("b", log));
    expect(stacks.redoEntries()).toEqual([]);
  });

  test("the stack is capped at HISTORY_LIMIT and drops the oldest entry", () => {
    const stacks = new HistoryStacks();
    const log: string[] = [];
    for (let i = 0; i <= HISTORY_LIMIT; i++) stacks.record(fakeEntry(`e${i}`, log));
    const labels = stacks.undoEntries().map((e) => e.label);
    expect(labels.length).toBe(HISTORY_LIMIT);
    expect(labels[0]).toBe("e1");
    expect(labels[labels.length - 1]).toBe(`e${HISTORY_LIMIT}`);
  });

  test("undoEntries returns a copy, so callers cannot reorder the stack", () => {
    const stacks = new HistoryStacks();
    stacks.record(fakeEntry("a", []));
    stacks.undoEntries().pop();
    expect(stacks.undoEntries().length).toBe(1);
  });
});

describe("undoNewest", () => {
  test("runs undo and files a redoable entry onto the redo stack", async () => {
    const stacks = new HistoryStacks();
    const log: string[] = [];
    const runner = new FakeStepRunner();
    stacks.record(fakeEntry("commit", log));
    const ok = await undoNewest(stacks, runner.run);
    expect(ok).toBe(true);
    expect(log).toEqual(["undo commit"]);
    expect(runner.calls).toEqual(["Undo:commit"]);
    expect(stacks.redoEntries().map((e) => e.label)).toEqual(["commit"]);
    expect(stacks.undoEntries()).toEqual([]);
  });

  test("an entry without redo is undone but cannot be redone", async () => {
    const stacks = new HistoryStacks();
    stacks.record(fakeEntry("one-way", [], false));
    expect(await undoNewest(stacks, new FakeStepRunner().run)).toBe(true);
    expect(stacks.redoEntries()).toEqual([]);
  });

  test("a failed undo is dropped: not redoable and not back on the undo stack", async () => {
    const stacks = new HistoryStacks();
    const runner = new FakeStepRunner(["broken"]);
    stacks.record(fakeEntry("broken", []));
    expect(await undoNewest(stacks, runner.run)).toBe(false);
    expect(stacks.undoEntries()).toEqual([]);
    expect(stacks.redoEntries()).toEqual([]);
  });

  test("with nothing to undo it returns false and runs no step", async () => {
    const runner = new FakeStepRunner();
    expect(await undoNewest(new HistoryStacks(), runner.run)).toBe(false);
    expect(runner.calls).toEqual([]);
  });

  test("undoes the newest entry and leaves older ones in place", async () => {
    const stacks = new HistoryStacks();
    const log: string[] = [];
    stacks.record(fakeEntry("older", log));
    stacks.record(fakeEntry("newer", log));
    await undoNewest(stacks, new FakeStepRunner().run);
    expect(log).toEqual(["undo newer"]);
    expect(stacks.undoEntries().map((e) => e.label)).toEqual(["older"]);
  });
});

describe("redoNewest", () => {
  test("runs redo and files the entry back onto the undo stack", async () => {
    const stacks = new HistoryStacks();
    const log: string[] = [];
    stacks.record(fakeEntry("commit", log));
    await undoNewest(stacks, new FakeStepRunner().run);
    const runner = new FakeStepRunner();
    expect(await redoNewest(stacks, runner.run)).toBe(true);
    expect(log).toEqual(["undo commit", "redo commit"]);
    expect(runner.calls).toEqual(["Redo:commit"]);
    expect(stacks.undoEntries().map((e) => e.label)).toEqual(["commit"]);
    expect(stacks.redoEntries()).toEqual([]);
  });

  test("a failed redo is dropped, not put back on either stack", async () => {
    const stacks = new HistoryStacks();
    stacks.record(fakeEntry("flaky", []));
    await undoNewest(stacks, new FakeStepRunner().run);
    expect(await redoNewest(stacks, new FakeStepRunner(["flaky"]).run)).toBe(false);
    expect(stacks.undoEntries()).toEqual([]);
    expect(stacks.redoEntries()).toEqual([]);
  });

  test("with nothing to redo it returns false and runs no step", async () => {
    const runner = new FakeStepRunner();
    expect(await redoNewest(new HistoryStacks(), runner.run)).toBe(false);
    expect(runner.calls).toEqual([]);
  });

  test("a successful redo keeps the other redoable entries", async () => {
    const stacks = new HistoryStacks();
    const log: string[] = [];
    stacks.record(fakeEntry("first", log));
    stacks.record(fakeEntry("second", log));
    await undoNewest(stacks, new FakeStepRunner().run);
    await undoNewest(stacks, new FakeStepRunner().run);
    await redoNewest(stacks, new FakeStepRunner().run);
    expect(stacks.redoEntries().map((e) => e.label)).toEqual(["second"]);
    expect(stacks.undoEntries().map((e) => e.label)).toEqual(["first"]);
  });
});
