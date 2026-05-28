import { nanoid } from "nanoid";
import { db } from "../db-singleton.js";
import { serializeIncludedWeekdays, WEEKEND_ONLY_WEEKDAYS } from "../../run-weekdays.js";
import { serializeRosterTargets } from "../../roster-tiers.js";
import {
  activeDefaultMonth,
  defaultRunCodeForMonth,
  defaultRunTitle,
  defaultWeekendRunDateRange,
  parseDefaultRunCode,
} from "../../default-run-month.js";
import { joinRun, userInRun } from "./repository.js";

function getDefaultRunByCode(runCode) {
  return db
    .prepare(
      `SELECT id, share_token, run_code, title, date_start, date_end
       FROM runs WHERE run_code = ? AND is_default = 1`
    )
    .get(runCode);
}

function createDefaultRunRow({ creatorId, year, monthIndex }) {
  const runCode = defaultRunCodeForMonth(year, monthIndex);
  const { dateStart, dateEnd } = defaultWeekendRunDateRange(year, monthIndex);
  const title = defaultRunTitle(year, monthIndex);
  const shareToken = nanoid(32);
  const weekdaysJson = serializeIncludedWeekdays(WEEKEND_ONLY_WEEKDAYS);
  const targetsJson = serializeRosterTargets([12, 18, 24]);
  const info = db
    .prepare(
      `INSERT INTO runs (creator_id, title, capacity, date_start, date_end, included_weekdays, target_roster_sizes, run_code, share_token, is_default)
       VALUES (?, ?, 12, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      creatorId,
      title,
      dateStart,
      dateEnd,
      weekdaysJson,
      targetsJson,
      runCode,
      shareToken
    );
  const runId = info.lastInsertRowid;
  db.prepare("INSERT INTO run_members (run_id, user_id) VALUES (?, ?)").run(
    runId,
    creatorId
  );
  return {
    runId,
    share_token: shareToken,
    run_code: runCode,
    title,
    date_start: dateStart,
    date_end: dateEnd,
  };
}

function defaultRunPayload(row, year, monthIndex, { created = false } = {}) {
  return {
    shareToken: row.share_token,
    runCode: row.run_code,
    title: row.title,
    year,
    month: monthIndex,
    dateStart: row.date_start,
    dateEnd: row.date_end,
    joined: true,
    created,
  };
}

/**
 * Ensure a calendar month's default weekend run exists and the user is a member.
 */
export function ensureUserInMonthDefaultRun(userId, year, monthIndex) {
  const runCode = defaultRunCodeForMonth(year, monthIndex);
  let row = getDefaultRunByCode(runCode);
  if (!row) {
    row = createDefaultRunRow({ creatorId: userId, year, monthIndex });
    return defaultRunPayload(row, year, monthIndex, { created: true });
  }
  if (!userInRun(row.id, userId)) {
    joinRun(row.id, userId);
  }
  return defaultRunPayload(row, year, monthIndex, { created: false });
}

/** Ensure the active default month's run exists and the user is a member. */
export function ensureUserInDefaultRun(userId, when = new Date()) {
  const { year, month } = activeDefaultMonth(when);
  return ensureUserInMonthDefaultRun(userId, year, month);
}

/** Join (or create) a default run from its MONTHYEAR code (e.g. JUNE2026). */
export function ensureUserInDefaultRunByCode(userId, code) {
  const parsed = parseDefaultRunCode(code);
  if (!parsed) return null;
  return ensureUserInMonthDefaultRun(userId, parsed.year, parsed.month);
}

export function isDefaultRunRow(runRow) {
  return Number(runRow?.is_default) === 1;
}
