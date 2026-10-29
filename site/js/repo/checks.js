/* The check register's reads and writes (the Books program, release A: books-checks.html and the pay panel; DCR
   Desktop 2 migration 20261030000300_check_register, docs/DATABASE.md §33). Every read is a plain select under row level
   security (the financials switch: nothing is asked without it - seesBooks(me)), every write one of the migration's
   RPCs (money editors; definers that check the caller first and answer an id the caller cannot read as PT404).

   Reads:
   * loadRegister(me)          the check_register view (one row per physical check, plus the spoiled blanks), the
                               payments behind it (their versions and stamps, for the RPCs), the jobs, the payees'
                               contacts (their pictures), the payments' files, settings.payments_void_enabled and
                               next_check_number() -> map/checks.js buildRegister's payload (plus .can). WITHOUT the
                               prices switch no amount is even asked for (S4): neither the view's amount columns nor
                               the payments' amount;
   * nextCheckNumber()         rpc next_check_number() -> {next, last: {number, paidDate, payee}} (I10: a suggestion -
                               the last recorded all-digit check + 1, past every number used or spoiled); a database
                               without it yet: null;
   * checkNumberInfo(n, pid)   rpc check_number_info(p_number, p_payment_id) -> {free, clash, next} (the warning while
                               the number is typed); a database without it yet: null.
   Writes (money editors):
   * pickedUp(payment, on, o)  rpc payment_picked_up(p_id, p_on, p_version, p_note, p_date): the day (o.date, default
                               now; between the check's first day and today) and who collected it (o.note, <= 120);
                               told "in person" too when nobody was told; off takes it off (not once cleared);
   * clearPayments(ids, on, d) rpc clear_payments(p_ids, p_on, p_on_date) -> {changed, unchanged, refused: [{id,
                               reason}], clearedOn} (1-1,000; cash and voided refused with their reasons);
   * voidPayment(payment, why) rpc void_payment(p_id, p_reason, p_version): FINAL; only while
                               settings.payments_void_enabled is on (55000 otherwise); never a cleared one;
   * spoilCheck(n, why) / unspoilCheck(id)   rpc spoil_check(p_number, p_reason) / unspoil_check(p_id);
   * setVoidEnabled(on, version)   a versioned PATCH of settings.payments_void_enabled (settings are admin-write): the
                               admin's "Allow voiding checks" switch (phase 4 of the plan: once every PC runs DCR
                               Desktop 2 2.25). */

import { db, must, idOf, forbidden, pageAll, versioned } from "./_db.js";
import { contactRows as readContacts } from "./contacts.js";
import { paymentRows, FILE_COLS, CONTACT_COLS, PROJECT_COLS } from "./books.js";
import { seesBooks, canMoney } from "../map/books.js";
import { ymd } from "../map/pacific.js";

// the view's columns, the amounts only with the prices switch (S4)
export const REGISTER_COLS = "check_number, check_key, kind, paid_date, payee, vendor_contact_id, payment_ids, bill_ids, project_ids, status, " +
  "void_reason, voided_at, cleared_on, picked_up_at, told_at, recorded_at, number_reused, spoiled_id";
export const REGISTER_AMOUNT_COLS = "amount, written_amount";
// a check's payments as the register's RPCs need them (version and stamps); the amount only with the prices switch
export const REGISTER_PAYMENT_COLS = "id, bill_id, project_id, paid_date, method, check_number, payee, pickup_told_at, pickup_told_how, " +
  "voided_at, void_reason, picked_up_at, picked_up_note, cleared_on, created_at, version";
export const SETTINGS_COLS = "id, payments_void_enabled, version";
export const NOTE_MAX = 120;      // payments.picked_up_note
export const REASON_MIN = 3;      // void_reason, spoiled_checks.reason
export const REASON_MAX = 300;

const SCHEMA = new Set(["42703", "PGRST204", "PGRST202", "42883", "42P01", "PGRST205"]);
const missing = (e) => SCHEMA.has(String((e && e.code) || ""));
const one = (res) => (Array.isArray(res) ? res[0] || null : res);
const line = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

export function seesPrices(me) { return !!me && (me.role === "admin" || !!me.can_see_prices); }

function noBooks() {
  const e = forbidden();
  e.message = "The check register needs the financials switch. Ask an admin.";
  return e;
}

/** rows of `table` whose `col` is one of `ids`, 150 ids a read. */
async function byIds(c, table, cols, col, list) {
  const want = Array.from(new Set((list || []).filter((v) => v !== null && v !== undefined).map((v) => idOf(v))));
  const out = [];
  for (let i = 0; i < want.length; i += 150) {
    (must(await c.from(table).select(cols).in(col, want.slice(i, i + 150))) || []).forEach((r) => out.push(r));
  }
  return out;
}

/* ── reads ────────────────────────────────────────────────────────────── */

