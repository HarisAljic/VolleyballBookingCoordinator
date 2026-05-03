/**
 * 18-capacity run with 18 seeded players (active roster full).
 * Join with your real account → you become waitlist #1 (and see the yellow WAITLIST UI).
 *
 * Cleans only this demo: run by share_token + users @seed-waitlist.volleyball
 */
import bcrypt from "bcryptjs";
import { openDb } from "./db.js";
import { slotKeyFromParts } from "../slotKeys.js";

const SEED_EMAIL_SUFFIX = "@seed-waitlist.volleyball";
const SEED_SHARE_TOKEN = "demoseedwaitlist18volleyballtokenxxxx";
const SEED_RUN_CODE = "WL18DM";
const SEED_RUN_TITLE = "Waitlist demo — 18/18 active (join for waitlist)";
const SEEDED_PLAYERS = 18;
const PASSWORD = "seedwait18";

const DATE_START = "2026-05-01";
const DATE_END = "2026-05-31";

const SHARED_DAYS_OF_MONTH = [10, 17, 24];
const SHARED_HOURS = [18, 19, 20];

function buildSharedSlots() {
  const slots = [];
  for (const day of SHARED_DAYS_OF_MONTH) {
    for (const h of SHARED_HOURS) {
      slots.push(slotKeyFromParts(2026, 5, day, h));
    }
  }
  return slots.sort();
}

const sharedSlotsJson = JSON.stringify(buildSharedSlots());

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
  for (let i = 1; i <= SEEDED_PLAYERS; i++) {
    const info = insertUser.run(
      `Bench`,
      `${i}`,
      `waitplayer${i}${SEED_EMAIL_SUFFIX}`,
      hash
    );
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

  for (const uid of fakeIds) {
    insertAv.run(runId, uid, sharedSlotsJson);
  }

  db.exec("COMMIT");

  const origin = process.env.PUBLIC_ORIGIN || "http://localhost:3000";
  console.log("Waitlist demo OK — active roster 18/18 (you join → waitlist #1).");
  console.log("  Run code:     ", SEED_RUN_CODE);
  console.log("  Open run:     ", `${origin}/?run=${SEED_SHARE_TOKEN}`);
  console.log("  Join link:    ", `${origin}/?join=${SEED_RUN_CODE}`);
  console.log(`  Fake logins: waitplayer1${SEED_EMAIL_SUFFIX} … waitplayer18… / ${PASSWORD}`);
  console.log("  Sign in with your real account and join — you should see Waitlist #1 and read-only calendar.");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(e);
  process.exit(1);
} finally {
  db.close();
}
