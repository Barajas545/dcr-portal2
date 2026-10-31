/* The Books, the bill page and the home page's approvals card: their reads and writes (BLUEPRINT 3.3.11 "The Books
   (accountant's desk)" and "Bill approval page", Appendix A "accounting" / "bill" / billApprove / billPayMethod, P5 5b).
   Replaces the old ?action=accounting (one server-side aggregation) and ?action=project part=bill / op billApprove /
   op billPayMethod: every read is a plain select under row level security, every rule-heavy write an RPC of
   migration M5b (20261026000100_books_ledger) or the money tables' own triggers.

   Reads (the financials switch: bills, payments and invoices are refused to everyone else, so nothing is asked
   without it - seesBooks(me) - and a REST answer never carries an amount a person may not see):
   * loadDesk(me)              the books_desk view (M5b: every bill not deleted - kind, the QuickBooks marker
                               qbo_entered_at / _by / qbo_ref, state, reason, paid total, owed), the payments (payee, memo, the
                               pick-up stamp), the invoices with their lines and client payments, the project labels,
                               the contacts and quotes the pick-up contact is found through, the last 30 days of
                               costs -> map/books.js buildDesk;
   * loadBill(id, me)          one bill, its payments, project, vendor contact, quote (the amount only with the prices
                               switch: quote_prices), the documents (document_file_id and the files linked to it);
   * approvals(me)             the bills waiting for approval, across every project (approvers only: the card), each
                               document looked up among the live files (a removed one is no document).
   Writes:
   * approve(bill, method, note)     rpc approve_bill(id, pay_method, version, note): the pay method (check | cash | both |
                                     transfer | card - owner decision 2026-10-21) is REQUIRED, the
                                     version is the one on screen (PT409 otherwise), the document must be attached;
                                     an admin or a manager with the approve switch - an accountant is refused;
   * setPayMethod(bill, method)      rpc set_bill_pay_method(p_id, p_method, p_version): approve authority, an approved
                                     bill with no payment yet;
   * markBillsEntered(ids, ref) / unmarkBillsEntered(ids) / markInvoicesEntered(ids, ref) / unmarkInvoicesEntered(ids):
                                     the M5b RPCs -> {marked, refused[]} (only live, approved, documented, not-entered
                                     bills are marked; the rest come back in refused[] with the reason);
   * recordPayment(bill, f)          a payments row (money editors): the method the approver allowed (a check, cash, ACH,
                                     wire or a card), a check's number - any other method's confirmation or reference -,
                                     payee (<= 200), memo (<= 100) and the date written on it (f.paidDate: today - 400
                                     to today + 31, else 22023); the database refuses more than the approved amount
                                     still owed (acceptance check 2), any other way of paying, and a check number
                                     already used (23505, its own sentence: map/checks.js clashText);
   * markTold(payment, how)          rpc payment_told(p_id, p_how, p_version) (M6): phone, in person, email or text;
                                     how = null clears it. A payment once told cannot be deleted (M5b's guard);
   * setDocument(bill, fileId, o)    the bill's document (bills.document_file_id, a versioned PATCH): the bill page's
                                     "Make this the bill's document" and "Replace..." (the Books program, release A).
   The payments are read with the check register's stamps (PAYMENT_COLS: voided, picked up, cleared - the Books
   program, release A) and, on a database without them yet, again without them (paymentRows). A voided payment counts
   in no sum. */

import { db, must, idOf, notFound, forbidden, pageAll, versioned } from "./_db.js";
import { nameBook } from "./people.js";
import { contactRows as readContacts } from "./contacts.js";
import { buildDesk, approvalsQueue, toBill, toPayment, seesBooks, canApprove, canMoney, cleanRef, MEMO_MAX, PAYEE_MAX, CHECK_NUMBER_MAX,
  APPROVAL_NOTE_MAX, dayOf } from "../map/books.js";
import { ymd } from "../map/pacific.js";

export const BILL_COLS = "id, project_id, estimate_item_id, quote_id, vendor_contact_id, vendor_name, invoice_number, invoice_date, due_date, " +
  "amount, description, document_file_id, void, approved_by, approved_at, approved_amount, pay_method, approval_note, kind, " +
  "qbo_entered_at, qbo_entered_by, qbo_ref, deleted_at, created_at, created_by, version";
