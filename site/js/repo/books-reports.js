/* The Books reports' reads (books-reports.html, and the vendor list's 1099 worksheet; the Books program, release B part
   2b: DCR Desktop 2 migration 20261030000500_books_reports - docs/DATABASE.md §35 - plus money_messages (§34) and
   money_events (§33)). Everything is read under row level security as `me`, and NOTHING AT ALL without BOTH the
   financials and the prices switches (seesReports(me) refuses before any read): the four report functions need both
   (app.books_reader, 42501), and money_events carries amounts (S4) - so the approval log and the money history are
   asked for only by the same people.

   * apAging(me, asOf)              rpc books_ap_aging(p_as_of): what we owed each vendor on a day;
   * vendorBalances(me)             rpc books_vendor_balances();
   * worksheet1099(me, year, t)     rpc books_1099(p_year, p_threshold) - t null: the year's default ($600 through 2025,
                                    $2,000 from 2026: confirm with the CPA); a typed one is for this view only;
   * paymentsByMonth(me, from, to)  rpc books_payments_by_month(p_from, p_to);
   * paymentLines(me, from, to)     the live payments dated in the period with their bills and jobs (the Bill payments
                                    CSV, for keying in QuickBooks);
   * approvalLog(me, from, to)      money_messages (approval requests made in the period), the bills they named and
                                    their jobs, and the people's names;
   * moneyHistory(me, from, to)     money_events of the period (newest first, at most HISTORY_MAX), the bills, jobs and
                                    contacts (a vendor's details, a pick-up's payee) they name. */

import { db, must, idOf, forbidden, pageAll } from "./_db.js";
import { nameBook } from "./people.js";
import { MESSAGE_COLS } from "./money-messages.js";
import { seesBooks } from "../map/books.js";
import { midnightUtc, addDays } from "../map/pacific.js";

export const BILL_COLS = "id, project_id, vendor_name, invoice_number, approved_at, approved_by";
export const PROJECT_COLS = "id, number, name";
export const LINE_COLS = "id, bill_id, project_id, paid_date, amount, method, check_number, reference, payee";
export const CONTACT_COLS = "id, name, company";
export const EVENT_COLS = "id, at, actor_id, actor_name, kind, project_id, bill_id, payment_id, file_id, contact_id, message_id, amount, detail";
export const HISTORY_MAX = 5000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Who may read the reports: the financials AND prices switches (app.books_reader). */
export function seesReports(me) {
  return seesBooks(me) && !!me && (me.role === "admin" || !!me.can_see_prices);
}
function noReports() {
  const e = forbidden();
  e.message = "The Books reports need the financials and prices switches. Ask an admin.";
  return e;
}
function badDay() {
  const e = new Error("Pick the days (YYYY-MM-DD).");
  e.code = "22023"; e.status = 400;
  return e;
}
const day = (v) => (DAY.test(String(v || "")) ? String(v) : null);
const rowsOf = (r) => (Array.isArray(r) ? r : []);

async function byIds(c, table, cols, list) {
  const want = Array.from(new Set((list || []).filter((v) => v !== null && v !== undefined).map((v) => idOf(String(v)))));
  const out = [];
  for (let i = 0; i < want.length; i += 150) {
    (must(await c.from(table).select(cols).in("id", want.slice(i, i + 150))) || []).forEach((r) => out.push(r));
  }
  return out;
}
const mapOf = (list) => new Map((list || []).map((r) => [String(r.id), r]));

/** The bills and their jobs named by `billIds` (plus `projectIds`). */
async function billsAndJobs(c, billIds, projectIds) {
  const bills = await byIds(c, "bills", BILL_COLS, billIds);
  const jobs = await byIds(c, "projects", PROJECT_COLS, bills.map((b) => b.project_id).concat(projectIds || []));
  return { bills: mapOf(bills), projects: mapOf(jobs) };
}

/* ── the four report functions ── */

export async function apAging(me, asOf) {
  if (!seesReports(me)) throw noReports();
  const c = await db();
  return rowsOf(must(await c.rpc("books_ap_aging", { p_as_of: day(asOf) })));
}

export async function vendorBalances(me) {
  if (!seesReports(me)) throw noReports();
  const c = await db();
  return rowsOf(must(await c.rpc("books_vendor_balances", {})));
}

export async function worksheet1099(me, year, threshold) {
  if (!seesReports(me)) throw noReports();
  const y = Number(year);
  const c = await db();
  return rowsOf(must(await c.rpc("books_1099", { p_year: Number.isInteger(y) ? y : null,
    p_threshold: threshold === null || threshold === undefined || threshold === "" ? null : Number(threshold) })));
}

export async function paymentsByMonth(me, from, to) {
  if (!seesReports(me)) throw noReports();
  if (!day(from) || !day(to)) throw badDay();
  const c = await db();
  return rowsOf(must(await c.rpc("books_payments_by_month", { p_from: day(from), p_to: day(to) })));
}

/* ── plain reads ── */

/** The live payments dated in the period, with their bills and jobs: {payments, bills, projects}. */
export async function paymentLines(me, from, to) {
  if (!seesReports(me)) throw noReports();
  if (!day(from) || !day(to)) throw badDay();
  const c = await db();
  const payments = await pageAll((cl) => cl.from("payments").select(LINE_COLS).gte("paid_date", day(from)).lte("paid_date", day(to))
    .is("voided_at", null).order("paid_date", { ascending: true }).order("id", { ascending: true }));
  const more = await billsAndJobs(c, payments.map((p) => p.bill_id), []);
  return { payments, bills: more.bills, projects: more.projects };
}

/** Approval requests made in the period: {messages, bills, projects, nameOf}. */
export async function approvalLog(me, from, to) {
  if (!seesReports(me)) throw noReports();
  if (!day(from) || !day(to)) throw badDay();
  const c = await db();
  const messages = await pageAll((cl) => cl.from("money_messages").select(MESSAGE_COLS).eq("kind", "approval_request")
    .gte("created_at", midnightUtc(day(from)).toISOString()).lt("created_at", midnightUtc(addDays(day(to), 1)).toISOString())
    .order("created_at", { ascending: false }).order("id", { ascending: false }));
  const billIds = [];
  messages.forEach((m) => (Array.isArray(m.bill_ids) ? m.bill_ids : []).forEach((id) => billIds.push(id)));
  const [more, nameOf] = await Promise.all([billsAndJobs(c, billIds, []), nameBook()]);
  return { messages, bills: more.bills, projects: more.projects, nameOf };
}

/** The money history of the period, newest first: {events, bills, projects, contacts, capped}. */
export async function moneyHistory(me, from, to) {
  if (!seesReports(me)) throw noReports();
  if (!day(from) || !day(to)) throw badDay();
  const c = await db();
  const events = await pageAll((cl) => cl.from("money_events").select(EVENT_COLS)
    .gte("at", midnightUtc(day(from)).toISOString()).lt("at", midnightUtc(addDays(day(to), 1)).toISOString())
    .order("at", { ascending: false }).order("id", { ascending: false }), HISTORY_MAX);
  const [more, contacts] = await Promise.all([billsAndJobs(c, events.map((e) => e.bill_id), events.map((e) => e.project_id)),
    byIds(c, "contacts", CONTACT_COLS, events.map((e) => e.contact_id))]);
  return { events, bills: more.bills, projects: more.projects, contacts: mapOf(contacts), capped: events.length >= HISTORY_MAX };
}
