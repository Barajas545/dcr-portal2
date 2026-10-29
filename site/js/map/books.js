/* The Books and the bill page: DCR Desktop 2 rows -> what accounting.html, bill.html and the home page's approvals
   card draw (port of the old lib/qbo.js, lib/checks.js, lib/payee.js and the accounting handler's to-do list;
   BLUEPRINT 3.3.11 "The Books (accountant's desk)" and "Bill approval page", Appendix A "accounting", P5 5b,
   acceptance checks 2, 3 and 5).

   * gates (hide controls only - the database decides every write, BLUEPRINT 2.1 principle 1):
       seesBooks(me)    the financials switch (admin, or an accountant / manager with it): bills, payments, invoices;
       canMoney(me)     app.can_edit('money'): record a payment, mark told, mark / unmark "entered in QuickBooks";
       canApprove(me)   app.can_approve(): an admin, or a manager with the approve switch (and financials).
                        An accountant NEVER approves (the owner's standing rule; approve_bill refuses them);
   * billState / blockedReason / byUrgency / daysLate   which pile a bill is in and why (old qbo.js);
   * toBill / toInvoice / toPayment                       rows -> the shapes the pages draw;
   * hasLiveDocument(row, files, documented)              whether a bill has its document: a LIVE file, never the bare
                                                          bills.document_file_id (a removed document leaves it behind);
   * PAY_METHODS / allowedMethods / payPile / payMethodWords / paymentLabel   how an approved bill is paid: check, cash,
                                                          either, a bank transfer (ACH or wire) or a card (owner
                                                          decision 2026-10-21) - the approver's choice binds;
   * buildDesk(rows, ctx)                                 every pile, the check desk, the "Pay by bank transfer or
                                                          card" list, the totals and the to-do list;
   * checkCap / amountAllowed / parseAmount               how much may still be paid (the FROZEN approved amount minus
                                                          what is paid - the database's payment trigger is the gate);
   * suggestPayee / suggestMemo / pickupMessage / resolvePayee   what goes on the check and who is told;
   * payDateBounds / payDateProblem                       the date written on a payment: the company's today - 400
                                                          days to today + 31 (the Books program, release A; I11);
   * csvCell / toCsv / BILL_COLUMNS / INVOICE_COLUMNS     the QuickBooks hand-off (Q13: a MANUAL CSV): every cell
                                                          quoted, a formula-looking cell made text, a BOM, CRLF;
   * approvalsQueue(bills, ctx)                           the home page's "waiting for approval" card (approvers);
   * refusedLines(refused, byId)                          mark_*_entered's refused[] in the accountant's words.

   Money (BLUEPRINT 2.1 principle 8): every page that uses this module is shown only with the financials switch, and
   the repository reads no money table without it (repo/books.js). Nothing here writes an activity row or a message
   to anyone: the pick-up message is a draft the accountant sends from their own mail.

   Pure module: no DOM, no network (node tests import it). */

import { ymd } from "./pacific.js";
import { toLedgerRow, ledgerView, COST_KINDS as LEDGER_COST_KINDS } from "./ledger.js";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MEMO_MAX = 100;          // payments.memo: 1..100 (M4)
export const PAYEE_MAX = 200;         // payments.payee: 1..200 (M4)
export const CHECK_NUMBER_MAX = 40;
export const REF_MAX = 80;            // the QuickBooks reference typed by the accountant
export const APPROVAL_NOTE_MAX = 300; // bills.approval_note

/* ── who may do what (UI only) ─────────────────────────────────────── */

function active(me) { return !!me && me.active !== false && me.role !== "agents"; }
export function seesBooks(me) { return active(me) && (me.role === "admin" || !!me.can_see_financials); }
export function canMoney(me) {
  return active(me) && (me.role === "admin" || ((me.role === "manager" || me.role === "accountant") && !!me.can_see_financials));
}
export function canApprove(me) {
  return active(me) && (me.role === "admin" || (me.role === "manager" && !!me.can_approve_payments && !!me.can_see_financials));
}

/* ── small helpers ─────────────────────────────────────────────────── */

export function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v == null ? "" : v).replace(/[$,\s]/g, "");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
const round = (n) => Math.round(n * 100) / 100;
const txt = (v) => String(v == null ? "" : v).trim();

/** "$1,234.56" */
export function fmtMoney(v) {
  return "$" + num(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A date stays as written; a timestamp becomes its company day (America/Los_Angeles). */
export function dayOf(v) {
  if (!v) return "";
  const s = String(v);
  if (DAY_RE.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) && s.length === 10) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d) ? "" : ymd(d);
}

/** Whole days a due date is past `today` (both "YYYY-MM-DD"); null when either is unknown. */
export function daysLate(due, today) {
  const a = dayOf(due), b = dayOf(today);
  if (!DAY_RE.test(a) || !DAY_RE.test(b)) return null;
  const at = (k) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
  return Math.round((at(b) - at(a)) / 86400000);
}

export function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

/* ── bill kinds (M5b bills.kind) and pay methods (bills.pay_method) ─── */

export const KINDS = Object.freeze([
  { id: "subcontractor", label: "Subcontractor" },
  { id: "material_supplier", label: "Material supplier" },
  { id: "equipment", label: "Equipment" },
  { id: "other", label: "Other" },
]);
/** The label of a bill kind however the database spells it ("Material supplier", "material_supplier", ...). */
export function kindLabel(v) {
  const k = txt(v).toLowerCase().replace(/[\s-]+/g, "_");
  if (!k) return "";
  const hit = KINDS.find((x) => x.id === k);
  return hit ? hit.label : txt(v);
}

/* bills.pay_method (M5b, owner decision 2026-10-21: DCR also pays vendors and subcontractors by bank transfer and by
   card): check | cash | both (check or cash) | transfer (ACH or wire) | card. The database's app.pay_method_allows is
   the rule; "other" is never a person's. */
