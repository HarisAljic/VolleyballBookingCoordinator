import { state, setQuery } from "../state.js";

/** Open the active default weekend run when the user has one. */
export async function navigateToDefaultRun() {
  const token = state.defaultRun?.shareToken;
  if (!token) return false;
  setQuery({ run: token });
  const { renderRunPage } = await import("../views/run.js");
  await renderRunPage();
  return true;
}
