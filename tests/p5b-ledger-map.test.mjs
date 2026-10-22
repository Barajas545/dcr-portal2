// P5b: the ledger's pure rules (site/js/map/ledger.js, site/js/map/payments.js) — what counts as cost
// (materials + subcontractor + labour; equipment and other kept apart; billed-out never added), the card
// vocabulary, periods in company days, the employee as the database holds it ("inferred", never a fact until
// confirmed — the browser never guesses: M5b's app.cost_employee_guess is the one rule), grouping
// and totals as one piece of arithmetic, the CSV's formula guard, and Desktop 2's bill states.
// Made-up rows only.
import test from "node:test";
import assert from "node:assert/strict";

import * as L from "../site/js/map/ledger.js";
import * as P from "../site/js/map/payments.js";

const ROSTER = [{ id: 1, full_name: "Alex Juniper", active: true }, { id: 2, full_name: "Blair Sycamore", active: true },
  { id: 3, full_name: "Devon Madrone", active: true }, { id: 4, full_name: "Devon Ashgrove", active: true }];
const EMPLOYEES = Object.fromEntries(ROSTER.map((e) => [String(e.id), e]));
const PROJECTS = { 7: { id: 7, number: "A101", name: "Made-up Barn" }, 8: { id: 8, number: "A102", name: "Made-up Deck" } };
const ctx = { projects: PROJECTS, employees: EMPLOYEES, receipts: { 3: [{ id: 90, name: "r.jpg" }] }, nameOf: (u) => (u === "u1" ? "Casey Accounts" : "") };
let nextId = 0;
const cost = (f) => L.toLedgerRow(Object.assign({ id: ++nextId, project_id: 7, cost_date: "2026-10-10", kind: "material", amount: 0, version: 1 }, f), ctx);

test("review fix: the Payments tab's invoice figures are DCR Desktop 2's (inv_logic.figures / status_of): drafts apart, only a sent invoice overdue, an overpaid one not owed back - and the ledger's Billed out agrees", () => {
  const T = "2026-10-21";
  const rows = [
    { id: 1, number: "A101-01", status: "sent", invoice_date: "2026-09-20", due_date: "2026-10-05", invoice_lines: [{ amount: 10000 }], client_payments: [{ amount: 4000, paid_date: "2026-10-01" }] },
    { id: 2, number: "A101-02", status: "draft", invoice_date: "2026-10-01", due_date: "2026-10-10", invoice_lines: [{ amount: 5000 }], client_payments: [] },
    { id: 3, number: "A101-03", status: "paid", invoice_date: "2026-10-02", due_date: "2026-10-30", invoice_lines: [{ amount: 2000 }], client_payments: [{ amount: 2500, paid_date: "2026-10-03" }] },
    { id: 4, number: "A101-04", status: "void", invoice_date: "2026-10-03", invoice_lines: [{ amount: 777 }], client_payments: [] },
  ];
  const ivs = rows.map((r) => P.decorateInvoice(r, T));
  assert.deepEqual(ivs.map((i) => [i.statusText, i.overdue]), [["Sent", true], ["Draft", false], ["Paid", false], ["Void", false]],
    "a draft past its due day is a draft, never overdue");
  const t = P.invoiceTotals(ivs);
  // Desktop 2 figures() on the same invoices: invoiced 12000, collected 6500, outstanding 6000, drafts 5000
  assert.deepEqual([t.invoiced, t.collected, t.outstanding, t.drafts, t.sentCount, t.draftCount, t.overdue], [12000, 6500, 6000, 5000, 2, 1, 1]);
  assert.equal(L.billedOut(rows, null).total, t.invoiced, "the ledger's Billed out is the same figure");
  assert.equal(ivs[2].balance, -500, "the row keeps its own balance (a credit)");
});

test("cost is materials + subcontractor + labour; equipment and other are listed apart; billed-out is never added", () => {
  const rows = [
    cost({ kind: "material", amount: 100.1 }), cost({ kind: "subcontractor", amount: 200.2 }), cost({ kind: "labor", amount: 300.3 }),
    cost({ kind: "equipment", amount: 50 }), cost({ kind: "other", amount: 7.5 }),
  ];
  assert.deepEqual(rows.map((r) => r.cost), [100.1, 200.2, 300.3, 0, 0]);
  assert.deepEqual(rows.map((r) => r.other), [0, 0, 0, 50, 7.5]);
  const t = L.summarize(rows);
  assert.equal(t.cost, 600.6);
  assert.equal(t.other, 57.5);
  assert.equal(Math.round((t.materials + t.contractors + t.labor) * 100) / 100, t.cost);
  // billed out is its own figure: an invoice never changes the cost
  const out = L.billedOut([{ invoice_date: "2026-10-01", status: "sent", invoice_lines: [{ amount: 14800 }] },
    { invoice_date: "2026-10-02", status: "void", invoice_lines: [{ amount: 999 }] },
    { invoice_date: "2026-10-03", status: "draft", invoice_lines: [{ amount: 500 }] }], { from: "2026-09-12", to: "2026-10-11" });
  assert.deepEqual(out, { total: 14800, count: 1 });
  assert.equal(L.summarize(rows).cost, 600.6);
});

