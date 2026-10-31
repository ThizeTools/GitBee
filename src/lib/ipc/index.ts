import { invoke } from "@tauri-apps/api/core";

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
  diffCommit: (path: string, sha: string, file?: string) =>
    invoke<FileDiff[]>("diff_commit", { path, sha, file }),
  diffStash: (path: string, index: number) => invoke<FileDiff[]>("diff_stash", { path, index }),
  diffWorkdir: (path: string, file?: string) => invoke<FileDiff[]>("diff_workdir", { path, file }),
  diffIndex: (path: string, file?: string) => invoke<FileDiff[]>("diff_index", { path, file }),

  // commits
  commitCreate: (path: string, message: string, amend = false, sign = false) =>
    invoke("commit_create", { path, message, amend, sign }),
  commitShow: (path: string, sha: string) => invoke<string>("commit_show", { path, sha }),
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

  // ops
  opState: (path: string) => invoke<OperationState>("op_state", { path }),
  opAbort: (path: string, kind: "merge" | "rebase" | "cherry-pick" | "revert") =>
    invoke("op_abort", { path, kind }),
  opContinue: (path: string, kind: "merge" | "rebase" | "cherry-pick" | "revert") =>
    invoke("op_continue", { path, kind }),
  markResolved: (path: string, file: string) => invoke("mark_resolved", { path, file }),

  // watcher
  watcherStart: (path: string) => invoke("watcher_start", { path }),
  watcherStop: () => invoke("watcher_stop"),

  // system
  openTerminal: (path: string) => invoke("open_terminal", { path }),
  undoLastCommit: (path: string) => invoke("undo_last_commit", { path }),
  fileRead: (path: string, file: string) => invoke<string>("file_read", { path, file }),
  fileReadAt: (path: string, sha: string, file: string) =>
    invoke<string>("file_read_at", { path, sha, file }),
  fileDelete: (path: string, file: string) => invoke("file_delete", { path, file }),
  fileShowInFolder: (path: string, file: string) =>
    invoke("file_show_in_folder", { path, file }),
  fileEdit: (path: string, file: string) => invoke("file_edit", { path, file }),
  fileHistory: (path: string, file: string, limit?: number) =>
    invoke<Array<{ sha: string; subject: string; author: string; ts: number }>>(
      "file_history", { path, file, limit },
    ),
  fileBlame: (path: string, file: string) =>
    invoke<Array<{ sha: string; author: string; ts: number; line: string }>>(
      "file_blame", { path, file },
    ),
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

  // terminal (line-mode subprocess; not a real PTY)
  terminalSpawn: (cwd: string) => invoke<string>("terminal_spawn", { cwd }),
  terminalWrite: (id: string, data: string) => invoke("terminal_write", { id, data }),
  terminalKill: (id: string) => invoke("terminal_kill", { id }),

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

