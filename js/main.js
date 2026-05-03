import { readQuery, state, setQuery } from "./state.js";
import { navHome, navJoin, navRuns, navAccount } from "./dom.js";
import { notifySidebarNavigated } from "./sidebar-nav.js";
import { renderHome } from "./views/home.js";
import { renderJoin } from "./views/join.js";
import { renderAccount } from "./views/account.js";
import { renderRunPage, clearRunViewerSlotDrafts } from "./views/run.js";

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
  if (window.location.search.includes("join")) {
    await renderJoin();
    return;
  }
  await renderHome();
}

window.addEventListener("popstate", () => route());

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
navRuns?.addEventListener("click", (e) => {
  e.preventDefault();
  setQuery({});
  if (!state.runToken) clearRunViewerSlotDrafts();
  renderHome();
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
