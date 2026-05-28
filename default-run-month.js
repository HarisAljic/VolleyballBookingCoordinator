/** @typedef {{ year: number, month: number }} YearMonth month is 0-based (Jan = 0) */

export const MONTH_NAMES = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];

function calendarDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** First calendar day of the month's last 7-day span (inclusive). */
export function lastWeekStartOfMonth(year, monthIndex) {
  const lastDay = new Date(year, monthIndex + 1, 0);
  const start = new Date(lastDay);
  start.setDate(start.getDate() - 6);
  return calendarDay(start);
}

/**
 * Which calendar month's default weekend run is active on `when`.
 * Before the last week of the current month → this month; on/after → next month.
 * @param {Date} [when]
 * @returns {YearMonth}
 */
export function activeDefaultMonth(when = new Date()) {
  const today = calendarDay(when);
  const y = today.getFullYear();
  const m = today.getMonth();
  const boundary = lastWeekStartOfMonth(y, m);
  if (today >= boundary) {
    if (m === 11) return { year: y + 1, month: 0 };
    return { year: y, month: m + 1 };
  }
  return { year: y, month: m };
}

export function formatDayStr(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** Inclusive first/last calendar days for a month. */
export function monthDateRange(year, monthIndex) {
  const dateStart = formatDayStr(new Date(year, monthIndex, 1));
  const dateEnd = formatDayStr(new Date(year, monthIndex + 1, 0));
  return { dateStart, dateEnd };
}

/**
 * Default weekend-run range for a calendar month, with "weekend carryover":
 * - If the month ends on Fri/Sat, include the remaining weekend days (Sat/Sun) even if they spill into next month.
 * - If the month starts on Sat/Sun (because the previous month ended Fri/Sat and carried that weekend),
 *   start AFTER that carried weekend (i.e. Monday), so the next month begins on the next weekend.
 */
export function defaultWeekendRunDateRange(year, monthIndex) {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);

  // If this month begins on Sat/Sun, that weekend belongs to the previous month.
  // Move start to Monday so we don't overlap.
  const startDow = start.getDay(); // Sun=0 ... Sat=6
  if (startDow === 6) start.setDate(start.getDate() + 2); // Sat -> Mon
  else if (startDow === 0) start.setDate(start.getDate() + 1); // Sun -> Mon

  // If this month ends on Fri/Sat, carry the rest of the weekend into this run.
  const endDow = end.getDay();
  if (endDow === 5) end.setDate(end.getDate() + 2); // Fri -> Sun
  else if (endDow === 6) end.setDate(end.getDate() + 1); // Sat -> Sun

  return { dateStart: formatDayStr(start), dateEnd: formatDayStr(end) };
}

export function defaultRunCodeForMonth(year, monthIndex) {
  return `${MONTH_NAMES[monthIndex]}${year}`;
}

const DEFAULT_RUN_CODE_RE = /^([A-Z]+)(20\d{2})$/;

/** @returns {YearMonth | null} */
export function parseDefaultRunCode(code) {
  const m = DEFAULT_RUN_CODE_RE.exec(String(code || "").trim().toUpperCase());
  if (!m) return null;
  const monthIndex = MONTH_NAMES.indexOf(m[1]);
  const year = Number(m[2]);
  if (monthIndex < 0 || !Number.isInteger(year)) return null;
  return { year, month: monthIndex };
}

export function isDefaultRunCode(code) {
  return parseDefaultRunCode(code) != null;
}

export function defaultRunTitle(year, monthIndex) {
  const label = MONTH_NAMES[monthIndex].charAt(0) + MONTH_NAMES[monthIndex].slice(1).toLowerCase();
  return `Weekend volleyball — ${label} ${year}`;
}

export function defaultRunMonthLabel(year, monthIndex) {
  const label = MONTH_NAMES[monthIndex].charAt(0) + MONTH_NAMES[monthIndex].slice(1).toLowerCase();
  return `${label} ${year}`;
}
