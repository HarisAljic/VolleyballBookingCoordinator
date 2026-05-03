import { state } from "./state.js";
import { api } from "./api.js";
import { navRuns, accountLabel } from "./dom.js";

export function setNavAuth() {
  const authed = !!state.user;
  if (navRuns) navRuns.classList.toggle("hidden", !authed);
  if (accountLabel) {
    accountLabel.textContent = authed
      ? `${state.user.firstName} ${state.user.lastName}`
      : "Guest";
  }
}

export async function refreshUser() {
  try {
    const { user } = await api("/api/auth/me", { method: "GET" });
    state.user = user;
  } catch {
    state.user = null;
  }
  setNavAuth();
}
