import { writable } from "svelte/store";
import { ICON_NAMES, type IconName } from "../icons/names";

export interface MenuItem {
  label: string;
  /**
   * Icon for the row, from names.ts ("pull"). Call sites pass IconName only;
   * resolveMenuIcon() still accepts a legacy glyph as a safety net.
   */
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  separator?: boolean;
  onClick?: () => void;
  submenu?: MenuItem[];
}

export interface MenuState {
  open: boolean;
  x: number;
  y: number;
  items: MenuItem[];
}

export const contextMenu = writable<MenuState>({ open: false, x: 0, y: 0, items: [] });

export function openMenu(e: MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  contextMenu.set({ open: true, x: e.clientX, y: e.clientY, items });
}
export function closeMenu() {
  contextMenu.update((s) => ({ ...s, open: false }));
}

/**
 * Legacy glyph -> IconName. Call sites still pass unicode glyphs, so this table
 * keeps them rendering as icons until they move to IconName. A glyph with no
 * close icon (for example "←") is left out on purpose: it renders blank rather
 * than a wrong icon.
 */
export const MENU_GLYPH_ICONS: ReadonlyMap<string, IconName> = new Map<string, IconName>([
  ["↓", "pull"],
  ["↑", "push"],
  ["⇡", "push"],
  ["⇅", "branch"],
  ["⇉", "pull"],
  ["⫶", "merge"],
  ["⇄", "fetch"],
  ["↻", "fetch"],
  ["⤓", "download"],
  ["⤴", "pop"],
  ["↶", "undo"],
  ["↺", "undo"],
  ["⎇", "branch"],
  ["✓", "check"],
  ["✎", "file-modified"],
  ["⧉", "copy"],
  ["⎘", "copy"],
  ["🗑", "trash"],
  ["📌", "pin"],
  ["📂", "folder"],
  ["🏷", "tag"],
  ["⌘", "palette"],
  ["☁", "cloud"],
  ["⊙", "eye"],
  ["◎", "eye"],
  ["○", "eye-off"],
  ["⊘", "eye-off"],
  ["≡", "logs"],
  ["🕮", "history"],
  ["⛶", "stash"],
  ["⎈", "user"],
  ["↗", "external"],
  ["📦", "folder-git"],
  ["🔐", "lock"],
  ["⎋", "lock"],
  ["＋", "add"],
  ["+", "add"],
  ["−", "remove"],
  ["×", "close"],
]);

/** True when `value` is one of the names Icon.svelte can draw. */
export function isIconName(value: string): value is IconName {
  return (ICON_NAMES as readonly string[]).includes(value);
}

/**
 * The icon a menu row draws, or null when it draws none. Accepts an IconName
 * or a legacy glyph, so `resolveMenuIcon("pull")` and `resolveMenuIcon("↓")`
 * both give "pull", and an unknown glyph gives null (renders nothing).
 */
export function resolveMenuIcon(icon: string | undefined): IconName | null {
  if (!icon) return null;
  if (isIconName(icon)) return icon;
  return MENU_GLYPH_ICONS.get(icon) ?? null;
}
