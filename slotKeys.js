/**
 * Wall-clock slot ids: same string for the same calendar day + hour everywhere
 * (avoids Node seed TZ vs browser TZ mismatch on ISO UTC strings).
 */

export function slotKeyFromParts(year, month1to12, day, hour0to23) {
  const mm = String(month1to12).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const hh = String(hour0to23).padStart(2, "0");
  return `${year}-${mm}-${dd}T${hh}:00:00`;
}

export function slotKeyFromDayStrAndHour(dayStr, hour0to23) {
  const parts = dayStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return "";
  const [y, m, d] = parts;
  return slotKeyFromParts(y, m, d, hour0to23);
}

/** Canonical wall-clock key; maps legacy ISO-with-Z using local date parts. */
export function normalizeSlotKey(s) {
  if (typeof s !== "string" || !s) return "";
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:00:00$/.test(t)) return t;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return slotKeyFromParts(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours()
  );
}

/** Interprets key as local wall time on this machine (browser or server). */
export function dateFromSlotKey(key) {
  if (typeof key !== "string" || !key) return new Date(NaN);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00:00$/.exec(key.trim());
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], 0, 0, 0);
  }
  return new Date(key);
}

export function firstFutureSlotKey(sortedKeys) {
  const now = Date.now();
  for (const s of sortedKeys) {
    const t = dateFromSlotKey(s).getTime();
    if (!Number.isNaN(t) && t >= now - 60000) return s;
  }
  return sortedKeys[0] || null;
}

export function slotKeyToWindowIso(slotKeyStart, hoursLen) {
  const d0 = dateFromSlotKey(slotKeyStart);
  const d1 = new Date(d0.getTime() + hoursLen * 3600000);
  return { slotStartIso: d0.toISOString(), slotEndIso: d1.toISOString() };
}
