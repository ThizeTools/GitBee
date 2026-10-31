// Pure option builder for dragging one branch onto another. It takes plain
// data and returns the menu entries as data, so bun test can load it without
// Tauri or stores. The menu wiring and execution live in dragMenus.ts.
// Spec: docs/specs/ref-drag-and-drop.md (the option table lives there).

import type { CommitRef, GraphNode } from "$lib/ipc";
import { reachableFrom } from "../graph/reach";
import { findRefSha } from "../stores/refLookup";

/** A branch that can be dragged or dropped on. `name` is what git accepts:
 * a local short name, or `<remote>/<branch>` for a remote-tracking ref. */
export interface DragRef {
  name: string;
  kind: "localbranch" | "remotebranch";
}

export type DragAction =
  | { kind: "merge"; checkout: string | null; from: string }
  | { kind: "rebase"; checkout: string | null; onto: string }
  | { kind: "fast-forward"; branch: string; to: string; head: boolean };

export interface DragOption {
  label: string;
  action: DragAction;
}

/** The loaded graph, as far as the option builder reads it. Nodes are needed
 * for the fast-forward ancestry check, refs for resolving each branch's tip. */
export interface DragGraph {
  refs: readonly CommitRef[];
  nodes: readonly GraphNode[];
}

/** The DragRef a ref badge or sidebar row stands for, or null when the ref
 * cannot be a drag source or target (tags, stashes, `<remote>/HEAD`). */
export function dragRefOf(ref: { name: string; kind: CommitRef["kind"] }): DragRef | null {
  if (ref.kind === "localbranch") return { name: ref.name, kind: "localbranch" };
  if (ref.kind === "remotebranch" && !ref.name.endsWith("/HEAD")) {
    return { name: ref.name, kind: "remotebranch" };
  }
  return null;
}

/** The branch a drop on a graph row lands on: HEAD when the row carries it,
 * else the first local branch, else the first remote one. Null when the row
 * has no branch badge. */
export function rowDropTarget(refs: readonly CommitRef[], headBranch: string | null): DragRef | null {
  const drags = refs
    .map((r) => dragRefOf(r))
    .filter((d): d is DragRef => d !== null);
  return drags.find((d) => d.kind === "localbranch" && d.name === headBranch)
    ?? drags.find((d) => d.kind === "localbranch")
    ?? drags[0]
    ?? null;
}

/** Stable key for one drop target, used to highlight the hovered target. */
export function refKey(ref: DragRef): string {
  return `${ref.kind}:${ref.name}`;
}

function sameRef(a: DragRef, b: DragRef): boolean {
  return a.kind === b.kind && a.name === b.name;
}

/** True when `target` can be fast-forwarded to `src` within the loaded graph:
 * the target's tip is a strict ancestor of the source's tip. Equal tips are
 * excluded because there is nothing to move. Unloaded tips give false. */
export function canFastForward(src: DragRef, target: DragRef, graph: DragGraph): boolean {
  const srcTip = findRefSha(graph.refs, src.kind, src.name);
  const targetTip = findRefSha(graph.refs, target.kind, target.name);
  if (!srcTip || !targetTip || srcTip === targetTip) return false;
  return reachableFrom(srcTip, graph.nodes).has(targetTip);
}

/** Answers "does this pair have a menu?" for the loaded graph. Drag-over fires
 * many times a second and each answer may walk the history, so the last
 * answer is kept while the pair and the graph object stay the same. One entry
 * is enough: a drag has one source and one hovered target at a time.
 * Example: `cache.hasOptions(src, target, head, graph)` */
export class DropOptionCache {
  private key: string | null = null;
  private graph: DragGraph | null = null;
  private answer = false;

  hasOptions(src: DragRef, target: DragRef, headBranch: string | null, graph: DragGraph | null): boolean {
    if (!graph) return false;
    const key = `${refKey(src)}>${refKey(target)}`;
    if (key !== this.key || graph !== this.graph) {
      this.key = key;
      this.graph = graph;
      this.answer = dragOptions(src, target, headBranch, graph).length > 0;
    }
    return this.answer;
  }
}

