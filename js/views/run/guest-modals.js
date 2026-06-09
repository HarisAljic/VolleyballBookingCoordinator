import { api } from "../../api.js";
import { showToast } from "../../layout.js";
import { escapeHtml } from "../../lib/html.js";
import {
  contiguousHourRunsFromSorted,
  formatMemberAvailabilityRanges,
  formatMemberFreeWindowLine,
  groupSlotKeysByDay,
} from "../../lib/dates.js";
import { normalizeSlotKey, slotKeyFromDayStrAndHour } from "../../lib/slot-keys.js";

function hourOptions(selected) {
  const opts = [];
  for (let h = 6; h <= 23; h++) {
    const label =
      h === 12
        ? "12:00 PM"
        : h > 12
          ? `${h - 12}:00 PM`
          : `${h === 0 ? 12 : h}:00 AM`;
    opts.push(
      `<option value="${h}"${Number(selected) === h ? " selected" : ""}>${label}</option>`
    );
  }
  return opts.join("");
}

export function slotsFromDateTimeRange(dayStr, startHour, endHour) {
  const start = Number(startHour);
  const end = Number(endHour);
  if (!dayStr || Number.isNaN(start) || Number.isNaN(end) || end <= start) return [];
  const out = [];
  for (let h = start; h < end; h++) {
    const key = slotKeyFromDayStrAndHour(dayStr, h);
    if (key) out.push(key);
  }
  return out;
}

function availabilityRangeItems(slotKeys) {
  const keys = [...(slotKeys || [])]
    .map((x) => normalizeSlotKey(String(x)))
    .filter(Boolean)
    .sort();
  if (!keys.length) return [];
  const byDay = groupSlotKeysByDay(keys);
  const items = [];
  for (const day of [...byDay.keys()].sort()) {
    const dayKeys = [...(byDay.get(day) || [])].sort((a, b) => a.localeCompare(b));
    for (const run of contiguousHourRunsFromSorted(dayKeys)) {
      items.push({
        label: formatMemberFreeWindowLine(run),
        slotKeys: run,
      });
    }
  }
  return items;
}

function unionSlotKeys(...lists) {
  return [
    ...new Set(
      lists
        .flat()
        .map((s) => normalizeSlotKey(String(s)))
        .filter(Boolean)
    ),
  ];
}

function normalizeGuestNameForMatch(firstName, lastName) {
  const first = String(firstName || "").trim().toLowerCase();
  const last = String(lastName || "").trim().toLowerCase();
  return last ? `${first} ${last}` : first;
}

function guestDisplayLabel(guest) {
  const first = String(guest.firstName || guest.first_name || "").trim();
  const last = String(guest.lastName || guest.last_name || "").trim();
  return last ? `${first} ${last}` : first || guest.displayName || "Guest";
}

function findExistingGuestByName(guests, firstName, lastName) {
  const target = normalizeGuestNameForMatch(firstName, lastName);
  if (!target) return null;
  return (
    (guests || []).find(
      (g) => normalizeGuestNameForMatch(g.firstName, g.lastName) === target
    ) || null
  );
}

