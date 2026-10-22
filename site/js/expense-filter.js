/* DCR Portal 2 — the single source of truth for filtering a project's expenses (port of the old
   expense-filter.js, BLUEPRINT 2.2.3 "pure helpers ported as-is: … the expense filter"; MODULES §6
   "report-expenses.html + expense-filter.js").

   The project's Expenses tab (js/pages/project-expenses.js) and the printed sheet
   (js/pages/report-expenses.js) BOTH call into this file. Never re-implement the period bounds, the
   group key, the description fallback, matching, sorting, grouping or the totals anywhere else — the
   moment they exist twice the screen and the paper drift apart, and the printed total stops matching
   the total on the screen.

   What changed from the old file (the semantics did not):
   * rows are the ledger rows of js/map/ledger.js (toLedgerRow: a DCR Desktop 2 `costs` row) — date,
     group (the estimate line), description, vendor, kind and the money columns materials,
     contractors, labor, other (equipment and "other" kinds), cost (materials + subcontractor +
     labour: BLUEPRINT 3.3.11; billed-out is never a cost) — instead of SharePoint's ledger fields;
   * days are the company's (America/Los_Angeles) and travel as "YYYY-MM-DD" text, never as a local
     Date (BLUEPRINT 2.1 principle 6): "This month" is the Pacific month whatever the browser's zone;
   * the sort keys follow the new columns (date, desc, mat, con, lab, oth, cost);
   * the per-tab memory is "dcr2ExpFilter" (Appendix C: every browser-side name is new).
   The URL keys (group, range, from, to, q, sort, dir and the resolved pa / pb on the Print link) are
   the old ones, so a printed sheet still names the window the screen had resolved.

   Pure module: no DOM, no network (node tests import it); sessionStorage only in save / load. */

import { ymd as companyDayOf, addDays } from "./map/pacific.js";

export const PERIODS = Object.freeze([
  ["all", "All dates"], ["thisMonth", "This month"], ["lastMonth", "Last month"],
  ["last30", "Last 30 days"], ["last90", "Last 90 days"], ["thisQuarter", "This quarter"],
  ["thisYear", "This year"], ["lastYear", "Last year"], ["custom", "Custom range…"],
]);
export const SORT_LABELS = Object.freeze({ date: "Date", desc: "Description", mat: "Materials", con: "Subcontractors",
  lab: "Labour", oth: "Equipment / other", cost: "Cost" });
// Written to / read from the query string. pa / pb are the RESOLVED bounds and ride along on the
// Print link only (see hrefWith(..., pinned)).
export const KEYS = Object.freeze(["group", "range", "from", "to", "q", "sort", "dir"]);
export const PKEYS = Object.freeze(KEYS.concat(["pa", "pb"]));
export const STORE = "dcr2ExpFilter";
export const NO_GROUP = "(not on an estimate line)";
const QMAX = 200;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function defaults() {
  return { group: "*", range: "all", from: "", to: "", q: "", sort: "date", dir: -1, pa: "", pb: "" };
}

