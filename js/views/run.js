import { isVbDiag } from "../lib/diag.js";
import { api } from "../api.js";
import { layout, showToast } from "../layout.js";
import { refreshUser } from "../auth-nav.js";
import { state, setQuery } from "../state.js";
import { escapeHtml } from "../lib/html.js";
import {
  buildWeekDaysFromSunday,
  calendarDayHeader,
  computeDisplayLockCount,
  dayInRunRange,
  eachDayInclusive,
  formatMemberAvailabilityRanges,
  formatSlotKeyForDisplay,
  formatTimeHmLower,
  formatWeekRangeLabel,
  ordinalDay,
  parseSlotKeyToDate,
  slotKeyDayStr,
  startOfWeekSunday,
  weekStartsOverlappingRun,
} from "../lib/dates.js";
import { normalizeSlotKey, slotKeyFromDayStrAndHour } from "../lib/slot-keys.js";
import {
  renderBookingRentalGroupsForCourtTile,
  renderOverlapBlockSummary,
  renderOverlapWindowsForCourtTile,
} from "../lib/overlap-ui.js";
import { SKEDDA_VENUES, skeddaVenueHref } from "../lib/skedda.js";
import { formatUsdFromCents, venueTotalPriceCents } from "../lib/pricing.js";
import { otherTeammateCountAtSlot, syncSlotCell } from "../lib/calendar-cell.js";

/**
 * Viewer’s unsaved slot picks for a run (same Set across week navigation).
 * Cleared after a successful Save, when leaving the run, or when navigating away (see main.js).
 */
const viewerSlotDraftByRunToken = new Map();

export function clearRunViewerSlotDrafts() {
  viewerSlotDraftByRunToken.clear();
}

function getViewerSlotSelection(token, run) {
  let selected = viewerSlotDraftByRunToken.get(token);
  if (!selected) {
    selected = new Set(
      (run.viewerSlots || []).map((s) => normalizeSlotKey(String(s))).filter(Boolean)
    );
    viewerSlotDraftByRunToken.set(token, selected);
  }
  return selected;
}

async function goHome() {
  const { renderHome } = await import("./home.js");
  await renderHome();
}