test("a labour row priced by the hour with no amount is hours × rate; a stored amount wins", () => {
  assert.equal(L.amountOf({ kind: "labor", hours: 3, rate: 45, amount: null }), 135);
  assert.equal(L.amountOf({ kind: "labor", hours: 3, rate: 45, amount: 120 }), 120);
  assert.equal(L.amountOf({ kind: "material", hours: 3, rate: 45, amount: null }), 0);
  assert.equal(cost({ kind: "labor", hours: 2.5, rate: 40, amount: null }).cost, 100);
});

test("the card vocabulary: the 8 ids of M5b's costs_card_check; 'untagged' (the column's default) is 'Not tagged yet'", () => {
  assert.deepEqual(L.CARDS.map((c) => c.id), ["untagged", "card-amex", "card-visa", "card-fuel", "check", "account", "employee", "cash"]);
  for (const v of [null, undefined, "", "untagged", "UNTAGGED"]) {
    assert.equal(L.cardOf(v), "untagged");
    assert.equal(L.cardLabel(v), "Not tagged yet");
  }
  assert.equal(L.cardLabel("card-fuel"), "Fuel card");
  assert.ok(L.isCardId("cash") && !L.isCardId("Amex 1007"));
  assert.equal(L.isTagged(cost({ card: "check" })), true);
  assert.equal(L.isTagged(cost({ card: "untagged" })), false);
});

test("periods are company days: the 30-day default includes today and the 29 days before", () => {
  assert.deepEqual(L.periodBounds("30", "2026-03-10"), { from: "2026-02-09", to: "2026-03-10" });
  assert.deepEqual(L.periodBounds("ytd", "2026-03-10"), { from: "2026-01-01", to: "2026-03-10" });
  assert.equal(L.periodBounds("all", "2026-03-10"), null);
  assert.deepEqual(L.periodBounds("nonsense", "2026-03-10"), { from: "2026-02-09", to: "2026-03-10" });
  assert.equal(L.stampDay("2026-10-21T05:30:00Z"), "2026-10-20", "a stamp at 10:30 pm Pacific is that Pacific day");
  assert.equal(L.stampDay("2026-10-21"), "2026-10-21");
});

test("the employee as the database holds it: confirmed, inferred (a link without a source never reads as confirmed), or nobody; the browser never guesses", () => {
  const a = cost({ kind: "labor", amount: 10, employee_id: 2, employee_source: "confirmed" });
  assert.deepEqual([a.employeeId, a.employeeName, a.employeeSource], [2, "Blair Sycamore", "confirmed"]);
  const b = cost({ kind: "labor", amount: 10, employee_id: 2, employee_source: "inferred" });
  assert.equal(b.employeeSource, "inferred");
  assert.equal(cost({ kind: "labor", amount: 10, employee_id: 2, employee_source: null }).employeeSource, "inferred");
  assert.equal(cost({ kind: "labor", amount: 10, employee_id: 99, employee_source: "inferred" }).employeeName, "Employee 99", "an employee this person cannot read");
  const c = cost({ kind: "labor", amount: 10, description: "Alex - pick up nails" });
  assert.deepEqual([c.employeeId, c.employeeName, c.employeeSource], [null, "", "none"], "no guess in the browser (M5b infers it)");
  assert.equal(L.guessEmployee, undefined, "no browser-side inference to drift from the database's");
});

test("one row: project label, kind columns, receipts, who tagged it, the estimate line", () => {
  const r = L.toLedgerRow({ id: 3, project_id: 7, cost_date: "2026-10-09", kind: "subcontractor", amount: 475, vendor: " Made-up Pumping ",
    description: "<div>Pump&nbsp;operator</div>", card: "check", card_by: "u1", card_at: "2026-10-09T18:00:00Z", estimate_item_id: 40, version: 2 },
  Object.assign({}, ctx, { items: { 40: { id: 40, estimate_id: 5, name: "Footings", group_name: "Concrete" } }, estimates: { 5: { id: 5, kind: "change_order", co_number: 2 } } }));
  assert.equal(r.projectLabel, "A101 — Made-up Barn");
  assert.equal(r.description, "Pump operator", "markup read as plain text");
  assert.equal(r.vendor, "Made-up Pumping");
  assert.deepEqual([r.contractors, r.cost, r.materials, r.other], [475, 475, 0, 0]);
  assert.equal(r.receipts.length, 1);
  assert.equal(r.cardBy, "Casey Accounts");
  assert.equal(r.group, "CO #2 · Concrete — Footings");
  assert.equal(r.version, 2);
});

