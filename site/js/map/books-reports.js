/* The Books reports (books-reports.html; the Books program, release B part 2b: DCR Desktop 2 migration
   20261030000500_books_reports, docs/DATABASE.md §35; the build plan's I25 and S4). THE MATH IS THE DATABASE'S (I25):
   AP aging, the vendor balances, the 1099 worksheet and payments by month come from its four report functions; the
   approval log is a plain read of money_messages (§34) and the money history of money_events (§33). This module only
   shapes, words and the CSV. Pure: no DOM, no network (node tests import it).

   * REPORTS / DEFERRED     the six reports, and the one line that says AR aging and job profit are not here (phase 5);
   * PRESETS / periodOf(id, today)   This month · Last month · This year · Last year · Last 90 days (company days);
   * toAging(row) / agingTotals(rows) / AGING_BUCKETS / AGING_COLUMNS          books_ap_aging, by vendor on a day;
   * vendorBalanceColumns   books_vendor_balances (map/vendors.js toVendor shapes the rows);
   * toMonth(row) / monthTotals(rows) / MONTH_COLUMNS / METHOD_WORDS           books_payments_by_month;
   * PAYMENT_LINE_COLUMNS (map/checks.js PAYMENT_COLUMNS) and toPaymentLine     one line a payment, for keying;
   * approvalRows(messages, ctx) / APPROVAL_COLUMNS   one line per person asked: when, by whom, how, what became of it,
     the bills, when the bill was approved and how long it took;
   * EVENT_WORDS / EVENT_GROUPS / toEvent(row, ctx) / detailText(kind, detail) / filterEvents / HISTORY_COLUMNS
     money_events in words (never a message body or an address: the database keeps none there);
   * csvFile(report, a, b) / printLine(title, period, today, who)   the file's name and the printed page's header.
   Every CSV goes through map/books.js toCsv (every cell quoted, the formula guard, a BOM, CRLF). The whole page needs the
   financials AND prices switches before it reads anything (money_events carries amounts: S4). */

import { num, dayOf, shortDay, plural } from "./books.js";
import { PAYMENT_COLUMNS, monthLabel } from "./checks.js";
import { toMessage, whenShort, messageStatus } from "./money-messages.js";

export const REPORTS = Object.freeze([
  { id: "aging", label: "Unpaid bills by age", short: "AP aging" },
  { id: "vendors", label: "Vendor balances", short: "Vendors" },
  { id: "1099", label: "1099 worksheet", short: "1099" },
  { id: "months", label: "Payments by month", short: "By month" },
  { id: "approvals", label: "Approval requests", short: "Approvals" },
  { id: "history", label: "Money history", short: "History" },
]);
export const DEFERRED = "Not here yet: money owed to us by age (AR aging) and job profit - QuickBooks keeps the receivables, and DCR Desktop 2's project Money tab shows a job's money.";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const money = (v) => (v === null || v === undefined ? null : Math.round(num(v) * 100) / 100);
const fixed = (v) => (v === null || v === undefined ? "" : num(v).toFixed(2));
const ids = (v) => (Array.isArray(v) ? v : []).filter((x) => x !== null && x !== undefined).map((x) => String(x));

/* ── periods (company days) ── */

function addDayKey(k, n) {
  return new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) + n)).toISOString().slice(0, 10);
}
export const PRESETS = Object.freeze([
  { id: "month", label: "This month" }, { id: "lastmonth", label: "Last month" }, { id: "year", label: "This year" },
  { id: "lastyear", label: "Last year" }, { id: "90", label: "Last 90 days" }, { id: "30", label: "Last 30 days" },
]);
/** {from, to} of a preset on the company's today. */
export function periodOf(id, today) {
  const t = dayOf(today);
  if (!DAY.test(t)) return { from: "", to: "" };
  const y = +t.slice(0, 4), m = +t.slice(5, 7);
  const first = (yy, mm) => new Date(Date.UTC(yy, mm - 1, 1)).toISOString().slice(0, 10);
  switch (id) {
    case "month": return { from: first(y, m), to: t };
    case "lastmonth": return { from: first(y, m - 1), to: addDayKey(first(y, m), -1) };
    case "year": return { from: y + "-01-01", to: t };
    case "lastyear": return { from: (y - 1) + "-01-01", to: (y - 1) + "-12-31" };
    case "90": return { from: addDayKey(t, -89), to: t };
    default: return { from: addDayKey(t, -29), to: t };
  }
}
/** "Oct 1, 2026 – Oct 29, 2026" */
export function periodWords(from, to) {
  const long = (d) => (DAY.test(d) ? new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "");
  if (!DAY.test(from) && !DAY.test(to)) return "";
  if (from === to) return long(from);
  return long(from) + " – " + long(to);
}
/** The page's early word on a period ("" when fine; the database checks again). */
export function periodProblem(from, to) {
  if (!DAY.test(String(from || "")) || !DAY.test(String(to || ""))) return "Pick both days.";
  if (to < from) return "The second day is before the first.";
  return "";
}

