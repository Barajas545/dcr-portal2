/* The project's Payments tab: money out to vendors (bills and the payments against them) and money in from
   the client (invoices and client payments) — BLUEPRINT 3.3.11 "The Books", MODULES §3 "Project tabs
   Expenses, Payments" (Redesign: the money rules are the database's — cap, method, approval).

   Read only. Bills are approved on bill.html (approve_bill: an admin, or a manager with the approve switch —
   accountants never); payments are recorded on The Books' check desk or in DCR Desktop 2. This module only
   says what state each thing is in, with DCR Desktop 2's own rules (dcrdesk/ui/pages/project/money_logic.py
   bill_state / decorate_bill / bill_totals / payment_text / told_text), so the two apps never name a bill
   differently:
   * a void bill counts for nothing; an unapproved bill is "Needs document" or "Waiting approval";
   * an approved bill's owed = approved amount − Σ payments; paid when nothing is owed; overdue when its due
     day (company day) has passed; "Part paid" once something was paid;
   * an invoice's total = Σ lines; paid = Σ client payments; balance = total − paid (never clamped on the row);
     only a SENT invoice is overdue (status_of); the figures (inv_logic.figures) count sent and paid invoices as
     invoiced and outstanding (Σ max(0, balance): an overpaid one is not owed back), drafts apart, collected over
     every live invoice - so the tab, the ledger's "Billed out" and Desktop 2's Invoices tab say the same.

   Pure module: no DOM, no network (node tests import it). */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function num(v) {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return 0;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
const cents = (n) => Math.round(num(n) * 100);
const text = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const day = (v) => { const s = String(v == null ? "" : v).slice(0, 10); return DAY_RE.test(s) ? s : ""; };

export const VOID = "void", NEEDS_DOC = "needs_document", WAITING = "waiting", APPROVED = "approved",
  PART_PAID = "part_paid", PAID = "paid", OVERDUE = "overdue";
export const BILL_STATE_TEXT = Object.freeze({
  void: ["Void", "muted"], needs_document: ["Needs document", "danger"], waiting: ["Waiting approval", "warning"],
  approved: ["Approved", "info"], part_paid: ["Part paid", "accent"], paid: ["Paid", "success"], overdue: ["Overdue", "danger"],
});
// how an approved bill is paid (M5b; owner decision 2026-10-21: also by bank transfer - ACH or wire - and by card)
export const PAY_METHOD_LABELS = Object.freeze({ check: "Check", cash: "Cash", both: "Check or cash", transfer: "Bank transfer", card: "Card" });
export const PAYMENT_LABELS = Object.freeze({ check: "Check", cash: "Cash", ach: "ACH transfer", card: "Card", wire: "Wire transfer", other: "Other" });
export const INVOICE_STATUS = Object.freeze({ draft: "Draft", sent: "Sent", paid: "Paid", void: "Void" });
/** M5b bills.kind: Subcontractor | Material supplier | Equipment | Other (the word, whichever way it is stored). */
export const BILL_KIND_LABELS = Object.freeze({ subcontractor: "Subcontractor", material_supplier: "Material supplier", material: "Material supplier",
  supplier: "Material supplier", equipment: "Equipment", other: "Other" });
export function billKindLabel(v) {
  const k = text(v);
  if (!k) return "";
  return BILL_KIND_LABELS[k.toLowerCase().replace(/[\s-]+/g, "_")] || k;
}

export function billVendor(b) { return text(b && b.vendor_name) || ("Bill " + ((b && b.id) || "")).trim(); }
export function refTag(v) { const s = text(v).replace(/^#+/, "").trim(); return s ? "#" + s : ""; }
export function isApproved(b) { return !!(b && b.approved_at); }

/** Desktop 2's bill_state(bill, paid, today). */
export function billState(b, paid, today) {
  const x = b || {};
  if (x.void) return VOID;
  if (!isApproved(x)) return x.document_file_id ? WAITING : NEEDS_DOC;
  const owed = cents(x.approved_amount) - cents(paid);
  if (owed <= 0) return PAID;
  const due = day(x.due_date);
  if (due && today && due < today) return OVERDUE;
  return cents(paid) > 0 ? PART_PAID : APPROVED;
}

/** A voided payment (the check register's Void, migration 20261030000300): kept in the list, marked, counted nowhere. */
export function isVoidPayment(p) { return !!(p && p.voided_at); }

/** A bill row (with its embedded `payments`) -> the tab's bill: paid, owed, state, its payments in order (a voided one
    stays listed with voided: true, and counts in no sum - Desktop 2.25's decorate_bill, app.bill_paid_total). */
export function decorateBill(b, today) {
  const pays = (Array.isArray(b && b.payments) ? b.payments : []).slice().sort((p, q) =>
    (day(p.paid_date) < day(q.paid_date) ? -1 : day(p.paid_date) > day(q.paid_date) ? 1 : (Number(p.id) || 0) - (Number(q.id) || 0)))
    .map((p) => Object.assign({}, p, { voided: isVoidPayment(p) }));
  const paid = pays.reduce((s, p) => (p.voided ? s : s + cents(p.amount)), 0) / 100;
  const approved = isApproved(b);
  const voided = !!(b && b.void);
  const owed = approved && !voided ? Math.max(0, cents(b.approved_amount) - Math.round(paid * 100)) / 100 : 0;
  const state = billState(b, paid, today);
  return { bill: b, id: b.id, vendor: billVendor(b), number: refTag(b.invoice_number), amount: num(b.amount),
    approvedAmount: approved ? num(b.approved_amount) : null, payMethod: b.pay_method || null, paid, owed, state,
    stateText: BILL_STATE_TEXT[state][0], tone: BILL_STATE_TEXT[state][1], approved, voided, hasDoc: !!b.document_file_id, kind: billKindLabel(b.kind),
    payments: pays, invoiceDate: day(b.invoice_date), dueDate: day(b.due_date), description: text(b.description) };
}

/** Open bills first (by due day, none last), then paid, then void (Desktop 2's bill_sort_key). */
export function billOrder(a, b) {
  const rank = { overdue: 0, needs_document: 1, waiting: 1, approved: 2, part_paid: 2, paid: 3, void: 4 };
  const r = (rank[a.state] === undefined ? 5 : rank[a.state]) - (rank[b.state] === undefined ? 5 : rank[b.state]);
  if (r) return r;
  const da = a.dueDate || "9999-12-31", db = b.dueDate || "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  return (Number(b.id) || 0) - (Number(a.id) || 0);
}

/** Over decorated bills: count, billed, waiting (unapproved), paid, owed, overdue. Void bills count for nothing. */
export function billTotals(list) {
  const live = (list || []).filter((b) => !b.voided);
  const waiting = live.filter((b) => !b.approved);
  const sum = (arr, k) => arr.reduce((s, b) => s + cents(b[k]), 0) / 100;
  return { count: live.length, billed: sum(live, "amount"), waiting: sum(waiting, "amount"), waitingCount: waiting.length,
    paid: sum(live, "paid"), owed: sum(live, "owed"), overdue: live.some((b) => b.state === OVERDUE) };
}

/** "Oct 6, 2026 · Check · #5203" (the amount is drawn in its own cell). */
export function paymentText(p, fmtDay) {
  const f = typeof fmtDay === "function" ? fmtDay : (v) => v;
  const bits = [day(p.paid_date) ? f(day(p.paid_date)) : "", PAYMENT_LABELS[p.method] || "Payment"];
  if (p.check_number) bits.push(refTag(p.check_number));
  else if (p.reference) bits.push(text(p.reference));
  return bits.filter(Boolean).join(" · ");
}
/** A check or cash payment is picked up: someone tells the payee it is ready (by hand, or DCR Agents 2). */
export function pickupPayment(p) { return ["check", "cash"].indexOf(String((p && p.method) || "")) !== -1; }
/** "Told it is ready Oct 20, 2026 · text · DCR Agents 2" ("" while nobody was told). */
export function toldText(p, fmtDay) {
  if (!p || !p.pickup_told_at) return "";
  const f = typeof fmtDay === "function" ? fmtDay : (v) => v;
  return ["Told it is ready " + f(p.pickup_told_at), text(p.pickup_told_how), text(p.pickup_told_by)].filter(Boolean).join(" · ");
}

/** An invoice row (with `invoice_lines(amount)` and `client_payments(...)`) -> total, paid, balance. */
export function decorateInvoice(iv, today) {
  const lines = Array.isArray(iv && iv.invoice_lines) ? iv.invoice_lines : [];
  const pays = (Array.isArray(iv && iv.client_payments) ? iv.client_payments : []).slice()
    .sort((p, q) => (day(p.paid_date) < day(q.paid_date) ? -1 : day(p.paid_date) > day(q.paid_date) ? 1 : 0));
  const total = lines.reduce((s, l) => s + cents(l.amount), 0) / 100;
  const paid = pays.reduce((s, p) => s + cents(p.amount), 0) / 100;
  const voided = iv.status === "void";
  const balance = voided ? 0 : (Math.round(total * 100) - Math.round(paid * 100)) / 100;
  const due = day(iv.due_date);
  // Desktop 2's status_of: an unknown status reads as a draft; only a sent invoice past its due day is overdue
  const status = INVOICE_STATUS[iv.status] ? iv.status : "draft";
  return { invoice: iv, id: iv.id, number: text(iv.number), status, statusText: INVOICE_STATUS[status], draft: status === "draft",
    date: day(iv.invoice_date), dueDate: due, total, paid, balance, voided, payments: pays,
    overdue: status === "sent" && balance > 0 && !!due && !!today && due < today, description: text(iv.description) };
}
/** Desktop 2's inv_logic.figures over decorated invoices (void ones count for nothing): invoiced = Σ total of the sent
    and paid ones, outstanding = Σ max(0, balance) of those, drafts = Σ total of the drafts (not billed yet), collected =
    Σ paid of every live one; counts. */
export function invoiceTotals(list) {
  const live = (list || []).filter((i) => !i.voided);
  const sent = live.filter((i) => i.status === "sent" || i.status === "paid");
  const drafts = live.filter((i) => i.status !== "sent" && i.status !== "paid");
  const sum = (arr, f) => arr.reduce((s, i) => s + cents(f(i)), 0) / 100;
  return { count: live.length, sentCount: sent.length, draftCount: drafts.length,
    invoiced: sum(sent, (i) => i.total), collected: sum(live, (i) => i.paid),
    outstanding: sum(sent, (i) => Math.max(0, num(i.balance))), drafts: sum(drafts, (i) => i.total),
    overdue: live.filter((i) => i.overdue).length };
}
