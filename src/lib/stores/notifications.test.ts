import { describe, test, expect, afterEach } from "bun:test";
import { get } from "svelte/store";
import {
  dismissAll, notices, notify, pauseNotice, resumeNotice, type NoticeKind,
} from "./notifications";

afterEach(() => dismissAll());

function addToast(kind: NoticeKind, ttlMs = 60_000): number {
  return notify({ kind, title: `${kind} toast`, ttlMs });
}

function kindsOnScreen(): NoticeKind[] {
  return get(notices).map((n) => n.kind);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("toast stack limit", () => {
  test("never more than five toasts are visible", () => {
    for (let i = 0; i < 8; i++) addToast("info");
    expect(get(notices).length).toBe(5);
  });
  test("a sixth arrival evicts the oldest non-error toast", () => {
    const first = addToast("info");
    addToast("error");
    addToast("success");
    addToast("warn");
    addToast("info");
    addToast("success");
    const ids = get(notices).map((n) => n.id);
    expect(ids).not.toContain(first);
    expect(kindsOnScreen()).toEqual(["error", "success", "warn", "info", "success"]);
  });
  test("errors survive while a non-error can be evicted", () => {
    addToast("error");
    addToast("error");
    addToast("warn");
    addToast("error");
    addToast("error");
    addToast("info");
    expect(kindsOnScreen()).toEqual(["error", "error", "error", "error", "info"]);
  });
  test("with only errors on screen, the oldest error goes", () => {
    const oldest = addToast("error");
    for (let i = 0; i < 4; i++) addToast("error");
    addToast("error");
    expect(get(notices).map((n) => n.id)).not.toContain(oldest);
    expect(get(notices).length).toBe(5);
  });
  test("an evicted toast's timer is cleared, not left to fire later", () => {
    const first = addToast("info", 20);
    for (let i = 0; i < 5; i++) addToast("error");
    expect(get(notices).map((n) => n.id)).not.toContain(first);
  });
});

describe("hover pause", () => {
  test("pausing marks the toast and freezes its remaining time", () => {
    const id = addToast("info", 60_000);
    pauseNotice(id);
    const n = get(notices).find((x) => x.id === id)!;
    expect(n.runningSince).toBeNull();
    expect(n.remainingMs).toBeLessThanOrEqual(60_000);
    expect(n.remainingMs).toBeGreaterThan(59_000);
  });
  test("pause and resume are idempotent", () => {
    const id = addToast("info");
    pauseNotice(id);
    pauseNotice(id);
    resumeNotice(id);
    resumeNotice(id);
    const n = get(notices).find((x) => x.id === id)!;
    expect(typeof n.runningSince).toBe("number");
  });
  test("a paused toast does not auto-dismiss at its TTL", async () => {
    const id = addToast("info", 30);
    pauseNotice(id);
    await wait(80);
    expect(get(notices).map((n) => n.id)).toContain(id);
  });
  test("resuming lets the toast dismiss after its remaining time", async () => {
    const id = addToast("info", 40);
    pauseNotice(id);
    await wait(60);
    resumeNotice(id);
    await wait(120);
    expect(get(notices).map((n) => n.id)).not.toContain(id);
  });
  test("pausing a dismissed toast is a no-op", () => {
    const id = addToast("info");
    dismissAll();
    expect(() => pauseNotice(id)).not.toThrow();
    expect(get(notices)).toEqual([]);
  });
});
