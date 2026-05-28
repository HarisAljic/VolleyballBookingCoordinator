import {
  activeCountForSize,
  activeRosterUserIdsFromOrdered,
  parseRosterTargets,
} from "../../roster-tiers.js";
import { db } from "../db-singleton.js";
import {
  intersectionSlotsForUserIds,
  memberHasNonEmptyAvailability,
  runIncludedWeekdays,
} from "./availability.js";
import { orderedMemberUserIds } from "./repository.js";

/** Home /runs/mine badges: enough calendars saved vs still recruiting or no common hour. */
export function homeRunListBadgeFlags(runId, rosterTargets) {
  const targets = parseRosterTargets(rosterTargets);
  const minTarget = Math.min(...targets);
  const orderedIds = orderedMemberUserIds(runId);
  let membersWithAnySave = 0;
  for (const uid of orderedIds) {
    if (memberHasNonEmptyAvailability(runId, uid)) membersWithAnySave++;
  }
  const runFound = membersWithAnySave >= minTarget;
  const activeMin = activeCountForSize(orderedIds, minTarget);
  const idsForOverlap =
    activeMin >= minTarget
      ? activeRosterUserIdsFromOrdered(orderedIds, minTarget)
      : orderedIds;
  const runRow = db.prepare("SELECT included_weekdays FROM runs WHERE id = ?").get(runId);
  const weekdays = runIncludedWeekdays(runRow);
  const overlap =
    idsForOverlap.length > 0
      ? intersectionSlotsForUserIds(runId, idsForOverlap, weekdays)
      : [];
  const noSharedWindow = idsForOverlap.length > 0 && overlap.length === 0;
  const acceptingPlayers =
    !runFound && (activeMin < minTarget || noSharedWindow);
  return { runFound, acceptingPlayers };
}
