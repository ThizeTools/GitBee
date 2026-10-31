// Colours for the terminal surface. Background, text and accent follow the
// app's active theme through its CSS variables, so the dock matches the rest of
// the window. The ANSI palette is fixed: programs expect those colours to
// keep their meaning across themes.

/** Colour names match xterm's ITheme, so the object is passed through unchanged. */
export interface TerminalColors {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

const ANSI: Omit<TerminalColors, "background" | "foreground" | "cursor" | "selectionBackground"> = {
  black: "#1e1e1e",
  red: "#f14c4c",
  green: "#23d18b",
  yellow: "#f5f543",
  blue: "#3b8eea",
  magenta: "#d670d6",
  cyan: "#29b8db",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff",
};

const FALLBACK: Pick<TerminalColors, "background" | "foreground" | "cursor" | "selectionBackground"> = {
  background: "#0a0a0a",
  foreground: "#f5f5f5",
  cursor: "#f5cc1c",
  selectionBackground: "#3a3a3a",
};

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Builds the terminal palette from the app's CSS variables. `readVar` returns
 * the value of a variable (for example "--bg") or "" when unset. Values that are
 * not hex colours fall back to the built-in defaults, because xterm rejects
 * other formats.
 * Example: readTerminalColors(() => "") → the fallback background #0a0a0a */
export function readTerminalColors(readVar: (name: string) => string): TerminalColors {
  return {
    ...ANSI,
    background: hexOr(readVar("--bg"), FALLBACK.background),
    foreground: hexOr(readVar("--fg"), FALLBACK.foreground),
    cursor: hexOr(readVar("--accent"), FALLBACK.cursor),
    selectionBackground: hexOr(readVar("--border-strong"), FALLBACK.selectionBackground),
  };
}

function hexOr(raw: string, fallback: string): string {
  const value = raw.trim();
  return HEX_COLOR.test(value) ? value : fallback;
}
