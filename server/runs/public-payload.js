import { normalizeSlotKey, slotKeyFromParts } from "../../slotKeys.js";
import { filterSlotKeysByIncludedWeekdays } from "../../run-weekdays.js";
import {
  activeCountForSize,
  maxEnabledRosterTarget,
  rosterWindowCountsBySize,
  ROSTER_SIZES,
} from "../../roster-tiers.js";
import {
  coalitionWaitlistedUserIdsFromRentals,
  memberCoalitionRentalStatus,
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
  runIncludedWeekdays,
  schedulingWaitlistLocked,
} from "./availability.js";
import {
  countGuestsWithAvailability,
  formatGuestRow,
  listGuestsForRun,
  listGuestsBySponsor,
} from "./guests.js";
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

  const guestRows = listGuestsForRun(run.id);
  const guests = guestRows.map((row) => formatGuestRow(row, includedWeekdays));
  const guestHeatmap = guests.map((g) => ({
    userId: g.participantId,
    guestId: g.id,
    isGuest: true,
    firstName: g.firstName,
    lastName: g.lastName,
    displayName: g.displayName,
    sponsorUserId: g.sponsorUserId,
    slots: g.slots,
  }));

  const memberAvailability = [
    ...loadMemberAvailabilityHeatmap(run.id, orderedIds, includedWeekdays),
    ...guestHeatmap,
  ];
  const minTarget = Math.min(...rosterTargets);
  const membersWithAnySave = memberAvailability.filter((m) => (m.slots || []).length > 0).length;
  const runFound = membersWithAnySave >= minTarget;

  const countIdsForLock = wlLocked ? activeRosterUserIds(run.id, cap) : orderedIds;
  const membersWithAvailability =
    countMembersWithAvailability(run.id, countIdsForLock) +
    countGuestsWithAvailability(run.id, guestRows);
  const activeRosterCount = activeCountForSize(orderedIds, cap);

  const bookingRentalGroups = ROSTER_SIZES.flatMap((size) =>
    rentalOptionsFromDateGroups(bookingRentalGroupsBySize[size] || [])
  );

  const memberRentalTags = new Map();
  for (const uid of orderedIds) {
    const tags = memberCoalitionRentalStatus(uid, bookingRentalGroupsBySize);
    const merged = {
      ...tags,
      waitlistedSizes: [...(tags.waitlistedSizes || [])].sort((a, b) => a - b),
      hourWaitlisted: (tags.waitlistedSizes || []).length > 0,
    };
    memberRentalTags.set(uid, merged);
  }
  const guestRentalTags = new Map();
  for (const g of guests) {
    const tags = memberCoalitionRentalStatus(g.participantId, bookingRentalGroupsBySize);
    guestRentalTags.set(g.id, {
      ...tags,
      waitlistedSizes: [...(tags.waitlistedSizes || [])].sort((a, b) => a - b),
      hourWaitlisted: (tags.waitlistedSizes || []).length > 0,
    });
  }
  const hourWaitlistCount = coalitionWaitlistedUserIdsFromRentals(
    bookingRentalsByDate,
    { futureOnly: true }
  ).size;

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
    guests: guests.map((g) => {
      const tags = guestRentalTags.get(g.id) || {
        waitlistedSizes: [],
        fitsSizes: [],
        hourWaitlisted: false,
        fitsRental: false,
      };
      return {
        ...g,
        waitlistedSizes: tags.waitlistedSizes,
        fitsSizes: tags.fitsSizes,
        waitlisted: tags.hourWaitlisted,
        hourWaitlisted: tags.hourWaitlisted,
        fitsRental: tags.fitsRental,
      };
    }),
    viewerGuests:
      mine && user ? listGuestsBySponsor(run.id, user.id).map((row) => formatGuestRow(row, includedWeekdays)) : [],
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