// books_desk (M5b): the bill's own columns plus the database's paid_total, owed, documented (the document is a LIVE file:
// a removed one leaves bills.document_file_id behind - map/books.js hasLiveDocument), state, reason and pay_pile
// (check_desk | transfer_card)
export const DESK_COLS = "id, project_id, kind, vendor_contact_id, vendor_name, invoice_number, invoice_date, due_date, amount, description, " +
  "estimate_item_id, quote_id, document_file_id, void, approved_by, approved_at, approved_amount, pay_method, approval_note, " +
  "qbo_entered_at, qbo_entered_by, qbo_ref, created_at, created_by, version, paid_total, owed, documented, state, reason, pay_pile";
// + the check register's stamps (the Books program, release A; migration 20261030000300_check_register): void, picked
// up, cleared - written only by void_payment / payment_picked_up / clear_payments. A database without them yet is read
// again without them (paymentRows), as the published pages did.
export const PAYMENT_REGISTER_COLS = ["voided_at", "voided_by", "void_reason", "picked_up_at", "picked_up_by", "picked_up_note",
  "cleared_on", "cleared_at", "cleared_by"];
export const PAYMENT_COLS_BEFORE = "id, bill_id, project_id, paid_date, amount, method, check_number, reference, notes, payee, memo, " +
  "pickup_told_at, pickup_told_by, pickup_told_how, created_at, created_by, version";
export const PAYMENT_COLS = PAYMENT_COLS_BEFORE + ", " + PAYMENT_REGISTER_COLS.join(", ");
export const INVOICE_COLS = "id, project_id, number, invoice_date, due_date, description, status, sent_date, qbo_entered_at, qbo_entered_by, " +
  "qbo_ref, deleted_at, version, invoice_lines(amount), client_payments(amount, paid_date)";
export const PROJECT_COLS = "id, number, name, address, city, client_name";
// + the contact's picture (Books release A3, migration 20261030000200; a database without it yet: read again without it,
// initials - repo/contacts.js contactRows), its version (the contact card's versioned PATCH) and its kind (a pick-up
// message goes only to a payee kind: map/books-home.js pickupContact, I36; contacts.kind is there since 20261007000200)
export const CONTACT_COLS = "id, name, company, kind, email, phone, picture_path, deleted_at, version";
// a payment's files (payment_id, 20261030000100_money_files), the small preview (preview_path) and the version (a file is
// removed at the version shown)
export const FILE_COLS = "id, project_id, bill_id, payment_id, folder, name, storage, storage_path, preview_path, size, mime, created_at, version";

function noBooks() {
  const e = forbidden();
  e.message = "The Books need the financials switch. Ask an admin.";
  return e;
}

/* ── the payments' register columns, or a database without them yet ── */

let noRegisterColumns = false;
const REGISTER_RE = new RegExp("\\b(" + PAYMENT_REGISTER_COLS.join("|") + ")\\b");
/** A read or write refused because the payments' register columns are not there yet (42703 / PGRST204 naming one). */
export function missingRegisterColumn(e) {
  const code = String((e && e.code) || "");
  return (code === "42703" || code === "PGRST204") && REGISTER_RE.test(String((e && e.message) || "") + " " + String((e && e.details) || ""));
}
/** `cols` without the register's columns. */
export function withoutRegister(cols) {
  return String(cols).split(",").map((s) => s.trim()).filter((s) => s && PAYMENT_REGISTER_COLS.indexOf(s) === -1).join(", ");
}
/** read(cols) with the payments' register columns; a database without them yet is asked again without them (and
    remembered for the page). One statement each time: a refused read or insert changed nothing. */
export async function paymentRows(read, cols) {
  const want = cols || PAYMENT_COLS;
  if (!noRegisterColumns) {
    try { return await read(want); } catch (e) {
      if (!missingRegisterColumn(e)) throw e;
      noRegisterColumns = true;
    }
  }
  return read(withoutRegister(want));
}
/** Whether this database has the check register (false only after a read found its columns missing). */
export function registerReady() { return !noRegisterColumns; }

