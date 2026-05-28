import { ROSTER_SIZES } from "../../../roster-tiers.js";

function rosterViewStorageKey(token) {
  return `vbRosterView_${token}`;
}

export function loadVisibleRosterSizes(token) {
  try {
    const raw = sessionStorage.getItem(rosterViewStorageKey(token));
    if (raw) {
      const arr = JSON.parse(raw);
      const valid = (Array.isArray(arr) ? arr : [])
        .map(Number)
        .filter((n) => ROSTER_SIZES.includes(n));
      if (valid.length) return valid;
    }
  } catch {
    /* ignore */
  }
  return [...ROSTER_SIZES];
}

export function saveVisibleRosterSizes(token, sizes) {
  try {
    sessionStorage.setItem(rosterViewStorageKey(token), JSON.stringify(sizes));
  } catch {
    /* ignore */
  }
}

export function memberRentalTagsHtml(waitlistedSizes, fitsSizes, visibleSizes = ROSTER_SIZES) {
  const vis = new Set(visibleSizes);
  const parts = [];
  for (const s of (waitlistedSizes || []).filter((n) => vis.has(n))) {
    parts.push(
      `<span class="rounded bg-amber-950/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100 ring-1 ring-amber-600/90">Waitlist · ${s}-man</span>`
    );
  }
  for (const s of (fitsSizes || []).filter((n) => vis.has(n))) {
    parts.push(
      `<span class="rounded bg-emerald-950/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100 ring-1 ring-emerald-600/90">Available · ${s}-man</span>`
    );
  }
  return parts.length
    ? `<span class="ml-2 flex flex-wrap items-center gap-1">${parts.join("")}</span>`
    : "";
}

export function renderRosterTargetsPanel(run, visibleRosterSizes) {
  const rosterCountFor = (size) => {
    const c = run.rosterCounts?.[size] ?? run.rosterCounts?.[String(size)];
    return c || { windows: 0, ready: false, target: size };
  };
  return `
      <div class="mb-6 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 class="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">Roster size view</h2>
        <p class="mb-3 text-xs text-slate-500">Toggle 12 / 18 / 24 to see bookable windows at each size (your view only).</p>
        <div id="roster-target-toggles" class="flex flex-wrap gap-3">
          ${ROSTER_SIZES.map((size) => {
            const c = rosterCountFor(size);
            const enabled = visibleRosterSizes.includes(size);
            const readyCls = c.ready
              ? "border-emerald-600/50 bg-emerald-950/30"
              : "border-slate-700 bg-slate-950";
            return `<label class="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${readyCls}">
              <input type="checkbox" class="roster-target-cb rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500/40" data-roster-size="${size}" ${
              enabled ? "checked" : ""
            } />
              <span class="font-medium text-slate-100">${size}-man</span>
              <span class="tabular-nums text-xs ${c.ready ? "text-emerald-300" : "text-slate-500"}">${c.windows} window${c.windows === 1 ? "" : "s"}</span>
            </label>`;
          }).join("")}
        </div>
      </div>`;
}