/* ── AP aging (books_ap_aging) ── */

export const AGING_BUCKETS = Object.freeze([
  ["current", "Not due yet"], ["d1_30", "1–30 days late"], ["d31_60", "31–60"], ["d61_90", "61–90"], ["d90_plus", "Over 90"], ["no_due", "No due date"],
]);
export function toAging(row) {
  const r = row || {};
  const cid = r.vendor_contact_id === null || r.vendor_contact_id === undefined ? null : Number(r.vendor_contact_id);
  return {
    asOf: dayOf(r.as_of), contactId: cid, linked: cid !== null, key: txt(r.vendor_key), name: txt(r.vendor_name) || "(no name)",
    openBills: Number(r.open_bills) || 0, current: money(r.current), d1_30: money(r.d1_30), d31_60: money(r.d31_60), d61_90: money(r.d61_90),
    d90_plus: money(r.d90_plus), no_due: money(r.no_due), waiting: money(r.waiting_approval), total: money(r.total),
    oldestDue: dayOf(r.oldest_due_date), billIds: ids(r.bill_ids),
  };
}
/** The buckets added up over the vendors (a sum of the database's own figures, for the table's last line). */
export function agingTotals(rows) {
  const t = { openBills: 0, waiting: 0, total: 0 };
  AGING_BUCKETS.forEach((b) => { t[b[0]] = 0; });
  (rows || []).forEach((r) => {
    AGING_BUCKETS.forEach((b) => { t[b[0]] += num(r[b[0]]); });
    t.waiting += num(r.waiting); t.total += num(r.total); t.openBills += r.openBills || 0;
  });
  Object.keys(t).forEach((k) => { if (k !== "openBills") t[k] = Math.round(t[k] * 100) / 100; });
  return t;
}
export const AGING_COLUMNS = Object.freeze([
  ["As Of", (r) => r.asOf],
  ["Vendor", (r) => r.name],
  ["Open Bills", (r) => String(r.openBills)],
  ["Not Due Yet", (r) => fixed(r.current)],
  ["1-30 Days Late", (r) => fixed(r.d1_30)],
  ["31-60 Days Late", (r) => fixed(r.d31_60)],
  ["61-90 Days Late", (r) => fixed(r.d61_90)],
  ["Over 90 Days Late", (r) => fixed(r.d90_plus)],
  ["No Due Date", (r) => fixed(r.no_due)],
  ["Waiting Approval", (r) => fixed(r.waiting)],
  ["Total", (r) => fixed(r.total)],
  ["Oldest Due", (r) => r.oldestDue],
  ["Portal Bill IDs", (r) => r.billIds.join(" ")],
]);

/* ── vendor balances (books_vendor_balances; map/vendors.js toVendor) ── */

export const VENDOR_BALANCE_COLUMNS = Object.freeze([
  ["Vendor", (v) => v.name],
  ["Kind", (v) => v.kindLabel || (v.linked ? "" : "Not linked to a contact")],
  ["Bills", (v) => String(v.bills)],
  ["Open Bills", (v) => String(v.openBills)],
  ["Billed", (v) => fixed(v.billed)],
  ["Approved", (v) => fixed(v.approved)],
  ["Paid", (v) => fixed(v.paid)],
  ["Owed", (v) => fixed(v.owed)],
  ["Past Due", (v) => fixed(v.pastDue)],
  ["Waiting Approval", (v) => fixed(v.waiting)],
  ["Paid This Year", (v) => fixed(v.paidYtd)],
  ["Paid Last Year", (v) => fixed(v.paidLastYear)],
  ["Last Paid", (v) => v.lastPaidDate || ""],
  ["W-9 Missing", (v) => (v.linked && v.w9Missing ? "Yes" : "")],
  ["Insurance Expired", (v) => (v.insuranceExpired ? "Yes" : "")],
  ["Workers Comp Expired", (v) => (v.wcExpired ? "Yes" : "")],
  ["Portal Contact ID", (v) => (v.contactId === null ? "" : String(v.contactId))],
]);

