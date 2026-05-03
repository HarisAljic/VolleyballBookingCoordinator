/**
 * 18-capacity run with 17 seeded players + one open slot (join with your account).
 * All seeded users share identical availability. After you join as the 18th member and
 * save the same evening slots on the May dates below, overlap matches everyone else.
 *
 * Cleans only this demo: run by share_token + users @seed-overlap18.volleyball
 */
import bcrypt from "bcryptjs";
import { openDb } from "./db.js";
import { slotKeyFromParts } from "../slotKeys.js";

const SEED_EMAIL_SUFFIX = "@seed-overlap18.volleyball";
const SEED_SHARE_TOKEN = "demoseedoverlap18mayvolleyballtokenxxx";
const SEED_RUN_CODE = "MAYOVL";
const SEED_RUN_TITLE = "May multi-day overlap demo (17 / 18 — join for full grid)";
const SEEDED_PLAYERS = 17;
const PASSWORD = "seedoverlap18";

const DATE_START = "2026-05-01";
const DATE_END = "2026-05-31";

/** Same wall-clock slots on each of these May 2026 days (everyone identical → full intersection). */
const SHARED_DAYS_OF_MONTH = [3, 10, 17, 24, 31];
const SHARED_HOURS = [18, 19, 20, 21];

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
      `Player`,
      `${i}`,
      `overlap18player${i}${SEED_EMAIL_SUFFIX}`,
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
  const dayLabel = SHARED_DAYS_OF_MONTH.map((d) => `May ${d}`).join(", ");
  console.log("Overlap-18 seed OK (17 seeded + 1 empty seat).");
  console.log("  Shared calendar days (2026):", dayLabel, `(hours ${SHARED_HOURS[0]}:00–${SHARED_HOURS[SHARED_HOURS.length - 1] + 1}:00 each day)`);
  console.log("  Run code:     ", SEED_RUN_CODE);
  console.log("  Open run:     ", `${origin}/?run=${SEED_SHARE_TOKEN}`);
  console.log("  Join link:    ", `${origin}/?join=${SEED_RUN_CODE}`);
  console.log(`  Fake logins: overlap18player1${SEED_EMAIL_SUFFIX} … overlap18player17… / ${PASSWORD}`);
  console.log("  Join with your account (18th spot). Then pick the same evening cells on those May dates and Save — overlap fills in at 18/18.");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(e);
  process.exit(1);
} finally {
  db.close();
}
