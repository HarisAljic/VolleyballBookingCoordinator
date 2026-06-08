import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeSlotKey } from "../slotKeys.js";

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
      capacity INTEGER NOT NULL DEFAULT 12 CHECK (capacity IN (12, 18, 24)),
      target_roster_sizes TEXT,
      date_start TEXT NOT NULL,
      date_end TEXT NOT NULL,
      included_weekdays TEXT,
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
      slot_saved_at_json TEXT,
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
  const avCols2 = db.prepare("PRAGMA table_info(availability)").all();
  if (!avCols2.some((c) => c.name === "slot_saved_at_json")) {
    db.exec("ALTER TABLE availability ADD COLUMN slot_saved_at_json TEXT");
  }
  const backfillSlotSavedAt = db.prepare(
    `UPDATE availability SET slot_saved_at_json = ?
     WHERE run_id = ? AND user_id = ?
       AND (slot_saved_at_json IS NULL OR TRIM(slot_saved_at_json) = '' OR slot_saved_at_json = '{}')`
  );
  for (const row of db
    .prepare(
      "SELECT run_id, user_id, slots_json, first_saved_at, updated_at FROM availability"
    )
    .all()) {
    let slots = [];
    try {
      slots = JSON.parse(row.slots_json || "[]");
    } catch {
      slots = [];
    }
    if (!Array.isArray(slots) || !slots.length) continue;
    const ts = String(row.first_saved_at || row.updated_at || "").trim();
    if (!ts) continue;
    const savedAt = {};
    for (const s of slots) {
      const k = normalizeSlotKey(String(s));
      if (k) savedAt[k] = ts;
    }
    if (Object.keys(savedAt).length) {
      backfillSlotSavedAt.run(
        JSON.stringify(savedAt),
        row.run_id,
        row.user_id
      );
    }
  }
  const runCols = db.prepare("PRAGMA table_info(runs)").all();
  if (!runCols.some((c) => c.name === "included_weekdays")) {
    db.exec("ALTER TABLE runs ADD COLUMN included_weekdays TEXT");
  }
  db.prepare(
    `UPDATE runs SET included_weekdays = ?
     WHERE included_weekdays IS NULL OR TRIM(included_weekdays) = ''`
  ).run(JSON.stringify([0, 1, 2, 3, 4, 5, 6]));
  const runCols2 = db.prepare("PRAGMA table_info(runs)").all();
  if (!runCols2.some((c) => c.name === "target_roster_sizes")) {
    db.exec("ALTER TABLE runs ADD COLUMN target_roster_sizes TEXT");
  }
  db.prepare(
    `UPDATE runs SET target_roster_sizes = ?
     WHERE target_roster_sizes IS NULL OR TRIM(target_roster_sizes) = ''`
  ).run(JSON.stringify([12, 18, 24]));
  const runCols3 = db.prepare("PRAGMA table_info(runs)").all();
  if (!runCols3.some((c) => c.name === "is_default")) {
    db.exec("ALTER TABLE runs ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0");
  }
  return db;
}