/** rows of `table` whose `col` is one of `ids`, 150 ids a read. */
async function byIds(c, table, cols, col, ids) {
  const list = Array.from(new Set((ids || []).filter((v) => v !== null && v !== undefined).map(idOf)));
  const out = [];
  for (let i = 0; i < list.length; i += 150) {
    (must(await c.from(table).select(cols).in(col, list.slice(i, i + 150))) || []).forEach((r) => out.push(r));
  }
  return out;
}

/* ── the desk ─────────────────────────────────────────────────────── */

/** Everything The Books screen shows, read as `me` -> buildDesk's payload (plus .can). */
export async function loadDesk(me, opts) {
  if (!seesBooks(me)) throw noBooks();
  const o = opts || {};
  const c = await db();
  const today = o.today || ymd(new Date());
  const [y, m, d] = today.split("-").map(Number);
  const from30 = new Date(Date.UTC(y, m - 1, d - 29)).toISOString().slice(0, 10);
  const [desk, payments, invoices, projects, contacts, quotes, costs, nameOf] = await Promise.all([
    // M5b's view: every bill not deleted with its state, reason, paid_total and owed (the caller's RLS: financials)
    pageAll((cl) => cl.from("books_desk").select(DESK_COLS).order("id", { ascending: true })),
    paymentRows((cols) => pageAll((cl) => cl.from("payments").select(cols).order("id", { ascending: true }))),
    pageAll((cl) => cl.from("invoices").select(INVOICE_COLS).is("deleted_at", null).order("id", { ascending: true })),
    pageAll((cl) => cl.from("projects").select(PROJECT_COLS).order("id", { ascending: true })),
    readContacts((cols) => pageAll((cl) => cl.from("contacts").select(cols).order("id", { ascending: true })), CONTACT_COLS),
    pageAll((cl) => cl.from("quotes").select("id, project_id, vendor_contact_id").order("id", { ascending: true })),
    pageAll((cl) => cl.from("costs").select("id, project_id, cost_date, kind, amount, hours, rate").gte("cost_date", from30).order("id", { ascending: true })),
    nameBook(),
  ]);
  // receipts linked to those costs (M5b files.cost_id); a failed read is said, never taken for "no receipt"
  const ids = (costs || []).map((x) => x.id);
  const linked = ids.length ? await byIds(c, "current_files", "cost_id", "cost_id", ids) : [];
  const has = new Set(linked.map((f) => String(f.cost_id)));
  const noReceipt = new Set(ids.map(String).filter((id) => !has.has(id)));
  const out = buildDesk({ bills: desk, desk, payments, invoices, projects, contacts, quotes, costs, noReceipt }, { today, nameOf });
  out.can = { mark: canMoney(me), pay: canMoney(me), approve: canApprove(me) };
  return out;
}

/* ── one bill ─────────────────────────────────────────────────────── */

