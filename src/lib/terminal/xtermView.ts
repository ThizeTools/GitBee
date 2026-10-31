// Thin project-owned wrapper over xterm.js. Only this file imports @xterm/*;
// the rest of the app talks to XtermView. Replacing the emulator changes this
// file alone. See docs/specs/embedded-terminal.md.

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { terminalKeyRoute } from "./keys";
import type { TerminalColors } from "./theme";

/** What the terminal needs from its emulator. */
export interface XtermView {
  /** Shows program output. */
  write(data: string): void;
  /** Registers the callback for keyboard input and pasted text. */
  onData(callback: (data: string) => void): void;
  /** Resizes the grid to fill the host. Null while the host has no size (hidden dock). */
  fit(): { cols: number; rows: number } | null;
  focus(): void;
  getSelection(): string;
  paste(text: string): void;
  setColors(colors: TerminalColors): void;
  dispose(): void;
}

export interface XtermViewOptions {
  colors: TerminalColors;
  /** Called for Ctrl+Shift+C ("copy") and Ctrl+Shift+V ("paste"). */
  onClipboard: (action: "copy" | "paste") => void;
}

const FONT_FAMILY = '"Cascadia Code", Consolas, monospace';
const FONT_SIZE_PX = 12;
const SCROLLBACK_LINES = 5000;

/** Creates an emulator inside `host` and wires the key routing. Example:
 * createXtermView(div, { colors, onClipboard: (a) => console.log(a) }).fit() */
export function createXtermView(host: HTMLElement, options: XtermViewOptions): XtermView {
  const term = new Terminal({
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE_PX,
    cursorBlink: true,
    scrollback: SCROLLBACK_LINES,
    theme: options.colors,
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(host);
  term.attachCustomKeyEventHandler((e) => routeKeydown(e, options.onClipboard));

  return {
    write: (data) => term.write(data),
    onData: (callback) => {
      term.onData(callback);
    },
    fit: () => fitToHost(host, term, fitAddon),
    focus: () => term.focus(),
    getSelection: () => term.getSelection(),
    paste: (text) => term.paste(text),
    setColors: (colors) => {
      term.options.theme = colors;
    },
    dispose: () => term.dispose(),
  };
}

/** Lets xterm handle a key only when it is a shell key. For the app's keys,
 * `preventDefault` stops the browser from also typing the character, and xterm
 * is told to skip the key so it is not sent to the shell. */
function routeKeydown(
  e: KeyboardEvent,
  onClipboard: (action: "copy" | "paste") => void,
): boolean {
  if (e.type !== "keydown") return true;
  const route = terminalKeyRoute(e);
  if (route === "shell") return true;
  e.preventDefault();
  if (route === "copy" || route === "paste") onClipboard(route);
  return false;
}

/** Fits the grid to the host. A hidden host (display: none) reports zero size, and
 * the addon would then propose a 2x1 grid, so the zero check comes first. */
function fitToHost(
  host: HTMLElement,
  term: Terminal,
  fitAddon: FitAddon,
): { cols: number; rows: number } | null {
  if (host.clientWidth === 0 || host.clientHeight === 0) return null;
  if (fitAddon.proposeDimensions() === undefined) return null;
  fitAddon.fit();
  return { cols: term.cols, rows: term.rows };
}
