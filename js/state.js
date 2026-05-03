export const state = { user: null, runToken: null, joinCode: null };

export function readQuery() {
  const q = new URLSearchParams(window.location.search);
  state.runToken = q.get("run");
  state.joinCode = q.get("join");
}

export function setQuery(params) {
  const q = new URLSearchParams();
  if (params.run) q.set("run", params.run);
  if (params.join) q.set("join", params.join);
  const s = q.toString();
  const url = s ? `${window.location.pathname}?${s}` : window.location.pathname;
  window.history.pushState({}, "", url);
  readQuery();
}
