// P5b: the ledger's data module (site/js/repo/ledger.js) over the DEMO database (tools/fake/p5a-pm.js money tables +
// tools/fake/p5b-ledger.js: M5b's costs columns, files.cost_id and the RPCs tag_costs(p_ids, p_card) / reconcile_costs(
// p_ids, p_on) / confirm_cost_employee(p_ids, p_employee_id) with their answers {changed, unchanged, refused}; the
// database's own employee inference). Per role: who is answered cost rows at all (the financials switch — Appendix D), who may
// write (app.can_edit('money'): an admin, or a manager or accountant with financials), what the writes stamp, that
// none of them writes an activity line (P5 acceptance check 5), and the project's Expenses and Payments reads.
// Made-up people and jobs only.
import test from "node:test";
import assert from "node:assert/strict";

import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as repo from "../site/js/repo/ledger.js";
import { clearPeople } from "../site/js/repo/people.js";
import { forgetProjects } from "../site/js/repo/projects.js";
import { ledgerView, seesLedger, canTag } from "../site/js/map/ledger.js";
import { decorateBill, billTotals, decorateInvoice } from "../site/js/map/payments.js";

const skip = !available;
const MONEY_TABLES = ["costs", "bills", "payments", "invoices", "invoice_lines", "client_payments"];

async function as(key, engine) {
  const e = engine || await freshEngine();
  const who = await person(key);
  const me = e.rows.profiles.find((p) => p.id === who.id);
  const log = [];
  if (!e._recording) {
    const orig = e.select;
    e.select = function (ctx, table, q) { const r = orig(ctx, table, q); (e._log || []).push({ table, rows: r.data }); return r; };
    e._recording = true;
  }
  e._log = log;
  clearPeople();
  forgetProjects();
  useClient(clientAs(e, who.id));
  return { e, me, log, uid: who.id };
}
const sandbox = (e) => e.rows.projects.find((p) => p.number === "A267");
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());

test("who is answered cost rows: financials only (a lead, a manager without financials, field, view-only and the agents account get none)", { skip }, async () => {
  const engine = await freshEngine();
  for (const key of ["lead", "manager", "manager_prices", "field", "viewer", "agents"]) {
    const { me, log } = await as(key, engine);
    assert.equal(seesLedger(me), false, key + ": the page would not even ask");
    let got = null;
    try { got = await repo.loadLedger(); } catch (e) { got = { rows: [], invoices: [] }; }
    assert.equal(got.rows.length, 0, key + ": no cost row");
    assert.equal(got.invoices.length, 0, key + ": no invoice");
    for (const x of log.filter((l) => MONEY_TABLES.includes(l.table))) assert.equal(x.rows.length, 0, key + ": " + x.table + " answered nothing");
    const pay = await repo.projectPayments(sandbox(engine).id).catch(() => ({ bills: [], invoices: [] }));
    assert.equal(pay.bills.length + pay.invoices.length, 0, key + ": no bill, no invoice");
  }
});

test("the accountant: every cost with its project, line, employee, card, reconciled stamp and receipts; billed-out apart", { skip }, async () => {
  const { e, me } = await as("accountant");
  assert.ok(seesLedger(me) && canTag(me));
  const got = await repo.loadLedger();
  assert.equal(got.rows.length, e.rows.costs.length);
  const sb = sandbox(e);
  const first = got.rows.find((r) => r.projectId === sb.id && r.description === "Extra blocking lumber");
  assert.equal(first.card, "card-amex");
  assert.equal(first.cardBy, "Casey Accounts");
  assert.ok(first.group, "booked to an estimate line");
  assert.equal(first.receipts.length, 1);
  const two = got.rows.find((r) => r.description === "Simpson hangers, nails and straps");
  assert.equal(two.receipts.length, 2, "one row, two files (files.cost_id)");
  const credit = got.rows.find((r) => r.amount < 0);
  assert.ok(credit && credit.cost < 0, "a credit is a negative cost");
  const fuel = got.rows.find((r) => r.kind === "equipment" && r.projectId === sb.id);
  assert.deepEqual([fuel.cost, fuel.other > 0], [0, true], "equipment is listed, not in cost");
  const guess = got.rows.find((r) => /^Alex - /.test(r.description));
  assert.deepEqual([guess.employeeName, guess.employeeSource], ["Alex Juniper", "inferred"], "inferred by the database (M5b), labelled so");
  assert.equal(got.rows.find((r) => /^Jordan and Alex/.test(r.description)).employeeSource, "none", "two names: no guess");
  assert.ok(got.rows.some((r) => r.employeeSource === "confirmed"));
  assert.ok(got.employees.length >= 10 && got.employees.every((x) => Object.keys(x).sort().join(",") === "active,full_name,id"), "employees: names only");
  const v = ledgerView(got.rows, { period: "all", today: today() });
  assert.ok(v.counts["30"] < v.counts["365"] && v.counts["365"] < v.counts.all, "every period chip has its own count");
  assert.ok(got.invoices.length >= 3, "the invoices for the billed-out tile");
});

