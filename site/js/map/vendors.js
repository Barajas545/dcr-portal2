/* The vendor list and its 1099 worksheet (books-vendors.html; the Books program, release B part 2b: DCR Desktop 2
   migration 20261030000500_books_reports - docs/DATABASE.md §35.3 books_vendor_balances, §35.4 books_1099 - and
   20261030000200_contacts_pictures_vendors's vendor_profiles, §32.2; the build plan's I6, I25, S4 and S12). THE MATH IS
   THE DATABASE'S (I25): what is owed, paid this year, the 1099 totals and the flags come from its functions; this module
   only shapes, words, filters and the CSV. Pure: no DOM, no network (node tests import it).

   * threshold1099(year) / thresholdWords(year, t)   the 1099 threshold the database uses when none is given ($600
     through 2025, $2,000 from 2026 - confirm with the CPA, owner Q4): shown on the page and editable for one view only
     (never stored);
   * toVendor(row)          a books_vendor_balances row -> the page's shape (amounts, the vendor's facts and flags);
   * factsVendor(c, p, t)   WITHOUT the prices switch (S4): a vendor contact and its vendor_profiles row only - no amount
                            is read or shown; the flags (W-9 missing, insurance or workers' comp run out) on the company's
                            today, as the database words them;
   * withProfiles(list, profiles)   each vendor with its own vendor_profiles row (notes, version) for the edit sheet;
   * expiry(day, today) / insuranceText / wcText / w9Text   "expired Oct 1" (red), "expires Nov 2" within 30 days
     (gold), "expires Jan 5, 2027", "exempt", "missing";
   * FILTERS / filterVendors(rows, f, today) / vendorCounts(rows, today)   All · We owe them · 1099 · W-9 missing ·
     Insurance to renew;
   * vendorColumns(prices) / columns1099   the CSVs (map/books.js toCsv: every cell quoted, the formula guard, a BOM,
     CRLF) - NO amount column without the prices switch;
   * to1099(row)            a books_1099 row -> the worksheet's line;
   * profileProblem(f) / profileBody(f)   the vendor details as the database takes them (dates and flags only: never a
     tax id, SSN, EIN or bank detail - S12): one-line legal name 1-200, license 1-40, notes <= 1,000, workers' comp
     exempt OR a date. */

import { num, dayOf, shortDay } from "./books.js";

export const SOON_DAYS = 30;
export const LIMITS = Object.freeze({ legalName: 200, license: 40, notes: 1000 });
export const KIND_WORDS = Object.freeze({ subcontractor: "Subcontractor", supplier: "Supplier", service: "Service", client: "Client", other: "Other" });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const money = (v) => (v === null || v === undefined ? null : Math.round(num(v) * 100) / 100);
const bool = (v) => v === true || v === "t" || v === "true";

/* ── the 1099 threshold (app's default; the page may override it for one view) ── */

/** The threshold books_1099 uses when none is given: $600 through 2025, $2,000 from 2026 (confirm with the CPA). */
export function threshold1099(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  return y <= 2025 ? 600 : 2000;
}

/** "$2,000 is the default for 2026 — confirm it with the CPA" | "$1,500 for this view (the default for 2026 is $2,000)". */
export function thresholdWords(year, t) {
  const d = threshold1099(year);
  const f = (n) => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (d === null) return "";
  if (t === null || t === undefined || t === "" || Number(t) === d) return f(d) + " is the default for " + year + " — confirm it with the CPA.";
  return f(t) + " for this view only (the default for " + year + " is " + f(d) + ").";
}

/** A typed threshold: "" -> null (the year's default), "1,500" / "$1500.00" -> 1500, anything else NaN. */
export function parseThreshold(text) {
  const s = String(text == null ? "" : text).replace(/[$,\s]/g, "");
  if (!s) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return NaN;
  return Number(s);
}

/** The years the worksheet offers: this year and the three before it (a 1099 is filed for last year). */
export function years1099(today) {
  const y = Number(String(dayOf(today) || "").slice(0, 4)) || new Date().getFullYear();
  return [y, y - 1, y - 2, y - 3];
}

/* ── one vendor ── */

