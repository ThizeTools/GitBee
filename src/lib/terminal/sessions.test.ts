import { describe, test, expect } from "bun:test";
import {
  NO_SESSIONS, activeSessionId, addSession, appendCapped, exitNotice, markExited,
  nextTitle, orphanedSessionIds, removeSession, selectSession, sessionsOf,
  type TerminalSession, type TerminalSessions,
} from "./sessions";

function session(id: number, repo: string): TerminalSession {
  return { id, repo, title: `Terminal ${id}`, exited: false };
}

/** Two sessions in /a and one in /b, built through the public add function. */
function sample(): TerminalSessions {
  let state = addSession(NO_SESSIONS, session(1, "/a"));
  state = addSession(state, session(2, "/a"));
  return addSession(state, session(3, "/b"));
}

describe("activeSessionId", () => {
  test("a newly added session becomes active for its repo", () => {
    expect(activeSessionId(sample(), "/a")).toBe(2);
    expect(activeSessionId(sample(), "/b")).toBe(3);
  });

  test("a repo with no sessions has no active session", () => {
    expect(activeSessionId(sample(), "/c")).toBeNull();
  });

  test("falls back to the first session when the remembered one is gone", () => {
    const state = removeSession(sample(), 2);
    expect(activeSessionId(state, "/a")).toBe(1);
  });
});

describe("selectSession", () => {
  test("switches the active tab of one repo without touching others", () => {
    const state = selectSession(sample(), "/a", 1);
    expect(activeSessionId(state, "/a")).toBe(1);
    expect(activeSessionId(state, "/b")).toBe(3);
  });
});

describe("removeSession", () => {
  test("drops the session and keeps the other repo's sessions", () => {
    const state = removeSession(sample(), 3);
    expect(state.list.map((s) => s.id)).toEqual([1, 2]);
  });

  test("an unknown id returns the same state", () => {
    const state = sample();
    expect(removeSession(state, 99)).toBe(state);
  });
});

describe("sessionsOf", () => {
  test("lists only the repo's sessions in creation order", () => {
    expect(sessionsOf(sample(), "/a").map((s) => s.id)).toEqual([1, 2]);
  });
});

describe("markExited", () => {
  test("flags one session as exited and leaves the rest alone", () => {
    const state = markExited(sample(), 2);
    expect(state.list.find((s) => s.id === 2)?.exited).toBe(true);
    expect(state.list.find((s) => s.id === 1)?.exited).toBe(false);
  });
});

describe("nextTitle", () => {
  test("numbers tabs per repo", () => {
    expect(nextTitle(NO_SESSIONS, "/a")).toBe("Terminal 1");
    expect(nextTitle(sample(), "/a")).toBe("Terminal 3");
    expect(nextTitle(sample(), "/b")).toBe("Terminal 2");
  });
});

describe("orphanedSessionIds", () => {
  test("returns sessions whose repo is no longer open", () => {
    const openRepos = new Set(["/a"]);
    expect(orphanedSessionIds(sample(), (repo) => openRepos.has(repo))).toEqual([3]);
  });

  test("returns nothing while every repo is open", () => {
    expect(orphanedSessionIds(sample(), () => true)).toEqual([]);
  });
});

describe("exitNotice", () => {
  test("names the exit code, uses CRLF, and omits the code when unknown", () => {
    expect(exitNotice(0)).toBe("\r\n[process exited with code 0]\r\n");
    expect(exitNotice(null)).toBe("\r\n[process exited]\r\n");
  });
});

describe("appendCapped", () => {
  test("keeps the newest characters once the limit is passed", () => {
    expect(appendCapped("abc", "def", 4)).toBe("cdef");
  });

  test("keeps everything under the limit", () => {
    expect(appendCapped("ab", "c", 10)).toBe("abc");
  });
});