/* ── payments by month (books_payments_by_month) ── */

export const METHOD_WORDS = Object.freeze({ check: "Check", cash: "Cash", ach: "ACH", wire: "Wire", card: "Card", other: "Other" });
export function toMonth(row) {
  const r = row || {};
  const m = dayOf(r.month).slice(0, 7);
  const cash = txt(r.method).toLowerCase() === "cash";
  const n = (v) => (v === null || v === undefined ? null : Number(v) || 0);
  return {
    month: m, monthLabel: monthLabel(m), method: txt(r.method).toLowerCase(), methodLabel: METHOD_WORDS[txt(r.method).toLowerCase()] || txt(r.method),
    payments: Number(r.payments) || 0, total: money(r.total), voided: Number(r.voided) || 0, voidedTotal: money(r.voided_total),
    cleared: cash ? null : n(r.cleared), clearedTotal: cash ? null : money(r.cleared_total),
    notCleared: cash ? null : n(r.not_cleared), notClearedTotal: cash ? null : money(r.not_cleared_total),
  };
}
/** Per month: its lines and its sums (live, voided), in the database's order. */
export function monthTotals(rows) {
  const out = [];
  const at = new Map();
  (rows || []).forEach((r) => {
    let g = at.get(r.month);
    if (!g) { g = { month: r.month, monthLabel: r.monthLabel, lines: [], payments: 0, total: 0, voided: 0, voidedTotal: 0 }; at.set(r.month, g); out.push(g); }
    g.lines.push(r);
    g.payments += r.payments; g.total += num(r.total); g.voided += r.voided; g.voidedTotal += num(r.voidedTotal);
  });
  out.forEach((g) => { g.total = Math.round(g.total * 100) / 100; g.voidedTotal = Math.round(g.voidedTotal * 100) / 100; });
  return out;
}
export const MONTH_COLUMNS = Object.freeze([
  ["Month", (r) => r.month],
  ["Method", (r) => r.methodLabel],
  ["Payments", (r) => String(r.payments)],
  ["Total", (r) => fixed(r.total)],
  ["Voided", (r) => String(r.voided)],
  ["Voided Total", (r) => fixed(r.voidedTotal)],
  ["Cleared", (r) => (r.cleared === null ? "" : String(r.cleared))],
  ["Cleared Total", (r) => fixed(r.clearedTotal)],
  ["Not Cleared", (r) => (r.notCleared === null ? "" : String(r.notCleared))],
  ["Not Cleared Total", (r) => fixed(r.notClearedTotal)],
]);

/** One live payment for the Bill payments CSV (QuickBooks keying): payments + its bill + its job. */
export function toPaymentLine(p, ctx) {
  const c = ctx || {};
  const b = c.bills ? c.bills.get(String(p.bill_id)) : null;
  const pr = b && c.projects ? c.projects.get(String(b.project_id)) : null;
  return {
    id: p.id, paidDate: dayOf(p.paid_date), payee: txt(p.payee) || txt(b && b.vendor_name), vendor: txt(b && b.vendor_name) || txt(p.payee),
    invoiceNumber: txt(b && b.invoice_number), amount: money(p.amount), method: txt(p.method).toLowerCase(),
    ref: txt(p.method).toLowerCase() === "check" ? txt(p.check_number) : txt(p.reference),
    projectLabel: pr ? (txt(pr.number) + (txt(pr.name) ? " — " + txt(pr.name) : "")).trim() : "",
  };
}
export const PAYMENT_LINE_COLUMNS = PAYMENT_COLUMNS;

/* ── the approval log (money_messages) ── */

function hoursWords(a, b) {
  const t0 = Date.parse(a || ""), t1 = Date.parse(b || "");
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return "";
  const hrs = (t1 - t0) / 3600000;
  if (hrs < 1) return Math.max(1, Math.round(hrs * 60)) + " min";
  if (hrs < 48) return Math.round(hrs) + " h";
  return Math.round(hrs / 24) + " days";
}
/** A bill in a few words: "Kestrel Lumber #4101 · A303". */
export function billWords(b, projects) {
  if (!b) return "";
  const pr = projects ? projects.get(String(b.project_id)) : null;
  return (txt(b.vendor_name) || "(no vendor)") + (txt(b.invoice_number) ? " #" + txt(b.invoice_number) : "") + (pr && txt(pr.number) ? " · " + txt(pr.number) : "");
}

