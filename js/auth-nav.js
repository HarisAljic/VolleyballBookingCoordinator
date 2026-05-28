import { state } from "./state.js";
import { api } from "./api.js";
import { navCreate, accountLabel } from "./dom.js";

export function setNavAuth() {
  const authed = !!state.user;
  if (navCreate) navCreate.classList.toggle("hidden", !authed);
  if (accountLabel) {
    accountLabel.textContent = authed
      ? `${state.user.firstName} ${state.user.lastName}`
      : "Guest";
  }
}

export function applyAuthSession(data) {
  state.user = data?.user ?? null;
  state.defaultRun = data?.defaultRun ?? null;
  setNavAuth();
}

export async function refreshUser() {
  try {
    const data = await api("/api/auth/me", { method: "GET" });
    applyAuthSession(data);
  } catch {
    applyAuthSession({ user: null, defaultRun: null });
  }
}