function ensureGuestModalsInDom() {
  if (document.getElementById("guest-add-dialog")) return;
  document.body.insertAdjacentHTML(
    "beforeend",
    `<dialog id="guest-add-dialog" class="w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-pink-800/50 bg-slate-900 p-0 text-slate-100 shadow-2xl backdrop:bg-black/60">
      <form id="guest-add-form" method="dialog" class="p-5">
        <h3 class="text-base font-semibold text-pink-100">Add +1</h3>
        <p class="mt-1 text-xs text-slate-400">Guest name and when they can play.</p>
        <label class="mt-4 block text-xs font-medium text-slate-400">Name</label>
        <input id="guest-add-name" type="text" required placeholder="Guest name" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500/50" />
        <p class="mt-4 text-xs font-medium text-slate-400">Availability</p>
        <label class="mt-2 block text-[11px] text-slate-500">Date</label>
        <input id="guest-add-date" type="date" required class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500/50" />
        <div class="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-slate-400">Start</label>
            <select id="guest-add-start" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100">${hourOptions(18)}</select>
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-400">End</label>
            <select id="guest-add-end" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100">${hourOptions(20)}</select>
          </div>
        </div>
        <p class="mt-2 text-[11px] text-slate-500">End time is exclusive (e.g. 6pm–8pm = two hours).</p>
        <button type="button" id="guest-add-range-btn" class="mt-3 w-full rounded-lg border border-pink-700 bg-pink-700/80 px-3 py-1.5 text-sm font-semibold text-pink-50 hover:bg-pink-600">Add time</button>
        <ul id="guest-add-ranges-list" class="mt-3 space-y-1.5 text-xs"></ul>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" id="guest-add-cancel" class="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
          <button type="submit" class="rounded-lg bg-pink-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-pink-600">Add +1</button>
        </div>
      </form>
    </dialog>
    <dialog id="guest-duplicate-dialog" class="w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-pink-800/50 bg-slate-900 p-0 text-slate-100 shadow-2xl backdrop:bg-black/60">
      <div class="p-5">
        <h3 class="text-base font-semibold text-pink-100">Same guest?</h3>
        <p id="guest-duplicate-message" class="mt-2 text-sm text-slate-300"></p>
        <div class="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" id="guest-duplicate-different" class="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">No, different person</button>
          <button type="button" id="guest-duplicate-same" class="rounded-lg bg-pink-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-pink-600">Yes, same person</button>
        </div>
      </div>
    </dialog>
    <dialog id="guest-manage-dialog" class="w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-pink-800/50 bg-slate-900 p-0 text-slate-100 shadow-2xl backdrop:bg-black/60">
      <div class="p-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-base font-semibold text-pink-100">Manage +1s</h3>
            <p class="mt-1 text-xs text-slate-400">Edit availability or remove guests you added.</p>
          </div>
          <button type="button" id="guest-manage-close" class="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800">Close</button>
        </div>
        <ul id="guest-manage-list" class="mt-4 max-h-[50vh] space-y-3 overflow-y-auto"></ul>
        <button type="button" id="guest-manage-add-another" class="mt-4 w-full rounded-lg border border-pink-700 bg-pink-700/80 px-3 py-2 text-sm font-semibold text-pink-50 hover:bg-pink-600">Add another +1</button>
      </div>
    </dialog>`
  );
}

function setGuestDateBounds(run, dateEl) {
  if (!(dateEl instanceof HTMLInputElement)) return;
  dateEl.min = run.dateStart || "";
  dateEl.max = run.dateEnd || "";
  if (!dateEl.value) dateEl.value = run.dateStart || "";
}

function readRangeFromInputs(dateEl, startEl, endEl) {
  if (
    !(dateEl instanceof HTMLInputElement) ||
    !(startEl instanceof HTMLSelectElement) ||
    !(endEl instanceof HTMLSelectElement)
  ) {
    return null;
  }
  const slots = slotsFromDateTimeRange(dateEl.value, startEl.value, endEl.value);
  if (!slots.length) return null;
  return {
    label: formatMemberAvailabilityRanges(slots)[0] || "Time range",
    slotKeys: slots,
  };
}

function renderPendingRangeItem(range, index) {
  return `<li class="flex items-center justify-between gap-2 rounded border border-pink-900/30 bg-pink-950/20 px-2 py-1.5" data-range-index="${index}">
    <span class="text-slate-300">${escapeHtml(range.label)}</span>
    <button type="button" class="guest-add-range-remove shrink-0 text-[11px] text-red-300 hover:text-red-200" data-range-index="${index}">Remove</button>
  </li>`;
}