/** The menu for dropping `src` on `target`. Empty when nothing can happen
 * (same branch, or a remote-to-remote pair), so the caller opens no menu.
 * `graph` supplies the tips and ancestry for the fast-forward option.
 * Example: `dragOptions(local("feat"), local("main"), "main", graph)` */
export function dragOptions(
  src: DragRef,
  target: DragRef,
  headBranch: string | null,
  graph: DragGraph,
): DragOption[] {
  if (sameRef(src, target)) return [];
  const srcIsHead = src.kind === "localbranch" && src.name === headBranch;
  const targetIsHead = target.kind === "localbranch" && target.name === headBranch;
  if (target.kind === "remotebranch") return remoteTargetOptions(src, target, srcIsHead);
  if (targetIsHead) return headTargetOptions(src, target, graph);
  if (srcIsHead) return srcHeadOptions(src, target);
  return neitherHeadOptions(src, target, graph);
}

// Remote targets only offer merges: a remote-tracking ref is never checked out
// by a drop and never fast-forwarded. A merge needs a local branch to land on,
// so a non-HEAD source is checked out first.
function remoteTargetOptions(src: DragRef, target: DragRef, srcIsHead: boolean): DragOption[] {
  if (src.kind === "remotebranch") return [];
  const checkout = srcIsHead ? null : src.name;
  return [{
    label: srcIsHead
      ? `Merge ${target.name} into ${src.name}`
      : `Checkout ${src.name} and merge ${target.name}`,
    action: { kind: "merge", checkout, from: target.name },
  }];
}

// Target is HEAD: the drop changes the checked-out branch, so every option
// works on HEAD. A fast-forward of HEAD is a `merge --ff-only`.
function headTargetOptions(src: DragRef, target: DragRef, graph: DragGraph): DragOption[] {
  const options: DragOption[] = [
    { label: `Merge ${src.name} into ${target.name}`, action: { kind: "merge", checkout: null, from: src.name } },
    { label: `Rebase ${target.name} onto ${src.name}`, action: { kind: "rebase", checkout: null, onto: src.name } },
  ];
  if (canFastForward(src, target, graph)) {
    options.push({
      label: `Fast-forward ${target.name} to ${src.name}`,
      action: { kind: "fast-forward", branch: target.name, to: src.name, head: true },
    });
  }
  return options;
}

// Source is HEAD and the target is another local branch: HEAD is the branch
// that moves, so the options rebase or merge it onto the target.
function srcHeadOptions(src: DragRef, target: DragRef): DragOption[] {
  return [
    { label: `Rebase ${src.name} onto ${target.name}`, action: { kind: "rebase", checkout: null, onto: target.name } },
    { label: `Merge ${target.name} into ${src.name}`, action: { kind: "merge", checkout: null, from: target.name } },
  ];
}

// Neither side is HEAD. The merge and rebase check their source out first.
// Fast-forward and the rebase need a local source; a remote source is only
// merged, because it has no local branch to check out.
function neitherHeadOptions(src: DragRef, target: DragRef, graph: DragGraph): DragOption[] {
  const options: DragOption[] = [
    {
      label: `Checkout ${target.name} and merge ${src.name}`,
      action: { kind: "merge", checkout: target.name, from: src.name },
    },
  ];
  if (src.kind !== "localbranch") return options;
  if (canFastForward(src, target, graph)) {
    options.push({
      label: `Fast-forward ${target.name} to ${src.name}`,
      action: { kind: "fast-forward", branch: target.name, to: src.name, head: false },
    });
  }
  options.push({
    label: `Checkout ${src.name} and rebase onto ${target.name}`,
    action: { kind: "rebase", checkout: src.name, onto: target.name },
  });
  return options;
}
