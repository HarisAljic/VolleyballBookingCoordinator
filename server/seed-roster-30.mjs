/**
 * 30-player run for roster-size visibility toggles and slot-based waitlist tags.
 * Everyone shares May weekend hours; save order drives yellow/green tags per 12/18/24.
 *
 * Re-run anytime: removes prior seed run + users @seed-roster30.volleyball
 */
import bcrypt from "bcryptjs";
import { openDb } from "./db.js";
import { slotKeyFromParts } from "../slotKeys.js";

const SEED_EMAIL_SUFFIX = "@seed-roster30.volleyball";
const SEED_SHARE_TOKEN = "demoseed30rosterstiersvolleyballx";
const SEED_RUN_CODE = "ROSTER30";
const SEED_RUN_TITLE = "Roster tiers demo — 30 players";
const SEEDED_PLAYERS = 30;
const PASSWORD = "seedroster30";

const DATE_START = "2026-05-01";
const DATE_END = "2026-05-31";
const TARGETS_JSON = JSON.stringify([12, 18, 24]);
const WEEKDAYS_JSON = JSON.stringify([0, 1, 2, 3, 4, 5, 6]);

function buildSharedSlots() {
  const slots = [];
  for (const day of [10, 17, 24]) {
    for (const h of [18, 19, 20]) {
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
      `roster30p${i}${SEED_EMAIL_SUFFIX}`,
      hash
    );
    fakeIds.push(Number(info.lastInsertRowid));
  }

  const creatorId = fakeIds[0];
  const runInfo = db
    .prepare(
      `INSERT INTO runs (
         creator_id, title, capacity, date_start, date_end,
         included_weekdays, target_roster_sizes, run_code, share_token
       ) VALUES (?, ?, 24, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      creatorId,
      SEED_RUN_TITLE,
      DATE_START,
      DATE_END,
      WEEKDAYS_JSON,
      TARGETS_JSON,
      SEED_RUN_CODE,
      SEED_SHARE_TOKEN
    );
  const runId = Number(runInfo.lastInsertRowid);

  const insertMember = db.prepare(
    `INSERT INTO run_members (run_id, user_id, joined_at)
     VALUES (?, ?, ?)`
  );
  for (let i = 0; i < fakeIds.length; i++) {
    const joinedAt = `2026-05-01 ${String(10 + i).padStart(2, "0")}:00:00`;
    insertMember.run(runId, fakeIds[i], joinedAt);
  }

  const insertAv = db.prepare(
    `INSERT INTO availability (run_id, user_id, slots_json, updated_at, first_saved_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`
  );
  for (const uid of fakeIds) {
    insertAv.run(runId, uid, sharedSlotsJson);
  }

  db.exec("COMMIT");

  const origin = process.env.PUBLIC_ORIGIN || "http://localhost:3000";
  console.log("Roster-30 demo seed OK.");
  console.log("  Title:        ", SEED_RUN_TITLE);
  console.log("  Run code:     ", SEED_RUN_CODE);
  console.log("  Open run:     ", `${origin}/?run=${SEED_SHARE_TOKEN}`);
  console.log("  Join link:    ", `${origin}/?join=${SEED_RUN_CODE}`);
  console.log(`  Fake logins:  roster30p1${SEED_EMAIL_SUFFIX} … roster30p30… / ${PASSWORD}`);
  console.log("  Tags are slot-based (yellow waitlist / green available per 12/18/24), not join order.");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(e);
  process.exit(1);
} finally {
  db.close();
}
