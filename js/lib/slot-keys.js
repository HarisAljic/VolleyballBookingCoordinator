/** Keep in sync with /slotKeys.js (server). */
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
