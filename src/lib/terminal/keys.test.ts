import { describe, test, expect } from "bun:test";
import { isEditableTarget } from "../stores/graphKeys";
import { isBacktick, isTerminalTarget, terminalKeyRoute, type TerminalKeyEvent } from "./keys";

/** Builds a keydown with every modifier off unless overridden. */
function keyEvent(over: Partial<TerminalKeyEvent>): TerminalKeyEvent {
  return { key: "", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...over };
}

describe("terminalKeyRoute", () => {
  test("Ctrl+Shift+C copies and Ctrl+Shift+V pastes", () => {
    expect(terminalKeyRoute(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }))).toBe("copy");
    expect(terminalKeyRoute(keyEvent({ key: "v", ctrlKey: true, shiftKey: true }))).toBe("paste");
  });

  test("plain Ctrl+C stays with the shell so it can send SIGINT", () => {
    expect(terminalKeyRoute(keyEvent({ key: "c", ctrlKey: true }))).toBe("shell");
  });

  test("Ctrl+` and Ctrl+Shift+` belong to the app", () => {
    expect(terminalKeyRoute(keyEvent({ key: "`", ctrlKey: true }))).toBe("app");
    expect(terminalKeyRoute(keyEvent({ key: "~", ctrlKey: true, shiftKey: true }))).toBe("app");
  });

  test("Alt or Meta combinations never take the clipboard route", () => {
    expect(terminalKeyRoute(keyEvent({ key: "c", ctrlKey: true, shiftKey: true, altKey: true }))).toBe("shell");
    expect(terminalKeyRoute(keyEvent({ key: "v", ctrlKey: true, shiftKey: true, metaKey: true }))).toBe("shell");
  });

  test("ordinary keys go to the shell", () => {
    expect(terminalKeyRoute(keyEvent({ key: "a" }))).toBe("shell");
    expect(terminalKeyRoute(keyEvent({ key: "ArrowUp" }))).toBe("shell");
  });
});

describe("isBacktick", () => {
  test("matches the key, its shifted form, and the physical code", () => {
    expect(isBacktick({ key: "`" })).toBe(true);
    expect(isBacktick({ key: "~" })).toBe(true);
    expect(isBacktick({ key: "Dead", code: "Backquote" })).toBe(true);
    expect(isBacktick({ key: "a", code: "KeyA" })).toBe(false);
  });
});

describe("isTerminalTarget", () => {
  test("is true inside a terminal surface", () => {
    const inside = { closest: (sel: string) => (sel === ".terminal-surface" ? {} : null) };
    expect(isTerminalTarget(inside)).toBe(true);
  });

  test("is false elsewhere and for missing targets", () => {
    expect(isTerminalTarget({ closest: () => null })).toBe(false);
    expect(isTerminalTarget(null)).toBe(false);
    expect(isTerminalTarget({})).toBe(false);
  });
});

describe("terminal focus and graph keys", () => {
  test("the xterm helper textarea is editable, so graph keys (h, arrows, Home) do not fire", () => {
    // xterm types into a hidden <textarea>; isEditableTarget must treat it as text input.
    expect(isEditableTarget({ tagName: "TEXTAREA" })).toBe(true);
  });
});
