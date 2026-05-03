import { escapeHtml } from "../lib/html.js";
import { layout, showToast } from "../layout.js";
import { refreshUser } from "../auth-nav.js";
import { state, setQuery } from "../state.js";
import { api } from "../api.js";
import { renderHome } from "./home.js";

export async function renderAccount() {
  await refreshUser();
  if (!state.user) {
    layout(
      "Account",
      `<p class="text-center text-slate-400">You are not signed in.</p>
        <a href="/" class="mt-6 inline-block w-full text-center text-emerald-400 hover:underline">Home</a>`,
      { variant: "form" }
    );
    return;
  }
  layout(
    "Account",
    `
      <div class="text-center">
        <p class="text-slate-300">${escapeHtml(state.user.firstName)} ${escapeHtml(state.user.lastName)}</p>
        <p class="mt-1 text-sm text-slate-500">${escapeHtml(state.user.email)}</p>
        <button type="button" id="btn-logout" class="mt-8 w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700">Sign out</button>
      </div>`,
    { variant: "form" }
  );
  document.getElementById("btn-logout")?.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    state.user = null;
    showToast("Signed out.");
    setQuery({});
    await renderHome();
  });
}
