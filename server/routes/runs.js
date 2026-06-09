import { db } from "../db-singleton.js";
import {
  filterSlotKeysByIncludedWeekdays,
  parseIncludedWeekdays,
  serializeIncludedWeekdays,
} from "../../run-weekdays.js";
import {
  maxEnabledRosterTarget,
  ROSTER_SIZES,
  serializeRosterTargets,
} from "../../roster-tiers.js";
import {
  firstFutureSlotKey,
  slotKeyToWindowIso,
} from "../../slotKeys.js";
import { checkSkeddaVenues } from "../courtChecker.js";
import { requireAuth, getUserFromRequest } from "./auth.js";
import { lastWeekStartOfMonth } from "../../default-run-month.js";
import {
  canSetAvailability,
  countMembersWithAvailability,
  intersectionSlots,
  parseSlots,
  runIncludedWeekdays,
  saveAvailability,
  schedulingWaitlistLocked,
  activeRosterUserIds,
} from "../runs/availability.js";
import { homeRunListBadgeFlags } from "../runs/badges.js";
import { buildPublicRunPayload } from "../runs/public-payload.js";
import { parseDefaultRunCode } from "../../default-run-month.js";
import { ensureUserInDefaultRunByCode } from "../runs/default-runs.js";
import {
  countGuestsWithAvailability,
  createGuest,
  deleteGuest,
  formatGuestRow,
  listGuestsBySponsor,
  updateGuest,
} from "../runs/guests.js";
import {
  createRun,
  getRunByCode,
  getRunByShareToken,
  joinRun,
  leaveRun,
  memberCount,
  orderedMemberUserIds,
  runRosterTargets,
  userInRun,
} from "../runs/repository.js";