test("tag_costs: a money editor sets 'Paid with' on many rows (stamped by / at), refused rows are listed; the 8 ids only; untagged clears", { skip }, async () => {
  const { e, uid } = await as("accountant");
  const before = e.rows.activity.length;
  const ids = e.rows.costs.filter((c) => c.card === "untagged").slice(0, 3).map((c) => c.id);
  const same = e.rows.costs.find((c) => c.card === "card-visa").id;
  const res = await repo.tagCosts(ids.concat([987654, same]), "card-visa");
  assert.deepEqual(res, { changed: 3, unchanged: 1, refused: [{ id: 987654, reason: "No such cost." }] });
  for (const id of ids) {
    const c = e.rows.costs.find((x) => x.id === id);
    assert.deepEqual([c.card, c.card_by, !!c.card_at], ["card-visa", uid, true]);
    assert.ok(c.version >= 2, "versioned");
  }
  await repo.tagCosts([ids[0]], "untagged");
  const off = e.rows.costs.find((x) => x.id === ids[0]);
  assert.deepEqual([off.card, off.card_by, off.card_at], ["untagged", null, null], "untagged: no stamp (costs_card_stamp)");
  await assert.rejects(repo.tagCosts(ids, "Amex 1007"), /not one of the payment methods/);
  await assert.rejects(repo.tagCosts([], "cash"), /Nothing was selected/);
  await assert.rejects(repo.tagCosts(Array.from({ length: 1001 }, (_, i) => i + 1), "cash"), /At most 1000/);
  // a reconciled row whose card changes is not reconciled any more (M5b tg_costs_ledger)
  const rec = e.rows.costs.find((c) => c.reconciled_at && c.card !== "cash");
  await repo.tagCosts([rec.id], "cash");
  assert.deepEqual([e.rows.costs.find((c) => c.id === rec.id).reconciled_at, e.rows.costs.find((c) => c.id === rec.id).reconciled_by], [null, null]);
  assert.equal(e.rows.activity.length, before, "no activity line (no amount can leak into the log)");
});

test("reconcile_costs sets and clears the stamp; confirm_cost_employee stores the employee as confirmed (or nobody)", { skip }, async () => {
  const { e, uid } = await as("accountant");
  const before = e.rows.activity.length;
  const id = e.rows.costs.find((c) => !c.reconciled_at).id;
  assert.deepEqual(await repo.reconcileCosts([id], true), { changed: 1, unchanged: 0, refused: [] });
  assert.deepEqual(await repo.reconcileCosts([id], true), { changed: 0, unchanged: 1, refused: [] }, "already so");
  let c = e.rows.costs.find((x) => x.id === id);
  assert.deepEqual([c.reconciled_by, !!c.reconciled_at], [uid, true]);
  await repo.reconcileCosts([id], false);
  c = e.rows.costs.find((x) => x.id === id);
  assert.deepEqual([c.reconciled_by, c.reconciled_at], [null, null]);

  const rows = (await repo.loadLedger()).rows;
  const guess = rows.find((r) => /^Alex - /.test(r.description));
  assert.deepEqual(await repo.confirmEmployee([guess.id], guess.employeeId), { changed: 1, unchanged: 0, refused: [] });
  const again = (await repo.loadLedger()).rows.find((r) => r.id === guess.id);
  assert.deepEqual([again.employeeId, again.employeeSource], [guess.employeeId, "confirmed"]);
  assert.deepEqual(await repo.confirmEmployee([guess.id], guess.employeeId), { changed: 0, unchanged: 1, refused: [] }, "already so");
  await assert.rejects(repo.confirmEmployee([guess.id], 99999), /not somebody on the employee list/);
  await repo.confirmEmployee([guess.id], null);
  const none = e.rows.costs.find((c) => c.id === guess.id);
  assert.deepEqual([none.employee_id, none.employee_source], [null, null], "nobody");
  assert.equal(e.rows.activity.length, before, "no activity line");
});

test("who may write: a manager with financials yes; a manager without, a lead, a viewer with the switch: refused by the database (42501)", { skip }, async () => {
  const engine = await freshEngine();
  const id = engine.rows.costs[0].id;
  const fin = await as("manager", engine);
  fin.me.can_see_financials = true;                         // switched on for this person (Desktop 2, Users)
  engine.rows.profiles.find((p) => p.id === fin.uid).can_see_financials = true;
  assert.equal(canTag(fin.me), true);
  assert.equal((await repo.tagCosts([id], "check")).changed, 1);
  for (const key of ["manager_prices", "lead", "field"]) {
    await as(key, engine);
    await assert.rejects(repo.tagCosts([id], "cash"), (err) => err.code === "42501", key);
    await assert.rejects(repo.reconcileCosts([id], true), (err) => err.code === "42501", key);
  }
  const v = await as("viewer", engine);
  engine.rows.profiles.find((p) => p.id === v.uid).can_see_financials = true;
  await assert.rejects(repo.tagCosts([id], "cash"), (err) => err.code === "42501", "a viewer reads, never writes");
  assert.equal(engine.rows.costs.find((c) => c.id === id).card, "check");
});

