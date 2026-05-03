/**
 * Seeds 17 fake users + an 18-capacity run focused around May 23 (local calendar).
 * Join as the 18th member with your account using the printed run code or link.
 *
 * Cleans only this demo: removes run by share_token + users with @seed-may23.volleyball.
 */
import bcrypt from "bcryptjs";
import { openDb } from "./db.js";
import { slotKeyFromParts } from "../slotKeys.js";

const SEED_EMAIL_SUFFIX = "@seed-may23.volleyball";
const SEED_SHARE_TOKEN = "demoseedmay2318capvolleyballtokenxx";
const SEED_RUN_CODE = "MAY238";
const SEED_RUN_TITLE = "May 23 demo — 18 spots (17 filled)";
const FAKE_COUNT = 17;
const PASSWORD = "seedmay23";

/** Run window includes May 23, 2026 (matches app “today” in dev). */
const DATE_START = "2026-05-09";
const DATE_END = "2026-06-06";

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
    const info = insertUser.run(`Teammate`, `${i}`, `may23player${i}${SEED_EMAIL_SUFFIX}`, hash);
    fakeIds.push(Number(info.lastInsertRowid));
  }

  const creatorId = fakeIds[0];
  const runInfo = db
    .prepare(
      `INSERT INTO runs (creator_id, title, capacity, date_start, date_end, run_code, share_token)
       VALUES (?, ?, 18, ?, ?, ?, ?)`
    )
    .run(creatorId, SEED_RUN_TITLE, DATE_START, DATE_END, SEED_RUN_CODE, SEED_SHARE_TOKEN);
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

  const commonMay23 = [
    slotKeyFromParts(2026, 5, 23, 18),
    slotKeyFromParts(2026, 5, 23, 19),
    slotKeyFromParts(2026, 5, 23, 20),
    slotKeyFromParts(2026, 5, 23, 21),
  ];

  for (let i = 0; i < fakeIds.length; i++) {
    const uid = fakeIds[i];
    const extra = [];
    for (let h = 10; h <= 11 + (i % 4); h++) {
      extra.push(slotKeyFromParts(2026, 5, 16 + (i % 7), h));
    }
    extra.push(slotKeyFromParts(2026, 5, 30, 14 + (i % 5)));
    const slots = [...commonMay23, ...extra];
    insertAv.run(runId, uid, JSON.stringify(slots));
  }

  db.exec("COMMIT");

  const origin = process.env.PUBLIC_ORIGIN || "http://localhost:3000";
  console.log("May 23 demo (18-cap, 17 seeded) OK.");
  console.log("  Run code:     ", SEED_RUN_CODE, "(Join a run → paste code)");
  console.log("  Open run:     ", `${origin}/?run=${SEED_SHARE_TOKEN}`);
  console.log("  Join link:    ", `${origin}/?join=${SEED_RUN_CODE}`);
  console.log(`  Fake logins (optional): may23player1${SEED_EMAIL_SUFFIX} … may23player17… / ${PASSWORD}`);
  console.log("  Sign in with your real account and join with the code above to be the 18th player.");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(e);
  process.exit(1);
} finally {
  db.close();
}