function facts(v, r, p) {
  // the vendor_profiles facts, with the database's flags when it gave them
  v.tax1099 = bool(r.tax_1099 !== undefined ? r.tax_1099 : p && p.tax_1099);
  v.legalName = txt(r.legal_name !== undefined ? r.legal_name : p && p.legal_name);
  v.w9On = dayOf(r.w9_received_on !== undefined ? r.w9_received_on : p && p.w9_received_on);
  v.insuranceOn = dayOf(r.insurance_expires_on !== undefined ? r.insurance_expires_on : p && p.insurance_expires_on);
  v.wcOn = dayOf(r.workers_comp_expires_on !== undefined ? r.workers_comp_expires_on : p && p.workers_comp_expires_on);
  v.wcExempt = bool(r.workers_comp_exempt !== undefined ? r.workers_comp_exempt : p && p.workers_comp_exempt);
  v.license = txt(r.license_number !== undefined ? r.license_number : p && p.license_number);
  const ver = r.profile_version !== undefined ? r.profile_version : p ? p.version : null;
  v.profileVersion = ver === null || ver === undefined ? null : Number(ver);
  v.notes = p && p.notes != null ? String(p.notes) : "";
  return v;
}

/** A books_vendor_balances row -> the page's vendor (see the header). */
export function toVendor(row) {
  const r = row || {};
  const cid = r.vendor_contact_id === null || r.vendor_contact_id === undefined ? null : Number(r.vendor_contact_id);
  const kind = txt(r.contact_kind).toLowerCase();
  const v = {
    key: txt(r.vendor_key) || (cid !== null ? "c" + cid : "n" + txt(r.vendor_name).toLowerCase()),
    contactId: cid, linked: cid !== null, name: txt(r.vendor_name) || "(no name)", kind, kindLabel: KIND_WORDS[kind] || "",
    hasMoney: true,
    bills: Number(r.bills) || 0, openBills: Number(r.open_bills) || 0,
    billed: money(r.billed), approved: money(r.approved), paid: money(r.paid), owed: money(r.owed), pastDue: money(r.past_due),
    waiting: money(r.waiting_approval), paidYtd: money(r.paid_ytd), paidLastYear: money(r.paid_last_year),
    lastPaidDate: dayOf(r.last_paid_date), lastPaidAmount: money(r.last_paid_amount),
  };
  facts(v, r, null);
  v.w9Missing = r.w9_missing === undefined ? !v.w9On : bool(r.w9_missing);
  v.insuranceExpired = r.insurance_expired === undefined ? false : bool(r.insurance_expired);
  v.wcExpired = r.workers_comp_expired === undefined ? false : bool(r.workers_comp_expired);
  return v;
}

/** WITHOUT the prices switch: a vendor contact and its vendor_profiles row (null when none) - no amount at all. */
export function factsVendor(contact, profile, today) {
  const c = contact || {};
  const kind = txt(c.kind).toLowerCase();
  const v = {
    key: "c" + c.id, contactId: Number(c.id), linked: true, name: txt(c.company) || txt(c.name) || "(no name)", kind, kindLabel: KIND_WORDS[kind] || "",
    hasMoney: false,
  };
  facts(v, {}, profile || null);
  const t = dayOf(today);
  v.w9Missing = !v.w9On;
  v.insuranceExpired = !!(v.insuranceOn && t && v.insuranceOn < t);
  v.wcExpired = !!(!v.wcExempt && v.wcOn && t && v.wcOn < t);
  return v;
}

/** Each vendor with its own vendor_profiles row (notes and version, for the edit sheet). */
export function withProfiles(list, profiles) {
  const by = new Map((profiles || []).map((p) => [String(p.contact_id), p]));
  return (list || []).map((v) => {
    const p = v.contactId !== null ? by.get(String(v.contactId)) : null;
    if (!p) return v;
    return Object.assign({}, v, { notes: p.notes != null ? String(p.notes) : "", profileVersion: p.version == null ? v.profileVersion : Number(p.version) });
  });
}

/** By name, case aside; a vendor nobody linked after the one with the same name. */
export function sortVendors(list) {
  return (list || []).slice().sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.linked === b.linked ? 0 : a.linked ? -1 : 1) || a.key.localeCompare(b.key));
}

/* ── dates in words ── */

function addDayKey(k, n) {
  return new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) + n)).toISOString().slice(0, 10);
}
function longDay(k) {
  if (!DAY.test(k)) return "";
  return new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10), 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}
