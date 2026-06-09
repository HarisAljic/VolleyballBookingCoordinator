import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { slotKeyFromParts } from "./slotKeys.js";
import {
  coalitionWaitlistedUserIdsFromRentals,
  memberCoalitionRentalStatus,
  memberRentalStatusForSizes,
} from "./server/booking-candidates.js";

const H1 = slotKeyFromParts(2026, 6, 13, 20);
const H2 = slotKeyFromParts(2026, 6, 13, 21);

describe("coalition waitlist count for UI header", () => {
  it("counts unique coalition waitlist members from bookingRentalsByDate", () => {
    const roster = Array.from({ length: 12 }, (_, i) => ({
      userId: i + 1,
      firstName: `R${i + 1}`,
      lastName: "Test",
    }));
    const waitlist = [
      { userId: 14, firstName: "Nedim", lastName: "Burkic", waitlistRank: 1 },
    ];
    const bookingRentalsByDate = [
      {
        date: "2026-06-13",
        dateLabel: "June 13",
        options: [
          {
            optionNumber: 1,
            rosterCapacity: 12,
            durationHours: 2,
            slotKeys: [H1, H2],
            slotStart: H1,
            roster,
            waitlist,
          },
        ],
      },
    ];
    const groupsBySize = { 12: bookingRentalsByDate };

    assert.equal(
      coalitionWaitlistedUserIdsFromRentals(bookingRentalsByDate).size,
      1
    );
    assert.equal(
      memberCoalitionRentalStatus(14, groupsBySize).hourWaitlisted,
      true
    );
    assert.equal(
      memberCoalitionRentalStatus(1, groupsBySize).hourWaitlisted,
      false
    );
  });

  it("per-slot tags can over-count vs coalition waitlists", () => {
    const groupsBySize = {
      12: [
        {
          date: "2026-06-13",
          options: [
            {
              optionNumber: 1,
              rosterCapacity: 12,
              slotKeys: [H1, H2],
              roster: Array.from({ length: 12 }, (_, i) => ({ userId: i + 1 })),
              waitlist: [{ userId: 14, waitlistRank: 1 }],
            },
          ],
        },
      ],
    };
    const saturatedCounts = new Map([
      [H1, 12],
      [H2, 12],
    ]);

    assert.equal(
      memberCoalitionRentalStatus(2, groupsBySize).hourWaitlisted,
      false
    );
    assert.ok(
      memberRentalStatusForSizes([H1, H2], groupsBySize, saturatedCounts)
        .hourWaitlisted
    );
  });
});
