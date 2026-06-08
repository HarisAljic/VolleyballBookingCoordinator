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
import { orderedMemberUserIds } from "./repository.js";

export function buildBookingRentalGroupsBySize(runId, orderedIds, run, wlLocked, members) {
  const includedWeekdays = runIncludedWeekdays(run);
  const allIds = orderedMemberUserIds(runId);
  const slotsByUser = bookingRosterSlotSets(db, runId, allIds);
  const slotSavedAtByUser = loadSlotSavedAtByUser(runId, allIds);
  const userInfoById = new Map(
    (members || []).map((m) => [
      Number(m.id),
      { firstName: m.first_name, lastName: m.last_name },
    ])
  );
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
    if (coalitionIds.length < size) {
      bySize[size] = [];
      continue;
    }
    const batch = computeBookingWindowCandidates(db, runId, {
      rosterUserIdsBooking: coalitionIds,
      rosterCapacity: size,
      dateStartStr: run.date_start,
      dateEndStr: run.date_end,
      includedWeekdays,
    });
    bySize[size] = buildBookingRentalsByDate(batch, enrichCtx);
  }
  return bySize;
}