/** "Oct 1" this year, "Jan 5, 2027" another year. */
function dayWords(k, today) {
  if (!DAY.test(k)) return "";
  return String(today || "").slice(0, 4) === k.slice(0, 4) ? shortDay(k) : longDay(k);
}

/** A certificate's date on the company's today: none | expired (before today) | soon (within 30 days) | ok. */
export function expiry(day, today) {
  const d = dayOf(day), t = dayOf(today);
  if (!DAY.test(d)) return "none";
  if (!DAY.test(t)) return "ok";
  if (d < t) return "expired";
  return d <= addDayKey(t, SOON_DAYS) ? "soon" : "ok";
}

/** {cls, text}: the insurance (COI) line. */
export function insuranceText(v, today) {
  const e = expiry(v.insuranceOn, today);
  if (e === "none") return { cls: "none", text: "no date" };
  return { cls: e, text: (e === "expired" ? "expired " : "expires ") + dayWords(v.insuranceOn, today) };
}
/** {cls, text}: the workers' comp line. */
export function wcText(v, today) {
  if (v.wcExempt) return { cls: "ok", text: "exempt" };
  const e = expiry(v.wcOn, today);
  if (e === "none") return { cls: "none", text: "no date" };
  return { cls: e, text: (e === "expired" ? "expired " : "expires ") + dayWords(v.wcOn, today) };
}
/** {cls, text}: the W-9 line. */
export function w9Text(v, today) {
  return v.w9On ? { cls: "ok", text: "on file " + dayWords(v.w9On, today) } : { cls: "missing", text: "missing" };
}

/* ── filters ── */

export const FILTERS = Object.freeze([
  { id: "", label: "All" }, { id: "owed", label: "We owe them", money: true }, { id: "1099", label: "1099" },
  { id: "w9", label: "W-9 missing" }, { id: "coi", label: "Insurance to renew" },
]);

function renew(v, today) {
  const i = expiry(v.insuranceOn, today), w = v.wcExempt ? "ok" : expiry(v.wcOn, today);
  return i === "expired" || i === "soon" || w === "expired" || w === "soon";
}

/** f: {show ("" | owed | 1099 | w9 | coi), q (name, kind, license)} -> the vendors shown. */
export function filterVendors(rows, f, today) {
  const o = f || {};
  const q = txt(o.q).toLowerCase();
  return (rows || []).filter((v) => {
    if (o.show === "owed" && !(v.hasMoney && v.owed > 0)) return false;
    if (o.show === "1099" && !v.tax1099) return false;
    if (o.show === "w9" && !(v.linked && v.w9Missing)) return false;
    if (o.show === "coi" && !renew(v, today)) return false;
    if (q && !(v.name.toLowerCase().includes(q) || v.kindLabel.toLowerCase().includes(q) || v.legalName.toLowerCase().includes(q) || v.license.toLowerCase().includes(q))) return false;
    return true;
  });
}

/** The filter chips' counts. */
export function vendorCounts(rows, today) {
  const list = rows || [];
  return { "": list.length, owed: list.filter((v) => v.hasMoney && v.owed > 0).length, 1099: list.filter((v) => v.tax1099).length,
    w9: list.filter((v) => v.linked && v.w9Missing).length, coi: list.filter((v) => renew(v, today)).length };
}

/* ── the CSVs (S4: the amounts ONLY with the prices switch) ── */

const fixed = (v) => (v === null || v === undefined ? "" : num(v).toFixed(2));
const yes = (b) => (b ? "Yes" : "");

export function vendorColumns(prices) {
  const cols = [
    ["Vendor", (v) => v.name],
    ["Kind", (v) => v.kindLabel || (v.linked ? "" : "Not linked to a contact")],
    ["Gets a 1099", (v) => yes(v.tax1099)],
    ["Legal Name (W-9)", (v) => v.legalName],
    ["W-9 Received", (v) => v.w9On],
    ["Insurance Expires", (v) => v.insuranceOn],
    ["Workers Comp", (v) => (v.wcExempt ? "Exempt" : v.wcOn)],
    ["License", (v) => v.license],
    ["Portal Contact ID", (v) => (v.contactId === null ? "" : String(v.contactId))],
  ];
  if (prices) {
    cols.splice(2, 0, ["Owed", (v) => fixed(v.owed)], ["Past Due", (v) => fixed(v.pastDue)], ["Waiting Approval", (v) => fixed(v.waiting)],
      ["Paid This Year", (v) => fixed(v.paidYtd)], ["Paid Last Year", (v) => fixed(v.paidLastYear)], ["Last Paid", (v) => v.lastPaidDate || ""]);
  }
  return Object.freeze(cols);
}

