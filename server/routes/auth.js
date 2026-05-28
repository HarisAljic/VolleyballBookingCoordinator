import bcrypt from "bcryptjs";
import { db } from "../db-singleton.js";
import {
  createSession,
  getSessionToken,
  getUserFromRequest,
  requireAuth,
  sessionCookieOptions,
} from "../auth/session.js";
import { ensureUserInDefaultRun } from "../runs/default-runs.js";
import { defaultRunMonthLabel } from "../../default-run-month.js";

function userJson(userRow) {
  return {
    id: userRow.id,
    firstName: userRow.first_name ?? userRow.firstName,
    lastName: userRow.last_name ?? userRow.lastName,
    email: userRow.email,
  };
}

function defaultRunJson(info) {
  if (!info) return null;
  return {
    shareToken: info.shareToken,
    runCode: info.runCode,
    title: info.title,
    year: info.year,
    month: info.month,
    monthLabel: defaultRunMonthLabel(info.year, info.month),
    dateStart: info.dateStart,
    dateEnd: info.dateEnd,
    publicPath: `/?run=${encodeURIComponent(info.shareToken)}`,
  };
}

function authResponse(userRow) {
  const user = userJson(userRow);
  const defaultRun = defaultRunJson(ensureUserInDefaultRun(user.id));
  return { user, defaultRun };
}

export function registerAuthRoutes(app) {
  app.post("/api/auth/register", (req, res) => {
    const { firstName, lastName, email, password } = req.body || {};
    if (
      !firstName?.trim() ||
      !lastName?.trim() ||
      !email?.trim() ||
      !password
    ) {
      res.status(400).json({ error: "All fields are required." });
      return;
    }
    if (String(password).length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters." });
      return;
    }
    const em = String(email).trim().toLowerCase();
    const hash = bcrypt.hashSync(String(password), 10);
    try {
      const info = db
        .prepare(
          `INSERT INTO users (first_name, last_name, email, password_hash)
           VALUES (?, ?, ?, ?)`
        )
        .run(firstName.trim(), lastName.trim(), em, hash);
      const { token, expiresAt } = createSession(info.lastInsertRowid);
      res.cookie("sid", token, sessionCookieOptions(req));
      res.status(201).json({
        ...authResponse({
          id: info.lastInsertRowid,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: em,
        }),
        sessionExpiresAt: expiresAt,
      });
    } catch (e) {
      if (String(e).includes("UNIQUE")) {
        res.status(409).json({ error: "An account with this email already exists." });
        return;
      }
      throw e;
    }
  });

  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body || {};
    if (!email?.trim() || !password) {
      res.status(400).json({ error: "Email and password are required." });
      return;
    }
    const em = String(email).trim().toLowerCase();
    const user = db
      .prepare(
        "SELECT id, first_name, last_name, email, password_hash FROM users WHERE email = ?"
      )
      .get(em);
    if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }
    const { token, expiresAt } = createSession(user.id);
    res.cookie("sid", token, sessionCookieOptions(req));
    res.json({
      ...authResponse(user),
      sessionExpiresAt: expiresAt,
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = getSessionToken(req);
    if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    res.clearCookie("sid", { path: "/", secure: Boolean(req.secure) });
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    const user = getUserFromRequest(req);
    if (!user) {
      res.json({ user: null });
      return;
    }
    res.json(authResponse(user));
  });
}

export { requireAuth, getUserFromRequest };
