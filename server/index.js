import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { nanoid, customAlphabet } from "nanoid";
import { openDb } from "./db.js";
import {
  computeBookingWindowCandidates,
  groupBookingRentalsByStart,
  splitViewerRentalMatchByWaitlist,
  viewerMatchedRentalOptionNumbers as computeViewerMatchedRentalNumbers,
} from "./booking-candidates.js";
import { checkSkeddaVenues } from "./courtChecker.js";
import {
  dateFromSlotKey,
  firstFutureSlotKey,
  normalizeSlotKey,
  slotKeyFromParts,
  slotKeyToWindowIso,
} from "../slotKeys.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const app = express();
const db = openDb();
const PORT = Number(process.env.PORT) || 3000;

/** Set TRUST_PROXY=1 when the app sits behind ngrok or another HTTPS reverse proxy so req.secure is correct for cookies. */
if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}

function sessionCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_MS,
    path: "/",
    secure: Boolean(req.secure),
  };
}

const codeAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
const SESSION_DAYS = 14;
const SESSION_MS = SESSION_DAYS * 86400000;

function randomRunCode() {
  for (let i = 0; i < 20; i++) {
    const c = codeAlphabet();
    const exists = db.prepare("SELECT 1 FROM runs WHERE run_code = ?").get(c);
    if (!exists) return c;
  }
  return codeAlphabet() + codeAlphabet().slice(0, 2);
}

function createSession(userId) {
  const token = nanoid(48);
  const expiresAt = Date.now() + SESSION_MS;
  db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
  ).run(token, userId, expiresAt);
  return { token, expiresAt };
}

function clearExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
}

function getSessionToken(req) {
  return req.cookies?.sid || null;
}

