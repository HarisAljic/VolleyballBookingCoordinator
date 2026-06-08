import { normalizeSlotKey, dateFromSlotKey } from "../../slotKeys.js";
import {
  filterSlotKeysByIncludedWeekdays,
  parseIncludedWeekdays,
} from "../../run-weekdays.js";
import {
  activeRosterUserIdsFromOrdered,
  schedulingMemberThreshold,
} from "../../roster-tiers.js";
import { db } from "../db-singleton.js";
import { orderedMemberUserIds } from "./repository.js";

export function runIncludedWeekdays(runRow) {
  return parseIncludedWeekdays(runRow?.included_weekdays);
}

export function parseSlots(body) {
  if (!body || !Array.isArray(body.slots)) return null;
  return [
    ...new Set(
      body.slots
        .filter((s) => typeof s === "string" && s.length > 0)
        .map((s) => normalizeSlotKey(s))
        .filter(Boolean)
    ),
  ];
}

export function activeRosterUserIds(runId, size) {
  return activeRosterUserIdsFromOrdered(orderedMemberUserIds(runId), size);
}

export function intersectionSlotsForUserIds(runId, userIds, includedWeekdays = null) {
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
    let keys = Array.isArray(raw)
      ? raw.map((s) => normalizeSlotKey(String(s))).filter(Boolean)
      : [];
    if (includedWeekdays != null) {
      keys = filterSlotKeysByIncludedWeekdays(keys, includedWeekdays);
    }
    sets.push(new Set(keys));
  }
  if (!sets.length) return [];
  let acc = sets[0];
  for (let i = 1; i < sets.length; i++) {
    acc = new Set([...acc].filter((x) => sets[i].has(x)));
  }
  return [...acc].sort();
}

export function intersectionSlots(runId, capacity, includedWeekdays = null) {
  const activeIds = activeRosterUserIds(runId, capacity);
  if (activeIds.length < capacity) return [];
  return intersectionSlotsForUserIds(runId, activeIds, includedWeekdays);
}

