import { normalizeSlotKey } from "./slot-keys.js";

export function formatLocalDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function eachDayInclusive(startStr, endStr) {
  const out = [];
  const a = new Date(startStr + "T12:00:00");
  const b = new Date(endStr + "T12:00:00");
  if (Number.isNaN(+a) || Number.isNaN(+b)) return out;
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    out.push(formatLocalDay(d));
  }
  return out;
}

export function startOfWeekSunday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay();
  x.setDate(x.getDate() - dow);
  return x;
}

export function weekStartsOverlappingRun(runStartStr, runEndStr) {
  const a = new Date(runStartStr + "T12:00:00");
  const b = new Date(runEndStr + "T12:00:00");
  if (Number.isNaN(+a) || Number.isNaN(+b)) return [];
  const out = [];
  let cur = startOfWeekSunday(a);
  const endS = startOfWeekSunday(b);
  while (cur <= endS) {
    out.push(new Date(cur));
    cur = new Date(cur);
    cur.setDate(cur.getDate() + 7);
  }
  return out;
}

export function buildWeekDaysFromSunday(sundayDate) {
  const out = [];
  const cur = new Date(
    sundayDate.getFullYear(),
    sundayDate.getMonth(),
    sundayDate.getDate()
  );
  for (let i = 0; i < 7; i++) {
    out.push(formatLocalDay(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function dayInRunRange(dayStr, runStart, runEnd) {
  return dayStr >= runStart && dayStr <= runEnd;
}

export function calendarDayHeader(dayStr) {
  const parts = dayStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dayStr;
  const [y, mo, da] = parts;
  const d = new Date(y, mo - 1, da);
  if (Number.isNaN(d.getTime())) return dayStr;
  const wd = d.toLocaleDateString(undefined, { weekday: "short" });
  const md = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${wd} ${md}`;
}

export function formatWeekRangeLabel(weekDays) {
  if (!weekDays || weekDays.length < 7) return "";
  const parse = (s) => {
    const p = s.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  };
  const a = parse(weekDays[0]);
  const b = parse(weekDays[6]);
  if (Number.isNaN(+a) || Number.isNaN(+b)) return "";
  const sameYear = a.getFullYear() === b.getFullYear();
  const left = a.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  const right = b.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${left} – ${right}`;
}

export function ordinalDay(n) {
  const v = n % 100;
  const suf = ["th", "st", "nd", "rd"];
  const o = v >= 11 && v <= 13 ? "th" : suf[v % 10] || "th";
  return `${n}${o}`;
}

export function formatSlotKeyForDisplay(key) {
  const t = String(key || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00:00$/.exec(t);
  if (!m) return t;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], 0, 0, 0);
  if (Number.isNaN(d.getTime())) return t;
  const month = d.toLocaleString(undefined, { month: "long" });
  const time = d.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${month} ${ordinalDay(d.getDate())}, ${time.toLowerCase()}`;
}

export function parseSlotKeyToDate(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00:00$/.exec(String(key || ""));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function slotKeyDayStr(key) {
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(String(key || ""));
  return m ? m[1] : "";
}

export function addDaysToDayStr(dayStr, n) {
  const parts = String(dayStr || "")
    .split("-")
    .map(Number);
  if (parts.length !== 3 || parts.some((x) => Number.isNaN(x))) return dayStr;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + n);
  return formatLocalDay(d);
}

export function formatTimeHmLower(d) {
  return d
    .toLocaleString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();
}

export function groupSlotKeysByDay(sortedKeys) {
  const byDay = new Map();
  for (const k of sortedKeys) {
    const day = slotKeyDayStr(k);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(k);
  }
  return byDay;
}

/** Consecutive hour runs for an already-sorted list of slot keys. */
export function contiguousHourRunsFromSorted(sortedKeys) {
  const runs = [];
  let cur = [];
  for (const k of sortedKeys) {
    if (!cur.length) {
      cur.push(k);
      continue;
    }
    const pt = parseSlotKeyToDate(cur[cur.length - 1]);
    const ct = parseSlotKeyToDate(k);
    if (pt && ct && ct.getTime() - pt.getTime() === 3600000) cur.push(k);
    else {
      runs.push(cur);
      cur = [k];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

export function formatMemberFreeWindowLine(windowKeys) {
  const w = windowKeys;
  if (!w?.length) return "";
  const start = parseSlotKeyToDate(w[0]);
  const lastStart = parseSlotKeyToDate(w[w.length - 1]);
  if (!start || !lastStart) return w.join(", ");
  const endExclusive = new Date(lastStart);
  endExclusive.setHours(endExclusive.getHours() + 1);
  const dayStr = slotKeyDayStr(w[0]);
  const p = dayStr.split("-").map(Number);
  if (p.length !== 3 || p.some((x) => Number.isNaN(x))) return w.join(", ");
  const cal = new Date(p[0], p[1] - 1, p[2]);
  const mon = cal.toLocaleString(undefined, { month: "long" });
  const ord = ordinalDay(cal.getDate());
  return `${mon} ${ord} · ${formatTimeHmLower(start)}–${formatTimeHmLower(endExclusive)}`;
}

/** Human-readable free windows: per calendar day, merge consecutive hours (end time exclusive). */
export function formatMemberAvailabilityRanges(slotKeys) {
  const keys = [...(slotKeys || [])].map((x) => normalizeSlotKey(String(x))).filter(Boolean).sort();
  if (!keys.length) return [];
  const byDay = groupSlotKeysByDay(keys);
  const lines = [];
  for (const day of [...byDay.keys()].sort()) {
    const dayKeys = [...(byDay.get(day) || [])].sort((a, b) => a.localeCompare(b));
    for (const run of contiguousHourRunsFromSorted(dayKeys)) {
      lines.push(formatMemberFreeWindowLine(run));
    }
  }
  return lines;
}

/** Server count plus you, once you pick at least one hour locally before first save. */
export function computeDisplayLockCount(run, selected) {
  const base = Number(run.membersWithAvailability) || 0;
  const hadSaved = Array.isArray(run.viewerSlots) && run.viewerSlots.length > 0;
  const active =
    run.viewerIsActiveRoster ??
    (run.viewerIsMember && !run.viewerOnWaitlist);
  if (active && !hadSaved && selected.size > 0) return base + 1;
  return base;
}
