// P5b The Books - site/js/repo/books.js over the demo database (tools/fake/p5b-books.js: M5b's books rules, the
// money tables' triggers, approve_bill, set_bill_pay_method, the QuickBooks marker RPCs, payment_told, books_desk) as
// each role. P5 acceptance checks 2 (approval), 3 (mark entered, refused[]) and 5 (no amount in an activity row).
// tools/schema-books.mjs runs the same module against the REAL migration in PGlite.
import test from "node:test";
import assert from "node:assert/strict";
import { available, loadFake, freshEngine, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import { clearPeople } from "../site/js/repo/people.js";
import * as books from "../site/js/repo/books.js";

const skip = !available && "the demo database (tools/fake) is not here";
let F, E;
async function setup() {
  F = await loadFake();
  E = await freshEngine(new Date());
}
const id = (key) => F.PEOPLE.find((p) => p.key === key).id;
function me(key) {
  const p = E.rows.profiles.find((x) => x.id === id(key));
  const admin = p.role === "admin";
  return { id: p.id, name: p.full_name, role: p.role, active: p.active !== false, can_see_prices: admin || !!p.can_see_prices,
    can_see_financials: admin || !!p.can_see_financials, can_approve_payments: admin || !!p.can_approve_payments };
}
/** as `key`, recording every table / rpc the module asks for */
function as(key) {
  const c = clientAs(E, id(key));
  const asked = [];
  const wrapped = { from: (t) => { asked.push(t); return c.from(t); }, rpc: (n, a) => { asked.push("rpc:" + n); return c.rpc(n, a); }, storage: c.storage };
  useClient(wrapped);
  clearPeople();
  return asked;
}
const bill = (desc) => E.rows.bills.find((b) => b.description === desc);
async function refused(fn, code) {
  try { await fn(); } catch (e) { assert.equal(e.code, code, e.message); return e; }
  assert.fail("expected " + code);
}

test("the demo approver: a manager with approve and financials, no prices (Q1)", { skip }, async () => {
  await setup();
  const p = me("approver");
  assert.deepEqual([p.role, p.can_see_prices, p.can_see_financials, p.can_approve_payments], ["manager", false, true, true]);
});

test("loadDesk: the financials switch; everyone else is refused BEFORE anything is read", { skip }, async () => {
  await setup();
  for (const k of ["admin", "accountant", "approver"]) {
    as(k);
    const d = await books.loadDesk(me(k));
    assert.ok(d.ready.length >= 3 && d.waiting.length >= 2 && d.blocked.length >= 1 && d.entered.length >= 2, k);
    assert.ok(d.checks.toPay.length >= 3 && d.checks.toTell.length >= 1, k);
    assert.equal(d.can.approve, k !== "accountant", k + ": approve only for an admin or an approver");
    assert.equal(d.can.mark, true);
  }
  for (const k of ["manager", "manager_prices", "lead", "field", "viewer"]) {
    const asked = as(k);
    await refused(() => books.loadDesk(me(k)), "42501");
    assert.deepEqual(asked, [], k + ": nothing asked");
  }
  useClient(null);
});

test("books_desk (M5b): the bill's columns, the project label, paid_total, owed, state, reason, pay_state - only with financials", { skip }, async () => {
  await setup();
  const c = clientAs(E, id("accountant"));
  const rows = (await c.from("books_desk").select("*")).data;
  const r = rows.find((x) => x.id === bill("Telehandler, one week").id);
  assert.equal(r.state, "ready");
  assert.equal(r.paid_total, 400);
  assert.equal(r.owed, 800);
  assert.equal(r.pay_state, "part_paid");
  assert.equal(r.kind, "Equipment");
  assert.match(r.project_label, /^A294 — /);
  const blocked = rows.find((x) => x.id === bill("Roof framing package (back order)").id);
  assert.deepEqual([blocked.state, blocked.reason, blocked.documented], ["blocked", "No invoice attached, so it cannot be approved.", false]);
  for (const k of ["manager", "lead", "agents"]) assert.deepEqual((await clientAs(E, id(k)).from("books_desk").select("*")).data, [], k);
});

test("approvals card: approvers only (an accountant gets nothing - and nothing is read)", { skip }, async () => {
  await setup();
  as("approver");
  const q = await books.approvals(me("approver"));
  assert.ok(q.count >= 3 && q.missingDocument >= 1 && q.amount > 0);
  for (const k of ["accountant", "manager", "lead"]) {
    const asked = as(k);
    assert.equal(await books.approvals(me(k)), null);
    assert.deepEqual(asked, []);
  }
  useClient(null);
});

test("acceptance check 2: approve - pay method REQUIRED, version as shown, document required; admin or approver only", { skip }, async () => {
  await setup();
  const b0 = bill("Footings and stem wall, phase 1");
  const shown = { id: b0.id, version: b0.version };
  as("accountant");
  await refused(() => books.approve(shown, "check"), "42501");
  as("manager");
  await refused(() => books.approve(shown, "check"), "42501");
  as("approver");
  await refused(() => books.approve(shown, null), "22023");
  await refused(() => books.approve(shown, "wire"), "22023");
  await refused(() => books.approve({ id: b0.id, version: b0.version - 1 }, "check"), "PT409");
  await refused(() => books.approve({ id: bill("Roof framing package (back order)").id, version: bill("Roof framing package (back order)").version }, "check"), "23514");
  const done = await books.approve(shown, "check", "  Matches the quote  ");
  assert.equal(done.approved_by, id("approver"));
  assert.equal(Number(done.approved_amount), Number(b0.amount));
  assert.equal(done.pay_method, "check");
  assert.equal(done.approval_note, "Matches the quote");
  // an edit of the approved amount clears the approval (Desktop 2 edits; the rule is the database's)
  const c = clientAs(E, id("admin"));
  const ed = await c.from("bills").update({ amount: 3900 }).eq("id", b0.id).eq("version", done.version).select("approved_at, pay_method");
  assert.deepEqual(ed.data[0], { approved_at: null, pay_method: null });
  useClient(null);
});

test("set_bill_pay_method: approve authority, an approved bill with no payment, as shown", { skip }, async () => {
  await setup();
  const b = bill("-10% retainage held until the final walk");
  as("accountant");
  await refused(() => books.setPayMethod({ id: b.id, version: b.version }, "cash"), "42501");
  as("approver");
  const r = await books.setPayMethod({ id: b.id, version: b.version }, "cash");
  assert.equal(r.pay_method, "cash");
  await refused(() => books.setPayMethod({ id: b.id, version: b.version }, "both"), "PT409");
  const part = bill("Telehandler, one week");
  await refused(() => books.setPayMethod({ id: part.id, version: part.version }, "check"), "23514");
  const waiting = bill("Footings and stem wall, phase 1");
  await refused(() => books.setPayMethod({ id: waiting.id, version: waiting.version }, "check"), "23514");
  useClient(null);
});

test("recording a payment: the money editors; the method the approver allowed; a check's number; never above the approved amount", { skip }, async () => {
  await setup();
  const part = bill("Telehandler, one week");         // approved "both" for 1,200, 400 paid in cash
  const shape = { id: part.id, projectId: part.project_id };
  as("lead");
  await refused(() => books.recordPayment(shape, { amount: 10, method: "cash" }), "42501");
  as("accountant");
  await refused(() => books.recordPayment(shape, { amount: 800.01, method: "cash" }), "23514");
  await refused(() => books.recordPayment(shape, { amount: 100, method: "check", checkNumber: "" }), "23514");
  const p = await books.recordPayment(shape, { amount: 800, method: "check", checkNumber: " 6001 ", payee: "  Hillside Equipment Rental ", memo: "x".repeat(140) });
  assert.deepEqual([p.method, p.checkNumber, p.payee, p.memo.length, p.amount], ["check", "6001", "Hillside Equipment Rental", 100, 800]);
  await refused(() => books.recordPayment(shape, { amount: 0.01, method: "cash" }), "23514");
  const cash = bill("Slab patch at the roll-up door");
  await refused(() => books.recordPayment({ id: cash.id, projectId: cash.project_id }, { amount: 10, method: "check", checkNumber: "1" }), "23514");
  const waiting = bill("Footings and stem wall, phase 1");
  await refused(() => books.recordPayment({ id: waiting.id, projectId: waiting.project_id }, { amount: 10, method: "cash" }), "23514");
  // the pick-up stamp is never a person's write
  const c = clientAs(E, id("accountant"));
  const bad = await c.from("payments").insert({ bill_id: cash.id, amount: 5, method: "cash", pickup_told_at: new Date().toISOString(), pickup_told_how: "phone" });
  assert.equal(bad.error.code, "42501");
  useClient(null);
});

test("payment_told: versioned; how normalised; cleared with null; a told payment cannot be deleted", { skip }, async () => {
  await setup();
  const porch = bill("Porch footings");
  const pay = E.rows.payments.find((p) => p.bill_id === porch.id);
  as("lead");
  await refused(() => books.markTold({ paymentId: pay.id, version: pay.version }, "phone"), "42501");
  as("accountant");
  await refused(() => books.markTold({ paymentId: pay.id, version: pay.version }, "pigeon"), "22023");
  await refused(() => books.markTold({ paymentId: pay.id, version: pay.version + 5 }, "phone"), "PT409");
  const r = await books.markTold({ paymentId: pay.id, version: pay.version }, "text");
  assert.deepEqual([r.ok, r.toldHow, r.toldBy], [true, "text message", "Casey Accounts"]);
  const again = await books.markTold({ paymentId: pay.id, version: r.version }, "phone");
  assert.equal(again.already, true, "told once");
  const c = clientAs(E, id("accountant"));
  const del = await c.from("payments").delete().eq("id", pay.id).select("id");
  assert.equal(del.error.code, "23514");
  const cleared = await books.markTold({ paymentId: pay.id, version: r.version }, null);
  assert.equal(cleared.toldAt, null);
  const del2 = await c.from("payments").delete().eq("id", pay.id).select("id");
  assert.equal(del2.error, null, "not told any more: a money editor may delete it");
  useClient(null);
});

test("acceptance check 3: mark entered only ready bills (refused[] with the reason); unmark; a marked bill is locked", { skip }, async () => {
  await setup();
  const ready = bill("-10% retainage held until the final walk"), waiting = bill("Footings and stem wall, phase 1"),
    nodoc = bill("Roof framing package (back order)"), entered = bill("Porch footings");
  as("manager");
  await refused(() => books.markBillsEntered([ready.id], "QB"), "42501");
  as("accountant");
  await refused(() => books.markBillsEntered([], "QB"), "22023");
  const r = await books.markBillsEntered([ready.id, waiting.id, nodoc.id, entered.id, 999999], "  QB   batch 9 ");
  assert.deepEqual(r.marked, [ready.id]);
  assert.deepEqual(r.refused.map((x) => [x.id, x.reason]), [
    [waiting.id, "Waiting for a manager or admin to approve it."],
    [nodoc.id, "No invoice attached, so it cannot be approved."],
    [entered.id, "Already entered as QB-1051."],
    [999999, "No such bill."],
  ].sort((a, b) => a[0] - b[0]));
  const row = E.rows.bills.find((b) => b.id === ready.id);
  assert.deepEqual([row.qbo_entered_by, row.qbo_ref, !!row.qbo_entered_at], [id("accountant"), "QB batch 9", true]);
  // locked while marked: amount, withdrawing the approval
  const c = clientAs(E, id("admin"));
  const ed = await c.from("bills").update({ amount: 1 }).eq("id", ready.id).eq("version", row.version).select("id");
  assert.equal(ed.error.code, "23514");
  const un = await c.rpc("unapprove_bill", { id: ready.id, version: row.version });
  assert.equal(un.error.code, "23514");
  // the marker is never a person's write
  const direct = await c.from("bills").update({ qbo_ref: "x" }).eq("id", nodoc.id).eq("version", nodoc.version).select("id");
  assert.equal(direct.error.code, "42501");
  const u = await books.unmarkBillsEntered([ready.id, waiting.id]);
  assert.deepEqual(u.marked, [ready.id]);
  assert.deepEqual(u.refused, [{ id: waiting.id, reason: "It was not marked as entered." }]);
  useClient(null);
});

test("invoices carry the marker too: sent or paid, an amount, not entered", { skip }, async () => {
  await setup();
  const c0 = clientAs(E, id("accountant"));
  const inv = (await c0.from("invoices").select("id, status, qbo_entered_at")).data;
  const sent = inv.find((i) => (i.status === "sent" || i.status === "paid") && !i.qbo_entered_at);
  const done = inv.find((i) => i.qbo_entered_at);
  as("accountant");
  const r = await books.markInvoicesEntered([sent.id, done.id], "INV batch");
  assert.deepEqual(r.marked, [sent.id]);
  assert.match(r.refused[0].reason, /^Already entered/);
  const u = await books.unmarkInvoicesEntered([sent.id]);
  assert.deepEqual(u.marked, [sent.id]);
  useClient(null);
});

test("acceptance check 5: none of the books' writes leaves an activity row or an outbox row", { skip }, async () => {
  await setup();
  const acts = E.rows.activity.length, out = E.rows.notifications_outbox.length;
  const w = bill("Footings and stem wall, phase 1");
  as("approver");
  const a = await books.approve({ id: w.id, version: w.version }, "both");
  as("accountant");
  const p = await books.recordPayment({ id: w.id, projectId: w.project_id }, { amount: 100, method: "cash", payee: "Quarryman Concrete" });
  await books.markTold({ paymentId: p.id, version: p.version }, "in person");
  await books.markBillsEntered([w.id], "QB");
  await books.unmarkBillsEntered([w.id]);
  assert.ok(a);
  assert.equal(E.rows.activity.length, acts);
  assert.equal(E.rows.notifications_outbox.length, out);
  useClient(null);
});

test("loadBill: the bill, its payments, the documents (its own first), the quote's amount only with prices", { skip }, async () => {
  await setup();
  const sb = E.rows.bills.find((b) => b.quote_id && b.approved_at && E.rows.payments.some((p) => p.bill_id === b.id));
  as("admin");
  const a = await books.loadBill(sb.id, me("admin"));
  assert.equal(a.bill.id, sb.id);
  assert.ok(a.payments.length >= 1 && a.files.length >= 1 && a.files[0].primary);
  assert.ok(a.quote && typeof a.quote.amount === "number");
  as("approver");
  const b = await books.loadBill(sb.id, me("approver"));
  assert.equal(b.quote.amount, null, "Q1: no prices switch, no quote amount (quote_prices)");
  assert.equal(b.can.approve, true);
  as("accountant");
  assert.equal((await books.loadBill(sb.id, me("accountant"))).can.approve, false);
  const asked = as("lead");
  await refused(() => books.loadBill(sb.id, me("lead")), "42501");
  assert.deepEqual(asked, []);
  useClient(null);
});

test("review fix (M5b t01_payments_client in the demo database): the approver's way binds - no transfer, card or 'other' on a vendor bill; a told payment keeps what the payee was told; payment_told clears any mark", { skip }, async () => {
  await setup();
  const cash = bill("Slab patch at the roll-up door");   // approved for cash
  const part = bill("Telehandler, one week");            // approved "both", 400 paid in cash
  const c = clientAs(E, id("accountant"));
  for (const method of ["ach", "card", "wire", "other"]) {
    const r = await c.from("payments").insert({ bill_id: cash.id, amount: 5, method, reference: "paid in cash really" }).select("id");
    assert.equal(r.error && r.error.code, "23514", method);
    assert.match(r.error.message, /approved to be paid by cash/);
    const r2 = await c.from("payments").insert({ bill_id: part.id, amount: 5, method }).select("id");
    assert.match(r2.error && r2.error.message, /approved to be paid by check or cash/, method + " on 'both'");
  }
  const ok = await c.from("payments").insert({ bill_id: cash.id, amount: 5, method: "cash" }).select("id, version");
  assert.equal(ok.error, null);
  const pay = ok.data[0];
  assert.match((await c.from("payments").update({ method: "wire" }).eq("id", pay.id).select("id")).error.message, /approved to be paid by cash/,
    "nor switched afterwards");
  useClient(c);
  const told = await books.markTold({ paymentId: pay.id, version: pay.version }, "phone");
  for (const patch of [{ amount: 6 }, { reference: "slip 9" }, { payee: "Someone Else" }]) {
    const r = await c.from("payments").update(patch).eq("id", pay.id).select("id");
    assert.equal(r.error && r.error.code, "23514", JSON.stringify(patch));
    assert.match(r.error.message, /clear the told mark first/);
  }
  const memo = await c.from("payments").update({ memo: "Slab patch" }).eq("id", pay.id).select("id, version");
  assert.equal(memo.error, null, "its memo still changes");
  const cleared = await books.markTold({ paymentId: pay.id, version: memo.data[0].version }, null);
  assert.equal(cleared.toldAt, null);
  assert.equal((await c.from("payments").update({ amount: 6 }).eq("id", pay.id).select("id")).error, null, "cleared: it changes again");
  assert.equal(told.toldHow, "phone");
  useClient(null);
});
