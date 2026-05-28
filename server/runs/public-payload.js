import { normalizeSlotKey, slotKeyFromParts } from "../../slotKeys.js";
import { filterSlotKeysByIncludedWeekdays } from "../../run-weekdays.js";
import {
  activeCountForSize,
  maxEnabledRosterTarget,
  rosterWindowCountsBySize,
  ROSTER_SIZES,
} from "../../roster-tiers.js";
import {
  memberRentalStatusForSizes,
  mergeBookingRentalsByDate,
  rentalOptionsFromDateGroups,
  viewerMatchedRentalOptionNumbers as computeViewerMatchedRentalNumbers,
} from "../booking-candidates.js";
import { db } from "../db-singleton.js";
import { buildBookingRentalGroupsBySize } from "./booking.js";
import {
  activeRosterUserIds,
  canSetAvailability,
  countMembersWithAvailability,
  loadMemberAvailabilityHeatmap,
  memberSlotsFromRow,
  runIncludedWeekdays,
  schedulingWaitlistLocked,
  slotCountsBeforeUserInSaveOrder,
} from "./availability.js";
import {
  listMembers,
  memberCount,
  orderedMemberUserIds,
  runRosterTargets,
} from "./repository.js";

export function buildPublicRunPayload(run, user, { diag = false } = {}) {
  const count = memberCount(run.id);
  const rosterTargets = runRosterTargets(run);
  const cap = maxEnabledRosterTarget(rosterTargets);
  const includedWeekdays = runIncludedWeekdays(run);
  const members = listMembers(run.id);
  const orderedIds = orderedMemberUserIds(run.id);
  const mine = user ? orderedIds.includes(Number(user.id)) : false;
  const wlLocked = schedulingWaitlistLocked(run.id);
  const viewerCanSetAvailability =
    mine && canSetAvailability(run.id, user.id);

  const bookingRentalGroupsBySize = buildBookingRentalGroupsBySize(
    run.id,
    orderedIds,
    run,
    wlLocked,
    members
  );
  const bookingRentalsByDate = mergeBookingRentalsByDate(bookingRentalGroupsBySize);
  const rosterCounts = rosterWindowCountsBySize(bookingRentalGroupsBySize);

  let mySlots = [];
  if (user && mine) {
    const a = db
      .prepare(
        "SELECT slots_json FROM availability WHERE run_id = ? AND user_id = ?"
      )
      .get(run.id, user.id);
    if (a) {
      try {
        const raw = JSON.parse(a.slots_json);
        mySlots = filterSlotKeysByIncludedWeekdays(
          Array.isArray(raw)
            ? raw.map((s) => normalizeSlotKey(String(s))).filter(Boolean)
            : [],
          includedWeekdays
        );
      } catch {
        mySlots = [];
      }
    }
  }

  const full = activeCountForSize(orderedIds, cap) >= cap;

  const memberAvailability = loadMemberAvailabilityHeatmap(
    run.id,
    orderedIds,
    includedWeekdays
  );
  const minTarget = Math.min(...rosterTargets);
  const membersWithAnySave = memberAvailability.filter((m) => (m.slots || []).length > 0).length;
  const runFound = membersWithAnySave >= minTarget;

  const countIdsForLock = wlLocked ? activeRosterUserIds(run.id, cap) : orderedIds;
  const membersWithAvailability = countMembersWithAvailability(
    run.id,
    countIdsForLock
  );
  const activeRosterCount = activeCountForSize(orderedIds, cap);

  const bookingRentalGroups = ROSTER_SIZES.flatMap((size) =>
    rentalOptionsFromDateGroups(bookingRentalGroupsBySize[size] || [])
  );

  const memberRentalTags = new Map();
  let hourWaitlistCount = 0;
  for (const uid of orderedIds) {
    const slots = memberSlotsFromRow(run.id, uid, includedWeekdays);
    const countsBefore = slotCountsBeforeUserInSaveOrder(run.id, uid);
    const tags = memberRentalStatusForSizes(
      slots,
      bookingRentalGroupsBySize,
      countsBefore
    );
    // Join-order waitlist: if you're beyond the first N joiners for a size, you are waitlisted
    // for that size even if your saved windows match.
    const hasSavedAnyAvailability = Array.isArray(slots) && slots.length > 0;
    const joinIdx = orderedIds.indexOf(Number(uid));
    const joinWaitlistedSizes = [];
    if (hasSavedAnyAvailability) {
      for (const size of ROSTER_SIZES) {
        if (joinIdx >= 0 && joinIdx >= Number(size)) joinWaitlistedSizes.push(Number(size));
      }
    }
    const mergedWaitlisted = [
      ...new Set([...(tags.waitlistedSizes || []), ...joinWaitlistedSizes]),
    ].sort((a, b) => a - b);
    const merged = {
      ...tags,
      waitlistedSizes: mergedWaitlisted,
      hourWaitlisted: mergedWaitlisted.length > 0,
    };
    memberRentalTags.set(uid, merged);
    if (merged.hourWaitlisted) hourWaitlistCount++;
  }

  const viewerTags =
    mine && user ? memberRentalTags.get(Number(user.id)) : null;
  const viewerMatchedRentalOptionNums =
    mine && mySlots.length > 0
      ? computeViewerMatchedRentalNumbers(mySlots, bookingRentalGroups)
      : [];

  const payload = {
    id: run.id,
    title: run.title,
    capacity: cap,
    rosterTargets,
    rosterCounts,
    bookingRentalGroupsBySize,
    bookingRentalsByDate,
    bookingRentalGroups,
    dateStart: run.date_start,
    dateEnd: run.date_end,
    includedWeekdays,
    runCode: run.run_code,
    memberCount: count,
    activeRosterCount,
    hourWaitlistCount,
    waitlistCount: hourWaitlistCount,
    schedulingWaitlistActive: wlLocked,
    isFull: full,
    members: members.map((m) => {
      const uid = Number(m.id);
      const tags = memberRentalTags.get(uid) || {
        waitlistedSizes: [],
        fitsSizes: [],
        hourWaitlisted: false,
        fitsRental: false,
      };
      return {
        id: uid,
        firstName: m.first_name,
        lastName: m.last_name,
        waitlistedSizes: tags.waitlistedSizes,
        fitsSizes: tags.fitsSizes,
        waitlisted: tags.hourWaitlisted,
        hourWaitlisted: tags.hourWaitlisted,
        fitsRental: tags.fitsRental,
      };
    }),
    viewerIsMember: mine,
    viewerIsActiveRoster: mine,
    viewerQueuedForRoster: Boolean(viewerTags?.hourWaitlisted),
    viewerWaitlistedSizes: viewerTags?.waitlistedSizes ?? [],
    viewerFitsSizes: viewerTags?.fitsSizes ?? [],
    viewerCanSetAvailability,
    viewerOnWaitlist: Boolean(viewerTags?.hourWaitlisted),
    viewerId: user ? Number(user.id) : null,
    viewerSlots: mySlots,
    viewerMatchedRentalOptionNumbers: viewerMatchedRentalOptionNums,
    viewerWaitlistedRentalOptionNumbers: viewerTags?.waitlistedSizes ?? [],
    viewerFitsRentalOptionNumbers: viewerTags?.fitsSizes ?? [],
    memberAvailability,
    membersWithAvailability,
    runFound,
    rosterSize: wlLocked ? cap : count,
  };

  if (diag) {
    payload.diag = {
      memberAvailabilityRows: memberAvailability.length,
      slotCounts: memberAvailability.map((m) => ({
        userId: m.userId,
        n: m.slots.length,
        sample: m.slots.slice(0, 4),
      })),
      serverReferenceKeyMay9_18: slotKeyFromParts(2026, 5, 9, 18),
      mine,
      viewerId: payload.viewerId,
    };
  }

  return payload;
}
