import { chromium } from "playwright";

const SKEDDA_VENUES = [
  { id: "kings-oakville", name: "Kings Court Oakville", origin: "https://kingscourtoakville.skedda.com" },
  { id: "fitcourts-erin", name: "Fitcourts Erin Centre", origin: "https://fitcourts.skedda.com" },
  { id: "pakmen", name: "Pakmen Volleyball", origin: "https://pakmen.skedda.com" },
];

function parseWallIso(iso) {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/.exec(
      String(iso || "")
    );
  if (!m) return null;
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    da: Number(m[3]),
    hh: Number(m[4]),
    mm: Number(m[5]),
    ss: Number(m[6]),
  };
}

function msFromWallIso(iso) {
  const p = parseWallIso(iso);
  if (!p) return null;
  return Date.UTC(p.y, p.mo - 1, p.da, p.hh, p.mm, p.ss);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  const as = msFromWallIso(aStart);
  const ae = msFromWallIso(aEnd);
  const bs = msFromWallIso(bStart);
  const be = msFromWallIso(bEnd);
  if ([as, ae, bs, be].some((x) => x == null)) return false;
  return as < be && ae > bs;
}

function assetLabelText(a) {
  if (!a || typeof a !== "object") return "";
  const pieces = [];
  for (const k of Object.keys(a)) {
    const lk = String(k).toLowerCase();
    if (!/(name|nick|label|title|header|group|info|heading|short|column)/.test(lk)) continue;
    const v = a[k];
    if (typeof v === "string" && v.length && v.length < 400) pieces.push(v);
  }
  return pieces.join(" ").toLowerCase();
}

function isHalfCourtAsset(a) {
  return assetLabelText(a).includes("half");
}

/** Kings Court day view also lists sport-type rows (e.g. Basketball, Volleyball) — not bookable courts. */
function isKingsOakvilleVolleyballCourt(a) {
  return assetLabelText(a).includes("full court");
}

function isVolleyballBookableSpace(a, venueId) {
  if (venueId === "kings-oakville") return isKingsOakvilleVolleyballCourt(a);
  return !isHalfCourtAsset(a);
}

/** Bookable volleyball courts for a venue (half courts and non-court Skedda rows excluded). */
function collectVolleyballCourtSpaceIds(assets, venueId) {
  const ids = [];
  for (const a of assets || []) {
    if (a?.id == null || !isVolleyballBookableSpace(a, venueId)) continue;
    ids.push(String(a.id));
  }
  return [...new Set(ids)];
}

function isBlockingBooking(b) {
  // Pakmen (and some other venues) use type=1 for internal blocks; these DO block availability.
  // We treat type 0 and 1 as blocking; ignore unknown types only if they are explicitly non-blocking.
  const t = b?.type;
  if (t == null) return true;
  return t === 0 || t === 1;
}

function timePartFromWallIso(iso) {
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})/.exec(String(iso || ""));
  return m ? m[1] : "";
}

function withTimeOnDay(dayYmd, timeHms) {
  if (!dayYmd || !timeHms) return "";
  return `${dayYmd}T${timeHms}`;
}

function occurrenceWindowForDay(booking, dayYmd) {
  const startT = timePartFromWallIso(booking?.start);
  const endT = timePartFromWallIso(booking?.end);
  if (!startT || !endT) return null;
  const occStart = withTimeOnDay(dayYmd, startT);
  let occEnd = withTimeOnDay(dayYmd, endT);
  // If end time is earlier/equal (crosses midnight), push end to next day.
  if (msFromWallIso(occEnd) <= msFromWallIso(occStart)) {
    occEnd = withTimeOnDay(addLocalDaysYmd(dayYmd, 1), endT);
  }
  return { start: occStart, end: occEnd };
}

function daysCoveredByWindow(slotStartIso, slotEndIso) {
  const a = ymdFromWallIso(slotStartIso);
  const b = ymdFromWallIso(slotEndIso);
  if (!a || !b) return [];
  if (a === b) return [a];
  const out = [a];
  let cur = addLocalDaysYmd(a, 1);
  while (cur !== b) {
    out.push(cur);
    cur = addLocalDaysYmd(cur, 1);
  }
  out.push(b);
  return out;
}

/**
 * Skedda's bookingslists includes recurring booking SERIES, plus an index of which IDs occur on each day.
 * This expands only the days we need into concrete [start,end) occurrences for overlap checks.
 */
function bookingsOverlappingWindow(bookingsList, slotStartIso, slotEndIso) {
  const all = bookingsList?.bookings || [];
  const idx = bookingsList?.bookingslist?.idx || null;
  const byId = new Map();
  for (const b of all) {
    if (b?.id == null) continue;
    byId.set(String(b.id), b);
  }
  const days = daysCoveredByWindow(slotStartIso, slotEndIso);
  const out = [];
  const pushed = new Set();
  if (idx && days.length) {
    for (const day of days) {
      const ids = idx?.[day];
      if (!Array.isArray(ids)) continue;
      for (const rawId of ids) {
        const base = byId.get(String(rawId));
        if (!base) continue;
        const w = occurrenceWindowForDay(base, day);
        if (!w) continue;
        if (!overlaps(slotStartIso, slotEndIso, w.start, w.end)) continue;
        const key = `${base.id}:${w.start}:${w.end}`;
        if (pushed.has(key)) continue;
        pushed.add(key);
        out.push({ ...base, start: w.start, end: w.end });
      }
    }
    return out;
  }
  // Fallback: treat provided list as concrete instances.
  for (const b of all) {
    if (!b?.start || !b?.end) continue;
    if (!overlaps(slotStartIso, slotEndIso, b.start, b.end)) continue;
    out.push(b);
  }
  return out;
}

