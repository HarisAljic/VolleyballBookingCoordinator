import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import { slotKeyFromParts } from "./slotKeys.js";
import {
  coalitionRosterWaitlistForWindow,
  windowSaveTimestamp,
} from "./server/booking-candidates.js";

const SLOT_A = slotKeyFromParts(2026, 6, 7, 18);
const SLOT_B = slotKeyFromParts(2026, 6, 7, 20);

function ts(minute) {
  return `2026-06-07 10:${String(minute).padStart(2, "0")}:00`;
}

function buildScenario({ includePerson2OnA = false, person2SaveMinute = 99 } = {}) {
  const slotsByUser = new Map();
  const slotSavedAtByUser = new Map();
  const userInfoById = new Map();

  for (let id = 1; id <= 13; id++) {
    userInfoById.set(id, { firstName: `P${id}`, lastName: "Test" });
  }

  let saveMinute = 0;
  for (const id of [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
    saveMinute += 1;
    slotsByUser.set(id, new Set([SLOT_A]));
    slotSavedAtByUser.set(id, new Map([[SLOT_A, ts(saveMinute)]]));
  }

  if (includePerson2OnA) {
    slotsByUser.set(2, new Set([SLOT_A]));
    slotSavedAtByUser.set(2, new Map([[SLOT_A, ts(person2SaveMinute)]]));
  } else {
    slotsByUser.set(2, new Set([SLOT_B]));
    slotSavedAtByUser.set(2, new Map([[SLOT_B, ts(1)]]));
  }

  return { slotsByUser, slotSavedAtByUser, userInfoById };
}

describe("windowSaveTimestamp", () => {
  it("uses the latest per-slot save when a window spans multiple hours", () => {
    const h1 = slotKeyFromParts(2026, 6, 7, 18);
    const h2 = slotKeyFromParts(2026, 6, 7, 19);
    const savedAt = new Map([
      [h1, "2026-06-07 10:01:00"],
      [h2, "2026-06-07 10:05:00"],
    ]);
    assert.equal(windowSaveTimestamp([h1, h2], savedAt), "2026-06-07 10:05:00");
  });
});

describe("coalitionRosterWaitlistForWindow save-order priority", () => {
  it("fills roster with first 12 savers of the window", () => {
    const ctx = buildScenario();
    const { roster, waitlist } = coalitionRosterWaitlistForWindow(
      [SLOT_A],
      12,
      ctx.slotsByUser,
      ctx.userInfoById,
      ctx.slotSavedAtByUser
    );
    assert.equal(roster.length, 12);
    assert.equal(waitlist.length, 0);
    assert.ok(!roster.some((m) => m.userId === 2));
  });

  it("waitlists the latest saver when a 13th member adds the window", () => {
    const before = buildScenario();
    const after = buildScenario({ includePerson2OnA: true, person2SaveMinute: 99 });

    const initial = coalitionRosterWaitlistForWindow(
      [SLOT_A],
      12,
      before.slotsByUser,
      before.userInfoById,
      before.slotSavedAtByUser
    );
    assert.deepEqual(
      initial.waitlist.map((m) => m.userId),
      []
    );

    const switched = coalitionRosterWaitlistForWindow(
      [SLOT_A],
      12,
      after.slotsByUser,
      after.userInfoById,
      after.slotSavedAtByUser
    );
    assert.equal(switched.roster.length, 12);
    assert.equal(switched.waitlist.length, 1);
    assert.equal(switched.waitlist[0].userId, 2);
    assert.ok(switched.roster.some((m) => m.userId === 13));
    assert.ok(!switched.roster.some((m) => m.userId === 2));
  });

  it("does not bump an earlier saver when a late switcher joins a full window", () => {
    const ctx = buildScenario({ includePerson2OnA: true, person2SaveMinute: 99 });
    const { roster, waitlist } = coalitionRosterWaitlistForWindow(
      [SLOT_A],
      12,
      ctx.slotsByUser,
      ctx.userInfoById,
      ctx.slotSavedAtByUser
    );
    const rosterIds = roster.map((m) => m.userId);
    assert.deepEqual(waitlist.map((m) => m.userId), [2]);
    assert.ok(rosterIds.includes(13));
    assert.ok(!rosterIds.includes(2));
  });
});

describe("saveAvailability per-slot timestamps", () => {
  let tmpDir;
  let tmpDbPath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vbc-roster-test-"));
    tmpDbPath = path.join(tmpDir, "test.db");
    process.env.DB_PATH = tmpDbPath;
  });

  after(() => {
    delete process.env.DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records a new timestamp when a slot is newly added on update", async () => {
    const { openDb } = await import("./server/db.js");
    const { saveAvailability, loadSlotSavedAtByUser } = await import(
      "./server/runs/availability.js"
    );

    const db = openDb();
    db.prepare(
      "INSERT INTO users (first_name, last_name, email, password_hash) VALUES ('A','B','t@test.com','x')"
    ).run();
    const userId = Number(
      db.prepare("SELECT id FROM users WHERE email = 't@test.com'").get().id
    );
    db.prepare(
      `INSERT INTO runs (creator_id, title, capacity, date_start, date_end, run_code, share_token)
       VALUES (?, 'Test', 12, '2026-06-01', '2026-06-30', 'TST001', 'tokentest123456789012345678901')`
    ).run(userId);
    const runId = Number(db.prepare("SELECT id FROM runs").get().id);

    saveAvailability(runId, userId, JSON.stringify([SLOT_B]));
    db.prepare(
      `UPDATE availability SET slot_saved_at_json = ? WHERE run_id = ? AND user_id = ?`
    ).run(JSON.stringify({ [SLOT_B]: "2026-06-07 10:00:00" }), runId, userId);

    saveAvailability(runId, userId, JSON.stringify([SLOT_A]));
    const after = loadSlotSavedAtByUser(runId, [userId]).get(userId);
    assert.ok(after.get(SLOT_A));
    assert.equal(after.has(SLOT_B), false);
    assert.notEqual(after.get(SLOT_A), "2026-06-07 10:00:00");
  });
});
