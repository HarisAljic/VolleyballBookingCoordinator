import { customAlphabet } from "nanoid";
import { nanoid } from "nanoid";
import { db } from "../db-singleton.js";
import { parseRosterTargets } from "../../roster-tiers.js";

const codeAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

export function randomRunCode() {
  for (let i = 0; i < 20; i++) {
    const c = codeAlphabet();
    const exists = db.prepare("SELECT 1 FROM runs WHERE run_code = ?").get(c);
    if (!exists) return c;
  }
  return codeAlphabet() + codeAlphabet().slice(0, 2);
}

export function getRunByShareToken(token) {
  return db
    .prepare(
      `SELECT r.*, u.first_name AS creator_first, u.last_name AS creator_last
       FROM runs r JOIN users u ON u.id = r.creator_id
       WHERE r.share_token = ?`
    )
    .get(token);
}

export function memberCount(runId) {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM run_members WHERE run_id = ?")
    .get(runId);
  return row?.n ?? 0;
}

export function listMembers(runId) {
  return db
    .prepare(
      `SELECT u.id, u.first_name, u.last_name
       FROM run_members m JOIN users u ON u.id = m.user_id
       WHERE m.run_id = ?
       ORDER BY m.rowid ASC`
    )
    .all(runId);
}

export function userInRun(runId, userId) {
  return !!db
    .prepare("SELECT 1 FROM run_members WHERE run_id = ? AND user_id = ?")
    .get(runId, userId);
}

export function orderedMemberUserIds(runId) {
  return db
    .prepare(
      `SELECT user_id FROM run_members WHERE run_id = ? ORDER BY rowid ASC`
    )
    .all(runId)
    .map((r) => Number(r.user_id));
}

export function runRosterTargets(runRow) {
  return parseRosterTargets(runRow?.target_roster_sizes);
}

export function createRun({ creatorId, title, dateStart, dateEnd, weekdaysJson, targetsJson }) {
  const runCode = randomRunCode();
  const shareToken = nanoid(32);
  const info = db
    .prepare(
      `INSERT INTO runs (creator_id, title, capacity, date_start, date_end, included_weekdays, target_roster_sizes, run_code, share_token)
       VALUES (?, ?, 12, ?, ?, ?, ?, ?, ?)`
    )
    .run(creatorId, title, dateStart, dateEnd, weekdaysJson, targetsJson, runCode, shareToken);
  const runId = info.lastInsertRowid;
  db.prepare("INSERT INTO run_members (run_id, user_id) VALUES (?, ?)").run(
    runId,
    creatorId
  );
  return { runId, shareToken, runCode };
}

export function joinRun(runId, userId) {
  db.prepare("INSERT INTO run_members (run_id, user_id) VALUES (?, ?)").run(
    runId,
    userId
  );
}

export function getRunByCode(code) {
  return db
    .prepare(
      `SELECT r.id, r.title, r.capacity, r.date_start, r.date_end, r.run_code, r.share_token
       FROM runs r WHERE r.run_code = ?`
    )
    .get(code);
}

export function leaveRun(runRow, userId) {
  const txn = db.transaction(() => {
    db.prepare("DELETE FROM run_guests WHERE run_id = ? AND sponsor_user_id = ?").run(
      runRow.id,
      userId
    );
    db.prepare("DELETE FROM availability WHERE run_id = ? AND user_id = ?").run(
      runRow.id,
      userId
    );
    db.prepare("DELETE FROM run_members WHERE run_id = ? AND user_id = ?").run(
      runRow.id,
      userId
    );
    const remaining = memberCount(runRow.id);
    // If nobody is left, delete the run row. Default runs can be recreated on demand.
    if (remaining === 0) {
      db.prepare("DELETE FROM runs WHERE id = ?").run(runRow.id);
      return { runDeleted: true };
    }
    if (runRow.creator_id === userId) {
      const next = db
        .prepare(
          `SELECT user_id FROM run_members WHERE run_id = ? ORDER BY rowid ASC LIMIT 1`
        )
        .get(runRow.id);
      if (next) {
        db.prepare("UPDATE runs SET creator_id = ? WHERE id = ?").run(
          next.user_id,
          runRow.id
        );
      }
    }
    return { runDeleted: false };
  });
  return txn();
}