function spaceFreeForWindow(spaceId, bookings, windowStart, windowEnd) {
  for (const b of bookings || []) {
    if (!isBlockingBooking(b)) continue;
    if (!overlaps(windowStart, windowEnd, b.start, b.end)) continue;
    const spaces = (b.spaces || []).map(String);
    if (spaces.includes(spaceId)) return false;
  }
  return true;
}

/**
 * Skedda rejects ad-hoc API calls (422). We capture JSON from the SPA's own network responses.
 */
async function loadVenueData(page, origin) {
  let websJson = null;
  let bookingsList = null;
  let bookingsListUrl = null;

  const handler = async (res) => {
    const u = res.url();
    if (!u.startsWith(origin)) return;
    try {
      const ct = (res.headers()["content-type"] || "").toLowerCase();
      if (!ct.includes("json")) return;
      if (u.split("?")[0].endsWith("/webs") && res.status() === 200 && !websJson) {
        websJson = await res.json();
        return;
      }
      if (u.includes("/bookingslists") && res.status() === 200 && !bookingsList) {
        bookingsList = await res.json();
        bookingsListUrl = u;
      }
    } catch {
      /* ignore */
    }
  };

  page.on("response", handler);
  try {
    await page.goto(`${origin}/booking`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      if (websJson && bookingsList) break;
      await page.waitForTimeout(400);
    }
    if (!websJson) throw new Error("Timed out waiting for Skedda /webs (SPA).");
    if (!bookingsList) {
      throw new Error("Timed out waiting for Skedda bookingslists (SPA).");
    }
    let windowStart = null;
    let windowEnd = null;
    try {
      const parsed = new URL(bookingsListUrl);
      windowStart = parsed.searchParams.get("start");
      windowEnd = parsed.searchParams.get("end");
    } catch {
      /* ignore */
    }
    return { webs: websJson, bookingsList, windowStart, windowEnd };
  } finally {
    page.off("response", handler);
  }
}

function slotInsideWindow(slotStartIso, slotEndIso, winStart, winEnd) {
  if (!winStart || !winEnd) return true;
  return (
    msFromWallIso(slotStartIso) >= msFromWallIso(winStart) - 1 &&
    msFromWallIso(slotEndIso) <= msFromWallIso(winEnd) + 1
  );
}

function weekdayBitFromShort(wd) {
  const m = {
    Sun: 1,
    Mon: 2,
    Tue: 4,
    Wed: 8,
    Thu: 16,
    Fri: 32,
    Sat: 64,
  };
  return m[wd] || 0;
}

function minutesSinceMidnightWall(iso) {
  const p = parseWallIso(iso);
  if (!p) return null;
  return p.hh * 60 + p.mm;
}

function ymdFromWallIso(iso) {
  const p = parseWallIso(iso);
  if (!p) return "";
  const yy = String(p.y).padStart(4, "0");
  const mm = String(p.mo).padStart(2, "0");
  const dd = String(p.da).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function addLocalDaysYmd(ymdStr, delta) {
  const [y, mo, da] = String(ymdStr).split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1, da, 12, 0, 0));
  d.setDate(d.getDate() + delta);
  const yy = String(d.getFullYear()).padStart(4, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function weekdayShortFromYmd(ymdStr) {
  const [y, mo, da] = String(ymdStr).split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1, da, 12, 0, 0));
  const wd = d.getUTCDay(); // 0=Sun
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][wd] || "Sun";
}

/**
 * Splits a wall-clock window into per-day segments (weekday computed in UTC from date parts).
 * Returns [{ ymd, weekdayBit, startMin, endMin }], endMin exclusive.
 */
function windowSegmentsWall(slotStartIso, slotEndIso) {
  const aYmd = ymdFromWallIso(slotStartIso);
  const bYmd = ymdFromWallIso(slotEndIso);
  const aMin = minutesSinceMidnightWall(slotStartIso);
  const bMin = minutesSinceMidnightWall(slotEndIso);
  if (aMin == null || bMin == null) return [];
  const out = [];
  if (aYmd === bYmd) {
    out.push({
      ymd: aYmd,
      weekdayBit: weekdayBitFromShort(weekdayShortFromYmd(aYmd)),
      startMin: aMin,
      endMin: bMin,
    });
    return out;
  }
  // Multi-day (rare for 2–4h windows, but handle safely)
  out.push({
    ymd: aYmd,
    weekdayBit: weekdayBitFromShort(weekdayShortFromYmd(aYmd)),
    startMin: aMin,
    endMin: 1440,
  });
  // intermediate full days
  let cur = addLocalDaysYmd(aYmd, 1);
  while (cur !== bYmd) {
    out.push({
      ymd: cur,
      weekdayBit: weekdayBitFromShort(weekdayShortFromYmd(cur)),
      startMin: 0,
      endMin: 1440,
    });
    cur = addLocalDaysYmd(cur, 1);
  }
  out.push({
    ymd: bYmd,
    weekdayBit: weekdayBitFromShort(weekdayShortFromYmd(bYmd)),
    startMin: 0,
    endMin: bMin,
  });
  return out;
}