/** rpc next_check_number() -> {next, last} | null (a database without the check register yet). */
export async function nextCheckNumber() {
  const c = await db();
  try {
    const r = one(must(await c.rpc("next_check_number", {})));
    return r && typeof r === "object" ? { next: r.next == null ? null : String(r.next), last: r.last || null } : { next: null, last: null };
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

/** rpc check_number_info(p_number, p_payment_id) -> {free, clash, next} | null (no such RPC yet, or nothing to ask). */
export async function checkNumberInfo(number, paymentId) {
  const n = line(number);
  if (!/[0-9A-Za-z]/.test(n)) return null;
  const c = await db();
  try {
    const r = one(must(await c.rpc("check_number_info", { p_number: n.slice(0, 40), p_payment_id: paymentId == null ? null : idOf(paymentId) })));
    return r && typeof r === "object" ? { free: r.free !== false, clash: r.clash || null, next: r.next == null ? null : String(r.next) } : null;
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

/** settings.payments_void_enabled and the row's version -> {on, version, ready} (ready false: no such column yet). */
export async function voidSwitch() {
  const c = await db();
  try {
    const r = (must(await c.from("settings").select(SETTINGS_COLS).eq("id", 1)) || [])[0] || null;
    return { on: !!(r && r.payments_void_enabled), version: r && r.version != null ? Number(r.version) : null, ready: !!r };
  } catch (e) {
    if (missing(e)) return { on: false, version: null, ready: false };
    throw e;
  }
}

/** Everything the register shows, read as `me`: {rows, payments, projects, contacts, files, voidEnabled,
    settingsVersion, voidReady, next, today, prices, can}. */
export async function loadRegister(me, opts) {
  if (!seesBooks(me)) throw noBooks();
  const o = opts || {};
  const prices = seesPrices(me);
  const c = await db();
  const cols = REGISTER_COLS + (prices ? ", " + REGISTER_AMOUNT_COLS : "");
  const [rows, sw, next] = await Promise.all([
    pageAll((cl) => cl.from("check_register").select(cols).order("paid_date", { ascending: false })
      .order("check_key", { ascending: false }).order("recorded_at", { ascending: false })),
    voidSwitch(),
    nextCheckNumber(),
  ]);
  const pids = [], projectIds = [], contactIds = [];
  (rows || []).forEach((r) => {
    (r.payment_ids || []).forEach((x) => pids.push(x));
    (r.project_ids || []).forEach((x) => projectIds.push(x));
    if (r.vendor_contact_id != null) contactIds.push(r.vendor_contact_id);
  });
  const payCols = REGISTER_PAYMENT_COLS + (prices ? ", amount" : "");
  const [payments, projects, contacts, files] = await Promise.all([
    pids.length ? paymentRows((cl) => byIds(c, "payments", cl, "id", pids), payCols) : [],
    projectIds.length ? byIds(c, "projects", PROJECT_COLS, "id", projectIds) : [],
    contactIds.length ? readContacts((cl) => byIds(c, "contacts", cl, "id", contactIds), CONTACT_COLS) : [],
    pids.length ? byIds(c, "current_files", FILE_COLS, "payment_id", pids) : [],
  ]);
  return {
    rows: rows || [], payments, projects, contacts, files,
    voidEnabled: sw.on, settingsVersion: sw.version, voidReady: sw.ready, next,
    today: o.today || ymd(new Date()), prices,
    can: { money: canMoney(me), admin: !!me && me.role === "admin" && me.active !== false },
  };
}

/* ── writes (money editors; the database decides) ────────────────────── */

const pid = (p) => idOf(p.paymentId !== undefined ? p.paymentId : p.id);

/** A check or cash payment collected (on) or not: o {date: "YYYY-MM-DD" (default now), note: who collected it}. */
export async function pickedUp(payment, on, opts) {
  const o = opts || {};
  const c = await db();
  const note = line(o.note).slice(0, NOTE_MAX);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(o.date || "")) ? String(o.date) : null;
  return one(must(await c.rpc("payment_picked_up", { p_id: pid(payment), p_on: !!on, p_version: payment.version,
    p_note: on && note ? note : null, p_date: on ? date : null })));
}

/** Checks and transfers cleared by the bank on `day` (default today), or not -> {changed, unchanged, refused,
    clearedOn}. */
export async function clearPayments(list, on, day) {
  const c = await db();
  const want = Array.from(new Set((list || []).filter((v) => v !== null && v !== undefined).map((v) => idOf(v))));
  const r = one(must(await c.rpc("clear_payments", { p_ids: want, p_on: !!on,
    p_on_date: on && /^\d{4}-\d{2}-\d{2}$/.test(String(day || "")) ? String(day) : null }))) || {};
  const arr = (v) => (Array.isArray(v) ? v.map(Number) : []);
  return { changed: arr(r.changed), unchanged: arr(r.unchanged), refused: Array.isArray(r.refused) ? r.refused : [], clearedOn: r.clearedOn || null };
}

/** Void a payment as it was shown (its version), saying why (3-300): FINAL. */
export async function voidPayment(payment, reason) {
  const c = await db();
  return one(must(await c.rpc("void_payment", { p_id: pid(payment), p_reason: line(reason).slice(0, REASON_MAX), p_version: payment.version })));
}

/** A blank check spoiled before it was written: its number and why. */
export async function spoilCheck(number, reason) {
  const c = await db();
  return one(must(await c.rpc("spoil_check", { p_number: line(number).slice(0, 40), p_reason: line(reason).slice(0, REASON_MAX) })));
}

/** The spoiled mark taken off a blank (a mistake). */
export async function unspoilCheck(id) {
  const c = await db();
  return one(must(await c.rpc("unspoil_check", { p_id: idOf(id) })));
}

/** The admin's "Allow voiding checks" switch: a versioned PATCH of settings (admin-write) -> {on, version}. */
export async function setVoidEnabled(on, version) {
  const r = await versioned("settings", 1, version, { payments_void_enabled: !!on }, SETTINGS_COLS);
  return { on: !!(r && r.payments_void_enabled), version: r && r.version != null ? Number(r.version) : null };
}