/** A books_1099 row -> the worksheet's line. */
export function to1099(row) {
  const r = row || {};
  const cid = r.vendor_contact_id === null || r.vendor_contact_id === undefined ? null : Number(r.vendor_contact_id);
  return {
    year: Number(r.year) || null, key: txt(r.vendor_key), contactId: cid, linked: cid !== null, name: txt(r.vendor_name) || "(no name)",
    legalName: txt(r.legal_name), tax1099: bool(r.tax_1099), w9On: dayOf(r.w9_received_on),
    check: money(r.paid_check), cash: money(r.paid_cash), transfer: money(r.paid_transfer), other: money(r.paid_other),
    card: money(r.card_excluded), materials: money(r.materials_excluded), total: money(r.reportable_total),
    payments: Number(r.payments) || 0, threshold: money(r.threshold), reportable: bool(r.reportable), needsW9: bool(r.needs_w9),
  };
}

export const COLUMNS_1099 = Object.freeze([
  ["Year", (r) => String(r.year || "")],
  ["Vendor", (r) => r.name],
  ["Legal Name (W-9)", (r) => r.legalName],
  ["Gets a 1099", (r) => yes(r.tax1099)],
  ["W-9 Received", (r) => r.w9On],
  ["Check", (r) => fixed(r.check)],
  ["Cash", (r) => fixed(r.cash)],
  ["Transfer", (r) => fixed(r.transfer)],
  ["Other", (r) => fixed(r.other)],
  ["Reportable Total", (r) => fixed(r.total)],
  ["Card (Excluded)", (r) => fixed(r.card)],
  ["Materials (Excluded)", (r) => fixed(r.materials)],
  ["Threshold", (r) => fixed(r.threshold)],
  ["Reportable", (r) => yes(r.reportable)],
  ["Needs W-9", (r) => yes(r.needsW9)],
  ["Portal Contact ID", (r) => (r.contactId === null ? "" : String(r.contactId))],
]);

/* ── the vendor details (vendor_profiles: dates and flags only) ── */

/** The page's early word on the details (the database checks them again): "" when fine. */
export function profileProblem(f) {
  const x = f || {};
  const legal = txt(x.legalName), lic = txt(x.license), notes = String(x.notes == null ? "" : x.notes);
  if (legal.length > LIMITS.legalName) return "The legal name is at most " + LIMITS.legalName + " characters.";
  if (lic.length > LIMITS.license) return "The license number is at most " + LIMITS.license + " characters.";
  if (notes.length > LIMITS.notes) return "The notes are at most " + LIMITS.notes.toLocaleString("en-US") + " characters.";
  for (const [k, words] of [["w9On", "the W-9 date"], ["insuranceOn", "the insurance date"], ["wcOn", "the workers' comp date"]]) {
    if (x[k] && !DAY.test(String(x[k]))) return "Pick " + words + " from the calendar.";
  }
  if (x.wcExempt && x.wcOn) return "Workers' comp is either exempt or has a date it runs out - not both.";
  return "";
}

/** The vendor_profiles columns a save writes (blank -> null; never a tax id). */
export function profileBody(f) {
  const x = f || {};
  const orNull = (v) => (txt(v) ? txt(v) : null);
  const notes = String(x.notes == null ? "" : x.notes).replace(/\r\n?/g, "\n").trim();
  return {
    tax_1099: !!x.tax1099,
    legal_name: orNull(x.legalName),
    w9_received_on: x.w9On && DAY.test(String(x.w9On)) ? String(x.w9On) : null,
    insurance_expires_on: x.insuranceOn && DAY.test(String(x.insuranceOn)) ? String(x.insuranceOn) : null,
    workers_comp_expires_on: !x.wcExempt && x.wcOn && DAY.test(String(x.wcOn)) ? String(x.wcOn) : null,
    workers_comp_exempt: !!x.wcExempt,
    license_number: orNull(x.license),
    notes: notes || null,
  };
}
