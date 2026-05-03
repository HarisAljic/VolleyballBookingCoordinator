import { escapeHtml } from "../lib/html.js";
import { layout, showToast } from "../layout.js";
import { refreshUser } from "../auth-nav.js";
import { state, setQuery } from "../state.js";
import { api } from "../api.js";
import { renderRunPage } from "./run.js";

export async function renderHome() {
  await refreshUser();
  if (state.user) {
    let runs = [];
    try {
      const data = await api("/api/runs/mine", { method: "GET" });
      runs = data.runs || [];
    } catch {
      runs = [];
    }
    const statusCell = (r) => {
      const chips = [];
      if (r.runFound) {
        chips.push(
          '<span class="inline-flex whitespace-nowrap rounded-full border border-emerald-500/60 bg-emerald-950/90 px-2 py-0.5 text-[11px] font-medium leading-tight text-emerald-100">Run found</span>'
        );
      }
      if (r.acceptingPlayers) {
        chips.push(
          '<span class="inline-flex whitespace-nowrap rounded-full border border-sky-500/80 bg-sky-900 px-2 py-0.5 text-[11px] font-medium leading-tight text-sky-100 shadow-inner shadow-sky-950/30">Accepting players</span>'
        );
      }
      const inner =
        chips.length > 0
          ? `<span class="flex flex-wrap items-center gap-1.5">${chips.join("")}</span>`
          : '<span class="text-slate-600">—</span>';
      return inner;
    };
    const rows = runs
      .map(
        (r) => `
        <tr>
          <td class="px-4 py-3 align-middle font-medium text-slate-200">${escapeHtml(r.title)}</td>
          <td class="px-4 py-3 align-middle tabular-nums text-slate-400">${r.member_count}/${r.capacity}</td>
          <td class="px-4 py-3 align-middle">${statusCell(r)}</td>
          <td class="px-4 py-3 align-middle text-right">
            <a class="text-emerald-400 hover:text-emerald-300" href="${escapeHtml(r.publicUrl || "#")}">Open run</a>
          </td>
        </tr>`
      )
      .join("");
    layout("Your runs", `
        <p class="mb-6 text-slate-400">Create a run, share the code or link, then check Skedda venues when the roster is full.</p>
        <div class="mb-10 rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 class="mb-4 text-lg font-semibold text-white">New run</h2>
          <form id="form-create-run" class="grid gap-4 sm:grid-cols-2">
            <label class="block sm:col-span-2">
              <span class="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Title</span>
              <input name="title" required class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-emerald-500/40 focus:ring-2" placeholder="Friday night competitive" />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Roster size</span>
              <select name="capacity" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-emerald-500/40 focus:ring-2">
                <option value="12">12 players</option>
                <option value="18">18 players</option>
                <option value="24">24 players</option>
              </select>
            </label>
            <div class="hidden sm:block"></div>
            <label class="block">
              <span class="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">First day</span>
              <input name="dateStart" type="date" required class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-emerald-500/40 focus:ring-2" />
            </label>
            <label class="block">
              <span class="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Last day</span>
              <input name="dateEnd" type="date" required class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-emerald-500/40 focus:ring-2" />
            </label>
            <button type="submit" class="sm:col-span-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500">Create run</button>
          </form>
        </div>
        <div class="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
          <table class="w-full border-collapse text-left text-sm">
            <thead class="border-b border-slate-800 bg-slate-800/50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" class="px-4 py-3 align-middle font-medium">Run</th>
                <th scope="col" class="px-4 py-3 align-middle font-medium">Roster</th>
                <th scope="col" class="px-4 py-3 align-middle font-medium">Status</th>
                <th scope="col" class="px-4 py-3 align-middle text-right font-medium">Link</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800">${rows || `<tr><td colspan="4" class="px-4 py-6 text-slate-500">No runs yet.</td></tr>`}</tbody>
          </table>
        </div>`,
      { variant: "app" }
    );
    document.getElementById("form-create-run")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const body = {
          title: fd.get("title"),
          capacity: Number(fd.get("capacity")),
          dateStart: fd.get("dateStart"),
          dateEnd: fd.get("dateEnd"),
        };
        const created = await api("/api/runs", { method: "POST", body: JSON.stringify(body) });
        showToast(`Run created. Code ${created.runCode}`);
        setQuery({ run: created.shareToken });
        await renderRunPage();
      } catch (err) {
        showToast(err.message, true);
      }
    });
    return;
  }

  layout("Volleyball run scheduler", `
      <p class="mb-8 text-slate-400">Coordinate a full roster, collect availability on a calendar, then probe Kings Court Oakville, Fitcourts Erin Centre, and Pakmen Skedda pages for a free court at your shared time.</p>
      <div class="grid gap-8 lg:grid-cols-2">
        <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 class="mb-4 text-lg font-semibold text-white">Create account</h2>
          <form id="form-register" class="space-y-3">
            <input name="firstName" required placeholder="First name" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/40" />
            <input name="lastName" required placeholder="Last name" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/40" />
            <input name="email" type="email" required placeholder="Email" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/40" />
            <input name="password" type="password" required minlength="8" placeholder="Password (8+ chars)" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/40" />
            <button type="submit" class="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">Register</button>
          </form>
        </div>
        <div class="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 class="mb-4 text-lg font-semibold text-white">Sign in</h2>
          <form id="form-login" class="space-y-3">
            <input name="email" type="email" required placeholder="Email" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/40" />
            <input name="password" type="password" required placeholder="Password" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/40" />
            <button type="submit" class="w-full rounded-lg border border-slate-600 bg-slate-800 py-2.5 text-sm font-semibold text-slate-100 hover:bg-slate-700">Sign in</button>
          </form>
        </div>
      </div>`,
    { variant: "app" }
  );

  document.getElementById("form-register")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          firstName: fd.get("firstName"),
          lastName: fd.get("lastName"),
          email: fd.get("email"),
          password: fd.get("password"),
        }),
      });
      showToast("Welcome! You are signed in.");
      await renderHome();
    } catch (err) {
      showToast(err.message, true);
    }
  });
  document.getElementById("form-login")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
      });
      showToast("Signed in.");
      await renderHome();
    } catch (err) {
      showToast(err.message, true);
    }
  });
}
