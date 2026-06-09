import Database from "better-sqlite3";

const dbPath = process.env.DB_PATH || "/app/data/app.db";
process.env.DB_PATH = dbPath;
const query = process.argv[2] || "users";

function parseBookingArgs(arg) {
  const raw = String(arg || "").trim();
  if (!raw) return { runId: null, date: null };
  const parts = raw.split(":").filter(Boolean);
  if (parts.length === 1) {
    if (/^\d+$/.test(parts[0])) return { runId: Number(parts[0]), date: null };
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) return { runId: null, date: parts[0] };
  }
  if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
    return { runId: Number(parts[0]), date: parts[1] };
  }
  console.error(`Invalid booking args: ${raw}`);
  console.error("Use booking, booking:RUN_ID, booking:YYYY-MM-DD, or booking:RUN_ID:YYYY-MM-DD");
  process.exit(1);
}

function formatOptionForPrint(opt) {
  const start = formatSlotKeyForDisplay(opt.slotStart);
  const end = formatSlotKeyForDisplay(opt.slotEnd);
  return {
    optionNumber: opt.optionNumber,
    rosterCapacity: opt.rosterCapacity,
    durationHours: opt.durationHours,
    slotStart: opt.slotStart,
    slotEnd: opt.slotEnd,
    timeLabel: start === end ? start : `${start} – ${end}`,
    rosterCoverageCount: opt.rosterCoverageCount,
    roster: opt.roster,
    waitlist: opt.waitlist,
  };
}

async function runBookingQuery(arg, { waitlistOnly = false } = {}) {
  const { runId: runIdArg, date: dateFilter } = parseBookingArgs(arg);
  const { db } = await import("../server/db-singleton.js");
  const { buildBookingRentalGroupsBySize } = await import("../server/runs/booking.js");
  const { mergeBookingRentalsByDate } = await import("../server/booking-candidates.js");
  const { listMembers, orderedMemberUserIds } = await import("../server/runs/repository.js");
  const { schedulingWaitlistLocked } = await import("../server/runs/availability.js");

  const run = runIdArg
    ? db
        .prepare(
          `SELECT id, title, capacity, date_start, date_end, run_code, is_default, included_weekdays
           FROM runs WHERE id = ?`
        )
        .get(runIdArg)
    : db
        .prepare(
          `SELECT id, title, capacity, date_start, date_end, run_code, is_default, included_weekdays
           FROM runs WHERE is_default = 1 ORDER BY id DESC LIMIT 1`
        )
        .get();
  if (!run) {
    console.error(runIdArg ? `Run not found: ${runIdArg}` : "No default run found");
    process.exit(1);
  }

  const orderedIds = orderedMemberUserIds(run.id);
  const members = listMembers(run.id);
  const wlLocked = schedulingWaitlistLocked(run.id);
  const bySize = buildBookingRentalGroupsBySize(run.id, orderedIds, run, wlLocked, members);
  let dates = mergeBookingRentalsByDate(bySize);

  if (dateFilter) {
    dates = dates.filter((g) => g.date === dateFilter);
  }
  if (waitlistOnly) {
    dates = dates
      .map((g) => ({
        ...g,
        options: (g.options || []).filter((o) => (o.waitlist || []).length > 0),
      }))
      .filter((g) => g.options.length > 0);
  }

  print({
    run: {
      id: run.id,
      title: run.title,
      run_code: run.run_code,
      date_start: run.date_start,
      date_end: run.date_end,
      memberCount: orderedIds.length,
      schedulingWaitlistLocked: wlLocked,
    },
    dateFilter: dateFilter || null,
    waitlistOnly,
    dates: dates.map((g) => ({
      date: g.date,
      dateLabel: g.dateLabel,
      options: (g.options || []).map(formatOptionForPrint),
    })),
  });
}

