import { escapeHtml } from "./html.js";
import {
  formatSlotKeyForDisplay,
  ordinalDay,
  parseSlotKeyToDate,
} from "./dates.js";
import { normalizeSlotKey, slotKeyFromParts } from "./slot-keys.js";

/** Maximal runs of consecutive wall-clock hours present in everyone’s overlap. */
export function contiguousOverlapRuns(sortedOverlap) {
  const keys = [...(sortedOverlap || [])]
    .map((x) => normalizeSlotKey(String(x)))
    .filter(Boolean)
    .sort();
  const runs = [];
  let cur = [];
  for (const k of keys) {
    if (!cur.length) {
      cur.push(k);
      continue;
    }
    const prevT = parseSlotKeyToDate(cur[cur.length - 1]);
    const curT = parseSlotKeyToDate(k);
    if (prevT && curT && curT.getTime() - prevT.getTime() === 3600000) cur.push(k);
    else {
      runs.push(cur);
      cur = [k];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** Every contiguous k-hour window (k slot keys) across maximal overlap runs; sorted by start time. */
export function allKHourWindowsFromRuns(runs, k) {
  const blocks = [];
  for (const run of runs) {
    if (!run?.length || run.length < k) continue;
    for (let i = 0; i <= run.length - k; i++) {
      blocks.push(run.slice(i, i + k));
    }
  }
  blocks.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return blocks;
}

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

export function renderOverlapBlockSummary(overlapSlots) {
  const runs = contiguousOverlapRuns(overlapSlots);
  const total = (overlapSlots || []).length;
  const rows = [
    { k: 4, title: "All 4-hour blocks" },
    { k: 3, title: "All 3-hour blocks" },
    { k: 2, title: "All 2-hour blocks" },
  ];
  const lines = [
    `<p class="font-medium text-emerald-300/95">Everyone overlaps on <strong class="text-emerald-200">${total}</strong> hour-slot${total === 1 ? "" : "s"}. (Court links live in the “Skedda court check” tile.)</p>`,
    '<ul class="mt-1.5 list-none space-y-3 pl-0 text-emerald-100/90">',
  ];
  for (const { k, title } of rows) {
    const wins = allKHourWindowsFromRuns(runs, k);
    const missing = `<span class="text-slate-500">None — no shared contiguous block of that length.</span>`;
    let body = missing;
    if (wins.length) {
      const items = wins
        .map((win) => {
          const rangeHuman = formatSharedContiguousRange(win);
          return `<li class="leading-snug"><span class="text-slate-200">${escapeHtml(rangeHuman)}</span></li>`;
        })
        .join("");
      body = `<span class="text-[11px] uppercase tracking-wide text-slate-500">${wins.length} block${wins.length === 1 ? "" : "s"}</span><ul class="mt-1.5 space-y-1.5 border-l border-slate-700/80 pl-3 text-emerald-100/90">${items}</ul>`;
    }
    lines.push(`<li><span class="text-emerald-400/90">${escapeHtml(title)}</span><div class="mt-1 pl-0.5">${body}</div></li>`);
  }
  lines.push("</ul>");
  return `<div class="mt-2 text-sm">${lines.join("")}</div>`;
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

/** Grouped roster windows (“rental options”) — each variant row uses `.btn-check-block`. */
export function renderBookingRentalGroupsForCourtTile(rentalGroups) {
  if (!rentalGroups?.length) return "";
  const capKey = rentalGroups.find((g) => g.windows?.[0]?.rosterCapacity != null)?.windows?.[0]
    ?.rosterCapacity;
  const capExplain = escapeHtml(capKey != null ? String(capKey) : "the roster size");

  const blocks = rentalGroups.map((g) => {
    const wins = [...(g.windows || [])];
    const anchor = wins.reduce(
      (best, cur) =>
        (cur.slotKeys?.length || 0) > (best.slotKeys?.length || 0) ? cur : best,
      wins[0]
    );
    const anchorHuman = anchor?.slotKeys?.length
      ? formatSharedContiguousRange(anchor.slotKeys)
      : "";
    const rows = wins
      .map((c) => {
        const keys = c.slotKeys || [];
        if (!keys.length) return "";
        const start = keys[0];
        const end = slotEndIsoForHours(start, Number(c.durationHours) || keys.length);
        const human = formatSharedContiguousRange(keys);
        const cap = Number(c.rosterCapacity);
        const capLbl = escapeHtml(Number.isFinite(cap) ? `${cap}-player quorum` : "roster quorum");
        return `<div class="flex flex-wrap items-center justify-between gap-2 rounded border border-violet-900/35 bg-violet-950/20 px-3 py-2">
            <div class="min-w-[12rem] text-sm text-slate-200">${escapeHtml(human)}
              <div class="mt-1 text-[11px] uppercase tracking-wide text-violet-200/85">${capLbl}</div>
            </div>
            <button type="button" class="btn-check-block rounded border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40" data-slot-start="${escapeHtml(
              start
            )}" data-slot-end="${escapeHtml(end)}" ${!end ? "disabled" : ""}>Check venues</button>
          </div>`;
      })
      .filter(Boolean)
      .join("");
    return `<section class="rounded-lg border border-violet-900/35 bg-violet-950/[0.07] p-3">
        <p class="text-sm font-semibold text-violet-200">${escapeHtml(
          `Rental option ${g.optionNumber}`
        )}</p>
        <p class="mt-0.5 text-xs text-slate-400">${escapeHtml(
          anchorHuman
            ? `Same start — variants by length (${anchorHuman})`
            : "Same calendar start — variants below differ by booking length."
        )}</p>
        <div class="mt-3 space-y-2">${rows}</div>
      </section>`;
  });

  return `<div class="space-y-4">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Roster rentals</p>
      <p class="text-xs leading-relaxed text-slate-500">Needs <strong>${capExplain}</strong> people counting toward the coalition covering every hour in a block — while scheduling is still open before the roster waitlist locks, everyone who joined can count; after scheduling locks only roster seats count. Your tags for “fits / waitlisted” match if you saved a block that clears at least one length below.</p>
      ${blocks.join("")}
    </div>`;
}

export function renderOverlapWindowsForCourtTile(overlapSlots) {
  const runs = contiguousOverlapRuns(overlapSlots);
  const groups = [
    { k: 4, label: "4-hour" },
    { k: 3, label: "3-hour" },
    { k: 2, label: "2-hour" },
  ];
  const sections = [];
  for (const g of groups) {
    const wins = allKHourWindowsFromRuns(runs, g.k);
    if (!wins.length) {
      sections.push(
        `<div class="rounded border border-slate-800/70 bg-slate-950/20 px-3 py-2 text-sm text-slate-500">No shared ${g.label} block.</div>`
      );
      continue;
    }
    const items = wins
      .map((win) => {
        const start = win[0];
        const end = slotEndIsoForHours(start, g.k);
        const human = formatSharedContiguousRange(win);
        return `<div class="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800/70 bg-slate-950/20 px-3 py-2">
            <div class="text-sm text-slate-200">${escapeHtml(human)}</div>
            <button type="button" class="btn-check-block rounded border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40" data-slot-start="${escapeHtml(
              start
            )}" data-slot-end="${escapeHtml(end)}" ${!end ? "disabled" : ""}>Check venues</button>
          </div>`;
      })
      .join("");
    sections.push(
      `<div class="space-y-2">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">${escapeHtml(
            g.label
          )} blocks (${wins.length})</p>
          <div class="space-y-2">${items}</div>
        </div>`
    );
  }
  return sections.join('<div class="h-3"></div>');
}