/** One line per person asked (newest first). ctx: {bills: Map id -> bills row, projects, nameOf(uid)}. */
export function approvalRows(messages, ctx) {
  const c = ctx || {};
  const nameOf = c.nameOf || (() => "");
  return (messages || []).map((x) => (x && x.billIds ? x : toMessage(x))).filter((m) => m.kind === "approval_request").map((m) => {
    const bills = m.billIds.map((id) => (c.bills ? c.bills.get(String(id)) : null)).filter(Boolean);
    const approvedAt = bills.length && bills.every((b) => b.approved_at) ? bills.map((b) => b.approved_at).sort().pop() : null;
    const approvedBy = Array.from(new Set(bills.map((b) => b.approved_by).filter(Boolean))).map((u) => nameOf(u) || "someone");
    const st = messageStatus(m);
    return {
      id: m.id, at: m.createdAt, atWords: whenShort(m.createdAt), day: dayOf(m.createdAt), by: m.createdBy, byName: nameOf(m.createdBy) || "",
      toName: m.toName || "(nobody named)", channel: m.channel, how: m.channel === "sms" ? "text (by hand)" : "e-mail", status: m.status,
      outcome: st.text, outcomeCls: st.cls, bills: bills.map((b) => billWords(b, c.projects)), billIds: m.billIds,
      approvedAt, approvedWords: approvedAt ? whenShort(approvedAt) + (approvedBy.length ? " by " + approvedBy.join(", ") : "") : "",
      took: approvedAt ? hoursWords(m.createdAt, approvedAt) : "",
    };
  }).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")) || Number(b.id) - Number(a.id));
}
export const APPROVAL_COLUMNS = Object.freeze([
  ["Asked", (r) => r.atWords],
  ["Asked By", (r) => r.byName],
  ["Asked Who", (r) => r.toName],
  ["How", (r) => r.how],
  ["Outcome", (r) => r.outcome],
  ["Bills", (r) => r.bills.join("; ")],
  ["Approved", (r) => r.approvedWords || "not yet"],
  ["Took", (r) => r.took],
  ["Portal Bill IDs", (r) => r.billIds.join(" ")],
]);

/* ── the money history (money_events) ── */

export const EVENT_WORDS = Object.freeze({
  bill_added: "Bill added", bill_changed: "Bill changed", bill_approved: "Bill approved", bill_unapproved: "Approval withdrawn",
  bill_pay_method: "How to pay set", bill_voided: "Bill voided", bill_deleted: "Bill deleted", bill_restored: "Bill restored",
  bill_entered: "Entered in QuickBooks", bill_unentered: "QuickBooks mark undone", payment_recorded: "Payment recorded",
  payment_changed: "Payment changed", payment_voided: "Payment voided", payment_deleted: "Payment deleted", payment_told: "Payee told",
  payment_untold: "Told mark taken off", payment_picked_up: "Picked up", payment_pickup_undone: "Picked-up mark taken off",
  payment_cleared: "Cleared the bank", payment_uncleared: "Cleared mark taken off", file_attached: "File attached", file_removed: "File removed",
  message_queued: "E-mail queued", message_sent: "E-mail sent", message_not_sent: "E-mail not sent", text_sent: "Text sent by hand",
  text_cancelled: "Text not sent", vendor_changed: "Vendor details changed", check_spoiled: "Blank check spoiled",
  check_unspoiled: "Spoiled mark taken off", template_saved: "Message template saved", template_reset: "Message template reset",
});
export const EVENT_GROUPS = Object.freeze([
  { id: "", label: "Everything" },
  { id: "bill", label: "Bills", kinds: ["bill_added", "bill_changed", "bill_approved", "bill_unapproved", "bill_pay_method", "bill_voided", "bill_deleted", "bill_restored", "bill_entered", "bill_unentered"] },
  { id: "payment", label: "Payments", kinds: ["payment_recorded", "payment_changed", "payment_voided", "payment_deleted", "payment_told", "payment_untold", "payment_picked_up", "payment_pickup_undone", "payment_cleared", "payment_uncleared", "check_spoiled", "check_unspoiled"] },
  { id: "file", label: "Files", kinds: ["file_attached", "file_removed"] },
  { id: "message", label: "Messages", kinds: ["message_queued", "message_sent", "message_not_sent", "text_sent", "text_cancelled", "template_saved", "template_reset"] },
  { id: "vendor", label: "Vendors", kinds: ["vendor_changed"] },
]);
const FIELD_WORDS = { amount: "amount", vendorContactId: "vendor", vendorName: "vendor name", invoiceNumber: "invoice number", documentFileId: "document",
  void: "void", method: "method", checkNumber: "check number", paidDate: "date", payee: "payee", reference: "reference", memo: "memo",
  // vendor_changed (t97_vendor_profiles_money_events): the database's own camelCase keys
  tax1099: "1099", legalName: "legal name", w9ReceivedOn: "W-9 date", insuranceExpiresOn: "insurance date", workersCompExpiresOn: "workers' comp date",
  workersCompExempt: "workers' comp exempt", licenseNumber: "license", contactId: "contact", notes: "notes", payMethod: "how to pay" };
