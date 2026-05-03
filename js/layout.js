import { escapeHtml } from "./lib/html.js";
import { appRoot } from "./dom.js";

export function layout(title, innerHtml, options = {}) {
  const variant = options.variant ?? "form";
  if (variant === "run") {
    appRoot.innerHTML = `
        <div class="w-full px-4 py-8 sm:px-6 lg:px-10">
          <h1 class="mb-6 text-2xl font-bold tracking-tight text-white sm:text-3xl">${escapeHtml(title)}</h1>
          ${innerHtml}
        </div>`;
    return;
  }
  const maxW = variant === "app" ? "max-w-6xl" : "max-w-md";
  const vCenter = variant === "form";
  appRoot.innerHTML = `
      <div class="flex w-full min-h-[calc(100vh-3.5rem)] flex-col items-center ${vCenter ? "justify-center py-10" : "justify-start py-10 sm:py-12"} px-4 sm:px-8">
        <div class="w-full ${maxW}">
          <h1 class="mb-8 text-2xl font-bold tracking-tight text-white sm:text-3xl ${vCenter ? "text-center" : "text-center sm:text-left"}">${escapeHtml(title)}</h1>
          <div>${innerHtml}</div>
        </div>
      </div>`;
}

export function showToast(msg, isError) {
  const el = document.createElement("p");
  el.className =
    "fixed bottom-6 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg " +
    (isError ? "bg-red-950 text-red-100 ring-1 ring-red-800" : "bg-slate-800 text-slate-100 ring-1 ring-slate-600");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
