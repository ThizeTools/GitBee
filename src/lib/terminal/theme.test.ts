import { describe, test, expect } from "bun:test";
import { readTerminalColors } from "./theme";

/** A CSS variable reader backed by a plain map, as the app would see it. */
function varsFrom(values: Record<string, string>): (name: string) => string {
  return (name) => values[name] ?? "";
}

describe("readTerminalColors", () => {
  test("takes background, text, cursor and selection from the theme variables", () => {
    const colors = readTerminalColors(varsFrom({
      "--bg": "#101010", "--fg": "#fafafa", "--accent": "#f5cc1c", "--border-strong": "#333333",
    }));
    expect(colors.background).toBe("#101010");
    expect(colors.foreground).toBe("#fafafa");
    expect(colors.cursor).toBe("#f5cc1c");
    expect(colors.selectionBackground).toBe("#333333");
  });

  test("falls back to defaults when a variable is unset", () => {
    const colors = readTerminalColors(varsFrom({}));
    expect(colors.background).toBe("#0a0a0a");
    expect(colors.foreground).toBe("#f5f5f5");
  });

  test("falls back when a variable is not a hex colour xterm can parse", () => {
    const colors = readTerminalColors(varsFrom({ "--bg": "rgb(10, 10, 10)" }));
    expect(colors.background).toBe("#0a0a0a");
  });

  test("keeps the ANSI palette fixed regardless of the theme", () => {
    const dark = readTerminalColors(varsFrom({ "--bg": "#000000" }));
    const light = readTerminalColors(varsFrom({ "--bg": "#ffffff" }));
    expect(dark.red).toBe(light.red);
    expect(dark.brightWhite).toBe("#ffffff");
  });
});
