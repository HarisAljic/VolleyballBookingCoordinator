import { isVbDiag } from "./lib/diag.js";

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body != null) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { credentials: "include", ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (isVbDiag()) {
    const hint =
      typeof data?.memberAvailability?.length === "number"
        ? `memberAvailability.length=${data.memberAvailability.length}`
        : "";
    console.info("[vbdiag] HTTP", res.status, path, hint, data?.error || "");
  }
  if (!res.ok) throw new Error(data.error || res.statusText || "Request failed");
  return data;
}
