import { dateFromSlotKey, normalizeSlotKey } from "../../slotKeys.js";
import { filterSlotKeysByIncludedWeekdays } from "../../run-weekdays.js";
import { db } from "../db-singleton.js";
import { parseSlots } from "./availability.js";

/** Negative IDs distinguish guests from member user IDs in booking maps. */
export function guestParticipantId(guestRowId) {
  return -Math.abs(Number(guestRowId));
}

export function isGuestParticipantId(id) {
  return Number(id) < 0;
}

export function guestRowIdFromParticipantId(participantId) {
  const n = Number(participantId);
  return n < 0 ? Math.abs(n) : null;
}

/** Trim + lowercase for duplicate-name checks (first+last or first only). */
export function normalizeGuestName(firstName, lastName) {
  const first = String(firstName || "").trim().toLowerCase();
  const last = String(lastName || "").trim().toLowerCase();
  return last ? `${first} ${last}` : first;
}

export function findGuestByNormalizedName(runId, sponsorUserId, firstName, lastName) {
  const target = normalizeGuestName(firstName, lastName);
  if (!target) return null;
  for (const row of listGuestsBySponsor(runId, sponsorUserId)) {
    if (normalizeGuestName(row.first_name, row.last_name) === target) return row;
  }
  return null;
}

function unionSlotKeys(...slotLists) {
  return [
    ...new Set(
      slotLists
        .flat()
        .map((s) => normalizeSlotKey(String(s)))
        .filter(Boolean)
    ),
  ];
}

function slotKeyDayStr(key) {
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(String(key || ""));
  return m ? m[1] : "";
}

function slotKeyHour(key) {
  const d = dateFromSlotKey(String(key || ""));
  return Number.isNaN(d.getTime()) ? null : d.getHours();
}

function groupSlotKeysByDay(sortedKeys) {
  const byDay = new Map();
  for (const k of sortedKeys) {
    const day = slotKeyDayStr(k);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(k);
  }
  return byDay;
}