export function registerRunRoutes(app) {
  app.post("/api/runs", requireAuth, (req, res) => {
    const { title, dateStart, dateEnd, includedWeekdays } = req.body || {};
    if (!title?.trim() || !dateStart || !dateEnd) {
      res.status(400).json({
        error: "title, dateStart, and dateEnd are required.",
      });
      return;
    }
    const weekdays = parseIncludedWeekdays(includedWeekdays);
    if (!weekdays.length) {
      res.status(400).json({ error: "Select at least one day of the week." });
      return;
    }
    if (String(dateEnd) < String(dateStart)) {
      res.status(400).json({ error: "dateEnd must be on or after dateStart." });
      return;
    }
    const { runId, shareToken, runCode } = createRun({
      creatorId: req.user.id,
      title: title.trim(),
      dateStart: String(dateStart),
      dateEnd: String(dateEnd),
      weekdaysJson: serializeIncludedWeekdays(weekdays),
      targetsJson: serializeRosterTargets([12, 18, 24]),
    });
    res.status(201).json({
      id: runId,
      shareToken,
      runCode,
      joinPath: `/?join=${encodeURIComponent(runCode)}`,
      publicPath: `/?run=${encodeURIComponent(shareToken)}`,
    });
  });

  app.get("/api/runs/mine", requireAuth, (req, res) => {
    const rows = db
      .prepare(
        `SELECT r.*,
          (SELECT COUNT(*) FROM run_members m WHERE m.run_id = r.id) AS member_count
         FROM runs r
         WHERE r.creator_id = ?
            OR EXISTS (SELECT 1 FROM run_members m WHERE m.run_id = r.id AND m.user_id = ?)
         ORDER BY r.created_at DESC`
      )
      .all(req.user.id, req.user.id);
    for (const r of rows) {
      r.publicUrl = `/?run=${encodeURIComponent(r.share_token)}`;
      const { runFound, acceptingPlayers } = homeRunListBadgeFlags(
        r.id,
        r.target_roster_sizes
      );
      r.runFound = runFound;
      r.acceptingPlayers = acceptingPlayers;
    }
    res.json({ runs: rows });
  });

  app.get("/api/runs/by-code/:code", (req, res) => {
    const code = String(req.params.code || "").trim().toUpperCase();
    const run = getRunByCode(code);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    res.json({
      id: run.id,
      title: run.title,
      capacity: run.capacity,
      dateStart: run.date_start,
      dateEnd: run.date_end,
      runCode: run.run_code,
      shareToken: run.share_token,
      memberCount: memberCount(run.id),
      publicPath: `/?run=${encodeURIComponent(run.share_token)}`,
    });
  });

  app.get("/api/runs/public/:token", (req, res) => {
    const run = getRunByShareToken(req.params.token);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    const user = getUserFromRequest(req);
    const payload = buildPublicRunPayload(run, user, {
      diag: req.query.diag === "1",
    });
    res.json(payload);
  });

  app.post("/api/runs/:id/join", requireAuth, (req, res) => {
    const runId = Number(req.params.id);
    const run = db.prepare("SELECT id, capacity FROM runs WHERE id = ?").get(runId);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    if (userInRun(runId, req.user.id)) {
      res.json({ ok: true, alreadyMember: true });
      return;
    }
    joinRun(runId, req.user.id);
    res.status(201).json({ ok: true });
  });

  app.post("/api/runs/join-by-code", requireAuth, (req, res) => {
    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!code) {
      res.status(400).json({ error: "code is required." });
      return;
    }
    if (parseDefaultRunCode(code)) {
      const now = new Date();
      const parsed = parseDefaultRunCode(code);
      const curYear = now.getFullYear();
      const curMonth = now.getMonth(); // 0-based
      const boundary = lastWeekStartOfMonth(curYear, curMonth);
      const inLastWeek = now >= boundary;
      const next =
        curMonth === 11
          ? { year: curYear + 1, month: 0 }
          : { year: curYear, month: curMonth + 1 };

      // Rule:
      // - Before the last week of the month: can ONLY join this month's default run.
      // - During the last week: default is next month, but MAY also join this month by code.
      const allowed =
        parsed &&
        ((parsed.year === curYear && parsed.month === curMonth) ||
          (inLastWeek && parsed.year === next.year && parsed.month === next.month));
      if (!allowed) {
        res.status(400).json({
          error: inLastWeek
            ? "You can only join this month or next month default run."
            : "You can only join this month's default run right now.",
        });
        return;
      }
      const info = ensureUserInDefaultRunByCode(req.user.id, code);
      if (!info) {
        res.status(500).json({ error: "Could not join default run." });
        return;
      }
      res.json({ ok: true, runId: null, shareToken: info.shareToken, defaultRun: true });
      return;
    }
    const run = db.prepare("SELECT id, capacity FROM runs WHERE run_code = ?").get(code);
    if (!run) {
      res.status(404).json({ error: "Invalid run code." });
      return;
    }
    if (userInRun(run.id, req.user.id)) {
      const { share_token: shareToken } = db
        .prepare("SELECT share_token FROM runs WHERE id = ?")
        .get(run.id);
      res.json({ ok: true, runId: run.id, shareToken });
      return;
    }
    joinRun(run.id, req.user.id);
    const { share_token: shareToken } = db
      .prepare("SELECT share_token FROM runs WHERE id = ?")
      .get(run.id);
    res.status(201).json({ ok: true, runId: run.id, shareToken });
  });

  app.post("/api/runs/public/:token/leave", requireAuth, (req, res) => {
    const run = getRunByShareToken(req.params.token);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    if (!userInRun(run.id, req.user.id)) {
      res.status(403).json({ error: "You are not on this run." });
      return;
    }
    const result = leaveRun(run, req.user.id);
    res.json({ ok: true, ...result });
  });

  app.get("/api/runs/public/:token/guests", requireAuth, (req, res) => {
    const run = getRunByShareToken(req.params.token);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    if (!userInRun(run.id, req.user.id)) {
      res.status(403).json({ error: "Join this run before managing guests." });
      return;
    }
    const weekdays = runIncludedWeekdays(run);
    const guests = listGuestsBySponsor(run.id, req.user.id).map((row) =>
      formatGuestRow(row, weekdays)
    );
    res.json({ guests });
  });

  app.post("/api/runs/public/:token/guests", requireAuth, (req, res) => {
    const run = getRunByShareToken(req.params.token);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    if (!userInRun(run.id, req.user.id)) {
      res.status(403).json({ error: "Join this run before adding guests." });
      return;
    }
    const { firstName, lastName, slots, mergeIntoGuestId } = req.body || {};
    const weekdays = runIncludedWeekdays(run);
    const slotsRaw = slots != null ? parseSlots({ slots }) : [];
    if (slots != null && !slotsRaw) {
      res.status(400).json({ error: "slots must be a string array." });
      return;
    }
    const filtered =
      slotsRaw && slotsRaw.length
        ? filterSlotKeysByIncludedWeekdays(slotsRaw, weekdays)
        : [];
    let mergeId = undefined;
    if (mergeIntoGuestId != null) {
      mergeId = Number(mergeIntoGuestId);
      if (!Number.isFinite(mergeId)) {
        res.status(400).json({ error: "Invalid guest id." });
        return;
      }
    }
    const result = createGuest(run.id, req.user.id, {
      firstName,
      lastName,
      slots: filtered,
      mergeIntoGuestId: mergeId,
    });
    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(result.merged ? 200 : 201).json({
      ok: true,
      guest: result.guest,
      count: result.count,
      merged: Boolean(result.merged),
    });
  });

  app.patch("/api/runs/public/:token/guests/:guestId", requireAuth, (req, res) => {
    const run = getRunByShareToken(req.params.token);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    if (!userInRun(run.id, req.user.id)) {
      res.status(403).json({ error: "Join this run before editing guests." });
      return;
    }
    const guestId = Number(req.params.guestId);
    if (!Number.isFinite(guestId)) {
      res.status(400).json({ error: "Invalid guest id." });
      return;
    }
    const weekdays = runIncludedWeekdays(run);
    const { firstName, lastName, slots, appendSlots, removeSlots } = req.body || {};
    let slotsPayload = undefined;
    let appendPayload = undefined;
    let removePayload = undefined;
    if (slots != null) {
      const slotsRaw = parseSlots({ slots });
      if (!slotsRaw) {
        res.status(400).json({ error: "slots must be a string array." });
        return;
      }
      slotsPayload = filterSlotKeysByIncludedWeekdays(slotsRaw, weekdays);
    }
    if (appendSlots != null) {
      const appendRaw = parseSlots({ slots: appendSlots });
      if (!appendRaw) {
        res.status(400).json({ error: "appendSlots must be a string array." });
        return;
      }
      appendPayload = filterSlotKeysByIncludedWeekdays(appendRaw, weekdays);
    }
    if (removeSlots != null) {
      const removeRaw = parseSlots({ slots: removeSlots });
      if (!removeRaw) {
        res.status(400).json({ error: "removeSlots must be a string array." });
        return;
      }
      removePayload = filterSlotKeysByIncludedWeekdays(removeRaw, weekdays);
    }
    const result = updateGuest(run.id, req.user.id, guestId, {
      firstName,
      lastName,
      slots: slotsPayload,
      appendSlots: appendPayload,
      removeSlots: removePayload,
    });
    if (result.error) {
      res.status(result.error === "Guest not found." ? 404 : 400).json({
        error: result.error,
      });
      return;
    }
    res.json({
      ok: true,
      deleted: Boolean(result.deleted),
      guest: result.guest ?? null,
      count: result.count,
    });
  });

  app.delete("/api/runs/public/:token/guests/:guestId", requireAuth, (req, res) => {
    const run = getRunByShareToken(req.params.token);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    if (!userInRun(run.id, req.user.id)) {
      res.status(403).json({ error: "Join this run before removing guests." });
      return;
    }
    const guestId = Number(req.params.guestId);
    if (!Number.isFinite(guestId)) {
      res.status(400).json({ error: "Invalid guest id." });
      return;
    }
    const result = deleteGuest(run.id, req.user.id, guestId);
    if (result.error) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  app.put("/api/runs/public/:token/availability", requireAuth, (req, res) => {
    const run = getRunByShareToken(req.params.token);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    if (!userInRun(run.id, req.user.id)) {
      res.status(403).json({ error: "Join this run before setting availability." });
      return;
    }
    if (!canSetAvailability(run.id, req.user.id)) {
      res.status(403).json({ error: "Join this run before setting availability." });
      return;
    }
    const slotsRaw = parseSlots(req.body);
    if (!slotsRaw) {
      res.status(400).json({
        error: "Body must include slots: string[] (ISO timestamps).",
      });
      return;
    }
    const weekdays = runIncludedWeekdays(run);
    const slots = filterSlotKeysByIncludedWeekdays(slotsRaw, weekdays);
    saveAvailability(run.id, req.user.id, JSON.stringify(slots));

    const wlLocked = schedulingWaitlistLocked(run.id);
    const targets = runRosterTargets(run);
    const cap = maxEnabledRosterTarget(targets);
    const countIds = wlLocked
      ? activeRosterUserIds(run.id, cap)
      : orderedMemberUserIds(run.id);
    const membersWithAvailability =
      countMembersWithAvailability(run.id, countIds) +
      countGuestsWithAvailability(run.id);

    res.json({
      ok: true,
      count: slots.length,
      membersWithAvailability,
      rosterSize: wlLocked ? run.capacity : memberCount(run.id),
    });
  });

  app.post("/api/runs/public/:token/check-courts", async (req, res) => {
    const run = getRunByShareToken(req.params.token);
    if (!run) {
      res.status(404).json({ error: "Run not found." });
      return;
    }
    const count = memberCount(run.id);
    const checkSize = Number(req.body?.rosterSize) || 12;
    if (!ROSTER_SIZES.includes(checkSize)) {
      res.status(400).json({ error: "Roster size must be 12, 18, or 24." });
      return;
    }
    if (count < checkSize) {
      res.status(400).json({
        error: `Court check needs at least ${checkSize} players who joined. ${count} joined so far.`,
      });
      return;
    }
    const overlap = intersectionSlots(
      run.id,
      checkSize,
      runIncludedWeekdays(run)
    );
    let slotStart = req.body?.slotStart;
    let slotEnd = req.body?.slotEnd;
    if (!slotStart || !slotEnd) {
      const pick = firstFutureSlotKey(overlap);
      if (!pick) {
        res.status(400).json({
          error:
            "No shared free slot yet. Everyone must submit availability, and slots must overlap.",
        });
        return;
      }
      const win = slotKeyToWindowIso(pick, 1);
      slotStart = win.slotStartIso;
      slotEnd = win.slotEndIso;
    }
    try {
      const venues = await checkSkeddaVenues(slotStart, slotEnd);
      res.json({
        slotStart,
        slotEnd,
        venues: venues.map((v) => ({
          venueId: v.venueId,
          name: v.name,
          bookingUrl: v.bookingUrl,
          ok: v.ok,
          error: v.error,
          hasAvailableCourt:
            v.hasAvailableCourt == null ? null : !!v.hasAvailableCourt,
          note: v.note || null,
          skeddaLoadedRange: v.skeddaLoadedRange || null,
          slotOutsideLoadedRange: !!v.slotOutsideLoadedRange,
          freeSpaceIds: v.freeSpaceIds,
          totalSpaces: v.totalSpaces,
        })),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({
        error:
          e instanceof Error
            ? e.message
            : "Court check failed. Ensure Playwright browsers are installed (npx playwright install chromium).",
      });
    }
  });
}