test("ledgerView: every row not on screen is counted; a search reaches words and amounts; it says how many all dates would find", () => {
  nextId = 100;
  const rows = [
    cost({ cost_date: "2026-10-10", amount: 311.6, description: "studs" }),
    cost({ cost_date: "2026-10-01", amount: 0, description: "placeholder" }),
    cost({ cost_date: "2026-05-01", amount: 1284, description: "beam", project_id: 8 }),
    cost({ cost_date: "2025-06-01", amount: 145, description: "old hangers" }),
  ];
  const v = L.ledgerView(rows, { period: "30", today: "2026-10-21" });
  assert.equal(v.totals.count, 1);
  assert.deepEqual(v.excluded, { all: 4, outsidePeriod: 2, noAmount: 1, undated: 0 });
  assert.deepEqual(v.counts, { 30: 1, 90: 1, 365: 2, ytd: 2, all: 3 });
  const z = L.ledgerView(rows, { period: "30", today: "2026-10-21", zero: true });
  assert.equal(z.totals.count, 2);
  assert.equal(L.ledgerView(rows, { period: "all", q: "$311.60", today: "2026-10-21" }).totals.count, 1, "an amount, typed with $ and cents");
  assert.equal(L.ledgerView(rows, { period: "all", q: "1,284", today: "2026-10-21" }).totals.count, 1);
  assert.equal(L.ledgerView(rows, { period: "all", q: "A102", today: "2026-10-21" }).totals.count, 1, "the project number");
  const miss = L.ledgerView(rows, { period: "30", q: "hangers", today: "2026-10-21" });
  assert.equal(miss.totals.count, 0);
  assert.equal(miss.matchesAllTime, 1);
  assert.equal(L.ledgerView(rows, { period: "all", q: "und", today: "2026-10-21" }).totals.count, 0, "absent fields never match");
});

test("grouping: the header and its rows are one sum; untagged and unattributed on top; inferred and confirmed apart; kinds say what is not in Cost", () => {
  nextId = 200;
  const rows = [
    cost({ amount: 10, card: "card-amex" }), cost({ amount: 20.05, card: null }), cost({ amount: 30, card: "card-amex" }),
    cost({ kind: "labor", amount: 40, employee_id: 1, employee_source: "confirmed" }),
    cost({ kind: "labor", amount: 50, description: "Alex - trim", employee_id: 1, employee_source: "inferred" }),
    cost({ kind: "equipment", amount: 60 }),
  ];
  const byCard = L.groupRows(rows, "card");
  assert.equal(byCard[0].label, "Not tagged yet");
  assert.equal(byCard[0].pinned, true);
  for (const g of byCard) assert.equal(g.cost, L.summarize(g.rows).cost);
  const byEmp = L.groupRows(rows, "employee");
  assert.equal(byEmp[0].label, "Not attributed to anybody");
  const alex = byEmp.filter((g) => g.label === "Alex Juniper");
  assert.equal(alex.length, 2, "a confirmed and an inferred Alex are two groups, never added together");
  assert.deepEqual(alex.map((g) => g.source).sort(), ["confirmed", "inferred"]);
  const byKind = L.groupRows(rows, "kind");
  assert.ok(byKind.some((g) => g.label === "Equipment (not in Cost)" && g.cost === 0 && g.other === 60));
  assert.equal(L.groupRows(rows, "none"), null);
});

test("the CSV: CRLF, the formula guard on text, numbers as plain numbers (a credit too), the inference said out loud", () => {
  nextId = 300;
  const rows = [cost({ amount: 311.6, description: "=2x6 studs, 40 more" }), cost({ amount: -64.25, description: "+credit" }),
    cost({ kind: "labor", amount: 50, description: "Alex - trim", employee_id: 1, employee_source: "inferred" })];
  const text = L.csvText(L.ledgerCsvRows(rows));
  const lines = text.split("\r\n");
  assert.equal(lines[lines.length - 1], "", "ends with CRLF");
  assert.equal(lines.length, 5);
  assert.ok(!/[^\r]\n/.test(text), "no bare LF");
  assert.match(lines[0], /^"Date","Project","Description","Kind","Vendor","Materials"/);
  assert.match(lines[1], /,"'=2x6 studs, 40 more",/);
  assert.match(lines[1], /,311\.60,/);
  assert.match(lines[2], /,"'\+credit",/);
  assert.match(lines[2], /,-64\.25,/, "a negative amount is a number, not guarded text");
  assert.match(lines[3], /"Alex Juniper","inferred"/);
  for (const l of lines.slice(1, 4)) assert.ok(!/^[=+\-@]|,[=+\-@]/.test(l.replace(/,-\d+\.\d\d(?=,)/g, ",0")), "no cell a spreadsheet would run: " + l);
});

