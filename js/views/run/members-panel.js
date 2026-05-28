import { escapeHtml } from "../../lib/html.js";
import { formatMemberAvailabilityRanges } from "../../lib/dates.js";
import { parseSlotKeyToDate } from "../../lib/dates.js";
import { normalizeSlotKey } from "../../lib/slot-keys.js";

function hasAnyFutureSlot(slotKeys) {
  for (const raw of slotKeys || []) {
    const d = parseSlotKeyToDate(normalizeSlotKey(String(raw)));
    if (d && d.getTime() >= Date.now()) return true;
  }
  return false;
}

function buildFutureRosterWaitlistIndex(bookingRentalsByDate, visibleRosterSizes) {
  const vis = visibleRosterSizes?.length ? new Set(visibleRosterSizes.map(Number)) : null;
  const roster = new Set();
  const waitlist = new Set();
  for (const dg of bookingRentalsByDate || []) {
    for (const opt of dg.options || []) {
      const cap = Number(opt.rosterCapacity);
      if (vis && !vis.has(cap)) continue;
      const start = normalizeSlotKey(String(opt.slotKeys?.[0] || opt.slotStart || ""));
      const dt = parseSlotKeyToDate(start);
      if (!dt || dt.getTime() < Date.now()) continue;
      for (const p of opt.roster || []) roster.add(Number(p.userId));
      for (const p of opt.waitlist || []) waitlist.add(Number(p.userId));
    }
  }
  return { roster, waitlist };
}

function statusDotHtml({ isWaitlisted, hasSavedFuture, isOnRoster }) {
  if (isWaitlisted) {
    return `<span class="mt-1 inline-flex h-2 w-2 rounded-full bg-amber-400" title="Waitlisted on at least one future window"></span>`;
  }
  if (hasSavedFuture) {
    return `<span class="mt-1 inline-flex h-2 w-2 rounded-full bg-sky-400" title="Has future availability saved"></span>`;
  }
  if (isOnRoster) {
    return `<span class="mt-1 inline-flex h-2 w-2 rounded-full bg-emerald-400" title="On roster for at least one future window"></span>`;
  }
  return `<span class="mt-1 inline-flex h-2 w-2 rounded-full bg-slate-600/80" title="No future status yet"></span>`;
}

function windowsForMember(m, { isViewer, selected, slotsByUserId }) {
  const mid = Number(m.id);
  const slotsLive = isViewer
    ? [...selected].sort((a, b) => a.localeCompare(b))
    : slotsByUserId.get(mid) || [];
  return formatMemberAvailabilityRanges(slotsLive);
}

function encodeWindowsAttr(ranges) {
  return escapeHtml(JSON.stringify(ranges));
}

export function renderMemberRows(
  run,
  { selected, slotsByUserId, visibleRosterSizes, bookingRentalsByDate }
) {
  const idx = buildFutureRosterWaitlistIndex(bookingRentalsByDate, visibleRosterSizes);
  const tiles = run.members
    .map((m) => {
      const mid = Number(m.id);
      const isViewer =
        run.viewerIsMember && run.viewerId != null && mid === Number(run.viewerId);
      const ranges = windowsForMember(m, { isViewer, selected, slotsByUserId });
      const fullName = `${m.firstName || ""} ${m.lastName || ""}`.trim() || "Member";
      const hasSavedFuture = hasAnyFutureSlot(isViewer ? [...selected] : slotsByUserId.get(mid) || []);
      const isWaitlisted = idx.waitlist.has(mid);
      const isOnRoster = idx.roster.has(mid);
      const dot = statusDotHtml({ isWaitlisted, hasSavedFuture, isOnRoster });

      const stateCls = isOnRoster
        ? "border-emerald-700/50 bg-emerald-950/35 text-emerald-50 hover:border-emerald-600/60 hover:bg-emerald-950/55"
        : hasSavedFuture
          ? "border-slate-700/80 bg-slate-950/40 text-slate-200 hover:border-slate-600 hover:bg-slate-900/80"
          : "border-slate-700/80 bg-slate-950/50 text-slate-400 hover:border-slate-600 hover:bg-slate-900/80";

      const viewerCls = isViewer ? "ring-2 ring-sky-500/50 ring-offset-1 ring-offset-slate-900" : "";

      const emptyHint = isViewer
        ? "No times selected yet — use the calendar below."
        : "No availability saved.";

      return `<button
          type="button"
          class="member-tile flex min-h-[3.5rem] flex-col items-center justify-center rounded-lg border px-1.5 py-2 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${stateCls} ${viewerCls}"
          title="${escapeHtml(fullName)}"
          data-user-id="${mid}"
          data-member-name="${escapeHtml(fullName)}"
          data-windows="${encodeWindowsAttr(ranges)}"
          data-empty-hint="${escapeHtml(emptyHint)}"
          aria-label="${escapeHtml(fullName)} availability"
        >
          <span class="member-tile-name w-full truncate text-[11px] font-medium leading-snug">${escapeHtml(fullName)}</span>
          ${dot}
        </button>`;
    })
    .join("");

  return `<div id="members-tile-grid" class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">${tiles}</div>
    <div id="member-avail-tooltip" class="pointer-events-none fixed z-50 hidden max-w-[16rem] rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-xs text-slate-200 shadow-xl" role="tooltip"></div>`;
}

