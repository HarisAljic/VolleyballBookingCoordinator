import { openDb } from "./db.js";

/** Shared DB connection for the server process. */
export const db = openDb();
