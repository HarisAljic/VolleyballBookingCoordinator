import { escapeHtml } from "./html.js";
import { calendarDayHeader } from "./dates.js";
import { slotKeyFromDayStrAndHour } from "./slot-keys.js";

/** Hour × day availability grid (one week or one weekend block). */
export function buildAvailabilityGridTableHtml({
  weekDays,
  hours,
  tag,
  extra,
  dayActiveInRun,
}) {
  const thead = `<tr><th class="sticky left-0 z-10 w-[3.25rem] bg-slate-900 p-2 text-left text-xs text-slate-500">Hour</th>${weekDays
    .map((d) => {
      const inR = dayActiveInRun(d);
      const thCls = inR
        ? "min-w-[4.5rem] border-l border-slate-800 p-2 text-center text-xs font-medium text-slate-400"
        : "min-w-[4.5rem] border-l border-slate-800/80 bg-slate-950/50 p-2 text-center text-xs font-medium text-slate-600";
      return `<th class="${thCls}">${escapeHtml(calendarDayHeader(d))}</th>`;
    })
    .join("")}</tr>`;
  const rows = hours
    .map((h) => {
      const cells = weekDays
        .map((d) => {
          const iso = slotKeyFromDayStrAndHour(d, h);
          return `<td class="border-l border-t border-slate-800 p-0.5 text-center">
              <${tag}${extra} class="slot-cell" data-slot="${escapeHtml(iso)}" data-day="${escapeHtml(
            d
          )}" data-hour="${h}"></${tag}>`;
        })
        .join("");
      return `<tr><td class="sticky left-0 z-10 w-[3.25rem] bg-slate-900 px-2 py-1 text-xs text-slate-500">${h}:00</td>${cells}</tr>`;
    })
    .join("");
  return `<table class="w-full min-w-max border-collapse text-sm"><thead>${thead}</thead><tbody>${rows}</tbody></table>`;
}
