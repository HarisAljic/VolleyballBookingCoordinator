import { normalizeSlotKey } from "./slot-keys.js";

export function otherTeammateCountAtSlot(iso, memberAvailability, viewerId) {
  const key = normalizeSlotKey(iso);
  let n = 0;
  const vid = viewerId != null && viewerId !== "" ? Number(viewerId) : null;
  for (const m of memberAvailability || []) {
    if (vid != null && !Number.isNaN(vid) && Number(m.userId) === vid) continue;
    for (const raw of m.slots || []) {
      if (normalizeSlotKey(String(raw)) === key) {
        n++;
        break;
      }
    }
  }
  return n;
}

/**
 * Teammates on server excluding you, plus +1 locally if you toggled this hour on
 * (and after Save, because you are in the overlap once saved).
 */
export function displayOthersCountAtSlot(iso, memberAvailability, viewerId, viewerPicksOnGrid, selected) {
  const key = normalizeSlotKey(iso);
  const oc = otherTeammateCountAtSlot(iso, memberAvailability, viewerId);
  if (!viewerPicksOnGrid || viewerId == null) return oc;
  return selected.has(key) ? oc + 1 : oc;
}

export function slotCellClass(iso, selected, displayedCount, rosterCapacity) {
  const mine = selected.has(normalizeSlotKey(iso));
  const cap = Number(rosterCapacity);
  const atRosterCap = Number.isFinite(cap) && cap > 0 && displayedCount >= cap;
  const base =
    "slot-cell relative flex h-10 w-full items-center justify-center rounded text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ";
  if (atRosterCap && mine) {
    return (
      base +
      "border-2 border-amber-300 bg-amber-600 text-amber-50 shadow-inner shadow-amber-900/30 hover:bg-amber-500"
    );
  }
  if (atRosterCap) {
    return (
      base +
      "border border-amber-500/85 bg-amber-900/90 text-amber-100 hover:bg-amber-800/95"
    );
  }
  if (mine && displayedCount > 0) return base + "border-2 border-sky-400 bg-emerald-600 text-white";
  if (mine) return base + "bg-emerald-600 text-white";
  if (displayedCount >= 8) return base + "bg-sky-500 text-white hover:bg-sky-400";
  if (displayedCount >= 4) return base + "bg-sky-700 text-sky-100 hover:bg-sky-600";
  if (displayedCount >= 1) return base + "bg-sky-900 text-sky-200 hover:bg-sky-800";
  return base + "bg-slate-800/80 text-slate-500 hover:bg-slate-700";
}

export function slotCellClassOutOfRunRange() {
  return "slot-cell relative flex h-10 w-full cursor-not-allowed items-center justify-center rounded border border-dashed border-slate-800/90 bg-slate-950/60 text-xs text-slate-600 opacity-70";
}

export function syncSlotCell(
  el,
  iso,
  selected,
  serverMemberAvailability,
  viewerId,
  hourLabel,
  inRunRange,
  viewerPicksOnGrid,
  rosterCapacity
) {
  if (!inRunRange) {
    el.className = slotCellClassOutOfRunRange();
    const b = el.querySelector("[data-oth]");
    if (b) b.remove();
    let lab = el.querySelector("[data-hour]");
    if (!lab) {
      lab = document.createElement("span");
      lab.setAttribute("data-hour", "1");
      lab.className = "pointer-events-none text-slate-600";
      el.appendChild(lab);
    }
    lab.textContent = "—";
    return;
  }
  const shown = displayOthersCountAtSlot(
    iso,
    serverMemberAvailability,
    viewerId,
    viewerPicksOnGrid,
    selected
  );
  const capN = Number(rosterCapacity);
  const atCap = Number.isFinite(capN) && capN > 0 && shown >= capN;
  el.className = slotCellClass(iso, selected, shown, rosterCapacity);
  let badge = el.querySelector("[data-oth]");
  if (shown > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.setAttribute("data-oth", "1");
      badge.className =
        "pointer-events-none absolute right-0.5 top-0.5 min-w-[1rem] rounded px-0.5 text-center text-[10px] font-bold leading-none shadow-sm text-white ring-1 ring-black/25";
      el.insertBefore(badge, el.firstChild);
    }
    badge.textContent = String(shown);
    badge.className = atCap
      ? "pointer-events-none absolute right-0.5 top-0.5 min-w-[1rem] rounded bg-amber-500 px-0.5 text-center text-[10px] font-bold leading-none shadow-sm text-white ring-1 ring-amber-950/60"
      : "pointer-events-none absolute right-0.5 top-0.5 min-w-[1rem] rounded bg-sky-500 px-0.5 text-center text-[10px] font-bold leading-none shadow-sm text-white ring-1 ring-black/25";
  } else if (badge) {
    badge.remove();
  }
  let lab = el.querySelector("[data-hour]");
  if (!lab) {
    lab = document.createElement("span");
    lab.setAttribute("data-hour", "1");
    lab.className = "pointer-events-none";
    el.appendChild(lab);
  }
  lab.textContent = String(hourLabel);
}
