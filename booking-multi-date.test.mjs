import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import { slotKeyFromParts } from "./slotKeys.js";
import {
  bookingRosterSlotSets,
  buildBookingRentalsByDate,
  computeBookingWindowCandidates,
} from "./server/booking-candidates.js";

function keysFor(ymd, hours) {
  const [y, m, d] = ymd.split("-").map(Number);
  return hours.map((h) => slotKeyFromParts(y, m, d, h));
}

function weekendDaysInJune2026() {
  const out = [];
  for (let d = 1; d <= 30; d++) {
    const day = new Date(2026, 5, d);
    const dow = day.getDay();
    if (dow === 0 || dow === 5 || dow === 6) {
      out.push(`2026-06-${String(d).padStart(2, "0")}`);
    }
  }
  return out;
}

describe("computeBookingWindowCandidates keeps all viable dates", () => {
  let tmpDir;
  let tmpDbPath;
  let db;
  let runId;
  let rosterIds;
  let saveAvailability;
  let loadSlotSavedAtByUser;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vbc-multi-date-"));
    tmpDbPath = path.join(tmpDir, "test.db");
    process.env.DB_PATH = tmpDbPath;
    const { openDb } = await import("./server/db.js");
    ({ saveAvailability, loadSlotSavedAtByUser } = await import(
      "./server/runs/availability.js"
    ));
    db = openDb();

    rosterIds = [];
    for (let i = 1; i <= 13; i++) {
      db.prepare(
        `INSERT INTO users (first_name, last_name, email, password_hash)
         VALUES (?, ?, ?, 'hash')`
      ).run(`P${i}`, "Test", `p${i}@multi-date.test`);
      rosterIds.push(
        Number(db.prepare("SELECT id FROM users WHERE email = ?").get(`p${i}@multi-date.test`).id)
      );
    }

    db.prepare(
      `INSERT INTO runs (creator_id, title, capacity, date_start, date_end, run_code, share_token)
       VALUES (?, 'Multi-date', 12, '2026-06-01', '2026-06-30', 'MULTI1', 'multidatetokentest1234567890')`
    ).run(rosterIds[0]);
    runId = Number(db.prepare("SELECT id FROM runs").get().id);

    const insertMember = db.prepare(
      "INSERT INTO run_members (run_id, user_id) VALUES (?, ?)"
    );
    for (const uid of rosterIds) insertMember.run(runId, uid);

    const hours = [];
    for (let h = 6; h <= 21; h++) hours.push(h);
    const broadSlots = weekendDaysInJune2026().flatMap((ymd) => keysFor(ymd, hours));
    const june13 = keysFor("2026-06-13", [18, 19]);
    const june14Core = keysFor("2026-06-14", [18, 19]);

    for (let i = 0; i < 12; i++) {
      saveAvailability(
        runId,
        rosterIds[i],
        JSON.stringify([...broadSlots, ...june13, ...june14Core])
      );
    }
    saveAvailability(
      runId,
      rosterIds[12],
      JSON.stringify([...june14Core, ...keysFor("2026-06-14", [20, 21])])
    );
  });

  after(() => {
    delete process.env.DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function candidates() {
    return computeBookingWindowCandidates(db, runId, {
      rosterUserIdsBooking: rosterIds,
      rosterCapacity: 12,
      dateStartStr: "2026-06-01",
      dateEndStr: "2026-06-30",
      includedWeekdays: [0, 5, 6],
    });
  }

  function rentalDates(batch) {
    const members = db
      .prepare(
        `SELECT u.id, u.first_name, u.last_name
         FROM run_members m JOIN users u ON u.id = m.user_id
         WHERE m.run_id = ? ORDER BY m.rowid ASC`
      )
      .all(runId);
    const userInfoById = new Map(
      members.map((m) => [
        Number(m.id),
        { firstName: m.first_name, lastName: m.last_name },
      ])
    );
    return buildBookingRentalsByDate(batch, {
      slotsByUser: bookingRosterSlotSets(db, runId, rosterIds),
      userInfoById,
      slotSavedAtByUser: loadSlotSavedAtByUser(runId, rosterIds),
    }).map((g) => g.date);
  }

  it("finds many bookable windows across the month", () => {
    const batch = candidates();
    assert.ok(batch.length > 40, `expected >40 candidates, got ${batch.length}`);
  });

  it("keeps June 13 and June 14 when a later date opens", () => {
    const dates = rentalDates(candidates());
    assert.ok(dates.includes("2026-06-13"), `missing June 13, got ${dates.join(", ")}`);
    assert.ok(dates.includes("2026-06-14"), `missing June 14, got ${dates.join(", ")}`);
  });

  it("old top-40 cap would have dropped an early viable date", () => {
    const batch = candidates();
    const truncated = batch.slice(0, 40);
    const fullDates = new Set(rentalDates(batch));
    const truncatedDates = new Set(rentalDates(truncated));
    const dropped = [...fullDates].filter((d) => !truncatedDates.has(d));
    assert.ok(
      dropped.length > 0,
      "expected top-40 truncation to hide at least one viable date"
    );
    assert.ok(
      dropped.includes("2026-06-13") || dropped.includes("2026-06-14"),
      `expected June 13 or 14 among dropped dates, got ${dropped.join(", ")}`
    );
  });
});