export const PAY_METHODS = Object.freeze([
  { id: "check", label: "By check" },
  { id: "cash", label: "In cash" },
  { id: "both", label: "Either — check or cash, split if needed" },
  { id: "transfer", label: "By bank transfer (ACH or wire)" },
  { id: "card", label: "By card" },
]);
export function isPayMethod(v) { return PAY_METHODS.some((m) => m.id === txt(v).toLowerCase()); }
/** "by check" | "in cash" | "by check or in cash" | "by bank transfer (ACH or wire)" | "by card" | "" */
export function payMethodWords(v) {
  const m = txt(v).toLowerCase();
  return m === "check" ? "by check" : m === "cash" ? "in cash" : m === "both" ? "by check or in cash"
    : m === "transfer" ? "by bank transfer (ACH or wire)" : m === "card" ? "by card" : "";
}
/** What the accountant may pay this bill with: the approver decided (old checks.js allowedMethods; M5b's
    app.pay_method_allows): payments.method values. */
export function allowedMethods(payMethod) {
  const m = txt(payMethod).toLowerCase();
  if (m === "check") return ["check"];
  if (m === "cash") return ["cash"];
  if (m === "both") return ["check", "cash"];
  if (m === "transfer") return ["ach", "wire"];
  if (m === "card") return ["card"];
  return [];
}
/** Which pile pays it (books_desk.pay_pile): "check_desk" (check | cash | both - a check is written or cash handed
    over, and the payee told), "transfer_card" (transfer | card - sent from the bank or put on the card: no check number,
    nobody to tell), "" (no pay method said). */
export function payPile(payMethod) {
  const m = txt(payMethod).toLowerCase();
  return m === "check" || m === "cash" || m === "both" ? "check_desk" : m === "transfer" || m === "card" ? "transfer_card" : "";
}
/* One payment's method in words (payments.method). */
export const PAYMENT_LABELS = Object.freeze({ check: "Check", cash: "Cash", ach: "ACH transfer", wire: "Wire transfer", card: "Card", other: "Other" });
export function paymentLabel(method) { const m = txt(method).toLowerCase(); return PAYMENT_LABELS[m] || (m ? txt(method) : "Payment"); }
/* The bill's pay method in a CSV cell / a chip: Check | Cash | Check or cash | Bank transfer | Card. */
export const PAY_METHOD_LABELS = Object.freeze({ check: "Check", cash: "Cash", both: "Check or cash", transfer: "Bank transfer", card: "Card" });
/** What the pay panel's reference field asks for: {label, sub, placeholder}. `method` is the payment method picked
    (payments.method; "" while none is picked yet), `allowed` the bill's allowedMethods. A check asks for its number,
    cash for anything that helps, ACH / wire / card for the confirmation (optional). Before a method is picked, a bill
    that cannot be paid by check or cash (a bank transfer bill: ACH or wire) already asks for the bank's confirmation -
    only the check desk says "Check number" (review fix). */
export function refField(method, allowed) {
  const m = txt(method).toLowerCase();
  const can = (allowed || []).map((x) => txt(x).toLowerCase()).filter(Boolean);
  const bank = { label: "Confirmation number (optional)", sub: "The bank's confirmation — no check number, and nobody to tell." };
  const card = { label: "Confirmation number (optional)", sub: "The card's authorisation or receipt number — no check number, and nobody to tell.", placeholder: "e.g. AUTH 448120" };
  if (m === "cash") return { label: "Reference (optional)", sub: "Cash has no number of its own. Anything that helps you find it later.", placeholder: "e.g. petty cash slip" };
  if (m === "card") return card;
  if (m === "ach" || m === "wire") return Object.assign({ placeholder: "e.g. " + m.toUpperCase() + " 0041-7781" }, bank);
  if (m === "check" || !can.length || can.includes("check") || can.includes("cash")) {
    return { label: "Check number", sub: "So it can be found again.", placeholder: "e.g. 2041" };
  }
  return can.every((x) => x === "card") ? card : Object.assign({ placeholder: "e.g. 0041-7781" }, bank);
}

/* How they were told their check / cash is ready (payment_told: phone, in person, email, text). */
export const TOLD_HOWS = Object.freeze([
  { id: "email", label: "Told by email" },
  { id: "phone", label: "Told by phone" },
  { id: "text", label: "Told by text" },
  { id: "in person", label: "Told in person" },
]);

/* ── rows -> shapes ────────────────────────────────────────────────── */

/** {id -> label} of the projects: "A081 — House Remodeling". */
export function projectLabel(p) {
  if (!p) return "";
  return (txt(p.number) + (txt(p.name) ? " — " + txt(p.name) : "")).trim();
}

function byIdMap(rows, key) {
  const m = new Map();
  (rows || []).forEach((r) => { if (r && r[key || "id"] !== undefined && r[key || "id"] !== null) m.set(String(r[key || "id"]), r); });
  return m;
}

/** One row of the books_desk view (M5b) in a known shape, whatever its column names: {billId, state, paid, owed, pile,
    documented}. documented: the view's own answer (the document is a live file of the bill's project), null when the
    row does not say. */
export function deskRow(r) {
  if (!r) return null;
  const pick = (keys) => { for (const k of keys) if (r[k] !== undefined) return r[k]; return undefined; };
  const id = pick(["bill_id", "id"]);
  if (id === undefined || id === null) return null;
  const paid = pick(["paid_total", "paid", "paid_amount"]);
  const owed = pick(["owed", "owed_amount", "still_owed"]);
  return {
    billId: String(id),
    state: txt(pick(["state", "desk_state", "pile"])).toLowerCase() || null,
    reason: txt(pick(["reason", "why"])) || null,
    paid: paid === undefined || paid === null ? null : num(paid),
    owed: owed === undefined || owed === null ? null : num(owed),
    pile: txt(pick(["pay_pile", "pile"])).toLowerCase() || null,
    documented: typeof r.documented === "boolean" ? r.documented : null,
  };
}