/** Hover / tap tooltips for member tiles; updates viewer tile when grid selection changes. */
export function bindMemberTiles({ run, selected, slotsByUserId }) {
  const tip = document.getElementById("member-avail-tooltip");
  const grid = document.getElementById("members-tile-grid");
  if (!tip || !grid) return { refreshViewerTile: () => {} };

  let pinnedTile = null;

  const hideTip = () => {
    tip.classList.add("hidden");
    pinnedTile = null;
  };

  const showTipFor = (el, { pin = false } = {}) => {
    if (!(el instanceof HTMLElement) || !el.classList.contains("member-tile")) return;
    const name = el.getAttribute("data-member-name") || "Member";
    let lines = [];
    try {
      lines = JSON.parse(el.getAttribute("data-windows") || "[]");
      if (!Array.isArray(lines)) lines = [];
    } catch {
      lines = [];
    }
    const emptyHint = el.getAttribute("data-empty-hint") || "No availability saved.";

    const body =
      lines.length > 0
        ? `<ul class="mt-1 list-none space-y-0.5 text-slate-300">${lines.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`
        : `<p class="mt-1 text-slate-500">${escapeHtml(emptyHint)}</p>`;

    tip.innerHTML = `<p class="font-semibold text-slate-100">${escapeHtml(name)}</p>${body}`;

    const rect = el.getBoundingClientRect();
    const tipW = 256;
    let left = rect.left + rect.width / 2 - tipW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
    let top = rect.top - 8;
    tip.style.width = `${tipW}px`;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.transform = "translateY(-100%)";
    tip.classList.remove("hidden");

    if (pin) pinnedTile = el;
  };

  grid.querySelectorAll(".member-tile").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      if (!pinnedTile) showTipFor(el);
    });
    el.addEventListener("mouseleave", () => {
      if (!pinnedTile) hideTip();
    });
    el.addEventListener("focus", () => showTipFor(el));
    el.addEventListener("blur", () => {
      if (!pinnedTile) hideTip();
    });
    el.addEventListener("click", (e) => {
      e.preventDefault();
      if (pinnedTile === el) {
        hideTip();
        return;
      }
      showTipFor(el, { pin: true });
    });
  });

  document.addEventListener(
    "click",
    (e) => {
      if (!pinnedTile) return;
      const t = e.target;
      if (t instanceof Node && (pinnedTile.contains(t) || tip.contains(t))) return;
      hideTip();
    },
    true
  );

  const refreshViewerTile = () => {
    if (!run.viewerId) return;
    const el = grid.querySelector(`.member-tile[data-user-id="${Number(run.viewerId)}"]`);
    if (!(el instanceof HTMLElement)) return;
    const m = run.members.find((x) => Number(x.id) === Number(run.viewerId));
    if (!m) return;
    const ranges = windowsForMember(m, {
      isViewer: true,
      selected,
      slotsByUserId,
    });
    el.setAttribute("data-windows", JSON.stringify(ranges));
    const hasWindows = ranges.length > 0;
    el.classList.toggle("border-emerald-800/60", hasWindows);
    el.classList.toggle("bg-emerald-950/40", hasWindows);
    el.classList.toggle("text-emerald-100", hasWindows);
    el.classList.toggle("border-slate-700/80", !hasWindows);
    el.classList.toggle("bg-slate-950/50", !hasWindows);
    el.classList.toggle("text-slate-400", !hasWindows);
    if (pinnedTile === el) showTipFor(el, { pin: true });
  };

  return { refreshViewerTile };
}
