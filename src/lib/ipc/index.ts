import { invoke } from "@tauri-apps/api/core";
import type { RebaseItem, RebaseOutcome } from "$lib/rebase/types";

export interface OpenedRepo { id: number; path: string; }
export interface RecentRepoDto { id: number; path: string; last_opened: number; }

export interface GraphNode {
  sha: string;
  parents: string[];
  author_name: string;
  author_email: string;
  timestamp: number;
  subject: string;
  lane: number;
  row: number;
  parent_lanes: number[];
}

export type RefKind = "localbranch" | "remotebranch" | "tag" | "stash" | "head";
export interface CommitRef { name: string; kind: RefKind; target_sha: string; }

export interface GraphPage {
  nodes: GraphNode[];
  refs: CommitRef[];
  head_sha: string | null;
  head_branch: string | null;
  // Hash of the inputs that decide the graph; pass it back as known_fingerprint.
  fingerprint: string;
  // True when known_fingerprint matched: nodes and refs are empty, keep the old graph.
  unchanged: boolean;
  // git log returned `limit` commits, so older commits may exist.
  has_more: boolean;
}

export type FileStatus =
  | "modified" | "added" | "deleted" | "renamed" | "copied"
  | "untracked" | "ignored" | "conflicted" | "unmodified";

export interface StatusEntry {
  path: string;
  orig_path: string | null;
  index: FileStatus;
  worktree: FileStatus;
  conflicted: boolean;
}

export type LineKind = "context" | "add" | "del" | "nonewline";
export interface DiffLine {
  kind: LineKind;
  content: string;
  old_no: number | null;
  new_no: number | null;
}
export interface Hunk {
  header: string;
  old_start: number; old_lines: number;
  new_start: number; new_lines: number;
  lines: DiffLine[];
}
export interface FileDiff {
  old_path: string;
  new_path: string;
  hunks: Hunk[];
  binary: boolean;
  // Lines past the backend cap (MAX_FILE_DIFF_LINES), not sent to the viewer.
  omitted_lines: number;
}
// One file of a commit with its counts, no diff text. Merges list against
// the first parent. See docs/specs/commit-details.md.
export interface CommitFileStat {
  path: string;
  old_path: string | null;
  // First letter of git's status: A M D R C T.
  status: string;
  // Both null for a binary file.
  additions: number | null;
  deletions: number | null;
}
export interface CommitStat { sha: string; files: number; additions: number; deletions: number; }
/** Image bytes for the diff viewer: base64 payload plus the MIME type the backend chose. */
export interface FileBytes { base64: string; mime: string; }

/** One commit that touched a file. `path_at_commit` is the file's name in that commit. */
export interface FileLogEntry {
  sha: string; parents: string[]; author_name: string; author_email: string;
  timestamp: number; subject: string; path_at_commit: string; status: string;
}
/** One blamed line. `final_line` is 1-based in the file being blamed. */
export interface BlameLine { sha: string; orig_line: number; final_line: number; content: string; }
/** Metadata of a commit that owns blamed lines. `author_time` is seconds since the epoch. */
export interface BlameCommit {
  author_name: string; author_email: string; author_time: number; summary: string;
}
export interface BlameResult { lines: BlameLine[]; commits: Record<string, BlameCommit>; }

export interface StashEntry { index: number; message: string; sha: string; }
export interface Remote { name: string; url: string; }
export interface Worktree {
  path: string; branch: string | null; head: string; bare: boolean; locked: boolean;
}
export interface OperationState {
  merging: boolean;
  rebasing: boolean;
  cherry_picking: boolean;
  reverting: boolean;
}

