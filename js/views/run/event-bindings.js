import { api } from "../../api.js";
import { showToast } from "../../layout.js";
import { setQuery } from "../../state.js";
import { escapeHtml } from "../../lib/html.js";
import {
  computeDisplayLockCount,
  formatSlotKeyForDisplay,
  formatTimeHmLower,
  ordinalDay,
  parseSlotKeyToDate,
  slotKeyDayStr,
} from "../../lib/dates.js";
import { skeddaVenueHref } from "../../lib/skedda.js";
import { ROSTER_SIZES } from "../../../roster-tiers.js";
import { saveVisibleRosterSizes } from "./roster-view.js";
import { clearViewerSlotDraft } from "./viewer-slots.js";
import { bindGuestModals } from "./guest-modals.js";
import { bindMemberTiles } from "./members-panel.js";

export function bindRunPageEvents(ctx, { renderRunPage, goHome }) {
  const {
    token,
    run,
    selected,
    viewerCanPick,
    lockCount,
    rosterSz,
    activeRosterCount,
  } = ctx;

  const updateAvailLockCounterUi = () => {
    const el = document.getElementById("avail-lock-counter");
    if (el) el.textContent = String(computeDisplayLockCount(run, selected));
  };

  const slotsByUserId = new Map();
  for (const m of run.memberAvailability || []) {
    slotsByUserId.set(Number(m.userId), m.slots || []);
  }
  const { refreshViewerTile } = bindMemberTiles({ run, selected, slotsByUserId });
  bindGuestModals({ token, run, renderRunPage });

  const updateViewerAvailabilityUi = () => {
    refreshViewerTile();
  };

  document.getElementById("btn-copy-link")?.addEventListener("click", () => {
    const url = `${window.location.origin}/?run=${encodeURIComponent(token)}`;
    navigator.clipboard.writeText(url).then(() => showToast("Link copied"));
  });

  document.querySelectorAll(".roster-target-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      const checked = [...document.querySelectorAll(".roster-target-cb:checked")]
        .map((el) => Number(el.getAttribute("data-roster-size")))
        .filter((n) => ROSTER_SIZES.includes(n));
      if (!checked.length) {
        cb.checked = true;
        showToast("Show at least one roster size.", true);
        return;
      }
      saveVisibleRosterSizes(token, checked);
      void renderRunPage();
    });
  });

  document.getElementById("btn-leave-run")?.addEventListener("click", async () => {
    if (
      !window.confirm(
        "Leave this run? Your saved availability for it will be removed. If you are the last member, the whole run is deleted."
      )
    ) {
      return;
    }
    try {
      const data = await api(`/api/runs/public/${encodeURIComponent(token)}/leave`, {
        method: "POST",
      });
      showToast(
        data.runDeleted
          ? "You left. The run was removed (no members left)."
          : "You left this run."
      );
      clearViewerSlotDraft(token);
      setQuery({});
      await goHome();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.querySelectorAll(".btn-check-block").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const out = document.getElementById("court-results");
      const slotStart = btn.getAttribute("data-slot-start") || "";
      const slotEnd = btn.getAttribute("data-slot-end") || "";
      const rosterSize = Number(btn.getAttribute("data-roster-size")) || undefined;
      if (!slotStart || !slotEnd) return;
      const hs = parseSlotKeyToDate(slotStart);
      const he = parseSlotKeyToDate(slotEnd);
      const durH =
        hs && he ? Math.max(1, Math.round((he.getTime() - hs.getTime()) / 3600000)) : 1;
      const human =
        hs && he
          ? `${hs.toLocaleString(undefined, { month: "long" })} ${ordinalDay(
              hs.getDate()
            )}, ${formatTimeHmLower(hs)}–${formatTimeHmLower(he)} (${durH}h)`
          : `${formatSlotKeyForDisplay(slotStart)} (${durH}h)`;
      if (out) {
        out.innerHTML = `<div class="text-slate-400">Checking <span class="text-slate-200">${escapeHtml(
          human
        )}</span>… (may take ~30s)</div>`;
      }
      try {
        const data = await api(`/api/runs/public/${encodeURIComponent(token)}/check-courts`, {
          method: "POST",
          body: JSON.stringify({ slotStart, slotEnd, rosterSize }),
        });
        const dayStr = slotKeyDayStr(slotStart);
        const lines = (data.venues || []).map((v) => {
          if (!v.ok) {
            return `<div class="mb-1">${escapeHtml(v.name)}: error (${escapeHtml(v.error || "?")})</div>`;
          }
          if (v.hasAvailableCourt == null && v.note) {
            return `<div class="mb-1">${escapeHtml(v.name)}: ${escapeHtml(v.note)}</div>`;
          }
          if (v.hasAvailableCourt) {
            let href = v.bookingUrl || "";
            try {
              const origin = href ? new URL(href).origin : "";
              href = origin ? skeddaVenueHref(origin, dayStr) : href;
            } catch {
              /* ignore */
            }
            return `<div class="mb-1"><a class="text-emerald-400 hover:underline" href="${escapeHtml(
              href
            )}" target="_blank" rel="noopener">${escapeHtml(
              v.name
            )}</a>: looks free for the full window (${v.freeSpaceIds?.length ?? 0}/${v.totalSpaces ?? 0} spaces free)</div>`;
          }
          return `<div class="mb-1">${escapeHtml(
            v.name
          )}: not free for the full window (${v.freeSpaceIds?.length ?? 0}/${v.totalSpaces ?? 0} spaces free)</div>`;
        });
        if (out) {
          out.innerHTML = lines.join("") || `<div class="text-slate-500">No results.</div>`;
        }
      } catch (err) {
        if (out) out.textContent = err.message;
        showToast(err.message, true);
      }
    });
  });

  document.getElementById("btn-save-av")?.addEventListener("click", async () => {
    const beforeLock = lockCount;
    try {
      const data = await api(`/api/runs/public/${encodeURIComponent(token)}/availability`, {
        method: "PUT",
        body: JSON.stringify({ slots: [...selected].sort() }),
      });
      const after =
        typeof data.membersWithAvailability === "number"
          ? data.membersWithAvailability
          : beforeLock;
      showToast(
        after > beforeLock
          ? `Availability saved. ${after} of ${data.rosterSize ?? rosterSz} roster members have locked in.`
          : "Availability saved."
      );
      clearViewerSlotDraft(token);
      await renderRunPage();
      const el = document.getElementById("avail-lock-counter");
      if (el && after > beforeLock) {
        el.classList.add("transition", "text-emerald-300");
        requestAnimationFrame(() => {
          el.classList.add("scale-110", "inline-block");
          setTimeout(() => {
            el.classList.remove("scale-110", "inline-block", "text-emerald-300");
          }, 450);
        });
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });

  return {
    updateAvailLockCounterUi,
    updateViewerAvailabilityUi,
  };
}
