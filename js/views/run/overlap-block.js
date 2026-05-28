import { renderOverlapBlockSummary } from "../../lib/overlap-ui.js";

export function buildOverlapBlockHtml(run, hasBookingRentals) {
  let overlapBlock = "";
  if (run.overlapSlots?.length) {
    overlapBlock = renderOverlapBlockSummary(run.overlapSlots);
  } else if (run.isFull) {
    overlapBlock = run.schedulingWaitlistActive
      ? `<p class="mt-2 text-sm text-amber-400/90">Active roster is full; everyone on it must save availability before a shared grid appears.</p>`
      : `<p class="mt-2 text-sm text-amber-400/90">More than a full roster is still scheduling. Everyone must save overlapping hours until a shared <strong>2+ hour</strong> window exists across <em>all</em> joiners — then extras move to the waitlist.</p>`;
  }
  if (hasBookingRentals && !run.overlapSlots?.length) {
    overlapBlock += `<p class="mt-3 rounded border border-violet-900/35 bg-violet-950/20 px-3 py-2 text-sm text-slate-200">No hour is shared by <em>every</em> person universally — if <strong>Roster windows</strong> (Skedda panel) lists times, each is bookable for your full run size.</p>`;
  }
  return overlapBlock;
}