/** Whether a bill has its document: bills.document_file_id names a LIVE file. A removed document leaves the pointer
    behind, and the database counts no such bill as documented (books_desk.documented, approve_bill, mark_bills_entered:
    app.file_in_project). The database's own answer wins (`documented`, else the row's own - a books_desk row carries
    it); else the pointer must name one of `files`, the live files read with the bill (current_files rows, or their
    ids: the bill page's paperwork, the same test its landing code makes). Nothing to judge it by: no document - never
    the bare pointer. */
export function hasLiveDocument(row, files, documented) {
  const r = row || {};
  if (r.document_file_id === null || r.document_file_id === undefined) return false;
  const said = typeof documented === "boolean" ? documented : r.documented;
  if (typeof said === "boolean") return said;
  const doc = String(r.document_file_id);
  return Array.from(files || []).some((f) => f !== null && f !== undefined && String(typeof f === "object" ? f.id : f) === doc);
}

/** A bill as the books draw it. ctx: {nameOf, projects (Map id -> row), contacts (Map), paid (Map billId -> sum),
    desk (Map billId -> deskRow), files (the live files read with the bill: hasLiveDocument), today}. */
export function toBill(row, ctx) {
  const c = ctx || {};
  const nameOf = c.nameOf || (() => "");
  const proj = c.projects ? c.projects.get(String(row.project_id)) : null;
  const contact = c.contacts && row.vendor_contact_id != null ? c.contacts.get(String(row.vendor_contact_id)) : null;
  const d = c.desk ? c.desk.get(String(row.id)) : null;
  const paid = d && d.paid !== null ? d.paid : num(c.paid ? c.paid.get(String(row.id)) : 0);
  const approved = !!row.approved_at;
  const approvedAmount = row.approved_amount === null || row.approved_amount === undefined ? null : num(row.approved_amount);
  const company = txt(contact && contact.company) || "";
  const person = txt(contact && contact.name) || "";
  const vendor = txt(row.vendor_name) || company || person;
  const b = {
    id: row.id,
    version: row.version == null ? null : Number(row.version),
    projectId: row.project_id,
    projectNumber: proj ? txt(proj.number) : "",
    projectName: proj ? txt(proj.name) : "",
    projectLabel: projectLabel(proj),
    projectAddress: proj ? [txt(proj.address), txt(proj.city)].filter(Boolean).join(", ") : "",
    estimateItemId: row.estimate_item_id == null ? null : row.estimate_item_id,
    quoteId: row.quote_id == null ? null : row.quote_id,
    vendorContactId: row.vendor_contact_id == null ? null : row.vendor_contact_id,
    vendor: vendor,
    vendorCompany: company || txt(row.vendor_name),
    vendorPerson: person && person !== (company || txt(row.vendor_name)) ? person : "",
    invoiceNumber: txt(row.invoice_number),
    invoiceDate: dayOf(row.invoice_date),
    dueDate: dayOf(row.due_date),
    amount: num(row.amount),
    description: txt(row.description),
    kind: txt(row.kind),
    kindLabel: kindLabel(row.kind),
    documentFileId: row.document_file_id == null ? null : row.document_file_id,
    // a LIVE document only (the pointer of a removed one stays behind): blocked, "No invoice attached", no Approve
    hasDocument: hasLiveDocument(row, c.files, d ? d.documented : null),
    void: row.void === true,
    deleted: !!row.deleted_at,
    approved: approved,
    approvedAt: row.approved_at || null,
    approvedDay: dayOf(row.approved_at),
    approvedBy: row.approved_by || null,
    approvedByName: nameOf(row.approved_by) || (row.approved_by ? "someone" : ""),
    approvedAmount: approvedAmount,
    payMethod: approved ? txt(row.pay_method).toLowerCase() : "",
    // which pile pays it: the database's answer (books_desk.pay_pile) when the view gave one
    pile: d && d.pile ? d.pile : approved ? payPile(row.pay_method) : "",
    approvalNote: txt(row.approval_note),
    entered: !!row.qbo_entered_at,
    enteredAt: row.qbo_entered_at || null,
    enteredDay: dayOf(row.qbo_entered_at),
    enteredBy: row.qbo_entered_by || null,
    enteredByName: nameOf(row.qbo_entered_by) || "",
    qboRef: txt(row.qbo_ref),
    loggedBy: row.created_by || null,
    loggedByName: nameOf(row.created_by) || "",
    loggedDay: dayOf(row.created_at),
    paid: round(paid),
    deskState: d && d.state ? d.state : null,
    deskReason: d && d.reason ? d.reason : null,
  };
  b.owed = d && d.owed !== null ? round(d.owed) : (approved ? round(Math.max(0, (approvedAmount === null ? b.amount : approvedAmount) - b.paid)) : 0);
  // a bill paid in full is late for nobody
  b.lateBy = approved && b.owed <= 0 && b.paid > 0 ? null : daysLate(b.dueDate, c.today);
  b.live = !b.void && !b.deleted && b.amount > 0;
  b.state = billState(b);
  b.reason = b.state === "blocked" || b.state === "waiting" ? (b.deskReason || blockedReason(b)) : "";
  return b;
}

/** A payment (to a vendor, against a bill). The check register's stamps (20261030000300_check_register: voided,
    picked up, cleared - system code's only) come along when the database has them; a voided payment is never live:
    it counts in no sum and nobody is told about it. */
