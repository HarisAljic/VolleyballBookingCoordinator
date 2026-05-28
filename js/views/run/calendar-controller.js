import { escapeHtml } from "../../lib/html.js";
import { formatIncludedWeekdaysShort } from "../../../run-weekdays.js";
import { normalizeSlotKey } from "../../lib/slot-keys.js";
import { syncSlotCell } from "../../lib/calendar-cell.js";
import { buildAvailabilityGridTableHtml } from "../../lib/availability-grid.js";
import {
  renderWeekendBlockSummaryHtml,
  sortWeekendDaysForColumns,
} from "../../lib/weekend-calendar.js";
import { state } from "../../state.js";
import {
  buildWeekDaysFromSunday,
  formatLocalDay,
  parseSlotKeyToDate,
} from "../../lib/dates.js";

export function mountRunCalendar(ctx, callbacks) {
  const {
    run,
    schedule,
    selected,
    viewerCanPick,
    rosterCapUi,
  } = ctx;
  const { onSelectionChange } = callbacks;

  const wrap = document.getElementById("calendar-wrap");
  if (!wrap) return;

  const viewerId = run.viewerId != null ? run.viewerId : state.user?.id;
  const readOnly = !viewerCanPick;
  const tag = readOnly ? "div" : "button";
  const extra = readOnly ? ' role="presentation"' : ' type="button"';
  const gridOpts = { hours: schedule.hours, tag, extra, dayActiveInRun: schedule.dayActiveInRun };
  const todayStr = formatLocalDay(new Date());
  const slotKeysForWeekendChips = run.viewerIsMember
    ? new Set(
        (run.viewerSlots || [])
          .map((s) => normalizeSlotKey(String(s)))
          .filter(Boolean)
      )
    : null;

  const refreshGridFromSelection = () => {
    wrap.querySelectorAll(".slot-cell").forEach((el2) => {
      const iso2 = el2.getAttribute("data-slot");
      const d2 = el2.getAttribute("data-day") || "";
      if (!iso2) return;
      syncSlotCell(
        el2,
        iso2,
        selected,
        run.memberAvailability || [],
        viewerId,
        el2.getAttribute("data-hour") || "",
        schedule.dayActiveInRun(d2),
        viewerCanPick,
        rosterCapUi
      );
      if (isPastSlot(iso2)) {
        el2.classList.add("cursor-not-allowed", "opacity-40");
        el2.setAttribute("aria-disabled", "true");
        if (el2.tagName === "BUTTON") el2.setAttribute("disabled", "disabled");
      }
    });
  };

  if (schedule.weekendView) {
    if (!schedule.weekendBlocks.length) {
      wrap.innerHTML = `<p class="px-2 py-6 text-center text-sm text-slate-500">No weekend days fall in this run’s date range.</p>`;
      return;
    }
    const nWeekends = schedule.weekendBlocks.length;
    const toolbar = `<div class="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div>
              <p class="text-sm font-medium text-slate-200">Weekend view</p>
              <p class="text-xs text-slate-500">${nWeekends} weekend${nWeekends === 1 ? "" : "s"} · ${escapeHtml(formatIncludedWeekdaysShort(run.includedWeekdays))} · all collapsed until you expand</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" id="btn-weekend-expand-all" class="rounded border border-slate-600 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800">Expand all</button>
              <button type="button" id="btn-weekend-collapse-all" class="rounded border border-slate-600 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800">Collapse all</button>
            </div>
          </div>`;
    const stack = schedule.weekendBlocks
      .map((blockDays, i) => {
        const cols = sortWeekendDaysForColumns(blockDays);
        const tableHtml = buildAvailabilityGridTableHtml({
          weekDays: cols,
          ...gridOpts,
        });
        const summaryHtml = renderWeekendBlockSummaryHtml(blockDays, slotKeysForWeekendChips, {
          showChips: slotKeysForWeekendChips != null,
        });
        return `<details class="weekend-cal-block group rounded-lg border border-slate-800 bg-slate-950/40 transition-colors hover:border-slate-700/90" data-weekend-idx="${i}">
              ${summaryHtml}
              <div class="border-t border-slate-800 p-2 overflow-x-auto">${tableHtml}</div>
            </details>`;
      })
      .join("");
    const scrollCls =
      nWeekends > 6
        ? "max-h-[min(72vh,56rem)]"
        : nWeekends > 3
          ? "max-h-[min(65vh,48rem)]"
          : "";
    wrap.innerHTML = `${toolbar}<div id="weekend-cal-stack" class="space-y-2 ${scrollCls} overflow-y-auto overscroll-y-contain scroll-smooth pr-1">${stack}</div>`;

    // Past weekend blocks: keep collapsed, prevent opening, and visually gray out.
    wrap.querySelectorAll("details.weekend-cal-block").forEach((details) => {
      const idx = Number(details.getAttribute("data-weekend-idx"));
      if (!Number.isInteger(idx) || idx < 0) return;
      const days = schedule.weekendBlocks[idx] || [];
      const isPastBlock = days.length > 0 && days.every((d) => String(d) < todayStr);
      if (!isPastBlock) return;
      details.open = false;
      details.classList.add("opacity-50");
      const summary = details.querySelector("summary.weekend-cal-summary");
      if (summary) {
        summary.setAttribute("aria-disabled", "true");
        summary.classList.add("cursor-not-allowed");
        summary.addEventListener("click", (e) => {
          e.preventDefault();
        });
        const badge = document.createElement("span");
        badge.className =
          "ml-auto shrink-0 rounded-md border border-slate-700/80 bg-slate-900/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400";
        badge.textContent = "Past";
        summary.appendChild(badge);
      }
      details.querySelectorAll(".slot-cell").forEach((el) => {
        el.classList.add("cursor-not-allowed", "opacity-40");
        el.setAttribute("aria-disabled", "true");
        if (el.tagName === "BUTTON") el.setAttribute("disabled", "disabled");
      });
    });

    document.getElementById("btn-weekend-expand-all")?.addEventListener("click", () => {
      wrap.querySelectorAll("details.weekend-cal-block").forEach((el) => {
        if (el.querySelector('summary[aria-disabled="true"]')) return;
        el.open = true;
      });
    });
    document.getElementById("btn-weekend-collapse-all")?.addEventListener("click", () => {
      wrap.querySelectorAll("details.weekend-cal-block").forEach((el) => {
        el.open = false;
      });
    });
  } else {
    // Disable "previous week" navigation if it would show only past days.
    const prevWeekIsFullyPast = (() => {
      if (!schedule.canPrevWeek) return true;
      const prevIdx = schedule.weekIdx - 1;
      if (prevIdx < 0 || prevIdx >= schedule.weekStarts.length) return true;
      const sunday = schedule.weekStarts[prevIdx];
      const days = buildWeekDaysFromSunday(sunday);
      return days.length > 0 && days.every((d) => String(d) < todayStr);
    })();
    const navRow =
      schedule.weekStarts.length > 1
        ? `<div class="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <button type="button" id="btn-cal-prev" class="rounded border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35" ${
              schedule.canPrevWeek && !prevWeekIsFullyPast ? "" : "disabled"
            }>← Previous week</button>
            <span class="text-center text-xs text-slate-500">${escapeHtml(schedule.weekRangeLabel)}</span>
            <button type="button" id="btn-cal-next" class="rounded border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35" ${
              schedule.canNextWeek ? "" : "disabled"
            }>Next week →</button>
          </div>`
        : schedule.weekRangeLabel
          ? `<p class="mb-2 px-1 text-center text-xs text-slate-500">${escapeHtml(schedule.weekRangeLabel)}</p>`
          : "";
    wrap.innerHTML = `${navRow}<div class="overflow-x-auto">${buildAvailabilityGridTableHtml({
      weekDays: schedule.weekDays,
      ...gridOpts,
    })}</div>`;
    document.getElementById("btn-cal-prev")?.addEventListener("click", () => {
      if (!schedule.canPrevWeek || prevWeekIsFullyPast) return;
      try {
        sessionStorage.setItem(schedule.weekStorageKey, String(schedule.weekIdx - 1));
      } catch {
        /* ignore */
      }
      onSelectionChange?.({ reloadPage: true });
    });
    document.getElementById("btn-cal-next")?.addEventListener("click", () => {
      if (!schedule.canNextWeek) return;
      try {
        sessionStorage.setItem(schedule.weekStorageKey, String(schedule.weekIdx + 1));
      } catch {
        /* ignore */
      }
      onSelectionChange?.({ reloadPage: true });
    });
  }

  const isPastSlot = (iso) => {
    const d = parseSlotKeyToDate(normalizeSlotKey(iso));
    if (!d) return false;
    return d.getTime() < Date.now();
  };

  wrap.querySelectorAll(".slot-cell").forEach((el) => {
    const iso = el.getAttribute("data-slot");
    const dayStr = el.getAttribute("data-day") || "";
    if (!iso) return;
    const past = isPastSlot(iso);
    if (past) {
      el.classList.add("cursor-not-allowed", "opacity-40");
      el.setAttribute("aria-disabled", "true");
      el.setAttribute("title", "Past time");
      if (el.tagName === "BUTTON") el.setAttribute("disabled", "disabled");
    }
    if (!readOnly && schedule.dayActiveInRun(dayStr) && !past) {
      el.addEventListener("click", () => {
        const k = normalizeSlotKey(iso);
        if (selected.has(k)) selected.delete(k);
        else selected.add(k);
        refreshGridFromSelection();
        onSelectionChange?.({ reloadPage: false });
      });
    }
  });
  refreshGridFromSelection();

  // Classic view UX: scroll the grid to the first clickable (not past) slot.
  // (Weekend view is a set of collapsed panels, so auto-scrolling isn't helpful there.)
  if (!schedule.weekendView) {
    requestAnimationFrame(() => {
      const first = Array.from(wrap.querySelectorAll(".slot-cell")).find((el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.tagName !== "BUTTON") return false;
        if (el.hasAttribute("disabled")) return false;
        const iso = el.getAttribute("data-slot");
        const dayStr = el.getAttribute("data-day") || "";
        if (!iso) return false;
        if (!schedule.dayActiveInRun(dayStr)) return false;
        if (isPastSlot(iso)) return false;
        return true;
      });
      if (!first) return;
      const scroller = first.closest(".overflow-x-auto");
      if (!(scroller instanceof HTMLElement)) return;
      const targetLeft =
        first.offsetLeft - scroller.clientWidth / 2 + first.clientWidth / 2;
      scroller.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: "smooth",
      });
    });
  }
}
