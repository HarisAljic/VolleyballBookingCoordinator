import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import { slotKeyFromParts } from "./slotKeys.js";
import { coalitionRosterWaitlistForWindow } from "./server/booking-candidates.js";
import {
  createGuest,
  findGuestByNormalizedName,
  guestParticipantId,
  normalizeGuestName,
  updateGuest,
} from "./server/runs/guests.js";

const H1 = slotKeyFromParts(2026, 6, 13, 18);
const H2 = slotKeyFromParts(2026, 6, 13, 19);
const H3 = slotKeyFromParts(2026, 6, 14, 18);

let tmpDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vb-guest-test-"));
  process.env.DB_PATH = path.join(tmpDir, "test.db");
});

after(() => {
  delete process.env.DB_PATH;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("guest counting in booking", () => {
  it("coalitionRosterWaitlistForWindow includes guests with display names", () => {
    const guestPid = guestParticipantId(7);
    const slotsByUser = new Map([
      [1, new Set([H1, H2])],
      [guestPid, new Set([H1, H2])],
    ]);
    const slotSavedAtByUser = new Map([
      [1, new Map([[H1, "2026-06-01 10:01:00"], [H2, "2026-06-01 10:02:00"]])],
      [guestPid, new Map([[H1, "2026-06-01 10:03:00"], [H2, "2026-06-01 10:04:00"]])],
    ]);
    const userInfoById = new Map([
      [1, { firstName: "Alice", lastName: "Smith" }],
      [
        guestPid,
        {
          firstName: "Jane",
          lastName: "Doe",
          displayName: "Jane Doe (Alice Smith +1)",
          isGuest: true,
          guestId: 7,
        },
      ],
    ]);

    const { roster, matchingCount } = coalitionRosterWaitlistForWindow(
      [H1, H2],
      12,
      slotsByUser,
      userInfoById,
      slotSavedAtByUser
    );

    assert.equal(matchingCount, 2);
    assert.ok(roster.some((p) => p.displayName === "Jane Doe (Alice Smith +1)"));
    assert.ok(roster.some((p) => p.userId === guestPid));
  });

  it("bookingRosterSlotSets loads guest slots from run_guests table", async () => {
    const { openDb } = await import("./server/db.js");
    const { bookingRosterSlotSets, computeBookingWindowCandidates } = await import(
      "./server/booking-candidates.js"
    );

    const db = openDb();
    const tag = `guest-${Date.now()}`;
    const userIds = [];
    for (let i = 1; i <= 12; i++) {
      const info = db
        .prepare(
          `INSERT INTO users (first_name, last_name, email, password_hash)
           VALUES (?, ?, ?, 'x')`
        )
        .run(`User${i}`, "Test", `user${i}-${tag}@guest.test`);
      userIds.push(Number(info.lastInsertRowid));
    }

    db.prepare(
      `INSERT INTO runs (creator_id, title, capacity, date_start, date_end, included_weekdays, target_roster_sizes, run_code, share_token)
       VALUES (?, 'Guest test', 12, '2026-06-01', '2026-06-30', '[0,1,2,3,4,5,6]', '[12,18,24]', ?, ?)`
    ).run(userIds[0], `GST${tag}`, `tok-${tag}`);

    const runId = Number(db.prepare("SELECT id FROM runs WHERE share_token = ?").get(`tok-${tag}`).id);
    for (const uid of userIds) {
      db.prepare("INSERT INTO run_members (run_id, user_id) VALUES (?, ?)").run(runId, uid);
    }
    for (let i = 0; i < 11; i++) {
      db.prepare(
        `INSERT INTO availability (run_id, user_id, slots_json, first_saved_at, slot_saved_at_json)
         VALUES (?, ?, ?, datetime('now'), ?)`
      ).run(
        runId,
        userIds[i],
        JSON.stringify([H1, H2]),
        JSON.stringify({ [H1]: "2026-06-01 10:00:00", [H2]: "2026-06-01 10:00:00" })
      );
    }

    const guestInfo = db
      .prepare(
        `INSERT INTO run_guests (run_id, sponsor_user_id, first_name, last_name, slots_json, slot_saved_at_json)
         VALUES (?, ?, 'Plus', 'One', ?, ?)`
      )
      .run(
        runId,
        userIds[0],
        JSON.stringify([H1, H2]),
        JSON.stringify({ [H1]: "2026-06-01 10:01:00", [H2]: "2026-06-01 10:01:00" })
      );
    const guestPid = guestParticipantId(Number(guestInfo.lastInsertRowid));

    const participantIds = [...userIds, guestPid];
    const slotMaps = bookingRosterSlotSets(db, runId, participantIds);
    assert.ok(slotMaps.get(guestPid)?.has(H1));
    assert.ok(slotMaps.get(guestPid)?.has(H2));

    const candidates = computeBookingWindowCandidates(db, runId, {
      rosterUserIdsBooking: participantIds,
      rosterCapacity: 12,
      dateStartStr: "2026-06-01",
      dateEndStr: "2026-06-30",
      includedWeekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    assert.ok(
      candidates.some((c) => c.rosterCoverageCount >= 12),
      "guest slot should count toward 12-player window coverage"
    );
  });

  it("normalizeGuestName matches case-insensitively with optional last name", () => {
    assert.equal(normalizeGuestName("Jane", "Doe"), "jane doe");
    assert.equal(normalizeGuestName("  JANE ", " DOE "), "jane doe");
    assert.equal(normalizeGuestName("Alex", ""), "alex");
    assert.equal(normalizeGuestName("Alex", "Smith"), normalizeGuestName("alex", "smith"));
  });

  it("createGuest mergeIntoGuestId unions slots instead of duplicating row", async () => {
    const { openDb } = await import("./server/db.js");

    const db = openDb();
    const tag = `merge-${Date.now()}`;
    const sponsor = db
      .prepare(
        `INSERT INTO users (first_name, last_name, email, password_hash)
         VALUES ('Pat', 'Lee', ?, 'x')`
      )
      .run(`pat-${tag}@guest.test`);
    const sponsorId = Number(sponsor.lastInsertRowid);

    db.prepare(
      `INSERT INTO runs (creator_id, title, capacity, date_start, date_end, included_weekdays, target_roster_sizes, run_code, share_token)
       VALUES (?, 'Merge guest', 12, '2026-06-01', '2026-06-30', '[0,1,2,3,4,5,6]', '[12,18,24]', ?, ?)`
    ).run(sponsorId, `M${tag}`, `tok-merge-${tag}`);

    const runId = Number(
      db.prepare("SELECT id FROM runs WHERE share_token = ?").get(`tok-merge-${tag}`).id
    );

    const created = createGuest(runId, sponsorId, {
      firstName: "Sam",
      lastName: "Guest",
      slots: [H1, H2],
    });
    assert.ok(created.guest?.id);

    const match = findGuestByNormalizedName(runId, sponsorId, "sam", "guest");
    assert.equal(match?.id, created.guest.id);

    const merged = createGuest(runId, sponsorId, {
      firstName: "Sam",
      lastName: "Guest",
      slots: [H3],
      mergeIntoGuestId: created.guest.id,
    });
    assert.equal(merged.merged, true);
    assert.deepEqual(
      [...merged.guest.slots].sort(),
      [H1, H2, H3].sort()
    );

    const rows = db
      .prepare(
        "SELECT COUNT(*) AS n FROM run_guests WHERE run_id = ? AND sponsor_user_id = ?"
      )
      .get(runId, sponsorId);
    assert.equal(rows.n, 1);
  });

  it("updateGuest appendSlots and removeSlots adjust availability ranges", async () => {
    const { openDb } = await import("./server/db.js");

    const db = openDb();
    const tag = `patch-${Date.now()}`;
    const sponsor = db
      .prepare(
        `INSERT INTO users (first_name, last_name, email, password_hash)
         VALUES ('Kim', 'Park', ?, 'x')`
      )
      .run(`kim-${tag}@guest.test`);
    const sponsorId = Number(sponsor.lastInsertRowid);

    db.prepare(
      `INSERT INTO runs (creator_id, title, capacity, date_start, date_end, included_weekdays, target_roster_sizes, run_code, share_token)
       VALUES (?, 'Patch guest', 12, '2026-06-01', '2026-06-30', '[0,1,2,3,4,5,6]', '[12,18,24]', ?, ?)`
    ).run(sponsorId, `P${tag}`, `tok-patch-${tag}`);

    const runId = Number(
      db.prepare("SELECT id FROM runs WHERE share_token = ?").get(`tok-patch-${tag}`).id
    );

    const created = createGuest(runId, sponsorId, {
      firstName: "Riley",
      lastName: "",
      slots: [H1],
    });

    const appended = updateGuest(runId, sponsorId, created.guest.id, {
      appendSlots: [H2, H3],
    });
    assert.deepEqual(
      [...appended.guest.slots].sort(),
      [H1, H2, H3].sort()
    );

    const trimmed = updateGuest(runId, sponsorId, created.guest.id, {
      removeSlots: [H2],
    });
    assert.deepEqual([...trimmed.guest.slots].sort(), [H1, H3].sort());
  });

  it("createGuest mergeIntoGuestId replaces overlapping same-day range (shrink)", async () => {
    const { openDb } = await import("./server/db.js");

    const db = openDb();
    const tag = `merge-shrink-${Date.now()}`;
    const sponsor = db
      .prepare(
        `INSERT INTO users (first_name, last_name, email, password_hash)
         VALUES ('Mia', 'Chen', ?, 'x')`
      )
      .run(`mia-${tag}@guest.test`);
    const sponsorId = Number(sponsor.lastInsertRowid);

    db.prepare(
      `INSERT INTO runs (creator_id, title, capacity, date_start, date_end, included_weekdays, target_roster_sizes, run_code, share_token)
       VALUES (?, 'Merge shrink guest', 12, '2026-06-01', '2026-06-30', '[0,1,2,3,4,5,6]', '[12,18,24]', ?, ?)`
    ).run(sponsorId, `MS${tag}`, `tok-merge-shrink-${tag}`);

    const runId = Number(
      db.prepare("SELECT id FROM runs WHERE share_token = ?").get(`tok-merge-shrink-${tag}`).id
    );

    const created = createGuest(runId, sponsorId, {
      firstName: "Sam",
      lastName: "Guest",
      slots: [H1, H2],
    });
    assert.ok(created.guest?.id);

    const merged = createGuest(runId, sponsorId, {
      firstName: "Sam",
      lastName: "Guest",
      slots: [H1],
      mergeIntoGuestId: created.guest.id,
    });
    assert.equal(merged.merged, true);
    assert.deepEqual([...merged.guest.slots].sort(), [H1].sort());

    const rows = db
      .prepare(
        "SELECT COUNT(*) AS n FROM run_guests WHERE run_id = ? AND sponsor_user_id = ?"
      )
      .get(runId, sponsorId);
    assert.equal(rows.n, 1);
  });

  it("updateGuest appendSlots replaces overlapping same-day range (shrink)", async () => {
    const { openDb } = await import("./server/db.js");

    const db = openDb();
    const tag = `shrink-${Date.now()}`;
    const sponsor = db
      .prepare(
        `INSERT INTO users (first_name, last_name, email, password_hash)
         VALUES ('Lee', 'Kim', ?, 'x')`
      )
      .run(`lee-${tag}@guest.test`);
    const sponsorId = Number(sponsor.lastInsertRowid);

    db.prepare(
      `INSERT INTO runs (creator_id, title, capacity, date_start, date_end, included_weekdays, target_roster_sizes, run_code, share_token)
       VALUES (?, 'Shrink guest', 12, '2026-06-01', '2026-06-30', '[0,1,2,3,4,5,6]', '[12,18,24]', ?, ?)`
    ).run(sponsorId, `S${tag}`, `tok-shrink-${tag}`);

    const runId = Number(
      db.prepare("SELECT id FROM runs WHERE share_token = ?").get(`tok-shrink-${tag}`).id
    );

    const created = createGuest(runId, sponsorId, {
      firstName: "Sam",
      lastName: "",
      slots: [H1, H2],
    });

    const shrunk = updateGuest(runId, sponsorId, created.guest.id, {
      appendSlots: [H1],
    });
    assert.deepEqual([...shrunk.guest.slots].sort(), [H1].sort());
  });

  it("updateGuest removeSlots deletes guest when last range removed", async () => {
    const { openDb } = await import("./server/db.js");

    const db = openDb();
    const tag = `del-${Date.now()}`;
    const sponsor = db
      .prepare(
        `INSERT INTO users (first_name, last_name, email, password_hash)
         VALUES ('Jo', 'Park', ?, 'x')`
      )
      .run(`jo-${tag}@guest.test`);
    const sponsorId = Number(sponsor.lastInsertRowid);

    db.prepare(
      `INSERT INTO runs (creator_id, title, capacity, date_start, date_end, included_weekdays, target_roster_sizes, run_code, share_token)
       VALUES (?, 'Delete guest', 12, '2026-06-01', '2026-06-30', '[0,1,2,3,4,5,6]', '[12,18,24]', ?, ?)`
    ).run(sponsorId, `D${tag}`, `tok-del-${tag}`);

    const runId = Number(
      db.prepare("SELECT id FROM runs WHERE share_token = ?").get(`tok-del-${tag}`).id
    );

    const created = createGuest(runId, sponsorId, {
      firstName: "Alex",
      lastName: "",
      slots: [H1],
    });

    const result = updateGuest(runId, sponsorId, created.guest.id, {
      removeSlots: [H1],
    });
    assert.equal(result.deleted, true);
    assert.equal(result.count, 0);

    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM run_guests WHERE run_id = ? AND id = ?")
      .get(runId, created.guest.id);
    assert.equal(rows.n, 0);
  });
});
