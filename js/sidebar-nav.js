/** Dispatched after in-app navigation; index.html collapses the sidebar on narrow viewports only. */
export const SIDEBAR_NAVIGATED_EVENT = "vb-navigated-narrow";

export function notifySidebarNavigated() {
  window.dispatchEvent(new Event(SIDEBAR_NAVIGATED_EVENT));
}
