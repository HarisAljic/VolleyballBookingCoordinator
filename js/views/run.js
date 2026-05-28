import { isVbDiag } from "../lib/diag.js";
import { api } from "../api.js";
import { escapeHtml } from "../lib/html.js";
import { layout } from "../layout.js";
import { refreshUser } from "../auth-nav.js";
import { state } from "../state.js";
import { slotKeyDayStr } from "../lib/dates.js";
import { otherTeammateCountAtSlot } from "../lib/calendar-cell.js";
import { slotKeyFromDayStrAndHour } from "../lib/slot-keys.js";
import {
  filterBookingRentalsByDate,
  hasBookingRentals,
} from "./run/booking-data.js";
import { mountRunCalendar } from "./run/calendar-controller.js";
import { bindRunPageEvents } from "./run/event-bindings.js";
import { renderMemberRows } from "./run/members-panel.js";
import {
  buildSkeddaVenueListHtml,
  renderRunPageHtml,
} from "./run/page-template.js";
import {
  loadVisibleRosterSizes,
  renderRosterTargetsPanel,
} from "./run/roster-view.js";
import { buildRunScheduleState } from "./run/schedule-state.js";
import {
  clearRunViewerSlotDrafts,
  getViewerSlotSelection,
} from "./run/viewer-slots.js";

export { clearRunViewerSlotDrafts };

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
    layout(
      "Run not found",
      `<p class="text-center text-slate-400">This link may be invalid or expired.</p>`,
      { variant: "form" }
    );
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

  const schedule = buildRunScheduleState(run, token);
  logDiagGridProbe(run, schedule);

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

  const visibleRosterSizes = loadVisibleRosterSizes(token);
  const rosterCapUi = visibleRosterSizes.length ? Math.max(...visibleRosterSizes) : 12;
  const bookingRentalsByDate = filterBookingRentalsByDate(run, visibleRosterSizes);
  const hasRentals = hasBookingRentals(bookingRentalsByDate);

  const rosterSz =
    Number(run.rosterSize) || Number(run.capacity) || Number(run.memberCount) || 0;
  const activeRosterCount =
    run.activeRosterCount != null
      ? Number(run.activeRosterCount)
      : Math.min(Number(run.memberCount) || 0, Number(run.capacity) || 0);
  const hourWaitlistCount =
    run.hourWaitlistCount != null ? Number(run.hourWaitlistCount) : 0;
  const lockCount = Number(run.membersWithAvailability) || 0;

  let courtSkeddaViewDate = run.dateStart || "";
  if (bookingRentalsByDate[0]?.options?.[0]?.slotKeys?.[0]) {
    courtSkeddaViewDate = slotKeyDayStr(bookingRentalsByDate[0].options[0].slotKeys[0]);
  }

  layout(escapeHtml(run.title), renderRunPageHtml({
    run,
    selected,
    rosterTargetsPanel: renderRosterTargetsPanel(run, visibleRosterSizes),
    memberRows: renderMemberRows(run, { selected, slotsByUserId, visibleRosterSizes, bookingRentalsByDate }),
    bookingRentalsByDate,
    visibleRosterSizes,
    hasBookingRentals: hasRentals,
    rosterCapUi,
    rosterSz,
    hourWaitlistCount,
    weekendView: schedule.weekendView,
    skeddaCourtVenueLis: buildSkeddaVenueListHtml(courtSkeddaViewDate),
    viewerCanPick,
  }), { variant: "run" });

  const uiCallbacks = bindRunPageEvents(
    { token, run, selected, viewerCanPick, lockCount, rosterSz, activeRosterCount },
    { renderRunPage, goHome }
  );

  mountRunCalendar(
    { run, schedule, selected, viewerCanPick, rosterCapUi },
    {
      onSelectionChange: ({ reloadPage }) => {
        if (reloadPage) void renderRunPage();
        else {
          uiCallbacks.updateAvailLockCounterUi();
          uiCallbacks.updateViewerAvailabilityUi();
        }
      },
    }
  );
}

function logDiagGridProbe(run, schedule) {
  if (!isVbDiag() || !schedule.allRunDays.length) return;
  let maxOc = 0;
  for (const d of schedule.allRunDays) {
    for (const h of [6, 12, 18, 21]) {
      const oc = otherTeammateCountAtSlot(
        slotKeyFromDayStrAndHour(d, h),
        run.memberAvailability || [],
        run.viewerId
      );
      if (oc > maxOc) maxOc = oc;
    }
  }
  const may9 =
    schedule.allRunDays.find((x) => /-05-09$/.test(x)) ||
    schedule.allRunDays[Math.floor(schedule.allRunDays.length / 2)];
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
