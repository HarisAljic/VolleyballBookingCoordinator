import {
  buildWeekDaysFromSunday,
  formatWeekRangeLabel,
  startOfWeekSunday,
  weekStartsOverlappingRun,
} from "../../lib/dates.js";
import {
  eachIncludedDayInclusive,
  dayInRunSchedule,
} from "../../../run-weekdays.js";
import {
  groupDayStringsIntoWeekendBlocks,
  isWeekendOnlySchedule,
} from "../../lib/weekend-calendar.js"; 

export function buildRunScheduleState(run, token) {
  const allRunDays = eachIncludedDayInclusive(
    run.dateStart,
    run.dateEnd,
    run.includedWeekdays
  );
  const dayActiveInRun = (dayStr) =>
    dayInRunSchedule(dayStr, run.dateStart, run.dateEnd, run.includedWeekdays);
  const hours = [];
  for (let h = 6; h <= 23; h++) hours.push(h);

  const weekendView = isWeekendOnlySchedule(run.includedWeekdays);
  const weekendBlocks = weekendView
    ? groupDayStringsIntoWeekendBlocks(allRunDays)
    : [];

  const weekStarts = weekendView
    ? []
    : weekStartsOverlappingRun(run.dateStart, run.dateEnd);
  const weekStorageKey = `vbweek_${token}`;
  let weekIdx = 0;
  try {
    const raw = sessionStorage.getItem(weekStorageKey);
    const n = raw != null ? parseInt(raw, 10) : 0;
    if (!Number.isNaN(n)) weekIdx = n;
  } catch {
    /* ignore */
  }
  if (weekStarts.length > 0) {
    weekIdx = Math.max(0, Math.min(weekStarts.length - 1, weekIdx));
  } else {
    weekIdx = 0;
  }
  const weekDays =
    weekStarts.length > 0
      ? buildWeekDaysFromSunday(weekStarts[weekIdx])
      : allRunDays.length
        ? buildWeekDaysFromSunday(startOfWeekSunday(new Date(allRunDays[0] + "T12:00:00")))
        : [];

  return {
    allRunDays,
    dayActiveInRun,
    hours,
    weekendView,
    weekendBlocks,
    weekStarts,
    weekStorageKey,
    weekIdx,
    weekDays,
    weekRangeLabel: formatWeekRangeLabel(weekDays),
    canPrevWeek: weekIdx > 0,
    canNextWeek: weekIdx < weekStarts.length - 1,
  };
}