export function toPayment(row) {
  return {
    id: row.id,
    version: row.version == null ? null : Number(row.version),
    billId: row.bill_id,
    projectId: row.project_id,
    paidDate: dayOf(row.paid_date),
    amount: num(row.amount),
    method: txt(row.method).toLowerCase() || "check",
    checkNumber: txt(row.check_number),
    reference: txt(row.reference),
    payee: txt(row.payee),
    memo: txt(row.memo),
    toldAt: row.pickup_told_at || null,
    toldDay: dayOf(row.pickup_told_at),
    toldBy: txt(row.pickup_told_by),
    toldHow: txt(row.pickup_told_how),
    // only a check or cash is picked up (and its payee told); a transfer or a card payment never is
    collectable: ["check", "cash"].includes(txt(row.method).toLowerCase()),
    voidedAt: row.voided_at || null,
    voidReason: txt(row.void_reason),
    voided: !!row.voided_at,
    live: !row.voided_at,
    pickedUpAt: row.picked_up_at || null,
    pickedUpDay: dayOf(row.picked_up_at),
    pickedUpNote: txt(row.picked_up_note),
    clearedOn: dayOf(row.cleared_on),
  };
}

/* The day written on a payment (I11; t01_payments_client): between the company's today - 400 days and today + 31 - a
   post-dated check happens; the database refuses anything else (22023). */
export const PAY_DAYS_BACK = 400;
export const PAY_DAYS_AHEAD = 31;
function addDayKey(k, n) {
  const d = new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}
/** {min, max} of the payment date picker, both "YYYY-MM-DD", from the company's `today`. */
export function payDateBounds(today) {
  const t = dayOf(today) || ymd(new Date());
  return { min: addDayKey(t, -PAY_DAYS_BACK), max: addDayKey(t, PAY_DAYS_AHEAD), today: t };
}
/** "" when `day` may be written on a payment today, else the sentence. */
export function payDateProblem(day, today) {
  const d = dayOf(day);
  const b = payDateBounds(today);
  if (!DAY_RE.test(d)) return "Pick the date on the check (or the day it was sent).";
  if (d < b.min) return "A payment can be dated at most " + PAY_DAYS_BACK + " days back (" + shortDay(b.min) + ", " + b.min.slice(0, 4) + ").";
  if (d > b.max) return "A payment can be dated at most " + PAY_DAYS_AHEAD + " days ahead (" + shortDay(b.max) + ", " + b.max.slice(0, 4) + ").";
  return "";
}

/** An invoice we sent (money in): amount = its lines, paid = its client payments. */
export function toInvoice(row, ctx) {
  const c = ctx || {};
  const nameOf = c.nameOf || (() => "");
  const proj = c.projects ? c.projects.get(String(row.project_id)) : null;
  const lines = Array.isArray(row.invoice_lines) ? row.invoice_lines : [];
  const pays = Array.isArray(row.client_payments) ? row.client_payments : [];
  const amount = round(lines.reduce((s, l) => s + num(l.amount), 0));
  const paid = round(pays.reduce((s, p) => s + num(p.amount), 0));
  const paidDate = pays.reduce((m, p) => (dayOf(p.paid_date) > m ? dayOf(p.paid_date) : m), "");
  const status = txt(row.status).toLowerCase();
  const iv = {
    id: row.id,
    version: row.version == null ? null : Number(row.version),
    projectId: row.project_id,
    projectLabel: projectLabel(proj),
    customer: proj ? txt(proj.client_name) : "",
    number: txt(row.number),
    invoiceDate: dayOf(row.invoice_date),
    dueDate: dayOf(row.due_date),
    sentDate: dayOf(row.sent_date),
    description: txt(row.description),
    status: status,
    sent: status === "sent" || status === "paid" || !!row.sent_date,
    isPaid: status === "paid",
    amount: amount,
    paid: paid,
    paidDate: paidDate,
    entered: !!row.qbo_entered_at,
    enteredAt: row.qbo_entered_at || null,
    enteredDay: dayOf(row.qbo_entered_at),
    enteredByName: nameOf(row.qbo_entered_by) || "",
    qboRef: txt(row.qbo_ref),
    deleted: !!row.deleted_at,
  };
  iv.live = !iv.deleted && status !== "void" && amount > 0;
  iv.lateBy = iv.isPaid ? null : daysLate(iv.dueDate, c.today);
  return iv;
}

/* ── piles (old qbo.js) ────────────────────────────────────────────── */

/* Why a bill is not ready to be entered, in the accountant's words. Order matters: the first sentence is the one
   thing to chase. */
export function blockedReason(b) {
  if (!b) return "This bill no longer exists.";
  if (b.void) return "Voided — nothing to enter.";
  if (!(num(b.amount) > 0)) return "No amount on it yet.";
  if (!b.hasDocument) return "No invoice attached, so it cannot be approved.";
  if (!b.approved) return "Waiting for a manager or admin to approve it.";
  return "";
}

/** ready | entered | waiting | blocked (books_desk's own answer wins when the view gave one). */
export function billState(b) {
  if (b.deskState && ["ready", "entered", "waiting", "blocked"].includes(b.deskState)) return b.deskState;
  if (!b.live) return "blocked";
  if (b.entered) return "entered";
  if (!b.approved) return b.hasDocument ? "waiting" : "blocked";
  return "ready";
}

/* Soonest due first, and the largest of a same-day batch first. */
export function byUrgency(a, b) {
  const da = a.dueDate || "9999-99-99", db = b.dueDate || "9999-99-99";
  return da.localeCompare(db) || num(b.amount) - num(a.amount) || Number(a.id) - Number(b.id);
}

/* ── the check desk (old checks.js) ────────────────────────────────── */

/* How much may still be paid: the FROZEN approved amount minus what is paid - never the bill's current amount
   (an edit of an approved amount clears the approval in the database). The database's payment trigger refuses
   anything over it (acceptance check 2); this is the page's own early word. */