/** One bill in full: {bill, payments, project, contact, quote, files, can}. */
export async function loadBill(id, me) {
  if (!seesBooks(me)) throw noBooks();
  const c = await db();
  const bid = idOf(id);
  const rows = must(await c.from("bills").select(BILL_COLS).eq("id", bid)) || [];
  if (!rows.length) throw notFound("That bill");
  const row = rows[0];
  const prices = me.role === "admin" || !!me.can_see_prices;
  const [payRows, projRows, contactRows, quoteRows, fileRows, nameOf] = await Promise.all([
    paymentRows(async (cols) => must(await c.from("payments").select(cols).eq("bill_id", bid).order("paid_date", { ascending: false }))),
    c.from("projects").select(PROJECT_COLS).eq("id", row.project_id).then(must),
    row.vendor_contact_id != null
      ? readContacts((cols) => c.from("contacts").select(cols).eq("id", row.vendor_contact_id).then(must), CONTACT_COLS) : Promise.resolve([]),
    row.quote_id != null
      ? c.from("quotes").select("id, project_id, kind, status, vendor_contact_id, vendor_name" + (prices ? ", prices:quote_prices(amount)" : "")).eq("id", row.quote_id).then(must)
      : Promise.resolve([]),
    c.from("current_files").select(FILE_COLS).eq("bill_id", bid).order("created_at", { ascending: false }).then(must),
    nameBook(),
  ]);
  let files = fileRows || [];
  if (row.document_file_id != null && !files.some((f) => String(f.id) === String(row.document_file_id))) {
    const doc = must(await c.from("current_files").select(FILE_COLS).eq("id", row.document_file_id)) || [];
    files = doc.concat(files);
  }
  // the bill's own document first
  files.sort((a, b) => (String(b.id) === String(row.document_file_id) ? 1 : 0) - (String(a.id) === String(row.document_file_id) ? 1 : 0));
  const projects = new Map((projRows || []).map((p) => [String(p.id), p]));
  const contacts = new Map((contactRows || []).map((x) => [String(x.id), x]));
  const payments = (payRows || []).map(toPayment);
  // live payments only: a voided one is paid against no bill (app.bill_paid_total)
  const paid = new Map([[String(row.id), payments.reduce((s, p) => s + (p.live ? p.amount : 0), 0)]]);
  // the document counts only as one of these live files (current_files): a removed one leaves the pointer behind
  const bill = toBill(row, { nameOf, projects, contacts, paid, files, today: ymd(new Date()) });
  const q = (quoteRows || [])[0] || null;
  const quote = q ? {
    id: q.id, kind: q.kind === "change_order" ? "Change order" : "Quote", status: q.status || "", vendor: q.vendor_name || "",
    amount: q.prices && q.prices.amount !== undefined && q.prices.amount !== null ? Number(q.prices.amount)
      : Array.isArray(q.prices) && q.prices[0] && q.prices[0].amount != null ? Number(q.prices[0].amount) : null,
  } : null;
  return {
    bill, payments, quote,
    project: projRows && projRows[0] ? projRows[0] : null,
    contact: contactRows && contactRows[0] ? contactRows[0] : null,
    files: files.map((f) => ({ id: f.id, name: f.name || "", mime: f.mime || "", size: f.size == null ? null : Number(f.size),
      cloud: (f.storage || "cloud") === "cloud", storagePath: f.storage_path || null, primary: String(f.id) === String(row.document_file_id),
      createdAt: f.created_at || null, billId: f.bill_id == null ? null : f.bill_id, paymentId: f.payment_id == null ? null : f.payment_id,
      previewPath: f.preview_path || null, version: f.version == null ? null : Number(f.version) })),
    can: { approve: canApprove(me), pay: canMoney(me) },
  };
}

/* ── the home page's approvals card ───────────────────────────────── */

/** The bills waiting for approval (approvers only - anyone else gets null without a read). */
export async function approvals(me) {
  if (!canApprove(me)) return null;
  const c = await db();
  const rows = await pageAll((cl) => cl.from("bills").select(BILL_COLS).is("approved_at", null).is("deleted_at", null)
    .eq("void", false).gt("amount", 0).order("due_date", { ascending: true }));
  const projects = rows.length ? await byIds(c, "projects", PROJECT_COLS, "id", rows.map((r) => r.project_id)) : [];
  // the documents that are still live files (current_files): a removed one leaves bills.document_file_id behind, and
  // that bill still needs the invoice attached (approve_bill refuses it)
  const docs = rows.length ? await byIds(c, "current_files", "id", "id", rows.map((r) => r.document_file_id)) : [];
  return approvalsQueue(rows, { projects, files: docs, today: ymd(new Date()) });
}

/* ── writes ───────────────────────────────────────────────────────── */

function one(res) { return Array.isArray(res) ? res[0] || null : res; }

/** Approve `bill` (as shown: its version) to be paid by `method` (check | cash | both | transfer | card) - REQUIRED. */
export async function approve(bill, method, note) {
  const c = await db();
  const n = String(note == null ? "" : note).trim().slice(0, APPROVAL_NOTE_MAX);
  return one(must(await c.rpc("approve_bill", { id: idOf(bill.id), pay_method: method || null, version: bill.version, note: n || null })));
}

/** Say how an approved bill (no payment yet) is paid. */
export async function setPayMethod(bill, method) {
  const c = await db();
  return one(must(await c.rpc("set_bill_pay_method", { p_id: idOf(bill.id), p_method: method || null, p_version: bill.version })));
}

