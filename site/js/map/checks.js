/* The check register (the Books program, release A: books-checks.html; DCR Desktop 2 migration
   20261030000300_check_register, docs/DATABASE.md §33; the build plan's I7-I12 and S4): the check_register view's rows
   -> what the page draws, prints and puts in its CSV.

   * checkKey(n)            app.check_key, mirrored: digits and letters only, upper case, leading zeros dropped ("#1043",
                            " 1043" and "01043" are "1043", "TEST-1" is "TEST1", "0" stays "0"); null with neither;
   * digitKey(k)            an all-digit key (the only ones the next number and the gap flag look at: a "TEST-<n>"
                            smoke-test check or a letter-suffixed number never moves either);
   * STATUS_ORDER / STATUS_WORDS / statusText(row)
                            written -> told -> picked up -> cleared, and void / spoiled (the view's status: the least
                            advanced of a check's live payments);
   * toRegisterRow(row, ctx) / buildRegister(rows, ctx)
                            one row per physical check (the view groups payments by key, date and payee) plus a row per
                            spoiled blank, with the payments behind it (their versions, for the register's RPCs), the
                            jobs, the contact and the files; newest first (the date on the check, then the number);
   * findGaps(rows) / gapText(gap)
                            a number missing between two written or spoiled ones: "#1045 missing — spoil it or find it";
                            a long run (more than GAP_RUN numbers) is said once and softly (another checkbook, or checks
                            not entered here);
   * filterRegister(rows, f) / monthsOf(rows)   the page's filters: status, month, payee or job, number range;
   * checkColumns(prices)   the Checks CSV (map/books.js toCsv: every cell quoted, the formula guard, a BOM, CRLF) -
                            the amount ONLY with the prices switch (S4: no amount anywhere without it);
   * clashText(e)           the database's own sentence for a check number already used (23505 from
                            t11_payments_check_number, spoil_check), which common2.js would otherwise turn into the
                            generic "already used by another record";
   * nextText(next)         "Next check: #1044 — after #1043 to Kestrel Lumber Supply, Oct 28".

   Pure module: no DOM, no network (node tests import it). */

import { dayOf, shortDay, plural, num } from "./books.js";

/* ── the key (app.check_key) ───────────────────────────────────────────── */

/** app.check_key: digits and letters only, upper case, leading zeros dropped ("0" stays "0"); null with neither. */
export function checkKey(p) {
  const s = String(p == null ? "" : p).replace(/[^0-9A-Za-z]/g, "").toUpperCase().replace(/^0+(?=.)/, "");
  return s || null;
}

/** An all-digit key ("1043"), the only kind the next number and the gap flag count. */
export function digitKey(k) { return typeof k === "string" && /^[0-9]+$/.test(k); }

/** Two keys in number order (all-digit keys by value, before any other). */
export function keyCompare(a, b) {
  const da = digitKey(a), db = digitKey(b);
  if (da && db) return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  if (da !== db) return da ? -1 : 1;
  return String(a || "").localeCompare(String(b || ""));
}

/* ── status ────────────────────────────────────────────────────────────── */

/* The view's status: void (every payment voided) | cleared | picked_up | told | written (the least advanced of its live
   payments) | spoiled (a blank). The order a check goes through, then the two that end it. */
export const STATUS_ORDER = Object.freeze(["written", "told", "picked_up", "cleared", "void", "spoiled"]);
export const STATUS_WORDS = Object.freeze({ written: "Written", told: "Told", picked_up: "Picked up", cleared: "Cleared", void: "Void", spoiled: "Spoiled" });
const TOLD_WORDS = { phone: "by phone", "in person": "in person", email: "by e-mail", "text message": "by text", text: "by text" };

/** "Cleared Oct 20" | "Picked up Oct 22" | "Told by phone" | "Written" | "Void" | "Spoiled". */
export function statusText(r) {
  if (!r) return "";
  switch (r.status) {
    case "cleared": return "Cleared " + shortDay(r.clearedOn);
    case "picked_up": return "Picked up " + shortDay(r.pickedUpDay);
    case "told": return "Told " + (TOLD_WORDS[String(r.toldHow || "").toLowerCase()] || (r.toldHow ? String(r.toldHow) : "")).trim();
    default: return STATUS_WORDS[r.status] || String(r.status || "");
  }
}

/* ── rows ──────────────────────────────────────────────────────────────── */