export function checkCap(b) {
  if (!b) return { ok: false, cap: 0, paid: 0, approved: 0, reason: "That bill no longer exists." };
  if (b.void || b.deleted) return { ok: false, cap: 0, paid: 0, approved: 0, reason: "That bill was voided, so nothing is due on it." };
  if (!b.approved) {
    return { ok: false, cap: 0, paid: 0, approved: 0,
      reason: "It has not been approved for payment yet. A manager or admin has to authorise it first." };
  }
  const approved = round(num(b.approvedAmount));
  if (!(approved > 0)) {
    return { ok: false, cap: 0, paid: 0, approved: 0,
      reason: "The approved amount is missing on this bill, so there is no authorised figure to pay against." };
  }
  const paid = round(num(b.paid));
  const cap = round(approved - paid);
  if (!(cap > 0)) {
    return { ok: false, cap: 0, paid, approved,
      reason: paid > 0 ? "It is already paid in full — " + fmtMoney(paid) + " of " + fmtMoney(approved) + "." : "There is nothing left to pay on it." };
  }
  return { ok: true, cap, paid, approved, reason: "" };
}

/* An amount someone typed: "$4,500.00" -> 4500. Only a dollar sign, thousands commas and spaces are stripped;
   anything else is refused (a stripped minus would turn "-100" into a hundred-dollar check). NaN when refused. */
export function parseAmount(text) {
  const cleaned = String(text == null ? "" : text).trim().replace(/[$,\s]/g, "");
  return /^\d+(\.\d{1,2})?$/.test(cleaned) ? Number(cleaned) : NaN;
}

export function amountAllowed(amount, cap) {
  const a = round(num(amount));
  if (!Number.isFinite(Number(amount)) || !(a > 0)) return { ok: false, amount: 0, reason: "Enter the amount." };
  if (a > round(cap) + 0.005) return { ok: false, amount: a, reason: "That is more than the " + fmtMoney(cap) + " still authorised on this bill." };
  return { ok: true, amount: a, reason: "" };
}

/* What to write on the check: the COMPANY where there is one (a check made out to a person when the sub trades as a
   company is one the bank may refuse). Both are given so the accountant sees the choice. */
export function suggestPayee(b) {
  const company = txt(b && b.vendorCompany);
  const person = txt(b && b.vendorPerson);
  return {
    payee: (company || person || "").slice(0, PAYEE_MAX),
    company, person,
    note: company ? "" : person ? "Only a person's name is on file, no company." : "No payee on file.",
  };
}

/* The memo line: job first, then their invoice number, then the description, trimmed to a real memo field. */
export function suggestMemo(b) {
  const bits = [];
  if (txt(b && b.projectLabel)) bits.push(txt(b.projectLabel));
  if (txt(b && b.invoiceNumber)) bits.push("Inv " + txt(b.invoiceNumber));
  const desc = txt(b && b.description).replace(/\s+/g, " ");
  if (desc) bits.push(desc);
  const memo = bits.join(" · ");
  return memo.length > MEMO_MAX ? memo.slice(0, MEMO_MAX - 1).trimEnd() + "…" : memo;
}

/** The checks and cash still to hand over (toPay: the check desk), the bank transfers and card payments still to send
    (toSend: the "Pay by bank transfer or card" list - no check number, nobody to tell), the approved bills nobody said
    how to pay (toDecide), and who has not been told about a check or cash (toTell - never a voided payment, nor one
    already picked up: the check register's stamps): {toPay, toSend, toDecide, toTell, totals}. */
export function deskChecks(bills, payments) {
  const toPay = [], toSend = [], toDecide = [], toTell = [];
  const byBill = new Map();
  (payments || []).forEach((p) => {
    const k = String(p.billId);
    if (!byBill.has(k)) byBill.set(k, []);
    byBill.get(k).push(p);
  });
  for (const b of bills || []) {
    if (!b.live) continue;
    const cap = checkCap(b);
    if (cap.ok) {
      const s = suggestPayee(b);
      const entry = Object.assign({}, b, {
        owed: cap.cap, alreadyPaid: cap.paid, approvedFor: cap.approved, partial: cap.paid > 0,
        payee: s.payee, payeeCompany: s.company, payeePerson: s.person, payeeNote: s.note,
        memo: suggestMemo(b), allowed: allowedMethods(b.payMethod), pile: b.pile || payPile(b.payMethod),
      });
      if (!entry.allowed.length) toDecide.push(entry);
      else if (entry.pile === "transfer_card") toSend.push(entry);
      else toPay.push(entry);
    }
    for (const p of byBill.get(String(b.id)) || []) {
      // a check or cash nobody was told about - never a voided one, nor one already picked up (the check register)
      if (!p.collectable || p.toldAt || p.voided || p.pickedUpAt) continue;
      toTell.push({
        paymentId: p.id, version: p.version, billId: b.id, projectId: b.projectId, projectLabel: b.projectLabel,
        amount: p.amount, method: p.method, isCash: p.method === "cash",
        checkNumber: p.checkNumber || p.reference, writtenDate: p.paidDate,
        payee: p.payee || suggestPayee(b).payee, memo: p.memo || suggestMemo(b),
        invoiceNumber: b.invoiceNumber, vendorCompany: b.vendorCompany, vendorContactId: b.vendorContactId, quoteId: b.quoteId,
        vendor: b.vendor, vendorPerson: b.vendorPerson,
      });
    }
  }
  const byOldest = (a, b) => String(a.dueDate || a.writtenDate || "9999").localeCompare(String(b.dueDate || b.writtenDate || "9999")) ||
    num(b.owed !== undefined ? b.owed : b.amount) - num(a.owed !== undefined ? a.owed : a.amount);
  toPay.sort(byOldest); toSend.sort(byOldest); toDecide.sort(byOldest); toTell.sort(byOldest);
  const sum = (rows, k) => round(rows.reduce((n, r) => n + num(r[k]), 0));
  const byMethod = (id) => toPay.concat(toSend).filter((b) => b.payMethod === id);
  return {
    toPay, toSend, toDecide, toTell,
    totals: {
      toPayCount: toPay.length, toPayAmount: sum(toPay, "owed"),
      toSendCount: toSend.length, toSendAmount: sum(toSend, "owed"),
      outCount: toPay.length + toSend.length, outAmount: round(sum(toPay, "owed") + sum(toSend, "owed")),
      checkCount: byMethod("check").length, checkAmount: sum(byMethod("check"), "owed"),
      cashCount: byMethod("cash").length, cashAmount: sum(byMethod("cash"), "owed"),
      eitherCount: byMethod("both").length, eitherAmount: sum(byMethod("both"), "owed"),
      transferCount: byMethod("transfer").length, transferAmount: sum(byMethod("transfer"), "owed"),
      cardCount: byMethod("card").length, cardAmount: sum(byMethod("card"), "owed"),
      toDecideCount: toDecide.length, toDecideAmount: sum(toDecide, "owed"),
      toTellCount: toTell.length, toTellAmount: sum(toTell, "amount"),
    },
  };
}

