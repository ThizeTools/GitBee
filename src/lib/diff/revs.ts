/**
 * Where one side of a diff comes from. `worktree` reads the file on disk; `rev`
 * is a git revision that file_bytes_base64 resolves (`INDEX` is the staged blob).
 */
export type RevSide = { kind: "worktree" } | { kind: "rev"; rev: string };

export interface ImageRevs { old: RevSide; new: RevSide; }

const WORKTREE: RevSide = { kind: "worktree" };

function rev(value: string): RevSide {
  return { kind: "rev", rev: value };
}

/** Argument for ipc.fileBytesBase64: null means the working tree. */
export function revArg(side: RevSide): string | null {
  return side.kind === "rev" ? side.rev : null;
}

/** Unstaged change: old = index, new = working tree. */
export function unstagedRevs(): ImageRevs {
  return { old: rev("INDEX"), new: WORKTREE };
}

/** Staged change: old = HEAD, new = index. */
export function stagedRevs(): ImageRevs {
  return { old: rev("HEAD"), new: rev("INDEX") };
}

/** Commit change: the commit's first parent against the commit. */
export function commitRevs(sha: string): ImageRevs {
  return { old: rev(`${sha}^`), new: rev(sha) };
}

/** Stash entry: the stash's base commit against the stash commit. */
export function stashRevs(index: number): ImageRevs {
  return { old: rev(`stash@{${index}}^`), new: rev(`stash@{${index}}`) };
}
