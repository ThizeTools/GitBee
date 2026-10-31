// DEV-ONLY: serves the demo repo in fixtures.ts through Tauri's IPC mock, so the
// Svelte UI can be previewed in a plain browser (vite dev at localhost:1420).
// Imported only from src/routes/+layout.svelte, behind import.meta.env.DEV. In the
// Tauri webview nothing is installed, and production builds do not ship this file.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { GraphPage } from "$lib/ipc";
import {
  DEMO_IDENTITY, DEMO_OP_STATE, DEMO_REPO_PATH,
  demoCommitFiles, demoCommitShow, demoCommitStats, demoFileDiffs, demoGraphPage,
  demoRecent, demoRemotes, demoSearchShas, demoStashes, demoStatus, demoWorktrees,
} from "./fixtures";

type Args = Record<string, unknown>;
type Handler = (args: Args) => unknown;

function isRecord(value: unknown): value is Args {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function nullableText(args: Args, key: string): string | null {
  const value = text(args, key);
  return value === "" ? null : value;
}

function numberOr(args: Args, key: string, fallback: number): number {
  const value = args[key];
  return typeof value === "number" ? value : fallback;
}

function strings(args: Args, key: string): string[] {
  const value = args[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** graph_load takes its fields inside `opts`, as the typed wrapper in ipc/index.ts sends them. */
function graphLoad(args: Args): GraphPage {
  const opts = isRecord(args.opts) ? args.opts : {};
  return demoGraphPage(
    numberOr(opts, "limit", 2000),
    nullableText(opts, "known_fingerprint"),
    nullableText(opts, "pinned_sha"),
  );
}

function configValue(key: string): string | null {
  if (key === "user.name") return DEMO_IDENTITY.name;
  if (key === "user.email") return DEMO_IDENTITY.email;
  return null;
}

const diffFor = (args: Args): unknown => demoFileDiffs(text(args, "file") || undefined);

const HANDLERS = new Map<string, Handler>([
  // repo
  ["repo_open", (a) => ({ id: 1, path: text(a, "path") || DEMO_REPO_PATH })],
  ["repo_recent", () => demoRecent()],
  ["repo_identity", () => DEMO_IDENTITY],
  ["repo_logs", () => []],
  // graph
  ["graph_load", graphLoad],
  ["graph_search", (a) => demoSearchShas(text(a, "query"), numberOr(a, "limit", 200))],
  // status, stashes, remotes, worktrees, operations
  ["status_load", () => demoStatus()],
  ["stash_list", () => demoStashes()],
  ["remote_list", () => demoRemotes()],
  ["remote_tags", () => []],
  ["worktree_list", () => demoWorktrees()],
  ["submodule_list", () => []],
  ["op_state", () => DEMO_OP_STATE],
  // diffs and commit details
  ["diff_commit", diffFor],
  ["diff_workdir", diffFor],
  ["diff_index", diffFor],
  ["diff_stash", diffFor],
  ["commit_files", (a) => demoCommitFiles(text(a, "sha"))],
  ["commit_stats", (a) => demoCommitStats(strings(a, "shas"))],
  ["commit_show", (a) => demoCommitShow(text(a, "sha"))],
  ["git_config_get", (a) => configValue(text(a, "key"))],
  ["file_read", () => ""],
  ["file_read_at", () => ""],
  ["file_bytes_base64", () => ({ base64: "", mime: "application/octet-stream" })],
  ["file_blame", () => ({ lines: [], commits: {} })],
  ["file_history", () => []],
  // lfs, github, profiles, ai, clone
  ["lfs_status", () => ({ installed: false, version: null, used: false, patterns: [] })],
  ["lfs_files", () => []],
  ["profiles_list", () => []],
  ["github_status", () => ({ authenticated: false })],
  ["github_list_repos", () => []],
  ["github_list_create_owners", () => []],
  ["github_list_pulls", () => []],
  ["github_branch_on_remote", () => false],
  ["avatar_for_email", () => Promise.reject(new Error("devMock: the demo has no avatars"))],
  ["ai_key_status", () => false],
  ["ai_commit_message", () => ""],
  ["ai_commit_message_from_stat", () => ""],
  ["clone_last_dest", () => ""],
  ["terminal_spawn", () => 1],
]);

const warned = new Set<string>();

function warnUnmocked(cmd: string): void {
  if (warned.has(cmd)) return;
  warned.add(cmd);
  console.warn(`[devMock] no mock for IPC command "${cmd}", returning null`);
}

// plugin:event|listen must return a listener id, or the app's listen() call throws.
// Nothing ever emits here, so the mock never calls the handler.
let nextEventId = 1;

function dispatch(cmd: string, payload: unknown): unknown {
  if (cmd === "plugin:event|listen") return nextEventId++;
  if (cmd.startsWith("plugin:event|")) return null;
  const handler = HANDLERS.get(cmd);
  if (handler) return handler(isRecord(payload) ? payload : {});
  warnUnmocked(cmd);
  return null;
}

/** True when Tauri's bridge is absent, i.e. the app runs in a normal browser tab. */
export function isPlainBrowser(): boolean {
  return (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === undefined;
}

export function installIpcMock(): void {
  mockWindows("main");
  mockIPC((cmd, payload) => dispatch(cmd, payload));
}

/**
 * Awaited by +layout.svelte before the first component mounts, so the page's startup
 * invokes (refreshRecent, restoreTabs) already reach the mock. Does nothing in the
 * Tauri webview. Otherwise installs the mock and opens the demo repo as a tab.
 */
export async function startDevMock(): Promise<void> {
  if (!import.meta.env.DEV || !isPlainBrowser()) return;
  installIpcMock();
  console.info(`[devMock] IPC mocked, opening demo repo ${DEMO_REPO_PATH}`);
  // Not awaited: openRepo runs the first graph load, and the page can mount while it works.
  // repo.ts reads gkp.tabs.v1 once, at module load, so seeding that key here would not reliably
  // reach restoreTabs. The demo tab is opened directly instead.
  const { openRepo } = await import("$lib/stores/repo");
  void openRepo(DEMO_REPO_PATH).catch((err: unknown) => {
    console.warn("[devMock] could not open the demo repo", err);
  });
}