export const ipc = {
  // repo
  repoOpen: (path: string) => invoke<OpenedRepo>("repo_open", { path }),
  repoRecent: (limit?: number) => invoke<RecentRepoDto[]>("repo_recent", { limit }),
  repoForget: (path: string) => invoke("repo_forget", { path }),

  // graph
  graphLoad: (path: string, limit = 2000, knownFingerprint: string | null = null, allBranches = true) =>
    invoke<GraphPage>("graph_load", {
      opts: { path, limit, all_branches: allBranches, known_fingerprint: knownFingerprint },
    }),

  // branches
  branchCreate: (path: string, name: string, startPoint?: string) =>
    invoke("branch_create", { path, name, startPoint }),
  branchCheckout: (path: string, name: string) => invoke("branch_checkout", { path, name }),
  branchDelete: (path: string, name: string, force = false) =>
    invoke("branch_delete", { path, name, force }),
  branchRename: (path: string, oldName: string, newName: string) =>
    invoke("branch_rename", { path, old: oldName, new: newName }),
  branchMerge: (path: string, from: string, noFf = false) =>
    invoke("branch_merge", { path, from, noFf }),
  branchRebase: (path: string, onto: string) => invoke("branch_rebase", { path, onto }),
  checkoutSha: (path: string, sha: string) => invoke("checkout_sha", { path, sha }),
  branchSetUpstream: (
    path: string, branch: string, remote?: string, remoteBranch?: string,
  ) => invoke("branch_set_upstream", { path, branch, remote, remoteBranch }),
  // Drag-and-drop fast-forwards: `from` is fast-forwarded into the checked-out branch;
  // `src` moves local branch `target` forward without a checkout.
  branchMergeFfOnly: (path: string, from: string) =>
    invoke("branch_merge_ff_only", { path, from }),
  branchFastForwardLocal: (path: string, src: string, target: string) =>
    invoke("branch_fast_forward_local", { path, src, target }),

  // staging
  statusLoad: (path: string) => invoke<StatusEntry[]>("status_load", { path }),
  stageFile: (path: string, file: string) => invoke("stage_file", { path, file }),
  unstageFile: (path: string, file: string) => invoke("unstage_file", { path, file }),
  stageFiles: (path: string, files: string[]) => invoke("stage_files", { path, files }),
  unstageFiles: (path: string, files: string[]) => invoke("unstage_files", { path, files }),
  stageAll: (path: string) => invoke("stage_all", { path }),
  unstageAll: (path: string) => invoke("unstage_all", { path }),
  discardFile: (path: string, file: string) => invoke("discard_file", { path, file }),
  discardAllChanges: (path: string) => invoke("discard_all_changes", { path }),

  // diff
  // ignoreWs maps to `git -w`; hunk staging must not pass it (diff-viewer spec).
  diffCommit: (path: string, sha: string, file?: string, ignoreWs?: boolean) =>
    invoke<FileDiff[]>("diff_commit", { path, sha, file, ignoreWs }),
  diffStash: (path: string, index: number, ignoreWs?: boolean) =>
    invoke<FileDiff[]>("diff_stash", { path, index, ignoreWs }),
  diffWorkdir: (path: string, file?: string, ignoreWs?: boolean) =>
    invoke<FileDiff[]>("diff_workdir", { path, file, ignoreWs }),
  diffIndex: (path: string, file?: string, ignoreWs?: boolean) =>
    invoke<FileDiff[]>("diff_index", { path, file, ignoreWs }),
  // hunk and line staging: patch built by patchBuilder, docs/specs/hunk-staging.md
  applyPatchText: (path: string, patch: string, cached: boolean, reverse: boolean) =>
    invoke<void>("apply_patch_text", { path, patch, cached, reverse }),

  // commits
  commitCreate: (path: string, message: string, amend = false, sign = false) =>
    invoke("commit_create", { path, message, amend, sign }),
  commitShow: (path: string, sha: string) => invoke<string>("commit_show", { path, sha }),
  // commit box: allow-listed config reads and the template file (docs/specs/commit-box.md)
  gitConfigGet: (path: string, key: string) =>
    invoke<string | null>("git_config_get", { path, key }),
  commitTemplate: (path: string) => invoke<string | null>("commit_template", { path }),
  // AI commit messages: docs/specs/ai-commit-message.md. The key never comes back.
  aiCommitMessage: (path: string) => invoke<string>("ai_commit_message", { path }),
  aiCommitMessageFromStat: (path: string) =>
    invoke<string>("ai_commit_message_from_stat", { path }),
  aiKeyStatus: () => invoke<boolean>("ai_key_status"),
  aiKeySave: (key: string) => invoke<void>("ai_key_save", { key }),
  aiKeyClear: () => invoke<void>("ai_key_clear"),
  commitFiles: (path: string, sha: string) => invoke<CommitFileStat[]>("commit_files", { path, sha }),
  // At most 200 shas per call (the backend refuses more).
  commitStats: (path: string, shas: string[]) => invoke<CommitStat[]>("commit_stats", { path, shas }),
  cherryPick: (path: string, sha: string) => invoke("commit_cherry_pick", { path, sha }),
  revert: (path: string, sha: string, noEdit = true) =>
    invoke("commit_revert", { path, sha, noEdit }),
  reset: (path: string, sha: string, mode: "soft" | "mixed" | "hard") =>
    invoke("commit_reset", { path, sha, mode }),
  commitFormatPatch: (path: string, sha: string, destDir: string) =>
    invoke<string>("commit_format_patch", { path, sha, destDir }),
  patchApply: (path: string, patchFile: string) =>
    invoke("patch_apply", { path, patchFile }),

  // stash
  stashList: (path: string) => invoke<StashEntry[]>("stash_list", { path }),
  stashCreate: (path: string, message?: string, includeUntracked = false) =>
    invoke("stash_create", { path, message, includeUntracked }),
  stashApply: (path: string, index: number) => invoke("stash_apply", { path, index }),
  stashPop: (path: string, index: number) => invoke("stash_pop", { path, index }),
  stashDrop: (path: string, index: number) => invoke("stash_drop", { path, index }),

  // tags
  tagCreate: (path: string, name: string, sha?: string, message?: string) =>
    invoke("tag_create", { path, name, sha, message }),
  tagDelete: (path: string, name: string) => invoke("tag_delete", { path, name }),
  tagPush: (path: string, remote: string, name: string) =>
    invoke("tag_push", { path, remote, name }),
  tagMove: (path: string, name: string, sha: string) =>
    invoke("tag_move", { path, name, sha }),
  tagAnnotate: (path: string, name: string, message: string) =>
    invoke("tag_annotate", { path, name, message }),

  // remotes
  remoteList: (path: string) => invoke<Remote[]>("remote_list", { path }),
  remoteAdd: (path: string, name: string, url: string) =>
    invoke("remote_add", { path, name, url }),
  remoteRemove: (path: string, name: string) => invoke("remote_remove", { path, name }),
  remoteFetch: (path: string, name?: string) => invoke("remote_fetch", { path, name }),
  remoteTags: (path: string, name: string) => invoke<string[]>("remote_tags", { path, name }),
  remotePull: (path: string, rebase = false) => invoke("remote_pull", { path, rebase }),
  remotePush: (path: string, remote: string, branch?: string, force = false) =>
    invoke("remote_push", { path, remote, branch, force }),
  // For branches other than HEAD only. "Pull" on a non-HEAD branch used to pull
  // HEAD instead (bug found 2026-10).
  branchFastForward: (path: string, remote: string, branch: string) =>
    invoke("branch_fast_forward", { path, remote, branch }),

  // ops
  opState: (path: string) => invoke<OperationState>("op_state", { path }),
  opAbort: (path: string, kind: "merge" | "rebase" | "cherry-pick" | "revert") =>
    invoke("op_abort", { path, kind }),
  opContinue: (path: string, kind: "merge" | "rebase" | "cherry-pick" | "revert") =>
    invoke("op_continue", { path, kind }),
  rebaseInteractive: (path: string, base: string, items: RebaseItem[]) =>
    invoke<RebaseOutcome>("rebase_interactive", { path, base, items }),
  markResolved: (path: string, file: string) => invoke("mark_resolved", { path, file }),
  /** Rewrites a conflicted file from one side, then stages it. "ours" is the
   * rebase target during a rebase (see docs/specs/conflict-resolution.md). */
  conflictTakeSide: (path: string, file: string, side: "ours" | "theirs") =>
    invoke("conflict_take_side", { path, file, side }),

  // watcher
  watcherStart: (path: string) => invoke("watcher_start", { path }),
  watcherStop: () => invoke("watcher_stop"),

  // system
  openTerminal: (path: string) => invoke("open_terminal", { path }),
  undoLastCommit: (path: string) => invoke("undo_last_commit", { path }),
  // undo backups (docs/specs/undo-history.md)
  backupFile: (path: string, file: string) => invoke<string | null>("backup_file", { path, file }),
  restoreFile: (path: string, file: string, blob: string | null) =>
    invoke("restore_file", { path, file, blob }),
  discardAllWithBackup: (path: string) =>
    invoke<string | null>("discard_all_with_backup", { path }),
  applyBackup: (path: string, sha: string) => invoke("apply_backup", { path, sha }),
  stashStore: (path: string, sha: string, message: string) =>
    invoke("stash_store", { path, sha, message }),
  fileRead: (path: string, file: string) => invoke<string>("file_read", { path, file }),
  fileReadAt: (path: string, sha: string, file: string) =>
    invoke<string>("file_read_at", { path, sha, file }),
  /** rev null = working tree; "INDEX" = staged blob; otherwise a git rev. */
  fileBytesBase64: (path: string, rev: string | null, file: string) =>
    invoke<FileBytes>("file_bytes_base64", { path, rev, file }),
  fileDelete: (path: string, file: string) => invoke("file_delete", { path, file }),
  fileShowInFolder: (path: string, file: string) =>
    invoke("file_show_in_folder", { path, file }),
  fileEdit: (path: string, file: string) => invoke("file_edit", { path, file }),
  fileWrite: (path: string, file: string, content: string) =>
    invoke("file_write", { path, file, content }),
  /** One page of a file's commits, newest first. `skip` passes over earlier pages. */
  fileHistory: (path: string, file: string, limit?: number, skip?: number) =>
    invoke<FileLogEntry[]>("file_history", { path, file, limit, skip }),
  /** Blame at `rev`, or in the working tree when `rev` is omitted. */
  fileBlame: (path: string, file: string, rev?: string) =>
    invoke<BlameResult>("file_blame", { path, file, rev }),
  ignoreAdd: (path: string, pattern: string) => invoke("ignore_add", { path, pattern }),
  stashFile: (path: string, file: string, message?: string) =>
    invoke("stash_file", { path, file, message }),
  stashEditMessage: (path: string, index: number, message: string) =>
    invoke("stash_edit_message", { path, index, message }),
  repoLogs: (path: string, limit?: number) =>
    invoke<Array<{ ts: string; subject: string; author: string }>>(
      "repo_logs", { path, limit },
    ),
  repoClone: (url: string, dest: string) => invoke<string>("repo_clone", { url, dest }),
  repoCreate: (path: string) => invoke<string>("repo_create", { path }),

  // embedded terminal: real PTY sessions (src-tauri/src/pty). Output arrives
  // as terminal-output / terminal-exit events; see stores/terminal.ts.
  terminalSpawn: (path: string, cols: number, rows: number) =>
    invoke<number>("terminal_spawn", { path, cols, rows }),
  terminalWrite: (id: number, data: string) => invoke("terminal_write", { id, data }),
  terminalResize: (id: number, cols: number, rows: number) =>
    invoke("terminal_resize", { id, cols, rows }),
  terminalKill: (id: number) => invoke("terminal_kill", { id }),

  // worktrees
  worktreeList: (path: string) => invoke<Worktree[]>("worktree_list", { path }),
  worktreeAdd: (path: string, target: string, reference: string, newBranch?: string) =>
    invoke("worktree_add", { path, target, reference, newBranch }),
  worktreeRemove: (path: string, target: string, force = false) =>
    invoke("worktree_remove", { path, target, force }),

  // github
  githubStatus: () =>
    invoke<{ authenticated: boolean; login?: string; avatar_url?: string }>("github_status"),
  githubSavePat: (token: string) => invoke<GhUserInfo>("github_save_pat", { token }),
  githubOauthStart: () =>
    invoke<{ user_code: string; verification_uri: string; interval: number }>("github_oauth_start"),
  githubOauthAwait: () => invoke<GhUserInfo>("github_oauth_await"),
  githubOauthCancel: () => invoke("github_oauth_cancel"),
  githubLogout: () => invoke("github_logout"),
  githubListRepos: () => invoke<GhRepo[]>("github_list_repos"),
  githubClone: (url: string, dest: string) =>
    invoke<string>("github_clone", { url, dest }),
  avatarForEmail: (email: string) => invoke<string>("avatar_for_email", { email }),
  cloneLastDest: () => invoke<string>("clone_last_dest"),
  cloneSaveDest: (path: string) => invoke("clone_save_dest", { path }),
  githubListCreateOwners: () => invoke<GhOwner[]>("github_list_create_owners"),
  githubCheckRepoName: (owner: string, name: string) =>
    invoke<boolean>("github_check_repo_name", { owner, name }),
  githubCreateRepo: (req: CreateRepoReq) =>
    invoke<GhRepoCreated>("github_create_repo", { req }),
  githubPublishLocal: (repoPath: string, req: CreateRepoReq) =>
    invoke<GhRepoCreated>("github_publish_local", { repoPath, req }),
};

export interface GhUserInfo {
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url: string;
}

export interface GhRepo {
  owner: string;
  owner_avatar: string;
  name: string;
  clone_url: string;
  ssh_url: string;
  private: boolean;
  description: string | null;
  default_branch: string | null;
  pushed_at: number;
}

export interface GhOwner {
  login: string;
  avatar_url: string;
  kind: "user" | "organization";
}

export interface CreateRepoReq {
  owner: string;
  name: string;
  description?: string | null;
  private: boolean;
  auto_init: boolean;
  default_branch: string;
  dest_folder?: string | null;
}

export interface GhRepoCreated {
  clone_url: string;
  ssh_url: string;
  html_url: string;
  default_branch: string;
  local_path: string;
}

