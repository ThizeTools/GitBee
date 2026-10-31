// Candidate people for the co-author picker. Built from the commits already
// loaded in the graph, so the picker lists people from this repo's history
// without a git call. Spec: docs/specs/commit-box.md "Co-authors".

/** The fields of a graph commit that the picker reads. */
export interface AuthorSample {
  author_name: string;
  author_email: string;
  timestamp: number;
}

export interface AuthorOption {
  name: string;
  email: string;
  /** Timestamp of this person's most recent commit. Drives the sort order. */
  lastSeen: number;
}

export interface Identity {
  name: string;
  email: string;
}

/**
 * One option per distinct email, most recent first. Emails are compared
 * case-insensitively. The current user (matched by email or name) is left
 * out, since they are the author of this commit.
 *
 * @example distinctAuthors([sample], { name: "Me", email: "me@x.io" })
 */
export function distinctAuthors(samples: AuthorSample[], me: Identity): AuthorOption[] {
  const byEmail = new Map<string, AuthorOption>();
  for (const s of samples) {
    const key = s.author_email.trim().toLowerCase();
    if (!key || isSameIdentity(s, me)) continue;
    const seen = byEmail.get(key);
    if (!seen || s.timestamp > seen.lastSeen) {
      byEmail.set(key, { name: s.author_name.trim(), email: s.author_email.trim(), lastSeen: s.timestamp });
    }
  }
  return [...byEmail.values()].sort(newestFirst);
}

function isSameIdentity(s: AuthorSample, me: Identity): boolean {
  const email = s.author_email.trim().toLowerCase();
  const name = s.author_name.trim();
  if (me.email && email === me.email.trim().toLowerCase()) return true;
  return me.name !== "" && name === me.name.trim();
}

function newestFirst(a: AuthorOption, b: AuthorOption): number {
  if (b.lastSeen !== a.lastSeen) return b.lastSeen - a.lastSeen;
  return a.name.localeCompare(b.name);
}

/**
 * Options whose name or email contains `query`, ignoring case. An empty or
 * blank query returns everything.
 *
 * @example filterAuthors(options, "ana") // matches "Ana Lima" and "ana@x.io"
 */
export function filterAuthors(authors: AuthorOption[], query: string): AuthorOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return authors;
  return authors.filter(
    (a) => a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q),
  );
}