export function memberHasNonEmptyAvailability(runId, userId) {
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

function hasSharedBookableContiguousWindow(sortedOverlapKeys) {
  return contiguousOverlapRuns(sortedOverlapKeys).some((r) => r.length >= 2);
}

export function schedulingWaitlistLocked(runId) {
  const count = db
    .prepare("SELECT COUNT(*) AS n FROM run_members WHERE run_id = ?")
    .get(runId)?.n ?? 0;
  if (count <= schedulingMemberThreshold()) return false;
  const allIds = orderedMemberUserIds(runId);
  const runRow = db.prepare("SELECT included_weekdays FROM runs WHERE id = ?").get(runId);
  const overlapAll = intersectionSlotsForUserIds(
    runId,
    allIds,
    runIncludedWeekdays(runRow)
  );
  return hasSharedBookableContiguousWindow(overlapAll);
}

export function canSetAvailability(runId, userId) {
  return orderedMemberUserIds(runId).indexOf(Number(userId)) >= 0;
}

export function userIdsWithAvailabilityOrderedBySaveTime(runId) {
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
              raw.map((s) => normalizeSlotKey(String(s))).filter(Boolean)
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

export function slotCountsBeforeUserInSaveOrder(runId, userId) {
  const rows = db
    .prepare(
      `SELECT user_id, slot_saved_at_json FROM availability WHERE run_id = ?`
    )
    .all(runId);
  const allByUser = new Map();
  for (const r of rows) {
    allByUser.set(Number(r.user_id), parseSlotSavedAtMap(r.slot_saved_at_json));
  }
  const viewerMap = allByUser.get(Number(userId)) || new Map();
  const slotCounts = new Map();
  const viewerId = Number(userId);
  for (const [slotKey, viewerTs] of viewerMap) {
    let count = 0;
    for (const [uid, userMap] of allByUser) {
      if (uid === viewerId) continue;
      const ts = userMap.get(slotKey);
      if (!ts) continue;
      if (ts < viewerTs || (ts === viewerTs && uid < viewerId)) count++;
    }
    slotCounts.set(slotKey, count);
  }
  return slotCounts;
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

export function loadSlotSavedAtByUser(runId, userIds) {
  const map = new Map();
  if (!userIds?.length) return map;
  const placeholders = userIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT user_id, slot_saved_at_json FROM availability
       WHERE run_id = ? AND user_id IN (${placeholders})`
    )
    .all(runId, ...userIds);
  for (const r of rows) {
    map.set(Number(r.user_id), parseSlotSavedAtMap(r.slot_saved_at_json));
  }
  return map;
}

export function saveAvailability(runId, userId, slotsJson) {
  const existing = db
    .prepare(
      `SELECT slots_json, slot_saved_at_json FROM availability
       WHERE run_id = ? AND user_id = ?`
    )
    .get(runId, userId);

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

  const oldSavedAt = existing ? parseSlotSavedAtMap(existing.slot_saved_at_json) : new Map();
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
    `INSERT INTO availability (run_id, user_id, slots_json, updated_at, first_saved_at, slot_saved_at_json)
     VALUES (?, ?, ?, datetime('now'), datetime('now'), ?)
     ON CONFLICT(run_id, user_id) DO UPDATE SET
       slots_json = excluded.slots_json,
       updated_at = excluded.updated_at,
       first_saved_at = COALESCE(availability.first_saved_at, excluded.first_saved_at),
       slot_saved_at_json = excluded.slot_saved_at_json`
  ).run(runId, userId, JSON.stringify(normalizedNew), JSON.stringify(slotSavedAt));
}

export function memberSlotsFromRow(runId, userId, includedWeekdays) {
  const row = db
    .prepare(
      "SELECT slots_json FROM availability WHERE run_id = ? AND user_id = ?"
    )
    .get(runId, userId);
  if (!row) return [];
  try {
    const raw = JSON.parse(row.slots_json || "[]");
    return filterSlotKeysByIncludedWeekdays(
      Array.isArray(raw)
        ? raw.map((s) => normalizeSlotKey(String(s))).filter(Boolean)
        : [],
      includedWeekdays
    );
  } catch {
    return [];
  }
}


export function countMembersWithAvailability(runId, userIds) {
  let n = 0;
  for (const uid of userIds) {
    const row = db
      .prepare(
        "SELECT slots_json FROM availability WHERE run_id = ? AND user_id = ?"
      )
      .get(runId, uid);
    if (!row) continue;
    try {
      const arr = JSON.parse(row.slots_json || "[]");
      if (Array.isArray(arr) && arr.length > 0) n++;
    } catch {
      /* ignore */
    }
  }
  return n;
}

export function loadMemberAvailabilityHeatmap(runId, heatmapUserIds, includedWeekdays) {
  if (!heatmapUserIds.length) return [];
  const placeholders = heatmapUserIds.map(() => "?").join(",");
  const avRows = db
    .prepare(
      `SELECT a.user_id, a.slots_json, u.first_name, u.last_name
       FROM availability a
       JOIN users u ON u.id = a.user_id
       WHERE a.run_id = ? AND a.user_id IN (${placeholders})`
    )
    .all(runId, ...heatmapUserIds);
  avRows.sort(
    (a, b) =>
      heatmapUserIds.indexOf(Number(a.user_id)) -
      heatmapUserIds.indexOf(Number(b.user_id))
  );
  return avRows.map((r) => {
    let slots = [];
    try {
      const raw = JSON.parse(r.slots_json || "[]");
      slots = filterSlotKeysByIncludedWeekdays(
        Array.isArray(raw)
          ? raw.map((s) => normalizeSlotKey(String(s))).filter(Boolean)
          : [],
        includedWeekdays
      );
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
}