function getUserFromRequest(req) {
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

function requireAuth(req, res, next) {
  const user = getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  req.user = user;
  next();
}

function parseSlots(body) {
  if (!body || !Array.isArray(body.slots)) {
    return null;
  }
  const slots = [
    ...new Set(
      body.slots
        .filter((s) => typeof s === "string" && s.length > 0)
        .map((s) => normalizeSlotKey(s))
        .filter(Boolean)
    ),
  ];
  return slots;
}

function getRunByShareToken(token) {
  return db
    .prepare(
      `SELECT r.*, u.first_name AS creator_first, u.last_name AS creator_last
       FROM runs r JOIN users u ON u.id = r.creator_id
       WHERE r.share_token = ?`
    )
    .get(token);
}

function memberCount(runId) {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM run_members WHERE run_id = ?")
    .get(runId);
  return row?.n ?? 0;
}

function listMembers(runId) {
  return db
    .prepare(
      `SELECT u.id, u.first_name, u.last_name
       FROM run_members m JOIN users u ON u.id = m.user_id
       WHERE m.run_id = ?
       ORDER BY m.joined_at ASC, m.rowid ASC`
    )
    .all(runId);
}

function userInRun(runId, userId) {
  return !!db
    .prepare(
      "SELECT 1 FROM run_members WHERE run_id = ? AND user_id = ?"
    )
    .get(runId, userId);
}

function orderedMemberUserIds(runId) {
  return db
    .prepare(
      `SELECT user_id FROM run_members WHERE run_id = ? ORDER BY joined_at ASC, rowid ASC`
    )
    .all(runId)
    .map((r) => Number(r.user_id));
}

function activeRosterUserIds(runId, capacity) {
  return orderedMemberUserIds(runId).slice(0, capacity);
}

/** Intersection of saved hourly slots for exactly these users (order preserved for first-id tie-break only). */
function intersectionSlotsForUserIds(runId, userIds) {
  if (!userIds.length) return [];
  const sets = [];
  for (const uid of userIds) {
    const row = db
      .prepare(
        "SELECT slots_json FROM availability WHERE run_id = ? AND user_id = ?"
      )
      .get(runId, uid);
    if (!row) return [];
    let raw = [];
    try {
      raw = JSON.parse(row.slots_json || "[]");
    } catch {
      raw = [];
    }
    const keys = Array.isArray(raw)
      ? raw.map((s) => normalizeSlotKey(String(s))).filter(Boolean)
      : [];
    sets.push(new Set(keys));
  }
  if (!sets.length) return [];
  let acc = sets[0];
  for (let i = 1; i < sets.length; i++) {
    acc = new Set([...acc].filter((x) => sets[i].has(x)));
  }
  return [...acc].sort();
}

function intersectionSlots(runId, capacity) {
  const activeIds = activeRosterUserIds(runId, capacity);
  if (activeIds.length < capacity) return [];
  return intersectionSlotsForUserIds(runId, activeIds);
}

function memberHasNonEmptyAvailability(runId, userId) {
  const row = db
    .prepare(
      "SELECT slots_json FROM availability WHERE run_id = ? AND user_id = ?"
    )
    .get(runId, userId);
  if (!row) return false;
  try {
    const arr = JSON.parse(row.slots_json || "[]");
    return Array.isArray(arr) && arr.length > 0;
  } catch {
    return false;
  }
}

/**
 * Home /runs/mine badges: enough calendars saved vs still recruiting or no common hour.
 */
function homeRunListBadgeFlags(runId, capacity) {
  const cap = Math.max(1, Number(capacity)) || 12;
  const orderedIds = orderedMemberUserIds(runId);
  const count = orderedIds.length;
  let membersWithAnySave = 0;
  for (const uid of orderedIds) {
    if (memberHasNonEmptyAvailability(runId, uid)) membersWithAnySave++;
  }
  const runFound = membersWithAnySave >= cap;
  const fullRoster = count >= cap;
  const idsForOverlap = fullRoster ? orderedIds.slice(0, cap) : orderedIds;
  const overlap =
    idsForOverlap.length > 0
      ? intersectionSlotsForUserIds(runId, idsForOverlap)
      : [];
  const noSharedWindow = idsForOverlap.length > 0 && overlap.length === 0;
  /** Mutually exclusive with runFound: only show one home-list indicator. */
  const acceptingPlayers =
    !runFound && (count < cap || noSharedWindow);
  return { runFound, acceptingPlayers };
}

/** Maximal runs of consecutive wall-clock hours in sorted overlap keys. */
function contiguousOverlapRuns(sortedOverlapKeys) {
  const keys = [...(sortedOverlapKeys || [])]
    .map((x) => normalizeSlotKey(String(x)))
    .filter(Boolean)
    .sort();
  const runs = [];
  let cur = [];
  for (const k of keys) {
    if (!cur.length) {
      cur.push(k);
      continue;
    }
    const prevT = dateFromSlotKey(cur[cur.length - 1]);
    const curT = dateFromSlotKey(k);
    if (
      prevT &&
      curT &&
      !Number.isNaN(prevT.getTime()) &&
      !Number.isNaN(curT.getTime()) &&
      curT.getTime() - prevT.getTime() === 3600000
    ) {
      cur.push(k);
    } else {
      runs.push(cur);
      cur = [k];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** True if intersection includes any contiguous 2h+ block (same definition as 2/3/4h booking tiles). */
function hasSharedBookableContiguousWindow(sortedOverlapKeys) {
  return contiguousOverlapRuns(sortedOverlapKeys).some((r) => r.length >= 2);
}

/**
 * When more than `capacity` people have joined, we only lock extras’ calendars
 * after everyone’s availability intersects in a contiguous 2+ hour window.
 * Until then, all members may save availability.
 */
function schedulingWaitlistLocked(runId, capacity) {
  const count = memberCount(runId);
  if (count <= capacity) return false;
  const allIds = orderedMemberUserIds(runId);
  const overlapAll = intersectionSlotsForUserIds(runId, allIds);
  return hasSharedBookableContiguousWindow(overlapAll);
}

function canSetAvailability(runId, userId, capacity) {
  const ids = orderedMemberUserIds(runId);
  const idx = ids.indexOf(Number(userId));
  if (idx < 0) return false;
  if (idx < capacity) return true;
  return !schedulingWaitlistLocked(runId, capacity);
}

/**
 * Among members with non-empty saved slots, order by first save time
 * (first_saved_at, then updated_at, then user_id).
 */
function userIdsWithAvailabilityOrderedBySaveTime(runId) {
  const rows = db
    .prepare(
      `SELECT user_id, slots_json, updated_at,
        COALESCE(NULLIF(TRIM(first_saved_at), ''), updated_at) AS sort_ts
       FROM availability WHERE run_id = ?`
    )
    .all(runId);
  const items = [];
  for (const row of rows) {
    try {
      const arr = JSON.parse(row.slots_json || "[]");
      if (!Array.isArray(arr) || arr.length === 0) continue;
      items.push({
        userId: Number(row.user_id),
        sortTs: String(row.sort_ts || ""),
      });
    } catch {
      /* ignore */
    }
  }
  items.sort((a, b) => {
    const t = a.sortTs.localeCompare(b.sortTs);
    if (t !== 0) return t;
    return a.userId - b.userId;
  });
  return items.map((x) => x.userId);
}

function loadOrderedAvailabilitySlots(runId) {
  const orderedUids = userIdsWithAvailabilityOrderedBySaveTime(runId);
  if (!orderedUids.length) {
    return { orderedUids: [], slotsByUser: new Map() };
  }
  const placeholders = orderedUids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT user_id, slots_json FROM availability WHERE run_id = ? AND user_id IN (${placeholders})`
    )
    .all(runId, ...orderedUids);
  const slotsByUser = new Map();
  for (const r of rows) {
    try {
      const raw = JSON.parse(r.slots_json || "[]");
      const slots = Array.isArray(raw)
        ? [
            ...new Set(
              raw
                .map((s) => normalizeSlotKey(String(s)))
                .filter(Boolean)
            ),
          ]
        : [];
      slotsByUser.set(Number(r.user_id), slots);
    } catch {
      slotsByUser.set(Number(r.user_id), []);
    }
  }
  return { orderedUids, slotsByUser };
}

/** Per-slot counts from everyone who saves before `userId` in first-save-time order. */
function slotCountsBeforeUserInSaveOrder(runId, userId) {
  const { orderedUids, slotsByUser } = loadOrderedAvailabilitySlots(runId);
  const slotCounts = new Map();
  for (const uid of orderedUids) {
    if (Number(uid) === Number(userId)) return slotCounts;
    const slots = slotsByUser.get(uid) || [];
    for (const k of slots) {
      slotCounts.set(k, (slotCounts.get(k) || 0) + 1);
    }
  }
  return slotCounts;
}

/**
 * In save-time order, count prior savers per hour. Someone is waitlisted only
 * when every hour they save already has a full roster (`rosterCapacity`) of
 * prior savers on that same hour — i.e. they would be the (capacity+1)th on
 * that whole selection, matching “full at cap people, waitlist at cap+1” for
 * multi-hour windows (not the first hour hitting cap while another is still sparse).
 */
function waitlistBySaturatedHourSimulation(runId, rosterCapacity) {
  const { orderedUids, slotsByUser } = loadOrderedAvailabilitySlots(runId);
  if (!orderedUids.length) {
    return {
      waitlistedIds: new Set(),
      waitlistRankByUserId: new Map(),
      waitlistCount: 0,
    };
  }
  const capN = Math.max(1, Number(rosterCapacity)) || 1;
  const slotCounts = new Map();
  const waitlistedIds = new Set();
  const waitlistOrder = [];
  for (const uid of orderedUids) {
    const slots = slotsByUser.get(uid) || [];
    if (!slots.length) continue;
    const hitsSaturatedHour = slots.every(
      (k) => (slotCounts.get(k) || 0) >= capN
    );
    if (hitsSaturatedHour) {
      waitlistedIds.add(uid);
      waitlistOrder.push(uid);
    }
    for (const k of slots) {
      slotCounts.set(k, (slotCounts.get(k) || 0) + 1);
    }
  }
  const waitlistRankByUserId = new Map();
  waitlistOrder.forEach((uid, i) => {
    waitlistRankByUserId.set(uid, i + 1);
  });
  return {
    waitlistedIds,
    waitlistRankByUserId,
    waitlistCount: waitlistedIds.size,
  };
}

app.disable("x-powered-by");
app.use(express.json({ limit: "400kb" }));
app.use(cookieParser());

app.use((req, res, next) => {
  if (/\.(js|html)$/i.test(req.path)) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
  }
  next();
});

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
      ).run(firstName.trim(), lastName.trim(), em, hash);
    const { token, expiresAt } = createSession(info.lastInsertRowid);
    res.cookie("sid", token, sessionCookieOptions(req));
    res.status(201).json({
      user: {
        id: info.lastInsertRowid,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: em,
      },
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
    user: {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
    },
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
  res.json({
    user: {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
    },
  });
});

app.post("/api/runs", requireAuth, (req, res) => {
  const { title, capacity, dateStart, dateEnd } = req.body || {};
  const cap = Number(capacity);
  if (!title?.trim() || ![12, 18, 24].includes(cap) || !dateStart || !dateEnd) {
    res.status(400).json({
      error: "title, capacity (12, 18, or 24), dateStart, and dateEnd are required.",
    });
    return;
  }
  if (String(dateEnd) < String(dateStart)) {
    res.status(400).json({ error: "dateEnd must be on or after dateStart." });
    return;
  }
  const runCode = randomRunCode();
  const shareToken = nanoid(32);
  const info = db
    .prepare(
      `INSERT INTO runs (creator_id, title, capacity, date_start, date_end, run_code, share_token)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      title.trim(),
      cap,
      String(dateStart),
      String(dateEnd),
      runCode,
      shareToken
    );
  const runId = info.lastInsertRowid;
  db.prepare(
    "INSERT INTO run_members (run_id, user_id) VALUES (?, ?)"
  ).run(runId, req.user.id);
  res.status(201).json({
    id: runId,
    shareToken,
    runCode,
    joinPath: `/?join=${encodeURIComponent(runCode)}`,
    publicPath: `/?run=${encodeURIComponent(shareToken)}`,
  });
});

app.get("/api/runs/mine", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*,
        (SELECT COUNT(*) FROM run_members m WHERE m.run_id = r.id) AS member_count
       FROM runs r
       WHERE r.creator_id = ?
          OR EXISTS (SELECT 1 FROM run_members m WHERE m.run_id = r.id AND m.user_id = ?)
       ORDER BY r.created_at DESC`
    )
    .all(req.user.id, req.user.id);
  for (const r of rows) {
    r.publicUrl = `/?run=${encodeURIComponent(r.share_token)}`;
    const { runFound, acceptingPlayers } = homeRunListBadgeFlags(
      r.id,
      r.capacity
    );
    r.runFound = runFound;
    r.acceptingPlayers = acceptingPlayers;
  }
  res.json({ runs: rows });
});

app.get("/api/runs/by-code/:code", (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  const run = db
    .prepare(
      `SELECT r.id, r.title, r.capacity, r.date_start, r.date_end, r.run_code, r.share_token
       FROM runs r WHERE r.run_code = ?`
    )
    .get(code);
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }
  res.json({
    id: run.id,
    title: run.title,
    capacity: run.capacity,
    dateStart: run.date_start,
    dateEnd: run.date_end,
    runCode: run.run_code,
    shareToken: run.share_token,
    memberCount: memberCount(run.id),
    publicPath: `/?run=${encodeURIComponent(run.share_token)}`,
  });
});

app.get("/api/runs/public/:token", (req, res) => {
  const run = getRunByShareToken(req.params.token);
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }
  const count = memberCount(run.id);
  const cap = run.capacity;
  const members = listMembers(run.id);
  const orderedIds = orderedMemberUserIds(run.id);
  const user = getUserFromRequest(req);
  const mine = user ? userInRun(run.id, user.id) : false;
  const myIndex =
    user && mine ? orderedIds.indexOf(Number(user.id)) : -1;
  const wlLocked = schedulingWaitlistLocked(run.id, cap);
  const viewerOnWaitlist = mine && myIndex >= cap && wlLocked;
  const viewerIsActiveRoster = mine && myIndex >= 0 && myIndex < cap;
  const viewerCanSetAvailability =
    mine && canSetAvailability(run.id, user.id, cap);

  let mySlots = [];
  if (user && mine) {
    const a = db
      .prepare(
        "SELECT slots_json FROM availability WHERE run_id = ? AND user_id = ?"
      )
      .get(run.id, user.id);
    if (a) {
      try {
        const raw = JSON.parse(a.slots_json);
        mySlots = Array.isArray(raw)
          ? raw.map((s) => normalizeSlotKey(String(s))).filter(Boolean)
          : [];
      } catch {
        mySlots = [];
      }
    }
  }
  const full = count >= cap;
  const {
    waitlistedIds,
    waitlistRankByUserId,
    waitlistCount,
  } = waitlistBySaturatedHourSimulation(run.id, cap);
  let overlap = [];
  if (count >= cap) {
    const overlapUserIds = wlLocked
      ? activeRosterUserIds(run.id, cap)
      : orderedIds;
    if (wlLocked && overlapUserIds.length >= cap) {
      overlap = intersectionSlotsForUserIds(run.id, overlapUserIds);
    } else if (!wlLocked && overlapUserIds.length > 0) {
      overlap = intersectionSlotsForUserIds(run.id, overlapUserIds);
    }
  }

  const heatmapUserIds = orderedIds;
  let avRows = [];
  if (heatmapUserIds.length > 0) {
    const placeholders = heatmapUserIds.map(() => "?").join(",");
    avRows = db
      .prepare(
        `SELECT a.user_id, a.slots_json, u.first_name, u.last_name
         FROM availability a
         JOIN users u ON u.id = a.user_id
         WHERE a.run_id = ? AND a.user_id IN (${placeholders})`
      )
      .all(run.id, ...heatmapUserIds);
    avRows.sort(
      (a, b) =>
        heatmapUserIds.indexOf(Number(a.user_id)) -
        heatmapUserIds.indexOf(Number(b.user_id))
    );
  }

  const memberAvailability = avRows.map((r) => {
    let slots = [];
    try {
      const raw = JSON.parse(r.slots_json || "[]");
      slots = Array.isArray(raw)
        ? raw.map((s) => normalizeSlotKey(String(s))).filter(Boolean)
        : [];
    } catch {
      slots = [];
    }
    return {
      userId: Number(r.user_id),
      firstName: r.first_name,
      lastName: r.last_name,
      slots,
    };
  });

  const countIdsForLock = wlLocked
    ? activeRosterUserIds(run.id, cap)
    : orderedIds;
  let membersWithAvailability = 0;
  for (const uid of countIdsForLock) {
    const row = db
      .prepare(
        "SELECT slots_json FROM availability WHERE run_id = ? AND user_id = ?"
      )
      .get(run.id, uid);
    if (!row) continue;
    try {
      const arr = JSON.parse(row.slots_json || "[]");
      if (Array.isArray(arr) && arr.length > 0) membersWithAvailability++;
    } catch {
      /* ignore */
    }
  }

  const activeRosterCount = Math.min(count, cap);

  /** Coalition coverage: extras count while scheduling is open (!wlLocked); after lock only first-cap roster. */
  const bookingCandidateUserIds = wlLocked
    ? activeRosterUserIds(run.id, cap)
    : orderedIds;
  let bookingWindowCandidates = [];
  if (count >= 2 && bookingCandidateUserIds.length > 0) {
    bookingWindowCandidates = computeBookingWindowCandidates(db, run.id, {
      rosterUserIdsBooking: bookingCandidateUserIds,
      rosterCapacity: cap,
      dateStartStr: run.date_start,
      dateEndStr: run.date_end,
    });
  }
  const bookingRentalGroups = groupBookingRentalsByStart(bookingWindowCandidates);
  const viewerMatchedRentalOptionNums =
    mine && mySlots.length > 0
      ? computeViewerMatchedRentalNumbers(mySlots, bookingRentalGroups)
      : [];
  let viewerWaitlistedRentalOptionNums = [];
  let viewerFitsRentalOptionNums = [];
  if (mine && user && mySlots.length > 0 && bookingRentalGroups.length > 0) {
    const countsBefore = slotCountsBeforeUserInSaveOrder(run.id, user.id);
    const split = splitViewerRentalMatchByWaitlist(
      mySlots,
      bookingRentalGroups,
      countsBefore,
      cap
    );
    viewerWaitlistedRentalOptionNums = split.waitlisted;
    viewerFitsRentalOptionNums = split.fits;
  }

  const payload = {
    id: run.id,
    title: run.title,
    capacity: cap,
    dateStart: run.date_start,
    dateEnd: run.date_end,
    runCode: run.run_code,
    memberCount: count,
    activeRosterCount,
    waitlistCount,
    schedulingWaitlistActive: wlLocked,
    isFull: full,
    members: members.map((m) => {
      const uid = Number(m.id);
      const wl = waitlistedIds.has(uid);
      return {
        id: uid,
        firstName: m.first_name,
        lastName: m.last_name,
        waitlisted: wl,
        waitlistRank: wl ? waitlistRankByUserId.get(uid) ?? null : null,
      };
    }),
    viewerIsMember: mine,
    viewerIsActiveRoster,
    viewerQueuedForRoster:
      mine && user ? waitlistedIds.has(Number(user.id)) : false,
    viewerCanSetAvailability,
    viewerOnWaitlist,
    viewerId: user ? Number(user.id) : null,
    viewerSlots: mySlots,
    overlapSlots: overlap,
    bookingWindowCandidates,
    bookingRentalGroups,
    viewerMatchedRentalOptionNumbers: viewerMatchedRentalOptionNums,
    viewerWaitlistedRentalOptionNumbers: viewerWaitlistedRentalOptionNums,
    viewerFitsRentalOptionNumbers: viewerFitsRentalOptionNums,
    memberAvailability,
    membersWithAvailability,
    rosterSize: wlLocked ? cap : count,
  };

  if (req.query.diag === "1") {
    payload.diag = {
      memberAvailabilityRows: memberAvailability.length,
      slotCounts: memberAvailability.map((m) => ({
        userId: m.userId,
        n: m.slots.length,
        sample: m.slots.slice(0, 4),
      })),
      serverReferenceKeyMay9_18: slotKeyFromParts(2026, 5, 9, 18),
      mine,
      viewerId: payload.viewerId,
    };
  }

  res.json(payload);
});

app.post("/api/runs/:id/join", requireAuth, (req, res) => {
  const runId = Number(req.params.id);
  const run = db.prepare("SELECT id, capacity FROM runs WHERE id = ?").get(runId);
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }
  if (userInRun(runId, req.user.id)) {
    res.json({ ok: true, alreadyMember: true });
    return;
  }
  db.prepare(
    "INSERT INTO run_members (run_id, user_id) VALUES (?, ?)"
  ).run(runId, req.user.id);
  res.status(201).json({ ok: true });
});

app.post("/api/runs/join-by-code", requireAuth, (req, res) => {
  const code = String(req.body?.code || "").trim().toUpperCase();
  if (!code) {
    res.status(400).json({ error: "code is required." });
    return;
  }
  const run = db.prepare("SELECT id, capacity FROM runs WHERE run_code = ?").get(code);
  if (!run) {
    res.status(404).json({ error: "Invalid run code." });
    return;
  }
  if (userInRun(run.id, req.user.id)) {
    res.json({ ok: true, runId: run.id, shareToken: db.prepare("SELECT share_token FROM runs WHERE id = ?").get(run.id).share_token });
    return;
  }
  db.prepare(
    "INSERT INTO run_members (run_id, user_id) VALUES (?, ?)"
  ).run(run.id, req.user.id);
  const { share_token: shareToken } = db
    .prepare("SELECT share_token FROM runs WHERE id = ?")
    .get(run.id);
  res.status(201).json({ ok: true, runId: run.id, shareToken });
});

app.post("/api/runs/public/:token/leave", requireAuth, (req, res) => {
  const run = getRunByShareToken(req.params.token);
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }
  if (!userInRun(run.id, req.user.id)) {
    res.status(403).json({ error: "You are not on this run." });
    return;
  }

  const txn = db.transaction(() => {
    db.prepare("DELETE FROM availability WHERE run_id = ? AND user_id = ?").run(
      run.id,
      req.user.id
    );
    db.prepare("DELETE FROM run_members WHERE run_id = ? AND user_id = ?").run(
      run.id,
      req.user.id
    );
    const remaining = memberCount(run.id);
    if (remaining === 0) {
      db.prepare("DELETE FROM runs WHERE id = ?").run(run.id);
      return { runDeleted: true };
    }
    if (run.creator_id === req.user.id) {
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
      }
    }
    return { runDeleted: false };
  });

  const result = txn();
  res.json({ ok: true, ...result });
});

app.put("/api/runs/public/:token/availability", requireAuth, (req, res) => {
  const run = getRunByShareToken(req.params.token);
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }
  if (!userInRun(run.id, req.user.id)) {
    res.status(403).json({ error: "Join this run before setting availability." });
    return;
  }
  if (!canSetAvailability(run.id, req.user.id, run.capacity)) {
    res.status(403).json({
      error:
        "You are on the waitlist. A shared 2+ hour window is already locked in for the roster; when someone leaves you can move up and set availability again.",
    });
    return;
  }
  const slots = parseSlots(req.body);
  if (!slots) {
    res.status(400).json({ error: "Body must include slots: string[] (ISO timestamps)." });
    return;
  }
  const slotsJson = JSON.stringify(slots);
  db.prepare(
    `INSERT INTO availability (run_id, user_id, slots_json, updated_at, first_saved_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(run_id, user_id) DO UPDATE SET
       slots_json = excluded.slots_json,
       updated_at = excluded.updated_at,
       first_saved_at = COALESCE(availability.first_saved_at, excluded.first_saved_at)`
  ).run(run.id, req.user.id, slotsJson);

  const wlLocked = schedulingWaitlistLocked(run.id, run.capacity);
  const countIds = wlLocked
    ? activeRosterUserIds(run.id, run.capacity)
    : orderedMemberUserIds(run.id);
  let membersWithAvailability = 0;
  for (const uid of countIds) {
    const row = db
      .prepare(
        "SELECT slots_json FROM availability WHERE run_id = ? AND user_id = ?"
      )
      .get(run.id, uid);
    if (!row) continue;
    try {
      const arr = JSON.parse(row.slots_json || "[]");
      if (Array.isArray(arr) && arr.length > 0) membersWithAvailability++;
    } catch {
      /* ignore */
    }
  }

  res.json({
    ok: true,
    count: slots.length,
    membersWithAvailability,
    rosterSize: wlLocked ? run.capacity : memberCount(run.id),
  });
});

app.post("/api/runs/public/:token/check-courts", async (req, res) => {
  const run = getRunByShareToken(req.params.token);
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }
  const count = memberCount(run.id);
  if (count < run.capacity) {
    res.status(400).json({
      error: `Court check needs the active roster filled (${run.capacity} people). ${count} joined so far.`,
    });
    return;
  }
  const overlap = intersectionSlots(run.id, run.capacity);
  let slotStart = req.body?.slotStart;
  let slotEnd = req.body?.slotEnd;
  if (!slotStart || !slotEnd) {
    const pick = firstFutureSlotKey(overlap);
    if (!pick) {
      res.status(400).json({
        error:
          "No shared free slot yet. Everyone must submit availability, and slots must overlap.",
      });
      return;
    }
    const win = slotKeyToWindowIso(pick, 1);
    slotStart = win.slotStartIso;
    slotEnd = win.slotEndIso;
  }
  try {
    const venues = await checkSkeddaVenues(slotStart, slotEnd);
    res.json({
      slotStart,
      slotEnd,
      venues: venues.map((v) => ({
        venueId: v.venueId,
        name: v.name,
        bookingUrl: v.bookingUrl,
        ok: v.ok,
        error: v.error,
        hasAvailableCourt:
          v.hasAvailableCourt === null || v.hasAvailableCourt === undefined
            ? null
            : !!v.hasAvailableCourt,
        note: v.note || null,
        skeddaLoadedRange: v.skeddaLoadedRange || null,
        slotOutsideLoadedRange: !!v.slotOutsideLoadedRange,
        freeSpaceIds: v.freeSpaceIds,
        totalSpaces: v.totalSpaces,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error:
        e instanceof Error
          ? e.message
          : "Court check failed. Ensure Playwright browsers are installed (npx playwright install chromium).",
    });
  }
});

app.use(
  express.static(rootDir, {
    index: ["index.html"],
    extensions: ["html"],
  })
);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Server error." });
});

app.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT}`);
});
