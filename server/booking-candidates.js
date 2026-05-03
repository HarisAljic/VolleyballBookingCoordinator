/**
 * Contiguous 2–4h booking windows where at least run-capacity distinct members fully include
 * every hour (`rosterCapacity` callers pass 12/18/24). Caller supplies which user IDs count
 * (e.g. all joiners during open scheduling, or first-cap roster after waitlist lock).
 */
import { normalizeSlotKey, slotKeyFromParts } from "../slotKeys.js";

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** YYYY-MM-DD strings from date_start … date_end inclusive (local midday step). */
export function eachDayInclusiveStr(dateStartStr, dateEndStr) {
  const out = [];
  const d0 = new Date(String(dateStartStr) + "T12:00:00");
  const d1 = new Date(String(dateEndStr) + "T12:00:00");
  if (Number.isNaN(d0.getTime()) || Number.isNaN(d1.getTime())) return out;
  for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
    out.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
  }
  return out;
}

function slotsSetFromRow(slots_json) {
  try {
    const raw = JSON.parse(slots_json || "[]");
    if (!Array.isArray(raw)) return new Set();
    return new Set(
      raw.map((s) => normalizeSlotKey(String(s))).filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

/** Booking roster slots: map user_id -> Set of slot keys. */
export function bookingRosterSlotSets(db, runId, rosterUserIdsOrdered) {
  const map = new Map();
  const getRow = db.prepare(
    "SELECT slots_json FROM availability WHERE run_id = ? AND user_id = ?"
  );
  for (const uid of rosterUserIdsOrdered) {
    const row = getRow.get(runId, uid);
    if (!row) {
      map.set(uid, new Set());
      continue;
    }
    map.set(uid, slotsSetFromRow(row.slots_json));
  }
  return map;
}

/**
 * Candidate windows overlapping any saved slot on roster (cheap prune):
 * iterate days × calendar hours × 2–4 length, same-day contiguous only (matches overlap UI).
 */
export function computeBookingWindowCandidates(
  db,
  runId,
  {
    rosterUserIdsBooking,
    rosterCapacity,
    dateStartStr,
    dateEndStr,
    maxResults = 40,
  }
) {
  /** Bookable only when every booking-roster seat is filled and clears the window. */
  if (
    !rosterUserIdsBooking.length ||
    rosterUserIdsBooking.length < rosterCapacity
  ) {
    return [];
  }

  const slotMaps = bookingRosterSlotSets(db, runId, rosterUserIdsBooking);

  const days = eachDayInclusiveStr(dateStartStr, dateEndStr);
  const durations = [2, 3, 4];

  /** @type {Map<string, { slotKeys: string[], durationHours: number, rosterCoverageCount: number, rosterCapacity: number }>} */
  const byKey = new Map();

  const hourStarts = [];
  for (let h = 6; h <= 23; h++) hourStarts.push(h);

  for (const dayStr of days) {
    const p = dayStr.split("-").map(Number);
    if (p.length !== 3 || p.some((x) => Number.isNaN(x))) continue;
    const [year, mo, dia] = p;
    for (const startHour of hourStarts) {
      for (const dur of durations) {
        if (startHour + dur > 24) continue;
        const slotKeys = [];
        for (let i = 0; i < dur; i++) {
          slotKeys.push(slotKeyFromParts(year, mo, dia, startHour + i));
        }
        let count = 0;
        for (const uid of rosterUserIdsBooking) {
          const set = slotMaps.get(uid) || new Set();
          const ok = slotKeys.every((k) => set.has(normalizeSlotKey(k)));
          if (ok) count++;
        }
        if (count < rosterCapacity) continue;

        const dedupeKey = slotKeys.join("|");
        const prev = byKey.get(dedupeKey);
        if (!prev || count > prev.rosterCoverageCount) {
          byKey.set(dedupeKey, {
            slotKeys,
            durationHours: dur,
            rosterCoverageCount: count,
            rosterCapacity,
          });
        }
      }
    }
  }

  let list = [...byKey.values()];
  list.sort((a, b) => {
    if (b.rosterCoverageCount !== a.rosterCoverageCount) {
      return b.rosterCoverageCount - a.rosterCoverageCount;
    }
    if (b.durationHours !== a.durationHours) return b.durationHours - a.durationHours;
    return String(a.slotKeys[0] || "").localeCompare(String(b.slotKeys[0] || ""));
  });
  list = list.slice(0, maxResults);

  return list.map((w) => ({
    slotKeys: w.slotKeys,
    durationHours: w.durationHours,
    rosterCoverageCount: w.rosterCoverageCount,
    rosterCapacity: w.rosterCapacity,
    rosterMissingCount: 0,
    missingMemberNamesPreview: [],
  }));
}

/**
 * One “rental option” = same wall-clock start (first hourly key); variants are 2/3/4h lengths from that start.
 */
export function groupBookingRentalsByStart(candidates) {
  if (!candidates?.length) return [];
  const byStart = new Map();
  for (const c of candidates) {
    const keys = c.slotKeys;
    if (!Array.isArray(keys) || !keys.length) continue;
    const start = normalizeSlotKey(String(keys[0]));
    if (!start) continue;
    if (!byStart.has(start)) byStart.set(start, []);
    byStart.get(start).push({
      slotKeys: c.slotKeys,
      durationHours: c.durationHours,
      rosterCoverageCount: c.rosterCoverageCount,
      rosterCapacity: c.rosterCapacity,
      rosterMissingCount: c.rosterMissingCount ?? 0,
      missingMemberNamesPreview: c.missingMemberNamesPreview ?? [],
    });
  }
  const sortedStarts = [...byStart.keys()].sort();
  return sortedStarts.map((startSlotKey, idx) => {
    const windows = [...byStart.get(startSlotKey)].sort(
      (a, b) => Number(b.durationHours) - Number(a.durationHours)
    );
    return {
      optionNumber: idx + 1,
      startSlotKey,
      windows,
    };
  });
}

/** Viewer’s saved slots fully cover at least one window variant inside a rental group. */
export function viewerMatchedRentalOptionNumbers(viewerSlotKeys, rentalGroups) {
  if (!viewerSlotKeys?.length || !rentalGroups?.length) return [];
  const slotSet = new Set(
    viewerSlotKeys
      .map((s) => normalizeSlotKey(String(s)))
      .filter(Boolean)
  );
  const out = [];
  for (const g of rentalGroups) {
    const hit = g.windows.some(
      (w) =>
        Array.isArray(w.slotKeys) &&
        w.slotKeys.every((k) => slotSet.has(normalizeSlotKey(String(k))))
    );
    if (hit) out.push(Number(g.optionNumber));
  }
  return out;
}

/**
 * Among rental options the viewer matches, split by whether every hour in some
 * matched window already had `rosterCapacity` prior savers (save-order counts).
 * Those options are “rental waitlist”; others are “in coalition” for that option.
 */
export function splitViewerRentalMatchByWaitlist(
  viewerSlotKeys,
  rentalGroups,
  slotCountsBeforeViewer,
  rosterCapacity
) {
  const capN = Math.max(1, Number(rosterCapacity)) || 1;
  const counts =
    slotCountsBeforeViewer instanceof Map
      ? slotCountsBeforeViewer
      : new Map(Object.entries(slotCountsBeforeViewer || {}));
  const slotSet = new Set(
    (viewerSlotKeys || [])
      .map((s) => normalizeSlotKey(String(s)))
      .filter(Boolean)
  );
  const waitlisted = [];
  const fits = [];
  for (const g of rentalGroups || []) {
    const optNum = Number(g.optionNumber);
    if (!Number.isFinite(optNum)) continue;
    let matchedAnyWindow = false;
    let anyMatchedWindowSaturated = false;
    for (const w of g.windows || []) {
      const keys = Array.isArray(w.slotKeys)
        ? w.slotKeys
            .map((k) => normalizeSlotKey(String(k)))
            .filter(Boolean)
        : [];
      if (!keys.length) continue;
      if (!keys.every((k) => slotSet.has(k))) continue;
      matchedAnyWindow = true;
      if (keys.every((k) => (counts.get(k) || 0) >= capN)) {
        anyMatchedWindowSaturated = true;
      }
    }
    if (!matchedAnyWindow) continue;
    if (anyMatchedWindowSaturated) waitlisted.push(optNum);
    else fits.push(optNum);
  }
  return { waitlisted, fits };
}
