import { addDaysToDayStr } from "./dates.js";
import { escapeHtml } from "./html.js";

export const SKEDDA_VIEW_RANGE_DAYS = 36;

export const SKEDDA_VENUES = [
  { label: "Kings Court Oakville", origin: "https://kingscourtoakville.skedda.com" },
  { label: "Fitcourts Erin Centre", origin: "https://fitcourts.skedda.com" },
  { label: "Pakmen Volleyball", origin: "https://pakmen.skedda.com" },
];

export function skeddaVenueHref(origin, viewDateStr) {
  if (!viewDateStr) return `${origin}/booking`;
  const viewEndStr = addDaysToDayStr(viewDateStr, SKEDDA_VIEW_RANGE_DAYS);
  return `${origin}/booking?${new URLSearchParams({
    viewdate: viewDateStr,
    viewend: viewEndStr,
  }).toString()}`;
}

export function renderSkeddaDateLinksHtml(viewDateStr) {
  if (!viewDateStr) return "";
  return SKEDDA_VENUES.map((v) => {
    const href = skeddaVenueHref(v.origin, viewDateStr);
    return `<a class="text-emerald-400 hover:underline" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(v.label)}</a>`;
  }).join('<span class="text-slate-600"> · </span>');
}