/* ── scalars ── */
export function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v == null ? "" : v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
export function money(n) {
  const v = round2(n);
  const t = "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? "-" + t : t;
}
/** "YYYY-MM-DD" of a date column (taken as written) or of an instant (its company day); "" otherwise. */
export function dayOf(v) {
  if (!v) return "";
  const s = String(v);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m && (s.length === 10 || !/T/.test(s))) return m[1];
  const d = new Date(s);
  return isNaN(d) ? (m ? m[1] : "") : companyDayOf(d);
}
export function isISO(s) { return DAY_RE.test(String(s || "")); }
/** "Oct 5, 2026" for a "YYYY-MM-DD" (no time zone can move it). */
export function fmtDay(v) {
  const d = dayOf(v);
  if (!d) return "";
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd, 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function monthStart(y, m) {             // m: 1..12, may run past either end
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-01";
}
function monthEnd(y, m) {
  const d = new Date(Date.UTC(y, m, 0));
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}

// Notes pasted from Word or e-mail carry markup — read it as plain text with its line breaks
// intact, never as live HTML.
export function stripML(v) {
  return String(v == null ? "" : v)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(div|p|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&nbsp;/gi, " ");
}

/* ── row accessors: the group and the description fallback live in ONE place ── */
export function groupOf(r) { return (r && r.group) || NO_GROUP; }
export function descOf(r) {
  if (!r) return "";
  return String(r.description || "").trim() || String(r.vendor || "").trim() || String(r.kindLabel || "").trim() || "";
}

/* ── the filter object ──
   norm() is the only trust boundary for anything arriving from a URL or from sessionStorage. It
   CLAMPS values; it never rewrites the user's intent (notably: an empty custom range stays
   "custom", so clearing a date box does not snap the dropdown back to "All dates"). */
export function norm(src) {
  const f = defaults();
  if (!src || typeof src !== "object") return f;
  if (src.group != null && src.group !== "") f.group = String(src.group).slice(0, QMAX);
  if (src.q != null) f.q = String(src.q).slice(0, QMAX);
  for (let i = 0; i < PERIODS.length; i++) if (PERIODS[i][0] === src.range) f.range = src.range;
  if (Object.prototype.hasOwnProperty.call(SORT_LABELS, src.sort)) f.sort = src.sort;
  f.dir = Number(src.dir) > 0 ? 1 : -1;
  if (isISO(src.from)) f.from = String(src.from);
  if (isISO(src.to)) f.to = String(src.to);
  if (isISO(src.pa)) f.pa = String(src.pa);
  if (isISO(src.pb)) f.pb = String(src.pb);
  return f;
}

/** The resolved {a, b} window ("YYYY-MM-DD", both ends included), or null when no date filtering
    applies. `today` is the company day ("YYYY-MM-DD"; default: now in Los Angeles). */
export function period(f, today) {
  const key = f && f.range;
  // A print link carries the window the screen had already resolved, so a relative period ("This
  // month", "Last 30 days") cannot re-resolve to a different range on the report page.
  if (key && key !== "all" && isISO(f.pa) && isISO(f.pb)) return { a: f.pa, b: f.pb };
  if (!key || key === "all") return null;
  const t = isISO(today) ? today : companyDayOf(new Date());
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  if (key === "thisMonth") return { a: monthStart(y, m), b: monthEnd(y, m) };
  if (key === "lastMonth") return { a: monthStart(y, m - 1), b: monthEnd(y, m - 1) };
  if (key === "last30") return { a: addDays(t, -29), b: t };
  if (key === "last90") return { a: addDays(t, -89), b: t };
  if (key === "thisQuarter") { const q = Math.floor((m - 1) / 3) * 3 + 1; return { a: monthStart(y, q), b: monthEnd(y, q + 2) }; }
  if (key === "thisYear") return { a: y + "-01-01", b: y + "-12-31" };
  if (key === "lastYear") return { a: (y - 1) + "-01-01", b: (y - 1) + "-12-31" };
  if (key === "custom") {
    const a = isISO(f.from) ? f.from : "", b = isISO(f.to) ? f.to : "";
    if (!a && !b) return null;
    return { a: a || "1900-01-01", b: b || "2999-12-31" };
  }
  return null;
}

export function filter(rows, f, today) {
  const per = period(f, today), q = String((f && f.q) || "").trim().toLowerCase();
  return (rows || []).filter(function (r) {
    if (f.group !== "*" && groupOf(r) !== f.group) return false;
    if (per) {
      const d = dayOf(r.date);
      if (!d || d < per.a || d > per.b) return false;
    }
    if (q) {
      // filter(Boolean) first: joining absent fields would put the literal "undefined" in the
      // haystack and make a search for "und" match everything.
      const hay = [r.description, r.vendor, r.group, r.kindLabel].filter(Boolean).join(" ").toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

const SORT_VAL = {
  date: function (r) { return dayOf(r.date); },
  desc: function (r) { return descOf(r).toLowerCase(); },
  mat: function (r) { return num(r.materials); }, con: function (r) { return num(r.contractors); },
  lab: function (r) { return num(r.labor); }, oth: function (r) { return num(r.other); },
  cost: function (r) { return num(r.cost); },
};
export function sort(rows, f) {
  const dir = Number(f && f.dir) > 0 ? 1 : -1;
  const val = SORT_VAL[f && SORT_VAL[f.sort] ? f.sort : "date"];
  return (rows || []).slice().sort(function (a, b) {
    const A = val(a), B = val(b);
    const c = A < B ? -1 : A > B ? 1 : 0;
    return c * dir || (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}

// Buckets by group, preserving the order it was handed (so the rows stay globally sorted).
// Object.create(null) is load-bearing: with a plain object a group literally named "__proto__"
// silently loses its rows and one named "constructor" throws.
export function group(rows) {
  const m = Object.create(null), order = [];
  (rows || []).forEach(function (r) {
    const g = groupOf(r);
    if (!m[g]) { m[g] = []; order.push(g); }
    m[g].push(r);
  });
  order.sort(function (a, b) { return a === NO_GROUP ? 1 : b === NO_GROUP ? -1 : a < b ? -1 : a > b ? 1 : 0; });
  return order.map(function (g) { return { name: g, rows: m[g] }; });
}

/** One pass over the rows (never a fold of subtotals), in cents, so the paper matches the screen. */
export function totals(rows) {
  const c = { mat: 0, con: 0, lab: 0, oth: 0, cost: 0 };
  (rows || []).forEach(function (r) {
    c.mat += Math.round(num(r.materials) * 100); c.con += Math.round(num(r.contractors) * 100);
    c.lab += Math.round(num(r.labor) * 100); c.oth += Math.round(num(r.other) * 100);
    c.cost += Math.round(num(r.cost) * 100);
  });
  return { mat: c.mat / 100, con: c.con / 100, lab: c.lab / 100, oth: c.oth / 100, cost: c.cost / 100, count: (rows || []).length };
}

/* ── describing the filter in plain words (printed on the sheet) ──
   The period phrase is derived from period(f), never from f.range, so the sheet can never claim a
   date window it did not actually apply. */
export function isActive(f, today) {
  return f.group !== "*" || !!period(f, today) || !!String(f.q || "").trim();
}
export function periodName(key) {
  for (let i = 0; i < PERIODS.length; i++) if (PERIODS[i][0] === key) return PERIODS[i][1];
  return "All dates";
}
export function label(f, today) {
  const parts = [], per = period(f, today);
  parts.push(f.group === "*" ? "All lines" : "Line: " + f.group);
  if (!per) parts.push("All dates");
  else if (f.range === "custom") {
    parts.push(f.from && f.to ? "Custom range " + fmtDay(f.from) + " – " + fmtDay(f.to)
      : f.from ? "From " + fmtDay(f.from) : "Through " + fmtDay(f.to));
  } else {
    parts.push(periodName(f.range).replace(/…$/, "") + " (" + fmtDay(per.a) + " – " + fmtDay(per.b) + ")");
  }
  if (String(f.q || "").trim()) parts.push('Search: "' + String(f.q).trim() + '"');
  const asc = Number(f.dir) > 0;
  const order = f.sort === "date" ? (asc ? "oldest first" : "newest first") : (asc ? "ascending" : "descending");
  parts.push("Sorted by " + SORT_LABELS[f.sort] + ", " + order);
  return parts.join(" · ");
}

/* ── URL: one writer (searchParams), one reader ──
   Hand-rolling a second encoder is how "R&D / Misc" ends up encoded two different ways, so
   everything funnels through setPairs. */
function setPairs(u, f, pinned, today) {
  PKEYS.forEach(function (k) { u.searchParams.delete(k); });
  if (f.group !== "*") u.searchParams.set("group", f.group);
  if (f.range !== "all") u.searchParams.set("range", f.range);
  if (f.from) u.searchParams.set("from", f.from);
  if (f.to) u.searchParams.set("to", f.to);
  if (String(f.q || "").trim()) u.searchParams.set("q", String(f.q).trim());
  if (f.sort !== "date") u.searchParams.set("sort", f.sort);
  if (Number(f.dir) > 0) u.searchParams.set("dir", "1");
  if (pinned) {
    const per = period(f, today);
    if (per && f.range !== "all") {
      u.searchParams.set("pa", per.a);
      u.searchParams.set("pb", per.b);
    }
  }
  return u;
}
export function applyToUrl(u, f) { return setPairs(u, f, false); }
/** "report-expenses.html?id=268&range=…" — a page of this site with the filter (pinned: the resolved window too). */
export function hrefWith(path, extra, f, pinned, today) {
  const u = new URL(path, "https://portal.invalid/");
  Object.keys(extra || {}).forEach(function (k) { u.searchParams.set(k, extra[k]); });
  setPairs(u, f, !!pinned, today);
  return u.pathname.replace(/^.*\//, "") + u.search;
}
/** The filter from a URLSearchParams, or null when it names none of the keys (a bookmark prints everything). */
export function fromQuery(qs) {
  let any = false;
  PKEYS.forEach(function (k) { if (qs.get(k) != null) any = true; });
  if (!any) return null;
  const src = {};
  PKEYS.forEach(function (k) { src[k] = qs.get(k); });
  return norm(src);
}

/* ── per-tab memory, so leaving the page and coming back is not a reset ── */
export function save(pid, f) {
  try { sessionStorage.setItem(STORE, JSON.stringify({ v: 1, pid: String(pid), f: f })); } catch (e) { /* page-only */ }
}
export function load(pid) {
  try {
    const s = JSON.parse(sessionStorage.getItem(STORE) || "null");
    if (!s || s.v !== 1 || String(s.pid) !== String(pid)) return null;
    return norm(s.f);
  } catch (e) { return null; }
}
