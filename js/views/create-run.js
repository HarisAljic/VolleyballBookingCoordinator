import { escapeHtml } from "../lib/html.js";
import { ALL_WEEKDAYS, WEEKDAY_LABELS, WEEKEND_ONLY_WEEKDAYS } from "../../run-weekdays.js";
import { layout, showToast } from "../layout.js";
import { refreshUser } from "../auth-nav.js";
import { state, setQuery } from "../state.js";
import { api } from "../api.js";
import { renderRunPage } from "./run.js";

export async function renderCreateRun() {
  await refreshUser();
  if (!state.user) {
    layout(
      "Create run",
      `
        <div class="mx-auto w-full max-w-md text-center">
          <p class="mb-4 text-slate-400">Sign in or create an account first.</p>
          <a href="/" class="inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Go home</a>
        </div>`,
      { variant: "form" }
    );
    return;
  }

  layout(
    "Create a custom run",
    `
      <p class="mb-6 text-slate-400">This is separate from the monthly default weekend run. Create one-off events, weekday leagues, or special schedules.</p>
      <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <form id="form-create-run" class="grid gap-4 sm:grid-cols-2">
          <label class="block sm:col-span-2">
            <span class="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Title</span>
            <input name="title" required class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-emerald-500/40 focus:ring-2" placeholder="Friday night competitive" />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">First day</span>
            <input name="dateStart" type="date" required class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-emerald-500/40 focus:ring-2" />
          </label>
          <label class="block sm:col-span-2">
            <span class="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Last day</span>
            <input name="dateEnd" type="date" required class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-emerald-500/40 focus:ring-2" />
          </label>
          <fieldset class="block sm:col-span-2">
            <legend class="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">Days of the week</legend>
            <div class="mb-3 flex flex-wrap gap-2">
              <button type="button" id="btn-days-weekends" class="rounded-lg border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-emerald-600/50 hover:bg-slate-700">Weekends (Fri–Sun)</button>
              <button type="button" id="btn-days-all" class="rounded-lg border border-slate-600 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-emerald-600/50 hover:bg-slate-700">All days</button>
            </div>
            <div class="flex flex-wrap gap-2">
              ${WEEKDAY_LABELS.map(
                (label, i) => `
              <label class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 has-[:checked]:border-emerald-600/70 has-[:checked]:bg-emerald-950/40 has-[:checked]:text-emerald-100">
                <input type="checkbox" name="weekday" value="${i}" checked class="rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500/40" />
                ${escapeHtml(label)}
              </label>`
              ).join("")}
            </div>
            <p class="mt-2 text-xs text-slate-500">Only these weekdays appear on the availability calendar.</p>
          </fieldset>
          <button type="submit" class="sm:col-span-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500">Create run</button>
        </form>
      </div>`,
    { variant: "app" }
  );

  const createRunForm = document.getElementById("form-create-run");
  const setWeekdayChecks = (allowed) => {
    const allow = new Set(allowed);
    createRunForm?.querySelectorAll('input[name="weekday"]').forEach((cb) => {
      cb.checked = allow.has(Number(cb.value));
    });
  };
  document.getElementById("btn-days-weekends")?.addEventListener("click", () => {
    setWeekdayChecks(WEEKEND_ONLY_WEEKDAYS);
  });
  document.getElementById("btn-days-all")?.addEventListener("click", () => {
    setWeekdayChecks(ALL_WEEKDAYS);
  });

  createRunForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const includedWeekdays = fd
      .getAll("weekday")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    if (!includedWeekdays.length) {
      showToast("Select at least one day of the week.", true);
      return;
    }
    try {
      const body = {
        title: fd.get("title"),
        dateStart: fd.get("dateStart"),
        dateEnd: fd.get("dateEnd"),
        includedWeekdays,
      };
      const created = await api("/api/runs", { method: "POST", body: JSON.stringify(body) });
      showToast(`Run created. Code ${created.runCode}`);
      setQuery({ run: created.shareToken });
      await renderRunPage();
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

