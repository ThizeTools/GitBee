// Drag state for branch drag-and-drop. `refDragSource` is the branch being
// dragged. `dropHoverKey` names the one drop target under the pointer, so only
// that row, badge or sidebar entry paints as the target. The handlers here are
// what the graph and sidebar attach; they open the menu, never run an action.
// Spec: docs/specs/ref-drag-and-drop.md.

import { writable, get } from "svelte/store";
import type { CommitRef } from "$lib/ipc";
import { graph } from "$lib/stores/repo";
import { DropOptionCache, refKey, rowDropTarget, type DragRef } from "$lib/menus/dragOptions";
import { openDropMenu } from "$lib/menus/dragMenus";

export const refDragSource = writable<DragRef | null>(null);
export const dropHoverKey = writable<string | null>(null);

// dragover fires many times a second; the answer for the hovered pair is reused.
const dropCache = new DropOptionCache();

// Attached to the body for the drag and removed at dragend. The browser takes
// the drag image from it, so it must be in the DOM while the drag runs. It sits
// off-screen so the pill is never seen at the window corner.
let dragImageEl: HTMLElement | null = null;

function makeDragImage(name: string): HTMLElement {
  const el = document.createElement("div");
  el.textContent = name;
  el.style.cssText =
    "position:fixed;top:-1000px;left:-1000px;padding:2px 8px;border-radius:3px;" +
    "font:600 11px/18px system-ui,sans-serif;color:#fff;background:#3b82f6;white-space:nowrap;";
  document.body.appendChild(el);
  return el;
}

/** Starts a drag of `ref`: records the source and sets a drag image that shows
 * the branch name. `text/plain` is set because some engines need it to start a drag. */
export function beginRefDrag(e: DragEvent, ref: DragRef): void {
  refDragSource.set(ref);
  dropHoverKey.set(null);
  const dt = e.dataTransfer;
  if (!dt) return;
  dt.effectAllowed = "move";
  dt.setData("text/plain", ref.name);
  dragImageEl?.remove();
  dragImageEl = makeDragImage(ref.name);
  dt.setDragImage(dragImageEl, 0, 0);
}

/** Clears the source and any highlight, and removes the drag image. Runs at
 * dragend, and at drop, so a finished drag never leaves a stale source. */
export function endRefDrag(): void {
  refDragSource.set(null);
  dropHoverKey.set(null);
  dragImageEl?.remove();
  dragImageEl = null;
}

/** Highlights the target `key` while the pointer is over it. */
export function setDropHover(key: string): void {
  dropHoverKey.set(key);
}

/** Clears the highlight only when it still belongs to `key`. A target being
 * left must not clear the one the pointer has just entered. */
export function leaveDropHover(key: string): void {
  dropHoverKey.update((current) => (current === key ? null : current));
}

/** Accepts a drag over a branch target when the pair has a menu, and highlights
 * it. Returns false, and leaves the event unaccepted, otherwise. */
export function dragOverRef(e: DragEvent, key: string, target: DragRef | null): boolean {
  const src = get(refDragSource);
  if (!src || !target || !hasDropOptions(src, target)) return false;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  setDropHover(key);
  return true;
}

/** Opens the option menu for dropping the current source on `target`. */
export function dropOnRef(e: DragEvent, target: DragRef | null): void {
  const src = get(refDragSource);
  endRefDrag();
  if (!src || !target) return;
  e.preventDefault();
  openDropMenu(e, src, target);
}

function headBranchNow(): string | null {
  return get(graph)?.head_branch ?? null;
}

function hasDropOptions(src: DragRef, target: DragRef): boolean {
  const g = get(graph);
  return dropCache.hasOptions(src, target, g?.head_branch ?? null, g ?? null);
}

/** A graph row's drop target is its HEAD-first branch badge (see rowDropTarget). */
export function dragOverRow(e: DragEvent, sha: string, refs: readonly CommitRef[]): void {
  dragOverRef(e, rowDropKey(sha), rowDropTarget(refs, headBranchNow()));
}

export function dropOnRow(e: DragEvent, refs: readonly CommitRef[]): void {
  dropOnRef(e, rowDropTarget(refs, headBranchNow()));
}

// Keys are prefixed by the kind of element, so a graph badge and a sidebar
// entry for the same branch never highlight together.
export function rowDropKey(sha: string): string {
  return `row:${sha}`;
}

export function badgeDropKey(ref: DragRef): string {
  return `badge:${refKey(ref)}`;
}

export function sidebarDropKey(ref: DragRef): string {
  return `sidebar:${refKey(ref)}`;
}