function ruleAppliesToSpace(rule, spaceId) {
  if (!rule) return false;
  if (rule.spaceIds == null) return true;
  if (!Array.isArray(rule.spaceIds) || rule.spaceIds.length === 0) return false;
  return rule.spaceIds.map(String).includes(String(spaceId));
}

function spaceWithinHoursOfAvailability(spaceId, hoursOfAvailability, slotStartIso, slotEndIso) {
  const rules = hoursOfAvailability?.rules;
  if (!Array.isArray(rules) || rules.length === 0) return true; // can't validate; don't block
  const segs = windowSegmentsWall(slotStartIso, slotEndIso);
  if (!segs.length) return true;
  for (const seg of segs) {
    const ok = rules.some((r) => {
      if (!ruleAppliesToSpace(r, spaceId)) return false;
      const mask = Number(r.daysBitmask);
      if (!mask || (mask & seg.weekdayBit) === 0) return false;
      const rs = Number(r.start);
      const re = Number(r.end);
      if (Number.isNaN(rs) || Number.isNaN(re)) return false;
      return rs <= seg.startMin && re >= seg.endMin;
    });
    if (!ok) return false;
  }
  return true;
}

/**
 * @param {string} slotStartIso
 * @param {string} slotEndIso
 */
export async function checkSkeddaVenues(slotStartIso, slotEndIso) {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const venue of SKEDDA_VENUES) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const venueResult = {
        venueId: venue.id,
        name: venue.name,
        bookingUrl: `${venue.origin}/booking`,
        ok: false,
        error: null,
        freeSpaceIds: [],
        totalSpaces: 0,
        skeddaLoadedRange: null,
        slotOutsideLoadedRange: false,
      };
      try {
        const { webs, bookingsList, windowStart, windowEnd } = await loadVenueData(
          page,
          venue.origin
        );
        venueResult.skeddaLoadedRange = { start: windowStart, end: windowEnd };
        const inside = slotInsideWindow(slotStartIso, slotEndIso, windowStart, windowEnd);
        venueResult.slotOutsideLoadedRange = !inside;

        const venueCfg = Array.isArray(webs?.venue) ? webs.venue[0] : null;
        const hoursAvail = venueCfg?.hoursOfAvailability || null;

        // Venue-specific guard: Pakmen frequently looks "free" before their actual bookable start time.
        // Skedda's bookings list can be empty during closed hours, which our booking-overlap logic
        // would otherwise treat as available.
        if (venue.id === "pakmen") {
          const startMin = minutesSinceMidnightWall(slotStartIso);
          if (startMin != null && startMin < 20 * 60) {
            venueResult.ok = true;
            venueResult.hasAvailableCourt = false;
            venueResult.note = "Outside Pakmen's bookable hours (often starts at 8:00pm local).";
            venueResult.freeSpaceIds = [];
            venueResult.totalSpaces = 0;
            results.push(venueResult);
            await context.close();
            continue;
          }
        }

        let spaceIds = collectVolleyballCourtSpaceIds(webs?.assets, venue.id);
        if (hoursAvail) {
          spaceIds = spaceIds.filter((id) =>
            spaceWithinHoursOfAvailability(id, hoursAvail, slotStartIso, slotEndIso)
          );
        }
        const bookings = bookingsOverlappingWindow(bookingsList, slotStartIso, slotEndIso);
        venueResult.totalSpaces = spaceIds.length;

        if (!inside) {
          venueResult.ok = true;
          venueResult.hasAvailableCourt = null;
          venueResult.note =
            "Your time is outside the date range Skedda loaded in this session. Open the venue link and navigate to that week, or run the check again after Skedda expands its window.";
          venueResult.freeSpaceIds = [];
        } else if (spaceIds.length === 0) {
          venueResult.ok = true;
          venueResult.hasAvailableCourt = false;
          venueResult.note =
            "No full-size courts are bookable for the entire requested time window (outside the venue's hours of availability).";
          venueResult.freeSpaceIds = [];
        } else {
          venueResult.freeSpaceIds = spaceIds.filter((id) =>
            spaceFreeForWindow(id, bookings, slotStartIso, slotEndIso)
          );
          venueResult.ok = true;
          venueResult.hasAvailableCourt = venueResult.freeSpaceIds.length > 0;
        }
      } catch (e) {
        venueResult.error = e instanceof Error ? e.message : String(e);
      }
      results.push(venueResult);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  return results;
}

export { SKEDDA_VENUES };