/* What the accountant says to the sub. ONE message per check, built from that check's own amount: a pick-up notice
   is a statement about one piece of paper in a drawer, never the bill's remaining balance. A draft only - it is
   sent from the accountant's own mail (Portal 2 sends nothing itself). */
export function pickupMessage(o) {
  const x = o || {};
  const who = txt(x.company) || txt(x.payee) || "there";
  const job = txt(x.projectLabel);
  const subject = (x.isCash ? "Your payment is ready for pickup" : "Your check is ready for pickup") + (job ? " — " + job : "");
  const lines = ["Hello " + who + ",", "",
    (x.isCash ? "Your payment of " + fmtMoney(x.amount) + " in cash" : "Your check for " + fmtMoney(x.amount)) +
      " has been " + (x.isCash ? "prepared" : "written") + " and is ready to be picked up at our office."];
  if (job) lines.push("Job: " + job);
  if (txt(x.invoiceNumber)) lines.push("Against your invoice: " + txt(x.invoiceNumber));
  if (txt(x.checkNumber) && !x.isCash) lines.push("Check number: " + txt(x.checkNumber));
  lines.push("", "Please bring ID when you collect it.", "", "Thank you,", txt(x.from) || "DCR Framing");
  return { subject, body: lines.join("\n") };
}

/* ── who do we tell, and how do we reach them (old payee.js on Desktop 2's links) ─────────────────────────

   The bill's vendor contact (bills.vendor_contact_id) is a real link; an exact name in Contacts is somebody's
   typing, once; the quote the bill is billed against (bills.quote_id -> quotes.vendor_contact_id) is a real link
   too; a partial name match is a guess and is LABELLED one - telling the wrong company their money is waiting is
   worse than telling nobody. */
export function usableEmail(v) { const s = txt(v); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : ""; }
export function usablePhone(v) { const s = txt(v); return (s.match(/\d/g) || []).length >= 7 ? s : ""; }

const low = (v) => txt(v).toLowerCase();

export function resolvePayee(t, links) {
  const L = links || {};
  const contacts = L.contacts || new Map();
  const quotes = L.quotes || new Map();
  const nothing = { name: "", company: "", email: "", phone: "", source: "none", confidence: "none", why: "Nobody on file for this bill.", needsConfirming: false };
  if (!t) return nothing;
  const company = txt(t.vendorCompany), person = txt(t.vendorPerson) || txt(t.vendor);
  const reach = (c) => ({ email: usableEmail(c && c.email), phone: usablePhone(c && c.phone) });
  const named = (c) => txt(c.company) || txt(c.name);

  const own = t.vendorContactId != null ? contacts.get(String(t.vendorContactId)) : null;
  if (own) {
    const r = reach(own);
    if (r.email || r.phone) {
      return { name: txt(own.name), company: txt(own.company) || company, email: r.email, phone: r.phone, source: "contact",
        confidence: "likely", why: "The bill's vendor in Contacts (" + named(own) + ").", needsConfirming: false };
    }
  }
  const q = t.quoteId != null ? quotes.get(String(t.quoteId)) : null;
  const qc = q && q.vendor_contact_id != null ? contacts.get(String(q.vendor_contact_id)) : null;
  if (qc) {
    const r = reach(qc);
    if (r.email || r.phone) {
      return { name: txt(qc.name), company: txt(qc.company) || company, email: r.email, phone: r.phone, source: "quote",
        confidence: "likely", why: "From the quote this bill is billed against (" + named(qc) + ").", needsConfirming: false };
    }
  }
  const all = Array.from(contacts.values()).filter((c) => !c.deleted_at);
  for (const want of [low(company), low(person)]) {
    if (!want) continue;
    const exact = all.find((c) => (low(c.company) === want || low(c.name) === want) && (usableEmail(c.email) || usablePhone(c.phone)));
    if (exact) {
      const r = reach(exact);
      return { name: txt(exact.name), company: txt(exact.company) || company, email: r.email, phone: r.phone, source: "contacts",
        confidence: "likely", why: 'Matched "' + named(exact) + '" in Contacts.', needsConfirming: false };
    }
  }
  for (const want of [low(company), low(person)]) {
    if (want.length <= 3) continue;
    const loose = all.find((c) => (low(c.company).includes(want) || low(c.name).includes(want) ||
      (low(c.company).length > 3 && want.includes(low(c.company)))) && (usableEmail(c.email) || usablePhone(c.phone)));
    if (loose) {
      const r = reach(loose);
      return { name: txt(loose.name), company: txt(loose.company) || company, email: r.email, phone: r.phone, source: "contacts",
        confidence: "guess", why: 'Loosely matched "' + named(loose) + '" in Contacts — check this is them.', needsConfirming: true };
    }
  }
  return Object.assign({}, nothing, { name: person, company,
    why: company || person ? "No email or phone on file for " + (company || person) + "." : nothing.why });
}

/* ── the QuickBooks hand-off (Q13: a manual CSV; nothing talks to Intuit) ─────────────────────────────── */

/* One CSV field: always quoted; a cell beginning =, +, -, @, a tab or a carriage return is what a spreadsheet runs as
   a formula when the file is opened, so it is prefixed with an apostrophe (text). */
