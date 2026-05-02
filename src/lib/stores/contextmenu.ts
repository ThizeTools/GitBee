import { writable } from "svelte/store";

export interface MenuItem {
  label: string;
  icon?: string;
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
