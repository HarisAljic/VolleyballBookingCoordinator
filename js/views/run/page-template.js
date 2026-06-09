import { escapeHtml } from "../../lib/html.js";
import { computeDisplayLockCount } from "../../lib/dates.js";
import { formatIncludedWeekdaysShort } from "../../../run-weekdays.js";
import { renderBookingRentalsByDate } from "../../lib/overlap-ui.js";
import { SKEDDA_VENUES, skeddaVenueHref } from "../../lib/skedda.js";
import { renderViewerGuestButtons } from "./members-panel.js";

export function renderRunPageHtml(ctx) {
  const {
    run,
    selected,
    rosterTargetsPanel,
    memberRows,
    bookingRentalsByDate,
    visibleRosterSizes,
    hasBookingRentals,
    rosterCapUi,
    rosterSz,
    hourWaitlistCount,
    weekendView,
    skeddaCourtVenueLis,
    viewerCanPick,
  } = ctx;

  return `
      <div class="mb-6 flex flex-wrap items-center gap-3 text-sm text-slate-400">
        <span><strong class="text-slate-200">${run.memberCount}</strong> joined</span>
        ${
          hourWaitlistCount > 0
            ? `<span class="text-amber-200/90">Waitlist <strong class="text-amber-100">${hourWaitlistCount}</strong></span>`
            : ""
        }
        <span>Code <strong class="font-mono text-emerald-400">${escapeHtml(run.runCode)}</strong></span>
        <span class="text-slate-600">· ${escapeHtml(formatIncludedWeekdaysShort(run.includedWeekdays))}</span>
        <button type="button" id="btn-copy-link" class="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">Copy link</button>
        ${
          run.viewerIsMember
            ? `<button type="button" id="btn-leave-run" class="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-xs text-red-200 hover:bg-red-950/70">Leave run</button>`
            : ""
        }
      </div>
      ${rosterTargetsPanel}
      ${
        run.viewerIsMember &&
        (run.viewerWaitlistedSizes?.length || run.viewerQueuedForRoster) &&
        run.viewerCanSetAvailability
          ? `<div class="mb-4 rounded-lg border border-amber-800/50 bg-amber-950/35 px-4 py-3 text-sm text-amber-100/95">
              <p class="font-medium text-amber-50">Some of your saved windows match a full ${escapeHtml((run.viewerWaitlistedSizes || []).map((s) => s + "-man").join(" / ") || String(rosterCapUi) + "-man")} run (save order).</p>
              <p class="mt-1 text-amber-100/90">Yellow = waitlist for that size; green = you fit a bookable window. Amber cells = ${rosterCapUi}+ savers on that hour.</p>
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
        <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
          <div class="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Members</h2>
              ${renderViewerGuestButtons(run)}
            </div>
            <span class="text-xs text-slate-500">${run.memberCount} total</span>
          </div>
          <div class="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm text-slate-400">
            <span>
              Locked:
              <strong id="avail-lock-counter" class="text-emerald-400">${computeDisplayLockCount(run, selected)}</strong>
              <span class="text-slate-500"> / ${rosterSz}</span>
            </span>
          </div>
          <div class="text-sm">${memberRows}</div>
        </div>
        <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Skedda court check</h2>
          <p class="text-sm text-slate-400">Pick a bookable block (12→2h, 18→3h, 24→4h). <strong class="font-medium text-violet-300/95">Roster rentals</strong> lists bookable times with roster and waitlist — use <strong class="font-medium text-slate-300">Check venues</strong> on each block.</p>
          <div class="mt-3">
            ${
              hasBookingRentals
                ? renderBookingRentalsByDate(bookingRentalsByDate, visibleRosterSizes, {
                    openByDefault: !run.runFound,
                  })
                : `<div class="rounded border border-slate-800/70 bg-slate-950/20 px-3 py-2 text-sm text-slate-500">No bookable roster windows yet — save availability until enough players match a block.</div>`
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
          <li><span class="text-sky-300">Blue</span> — how many people picked that hour (darker = more).</li>
          <li><span class="text-amber-200">Yellow</span> — waitlist/overflow hours once too many people pick the same slot.</li>
          <li><span class="text-violet-300">Purple</span> — exactly full roster (24) on that hour.</li>
          ${
            viewerCanPick
              ? `<li><span class="text-emerald-400">Green cells</span> — your pick (click to toggle, then Save).</li>`
              : `<li><span class="text-slate-500">Read-only</span> — sign in and join this run to add your hours.</li>`
          }
        </ul>
      </div>
      ${
        viewerCanPick
          ? `<p class="mb-2 text-sm text-slate-400">Teammate picks load as soon as you open this page. Toggle your hours, then save. You can have both yellow (waitlist) and green (available) tags for different roster sizes.</p>`
          : `<p class="mb-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-200/90">You can see everyone below. To add yours: sign in and <a class="underline" href="/?join=${encodeURIComponent(run.runCode)}">join with code ${escapeHtml(run.runCode)}</a>.</p>`
      }
      ${
        viewerCanPick
          ? `<button type="button" id="btn-save-av" class="mb-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Save availability</button>`
          : ""
      }
      <div id="calendar-wrap" class="w-full overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/30 p-2"></div>
`;
}

export function buildSkeddaVenueListHtml(courtSkeddaViewDate) {
  return SKEDDA_VENUES.map(
    (v) =>
      `<li><a class="text-emerald-400 hover:underline" href="${escapeHtml(
        skeddaVenueHref(v.origin, courtSkeddaViewDate)
      )}" target="_blank" rel="noopener">${escapeHtml(v.label)}</a></li>`
  ).join("");
}