export async function renderRunPage() {
  await refreshUser();
  const token = state.runToken;
  if (!token) {
    await goHome();
    return;
  }
  let run;
  try {
    const diagQ = isVbDiag() ? "?diag=1" : "";
    run = await api(`/api/runs/public/${encodeURIComponent(token)}${diagQ}`, {
      method: "GET",
    });
  } catch (err) {
    if (isVbDiag()) console.error("[vbdiag] GET /api/runs/public failed", err);
    layout("Run not found", `<p class="text-center text-slate-400">This link may be invalid or expired.</p>`, {
      variant: "form",
    });
    return;
  }

  if (isVbDiag()) {
    console.info("[vbdiag] run summary", {
      title: run.title,
      dateStart: run.dateStart,
      dateEnd: run.dateEnd,
      memberCount: run.memberCount,
      viewerIsMember: run.viewerIsMember,
      viewerId: run.viewerId,
      memberAvailabilityLen: run.memberAvailability?.length,
      serverDiag: run.diag || null,
    });
  }

  const allRunDays = eachDayInclusive(run.dateStart, run.dateEnd);
  const hours = [];
  for (let h = 6; h <= 23; h++) hours.push(h);

  const weekStarts = weekStartsOverlappingRun(run.dateStart, run.dateEnd);
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
  const weekRangeLabel = formatWeekRangeLabel(weekDays);
  const canPrevWeek = weekIdx > 0;
  const canNextWeek = weekIdx < weekStarts.length - 1;

  if (isVbDiag() && allRunDays.length) {
    let maxOc = 0;
    for (const d of allRunDays) {
      for (const h of [6, 12, 18, 21]) {
        const cell = slotKeyFromDayStrAndHour(d, h);
        const oc = otherTeammateCountAtSlot(
          cell,
          run.memberAvailability || [],
          run.viewerId
        );
        if (oc > maxOc) maxOc = oc;
      }
    }
    const may9 =
      allRunDays.find((x) => /-05-09$/.test(x)) ||
      allRunDays[Math.floor(allRunDays.length / 2)];
    if (may9) {
      const probe = slotKeyFromDayStrAndHour(may9, 18);
      console.info("[vbdiag] grid probe", {
        probeDay: may9,
        probeKey: probe,
        otherCountAtProbe: otherTeammateCountAtSlot(
          probe,
          run.memberAvailability || [],
          run.viewerId
        ),
        maxOtherCountSampledOnSparseGrid: maxOc,
      });
    }
  }

  const viewerCanPick = Boolean(
    run.viewerCanSetAvailability !== undefined
      ? run.viewerCanSetAvailability
      : run.viewerIsActiveRoster
  );
  const selected = viewerCanPick ? getViewerSlotSelection(token, run) : new Set();

  const slotsByUserId = new Map();
  for (const m of run.memberAvailability || []) {
    slotsByUserId.set(Number(m.userId), m.slots || []);
  }
  const legacyMatched = run.viewerMatchedRentalOptionNumbers || [];
  const splitWl = run.viewerWaitlistedRentalOptionNumbers;
  const splitFit = run.viewerFitsRentalOptionNumbers;
  const hasPerOptionRental = splitWl != null && splitFit != null;
  const rentalChips = [];
  if (hasPerOptionRental) {
    for (const n of splitWl) {
      rentalChips.push({ n: Number(n), kind: "wl" });
    }
    for (const n of splitFit) {
      rentalChips.push({ n: Number(n), kind: "fit" });
    }
  }
  if (!rentalChips.length && legacyMatched.length > 0) {
    const legacyAllWaitlist =
      Boolean(run.viewerQueuedForRoster) ||
      (!!run.viewerIsMember &&
        !run.viewerIsActiveRoster &&
        !!run.schedulingWaitlistActive);
    for (const n of legacyMatched) {
      rentalChips.push({
        n: Number(n),
        kind: legacyAllWaitlist ? "wl" : "fit",
      });
    }
  }
  rentalChips.sort(
    (a, b) => a.n - b.n || (a.kind === b.kind ? 0 : a.kind === "wl" ? -1 : 1)
  );
  const viewerRentalChipStrip =
    rentalChips.length === 0
      ? ""
      : `<span class="ml-2 flex flex-wrap items-center gap-1">${rentalChips
          .map(({ n, kind }) => {
            const lbl =
              kind === "wl"
                ? `Waitlisted · rental opt. ${n}`
                : `In coalition · rental opt. ${n}`;
            const cls =
              kind === "wl"
                ? "rounded bg-amber-950/85 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-50 ring-1 ring-amber-600/75"
                : "rounded bg-violet-950/85 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-100 ring-1 ring-violet-600/75";
            return `<span class="${cls}">${escapeHtml(lbl)}</span>`;
          })
          .join("")}</span>`;

  const rosterCapUi = Number(run.capacity) || 0;
  const memberMarkerCls = "[&>summary::-webkit-details-marker]:hidden";
  const memberRows = run.members
    .map((m, idx) => {
      const mid = Number(m.id);
      const isViewer =
        run.viewerIsMember && run.viewerId != null && mid === Number(run.viewerId);
      const pastJoinCap = idx >= rosterCapUi;
      const pastSavedWaitlist = !!m.waitlisted;
      const wlRank = m.waitlistRank != null ? Number(m.waitlistRank) : null;
      const wlFrozen = pastJoinCap && !!run.schedulingWaitlistActive;
      const name = `${escapeHtml(m.firstName)} ${escapeHtml(m.lastName)}`;
      const wlTag = `<span class="ml-2 shrink-0 rounded bg-amber-950/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100 ring-1 ring-amber-600/90">Waitlist #${wlRank != null ? wlRank : "?"}</span>`;

      if (wlFrozen) {
        const waitBlurb = isViewer
          ? `<p class="mt-1 text-xs text-amber-100/90">A shared window is locked for the first ${rosterCapUi} roster spots — calendar editing is closed until you move onto the active roster.</p>`
          : `<p class="mt-1 text-xs text-slate-500">Waiting for a spot on the active roster (first in, first up).</p>`;
        return `<div class="member-avail mb-1 rounded border border-amber-900/50 bg-amber-950/20 px-2 py-1.5 text-sm">
            <div class="flex flex-wrap items-center gap-x-1"><span class="font-medium text-slate-100">${name}</span>${pastSavedWaitlist ? wlTag : ""}${isViewer ? viewerRentalChipStrip : ""}</div>
            ${waitBlurb}
          </div>`;
      }

      const slotsLive = isViewer
        ? [...selected].sort((a, b) => a.localeCompare(b))
        : slotsByUserId.get(mid) || [];
      const ranges = formatMemberAvailabilityRanges(slotsLive);
      if (!Array.isArray(run.memberAvailability)) {
        return `<div class="text-sm text-slate-300">${name}</div>`;
      }
      const detailsCls = `member-avail mb-1 rounded border border-slate-800/80 bg-slate-950/30 px-2 py-1.5 ${memberMarkerCls}`;
      if (!ranges.length) {
        const noteSpan = isViewer
          ? `<span id="member-avail-viewer-note" class="text-xs font-normal text-slate-500"> — no times selected in the grid yet</span>`
          : `<span class="text-xs font-normal text-slate-500"> — no availability saved</span>`;
        const bodyInner = isViewer
          ? `<p class="text-xs text-slate-600">Pick cells on the calendar, then Save.</p>`
          : `<p class="text-xs text-slate-600">No availability saved.</p>`;
        const bodyWrap = isViewer
          ? `<div id="member-avail-viewer-body" class="member-avail-body mt-1">${bodyInner}</div>`
          : `<div class="member-avail-body mt-1">${bodyInner}</div>`;
        const head = `<span class="font-medium text-slate-200">${name}</span>${pastSavedWaitlist ? wlTag : ""}`;
        return `<details class="${detailsCls}" data-user-id="${mid}">
            <summary class="cursor-pointer select-none text-sm">${head}${noteSpan}${isViewer ? viewerRentalChipStrip : ""}</summary>
            ${bodyWrap}
          </details>`;
      }
      const winLabel = ` — ${ranges.length} free window${ranges.length === 1 ? "" : "s"}`;
      const noteSpan = isViewer
        ? `<span id="member-avail-viewer-note" class="text-xs font-normal text-slate-500">${escapeHtml(winLabel)}</span>`
        : `<span class="text-xs font-normal text-slate-500">${escapeHtml(winLabel)}</span>`;
      const bodyUl = `<ul class="list-none space-y-0.5 border-l border-slate-700 pl-3 text-sm text-slate-400">${ranges
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join("")}</ul>`;
      const bodyWrap = isViewer
        ? `<div id="member-avail-viewer-body" class="member-avail-body mt-1">${bodyUl}</div>`
        : `<div class="member-avail-body mt-1">${bodyUl}</div>`;
      const head = `<span class="font-medium text-slate-200">${name}</span>${pastSavedWaitlist ? wlTag : ""}`;
      return `<details class="${detailsCls}" data-user-id="${mid}">
          <summary class="cursor-pointer select-none text-sm">${head}${noteSpan}${isViewer ? viewerRentalChipStrip : ""}</summary>
          ${bodyWrap}
        </details>`;
    })
    .join("");

  const lockCount = Number(run.membersWithAvailability) || 0;
  const rosterSz =
    Number(run.rosterSize) || Number(run.capacity) || Number(run.memberCount) || 0;
  const activeRosterCount =
    run.activeRosterCount != null
      ? Number(run.activeRosterCount)
      : Math.min(Number(run.memberCount) || 0, Number(run.capacity) || 0);
  const waitlistCount =
    run.waitlistCount != null
      ? Number(run.waitlistCount)
      : Math.max(0, (Number(run.memberCount) || 0) - (Number(run.capacity) || 0));

  const bookingRentals = run.bookingRentalGroups || [];

  let overlapBlock = "";
  if (run.overlapSlots && run.overlapSlots.length) {
    overlapBlock = renderOverlapBlockSummary(run.overlapSlots);
  } else if (run.isFull) {
    overlapBlock = run.schedulingWaitlistActive
      ? `<p class="mt-2 text-sm text-amber-400/90">Active roster is full; everyone on it must save availability before a shared grid appears.</p>`
      : `<p class="mt-2 text-sm text-amber-400/90">More than a full roster is still scheduling. Everyone must save overlapping hours until a shared <strong>2+ hour</strong> window exists across <em>all</em> joiners — then extras move to the waitlist.</p>`;
  }
  if (bookingRentals.length && (!run.overlapSlots || run.overlapSlots.length === 0)) {
    overlapBlock += `<p class="mt-3 rounded border border-violet-900/35 bg-violet-950/20 px-3 py-2 text-sm text-slate-200">No hour is shared by <em>every</em> person universally — if <strong>Roster windows</strong> (Skedda panel) lists times, each is bookable for your full run size.</p>`;
  }

  let courtSkeddaViewDate = run.dateStart || "";
  if (run.overlapSlots && run.overlapSlots.length) {
    const sortedOv = [...run.overlapSlots]
      .map((x) => normalizeSlotKey(String(x)))
      .filter(Boolean)
      .sort();
    if (sortedOv[0]) courtSkeddaViewDate = slotKeyDayStr(sortedOv[0]);
  } else if (bookingRentals[0]?.windows?.[0]?.slotKeys?.[0]) {
    courtSkeddaViewDate = slotKeyDayStr(bookingRentals[0].windows[0].slotKeys[0]);
  }
  const skeddaCourtVenueLis = SKEDDA_VENUES.map(
    (v) =>
      `<li><a class="text-emerald-400 hover:underline" href="${escapeHtml(
        skeddaVenueHref(v.origin, courtSkeddaViewDate)
      )}" target="_blank" rel="noopener">${escapeHtml(v.label)}</a></li>`
  ).join("");

  layout(
    escapeHtml(run.title),
    `
      <div class="mb-6 flex flex-wrap items-center gap-3 text-sm text-slate-400">
        <span>Active <strong class="text-slate-200">${activeRosterCount}/${run.capacity}</strong></span>
        ${
          waitlistCount > 0
            ? `<span class="text-amber-200/90">Waitlist <strong class="text-amber-100">${waitlistCount}</strong></span>`
            : ""
        }
        <span class="text-slate-600">· ${run.memberCount} joined total</span>
        <span>Code <strong class="font-mono text-emerald-400">${escapeHtml(run.runCode)}</strong></span>
        <button type="button" id="btn-copy-link" class="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">Copy link</button>
        ${
          run.viewerIsMember
            ? `<button type="button" id="btn-leave-run" class="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-xs text-red-200 hover:bg-red-950/70">Leave run</button>`
            : ""
        }
      </div>
      ${
        run.viewerIsMember &&
        run.viewerQueuedForRoster &&
        run.viewerCanSetAvailability &&
        !run.viewerOnWaitlist
          ? `<div class="mb-4 rounded-lg border border-amber-800/50 bg-amber-950/35 px-4 py-3 text-sm text-amber-100/95">
              <p class="font-medium text-amber-50">You saved at least one hour that already had ${escapeHtml(String(rosterCapUi))} people on it (save order).</p>
              <p class="mt-1 text-amber-100/90">Amber hours are at the run’s roster cap for that slot — pick other times too if you want more overlap options.</p>
            </div>`
          : ""
      }
      <details class="mb-3 text-xs text-slate-600">
        <summary class="cursor-pointer text-slate-500 hover:text-slate-400">Heatmap not showing? Diagnostics</summary>
        <p class="mt-2 pl-1 leading-relaxed">
          Add <code class="rounded bg-slate-800 px-1">?vbdiag=1</code> to this URL (or in the console run <code class="rounded bg-slate-800 px-1">localStorage.setItem('vbdiag','1')</code> and reload).
          Then open the <strong>Console</strong> (Safari: Develop → Show JavaScript Console) and copy every line starting with <code class="rounded bg-slate-800 px-1">[vbdiag]</code>.
          In the <strong>Network</strong> tab, click the <code class="rounded bg-slate-800 px-1">public/…</code> request and copy the <strong>Response</strong> JSON (or a screenshot of Headers + Response).
        </p>
      </details>
      <div class="mb-8 grid gap-6 lg:grid-cols-2">
        <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Members</h2>
          <p class="mb-2 text-sm text-slate-400">
            Availability locked in:
            <strong id="avail-lock-counter" class="text-emerald-400">${computeDisplayLockCount(run, selected)}</strong>
            <span class="text-slate-500"> / ${rosterSz}</span>
            <span class="text-slate-600"> (roster)</span>
          </p>
          <div class="space-y-1 text-sm">${memberRows}</div>
          ${overlapBlock}
        </div>
        <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Skedda court check</h2>
          <p class="text-sm text-slate-400">Pick a contiguous 2–4 hour block. <strong class="font-medium text-slate-300">Universal overlap</strong> is hours where literally every roster member agrees; <strong class="font-medium text-violet-300/95">Roster windows</strong> lists alternate times that still work for the full run size (every spot on the booking roster covers the block).</p>
          <div class="mt-3 space-y-5">
            <div>
              <p class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Universal overlap</p>
              ${
                run.overlapSlots && run.overlapSlots.length
                  ? renderOverlapWindowsForCourtTile(run.overlapSlots)
                  : `<div class="rounded border border-slate-800/70 bg-slate-950/20 px-3 py-2 text-sm text-slate-500">None yet — widen availability or converge on fewer times.</div>`
              }
            </div>
            ${
              bookingRentals.length > 0
                ? `<div>${renderBookingRentalGroupsForCourtTile(bookingRentals)}</div>`
                : ""
            }
          </div>
          <div class="mt-4 text-xs text-slate-500">Venue pages:</div>
          <ul class="mt-2 list-inside list-disc text-sm text-slate-400">${skeddaCourtVenueLis}</ul>
          <div id="court-results" class="mt-3 text-sm text-slate-300"></div>
        </div>
      </div>
      <div class="mb-3 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
        <p class="font-medium text-slate-300">Availability map</p>
        <ul class="mt-2 list-inside list-disc space-y-1">
          <li><span class="text-sky-400">Blue shades</span> — players who saved this hour (darker = more).</li>
          <li><span class="text-amber-300">Amber / yellow</span> — this hour already has the run’s roster size (${escapeHtml(String(rosterCapUi))}) of people; full for that slot. You can still choose other hours if you’re waitlisted.</li>
          ${
            viewerCanPick
              ? `<li><span class="text-emerald-400">Green</span> — your pick (click to toggle, then Save).</li>`
              : run.viewerOnWaitlist
                ? `<li><span class="text-amber-400">Waitlist</span> — a shared 2+ hour window is set for the roster; you’ll pick times after you move up.</li>`
                : `<li><span class="text-slate-500">Read-only</span> — sign in and join this run to add your hours.</li>`
          }
        </ul>
      </div>
      ${
        viewerCanPick
          ? `<p class="mb-2 text-sm text-slate-400">${
              run.viewerQueuedForRoster && !run.viewerOnWaitlist
                ? `Amber cells are at the roster cap (${rosterCapUi} people) for that hour — pick other times too if you want. `
                : ""
            }Teammate picks load as soon as you open this page. Toggle your hours, then save.</p>`
          : run.viewerOnWaitlist
            ? `<p class="mb-2 rounded-lg border border-amber-900/50 bg-amber-950/25 px-4 py-3 text-sm text-amber-100/90">You’re on the <strong>waitlist</strong> (a shared 2+ hour window is locked in for the first ${escapeHtml(
                String(run.capacity)
              )}). When you move up to the active roster, you can use the calendar below.</p>`
            : `<p class="mb-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-200/90">You can see everyone below. To add yours: sign in and <a class="underline" href="/?join=${encodeURIComponent(run.runCode)}">join with code ${escapeHtml(run.runCode)}</a>.</p>`
      }
      ${
        viewerCanPick
          ? `<button type="button" id="btn-save-av" class="mb-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Save availability</button>`
          : ""
      }
      <div id="calendar-wrap" class="w-full overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/30 p-2"></div>
`,
    { variant: "run" }
  );

  const updateAvailLockCounterUi = () => {
    const el = document.getElementById("avail-lock-counter");
    if (el) el.textContent = String(computeDisplayLockCount(run, selected));
  };

  const updateViewerAvailabilityUi = () => {
    if (!viewerCanPick) return;
    const note = document.getElementById("member-avail-viewer-note");
    const body = document.getElementById("member-avail-viewer-body");
    if (!note || !body) return;
    const ranges = formatMemberAvailabilityRanges([...selected].sort((a, b) => a.localeCompare(b)));
    if (!ranges.length) {
      note.textContent = " — no times selected in the grid yet";
      body.innerHTML = `<p class="text-xs text-slate-600">Pick cells on the calendar, then Save.</p>`;
    } else {
      note.textContent = ` — ${ranges.length} free window${ranges.length === 1 ? "" : "s"}`;
      body.innerHTML = `<ul class="list-none space-y-0.5 border-l border-slate-700 pl-3 text-sm text-slate-400">${ranges
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join("")}</ul>`;
    }
  };

  document.getElementById("btn-copy-link")?.addEventListener("click", () => {
    const url = `${window.location.origin}/?run=${encodeURIComponent(token)}`;
    navigator.clipboard.writeText(url).then(() => showToast("Link copied"));
  });

  document.getElementById("btn-leave-run")?.addEventListener("click", async () => {
    if (
      !window.confirm(
        "Leave this run? Your saved availability for it will be removed. If you are the last member, the whole run is deleted."
      )
    ) {
      return;
    }
    try {
      const data = await api(`/api/runs/public/${encodeURIComponent(token)}/leave`, {
        method: "POST",
      });
      showToast(
        data.runDeleted
          ? "You left. The run was removed (no members left)."
          : "You left this run."
      );
      viewerSlotDraftByRunToken.delete(token);
      setQuery({});
      await goHome();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.querySelectorAll(".btn-check-block").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const out = document.getElementById("court-results");
      const slotStart = btn.getAttribute("data-slot-start") || "";
      const slotEnd = btn.getAttribute("data-slot-end") || "";
      if (!slotStart || !slotEnd) return;
      const hs = parseSlotKeyToDate(slotStart);
      const he = parseSlotKeyToDate(slotEnd);
      const durH =
        hs && he ? Math.max(1, Math.round((he.getTime() - hs.getTime()) / 3600000)) : 1;
      const human =
        hs && he
          ? `${hs.toLocaleString(undefined, { month: "long" })} ${ordinalDay(
              hs.getDate()
            )}, ${formatTimeHmLower(hs)}–${formatTimeHmLower(he)} (${durH}h)`
          : `${formatSlotKeyForDisplay(slotStart)} (${durH}h)`;
      if (out) out.innerHTML = `<div class="text-slate-400">Checking <span class="text-slate-200">${escapeHtml(
        human
      )}</span>… (may take ~30s)</div>`;
      try {
        const data = await api(`/api/runs/public/${encodeURIComponent(token)}/check-courts`, {
          method: "POST",
          body: JSON.stringify({ slotStart, slotEnd }),
        });
        const dayStr = slotKeyDayStr(slotStart);
        const lines = (data.venues || []).map((v) => {
          if (!v.ok) return `<div class="mb-1">${escapeHtml(v.name)}: error (${escapeHtml(v.error || "?")})</div>`;
          if (v.hasAvailableCourt == null && v.note) {
            return `<div class="mb-1">${escapeHtml(v.name)}: ${escapeHtml(v.note)}</div>`;
          }
          const venuePrice = venueTotalPriceCents(v.venueId, slotStart, slotEnd);
          const splitN = activeRosterCount || Number(run.memberCount) || 0;
          const priceSuffix =
            venuePrice != null && splitN > 0
              ? ` <span class="text-slate-500">— total ${escapeHtml(
                  formatUsdFromCents(venuePrice)
                )}, split ${escapeHtml(
                  formatUsdFromCents(Math.round(venuePrice / splitN))
                )} each (${splitN} ppl)</span>`
              : "";
          if (v.hasAvailableCourt) {
            let href = v.bookingUrl || "";
            try {
              const origin = href ? new URL(href).origin : "";
              href = origin ? skeddaVenueHref(origin, dayStr) : href;
            } catch {
              /* ignore */
            }
            return `<div class="mb-1"><a class="text-emerald-400 hover:underline" href="${escapeHtml(
              href
            )}" target="_blank" rel="noopener">${escapeHtml(
              v.name
            )}</a>: looks free for the full window (${v.freeSpaceIds?.length ?? 0}/${v.totalSpaces ?? 0} spaces free)${priceSuffix}</div>`;
          }
          return `<div class="mb-1">${escapeHtml(
            v.name
          )}: not free for the full window (${v.freeSpaceIds?.length ?? 0}/${v.totalSpaces ?? 0} spaces free)${priceSuffix}</div>`;
        });
        if (out) out.innerHTML = lines.join("") || `<div class="text-slate-500">No results.</div>`;
      } catch (err) {
        if (out) out.textContent = err.message;
        showToast(err.message, true);
      }
    });
  });

  const wrap = document.getElementById("calendar-wrap");
  if (wrap) {
    const viewerId = run.viewerId != null ? run.viewerId : state.user?.id;
    const readOnly = !viewerCanPick;
    const tag = readOnly ? "div" : "button";
    const extra = readOnly ? ' role="presentation"' : ' type="button"';
    const navRow =
      weekStarts.length > 1
        ? `<div class="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <button type="button" id="btn-cal-prev" class="rounded border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35" ${
              canPrevWeek ? "" : "disabled"
            }>← Previous week</button>
            <span class="text-center text-xs text-slate-500">${escapeHtml(weekRangeLabel)}</span>
            <button type="button" id="btn-cal-next" class="rounded border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35" ${
              canNextWeek ? "" : "disabled"
            }>Next week →</button>
          </div>`
        : weekRangeLabel
          ? `<p class="mb-2 px-1 text-center text-xs text-slate-500">${escapeHtml(weekRangeLabel)}</p>`
          : "";
    const thead = `<tr><th class="sticky left-0 z-10 w-[3.5rem] bg-slate-900 p-2 text-left text-xs text-slate-500">Hour</th>${weekDays
      .map((d) => {
        const inR = dayInRunRange(d, run.dateStart, run.dateEnd);
        const thCls = inR
          ? "min-w-0 border-l border-slate-800 p-2 text-center text-xs font-medium text-slate-400"
          : "min-w-0 border-l border-slate-800/80 bg-slate-950/50 p-2 text-center text-xs font-medium text-slate-600";
        return `<th class="${thCls}">${escapeHtml(calendarDayHeader(d))}</th>`;
      })
      .join("")}</tr>`;
    const rows = hours
      .map((h) => {
        const cells = weekDays
          .map((d) => {
            const iso = slotKeyFromDayStrAndHour(d, h);
            const inR = dayInRunRange(d, run.dateStart, run.dateEnd);
            return `<td class="border-l border-t border-slate-800 p-0.5 text-center">
                <${tag}${extra} class="slot-cell" data-slot="${escapeHtml(iso)}" data-day="${escapeHtml(
              d
            )}" data-hour="${h}"></${tag}>`;
          })
          .join("");
        return `<tr><td class="sticky left-0 z-10 w-[3.5rem] bg-slate-900 px-2 py-1 text-xs text-slate-500">${h}:00</td>${cells}</tr>`;
      })
      .join("");
    wrap.innerHTML = `${navRow}<table class="w-full table-fixed border-collapse text-sm"><thead>${thead}</thead><tbody>${rows}</tbody></table>`;
    document.getElementById("btn-cal-prev")?.addEventListener("click", () => {
      if (!canPrevWeek) return;
      try {
        sessionStorage.setItem(weekStorageKey, String(weekIdx - 1));
      } catch {
        /* ignore */
      }
      void renderRunPage();
    });
    document.getElementById("btn-cal-next")?.addEventListener("click", () => {
      if (!canNextWeek) return;
      try {
        sessionStorage.setItem(weekStorageKey, String(weekIdx + 1));
      } catch {
        /* ignore */
      }
      void renderRunPage();
    });
    const refreshGridFromSelection = () => {
      wrap.querySelectorAll(".slot-cell").forEach((el2) => {
        const iso2 = el2.getAttribute("data-slot");
        const d2 = el2.getAttribute("data-day") || "";
        if (!iso2) return;
        const inR2 = dayInRunRange(d2, run.dateStart, run.dateEnd);
        syncSlotCell(
          el2,
          iso2,
          selected,
          run.memberAvailability || [],
          viewerId,
          el2.getAttribute("data-hour") || "",
          inR2,
          viewerCanPick,
          rosterCapUi
        );
      });
    };

    wrap.querySelectorAll(".slot-cell").forEach((el) => {
      const iso = el.getAttribute("data-slot");
      const dayStr = el.getAttribute("data-day") || "";
      if (!iso) return;
      const inRunRange = dayInRunRange(dayStr, run.dateStart, run.dateEnd);
      if (!readOnly && inRunRange) {
        el.addEventListener("click", () => {
          const k = normalizeSlotKey(iso);
          if (selected.has(k)) {
            selected.delete(k);
          } else {
            selected.add(k);
          }
          refreshGridFromSelection();
          updateAvailLockCounterUi();
          updateViewerAvailabilityUi();
        });
      }
    });
    refreshGridFromSelection();
  }

  document.getElementById("btn-save-av")?.addEventListener("click", async () => {
    const beforeLock = lockCount;
    try {
      const data = await api(`/api/runs/public/${encodeURIComponent(token)}/availability`, {
        method: "PUT",
        body: JSON.stringify({ slots: [...selected].sort() }),
      });
      const after =
        typeof data.membersWithAvailability === "number"
          ? data.membersWithAvailability
          : beforeLock;
      showToast(
        after > beforeLock
          ? `Availability saved. ${after} of ${data.rosterSize ?? rosterSz} roster members have locked in.`
          : "Availability saved."
      );
      viewerSlotDraftByRunToken.delete(token);
      await renderRunPage();
      const el = document.getElementById("avail-lock-counter");
      if (el && after > beforeLock) {
        el.classList.add("transition", "text-emerald-300");
        requestAnimationFrame(() => {
          el.classList.add("scale-110", "inline-block");
          setTimeout(() => {
            el.classList.remove("scale-110", "inline-block", "text-emerald-300");
          }, 450);
        });
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });
}
