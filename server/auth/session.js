import { nanoid } from "nanoid";
import { db } from "../db-singleton.js";

export const SESSION_DAYS = 14;
export const SESSION_MS = SESSION_DAYS * 86400000;

export function sessionCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_MS,
    path: "/",
    secure: Boolean(req.secure),
  };
}

export function clearExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
}

export function getSessionToken(req) {
  return req.cookies?.sid || null;
}

export function createSession(userId) {
  const token = nanoid(48);
  const expiresAt = Date.now() + SESSION_MS;
  db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
  ).run(token, userId, expiresAt);
  return { token, expiresAt };
}

export function getUserFromRequest(req) {
  clearExpiredSessions();
  const token = getSessionToken(req);
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.first_name, u.last_name, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, Date.now());
  return row || null;
}

export function requireAuth(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  req.user = user;
  next();
}