const txt = (v) => String(v == null ? "" : v).trim();
const ids = (v) => (Array.isArray(v) ? v : []).filter((x) => x !== null && x !== undefined).map((x) => Number(x));

/** One payment as the register needs it: its version and stamps (for payment_picked_up, clear_payments and
    void_payment); the amount only when it was read (with the prices switch). */
export function registerPayment(p) {
  if (!p) return null;
  const at = (v) => (v ? String(v) : null);
  return {
    id: Number(p.id), version: p.version == null ? null : Number(p.version), billId: p.bill_id == null ? null : Number(p.bill_id),
    projectId: p.project_id == null ? null : Number(p.project_id), paidDate: dayOf(p.paid_date), method: txt(p.method).toLowerCase(),
    checkNumber: txt(p.check_number), payee: txt(p.payee),
    amount: p.amount === undefined || p.amount === null ? null : num(p.amount),
    toldAt: at(p.pickup_told_at), toldHow: txt(p.pickup_told_how),
    voidedAt: at(p.voided_at), voidReason: txt(p.void_reason), voided: !!p.voided_at,
    pickedUpAt: at(p.picked_up_at), pickedUpDay: dayOf(p.picked_up_at), pickedUpNote: txt(p.picked_up_note),
    clearedOn: dayOf(p.cleared_on), createdAt: at(p.created_at), recordedDay: dayOf(p.created_at),
  };
}

/** A payment's first day: its check's day, or the day it was recorded when earlier (app.payment_first_day: a
    post-dated check is handed over - and may clear - before its date). */
export function firstDay(p) {
  const a = p && p.paidDate, b = p && p.recordedDay;
  if (!a) return b || "";
  if (!b) return a;
  return a < b ? a : b;
}

/** One check_register row -> the page's shape. ctx: {payments: Map id -> registerPayment, projects: Map id -> row,
    contacts: Map id -> row, files: Map paymentId -> [file rows]}. */
export function toRegisterRow(row, ctx) {
  const c = ctx || {};
  const pays = ids(row.payment_ids).map((id) => (c.payments ? c.payments.get(String(id)) : null)).filter(Boolean);
  const live = pays.filter((p) => !p.voided);
  const projects = ids(row.project_ids).map((id) => (c.projects ? c.projects.get(String(id)) : null)).filter(Boolean);
  const files = [];
  pays.forEach((p) => ((c.files && c.files.get(String(p.id))) || []).forEach((f) => files.push(f)));
  const toldHow = (live.find((p) => p.toldAt) || {}).toldHow || "";
  const kind = row.kind === "spoiled" ? "spoiled" : "check";
  const key = row.check_key == null ? checkKey(row.check_number) : String(row.check_key);
  return {
    key: kind + ":" + (kind === "spoiled" ? row.spoiled_id : ids(row.payment_ids).join("-")),
    kind, number: txt(row.check_number), checkKey: key, digits: digitKey(key),
    paidDate: dayOf(row.paid_date), month: dayOf(row.paid_date).slice(0, 7),
    payee: txt(row.payee), vendorContactId: row.vendor_contact_id == null ? null : Number(row.vendor_contact_id),
    contact: c.contacts && row.vendor_contact_id != null ? c.contacts.get(String(row.vendor_contact_id)) || null : null,
    // the amounts are read only with the prices switch (repo/checks.js): undefined otherwise, and never drawn
    amount: row.amount === undefined ? undefined : row.amount === null ? null : num(row.amount),
    writtenAmount: row.written_amount === undefined ? undefined : row.written_amount === null ? null : num(row.written_amount),
    paymentIds: ids(row.payment_ids), billIds: ids(row.bill_ids), projectIds: ids(row.project_ids),
    jobs: projects.map((p) => txt(p.number)).filter(Boolean),
    jobLabels: projects.map((p) => (txt(p.number) + (txt(p.name) ? " — " + txt(p.name) : "")).trim()).filter(Boolean),
    status: txt(row.status) || (kind === "spoiled" ? "spoiled" : "written"),
    voidReason: txt(row.void_reason), voidedAt: row.voided_at || null,
    clearedOn: dayOf(row.cleared_on), pickedUpAt: row.picked_up_at || null, pickedUpDay: dayOf(row.picked_up_at),
    toldAt: row.told_at || null, toldHow, recordedAt: row.recorded_at || null,
    numberReused: !!row.number_reused, spoiledId: row.spoiled_id == null ? null : Number(row.spoiled_id),
    payments: pays, live, files,
  };
}

