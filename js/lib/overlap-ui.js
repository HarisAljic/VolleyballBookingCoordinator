import { escapeHtml } from "./html.js";
import {
  formatSlotKeyForDisplay,
  ordinalDay,
  parseSlotKeyToDate,
} from "./dates.js";
import { slotKeyFromParts } from "./slot-keys.js";

export function formatSharedContiguousRange(windowSlots) {
  const w = windowSlots;
  if (!w || !w.length) return "";
  const start = parseSlotKeyToDate(w[0]);
  const lastStart = parseSlotKeyToDate(w[w.length - 1]);
  if (!start || !lastStart) return w.map((s) => formatSlotKeyForDisplay(s)).join(", ");
  const endExclusive = new Date(lastStart);
  endExclusive.setHours(endExclusive.getHours() + 1);
  const month = start.toLocaleString(undefined, { month: "long" });
  const dayOrd = ordinalDay(start.getDate());
  const tStart = start
    .toLocaleString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();
  const tEnd = endExclusive
    .toLocaleString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();
  const sameDay =
    start.getFullYear() === endExclusive.getFullYear() &&
    start.getMonth() === endExclusive.getMonth() &&
    start.getDate() === endExclusive.getDate();
  const dur = w.length;
  if (sameDay) return `${month} ${dayOrd}, ${tStart}–${tEnd} (${dur}h)`;
  return `${formatSlotKeyForDisplay(w[0])} → ${tEnd}`;
}

export function slotEndIsoForHours(slotStartIso, hours) {
  const d = parseSlotKeyToDate(slotStartIso);
  if (!d || !hours) return "";
  d.setHours(d.getHours() + Number(hours));
  return slotKeyFromParts(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours()
  );
}

function personName(p) {
  if (p.displayName) return escapeHtml(p.displayName);
  return escapeHtml(`${p.firstName || ""} ${p.lastName || ""}`.trim() || "Member");
}

function renderRosterWaitlistLists(opt) {
  const roster = opt.roster || [];
  const waitlist = opt.waitlist || [];
  const cap = Number(opt.rosterCapacity) || roster.length;
  const rosterLis = roster.length
    ? roster.map(
        (p) =>
          `<li class="flex items-center gap-2 text-sm text-emerald-100/95"><span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"></span>${personName(p)}</li>`
      )
    : [`<li class="text-sm text-slate-500">No roster yet.</li>`];
  const waitLis = waitlist.length
    ? waitlist.map(
        (p) =>
          `<li class="text-sm text-amber-100/95"><span class="tabular-nums text-amber-400/80">${p.waitlistRank}.</span> ${personName(p)}</li>`
      )
    : [];

  const hasWaitlist = waitLis.length > 0;

  if (hasWaitlist) {
    return `<div class="mt-3 flex items-start gap-6">
      <div>
        <p class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-400/90">Roster (${roster.length}/${cap})</p>
        <ul class="space-y-1">${rosterLis.join("")}</ul>
      </div>
      <div class="border-l border-amber-800/50 pl-6">
        <p class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-400/90">Waitlist (${waitlist.length})</p>
        <ul class="space-y-1">${waitLis.join("")}</ul>
      </div>
    </div>`;
  }

  return `<div class="mt-3">
      <p class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-400/90">Roster (${roster.length}/${cap})</p>
      <ul class="space-y-1">${rosterLis.join("")}</ul>
    </div>`;
}

function renderRentalOptionCard(opt) {
  const keys = opt.slotKeys || [];
  const start = keys[0] || opt.slotStart;
  const dur = Number(opt.durationHours) || keys.length || 2;
  const end = slotEndIsoForHours(start, dur);
  const human = formatSharedContiguousRange(keys);
  const cap = Number(opt.rosterCapacity);
  return `<article class="rounded-lg border border-violet-900/40 bg-violet-950/15 p-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-slate-100">${escapeHtml(human)}</p>
          <p class="mt-1 text-[11px] font-semibold uppercase tracking-wide text-violet-200/85">${escapeHtml(
            `${cap}-player · ${dur}h block`
          )}</p>
        </div>
        <button type="button" class="btn-check-block shrink-0 rounded border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40" data-slot-start="${escapeHtml(
          start
        )}" data-slot-end="${escapeHtml(end)}" data-roster-size="${cap}" ${!end ? "disabled" : ""}>Check venues</button>
      </div>
      ${renderRosterWaitlistLists(opt)}
    </article>`;
}

/**
 * Rental options grouped by date — each option shows roster + waitlist rank (save order).
 * @param {Array} rentalsByDate — from API bookingRentalsByDate
 * @param {number[]} visibleSizes — filter options to these roster sizes (empty = show all)
 */
export function renderBookingRentalsByDate(rentalsByDate, visibleSizes = [], opts = {}) {
  const vis = visibleSizes?.length ? new Set(visibleSizes.map(Number)) : null;
  const openByDefault = opts?.openByDefault !== undefined ? !!opts.openByDefault : true;
  const groups = (rentalsByDate || [])
    .map((dg) => ({
      ...dg,
      options: (dg.options || []).filter((o) =>
        vis ? vis.has(Number(o.rosterCapacity)) : true
      ),
    }))
    .filter((dg) => dg.options.length > 0);
  if (!groups.length) return "";

  const dateSections = groups
    .map((dg) => {
      const cards = dg.options.map((opt) => renderRentalOptionCard(opt)).join("");
      return `<details class="rental-date-group group rounded-xl border border-violet-900/35 bg-violet-950/[0.06] open:border-violet-800/50" ${
        openByDefault ? "open" : ""
      }>
        <summary class="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-semibold text-violet-100">${escapeHtml(dg.dateLabel || dg.date)}</p>
            <span class="text-xs text-slate-500">${dg.options.length} option${dg.options.length === 1 ? "" : "s"}</span>
          </div>
        </summary>
        <div class="space-y-3 border-t border-violet-900/30 px-4 pb-4 pt-2">${cards}</div>
      </details>`;
    })
    .join("");

  return `<div class="space-y-4">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Roster rentals by date</p>
      <p class="text-xs leading-relaxed text-slate-500">Each block needs every hour covered by enough players. <strong class="text-slate-400">Roster</strong> = first N savers for that size; <strong class="text-slate-400">waitlist</strong> = same window but saved later (12→2h, 18→3h, 24→4h).</p>
      <div class="space-y-3">${dateSections}</div>
    </div>`;
}

/** @deprecated — use renderBookingRentalsByDate */
export function renderBookingRentalGroupsForCourtTile(rentalGroups) {
  if (!rentalGroups?.length) return "";
  const byDate = new Map();
  for (const g of rentalGroups) {
    for (const w of g.windows || []) {
      const start = w.slotKeys?.[0];
      const m = /^(\d{4}-\d{2}-\d{2})T/.exec(String(start || ""));
      const date = m ? m[1] : "unknown";
      if (!byDate.has(date)) {
        byDate.set(date, { date, dateLabel: date, options: [] });
      }
      byDate.get(date).options.push({
        optionNumber: g.optionNumber,
        rosterCapacity: w.rosterCapacity,
        durationHours: w.durationHours,
        slotKeys: w.slotKeys,
        slotStart: start,
        roster: [],
        waitlist: [],
      });
    }
  }
  return renderBookingRentalsByDate([...byDate.values()]);
}