test("a project's Expenses: its own cost rows only; its Payments: bills with their payments (payee, memo, told) and invoices with lines and client payments", { skip }, async () => {
  const { e } = await as("admin");
  const sb = sandbox(e);
  const rows = await repo.projectExpenses(sb.id);
  assert.ok(rows.length >= 10 && rows.every((r) => r.projectId === sb.id));
  assert.equal(rows.length, e.rows.costs.filter((c) => c.project_id === sb.id).length);
  const got = await repo.projectPayments(sb.id);
  const T = today();
  const bills = got.bills.map((b) => decorateBill(b, T));
  assert.ok(bills.length >= 5);
  assert.ok(bills.some((b) => b.state === "paid"), "a paid bill");
  assert.ok(bills.some((b) => b.paid > 0 && b.owed > 0 && (b.state === "part_paid" || b.state === "overdue")), "a part-paid bill (overdue once its due day passed)");
  assert.ok(bills.some((b) => b.state === "needs_document") && bills.some((b) => b.state === "waiting"), "unapproved bills, with and without paperwork");
  const told = bills.flatMap((b) => b.payments).find((p) => p.pickup_told_at);
  assert.ok(told && told.pickup_told_how && "payee" in told && "memo" in told, "the payment's pick-up stamp, payee and memo are read");
  const tot = billTotals(bills);
  assert.equal(Math.round((tot.paid + tot.owed) * 100) / 100 <= Math.round(bills.filter((b) => b.approved && !b.voided).reduce((s, b) => s + b.approvedAmount, 0) * 100) / 100, true);
  const inv = got.invoices.map((i) => decorateInvoice(i, T));
  assert.ok(inv.length >= 2 && inv.some((i) => i.paid > 0));
});

test("a project's Payments know a voided payment (voided_at, void_reason): owed again, listed as void; a database without the columns is read again without them", { skip }, async () => {
  assert.ok(repo.BILL_COLS.includes("voided_at") && repo.BILL_COLS.includes("void_reason") && !repo.BILL_COLS_BEFORE.includes("voided_at"));
  const { e } = await as("accountant");
  const paidBill = e.rows.bills.find((b) => b.description === "Porch footings");
  const pay = e.rows.payments.find((p) => p.bill_id === paidBill.id);
  Object.assign(pay, { voided_at: new Date().toISOString(), voided_by: e.rows.profiles.find((p) => p.role === "admin").id, void_reason: "Made-up: written to the wrong payee" });
  const got = await repo.projectPayments(paidBill.project_id);
  const d = decorateBill(got.bills.find((b) => b.id === paidBill.id), today());
  assert.deepEqual([d.paid, d.owed > 0, d.state === "paid"], [0, true, false], "the Payments tab: owed again");
  assert.deepEqual(d.payments.filter((p) => p.voided).map((p) => [p.id, p.void_reason]), [[pay.id, "Made-up: written to the wrong payee"]]);
  // before migration 20261030000300: 42703 naming the column -> the same read without it
  const asked = [];
  const old = await repo.withVoids(async (cols) => {
    asked.push(cols);
    if (/voided_at/.test(cols)) throw Object.assign(new Error("column payments_1.voided_at does not exist"), { code: "42703" });
    return [{ id: 1 }];
  }, repo.BILL_COLS, repo.BILL_COLS_BEFORE);
  assert.deepEqual([old, asked], [[{ id: 1 }], [repo.BILL_COLS, repo.BILL_COLS_BEFORE]]);
  await assert.rejects(repo.withVoids(async () => { throw Object.assign(new Error("permission denied"), { code: "42501" }); }, "a", "b"), /permission denied/, "anything else is said");
});

test("the RPCs are called with M5b's argument names (the demo refuses any other, as PostgREST would)", { skip }, async () => {
  assert.deepEqual(Object.keys(repo.RPC.tag.args([1], "cash")), ["p_ids", "p_card"]);
  assert.deepEqual(Object.keys(repo.RPC.reconcile.args([1], true)), ["p_ids", "p_on"]);
  assert.deepEqual(Object.keys(repo.RPC.confirm.args([1], 2)), ["p_ids", "p_employee_id"]);
  assert.deepEqual([repo.RPC.tag.name, repo.RPC.reconcile.name, repo.RPC.confirm.name], ["tag_costs", "reconcile_costs", "confirm_cost_employee"]);
  assert.deepEqual(repo.outcome({ changed: [1, 2], unchanged: [3], refused: [{ id: 5, reason: "No such cost." }], card: "cash" }, 4),
    { changed: 2, unchanged: 1, refused: [{ id: 5, reason: "No such cost." }] });
  assert.deepEqual(repo.outcome(null, 4), { changed: 4, unchanged: 0, refused: [] });
});
