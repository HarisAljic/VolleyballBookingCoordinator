/**
 * 18-capacity run with 20 seeded members (extras 19–20 for waitlist / coalition tests).
 *
 * Three 3-hour wall-clock windows (each = 3 consecutive hourly slot keys):
 *   Window A — May 10, 2026 18:00–21:00 (exclusive end)
 *   Window B — May 17, 2026 18:00–21:00
 *   Window C — May 24, 2026 18:00–21:00
 *
 * Availability:
 *   Players 1–16: windows A, B, and C (nine slot keys each).
 *   Player 17: window B only (three keys).
 *   Player 18: window C only (three keys).
 *   Players 19–20: May 10 only, 18:00–20:00 hourly keys (6–9pm-style block, same as window A span).
 *
 * With 20 joins on an 18-cap run, open-scheduling applies. Waitlist badges (UI) only
 * appear for someone who saves an hour that already has `capacity` others on it
 * (save-time order); join order alone never waitlists.
 *
 * Cleans only this demo: run by share_token + users @seed-abc18.volleyball
 */
import bcrypt from "bcryptjs";
import { openDb } from "./db.js";
import { slotKeyFromParts } from "../slotKeys.js";

const SEED_EMAIL_SUFFIX = "@seed-abc18.volleyball";
const SEED_SHARE_TOKEN = "demoseedabc18windowsvolleyballtokenxx";
const SEED_RUN_CODE = "ABC18W";
const SEED_RUN_TITLE =
  "Demo: 18 cap / 20 joins — 1–16 A+B+C; #17 B; #18 C; #19–20 May10 6–9pm block";
const SEED_MEMBER_TOTAL = 20;
const PASSWORD = "seedabc18";

const DATE_START = "2026-05-01";
const DATE_END = "2026-05-31";

/** Three consecutive hour keys starting at `startHour` (0–23). */
function threeHourWindow(year, month, day, startHour) {
  return [0, 1, 2].map((d) => slotKeyFromParts(year, month, day, startHour + d));
}

function uniqueSorted(keys) {
  return [...new Set(keys)].sort();
}

const WINDOW_A = threeHourWindow(2026, 5, 10, 18);
const WINDOW_B = threeHourWindow(2026, 5, 17, 18);
const WINDOW_C = threeHourWindow(2026, 5, 24, 18);

/** May 10 evening block: 18:00, 19:00, 20:00 (= 6–9pm in three hourly cells; same footprint as window A). */
const MAY10_EVENING_6_TO_9_BLOCK = uniqueSorted([...WINDOW_A]);

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
  for (let i = 1; i <= SEED_MEMBER_TOTAL; i++) {
    const info = insertUser.run(
      `Player`,
      `${i}`,
      `abc18player${i}${SEED_EMAIL_SUFFIX}`,
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
    `INSERT INTO run_members (run_id, user_id, joined_at)
     VALUES (?, ?, datetime('now', '+' || ? || ' seconds'))`
  );
  for (let i = 0; i < fakeIds.length; i++) {
    insertMember.run(runId, fakeIds[i], String(i));
  }

  const insertAv = db.prepare(
    `INSERT INTO availability (run_id, user_id, slots_json, updated_at, first_saved_at)
     VALUES (?, ?, ?, datetime('now', '+' || ? || ' seconds'), datetime('now', '+' || ? || ' seconds'))`
  );
  let saveSeq = 0;
  /** Monotonic timestamps so save-order waitlist is deterministic (matches insert order here). */
  function insertAvailability(userId, slotKeys) {
    const s = String(saveSeq++);
    insertAv.run(runId, userId, JSON.stringify(slotKeys), s, s);
  }

  const slotsCore = uniqueSorted([...WINDOW_A, ...WINDOW_B, ...WINDOW_C]);

  for (let i = 0; i < 16; i++) {
    insertAvailability(fakeIds[i], slotsCore);
  }
  insertAvailability(fakeIds[16], uniqueSorted([...WINDOW_B]));
  insertAvailability(fakeIds[17], uniqueSorted([...WINDOW_C]));
  insertAvailability(fakeIds[18], MAY10_EVENING_6_TO_9_BLOCK);
  insertAvailability(fakeIds[19], MAY10_EVENING_6_TO_9_BLOCK);

  db.exec("COMMIT");

  const origin = process.env.PUBLIC_ORIGIN || "http://localhost:3000";
  console.log("ABC18 seed OK (18 cap, 20 joins — extras for waitlist / coalition tests).");
  console.log("  Window A (3h):", WINDOW_A.join(", "));
  console.log("  Window B (3h):", WINDOW_B.join(", "));
  console.log("  Window C (3h):", WINDOW_C.join(", "));
  console.log("  Players 1–16: A + B + C");
  console.log("  Player 17:    B only");
  console.log("  Player 18:    C only");
  console.log(
    "  Players 19–20: May 10 only — waitlist badges only if an hour already has 18 savers"
  );
  console.log("  Run code:     ", SEED_RUN_CODE);
  console.log("  Open run:     ", `${origin}/?run=${SEED_SHARE_TOKEN}`);
  console.log("  Join link:    ", `${origin}/?join=${SEED_RUN_CODE}`);
  console.log(
    `  Fake logins: abc18player1${SEED_EMAIL_SUFFIX} … abc18player${SEED_MEMBER_TOTAL}… / ${PASSWORD}`
  );
} catch (e) {
  db.exec("ROLLBACK");
  console.error(e);
  process.exit(1);
} finally {
  db.close();
}
