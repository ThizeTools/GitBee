// OS detection for the frontend. The WebView reports the host OS through
// `navigator.platform` ("Win32", "MacIntel", "Linux x86_64"); the UA string is
// only a fallback for engines that leave platform empty. See
// docs/specs/macos-support.md.

/** Snapshot of the navigator fields we read, so tests can inject fakes. */
export type NavigatorPlatformInfo = { platform?: string; userAgent?: string };

function platformString(nav: NavigatorPlatformInfo | undefined): string {
  if (!nav) return "";
  return nav.platform || nav.userAgent || "";
}

function currentNavigator(): NavigatorPlatformInfo | undefined {
  return typeof navigator === "undefined" ? undefined : navigator;
}

/**
 * True when running on Windows.
 * Usage: `if (isWindows()) writeTerminal("echo %CD%")`
 */
export function isWindows(nav = currentNavigator()): boolean {
  // `^win` and not `/win/`: "Darwin" in a UA fallback would otherwise match.
  return /^win/i.test(platformString(nav)) || /windows/i.test(nav?.userAgent ?? "");
}

/**
 * True when running on macOS.
 * Usage: `if (isMacOS()) return; // no macOS update channel`
 */
export function isMacOS(nav = currentNavigator()): boolean {
  return /mac/i.test(platformString(nav));
}