test("hours by employee: work rows only, the calculated hours first; never money", () => {
  const h = L.hoursByEmployee([
    { employee_id: 1, kind: "work", hours: 8, calculated_hours: 7.5 }, { employee_id: 1, kind: "work", hours: 2, calculated_hours: null },
    { employee_id: 2, kind: "vacation", hours: 8 }, { employee_id: 2, kind: "work", hours: 0 },
  ], EMPLOYEES);
  assert.deepEqual(h, { rows: [{ id: "1", name: "Alex Juniper", hours: 9.5 }], total: 9.5 });
});

test("gates (UI only): the ledger with financials; tag, reconcile and confirm for money editors", () => {
  const me = (role, fin, extra) => Object.assign({ role, active: true, can_see_financials: !!fin }, extra || {});
  assert.equal(L.seesLedger(me("admin")), true);
  assert.equal(L.seesLedger(me("accountant", true)), true);
  assert.equal(L.seesLedger(me("manager", false, { can_see_prices: true })), false, "prices are not financials");
  assert.equal(L.seesLedger(me("manager", true)), true);
  assert.equal(L.seesLedger(me("lead")), false);
  assert.equal(L.seesLedger(me("agents", true)), false);
  assert.equal(L.seesLedger(Object.assign(me("accountant", true), { active: false })), false);
  assert.equal(L.canTag(me("accountant", true)), true);
  assert.equal(L.canTag(me("manager", true)), true);
  assert.equal(L.canTag(me("accountant", false)), false);
  assert.equal(L.canTag(me("viewer", true)), false, "a viewer with the switch reads, never writes");
});

test("bill states are DCR Desktop 2's (money_logic.bill_state): void, needs document, waiting, approved, part paid, paid, overdue", () => {
  const T = "2026-10-21";
  const b = (f) => Object.assign({ id: 1, amount: 100, void: false, document_file_id: null, approved_at: null, approved_amount: null, due_date: null, payments: [] }, f);
  assert.equal(P.decorateBill(b({ void: true }), T).state, "void");
  assert.equal(P.decorateBill(b({}), T).state, "needs_document");
  assert.equal(P.decorateBill(b({ document_file_id: 5 }), T).state, "waiting");
  const ap = { document_file_id: 5, approved_at: "2026-10-01T00:00:00Z", approved_amount: 100, pay_method: "check" };
  assert.equal(P.decorateBill(b(ap), T).state, "approved");
  const part = P.decorateBill(b(Object.assign({}, ap, { payments: [{ id: 2, amount: 40, paid_date: "2026-10-05" }] })), T);
  assert.deepEqual([part.state, part.paid, part.owed], ["part_paid", 40, 60]);
  assert.equal(P.decorateBill(b(Object.assign({}, ap, { payments: [{ amount: 100 }] })), T).state, "paid");
  assert.equal(P.decorateBill(b(Object.assign({}, ap, { due_date: "2026-10-20" })), T).state, "overdue");
  const tot = P.billTotals([P.decorateBill(b({ void: true, amount: 999 }), T), part, P.decorateBill(b({ document_file_id: 5, amount: 250 }), T)]);
  assert.deepEqual([tot.count, tot.billed, tot.waiting, tot.waitingCount, tot.paid, tot.owed], [2, 350, 250, 1, 40, 60], "void counts for nothing");
  const iv = P.decorateInvoice({ id: 1, number: "A101-01", status: "sent", invoice_date: "2026-10-01", due_date: "2026-10-16",
    invoice_lines: [{ amount: 1000 }, { amount: 450.5 }], client_payments: [{ amount: 500 }] }, T);
  assert.deepEqual([iv.total, iv.paid, iv.balance, iv.overdue], [1450.5, 500, 950.5, true]);
  assert.equal(P.toldText({ pickup_told_at: "2026-10-20T19:00:00Z", pickup_told_how: "phone", pickup_told_by: "Casey Accounts" }, (v) => "D"),
    "Told it is ready D · phone · Casey Accounts");
  assert.equal(P.paymentText({ paid_date: "2026-10-05", method: "check", check_number: "5203" }, (v) => v), "2026-10-05 · Check · #5203");
});
