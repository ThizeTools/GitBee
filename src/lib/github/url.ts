// Best-effort parser for GitHub clone/HTTP URLs. Supports the four shapes
// users actually paste:
//   git@github.com:owner/repo.git
//   ssh://git@github.com/owner/repo.git
//   https://github.com/owner/repo.git
//   https://github.com/owner/repo
// Returns null for anything that doesn't look like github.com — the caller
// then falls back to copy-link or shows a "remote isn't on GitHub" notice.
export function parseGitHubRepo(url: string): { owner: string; name: string } | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // SSH shorthand: git@github.com:owner/repo(.git)
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(trimmed);
  if (ssh) return { owner: ssh[1], name: ssh[2] };

  // ssh://git@github.com/owner/repo(.git)
  const sshUrl = /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/.exec(trimmed);
  if (sshUrl) return { owner: sshUrl[1], name: sshUrl[2] };

  // https://github.com/owner/repo(.git) (with or without trailing slash)
  const https = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(trimmed);
  if (https) return { owner: https[1], name: https[2] };

  return null;
}

// Given a remote URL on github.com, build the "open PR creator" URL.
// `branch` is the head (compare) branch. GitHub will auto-pick the base
// branch (the repo's default), and `?expand=1` opens the create form
// pre-expanded so the user lands directly on the title/body inputs.
export function pullRequestCompareUrl(remoteUrl: string, branch: string): string | null {
  const repo = parseGitHubRepo(remoteUrl);
  if (!repo) return null;
  const enc = encodeURIComponent(branch);
  return `https://github.com/${repo.owner}/${repo.name}/compare/${enc}?expand=1`;
}

// Convert any common git remote URL to the matching https web URL of the
// repo's root. Handles github.com, gitlab.com, bitbucket.org, and any
// other host that uses the same `https://<host>/<owner>/<repo>` shape
// (which is the de-facto standard). Returns null for shapes we can't
// parse — caller should fall back gracefully.
export function gitRemoteToWebUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim().replace(/\.git\/?$/, "");
  if (!trimmed) return null;

  // SSH shorthand: git@host:owner/repo
  const ssh = /^git@([^:]+):(.+)$/.exec(trimmed);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;

  // ssh://[user@]host/owner/repo
  const sshUrl = /^ssh:\/\/(?:[^@]+@)?([^/]+)\/(.+)$/.exec(trimmed);
  if (sshUrl) return `https://${sshUrl[1]}/${sshUrl[2]}`;

  // https://host/owner/repo (or http://)
  const https = /^https?:\/\/[^/]+\/.+$/.exec(trimmed);
  if (https) return trimmed.replace(/^http:\/\//, "https://");

  return null;
}

// Build a web link to a specific commit on the remote, e.g.
// `https://github.com/owner/repo/commit/<sha>`. Most major hosts use
// `/commit/<sha>` (github, gitlab, bitbucket), so this works generically.
export function commitWebUrl(remoteUrl: string, sha: string): string | null {
  const base = gitRemoteToWebUrl(remoteUrl);
  if (!base) return null;
  return `${base}/commit/${sha}`;
}

// Web link to a branch's tree. Same generic `/tree/<branch>` path used
// by github, gitlab, and bitbucket.
export function branchWebUrl(remoteUrl: string, branch: string): string | null {
  const base = gitRemoteToWebUrl(remoteUrl);
  if (!base) return null;
  return `${base}/tree/${encodeURIComponent(branch)}`;
}
