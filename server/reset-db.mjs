/**
 * Deletes all rows from app tables (runs, members, availability, sessions, users).
 * Schema stays; next app start is an empty database.
 *
 * Usage: node server/reset-db.mjs
 *    or: npm run db:reset
 */
import { openDb } from "./db.js";

const db = openDb();

db.exec("BEGIN");
try {
  db.exec(`
    DELETE FROM availability;
    DELETE FROM run_members;
    DELETE FROM sessions;
    DELETE FROM runs;
    DELETE FROM users;
  `);
  db.exec("COMMIT");
  console.log("Database wiped: users, sessions, runs, memberships, and availability cleared.");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(e);
  process.exit(1);
} finally {
  db.close();
}
