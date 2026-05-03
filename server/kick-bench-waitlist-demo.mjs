/**
 * Removes waitplayer1 + waitplayer2 (Bench 1 & 2) from the waitlist seed run (WL18DM)
 * so two active roster spots open. Waitlisted users (if any) move up in FIFO order.
 *
 * Usage: node server/kick-bench-waitlist-demo.mjs
 */
import { openDb } from "./db.js";

const RUN_CODE = "WL18DM";
const KICK_EMAILS = [
  "waitplayer1@seed-waitlist.volleyball",
  "waitplayer2@seed-waitlist.volleyball",
];

const db = openDb();

const run = db
  .prepare("SELECT id, creator_id, title FROM runs WHERE run_code = ?")
  .get(RUN_CODE);
if (!run) {
  console.error(`No run with code ${RUN_CODE}. Run: npm run seed:waitlist`);
  process.exit(1);
}

const userIds = [];
for (const email of KICK_EMAILS) {
  const u = db.prepare("SELECT id FROM users WHERE lower(email) = lower(?)").get(email);
  if (!u) {
    console.warn(`No user ${email} — skip.`);
    continue;
  }
  userIds.push(Number(u.id));
}

if (!userIds.length) {
  console.error("Neither Bench account exists in the DB.");
  process.exit(1);
}

const txn = db.transaction(() => {
  const creatorWasKicked = userIds.includes(Number(run.creator_id));
  for (const uid of userIds) {
    const mem = db
      .prepare(
        "SELECT 1 FROM run_members WHERE run_id = ? AND user_id = ?"
      )
      .get(run.id, uid);
    if (!mem) {
      console.warn(`User ${uid} not on run ${run.id} — skip.`);
      continue;
    }
    db.prepare("DELETE FROM availability WHERE run_id = ? AND user_id = ?").run(
      run.id,
      uid
    );
    db.prepare("DELETE FROM run_members WHERE run_id = ? AND user_id = ?").run(
      run.id,
      uid
    );
    console.log(`Removed user ${uid} from run "${run.title}".`);
  }

  const remaining = db
    .prepare("SELECT COUNT(*) AS n FROM run_members WHERE run_id = ?")
    .get(run.id)?.n;
  if (remaining === 0) {
    db.prepare("DELETE FROM runs WHERE id = ?").run(run.id);
    console.log("Run deleted (no members left).");
    return;
  }

  if (creatorWasKicked) {
    const next = db
      .prepare(
        `SELECT user_id FROM run_members WHERE run_id = ? ORDER BY joined_at ASC, rowid ASC LIMIT 1`
      )
      .get(run.id);
    if (next) {
      db.prepare("UPDATE runs SET creator_id = ? WHERE id = ?").run(
        next.user_id,
        run.id
      );
      console.log(`Creator reassigned to user ${next.user_id}.`);
    }
  }
});

txn();

console.log(
  "Done. Reload the run page — active roster should show two open spots (others promoted by join order)."
);
db.close();