export function csvCell(value) {
  let s = String(value == null ? "" : value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export const BILL_COLUMNS = Object.freeze([
  ["Vendor", (b) => b.vendor || ""],
  ["Bill No", (b) => b.invoiceNumber || ""],
  ["Bill Date", (b) => b.invoiceDate || ""],
  ["Due Date", (b) => b.dueDate || ""],
  ["Amount", (b) => num(b.amount).toFixed(2)],
  ["Category", (b) => b.kindLabel || ""],
  ["Customer/Project", (b) => b.projectLabel || ""],
  ["Memo", (b) => b.description || ""],
  ["Approved By", (b) => b.approvedByName || ""],
  ["Approved On", (b) => b.approvedDay || ""],
  // how the approver said it is paid - the QuickBooks payment account it leaves from (the bank, the card, petty cash)
  ["Pay Method", (b) => PAY_METHOD_LABELS[b.payMethod] || ""],
  ["Portal Bill ID", (b) => String(b.id == null ? "" : b.id)],
]);

export const INVOICE_COLUMNS = Object.freeze([
  ["Customer", (r) => r.customer || ""],
  ["Invoice No", (r) => r.number || ""],
  ["Invoice Date", (r) => r.invoiceDate || ""],
  ["Due Date", (r) => r.dueDate || ""],
  ["Amount", (r) => num(r.amount).toFixed(2)],
  ["Customer/Project", (r) => r.projectLabel || ""],
  ["Paid", (r) => (r.isPaid ? "Yes" : "No")],
  ["Paid Date", (r) => (r.isPaid ? r.paidDate || "" : "")],
  ["Portal Invoice ID", (r) => String(r.id == null ? "" : r.id)],
]);

/* A BOM (Excel opens a UTF-8 file without one in the local code page: "Peña" arrives as "PeÃ±a") and CRLF. */
export const BOM = "﻿";
export function toCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c[0])).join(",");
  const body = (rows || []).map((r) => columns.map((c) => csvCell(c[1](r))).join(",")).join("\r\n");
  return BOM + head + (body ? "\r\n" + body : "") + "\r\n";
}
export function csvName(which, today) { return "dcr-" + which + "-" + (dayOf(today) || "today") + ".csv"; }

/** A reference typed from QuickBooks: one line, at most 80 characters, never interpreted. */
export function cleanRef(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, REF_MAX); }

/** refused[] of mark_bills_entered / unmark_… in the accountant's words: ["Kestrel Lumber #INV-4101: Already entered."]. */
export function refusedLines(refused, byId) {
  return (Array.isArray(refused) ? refused : []).map((x) => {
    const id = x && typeof x === "object" ? (x.id !== undefined ? x.id : x.bill_id !== undefined ? x.bill_id : x.invoice_id) : x;
    const why = x && typeof x === "object" ? txt(x.reason || x.why || x.message) : "";
    const r = byId ? byId.get(String(id)) : null;
    let name = "#" + id;
    if (r && "customer" in r && !("invoiceNumber" in r)) {
      // an invoice: always its number - two of one client's invoices must never read the same
      name = (r.customer || "Invoice") + (r.number ? " #" + r.number : " #" + id);
    } else if (r) {
      name = (r.vendor || r.number || "#" + id) + (r.invoiceNumber ? " #" + r.invoiceNumber : r.number && r.vendor ? " #" + r.number : "");
    }
    return name + ": " + (why || "not ready to enter.");
  });
}

/* ── the desk ──────────────────────────────────────────────────────── */

/** Everything the Books screen shows, from the rows the repository read (one pass, so the picture, the tiles, the
    piles and the to-do list are one truth). rows: {bills, payments, invoices, projects, contacts, quotes, desk,
    costs, noReceipt}; ctx: {today, nameOf}. */
export function buildDesk(rows, ctx) {
  const R = rows || {};
  const c = ctx || {};
  const today = dayOf(c.today) || ymd(new Date());
  const projects = byIdMap(R.projects);
  const contacts = byIdMap(R.contacts);
  const quotes = byIdMap(R.quotes);
  const desk = new Map();
  (R.desk || []).forEach((r) => { const d = deskRow(r); if (d) desk.set(d.billId, d); });
  const payments = (R.payments || []).map(toPayment);
  const paid = new Map();
  // live payments only: a voided one is paid against no bill (books_desk's paid_total, which wins, says the same)
  payments.forEach((p) => { if (p.live) paid.set(String(p.billId), round(num(paid.get(String(p.billId))) + p.amount)); });
  const ctx2 = { nameOf: c.nameOf, projects, contacts, paid, desk, today };
  const all = (R.bills || []).filter((r) => !r.deleted_at).map((r) => toBill(r, ctx2));
  const live = all.filter((b) => b.live);
  const ready = live.filter((b) => b.state === "ready").sort(byUrgency);
  const entered = live.filter((b) => b.state === "entered").sort((a, b) => String(b.enteredAt || "").localeCompare(String(a.enteredAt || "")));
  const waiting = live.filter((b) => b.state === "waiting").sort(byUrgency);
  const blocked = live.filter((b) => b.state === "blocked").sort(byUrgency);

  const invoices = (R.invoices || []).map((r) => toInvoice(r, { nameOf: c.nameOf, projects, today })).filter((iv) => iv.live);
  const arReady = invoices.filter((iv) => iv.sent && !iv.entered).sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || b.amount - a.amount);
  const arEntered = invoices.filter((iv) => iv.entered).sort((a, b) => String(b.enteredAt || "").localeCompare(String(a.enteredAt || "")));

  const checks = deskChecks(live, payments);
  const sum = (list, k) => round(list.reduce((n, r) => n + num(r[k]), 0));
  const late = ready.filter((b) => (b.lateBy == null ? -1 : b.lateBy) > 0);
  const totals = {
    readyCount: ready.length, readyAmount: sum(ready, "amount"),
    overdueCount: late.length, overdueAmount: sum(late, "amount"),
    waitingCount: waiting.length, waitingAmount: sum(waiting, "amount"),
    blockedCount: blocked.length, blockedAmount: sum(blocked, "amount"),
    enteredCount: entered.length,
    arReadyCount: arReady.length, arReadyAmount: sum(arReady, "amount"),
    arEnteredCount: arEntered.length,
  };
  const out = {
    today, ready, entered, waiting, blocked,
    ar: { ready: arReady, entered: arEntered },
    checks, totals, payments,
    links: { contacts, quotes },
    byId: new Map(live.map((b) => [String(b.id), b])),
    invoicesById: new Map(invoices.map((iv) => [String(iv.id), iv])),
  };
  out.todo = todoList(out);
  out.spend = spendGlance(R.costs, R.noReceipt, today);
  return out;
}