/** Rows in the register's order: newest first - by the date on the check (a blank: the day it was spoiled), then by
    number, highest first (a written check before a blank of the same number). */
export function sortRegister(rows) {
  return (rows || []).slice().sort((a, b) => String(b.paidDate).localeCompare(String(a.paidDate)) ||
    keyCompare(b.checkKey, a.checkKey) || (a.kind === b.kind ? 0 : a.kind === "spoiled" ? 1 : -1) ||
    String(b.recordedAt || "").localeCompare(String(a.recordedAt || "")));
}

/** Everything the register page draws from the rows the repository read: {rows, gaps, next, voidEnabled, counts}. */
export function buildRegister(input, ctx) {
  const R = input || {};
  const byId = (list, f) => new Map((list || []).map((x) => [String(x.id), f ? f(x) : x]));
  const files = new Map();
  (R.files || []).forEach((f) => {
    const k = String(f.payment_id);
    if (!files.has(k)) files.set(k, []);
    files.get(k).push(f);
  });
  const c = { payments: byId(R.payments, registerPayment), projects: byId(R.projects), contacts: byId(R.contacts), files };
  const rows = sortRegister((R.rows || []).map((r) => toRegisterRow(r, c)));
  const counts = {};
  STATUS_ORDER.forEach((s) => { counts[s] = rows.filter((r) => r.status === s).length; });
  return { rows, gaps: findGaps(rows), counts, next: R.next || null, voidEnabled: !!R.voidEnabled, today: (ctx && ctx.today) || "" };
}

/* ── gaps ──────────────────────────────────────────────────────────────── */

/* A run of more missing numbers than this is said once and softly: a new checkbook, or checks written elsewhere. */
export const GAP_RUN = 10;

/** The numbers missing between the all-digit numbers the register holds (checks, voided ones, spoiled blanks), newest
    first: [{from, to, count, small}] (from / to: the digits as text). */
export function findGaps(rows, max) {
  const run = Number(max) || GAP_RUN;
  const keys = Array.from(new Set((rows || []).map((r) => r.checkKey).filter(digitKey))).map((k) => BigInt(k)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out = [];
  for (let i = 1; i < keys.length; i++) {
    const gap = keys[i] - keys[i - 1] - 1n;
    if (gap <= 0n) continue;
    out.push({ from: String(keys[i - 1] + 1n), to: String(keys[i] - 1n), count: Number(gap), small: gap <= BigInt(run), after: String(keys[i - 1]), before: String(keys[i]) });
  }
  return out.reverse();
}

/** "#1045 missing — spoil it or find it", "#1045–#1047 missing (3) — spoil them or find them", or, for a long run,
    "#1101–#4999 are not in the register (3,899 numbers): another checkbook, or checks not entered here". */
export function gapText(g) {
  if (!g) return "";
  if (g.count === 1) return "#" + g.from + " missing — spoil it or find it";
  if (g.small) return "#" + g.from + "–#" + g.to + " missing (" + g.count + ") — spoil them or find them";
  return "#" + g.from + "–#" + g.to + " are not in the register (" + g.count.toLocaleString("en-US") + " numbers): another checkbook, or checks not entered here";
}

/* ── filters ───────────────────────────────────────────────────────────── */

/** The months the rows fall in, newest first: [{id: "2026-10", label: "October 2026"}]. */
export function monthsOf(rows) {
  const set = Array.from(new Set((rows || []).map((r) => r.month).filter((m) => /^\d{4}-\d{2}$/.test(m)))).sort().reverse();
  return set.map((m) => ({ id: m, label: monthLabel(m) }));
}
export function monthLabel(m) {
  if (!/^\d{4}-\d{2}$/.test(String(m || ""))) return "";
  return new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 15)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}

/** f: {status ("" = all), month ("" = all), q (payee, job or number), from, to (check numbers)} -> the rows shown. */
export function filterRegister(rows, f) {
  const o = f || {};
  const q = txt(o.q).toLowerCase();
  const from = checkKey(o.from), to = checkKey(o.to);
  return (rows || []).filter((r) => {
    if (o.status && r.status !== o.status) return false;
    if (o.month && r.month !== o.month) return false;
    if (q && !(r.payee.toLowerCase().includes(q) || r.jobLabels.some((j) => j.toLowerCase().includes(q)) || r.number.toLowerCase().includes(q))) return false;
    if ((from && digitKey(from)) || (to && digitKey(to))) {
      if (!r.digits) return false;
      if (from && digitKey(from) && keyCompare(r.checkKey, from) < 0) return false;
      if (to && digitKey(to) && keyCompare(r.checkKey, to) > 0) return false;
    }
    return true;
  });
}

