use crate::error::AppResult;
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};

const SCHEMA: &str = include_str!("schema.sql");

pub struct CacheStore {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone)]
pub struct RecentRepo {
    pub id: i64,
    pub path: String,
    pub last_opened: i64,
}

impl CacheStore {
    pub fn open(db_path: &Path) -> AppResult<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn upsert_repo(&self, path: &str, ts: i64) -> AppResult<i64> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO repos (path, last_opened) VALUES (?1, ?2)
             ON CONFLICT(path) DO UPDATE SET last_opened = excluded.last_opened",
            params![path, ts],
        )?;
        let id: i64 = conn.query_row(
            "SELECT id FROM repos WHERE path = ?1",
            params![path],
            |r| r.get(0),
        )?;
        Ok(id)
    }

    /// Remove a single repo from the recents list. Idempotent — returns
    /// Ok even if the path was never in the table.
    pub fn forget_repo(&self, path: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM repos WHERE path = ?1", params![path])?;
        Ok(())
    }

    pub fn list_recent(&self, limit: i64) -> AppResult<Vec<RecentRepo>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, path, last_opened FROM repos ORDER BY last_opened DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(RecentRepo {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    last_opened: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Read a settings row. `Ok(None)` only when the key is genuinely absent;
    /// a real SQLite error (locked/busy DB, I/O) is propagated instead of being
    /// swallowed as "absent" — otherwise a transient SQLITE_BUSY silently
    /// logged the user out of GitHub. (audit 2026-05)
    pub fn settings_get(&self, key: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock();
        match conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0)) {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn settings_set(&self, key: &str, value: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn settings_delete(&self, key: &str) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }

    pub fn avatar_url_get(&self, email: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock();
        // Distinguish "no cached row" from a real DB error (see settings_get).
        match conn.query_row(
            "SELECT url FROM avatar_urls WHERE email = ?1",
            params![email.to_lowercase()],
            |r| r.get(0),
        ) {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn avatar_url_put(&self, email: &str, url: &str, ts: i64) -> AppResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO avatar_urls (email, url, cached_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(email) DO UPDATE SET url = excluded.url, cached_at = excluded.cached_at",
            params![email.to_lowercase(), url, ts],
        )?;
        Ok(())
    }
}

pub fn default_db_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("GitBee")
        .join("cache.db")
}
