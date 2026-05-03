import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "data", "app.db");

export function openDb() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK (capacity IN (12, 18, 24)),
      date_start TEXT NOT NULL,
      date_end TEXT NOT NULL,
      run_code TEXT NOT NULL UNIQUE,
      share_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS run_members (
      run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (run_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS availability (
      run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slots_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      first_saved_at TEXT,
      PRIMARY KEY (run_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_runs_creator ON runs(creator_id);
    CREATE INDEX IF NOT EXISTS idx_runs_code ON runs(run_code);
    CREATE INDEX IF NOT EXISTS idx_runs_share ON runs(share_token);
  `);
  const avCols = db.prepare("PRAGMA table_info(availability)").all();
  if (!avCols.some((c) => c.name === "first_saved_at")) {
    db.exec("ALTER TABLE availability ADD COLUMN first_saved_at TEXT");
  }
  db.prepare(
    `UPDATE availability SET first_saved_at = updated_at
     WHERE first_saved_at IS NULL OR TRIM(first_saved_at) = ''`
  ).run();
  return db;
}
