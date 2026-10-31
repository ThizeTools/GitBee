import { describe, test, expect } from "bun:test";
import { InFlightGate } from "./inFlightGate";

// A work item the test settles by hand, so each assertion sees a known state.
class ManualWork {
  private resolveFn: () => void = () => {};
  readonly promise: Promise<void>;

  constructor() {
    this.promise = new Promise<void>((resolve) => { this.resolveFn = resolve; });
  }

  settle(): void {
    this.resolveFn();
  }
}

describe("InFlightGate", () => {
  test("is idle before any run and waits without blocking", async () => {
    const gate = new InFlightGate();
    expect(gate.active).toBe(false);
    await gate.wait();
  });

  test("is active while work runs and idle once it settles", async () => {
    const gate = new InFlightGate();
    const work = new ManualWork();
    const run = gate.run(() => work.promise);
    expect(gate.active).toBe(true);
    work.settle();
    await run;
    expect(gate.active).toBe(false);
  });

  test("wait resolves only after the running work settles", async () => {
    const gate = new InFlightGate();
    const work = new ManualWork();
    gate.run(() => work.promise);
    let waited = false;
    const waiting = gate.wait().then(() => { waited = true; });
    await Promise.resolve();
    expect(waited).toBe(false);
    work.settle();
    await waiting;
    expect(waited).toBe(true);
  });

  test("an older run settling does not clear a newer run", async () => {
    const gate = new InFlightGate();
    const first = new ManualWork();
    const second = new ManualWork();
    const firstRun = gate.run(() => first.promise);
    const secondRun = gate.run(() => second.promise);
    first.settle();
    await firstRun;
    expect(gate.active).toBe(true);
    second.settle();
    await secondRun;
    expect(gate.active).toBe(false);
  });
});