/* What is waiting on the accountant, in the order it makes sense to do it, one line each with the money. Invoices
   are on it now: M5b gives an invoice its own "entered" marker, so the line can be ticked off. */
export function todoList(d) {
  const t = d.checks.totals, s = d.totals;
  const out = [];
  if (t.checkCount) out.push({ kind: "check", text: "Write " + plural(t.checkCount, "check", "checks"), amount: t.checkAmount, to: "secPay" });
  if (t.cashCount) out.push({ kind: "cash", text: "Pay " + plural(t.cashCount, "bill", "bills") + " in cash", amount: t.cashAmount, to: "secPay" });
  if (t.eitherCount) out.push({ kind: "either", text: "Settle " + plural(t.eitherCount, "bill", "bills") + " by check or cash — your call", amount: t.eitherAmount, to: "secPay" });
  if (t.transferCount) out.push({ kind: "transfer", text: "Send " + plural(t.transferCount, "bank transfer", "bank transfers") + " (ACH or wire)", amount: t.transferAmount, to: "secSend" });
  if (t.cardCount) out.push({ kind: "card", text: "Pay " + plural(t.cardCount, "bill", "bills") + " by card", amount: t.cardAmount, to: "secSend" });
  if (t.toTellCount) out.push({ kind: "tell", text: "Tell " + plural(t.toTellCount, "payee", "payees") + " it is ready to collect", amount: t.toTellAmount, to: "secTell" });
  if (t.toDecideCount) out.push({ kind: "waiting", text: plural(t.toDecideCount, "approved bill", "approved bills") + " with no payment method — ask a manager", amount: t.toDecideAmount, to: "secDecide" });
  if (s.readyCount) out.push({ kind: "qbo", text: "Enter " + plural(s.readyCount, "bill", "bills") + " in QuickBooks", amount: s.readyAmount, to: "secQbo" });
  if (s.arReadyCount) out.push({ kind: "ar", text: "Enter " + plural(s.arReadyCount, "invoice", "invoices") + " in QuickBooks", amount: s.arReadyAmount, to: "secAr" });
  return out;
}

/* One line about the last 30 days of spend, and how many have no receipt (files.cost_id) when that is known -
   worked out by the LEDGER's own functions (map/ledger.js toLedgerRow + ledgerView, period "30"), so the line and the
   page behind "See all expenses" always show the same records, the same cost (materials + subcontractor + labour,
   a credit subtracted, labour hours x rate) and the same receipts: count = the records with an amount in the 30 days
   (equipment and other included, kept out of cost - `other`), noReceipt = those without a receipt. */
export const COST_KINDS = LEDGER_COST_KINDS;
export function spendGlance(costs, noReceipt, today) {
  if (!Array.isArray(costs)) return null;
  const to = dayOf(today);
  const known = noReceipt instanceof Set;
  const receipts = {};
  if (known) costs.forEach((x) => { if (x && !noReceipt.has(String(x.id))) receipts[String(x.id)] = [{ cost_id: x.id }]; });
  const v = ledgerView(costs.map((x) => toLedgerRow(x, { receipts })), { period: "30", today: to });
  return {
    days: 30, from: v.bounds ? v.bounds.from : "", to, count: v.totals.count,
    cost: v.totals.cost, other: v.totals.other,
    noReceipt: known ? v.totals.noReceipt : null,
  };
}

/* ── the home page's approvals card (approvers only) ───────────────── */

/** Bills waiting for someone to approve them, across every project: {count, amount, missingDocument, queue}. ctx:
    {projects, today, nameOf, files (the live files the bills' documents were looked up in: hasLiveDocument - a bill
    whose document was removed needs the invoice attached)}. */
export function approvalsQueue(rows, ctx) {
  const c = ctx || {};
  const projects = byIdMap(c.projects);
  const today = dayOf(c.today) || ymd(new Date());
  const list = (rows || []).filter((r) => !r.deleted_at && !r.void && !r.approved_at && num(r.amount) > 0)
    .map((r) => toBill(r, { projects, today, nameOf: c.nameOf, files: c.files }))
    .sort(byUrgency);
  return {
    today,
    count: list.length,
    amount: round(list.reduce((s, b) => s + b.amount, 0)),
    missingDocument: list.filter((b) => !b.hasDocument).length,
    queue: list.map((b) => ({ id: b.id, projectId: b.projectId, projectLabel: b.projectLabel, vendor: b.vendor, invoiceNumber: b.invoiceNumber,
      dueDate: b.dueDate, dueText: shortDay(b.dueDate), late: (b.lateBy == null ? -1 : b.lateBy) > 0, hasDocument: b.hasDocument, amount: b.amount })),
  };
}

/** "Oct 26" for "2026-10-26" (the date as written, never moved by a time zone). */
export function shortDay(v) {
  const k = dayOf(v);
  if (!DAY_RE.test(k)) return "";
  return new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10), 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/** The bill page's link to a bill. */
export function billHref(id) { return "bill.html?id=" + encodeURIComponent(String(id)); }
