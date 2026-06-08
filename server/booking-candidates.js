/**
 * Contiguous 2–4h booking windows where at least run-capacity distinct members fully include
 * every hour (`rosterCapacity` callers pass 12/18/24). Caller supplies which user IDs count
 * (e.g. all joiners during open scheduling, or first-cap roster after waitlist lock).
 */
import { normalizeSlotKey, slotKeyFromParts } from "../slotKeys.js";
import {
  dayInRunSchedule,
  parseIncludedWeekdays,
} from "../run-weekdays.js";
import { bookingDurationHoursForSize } from "../roster-tiers.js";

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

/** Latest per-slot save time when a member fully covers every hour in the window. */
export function windowSaveTimestamp(slotKeys, slotSavedAtMap) {
  const keys = (slotKeys || [])
    .map((k) => normalizeSlotKey(String(k)))
    .filter(Boolean);
  if (!keys.length) return "";
  let maxTs = "";
  for (const k of keys) {
    const ts =
      slotSavedAtMap instanceof Map
        ? slotSavedAtMap.get(k)
        : slotSavedAtMap?.[k];
    if (!ts) return "";
    const s = String(ts);
    if (!maxTs || s.localeCompare(maxTs) > 0) maxTs = s;
  }
  return maxTs;
}

/**
 * Members who saved every hour in `slotKeys`, ordered by when they completed that window.
 * First `rosterCapacity` = roster; rest = waitlist with rank (1-based).
 */
export function coalitionRosterWaitlistForWindow(
  slotKeys,
  rosterCapacity,
  slotsByUser,
  userInfoById,
  slotSavedAtByUser
) {
  const cap = Math.max(1, Number(rosterCapacity)) || 1;
  const keys = (slotKeys || [])
    .map((k) => normalizeSlotKey(String(k)))
    .filter(Boolean);
  if (!keys.length) {
    return { roster: [], waitlist: [], matchingCount: 0 };
  }
  const matching = [];
  for (const [uid, set] of slotsByUser.entries()) {
    if (!set || !keys.every((k) => set.has(k))) continue;
    const savedAtMap =
      slotSavedAtByUser?.get(Number(uid)) ||
      slotSavedAtByUser?.get(uid) ||
      new Map();
    const windowTs = windowSaveTimestamp(keys, savedAtMap);
    if (!windowTs) continue;
    matching.push({ uid: Number(uid), windowTs });
  }
  matching.sort((a, b) => {
    const t = a.windowTs.localeCompare(b.windowTs);
    if (t !== 0) return t;
    return a.uid - b.uid;
  });
  const pick = (uid) => {
    const u = userInfoById.get(Number(uid)) || userInfoById.get(uid) || {};
    return {
      userId: Number(uid),
      firstName: u.firstName ?? "",
      lastName: u.lastName ?? "",
    };
  };
  const orderedIds = matching.map((m) => m.uid);
  const roster = orderedIds.slice(0, cap).map(pick);
  const waitlist = orderedIds.slice(cap).map((uid, i) => ({
    ...pick(uid),
    waitlistRank: i + 1,
  }));
  return { roster, waitlist, matchingCount: matching.length };
}

/**
 * Candidate windows: one contiguous block per roster size (12→2h, 18→3h, 24→4h).
 */
