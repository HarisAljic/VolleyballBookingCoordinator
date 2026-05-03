import { escapeHtml } from "../lib/html.js";
import { layout, showToast } from "../layout.js";
import { refreshUser } from "../auth-nav.js";
import { state, setQuery } from "../state.js";
import { api } from "../api.js";
import { renderRunPage } from "./run.js";
import { notifySidebarNavigated } from "../sidebar-nav.js";

export async function renderJoin() {
  await refreshUser();
  if (!state.user) {
    layout(
      "Join a run",
      `
        <div class="mx-auto w-full max-w-md text-center">
          <p class="mb-4 text-slate-400">Sign in or create an account first.</p>
          <a href="/" class="inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Go home</a>
        </div>`,
      { variant: "form" }
    );
    return;
  }
  const pre = state.joinCode ? ` value="${escapeHtml(state.joinCode)}"` : "";
  layout("Join with run code", `
      <div class="mx-auto w-full max-w-md text-center">
        <p class="mb-6 text-slate-400">Ask the organizer for the six-character code.</p>
        <form id="form-join" class="mx-auto flex w-full max-w-sm flex-col items-center gap-4">
          <input name="code" required maxlength="8" placeholder="e.g. ABC12X" class="w-full uppercase rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-center text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/40"${pre} />
          <button type="submit" class="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 sm:w-auto sm:min-w-[10rem]">Join run</button>
        </form>
      </div>`,
    { variant: "form" }
  );
  document.getElementById("form-join")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const code = String(fd.get("code") || "").trim().toUpperCase();
    try {
      const data = await api("/api/runs/join-by-code", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      showToast("You are in this run.");
      setQuery({ run: data.shareToken });
      notifySidebarNavigated();
      await renderRunPage();
    } catch (err) {
      showToast(err.message, true);
    }
  });
}
