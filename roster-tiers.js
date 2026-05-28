/** Supported roster sizes (court booking tiers). */
export const ROSTER_SIZES = [12, 18, 24];

const BOOKING_HOURS_BY_SIZE = { 12: 2, 18: 3, 24: 4 };

/** Contiguous booking length required for each roster size. */
export function bookingDurationHoursForSize(rosterSize) {
  const n = Number(rosterSize);
  return BOOKING_HOURS_BY_SIZE[n] ?? 2;
}

const DEFAULT_TARGETS = [12, 18, 24];

export function parseRosterTargets(value) {
  if (value == null) return [...DEFAULT_TARGETS];
  let arr = value;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return [...DEFAULT_TARGETS];
    try {
      arr = JSON.parse(t);
    } catch {
      return [...DEFAULT_TARGETS];
    }
  }
  if (!Array.isArray(arr)) return [...DEFAULT_TARGETS];
  const out = new Set();
  for (const n of arr) {
    const s = Number(n);
    if (ROSTER_SIZES.includes(s)) out.add(s);
  }
  const sorted = ROSTER_SIZES.filter((s) => out.has(s));
  return sorted.length ? sorted : [12];
}

export function serializeRosterTargets(targets) {
  return JSON.stringify(parseRosterTargets(targets));
}

/** First N members in join order (used when scheduling lock limits coalition size). */
export function activeRosterUserIdsFromOrdered(orderedIds, size) {
  return orderedIds.slice(0, size);
}

export function activeCountForSize(orderedIds, size) {
  return Math.min(orderedIds.length, size);
}

/** Bookable rental-option groups per roster size (visibility toggles on the run page). */
export function rosterWindowCountsBySize(groupsBySize) {
  const counts = {};
  for (const size of ROSTER_SIZES) {
    const groups = groupsBySize?.[size] ?? groupsBySize?.[String(size)] ?? [];
    const n = Array.isArray(groups)
      ? groups.reduce((sum, dg) => sum + (dg.options?.length || 0), 0)
      : 0;
    counts[size] = {
      windows: n,
      target: size,
      ready: n > 0,
    };
  }
  return counts;
}

/** Largest enabled target (legacy DB capacity / heatmap default). */
export function maxEnabledRosterTarget(targets) {
  const t = parseRosterTargets(targets);
  return t.length ? Math.max(...t) : 24;
}

export function schedulingMemberThreshold() {
  return 24;
}
