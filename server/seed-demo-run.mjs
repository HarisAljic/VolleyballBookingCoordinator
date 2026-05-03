/**
 * Seeds 11 fake users + a 12-capacity run (11 members) for local testing.
 * Join with your real account using run code DEMO12 (or the printed link).
 *
 * Re-run anytime: it removes the previous demo run and seed users first.
 */
import bcrypt from "bcryptjs";
import { openDb } from "./db.js";
import { slotKeyFromParts } from "../slotKeys.js";

const SEED_EMAIL_SUFFIX = "@seed-dummy.volleyball";
const SEED_SHARE_TOKEN = "demoseedvolleyballrun12tokenxx";
const SEED_RUN_CODE = "DEMO12";
const SEED_RUN_TITLE = "Demo 12-player run (seeded)";
const FAKE_COUNT = 11;
const PASSWORD = "seedpass12";

const db = openDb();
const hash = bcrypt.hashSync(PASSWORD, 8);

db.exec("BEGIN");
try {
  db.prepare("DELETE FROM runs WHERE share_token = ?").run(SEED_SHARE_TOKEN);
  db.prepare(`DELETE FROM users WHERE email LIKE ?`).run("%" + SEED_EMAIL_SUFFIX);

  const insertUser = db.prepare(
    `INSERT INTO users (first_name, last_name, email, password_hash)
     VALUES (?, ?, ?, ?)`
  );

  const fakeIds = [];
  for (let i = 1; i <= FAKE_COUNT; i++) {
    const info = insertUser.run(
      `Player`,
      `${i}`,
      `player${i}${SEED_EMAIL_SUFFIX}`,
      hash
    );
    fakeIds.push(Number(info.lastInsertRowid));
  }

  const creatorId = fakeIds[0];
  const runInfo = db
    .prepare(
      `INSERT INTO runs (creator_id, title, capacity, date_start, date_end, run_code, share_token)
       VALUES (?, ?, 12, ?, ?, ?, ?)`
    )
    .run(
      creatorId,
      SEED_RUN_TITLE,
      "2026-05-01",
      "2026-05-31",
      SEED_RUN_CODE,
      SEED_SHARE_TOKEN
    );
  const runId = Number(runInfo.lastInsertRowid);

  const insertMember = db.prepare(
    "INSERT INTO run_members (run_id, user_id) VALUES (?, ?)"
  );
  for (const uid of fakeIds) {
    insertMember.run(runId, uid);
  }

  const insertAv = db.prepare(
    `INSERT INTO availability (run_id, user_id, slots_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))`
  );

  const commonOverlap = [
    slotKeyFromParts(2026, 5, 9, 18),
    slotKeyFromParts(2026, 5, 9, 19),
    slotKeyFromParts(2026, 5, 9, 20),
    slotKeyFromParts(2026, 5, 9, 21),
  ];

  for (let i = 0; i < fakeIds.length; i++) {
    const uid = fakeIds[i];
    const extra = [];
    for (let h = 10; h <= 11 + (i % 4); h++) {
      extra.push(slotKeyFromParts(2026, 5, 3 + (i % 5), h));
    }
    extra.push(slotKeyFromParts(2026, 5, 16, 14 + (i % 5)));
    const slots = [...commonOverlap, ...extra];
    insertAv.run(runId, uid, JSON.stringify(slots));
  }

  db.exec("COMMIT");

  const origin = process.env.PUBLIC_ORIGIN || "http://localhost:3000";
  console.log("Demo seed OK.");
  console.log("  Run code:     ", SEED_RUN_CODE, "(use Join a run after signing in)");
  console.log("  Open run:     ", `${origin}/?run=${SEED_SHARE_TOKEN}`);
  console.log("  Join (code):  ", `${origin}/?join=${SEED_RUN_CODE}`);
  console.log(`  Fake logins:  player1${SEED_EMAIL_SUFFIX} … player11… / password: ${PASSWORD}`);
  console.log("  Join this run with your real account to fill the 12th spot.");
  console.log("  Each fake player has saved availability (shared Sat eve May 9 + unique slots).");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(e);
  process.exit(1);
} finally {
  db.close();
}
