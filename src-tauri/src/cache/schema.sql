CREATE TABLE IF NOT EXISTS repos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    path        TEXT NOT NULL UNIQUE,
    last_opened INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commits (
    repo_id   INTEGER NOT NULL,
    sha       TEXT NOT NULL,
    parents   TEXT NOT NULL,
    author    TEXT NOT NULL,
    email     TEXT NOT NULL,
    ts        INTEGER NOT NULL,
    subject   TEXT NOT NULL,
    lane      INTEGER,
    row_idx   INTEGER,
    PRIMARY KEY (repo_id, sha)
);

CREATE INDEX IF NOT EXISTS idx_commits_row ON commits(repo_id, row_idx);

CREATE TABLE IF NOT EXISTS refs (
    repo_id INTEGER NOT NULL,
    name    TEXT NOT NULL,
    kind    TEXT NOT NULL,
    sha     TEXT NOT NULL,
    PRIMARY KEY (repo_id, name)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- email→avatar URL resolution memoized so we don't re-derive on every render.
CREATE TABLE IF NOT EXISTS avatar_urls (
    email TEXT PRIMARY KEY,
    url   TEXT NOT NULL,
    cached_at INTEGER NOT NULL
);