const PAY_WORDS = { check: "check", cash: "cash", both: "check or cash", transfer: "bank transfer", card: "card" };
const TOLD = { phone: "by phone", "in person": "in person", email: "by e-mail", "text message": "by text", text: "by text" };
const SHORT = 80;
function short(v) {
  const s = txt(typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : "");
  return s.length > SHORT ? s.slice(0, SHORT - 1) + "…" : s;
}
/* the fields in FIELD_WORDS' order (a jsonb object's keys come back in its own order: by length), any other after */
const FIELD_ORDER = Object.keys(FIELD_WORDS);
function changedFields(d, skip) {
  const pos = (k) => { const i = FIELD_ORDER.indexOf(k); return i === -1 ? FIELD_ORDER.length : i; };
  return Object.keys(d || {}).filter((k) => !(skip || []).includes(k) && k !== "backfilled")
    .sort((a, b) => pos(a) - pos(b) || (a < b ? -1 : a > b ? 1 : 0)).map((k) => FIELD_WORDS[k] || k.replace(/_/g, " "));
}

/** An event's detail in a few words - only its ids, states and short facts (the database keeps no body or address). */
export function detailText(kind, detail) {
  const d = detail && typeof detail === "object" && !Array.isArray(detail) ? detail : {};
  const v = (k) => (Array.isArray(d[k]) ? d[k] : d[k]);
  const pair = (k) => (Array.isArray(d[k]) && d[k].length === 2 ? short(PAY_WORDS[d[k][0]] || d[k][0]) + " → " + short(PAY_WORDS[d[k][1]] || d[k][1]) : short(PAY_WORDS[d[k]] || d[k]));
  let s = "";
  switch (kind) {
    case "bill_changed": case "payment_changed": {
      const f = changedFields(d);
      s = f.length ? "changed: " + f.join(", ") : "";
      break;
    }
    case "vendor_changed": {
      // a first save says what it set ({added: true, ...}); a later one what changed
      const f = changedFields(d, ["added"]);
      s = f.length ? (d.added ? "added: " : "changed: ") + f.join(", ") : d.added ? "added" : "";
      break;
    }
    case "bill_approved": s = (d.payMethod ? "to be paid by " + (PAY_WORDS[d.payMethod] || short(d.payMethod)) : "") + (d.note ? (d.payMethod ? " · " : "") + "note: " + short(d.note) : ""); break;
    case "bill_unapproved": s = d.why === "changed" ? "the bill was changed" : d.why === "withdrawn" ? "withdrawn by an approver" : ""; break;
    case "bill_pay_method": s = d.payMethod !== undefined ? pair("payMethod") : ""; break;
    case "bill_entered": case "bill_unentered": s = d.ref ? "ref " + short(d.ref) : ""; break;
    case "payment_recorded": case "payment_deleted":
      s = (d.method ? (PAY_WORDS[d.method] || METHOD_WORDS[d.method] || short(d.method)) : "") + (d.checkNumber ? " #" + short(d.checkNumber) : d.reference ? " " + short(d.reference) : "") +
        (d.paidDate ? " dated " + shortDay(d.paidDate) : "") + (kind === "payment_deleted" && d.told ? " (it was told)" : "");
      break;
    case "payment_voided": s = d.reason ? "why: " + short(d.reason) : ""; break;
    case "payment_told": case "payment_untold": s = (TOLD[String(d.how || "").toLowerCase()] || short(d.how)) + (d.by ? " (" + short(d.by) + ")" : ""); break;
    case "payment_picked_up": s = (d.on ? shortDay(d.on) : "") + (d.note ? (d.on ? " · " : "") + short(d.note) : ""); break;
    case "payment_pickup_undone": case "payment_uncleared": s = d.was ? "was " + shortDay(d.was) : ""; break;
    case "payment_cleared": s = d.on ? "on " + shortDay(d.on) : ""; break;
    case "file_attached": case "file_removed": s = short(d.name) + (d.restored ? " (restored)" : ""); break;
    case "message_queued": case "message_sent": case "message_not_sent": case "text_sent": case "text_cancelled":
      s = (d.messageKind === "approval_request" ? "ask to approve" : d.messageKind === "payment_pickup" ? "ready to pick up" : "") +
        (d.channel ? (d.messageKind ? " · " : "") + (d.channel === "sms" ? "text" : "e-mail") : "");
      break;
    case "check_spoiled": case "check_unspoiled": s = (d.number ? "#" + short(d.number) : "") + (d.reason ? (d.number ? " · " : "") + short(d.reason) : ""); break;
    case "template_saved": case "template_reset": s = (d.key ? short(String(d.key).replace(/_/g, " ")) : "") + (d.channel ? " · " + (d.channel === "sms" ? "text" : "e-mail") : ""); break;
    default: s = "";
  }
  if (d.backfilled) s = (s ? s + " · " : "") + "from before the history began";
  return s;
}

