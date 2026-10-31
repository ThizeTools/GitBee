import { expect, test } from "bun:test";
import { get } from "svelte/store";
import {
  REF_HOVER_DELAY_MS, hoveredRefSha, scheduleRefHover, releaseRefHover, clearRefHover,
  RefHoverClaim, type RefHoverPort,
} from "./refHover";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("highlight arms only after the dwell delay", async () => {
  clearRefHover();
  scheduleRefHover("aaa");
  expect(get(hoveredRefSha)).toBeNull();
  await wait(REF_HOVER_DELAY_MS + 40);
  expect(get(hoveredRefSha)).toBe("aaa");
  clearRefHover();
});

test("leaving before the dwell cancels the pending highlight", async () => {
  clearRefHover();
  scheduleRefHover("bbb");
  releaseRefHover("bbb");
  await wait(REF_HOVER_DELAY_MS + 40);
  expect(get(hoveredRefSha)).toBeNull();
});

test("re-arming replaces the pending sha", async () => {
  clearRefHover();
  scheduleRefHover("old");
  scheduleRefHover("new");
  await wait(REF_HOVER_DELAY_MS + 40);
  expect(get(hoveredRefSha)).toBe("new");
  clearRefHover();
});

test("release from a different badge does not clear this one", async () => {
  clearRefHover();
  scheduleRefHover("keep");
  await wait(REF_HOVER_DELAY_MS + 40);
  releaseRefHover("other");
  expect(get(hoveredRefSha)).toBe("keep");
  clearRefHover();
});

test("clearRefHover clears an armed highlight at once", async () => {
  clearRefHover();
  scheduleRefHover("gone");
  await wait(REF_HOVER_DELAY_MS + 40);
  clearRefHover();
  expect(get(hoveredRefSha)).toBeNull();
});

// Records the calls RefHoverClaim makes instead of touching the real store.
class FakeRefHoverPort implements RefHoverPort {
  readonly calls: string[] = [];
  schedule(sha: string): void { this.calls.push(`schedule:${sha}`); }
  release(sha: string): void { this.calls.push(`release:${sha}`); }
}

test("a claim releases exactly the sha it armed", () => {
  const port = new FakeRefHoverPort();
  const claim = new RefHoverClaim(port);
  claim.arm("abc");
  claim.release();
  expect(port.calls).toEqual(["schedule:abc", "release:abc"]);
});

test("regression: releasing a claim that never armed is a no-op, not a throw", () => {
  const port = new FakeRefHoverPort();
  expect(() => new RefHoverClaim(port).release()).not.toThrow();
  expect(port.calls).toEqual([]);
});

test("a claim releases once even when leave and destroy both fire", () => {
  const port = new FakeRefHoverPort();
  const claim = new RefHoverClaim(port);
  claim.arm("abc");
  claim.release();
  claim.release();
  expect(port.calls).toEqual(["schedule:abc", "release:abc"]);
});
