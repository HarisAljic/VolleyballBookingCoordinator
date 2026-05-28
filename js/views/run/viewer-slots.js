import { normalizeSlotKey } from "../../lib/slot-keys.js";

/** Viewer’s unsaved slot picks for a run (same Set across week navigation). */
const viewerSlotDraftByRunToken = new Map();

export function clearRunViewerSlotDrafts() {
  viewerSlotDraftByRunToken.clear();
}

export function getViewerSlotSelection(token, run) {
  let selected = viewerSlotDraftByRunToken.get(token);
  if (!selected) {
    selected = new Set(
      (run.viewerSlots || []).map((s) => normalizeSlotKey(String(s))).filter(Boolean)
    );
    viewerSlotDraftByRunToken.set(token, selected);
  }
  return selected;
}

export function clearViewerSlotDraft(token) {
  viewerSlotDraftByRunToken.delete(token);
}
