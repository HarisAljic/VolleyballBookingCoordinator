import { escapeHtml } from "./html.js";
import { calendarDayHeader, slotKeyDayStr } from "./dates.js";
import {
  parseIncludedWeekdays,
  WEEKDAY_LABELS,
  weekdayFromDayStr,
} from "../../run-weekdays.js";

/** Sun, Fri, Sat — JavaScript Date#getDay values. */
export const WEEKEND_WEEKDAYS = [0, 5, 6];

export function isWeekendOnlySchedule(includedWeekdays) {
  const parsed = parseIncludedWeekdays(includedWeekdays);
  if (!parsed.length) return false;
  const weekendSet = new Set(WEEKEND_WEEKDAYS);
  return parsed.every((d) => weekendSet.has(d));
}

function daysBetweenDayStr(a, b) {
  const da = new Date(a + "T12:00:00");
  const db = new Date(b + "T12:00:00");
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
  return Math.round((db - da) / 86400000);
}

/** Split sorted run days into Fri–Sun (or partial weekend) clusters separated by weekdays. */
export function groupDayStringsIntoWeekendBlocks(sortedDayStrs) {
  const sorted = [...(sortedDayStrs || [])].sort();
  const blocks = [];
  let cur = [];
  for (const d of sorted) {
    if (!cur.length) {
      cur.push(d);
      continue;
    }
    if (daysBetweenDayStr(cur[cur.length - 1], d) > 1) {
      blocks.push(cur);
      cur = [d];
    } else {
      cur.push(d);
    }
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

export function formatWeekendBlockLabel(dayStrs) {
  const days = [...(dayStrs || [])].sort();
  if (!days.length) return "Weekend";
  if (days.length === 1) return calendarDayHeader(days[0]);
  return `${calendarDayHeader(days[0])} – ${calendarDayHeader(days[days.length - 1])}`;
}

/** True if any saved/drafted slot falls on this calendar day. */
export function dayHasViewerSlots(dayStr, slotKeys) {
  const keys = slotKeys instanceof Set ? [...slotKeys] : slotKeys || [];
  return keys.some((k) => slotKeyDayStr(String(k)) === dayStr);
}

const CHECK_SVG = `<svg class="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6.173 11.414 3.05 8.293a1 1 0 10-1.414 1.414l4.24 4.242a1 1 0 001.414 0l7.778-7.778a1 1 0 00-1.414-1.414L6.173 11.414z"/></svg>`;

/** Per-day chips (gray = no saved hours, green + check = saved hours on that day). */
export function renderWeekendDayStatusChipsHtml(blockDays, slotKeys) {
  return sortWeekendDaysForColumns(blockDays || [])
    .map((dayStr) => {
      const wd = weekdayFromDayStr(dayStr);
      const label = WEEKDAY_LABELS[wd] ?? dayStr;
      const has = dayHasViewerSlots(dayStr, slotKeys);
      if (has) {
        return `<span class="inline-flex items-center gap-0.5 rounded-full border border-emerald-600/55 bg-emerald-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-100" title="Saved availability on ${escapeHtml(label)}">${CHECK_SVG}<span>${escapeHtml(label)}</span></span>`;
      }
      return `<span class="inline-flex items-center rounded-full border border-slate-700/90 bg-slate-800/50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500" title="No saved availability on ${escapeHtml(label)}">${escapeHtml(label)}</span>`;
    })
    .join("");
}

const CHEVRON_SVG = `<svg class="h-4 w-4 transition-transform duration-200 group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>`;

/** Collapsible weekend panel summary (always starts collapsed). */
export function renderWeekendBlockSummaryHtml(blockDays, slotKeys, { showChips = true } = {}) {
  const chips =
    showChips && slotKeys != null
      ? `<span class="mt-1.5 flex flex-wrap gap-1" data-weekend-chips>${renderWeekendDayStatusChipsHtml(blockDays, slotKeys)}</span>`
      : "";
  return `<summary class="weekend-cal-summary flex cursor-pointer list-none items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-200 transition hover:border-slate-700/80 hover:bg-slate-900/70 focus-visible:outline focus-visible:ring-2 focus-visible:ring-emerald-500/45 [&::-webkit-details-marker]:hidden">
      <span class="weekend-cal-chevron flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-600 bg-slate-900/90 text-slate-400 shadow-sm group-open:border-emerald-600/40 group-open:bg-emerald-950/50 group-open:text-emerald-400" aria-hidden="true">${CHEVRON_SVG}</span>
      <span class="min-w-0 flex-1">
        <span class="font-medium text-slate-100">${escapeHtml(formatWeekendBlockLabel(blockDays))}</span>
        ${chips}
      </span>
      <span class="weekend-cal-open-label hidden shrink-0 text-xs font-medium text-emerald-400/90 group-open:inline">Open</span>
      <span class="weekend-cal-tap-hint shrink-0 rounded-md border border-slate-700/80 bg-slate-800/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 group-open:hidden">Tap to pick</span>
    </summary>`;
}

/** Column order Fri → Sat → Sun for weekend tables (subset of block days). */
export function sortWeekendDaysForColumns(dayStrs) {
  const order = [5, 6, 0];
  return [...(dayStrs || [])].sort((a, b) => {
    const wa = weekdayFromDayStr(a);
    const wb = weekdayFromDayStr(b);
    return order.indexOf(wa) - order.indexOf(wb);
  });
}