export function computeBookingWindowCandidates(
  db,
  runId,
  {
    rosterUserIdsBooking,
    rosterCapacity,
    dateStartStr,
    dateEndStr,
    includedWeekdays = null,
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

  const weekdays = parseIncludedWeekdays(includedWeekdays);
  const days = eachDayInclusiveStr(dateStartStr, dateEndStr).filter((dayStr) =>
    dayInRunSchedule(dayStr, dateStartStr, dateEndStr, weekdays)
  );
  const dur = bookingDurationHoursForSize(rosterCapacity);
  const durations = [dur];

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

function dayStrFromSlotKey(slotKey) {
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(String(slotKey || ""));
  return m ? m[1] : "";
}

function formatDateHeading(dayStr) {
  const d = new Date(String(dayStr) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return dayStr;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Rental options grouped by calendar date, each with roster + waitlist (save-order).
 */
export function buildBookingRentalsByDate(
  candidates,
  { slotsByUser, userInfoById, slotSavedAtByUser }
) {
  if (!candidates?.length) return [];
  const byDate = new Map();
  let optionSeq = 0;
  for (const c of candidates) {
    const keys = c.slotKeys;
    if (!Array.isArray(keys) || !keys.length) continue;
    const start = normalizeSlotKey(String(keys[0]));
    const date = dayStrFromSlotKey(start);
    if (!date) continue;
    const { roster, waitlist, matchingCount } = coalitionRosterWaitlistForWindow(
      keys,
      c.rosterCapacity,
      slotsByUser,
      userInfoById,
      slotSavedAtByUser
    );
    if (matchingCount < Number(c.rosterCapacity)) continue;
    optionSeq += 1;
    const option = {
      optionNumber: optionSeq,
      rosterCapacity: Number(c.rosterCapacity),
      durationHours: Number(c.durationHours),
      slotKeys: keys,
      slotStart: start,
      slotEnd: keys[keys.length - 1],
      rosterCoverageCount: matchingCount,
      roster,
      waitlist,
    };
    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        dateLabel: formatDateHeading(date),
        options: [],
      });
    }
    byDate.get(date).options.push(option);
  }
  const out = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const g of out) {
    g.options.sort((a, b) => String(a.slotStart).localeCompare(String(b.slotStart)));
  }
  return out;
}

/** @deprecated Use buildBookingRentalsByDate — kept for callers expecting start-grouped shape. */
export function groupBookingRentalsByStart(candidates) {
  if (!candidates?.length) return [];
  return candidates.map((c, idx) => ({
    optionNumber: idx + 1,
    startSlotKey: normalizeSlotKey(String(c.slotKeys?.[0] || "")),
    windows: [
      {
        slotKeys: c.slotKeys,
        durationHours: c.durationHours,
        rosterCoverageCount: c.rosterCoverageCount,
        rosterCapacity: c.rosterCapacity,
        rosterMissingCount: c.rosterMissingCount ?? 0,
        missingMemberNamesPreview: c.missingMemberNamesPreview ?? [],
      },
    ],
  }));
}

/** Flatten date-grouped rentals into legacy { optionNumber, windows[] } for tag matching. */
export function rentalOptionsFromDateGroups(dateGroups) {
  const out = [];
  for (const dg of dateGroups || []) {
    for (const opt of dg.options || []) {
      out.push({
        optionNumber: Number(opt.optionNumber),
        windows: [
          {
            slotKeys: opt.slotKeys,
            rosterCapacity: opt.rosterCapacity,
            durationHours: opt.durationHours,
          },
        ],
      });
    }
  }
  return out;
}

export function mergeBookingRentalsByDate(bySize) {
  const byDate = new Map();
  for (const size of [12, 18, 24]) {
    const groups = bySize?.[size] ?? bySize?.[String(size)] ?? [];
    for (const g of groups) {
      if (!byDate.has(g.date)) {
        byDate.set(g.date, {
          date: g.date,
          dateLabel: g.dateLabel,
          options: [],
        });
      }
      byDate.get(g.date).options.push(...(g.options || []));
    }
  }
  const out = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const g of out) {
    g.options.sort((a, b) => {
      const t = String(a.slotStart).localeCompare(String(b.slotStart));
      if (t !== 0) return t;
      return Number(a.rosterCapacity) - Number(b.rosterCapacity);
    });
  }
  return out;
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

/**
 * Per-member yellow (waitlist) / green (available) tags across 12 / 18 / 24 booking windows.
 * Waitlist: matched a window where every hour already had `size` prior savers (save order).
 * Available: matched a window that is not fully saturated at that size.
 */
export function memberRentalStatusForSizes(
  userSlotKeys,
  groupsBySize,
  slotCountsBeforeUser,
  sizes = [12, 18, 24]
) {
  const waitlistedSizes = [];
  const fitsSizes = [];
  for (const size of sizes) {
    const dateGroups = groupsBySize?.[size] ?? groupsBySize?.[String(size)] ?? [];
    const groups = rentalOptionsFromDateGroups(dateGroups);
    const { waitlisted, fits } = splitViewerRentalMatchByWaitlist(
      userSlotKeys,
      groups,
      slotCountsBeforeUser,
      size
    );
    if (waitlisted.length > 0) waitlistedSizes.push(size);
    if (fits.length > 0) fitsSizes.push(size);
  }
  return {
    waitlistedSizes,
    fitsSizes,
    hourWaitlisted: waitlistedSizes.length > 0,
    fitsRental: fitsSizes.length > 0,
  };
}