/** A money_events row -> the history's line. ctx: {bills: Map, projects: Map, contacts: Map (the vendor of a vendor_changed or a pick-up)}. */
export function toEvent(row, ctx) {
  const r = row || {};
  const c = ctx || {};
  const b = r.bill_id !== null && r.bill_id !== undefined && c.bills ? c.bills.get(String(r.bill_id)) : null;
  const pr = c.projects && (r.project_id !== null && r.project_id !== undefined) ? c.projects.get(String(r.project_id)) : null;
  const k = c.contacts && r.contact_id !== null && r.contact_id !== undefined ? c.contacts.get(String(r.contact_id)) : null;
  return {
    id: r.id, at: r.at || null, atWords: whenShort(r.at), day: dayOf(r.at), actor: txt(r.actor_name) || "System", kind: txt(r.kind),
    what: EVENT_WORDS[r.kind] || txt(r.kind).replace(/_/g, " "), billId: r.bill_id == null ? null : r.bill_id, paymentId: r.payment_id == null ? null : r.payment_id,
    bill: b ? billWords(b, c.projects) : r.bill_id != null ? "bill #" + r.bill_id : "",
    vendor: k ? txt(k.company) || txt(k.name) : "", job: pr ? txt(pr.number) : "", amount: r.amount === null || r.amount === undefined ? null : money(r.amount),
    detail: detailText(r.kind, r.detail),
  };
}
/** f: {group, q (who, bill, job, detail)}. */
export function filterEvents(rows, f) {
  const o = f || {};
  const g = EVENT_GROUPS.find((x) => x.id === o.group);
  const q = txt(o.q).toLowerCase();
  return (rows || []).filter((e) => {
    if (g && g.kinds && g.kinds.indexOf(e.kind) === -1) return false;
    if (q && !(e.actor.toLowerCase().includes(q) || e.bill.toLowerCase().includes(q) || String(e.vendor || "").toLowerCase().includes(q) || e.job.toLowerCase().includes(q) ||
      e.what.toLowerCase().includes(q) || e.detail.toLowerCase().includes(q))) return false;
    return true;
  });
}
export const HISTORY_COLUMNS = Object.freeze([
  ["When", (e) => e.atWords],
  ["Who", (e) => e.actor],
  ["What", (e) => e.what],
  ["Bill", (e) => e.bill],
  ["Vendor", (e) => e.vendor || ""],
  ["Job", (e) => e.job],
  ["Amount", (e) => fixed(e.amount)],
  ["Detail", (e) => e.detail],
  ["Portal Event ID", (e) => String(e.id == null ? "" : e.id)],
]);

/* ── files and the printed page ── */

/** "dcr-ap-aging-2026-10-29.csv", "dcr-payments-by-month-2026-01-01-to-2026-10-29.csv". */
export function csvFile(name, a, b) {
  const part = (v) => (DAY.test(String(v || "")) ? String(v) : "");
  const span = part(a) && part(b) && a !== b ? part(a) + "-to-" + part(b) : part(a) || part(b) || "today";
  return "dcr-" + String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + span + ".csv";
}
/** "Unpaid bills by age · as of Oct 29, 2026 · printed Oct 29, 2026 by Casey · 4 lines". */
export function printLine(title, period, today, who, count) {
  const long = (d) => (DAY.test(String(d || "")) ? new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "");
  return [txt(title), txt(period), "printed " + long(dayOf(today)) + (txt(who) ? " by " + txt(who) : ""), count === undefined ? "" : plural(count, "line", "lines")].filter(Boolean).join(" · ");
}