function contiguousHourRunsFromSorted(sortedKeys) {
  const runs = [];
  let cur = [];
  for (const k of sortedKeys) {
    if (!cur.length) {
      cur.push(k);
      continue;
    }
    const pt = dateFromSlotKey(cur[cur.length - 1]);
    const ct = dateFromSlotKey(k);
    if (pt && ct && ct.getTime() - pt.getTime() === 3600000) cur.push(k);
    else {
      runs.push(cur);
      cur = [k];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** Hour ranges [start, endExclusive) overlap on the same calendar day. */
function hourRangesOverlap(runKeys, newKeys) {
  const runHours = runKeys.map(slotKeyHour).filter((h) => h != null);
  const newHours = newKeys.map(slotKeyHour).filter((h) => h != null);
  if (!runHours.length || !newHours.length) return false;
  const runStart = Math.min(...runHours);
  const runEnd = Math.max(...runHours) + 1;
  const newStart = Math.min(...newHours);
  const newEnd = Math.max(...newHours) + 1;
  return runStart < newEnd && newStart < runEnd;
}

/** Union append, but replace same-day contiguous runs that overlap the new window. */
function appendGuestSlotsReplacingOverlaps(existingSlots, toAppend) {
  const append = unionSlotKeys(toAppend);
  if (!append.length) return unionSlotKeys(existingSlots);
  const result = new Set(unionSlotKeys(existingSlots));
  const appendByDay = groupSlotKeysByDay([...append].sort());
  for (const day of [...appendByDay.keys()].sort()) {
    const newDaySlots = [...(appendByDay.get(day) || [])].sort();
    const existingOnDay = [...result].filter((k) => slotKeyDayStr(k) === day).sort();
    if (existingOnDay.length) {
      for (const run of contiguousHourRunsFromSorted(existingOnDay)) {
        if (hourRangesOverlap(run, newDaySlots)) {
          for (const k of run) result.delete(k);
        }
      }
    }
    for (const k of newDaySlots) result.add(k);
  }
  return [...result].sort();
}

export function guestDisplayName(guest, sponsor) {
  const sponsorName =
    `${sponsor?.first_name || sponsor?.firstName || ""} ${sponsor?.last_name || sponsor?.lastName || ""}`.trim() ||
    "Member";
  const first = String(guest.first_name || guest.firstName || "").trim();
  const last = String(guest.last_name || guest.lastName || "").trim();
  if (last) return `${first} ${last} (${sponsorName} +1)`;
  const name = first || "Guest";
  return `${name} (${sponsorName} +1)`;
}

function parseSlotSavedAtMap(json) {
  let raw = {};
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    raw = {};
  }
  if (!raw || typeof raw !== "object") return new Map();
  const out = new Map();
  for (const [k, v] of Object.entries(raw)) {
    const nk = normalizeSlotKey(String(k));
    const ts = String(v || "").trim();
    if (nk && ts) out.set(nk, ts);
  }
  return out;
}

function parseGuestSlots(json, includedWeekdays = null) {
  let raw = [];
  try {
    raw = JSON.parse(json || "[]");
  } catch {
    raw = [];
  }
  let slots = Array.isArray(raw)
    ? [...new Set(raw.map((s) => normalizeSlotKey(String(s))).filter(Boolean))]
    : [];
  if (includedWeekdays != null) {
    slots = filterSlotKeysByIncludedWeekdays(slots, includedWeekdays);
  }
  return slots;
}

export function listGuestsForRun(runId) {
  return db
    .prepare(
      `SELECT g.*, u.first_name AS sponsor_first_name, u.last_name AS sponsor_last_name
       FROM run_guests g
       JOIN users u ON u.id = g.sponsor_user_id
       WHERE g.run_id = ?
       ORDER BY g.created_at ASC, g.id ASC`
    )
    .all(runId);
}

export function listGuestsBySponsor(runId, sponsorUserId) {
  return db
    .prepare(
      `SELECT g.*, u.first_name AS sponsor_first_name, u.last_name AS sponsor_last_name
       FROM run_guests g
       JOIN users u ON u.id = g.sponsor_user_id
       WHERE g.run_id = ? AND g.sponsor_user_id = ?
       ORDER BY g.created_at ASC, g.id ASC`
    )
    .all(runId, sponsorUserId);
}

export function getGuestForSponsor(runId, sponsorUserId, guestId) {
  return db
    .prepare(
      `SELECT g.*, u.first_name AS sponsor_first_name, u.last_name AS sponsor_last_name
       FROM run_guests g
       JOIN users u ON u.id = g.sponsor_user_id
       WHERE g.run_id = ? AND g.id = ? AND g.sponsor_user_id = ?`
    )
    .get(runId, guestId, sponsorUserId);
}

export function guestParticipantIdsForRun(runId) {
  return listGuestsForRun(runId).map((g) => guestParticipantId(g.id));
}

function saveGuestSlots(runId, guestId, slotsJson) {
  const existing = db
    .prepare(
      `SELECT slots_json, slot_saved_at_json FROM run_guests WHERE run_id = ? AND id = ?`
    )
    .get(runId, guestId);

  let newSlots = [];
  try {
    newSlots = JSON.parse(slotsJson || "[]");
  } catch {
    newSlots = [];
  }
  const normalizedNew = [
    ...new Set(
      (Array.isArray(newSlots) ? newSlots : [])
        .map((s) => normalizeSlotKey(String(s)))
        .filter(Boolean)
    ),
  ];

  const oldSavedAt = existing
    ? parseSlotSavedAtMap(existing.slot_saved_at_json)
    : new Map();
  let oldSlots = new Set();
  if (existing) {
    try {
      const raw = JSON.parse(existing.slots_json || "[]");
      oldSlots = new Set(
        (Array.isArray(raw) ? raw : [])
          .map((s) => normalizeSlotKey(String(s)))
          .filter(Boolean)
      );
    } catch {
      oldSlots = new Set();
    }
  }

  const now = db.prepare("SELECT datetime('now') AS ts").get().ts;
  const slotSavedAt = {};
  for (const k of normalizedNew) {
    const prev = oldSavedAt.get(k);
    slotSavedAt[k] = prev && oldSlots.has(k) ? prev : now;
  }

  db.prepare(
    `UPDATE run_guests
     SET slots_json = ?, slot_saved_at_json = ?, updated_at = datetime('now')
     WHERE run_id = ? AND id = ?`
  ).run(
    JSON.stringify(normalizedNew),
    JSON.stringify(slotSavedAt),
    runId,
    guestId
  );

  return normalizedNew;
}

export function createGuest(
  runId,
  sponsorUserId,
  { firstName, lastName, slots, mergeIntoGuestId }
) {
  const fn = String(firstName || "").trim();
  if (!fn) return { error: "Guest name is required." };
  const slotsArr = Array.isArray(slots) ? slots : [];

  if (mergeIntoGuestId != null) {
    const guestId = Number(mergeIntoGuestId);
    if (!Number.isFinite(guestId)) return { error: "Invalid guest id." };
    const existing = getGuestForSponsor(runId, sponsorUserId, guestId);
    if (!existing) return { error: "Guest not found." };
    const existingSlots = parseGuestSlots(existing.slots_json);
    const merged = appendGuestSlotsReplacingOverlaps(existingSlots, slotsArr);
    const count = saveGuestSlots(runId, guestId, JSON.stringify(merged)).length;
    const row = getGuestForSponsor(runId, sponsorUserId, guestId);
    return { guest: formatGuestRow(row), count, merged: true };
  }

  const info = db
    .prepare(
      `INSERT INTO run_guests (run_id, sponsor_user_id, first_name, last_name, slots_json, slot_saved_at_json)
       VALUES (?, ?, ?, ?, '[]', '{}')`
    )
    .run(runId, sponsorUserId, fn, String(lastName || "").trim());
  const guestId = Number(info.lastInsertRowid);
  const normalized = saveGuestSlots(runId, guestId, JSON.stringify(slotsArr));
  const row = getGuestForSponsor(runId, sponsorUserId, guestId);
  return { guest: formatGuestRow(row), count: normalized.length };
}

export function updateGuest(
  runId,
  sponsorUserId,
  guestId,
  { firstName, lastName, slots, appendSlots, removeSlots }
) {
  const existing = getGuestForSponsor(runId, sponsorUserId, guestId);
  if (!existing) return { error: "Guest not found." };
  const fn =
    firstName !== undefined ? String(firstName || "").trim() : existing.first_name;
  if (!fn) return { error: "Guest name is required." };
  const ln =
    lastName !== undefined ? String(lastName || "").trim() : existing.last_name;
  db.prepare(
    `UPDATE run_guests SET first_name = ?, last_name = ?, updated_at = datetime('now')
     WHERE run_id = ? AND id = ? AND sponsor_user_id = ?`
  ).run(fn, ln, runId, guestId, sponsorUserId);

  let count = parseGuestSlots(existing.slots_json).length;
  const existingSlots = parseGuestSlots(existing.slots_json);

  if (appendSlots !== undefined) {
    const toAppend = Array.isArray(appendSlots) ? appendSlots : null;
    if (!toAppend) return { error: "appendSlots must be a string array." };
    count = saveGuestSlots(
      runId,
      guestId,
      JSON.stringify(appendGuestSlotsReplacingOverlaps(existingSlots, toAppend))
    ).length;
  } else if (removeSlots !== undefined) {
    const toRemove = Array.isArray(removeSlots) ? removeSlots : null;
    if (!toRemove) return { error: "removeSlots must be a string array." };
    const removeSet = new Set(
      toRemove.map((s) => normalizeSlotKey(String(s))).filter(Boolean)
    );
    const next = existingSlots.filter((k) => !removeSet.has(k));
    if (!next.length) {
      deleteGuest(runId, sponsorUserId, guestId);
      return { deleted: true, count: 0 };
    }
    count = saveGuestSlots(runId, guestId, JSON.stringify(next)).length;
  } else if (slots !== undefined) {
    const slotsRaw = parseSlots({ slots });
    if (!slotsRaw) return { error: "slots must be a string array." };
    count = saveGuestSlots(runId, guestId, JSON.stringify(slotsRaw)).length;
    if (!count) {
      deleteGuest(runId, sponsorUserId, guestId);
      return { deleted: true, count: 0 };
    }
  }

  const row = getGuestForSponsor(runId, sponsorUserId, guestId);
  return { guest: formatGuestRow(row), count };
}

export function deleteGuest(runId, sponsorUserId, guestId) {
  const existing = getGuestForSponsor(runId, sponsorUserId, guestId);
  if (!existing) return { error: "Guest not found." };
  db.prepare(
    `DELETE FROM run_guests WHERE run_id = ? AND id = ? AND sponsor_user_id = ?`
  ).run(runId, guestId, sponsorUserId);
  return { ok: true };
}

export function deleteGuestsForSponsor(runId, sponsorUserId) {
  db.prepare(`DELETE FROM run_guests WHERE run_id = ? AND sponsor_user_id = ?`).run(
    runId,
    sponsorUserId
  );
}

export function formatGuestRow(row, includedWeekdays = null) {
  if (!row) return null;
  const sponsor = {
    first_name: row.sponsor_first_name,
    last_name: row.sponsor_last_name,
  };
  const slots = parseGuestSlots(row.slots_json, includedWeekdays);
  return {
    id: Number(row.id),
    participantId: guestParticipantId(row.id),
    sponsorUserId: Number(row.sponsor_user_id),
    firstName: row.first_name,
    lastName: row.last_name || "",
    displayName: guestDisplayName(row, sponsor),
    sponsorFirstName: row.sponsor_first_name,
    sponsorLastName: row.sponsor_last_name,
    slots,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function countGuestsWithAvailability(runId, guestRows = null) {
  const rows = guestRows || listGuestsForRun(runId);
  let n = 0;
  for (const row of rows) {
    if (parseGuestSlots(row.slots_json).length > 0) n++;
  }
  return n;
}

export function bookingGuestSlotSets(dbConn, runId, guestParticipantIds) {
  const map = new Map();
  if (!guestParticipantIds?.length) return map;
  const getRow = dbConn.prepare(
    "SELECT id, slots_json FROM run_guests WHERE run_id = ? AND id = ?"
  );
  for (const pid of guestParticipantIds) {
    const guestId = guestRowIdFromParticipantId(pid);
    if (!guestId) continue;
    const row = getRow.get(runId, guestId);
    if (!row) {
      map.set(Number(pid), new Set());
      continue;
    }
    try {
      const raw = JSON.parse(row.slots_json || "[]");
      const set = new Set(
        (Array.isArray(raw) ? raw : [])
          .map((s) => normalizeSlotKey(String(s)))
          .filter(Boolean)
      );
      map.set(Number(pid), set);
    } catch {
      map.set(Number(pid), new Set());
    }
  }
  return map;
}

export function loadSlotSavedAtByGuest(runId, guestParticipantIds) {
  const map = new Map();
  if (!guestParticipantIds?.length) return map;
  for (const pid of guestParticipantIds) {
    const guestId = guestRowIdFromParticipantId(pid);
    if (!guestId) continue;
    const row = db
      .prepare(
        "SELECT slot_saved_at_json FROM run_guests WHERE run_id = ? AND id = ?"
      )
      .get(runId, guestId);
    map.set(Number(pid), parseSlotSavedAtMap(row?.slot_saved_at_json));
  }
  return map;
}

export function loadGuestAvailabilityHeatmap(runId, includedWeekdays) {
  return listGuestsForRun(runId).map((row) => {
    const formatted = formatGuestRow(row, includedWeekdays);
    return {
      userId: formatted.participantId,
      guestId: formatted.id,
      isGuest: true,
      firstName: formatted.firstName,
      lastName: formatted.lastName,
      displayName: formatted.displayName,
      sponsorUserId: formatted.sponsorUserId,
      slots: formatted.slots,
    };
  });
}

export function buildGuestUserInfoMap(guestRows, includedWeekdays = null) {
  const map = new Map();
  for (const row of guestRows) {
    const formatted = formatGuestRow(row, includedWeekdays);
    map.set(formatted.participantId, {
      firstName: formatted.firstName,
      lastName: formatted.lastName,
      displayName: formatted.displayName,
      isGuest: true,
      guestId: formatted.id,
      sponsorUserId: formatted.sponsorUserId,
    });
  }
  return map;
}
