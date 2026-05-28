/**
 * June 2026 default-run demo:
 * - 30 players joined
 * - some have saved availability, some have not
 * - ensures at least one 24-man (4h) window and 3x 18-man (3h) windows
 *
 * Re-run anytime: removes prior seed run + users @seed-june2026.volleyball
 */
import bcrypt from "bcryptjs";
import { openDb } from "./db.js";
import { slotKeyFromParts } from "../slotKeys.js";

const SEED_EMAIL_SUFFIX = "@seed-june2026.volleyball";
const SEED_SHARE_TOKEN = "demojune2026defaultweekendrunx";
const SEED_RUN_CODE = "JUNE2026";
const SEED_RUN_TITLE = "Weekend volleyball — June 2026 (demo)";
const SEEDED_PLAYERS = 30;
const PASSWORD = "seedjune2026";

const DATE_START = "2026-06-01";
const DATE_END = "2026-06-30";
const TARGETS_JSON = JSON.stringify([12, 18, 24]);
const WEEKDAYS_JSON = JSON.stringify([0, 5, 6]); // Fri/Sat/Sun only

function keysFor(ymd, hours) {
  const [y, m, d] = ymd.split("-").map(Number);
  return hours.map((h) => slotKeyFromParts(y, m, d, h));
}

// 24-man needs a 4-hour block.
const WINDOW_24_4H = keysFor("2026-06-13", [18, 19, 20, 21]); // Sat
// Three distinct 18-man windows (3-hour blocks).
const WINDOWS_18_3H = [
  keysFor("2026-06-19", [19, 20, 21]), // Fri
  keysFor("2026-06-20", [18, 19, 20]), // Sat
  keysFor("2026-06-21", [18, 19, 20]), // Sun
];

const slots18Json = JSON.stringify([...WINDOW_24_4H, ...WINDOWS_18_3H.flat()].sort());
const slots24OnlyJson = JSON.stringify([...WINDOW_24_4H].sort());

const db = openDb();
const hash = bcrypt.hashSync(PASSWORD, 8);

db.exec("BEGIN");
try {
  // Remove previous seeded users and run (and any memberships/availability via FK cascade).
  db.prepare("DELETE FROM runs WHERE share_token = ?").run(SEED_SHARE_TOKEN);
  db.prepare("DELETE FROM runs WHERE run_code = ?").run(SEED_RUN_CODE);
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
      `june2026p${i}${SEED_EMAIL_SUFFIX}`,
      hash
    );
    fakeIds.push(Number(info.lastInsertRowid));
  }

  const creatorId = fakeIds[0];
  const runInfo = db
    .prepare(
      `INSERT INTO runs (
         creator_id, title, capacity, date_start, date_end,
         included_weekdays, target_roster_sizes, run_code, share_token, is_default
       ) VALUES (?, ?, 24, ?, ?, ?, ?, ?, ?, 1)`
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
    const joinedAt = `2026-06-01 ${String(10 + i).padStart(2, "0")}:00:00`;
    insertMember.run(runId, fakeIds[i], joinedAt);
  }

  const insertAv = db.prepare(
    `INSERT INTO availability (run_id, user_id, slots_json, updated_at, first_saved_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  // Players 1..18: save enough for 3x 18-man windows and also the 24-man 4h window.
  for (let i = 0; i < 18; i++) {
    const uid = fakeIds[i];
    const savedAt = `2026-06-02 ${String(8 + i).padStart(2, "0")}:00:00`;
    insertAv.run(runId, uid, slots18Json, savedAt, savedAt);
  }
  // Players 19..24: only save the 24-man 4h block (still contributes to the 24-man window).
  for (let i = 18; i < 24; i++) {
    const uid = fakeIds[i];
    const savedAt = `2026-06-03 ${String(8 + (i - 18)).padStart(2, "0")}:00:00`;
    insertAv.run(runId, uid, slots24OnlyJson, savedAt, savedAt);
  }
  // Players 25..30: joined but no availability saved.

  db.exec("COMMIT");

  const origin = process.env.PUBLIC_ORIGIN || "http://localhost:3000";
  console.log("June 2026 demo seed OK.");
  console.log("  Title:        ", SEED_RUN_TITLE);
  console.log("  Run code:     ", SEED_RUN_CODE);
  console.log("  Open run:     ", `${origin}/?run=${SEED_SHARE_TOKEN}`);
  console.log("  Join link:    ", `${origin}/?join=${SEED_RUN_CODE}`);
  console.log(`  Fake logins:  june2026p1${SEED_EMAIL_SUFFIX} … june2026p30… / ${PASSWORD}`);
  console.log("  Ensured windows:");
  console.log("   - 24-man: Sat Jun 13 6–10pm (4h)");
  console.log("   - 18-man: Fri Jun 19 7–10pm; Sat Jun 20 6–9pm; Sun Jun 21 6–9pm");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(e);
  process.exit(1);
} finally {
  db.close();
}

