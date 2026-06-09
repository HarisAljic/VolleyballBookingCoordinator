import {
  computeBookingWindowCandidates,
  bookingRosterSlotSets,
  buildBookingRentalsByDate,
} from "../booking-candidates.js";
import {
  activeRosterUserIdsFromOrdered,
  ROSTER_SIZES,
} from "../../roster-tiers.js";
import { db } from "../db-singleton.js";
import { loadSlotSavedAtByUser, runIncludedWeekdays } from "./availability.js";
import {
  bookingGuestSlotSets,
  buildGuestUserInfoMap,
  listGuestsForRun,
  loadSlotSavedAtByGuest,
} from "./guests.js";
import { orderedMemberUserIds } from "./repository.js";

export function buildBookingRentalGroupsBySize(runId, orderedIds, run, wlLocked, members) {
  const includedWeekdays = runIncludedWeekdays(run);
  const allIds = orderedMemberUserIds(runId);
  const guestRows = listGuestsForRun(runId);
  const guestIds = guestRows.map((g) => -Math.abs(Number(g.id)));
  const slotsByUser = bookingRosterSlotSets(db, runId, allIds);
  for (const [pid, set] of bookingGuestSlotSets(db, runId, guestIds)) {
    slotsByUser.set(pid, set);
  }
  const slotSavedAtByUser = loadSlotSavedAtByUser(runId, allIds);
  for (const [pid, map] of loadSlotSavedAtByGuest(runId, guestIds)) {
    slotSavedAtByUser.set(pid, map);
  }
  const userInfoById = new Map(
    (members || []).map((m) => [
      Number(m.id),
      { firstName: m.first_name, lastName: m.last_name },
    ])
  );
  for (const [pid, info] of buildGuestUserInfoMap(guestRows, includedWeekdays)) {
    userInfoById.set(pid, info);
  }
  const enrichCtx = { slotsByUser, userInfoById, slotSavedAtByUser };
  const bySize = {};
  for (const size of ROSTER_SIZES) {
    if (orderedIds.length < size) {
      bySize[size] = [];
      continue;
    }
    const coalitionIds = wlLocked
      ? activeRosterUserIdsFromOrdered(orderedIds, size)
      : orderedIds;
    const bookingParticipantIds = [...coalitionIds, ...guestIds];
    if (bookingParticipantIds.length < size) {
      bySize[size] = [];
      continue;
    }
    const batch = computeBookingWindowCandidates(db, runId, {
      rosterUserIdsBooking: bookingParticipantIds,
      rosterCapacity: size,
      dateStartStr: run.date_start,
      dateEndStr: run.date_end,
      includedWeekdays,
    });
    bySize[size] = buildBookingRentalsByDate(batch, enrichCtx);
  }
  return bySize;
}
