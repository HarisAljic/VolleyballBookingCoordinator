import { readQuery, state, setQuery } from "./state.js";
import { navHome, navJoin, navCreate, navAccount } from "./dom.js";
import { notifySidebarNavigated } from "./sidebar-nav.js";
import { renderHome } from "./views/home.js";
import { renderJoin } from "./views/join.js";
import { renderAccount } from "./views/account.js";
import { renderRunPage, clearRunViewerSlotDrafts } from "./views/run.js";
import { showToast } from "./layout.js";

async function route() {
  readQuery();
  if (!state.runToken) {
    clearRunViewerSlotDrafts();
  }
  if (new URLSearchParams(window.location.search).has("account")) {
    await renderAccount();
    return;
  }
  if (state.runToken) {
    await renderRunPage();
    return;
  }
  if (new URLSearchParams(window.location.search).has("create")) {
    const { renderCreateRun } = await import("./views/create-run.js");
    await renderCreateRun();
    return;
  }
  if (window.location.search.includes("join")) {
    await renderJoin();
    return;
  }
  await renderHome();
}

window.addEventListener("popstate", () => route());

// Surface unexpected runtime errors during navigation/refactors.
window.addEventListener("error", (e) => {
  const msg = e?.error?.message || e?.message || "Unexpected error";
  showToast(msg, true);
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e?.reason;
  const msg =
    (reason && typeof reason === "object" && "message" in reason && reason.message) ||
    String(reason || "Unhandled promise rejection");
  showToast(msg, true);
});

navHome?.addEventListener("click", (e) => {
  e.preventDefault();
  setQuery({});
  route();
  notifySidebarNavigated();
});
navJoin?.addEventListener("click", (e) => {
  e.preventDefault();
  setQuery({ join: "" });
  state.joinCode = "";
  window.history.pushState({}, "", "/?join");
  readQuery();
  if (!state.runToken) clearRunViewerSlotDrafts();
  renderJoin();
  notifySidebarNavigated();
});
navCreate?.addEventListener("click", (e) => {
  e.preventDefault();
  window.history.pushState({}, "", "/?create");
  if (!state.runToken) clearRunViewerSlotDrafts();
  route();
  notifySidebarNavigated();
});
navAccount?.addEventListener("click", (e) => {
  e.preventDefault();
  window.history.pushState({}, "", "/?account");
  readQuery();
  if (!state.runToken) clearRunViewerSlotDrafts();
  renderAccount();
  notifySidebarNavigated();
});

route();
