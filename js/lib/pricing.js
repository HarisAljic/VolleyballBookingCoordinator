import { parseSlotKeyToDate } from "./dates.js";

function pakmenRateCentsForDowAndMinute(dow, minute) {
  const m = Number(minute);
  if (Number.isNaN(m) || m < 0 || m >= 1440) return null;
  if (dow >= 1 && dow <= 5) {
    if (m >= 8 * 60 && m < 18 * 60) return 5900;
    if (m >= 18 * 60 && m < 22 * 60) return 7900;
    if (m >= 22 * 60) return 6900;
    return null;
  }
  if (dow === 6) {
    if (m >= 7 * 60 && m < 9 * 60) return 5900;
    if (m >= 20 * 60 && m < 22 * 60) return 7900;
    if (m >= 22 * 60) return 6900;
    return null;
  }
  if (dow === 0) {
    if (m >= 7 * 60 && m < 9 * 60) return 5900;
    if (m >= 20 * 60) return 6900;
    if (m >= 0 && m < 60) return 6900;
    return null;
  }
  return null;
}

export function pakmenTotalPriceCents(slotStartIso, slotEndIso) {
  const hs = parseSlotKeyToDate(slotStartIso);
  const he = parseSlotKeyToDate(slotEndIso);
  if (!hs || !he) return null;
  const ms = he.getTime() - hs.getTime();
  if (!(ms > 0) || ms % 3600000 !== 0) return null;
  let total = 0;
  for (let t = hs.getTime(); t < he.getTime(); t += 3600000) {
    const d = new Date(t);
    const dow = d.getDay();
    const minute = d.getHours() * 60 + d.getMinutes();
    const rate = pakmenRateCentsForDowAndMinute(dow, minute);
    if (rate == null) return null;
    total += rate;
  }
  return total;
}

export function formatUsdFromCents(cents) {
  const n = Number(cents);
  if (Number.isNaN(n)) return "";
  return `$${(n / 100).toFixed(2)}`;
}

const HST_RATE = 0.13;

function applyHstCents(beforeTaxCents) {
  const n = Number(beforeTaxCents);
  if (Number.isNaN(n)) return null;
  return Math.round(n * (1 + HST_RATE));
}

export function kingsCourtTotalPriceCents(slotStartIso, slotEndIso) {
  const hs = parseSlotKeyToDate(slotStartIso);
  const he = parseSlotKeyToDate(slotEndIso);
  if (!hs || !he) return null;
  const ms = he.getTime() - hs.getTime();
  if (!(ms > 0) || ms % 3600000 !== 0) return null;
  const hours = ms / 3600000;
  return Math.round(hours * 8300);
}

function fitcourtsIsPrimeTime(dow, minute) {
  if (dow >= 1 && dow <= 5) return minute >= 18 * 60 && minute < 23 * 60;
  if (dow === 6 || dow === 0) return minute >= 10 * 60 && minute < 22 * 60;
  return false;
}

function fitcourtsRateCentsForDowAndMinute(dow, minute) {
  const m = Number(minute);
  if (Number.isNaN(m) || m < 0 || m >= 1440) return null;
  return fitcourtsIsPrimeTime(dow, m) ? 8500 : 7500;
}

export function fitcourtsTotalPriceCents(slotStartIso, slotEndIso) {
  const hs = parseSlotKeyToDate(slotStartIso);
  const he = parseSlotKeyToDate(slotEndIso);
  if (!hs || !he) return null;
  const ms = he.getTime() - hs.getTime();
  if (!(ms > 0) || ms % 3600000 !== 0) return null;
  let beforeTax = 0;
  for (let t = hs.getTime(); t < he.getTime(); t += 3600000) {
    const d = new Date(t);
    const rate = fitcourtsRateCentsForDowAndMinute(d.getDay(), d.getHours() * 60 + d.getMinutes());
    if (rate == null) return null;
    beforeTax += rate;
  }
  return applyHstCents(beforeTax);
}

export function venueTotalPriceCents(venueId, slotStartIso, slotEndIso) {
  if (venueId === "pakmen") return pakmenTotalPriceCents(slotStartIso, slotEndIso);
  if (venueId === "kings-oakville") return kingsCourtTotalPriceCents(slotStartIso, slotEndIso);
  if (venueId === "fitcourts-erin") return fitcourtsTotalPriceCents(slotStartIso, slotEndIso);
  return null;
}