/** Whether any filter is set (gap lines are drawn among the rows only when none is). */
export function filtered(f) {
  const o = f || {};
  return !!(o.status || o.month || txt(o.q) || txt(o.from) || txt(o.to));
}

/* ── what each row offers (money editors; the database decides) ────────── */

/** {pickUp, undoPickUp, clear, unclear, void, unspoil} for a row: what the register's RPCs would take. */
export function rowActions(r, o) {
  const x = o || {};
  const live = (r && r.live) || [];
  const none = { pickUp: false, undoPickUp: false, clear: false, unclear: false, void: false, unspoil: false };
  if (!r) return none;
  if (r.kind === "spoiled") return Object.assign({}, none, { unspoil: r.spoiledId != null });
  if (!live.length) return none;
  const cleared = live.some((p) => p.clearedOn);
  return {
    pickUp: live.some((p) => !p.pickedUpAt && !p.clearedOn),
    undoPickUp: live.some((p) => p.pickedUpAt) && !cleared,
    clear: live.some((p) => !p.clearedOn),
    unclear: cleared,
    void: !!x.voidEnabled && !cleared,
    unspoil: false,
  };
}

/* ── the CSV (S4: the amount only with the prices switch) ─────────────── */

export function checkColumns(prices) {
  const cols = [
    ["Check No", (r) => r.number],
    ["Date", (r) => r.paidDate],
    ["Payee", (r) => r.payee],
    ["Jobs", (r) => r.jobs.join(" ")],
    ["Status", (r) => STATUS_WORDS[r.status] || r.status],
    ["Told", (r) => (r.toldAt ? dayOf(r.toldAt) + (r.toldHow ? " " + r.toldHow : "") : "")],
    ["Picked Up", (r) => r.pickedUpDay || ""],
    ["Cleared On", (r) => r.clearedOn || ""],
    ["Void or Spoiled Reason", (r) => r.voidReason || ""],
    ["Number Used Twice", (r) => (r.numberReused ? "Yes" : "")],
    ["Portal Payment IDs", (r) => r.paymentIds.join(" ")],
  ];
  if (prices) cols.splice(4, 0, ["Amount", (r) => (r.kind === "spoiled" || r.writtenAmount == null ? "" : num(r.writtenAmount).toFixed(2))]);
  return Object.freeze(cols);
}

/* ── the database's words ──────────────────────────────────────────────── */

/** The sentence for a refused check number: the database's own words for its 23505 (t11_payments_check_number,
    spoil_check), "" for any other error (the page then says errorText's). */
export function clashText(e) {
  if (!e || String(e.code) !== "23505") return "";
  const raw = txt(e.message);
  if (!/^check .+ (is already in the check register|is already marked spoiled|was written)/i.test(raw)) return "";
  const s = raw[0].toUpperCase() + raw.slice(1);
  return /[.!?]$/.test(s) ? s : s + ".";
}

/** "Next check: #1044 — after #1043 to Kestrel Lumber Supply, Oct 28" | "" (no number yet, or none read). */
export function nextText(next) {
  if (!next || !next.next) return "";
  const l = next.last;
  return "Next check: #" + next.next + (l && l.number ? " — after #" + txt(l.number) + (txt(l.payee) ? " to " + txt(l.payee) : "") +
    (l.paidDate ? ", " + shortDay(l.paidDate) : "") : "");
}

/** "Check register · Oct 1–Oct 28, 2026 · printed Oct 28, 2026 by Casey" - the printed page's header. */
export function printTitle(rows, today, who) {
  const days = (rows || []).map((r) => r.paidDate).filter(Boolean).sort();
  const long = (d) => (d ? new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "");
  const span = days.length ? (days[0] === days[days.length - 1] ? long(days[0]) : long(days[0]) + "–" + long(days[days.length - 1])) : "no checks";
  return "Check register · " + span + " · printed " + long(today) + (txt(who) ? " by " + txt(who) : "") + " · " + plural((rows || []).length, "line", "lines");
}
