// The Books program, release A (P3): site/js/repo/checks.js and the payments' register columns of repo/books.js over the
// demo database (tools/fake/p8-register.js: check_register, spoiled_checks, the register RPCs, the void switch, the
// payments' stamps as system code's) as each role. tools/schema-check-p8-register.mjs runs the same module against the
// REAL migration (20261030000300_check_register) in PGlite. Made-up people and jobs only.
import test from "node:test";
import assert from "node:assert/strict";
import { available, loadFake, freshEngine, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import { clearPeople } from "../site/js/repo/people.js";
import * as books from "../site/js/repo/books.js";
import * as checks from "../site/js/repo/checks.js";
import { buildRegister, rowActions } from "../site/js/map/checks.js";

const skip = !available && "the demo database (tools/fake) is not here";
let F, E;
async function setup() { F = await loadFake(); E = await freshEngine(new Date()); }
const uid = (key) => F.PEOPLE.find((p) => p.key === key).id;
function me(key) {
  const p = E.rows.profiles.find((x) => x.id === uid(key));
  const admin = p.role === "admin";
  return { id: p.id, name: p.full_name, role: p.role, active: p.active !== false, can_see_prices: admin || !!p.can_see_prices,
    can_see_financials: admin || !!p.can_see_financials, can_approve_payments: admin || !!p.can_approve_payments };
}
/** as `key`, recording every table / rpc asked for and every select's columns */
function as(key) {
  const c = clientAs(E, uid(key));
  const asked = [];
  const wrap = (t) => {
    const q = c.from(t);
    const sel = q.select.bind(q);
    q.select = (cols) => { asked.push(t + ":" + (cols || "*")); return sel(cols); };
    return q;
  };
  useClient({ from: (t) => { asked.push(t); return wrap(t); }, rpc: (n, a) => { asked.push("rpc:" + n); return c.rpc(n, a); }, storage: c.storage });
  clearPeople();
  return asked;
}
async function refused(fn, code, re) {
  try { await fn(); } catch (e) { assert.equal(e.code, code, e.message); if (re) assert.match(e.message, re); return e; }
  assert.fail("expected " + code);
}
async function register(key) {
  const raw = await checks.loadRegister(me(key));
  return Object.assign(buildRegister(raw, { today: raw.today }), { raw });
}
const line = (d, n) => d.rows.find((r) => r.number === n);

test("loadRegister: the financials switch; everyone else is refused BEFORE anything is read", { skip }, async () => {
  await setup();
  for (const k of ["admin", "accountant", "approver"]) {
    as(k);
    const d = await register(k);
    assert.deepEqual(d.rows.map((r) => r.number).slice(0, 4), ["5310", "5308", "5202", "5307"], k + ": newest first");
    assert.equal(line(d, "5308").paymentIds.length, 2, "one check, two bills of one supplier on one day");
    assert.equal(line(d, "5308").status, "told");
    assert.equal(line(d, "5306").status, "cleared");
    assert.equal(line(d, "5307").kind, "spoiled");
    assert.ok(d.gaps.some((g) => g.from === "5309" && g.count === 1), k + ": #5309 missing");
    assert.equal(d.next.next, "5309");
    assert.equal(d.raw.voidEnabled, false, "voiding off");
    assert.equal(d.raw.can.money, true);
    assert.equal(d.raw.can.admin, k === "admin");
  }
  for (const k of ["manager", "manager_prices", "lead", "field", "viewer"]) {
    const asked = as(k);
    await refused(() => checks.loadRegister(me(k)), "42501");
    assert.deepEqual(asked, [], k + ": nothing asked");
  }
});

test("S4: without the prices switch no amount is even asked for - neither the register's amounts nor the payments'", { skip }, async () => {
  await setup();
  const asked = as("approver");
  const d = await register("approver");
  const sels = asked.filter((x) => x.includes(":"));
  assert.ok(sels.some((x) => x.startsWith("check_register:")), "the register was read");
  for (const s of sels.filter((x) => /^(check_register|payments):/.test(x))) assert.ok(!/\bamount\b|written_amount/.test(s), "no amount column: " + s);
  assert.ok(d.rows.every((r) => r.amount === undefined && r.writtenAmount === undefined && r.payments.every((p) => p.amount === null)));
  const asked2 = as("accountant");
  const d2 = await register("accountant");
  assert.ok(asked2.some((x) => /^check_register:.*amount, written_amount/.test(x)), "with prices: the amounts");
  assert.equal(line(d2, "5308").amount, 651.75);
});

test("picked up: the day and who collected it; told in person when nobody was; undo; a cash one too; system code's stamps only", { skip }, async () => {
  await setup();
  as("accountant");
  let d = await register("accountant");
  const r = line(d, "5310");
  assert.deepEqual(rowActions(r, {}).pickUp, true);
  const p = r.live[0];
  const t = F.companyDay(new Date());
  await refused(() => checks.pickedUp(p, true, { date: "2001-01-01" }), "22023", /the day it was picked up is between/);
  const res = await checks.pickedUp(p, true, { note: "their foreman" });
  assert.ok(res.pickedUpAt && res.toldHow === "in person" && res.pickedUpNote === "their foreman", JSON.stringify(res));
  await refused(() => checks.pickedUp(p, true, {}), "PT409", /changed by someone else/);
  d = await register("accountant");
  const r2 = line(d, "5310");
  assert.equal(r2.status, "picked_up");
  assert.equal(r2.pickedUpDay, t);
  assert.equal(rowActions(r2, {}).undoPickUp, true);
  await refused(() => books.markTold(Object.assign({}, r2.live[0], { paymentId: r2.live[0].id }), null), "23514", /the told mark stays/);
  await checks.pickedUp(r2.live[0], false);
  d = await register("accountant");
  assert.equal(line(d, "5310").status, "told", "back to told (in person stays)");
  // a person cannot stamp it by an update
  const row = E.rows.payments.find((x) => x.check_number === "5310");
  const c = clientAs(E, uid("accountant"));
  const bad = await c.from("payments").update({ picked_up_at: new Date().toISOString() }).eq("id", row.id).eq("version", row.version).select("id");
  assert.equal(bad.error && bad.error.code, "42501");
  // the desk: the picked-up check is no longer to tell
  as("accountant");
  await checks.pickedUp(line(await register("accountant"), "5310").live[0], true, {});
  const desk = await books.loadDesk(me("accountant"));
  assert.ok(!desk.checks.toTell.some((x) => x.checkNumber === "5310"));
  as("manager");
  await refused(() => checks.pickedUp(p, true, {}), "42501");
});

test("clear_payments: a statement date, refused lines with reasons (cash, voided, written after that day, unknown); undo; never in the future", { skip }, async () => {
  await setup();
  as("accountant");
  const d = await register("accountant");
  const ids = line(d, "5308").paymentIds.concat(line(d, "5202").paymentIds);
  const cash = E.rows.payments.find((x) => x.method === "cash");
  const t = F.companyDay(new Date());
  await refused(() => checks.clearPayments(ids, true, "2999-01-01"), "22023", /clears today or earlier/);
  const r = await checks.clearPayments(ids.concat([cash.id, 999999]), true, t);
  assert.deepEqual(r.changed.sort(), ids.slice().sort());
  assert.deepEqual(r.refused.map((x) => [x.id, x.reason]).sort(), [[cash.id, "Cash never goes through the bank."], [999999, "No such payment."]].sort());
  assert.equal(r.clearedOn, t);
  const again = await checks.clearPayments(ids, true, t);
  assert.deepEqual([again.changed.length, again.unchanged.length], [0, ids.length]);
  const early = await checks.clearPayments([line(d, "5202").paymentIds[0]], true, "2001-01-01");
  assert.equal(early.refused[0].reason, "It was written after that day.");
  const d2 = await register("accountant");
  assert.equal(line(d2, "5308").status, "cleared");
  const undo = await checks.clearPayments(r.changed, false);
  assert.deepEqual(undo.changed.sort(), ids.slice().sort());
  assert.equal(line(await register("accountant"), "5308").status, "told");
  // a cleared payment is never deleted, nor changed
  await checks.clearPayments([line(d2, "5202").paymentIds[0]], true, t);
  const c = clientAs(E, uid("accountant"));
  const p = E.rows.payments.find((x) => x.check_number === "5202");
  const del = await c.from("payments").delete().eq("id", p.id);
  assert.equal(del.error && del.error.code, "23514");
  assert.match(del.error.message, /cleared the bank: it cannot be deleted/);
  const upd = await c.from("payments").update({ memo: "x", paid_date: "2026-01-01" }).eq("id", p.id).eq("version", p.version).select("id");
  assert.equal(upd.error && upd.error.code, "23514");
});

test("spoil a blank: a number never written, why (3-300); its number refused afterwards; unspoil (a mistake)", { skip }, async () => {
  await setup();
  as("accountant");
  await refused(() => checks.spoilCheck("5306", "torn"), "23505", /was written \(Stonebrook Concrete, .*\): only a blank never used is spoiled - void the check instead/);
  await refused(() => checks.spoilCheck("5307", "torn"), "23505", /already marked spoiled/);
  await refused(() => checks.spoilCheck("5309", "x"), "22023", /3 to 300/);
  await refused(() => checks.spoilCheck("#", "torn up"), "22023");
  const s = await checks.spoilCheck("5309", "Printed crooked");
  assert.deepEqual([s.number, s.key, s.reason], ["5309", "5309", "Printed crooked"]);
  const d = await register("accountant");
  assert.ok(!d.gaps.some((g) => g.from === "5309"), "the gap is explained");
  assert.equal(d.next.next, "5311", "the next number moves past it");
  const b = E.rows.bills.find((x) => x.vendor_name === "Ashgrove Concrete" && x.approved_at);
  await refused(() => books.recordPayment({ id: b.id, projectId: b.project_id }, { amount: 10, method: "check", checkNumber: "05309" }), "23505", /a spoiled blank/);
  await checks.unspoilCheck(s.id);
  await refused(() => checks.unspoilCheck(s.id), "PT404");
  as("viewer");
  await refused(() => checks.spoilCheck("6000", "torn up"), "42501");
});

test("void: 55000 while the switch is off; the admin's switch (settings are admin-write); then final, the bill owed again, refused once cleared", { skip }, async () => {
  await setup();
  as("accountant");
  let d = await register("accountant");
  const r = line(d, "5310");
  await refused(() => checks.voidPayment(r.live[0], "lost in the mail"), "55000", /turned on by an admin once every DCR Desktop 2 runs 2\.25/);
  // only an admin turns it on
  await refused(() => checks.setVoidEnabled(true, d.raw.settingsVersion), "42501");
  as("admin");
  const sw = await checks.voidSwitch();
  assert.equal(sw.on, false);
  const on = await checks.setVoidEnabled(true, sw.version);
  assert.equal(on.on, true);
  await refused(() => checks.setVoidEnabled(false, sw.version), "PT409", undefined);
  as("accountant");
  d = await register("accountant");
  assert.equal(d.raw.voidEnabled, true);
  assert.equal(rowActions(line(d, "5310"), { voidEnabled: true }).void, true);
  assert.equal(rowActions(line(d, "5306"), { voidEnabled: true }).void, false, "a cleared check is never voided");
  await refused(() => checks.voidPayment(line(d, "5310").live[0], "x"), "22023", /3 to 300/);
  const before = (await books.loadDesk(me("accountant"))).checks.toPay.length;
  const v = await checks.voidPayment(line(d, "5310").live[0], "Lost in the mail - a new check is written");
  assert.ok(v.voidedAt && v.voidReason === "Lost in the mail - a new check is written");
  d = await register("accountant");
  assert.equal(line(d, "5310").status, "void");
  assert.equal(line(d, "5310").amount, 0, "a void counts in no sum");
  assert.equal(line(d, "5310").writtenAmount, 2950);
  const desk = await books.loadDesk(me("accountant"));
  assert.equal(desk.checks.toPay.length, before + 1, "the bill is owed again");
  assert.ok(!desk.checks.toTell.some((x) => x.checkNumber === "5310"), "nobody is told about a void");
  // final: never changed, never deleted, the number never written again
  const p = E.rows.payments.find((x) => x.check_number === "5310");
  const c = clientAs(E, uid("accountant"));
  assert.equal((await c.from("payments").update({ memo: "x" }).eq("id", p.id).eq("version", p.version).select("id")).error.code, "23514");
  assert.match((await c.from("payments").delete().eq("id", p.id)).error.message, /a void is final/);
  const b = E.rows.bills.find((x) => x.id === p.bill_id);
  await refused(() => books.recordPayment({ id: b.id, projectId: b.project_id }, { amount: 100, method: "check", checkNumber: "5310", payee: "Brightwater Concrete" }), "23505", /voided/);
  const rec = await books.recordPayment({ id: b.id, projectId: b.project_id }, { amount: 2950, method: "check", checkNumber: "5312", payee: "Brightwater Concrete" });
  assert.equal(rec.amount, 2950, "the replacement check fits");
  await refused(() => books.markTold({ paymentId: p.id, version: p.version }, "phone"), "23514", /voided/);
  const again = await checks.voidPayment({ id: p.id, version: p.version }, "twice");
  assert.equal(again.already, true);
  await refused(() => checks.pickedUp({ id: p.id, version: p.version }, true, {}), "23514", /voided/);
});

test("the payments' register columns: a database without them yet is read again without them (the published pages' columns)", { skip }, async () => {
  await setup();
  as("accountant");
  const c = clientAs(E, uid("accountant"));
  const asked = [];
  // a stand-in client that answers 42703 for any of the register columns, as a database before M3 would
  useClient({
    from: (t) => {
      const q = c.from(t);
      const sel = q.select.bind(q);
      q.select = (cols) => {
        asked.push(t + ":" + cols);
        if (t === "payments" && /voided_at|picked_up_at|cleared_on/.test(String(cols))) {
          const fake = { then: (res) => Promise.resolve({ data: null, error: { code: "42703", message: "column payments.voided_at does not exist" }, status: 400 }).then(res) };
          ["eq", "order", "range", "in", "is", "gte"].forEach((m) => { fake[m] = () => fake; });
          return fake;
        }
        return sel(cols);
      };
      return q;
    },
    rpc: (n, a) => c.rpc(n, a), storage: c.storage,
  });
  clearPeople();
  const d = await books.loadDesk(me("accountant"));
  assert.ok(d.checks.toPay.length >= 1);
  assert.ok(asked.some((x) => x === "payments:" + books.PAYMENT_COLS_BEFORE), "asked again with the published columns");
  assert.equal(books.registerReady(), false);
  assert.ok(books.missingRegisterColumn({ code: "42703", message: "column payments.cleared_on does not exist" }));
  assert.ok(!books.missingRegisterColumn({ code: "42703", message: "column payments.memo does not exist" }));
  assert.equal(books.withoutRegister(books.PAYMENT_COLS), books.PAYMENT_COLS_BEFORE);
});