function renderManageGuestItem(guest, run) {
  const ranges = availabilityRangeItems(guest.slots || []);
  const availHtml =
    ranges.length > 0
      ? ranges
          .map(
            (r, i) =>
              `<li class="flex items-center justify-between gap-2 text-slate-400" data-range-index="${i}">
                <span>${escapeHtml(r.label)}</span>
                <button type="button" class="guest-range-remove shrink-0 rounded border border-red-900/40 px-1.5 py-0.5 text-[10px] text-red-200 hover:bg-red-950/40" data-guest-id="${guest.id}" data-range-index="${i}">Remove</button>
              </li>`
          )
          .join("")
      : `<li class="text-slate-500">No availability set</li>`;
  return `<li class="rounded-lg border border-pink-900/40 bg-pink-950/20 p-3" data-guest-id="${guest.id}">
    <div class="flex items-start justify-between gap-2">
      <p class="text-sm font-medium text-pink-50">${escapeHtml(guest.displayName || guest.firstName)}</p>
      <button type="button" class="guest-remove-btn shrink-0 rounded border border-red-900/50 px-2 py-0.5 text-[11px] text-red-200 hover:bg-red-950/50" data-guest-id="${guest.id}">Remove</button>
    </div>
    <ul class="guest-range-list mt-2 space-y-1 text-xs">${availHtml}</ul>
    <form class="guest-add-range-form mt-3 space-y-2 border-t border-pink-900/30 pt-3" data-guest-id="${guest.id}">
      <p class="text-[11px] font-medium text-slate-500">Add time</p>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-[11px] text-slate-500">Date</label>
          <input type="date" class="guest-range-date w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs" min="${escapeHtml(run.dateStart || "")}" max="${escapeHtml(run.dateEnd || "")}" value="${escapeHtml(run.dateStart || "")}" required />
        </div>
        <div class="grid grid-cols-2 gap-1">
          <div>
            <label class="block text-[11px] text-slate-500">Start</label>
            <select class="guest-range-start w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs">${hourOptions(18)}</select>
          </div>
          <div>
            <label class="block text-[11px] text-slate-500">End</label>
            <select class="guest-range-end w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-xs">${hourOptions(20)}</select>
          </div>
        </div>
      </div>
      <button type="submit" class="rounded bg-pink-700 px-2 py-1 text-xs font-semibold text-white hover:bg-pink-600">Add time</button>
    </form>
  </li>`;
}

let guestModalBindingsAbort = null;

function bindDialogBackdropDismiss(dialog, onDismiss, signal) {
  dialog.addEventListener(
    "click",
    (e) => {
      if (e.target === dialog) onDismiss();
    },
    { signal }
  );
}

