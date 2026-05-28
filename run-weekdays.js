/** Sunday = 0 … Saturday = 6 (JavaScript Date#getDay). */
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Fri, Sat, Sun (for create-run “Weekends” preset). */
export const WEEKEND_ONLY_WEEKDAYS = [0, 5, 6];

export function parseIncludedWeekdays(value) {
  if (value == null) return [...ALL_WEEKDAYS];
  let arr = value;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return [...ALL_WEEKDAYS];
    try {
      arr = JSON.parse(t);
    } catch {
      return [...ALL_WEEKDAYS];
    }
  }
  if (!Array.isArray(arr)) return [...ALL_WEEKDAYS];
  const out = new Set();
  for (const n of arr) {
    const d = Number(n);
    if (Number.isInteger(d) && d >= 0 && d <= 6) out.add(d);
  }
  return [...out].sort((a, b) => a - b);
}

export function serializeIncludedWeekdays(weekdays) {
  return JSON.stringify(parseIncludedWeekdays(weekdays));
}

export function weekdayFromDayStr(dayStr) {
  const d = new Date(String(dayStr) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return -1;
  return d.getDay();
}

export function dayInRunSchedule(dayStr, runStart, runEnd, includedWeekdays) {
  if (!dayStr || dayStr < runStart || dayStr > runEnd) return false;
  const wd = weekdayFromDayStr(dayStr);
  if (wd < 0) return false;
  return new Set(parseIncludedWeekdays(includedWeekdays)).has(wd);
}

export function dayStrFromSlotKey(slotKey) {
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(String(slotKey || ""));
  return m ? m[1] : "";
}

export function slotKeyOnIncludedWeekday(slotKey, includedWeekdays) {
  const day = dayStrFromSlotKey(slotKey);
  if (!day) return false;
  const wd = weekdayFromDayStr(day);
  if (wd < 0) return false;
  return new Set(parseIncludedWeekdays(includedWeekdays)).has(wd);
}

export function filterSlotKeysByIncludedWeekdays(keys, includedWeekdays) {
  return (keys || []).filter((k) => slotKeyOnIncludedWeekday(k, includedWeekdays));
}

export function formatIncludedWeekdaysShort(includedWeekdays) {
  const parsed = parseIncludedWeekdays(includedWeekdays);
  if (parsed.length === ALL_WEEKDAYS.length) return "Every day";
  if (!parsed.length) return "No days";
  return parsed.map((d) => WEEKDAY_LABELS[d]).join(", ");
}

export function eachIncludedDayInclusive(startStr, endStr, includedWeekdays) {
  const out = [];
  const a = new Date(startStr + "T12:00:00");
  const b = new Date(endStr + "T12:00:00");
  if (Number.isNaN(+a) || Number.isNaN(+b)) return out;
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    const dayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (dayInRunSchedule(dayStr, startStr, endStr, includedWeekdays)) {
      out.push(dayStr);
    }
  }
  return out;
}
