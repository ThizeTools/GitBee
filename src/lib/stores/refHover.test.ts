import { expect, test } from "bun:test";
import { get } from "svelte/store";
import {
  REF_HOVER_DELAY_MS, hoveredRefSha, scheduleRefHover, releaseRefHover, clearRefHover,
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