async function runWaitlistCompareQuery(arg) {
  const { runId: runIdArg } = parseBookingArgs(arg || "3");
  const { db } = await import("../server/db-singleton.js");
  const { buildBookingRentalGroupsBySize } = await import("../server/runs/booking.js");
  const {
    coalitionWaitlistedUserIdsFromRentals,
    memberCoalitionRentalStatus,
    memberRentalStatusForSizes,
    mergeBookingRentalsByDate,
  } = await import("../server/booking-candidates.js");
  const { listMembers, orderedMemberUserIds } = await import("../server/runs/repository.js");
  const {
    memberSlotsFromRow,
    runIncludedWeekdays,
    schedulingWaitlistLocked,
    slotCountsBeforeUserInSaveOrder,
  } = await import("../server/runs/availability.js");

  const run = runIdArg
    ? db
        .prepare(
          `SELECT id, title, capacity, date_start, date_end, run_code, is_default, included_weekdays
           FROM runs WHERE id = ?`
        )
        .get(runIdArg)
    : db
        .prepare(
          `SELECT id, title, capacity, date_start, date_end, run_code, is_default, included_weekdays
           FROM runs WHERE is_default = 1 ORDER BY id DESC LIMIT 1`
        )
        .get();
  if (!run) {
    console.error(runIdArg ? `Run not found: ${runIdArg}` : "No default run found");
    process.exit(1);
  }

  const orderedIds = orderedMemberUserIds(run.id);
  const members = listMembers(run.id);
  const wlLocked = schedulingWaitlistLocked(run.id);
  const includedWeekdays = runIncludedWeekdays(run);
  const bySize = buildBookingRentalGroupsBySize(run.id, orderedIds, run, wlLocked, members);
  const bookingRentalsByDate = mergeBookingRentalsByDate(bySize);

  const coalitionIds = coalitionWaitlistedUserIdsFromRentals(bookingRentalsByDate, {
    futureOnly: true,
  });
  const coalitionMembers = [...coalitionIds].map((uid) => {
    const m = members.find((x) => Number(x.id) === uid);
    return {
      userId: uid,
      name: m ? `${m.first_name} ${m.last_name}` : String(uid),
      sizes: memberCoalitionRentalStatus(uid, bySize).waitlistedSizes,
    };
  });

  let legacySlotTagWaitlistCount = 0;
  const slotTagOnly = [];
  for (const uid of orderedIds) {
    const slots = memberSlotsFromRow(run.id, uid, includedWeekdays);
    const countsBefore = slotCountsBeforeUserInSaveOrder(run.id, uid);
    const tags = memberRentalStatusForSizes(slots, bySize, countsBefore);
    if (tags.hourWaitlisted) legacySlotTagWaitlistCount++;
    if (tags.hourWaitlisted && !coalitionIds.has(Number(uid))) {
      const m = members.find((x) => Number(x.id) === Number(uid));
      slotTagOnly.push({
        userId: uid,
        name: m ? `${m.first_name} ${m.last_name}` : String(uid),
        waitlistedSizes: tags.waitlistedSizes,
      });
    }
  }

  print({
    run: { id: run.id, title: run.title, memberCount: orderedIds.length },
    coalitionWaitlistCount: coalitionIds.size,
    legacySlotTagWaitlistCount,
    coalitionMembers,
    slotTagOnlyMembers: slotTagOnly,
    note: "coalitionWaitlistCount is what the UI header should show after the fix",
  });
}

const bookingMatch = /^booking(?::(.+))?$/i.exec(query);
const waitlistMatch = /^waitlist(?::(.+))?$/i.exec(query);
const waitlistCompareMatch = /^waitlist-compare(?::(.+))?$/i.exec(query);
if (waitlistCompareMatch) {
  await runWaitlistCompareQuery(waitlistCompareMatch[1] || "");
  process.exit(0);
}
if (bookingMatch || waitlistMatch) {
  const arg = (bookingMatch || waitlistMatch)[1] || "";
  await runBookingQuery(arg, { waitlistOnly: !!waitlistMatch });
  process.exit(0);
}

const db = new Database(dbPath, { readonly: true });

function print(rows) {
  console.log(JSON.stringify(rows, null, 2));
}