/** {marked: [ids] | n, refused: [{id, reason}]} from the M5b mark / unmark RPCs, whatever the exact spelling. */
export function markResult(r) {
  const x = one(r) || {};
  const list = (v) => (Array.isArray(v) ? v : []);
  const marked = x.marked !== undefined ? x.marked : x.unmarked !== undefined ? x.unmarked : x.done;
  return {
    marked: Array.isArray(marked) ? marked : [],
    count: Array.isArray(marked) ? marked.length : Number(marked) || 0,
    refused: list(x.refused),
  };
}

const ids = (list) => Array.from(new Set((list || []).map(idOf))).filter((v) => v !== null && v !== undefined && v !== "");

export async function markBillsEntered(list, ref) {
  const c = await db();
  return markResult(must(await c.rpc("mark_bills_entered", { p_ids: ids(list), p_ref: cleanRef(ref) || null })));
}
export async function unmarkBillsEntered(list) {
  const c = await db();
  return markResult(must(await c.rpc("unmark_bills_entered", { p_ids: ids(list) })));
}
export async function markInvoicesEntered(list, ref) {
  const c = await db();
  return markResult(must(await c.rpc("mark_invoices_entered", { p_ids: ids(list), p_ref: cleanRef(ref) || null })));
}
export async function unmarkInvoicesEntered(list) {
  const c = await db();
  return markResult(must(await c.rpc("unmark_invoices_entered", { p_ids: ids(list) })));
}

/** Record a payment against `bill` (a check, cash, ACH, wire or a card, as the approver allowed): -> the payments row. A
    check carries its number; any other method its confirmation or reference (optional). */
export async function recordPayment(bill, f) {
  const c = await db();
  const method = String(f.method || "").toLowerCase();
  const number = String(f.checkNumber == null ? "" : f.checkNumber).replace(/\s+/g, " ").trim().slice(0, CHECK_NUMBER_MAX);
  const row = {
    bill_id: idOf(bill.id),
    project_id: idOf(bill.projectId),
    amount: Number(f.amount),
    method: method,
    check_number: method === "check" ? number || null : null,
    reference: method !== "check" ? number || null : null,
    payee: String(f.payee == null ? "" : f.payee).trim().slice(0, PAYEE_MAX) || null,
    memo: String(f.memo == null ? "" : f.memo).replace(/\s+/g, " ").trim().slice(0, MEMO_MAX) || null,
  };
  if (f.paidDate && /^\d{4}-\d{2}-\d{2}$/.test(String(f.paidDate))) row.paid_date = String(f.paidDate);
  // one statement: a database without the register's columns refuses the whole insert (nothing is written), and it
  // is sent again without them
  const made = (await paymentRows(async (cols) => must(await c.from("payments").insert(row).select(cols)))) || [];
  return made[0] ? toPayment(made[0]) : null;
}

/** The bill's document: bills.document_file_id = fileId (a live file of the bill's project - the bills trigger refuses
    anything else, 23514), a versioned PATCH of that one column, like projects.setThumbnail. The database withdraws an
    approval when the document changes, and refuses the change once the bill is paid or marked entered in QuickBooks
    (23514, its own sentence). When someone else changed the bill meanwhile (PT409) it is sent once more at their
    version - unless the bill was approved meanwhile and the person did not agree to withdraw an approval
    (opts.withdraw): then the conflict is answered as it is. -> the bill's row as the database has it. */
export async function setDocument(bill, fileId, opts) {
  const o = opts || {};
  const patch = { document_file_id: fileId === null || fileId === undefined ? null : idOf(fileId) };
  try {
    return await versioned("bills", idOf(bill.id), bill.version, patch, BILL_COLS);
  } catch (e) {
    if (!(e && e.code === "PT409" && e.current)) throw e;
    if (e.current.approved_at && !o.withdraw) throw e;
    return versioned("bills", idOf(bill.id), e.current.version, patch, BILL_COLS);
  }
}

/** Mark a check / cash payment told (how: email | phone | text | in person), or clear it (how = null). */
export async function markTold(payment, how) {
  const c = await db();
  return one(must(await c.rpc("payment_told", { p_id: idOf(payment.paymentId !== undefined ? payment.paymentId : payment.id),
    p_how: how || null, p_version: payment.version })));
}

export { dayOf };