export function bindGuestModals({ token, run, renderRunPage }) {
  ensureGuestModalsInDom();
  guestModalBindingsAbort?.abort();
  guestModalBindingsAbort = new AbortController();
  const { signal } = guestModalBindingsAbort;

  const addDialog = document.getElementById("guest-add-dialog");
  const manageDialog = document.getElementById("guest-manage-dialog");
  const duplicateDialog = document.getElementById("guest-duplicate-dialog");
  const addForm = document.getElementById("guest-add-form");
  if (
    !(addDialog instanceof HTMLDialogElement) ||
    !(manageDialog instanceof HTMLDialogElement) ||
    !(duplicateDialog instanceof HTMLDialogElement)
  ) {
    return;
  }

  let pendingAddRanges = [];

  const renderPendingAddRanges = () => {
    const list = document.getElementById("guest-add-ranges-list");
    if (!list) return;
    list.innerHTML = pendingAddRanges
      .map((r, i) => renderPendingRangeItem(r, i))
      .join("");
  };

  const resetGuestAddForm = () => {
    pendingAddRanges = [];
    renderPendingAddRanges();
    const nameEl = document.getElementById("guest-add-name");
    if (nameEl instanceof HTMLInputElement) nameEl.value = "";
    const dateEl = document.getElementById("guest-add-date");
    if (dateEl instanceof HTMLInputElement) {
      setGuestDateBounds(run, dateEl);
    }
  };

  const openAddDialog = () => {
    resetGuestAddForm();
    addDialog.showModal();
  };

  const refreshManageList = () => {
    const list = document.getElementById("guest-manage-list");
    if (!list) return;
    const guests = run.viewerGuests || [];
    list.innerHTML =
      guests.length > 0
        ? guests.map((g) => renderManageGuestItem(g, run)).join("")
        : `<li class="text-sm text-slate-500">No +1s yet.</li>`;
  };

  const openManageDialog = () => {
    refreshManageList();
    manageDialog.showModal();
  };

  const collectAddFormSlots = () => {
    const dateEl = document.getElementById("guest-add-date");
    const startEl = document.getElementById("guest-add-start");
    const endEl = document.getElementById("guest-add-end");
    const current = readRangeFromInputs(dateEl, startEl, endEl);
    const fromPending = pendingAddRanges.flatMap((r) => r.slotKeys);
    const fromCurrent = current?.slotKeys || [];
    return unionSlotKeys(fromPending, fromCurrent);
  };

  const promptDuplicateGuest = (displayName) =>
    new Promise((resolve) => {
      const msg = document.getElementById("guest-duplicate-message");
      if (msg) {
        msg.textContent = `You already have a guest named ${displayName}. Is this the same person?`;
      }
      let settled = false;
      const finish = (choice) => {
        if (settled) return;
        settled = true;
        duplicateDialog.close();
        resolve(choice);
      };
      const onSame = () => finish("same");
      const onDifferent = () => finish("different");
      const onCancel = () => finish(null);
      document.getElementById("guest-duplicate-same")?.addEventListener("click", onSame, {
        once: true,
      });
      document.getElementById("guest-duplicate-different")?.addEventListener(
        "click",
        onDifferent,
        { once: true }
      );
      duplicateDialog.addEventListener("cancel", onCancel, { once: true });
      duplicateDialog.addEventListener(
        "click",
        (e) => {
          if (e.target === duplicateDialog) finish(null);
        },
        { once: true }
      );
      duplicateDialog.showModal();
    });

  const submitGuestAdd = async ({ firstName, lastName, slots, mergeIntoGuestId }) => {
    if (mergeIntoGuestId != null) {
      await api(`/api/runs/public/${encodeURIComponent(token)}/guests`, {
        method: "POST",
        body: JSON.stringify({ firstName, lastName, slots, mergeIntoGuestId }),
      });
      return "merged";
    }
    await api(`/api/runs/public/${encodeURIComponent(token)}/guests`, {
      method: "POST",
      body: JSON.stringify({ firstName, lastName, slots }),
    });
    return "created";
  };

  document.getElementById("btn-add-guest")?.addEventListener("click", openAddDialog, { signal });
  document.getElementById("btn-manage-guests")?.addEventListener("click", openManageDialog, {
    signal,
  });

  document.getElementById("guest-add-cancel")?.addEventListener(
    "click",
    () => {
      addDialog.close();
    },
    { signal }
  );

  bindDialogBackdropDismiss(addDialog, () => addDialog.close(), signal);
  bindDialogBackdropDismiss(manageDialog, () => manageDialog.close(), signal);

  document.getElementById("guest-add-range-btn")?.addEventListener(
    "click",
    () => {
      const dateEl = document.getElementById("guest-add-date");
      const startEl = document.getElementById("guest-add-start");
      const endEl = document.getElementById("guest-add-end");
      const range = readRangeFromInputs(dateEl, startEl, endEl);
      if (!range) {
        showToast("Pick a valid date and time range (end after start).", true);
        return;
      }
      pendingAddRanges.push(range);
      renderPendingAddRanges();
    },
    { signal }
  );

  document.getElementById("guest-add-ranges-list")?.addEventListener(
    "click",
    (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || !t.classList.contains("guest-add-range-remove")) return;
      const idx = Number(t.getAttribute("data-range-index"));
      if (!Number.isFinite(idx)) return;
      pendingAddRanges.splice(idx, 1);
      renderPendingAddRanges();
    },
    { signal }
  );

  addForm?.addEventListener(
    "submit",
    async (e) => {
      e.preventDefault();
      const nameEl = document.getElementById("guest-add-name");
      if (!(nameEl instanceof HTMLInputElement)) return;
      const { firstName, lastName } = parseGuestNameInput(nameEl.value);
      const slots = collectAddFormSlots();
      if (!slots.length) {
        showToast("Add at least one valid time range.", true);
        return;
      }

      const existing = findExistingGuestByName(run.viewerGuests, firstName, lastName);
      let mergeIntoGuestId = undefined;
      if (existing) {
        const choice = await promptDuplicateGuest(guestDisplayLabel(existing));
        if (!choice) return;
        if (choice === "same") mergeIntoGuestId = existing.id;
      }

      try {
        const result = await submitGuestAdd({
          firstName,
          lastName,
          slots,
          mergeIntoGuestId,
        });
        addDialog.close();
        showToast(result === "merged" ? "+1 availability merged." : "+1 added.");
        await renderRunPage();
      } catch (err) {
        showToast(err.message, true);
      }
    },
    { signal }
  );

  document.getElementById("guest-manage-close")?.addEventListener(
    "click",
    () => {
      manageDialog.close();
    },
    { signal }
  );

  document.getElementById("guest-manage-add-another")?.addEventListener(
    "click",
    () => {
      manageDialog.close();
      openAddDialog();
    },
    { signal }
  );

  manageDialog.addEventListener(
    "click",
    async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;

      if (t.classList.contains("guest-remove-btn")) {
        const guestId = Number(t.getAttribute("data-guest-id"));
        if (!Number.isFinite(guestId)) return;
        if (!window.confirm("Remove this +1?")) return;
        try {
          await api(
            `/api/runs/public/${encodeURIComponent(token)}/guests/${guestId}`,
            { method: "DELETE" }
          );
          showToast("+1 removed.");
          manageDialog.close();
          await renderRunPage();
        } catch (err) {
          showToast(err.message, true);
        }
        return;
      }

      if (t.classList.contains("guest-range-remove")) {
        const guestId = Number(t.getAttribute("data-guest-id"));
        const rangeIndex = Number(t.getAttribute("data-range-index"));
        if (!Number.isFinite(guestId) || !Number.isFinite(rangeIndex)) return;
        const guest = (run.viewerGuests || []).find((g) => g.id === guestId);
        if (!guest) return;
        const ranges = availabilityRangeItems(guest.slots || []);
        const range = ranges[rangeIndex];
        if (!range) return;
        try {
          const data = await api(`/api/runs/public/${encodeURIComponent(token)}/guests/${guestId}`, {
            method: "PATCH",
            body: JSON.stringify({ removeSlots: range.slotKeys }),
          });
          showToast(data.deleted ? "+1 removed (no availability left)." : "Time range removed.");
          await renderRunPage();
          if (data.deleted) manageDialog.close();
        } catch (err) {
          showToast(err.message, true);
        }
      }
    },
    { signal }
  );

  manageDialog.addEventListener(
    "submit",
    async (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement) || !form.classList.contains("guest-add-range-form")) {
        return;
      }
      e.preventDefault();
      const guestId = Number(form.getAttribute("data-guest-id"));
      const dateEl = form.querySelector(".guest-range-date");
      const startEl = form.querySelector(".guest-range-start");
      const endEl = form.querySelector(".guest-range-end");
      const range = readRangeFromInputs(dateEl, startEl, endEl);
      if (!range || !Number.isFinite(guestId)) {
        showToast("Pick a valid date and time range.", true);
        return;
      }
      try {
        await api(`/api/runs/public/${encodeURIComponent(token)}/guests/${guestId}`, {
          method: "PATCH",
          body: JSON.stringify({ appendSlots: range.slotKeys }),
        });
        showToast("Time range added.");
        await renderRunPage();
      } catch (err) {
        showToast(err.message, true);
      }
    },
    { signal }
  );

  if (manageDialog.open) refreshManageList();
}

function parseGuestNameInput(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}