function parseSlotSavedAt(json) {
  try {
    const obj = JSON.parse(json || "{}");
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

function ordinalDay(n) {
  const v = n % 100;
  const suf = ["th", "st", "nd", "rd"];
  const o = v >= 11 && v <= 13 ? "th" : suf[v % 10] || "th";
  return `${n}${o}`;
}

function formatSlotKeyForDisplay(key) {
  const t = String(key || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00:00$/.exec(t);
  if (!m) return t;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], 0, 0, 0);
  if (Number.isNaN(d.getTime())) return t;
  const month = d.toLocaleString(undefined, { month: "long" });
  const time = d.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${month} ${ordinalDay(d.getDate())}, ${time.toLowerCase()}`;
}

function slotsWithSaveTimes(slotsJson, slotSavedAtJson) {
  let slots = [];
  try {
    slots = JSON.parse(slotsJson || "[]");
  } catch {
    slots = [];
  }
  const savedAt = parseSlotSavedAt(slotSavedAtJson);
  return slots
    .map((slot) => ({
      slot,
      display: formatSlotKeyForDisplay(slot),
      firstSavedAt: savedAt[slot] || null,
    }))
    .sort((a, b) => {
      const ta = a.firstSavedAt || "";
      const tb = b.firstSavedAt || "";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return String(a.slot).localeCompare(String(b.slot));
    });
}

function availabilityForDate(ymd) {
  const prefix = `${ymd}T`;
  const rows = db
    .prepare(
      `SELECT a.run_id, r.title AS run_title, a.user_id, u.first_name, u.last_name, a.slots_json
       FROM availability a
       JOIN runs r ON r.id = a.run_id
       JOIN users u ON u.id = a.user_id
       WHERE r.date_start <= ? AND r.date_end >= ?
       ORDER BY a.run_id, a.user_id`
    )
    .all(ymd, ymd);

  return {
    date: ymd,
    runs: db
      .prepare(
        `SELECT id, title, date_start, date_end, run_code
         FROM runs WHERE date_start <= ? AND date_end >= ?
         ORDER BY id`
      )
      .all(ymd, ymd),
    availability: rows
      .map((row) => {
        let slots = [];
        try {
          slots = JSON.parse(row.slots_json || "[]");
        } catch {
          slots = [];
        }
        const daySlots = slots.filter((s) => String(s).startsWith(prefix));
        if (!daySlots.length) return null;
        return {
          run_id: row.run_id,
          run_title: row.run_title,
          user_id: row.user_id,
          name: `${row.first_name} ${row.last_name}`,
          slots: daySlots,
        };
      })
      .filter(Boolean),
  };
}

switch (query) {
  case "users":
    print(
      db
        .prepare(
          "SELECT id, first_name, last_name, email, created_at FROM users ORDER BY id"
        )
        .all()
    );
    break;
  case "runs":
    print(
      db
        .prepare(
          `SELECT id, title, capacity, date_start, date_end, run_code, share_token, is_default, created_at
           FROM runs ORDER BY id`
        )
        .all()
    );
    break;
  case "members":
    print(
      db
        .prepare(
          `SELECT rm.run_id, r.title AS run_title, rm.user_id, u.first_name, u.last_name, u.email, rm.joined_at
           FROM run_members rm
           JOIN runs r ON r.id = rm.run_id
           JOIN users u ON u.id = rm.user_id
           ORDER BY rm.run_id, rm.user_id`
        )
        .all()
    );
    break;
  case "availability":
    print(
      db
        .prepare(
          `SELECT a.run_id, r.title AS run_title, a.user_id, u.first_name, u.last_name,
                  a.slots_json, a.slot_saved_at_json, a.updated_at, a.first_saved_at
           FROM availability a
           JOIN runs r ON r.id = a.run_id
           JOIN users u ON u.id = a.user_id
           ORDER BY a.run_id, a.user_id`
        )
        .all()
        .map(({ slots_json, slot_saved_at_json, ...row }) => ({
          ...row,
          slots: JSON.parse(slots_json || "[]"),
          slotSavedAt: parseSlotSavedAt(slot_saved_at_json),
        }))
    );
    break;
  case "june13":
    print(availabilityForDate("2026-06-13"));
    break;
  default: {
    const userMatch = /^user:(.+)$/i.exec(query);
    if (userMatch) {
      const key = userMatch[1].trim();
      const user = /^\d+$/.test(key)
        ? db
            .prepare(
              "SELECT id, first_name, last_name, email FROM users WHERE id = ?"
            )
            .get(Number(key))
        : db
            .prepare(
              `SELECT id, first_name, last_name, email FROM users
               WHERE LOWER(first_name) = LOWER(?) OR LOWER(email) = LOWER(?)
               LIMIT 1`
            )
            .get(key, key);
      if (!user) {
        console.error(`User not found: ${key}`);
        process.exit(1);
      }
      const rows = db
        .prepare(
          `SELECT a.run_id, r.title AS run_title, r.date_start, r.date_end,
                  a.slots_json, a.slot_saved_at_json, a.updated_at, a.first_saved_at
           FROM availability a
           JOIN runs r ON r.id = a.run_id
           WHERE a.user_id = ?
           ORDER BY a.run_id`
        )
        .all(user.id);
      print({
        user,
        availability: rows.map(
          ({ slots_json, slot_saved_at_json, ...row }) => ({
            ...row,
            slots: slotsWithSaveTimes(slots_json, slot_saved_at_json),
          })
        ),
      });
      break;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(query)) {
      print(availabilityForDate(query));
      break;
    }
    console.error(`Unknown query: ${query}`);
    console.error(
      "Usage: node scripts/railway-db-query.mjs [users|runs|members|availability|user:ID|user:email|booking|booking:RUN_ID|booking:YYYY-MM-DD|waitlist|waitlist:RUN_ID|june13|YYYY-MM-DD]"
    );
    process.exit(1);
  }
}

db.close();
