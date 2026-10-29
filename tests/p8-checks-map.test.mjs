// The Books program, release A (P3): the check register's pure rules (site/js/map/checks.js) and the payment date's
// bounds (site/js/map/books.js) - the check_key mirror of app.check_key (20261030000300_check_register: digits and
// letters, upper case, leading zeros dropped), the status order and words, the gap flag over all-digit numbers only,
// the filters, what each line offers, the Checks CSV (BOM, CRLF, the formula guard - the amount only with the prices
// switch, S4), the database's own words for a reused number. tools/schema-check-p8-register.mjs compares checkKey with
// the real app.check_key. Made-up names only.
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../site/js/map/checks.js";
import { toCsv, payDateBounds, payDateProblem, toPayment, buildDesk } from "../site/js/map/books.js";

export const KEY_VECTORS = [["#1043", "1043"], [" 1043", "1043"], ["01043", "1043"], ["1043", "1043"], ["TEST-1", "TEST1"], ["test-1", "TEST1"],
  ["0", "0"], ["000", "0"], ["00a7", "A7"], ["5-3-1", "531"], ["#", null], ["", null], [null, null], ["  ", null], ["1043b", "1043B"], ["é1", "1"]];

test("checkKey mirrors app.check_key; digitKey: all-digit keys only; keyCompare: numbers by value, before the others", () => {
  for (const [v, want] of KEY_VECTORS) assert.equal(C.checkKey(v), want, JSON.stringify(v));
  assert.ok(C.digitKey("1043") && C.digitKey("0") && !C.digitKey("TEST1") && !C.digitKey("1043B") && !C.digitKey(null));
  const keys = ["10000", "TEST1", "999", "1043", "A7", "1044"].sort(C.keyCompare);
  assert.deepEqual(keys, ["999", "1043", "1044", "10000", "A7", "TEST1"]);
});

test("the status order and words (the view's status: the least advanced of a check's live payments)", () => {
  assert.deepEqual(C.STATUS_ORDER, ["written", "told", "picked_up", "cleared", "void", "spoiled"]);
  assert.equal(C.statusText({ status: "cleared", clearedOn: "2026-10-20" }), "Cleared Oct 20");
  assert.equal(C.statusText({ status: "picked_up", pickedUpDay: "2026-10-22" }), "Picked up Oct 22");
  assert.equal(C.statusText({ status: "told", toldHow: "phone" }), "Told by phone");
  assert.equal(C.statusText({ status: "told", toldHow: "text message" }), "Told by text");
  assert.equal(C.statusText({ status: "told", toldHow: "email" }), "Told by e-mail");
  assert.equal(C.statusText({ status: "written" }), "Written");
  assert.equal(C.statusText({ status: "void" }), "Void");
  assert.equal(C.statusText({ status: "spoiled" }), "Spoiled");
});

const ROWS = [
  { check_number: "1043", check_key: "1043", kind: "check", paid_date: "2026-10-28", payee: "Made-up Framing LLC", vendor_contact_id: 9, payment_ids: [11, 12],
    bill_ids: [3, 4], project_ids: [7], status: "told", void_reason: null, cleared_on: null, picked_up_at: null, told_at: "2026-10-28T18:00:00Z",
    recorded_at: "2026-10-28T17:00:00Z", number_reused: false, spoiled_id: null, amount: 900, written_amount: 900 },
  { check_number: "1041", check_key: "1041", kind: "check", paid_date: "2026-10-02", payee: "Sample Lumber", vendor_contact_id: null, payment_ids: [10],
    bill_ids: [2], project_ids: [7], status: "void", void_reason: "lost in the mail", cleared_on: null, picked_up_at: null, told_at: null,
    recorded_at: "2026-10-02T17:00:00Z", number_reused: false, spoiled_id: null, amount: 0, written_amount: 250 },
  { check_number: "1040", check_key: "1040", kind: "spoiled", paid_date: "2026-09-30", payee: null, vendor_contact_id: null, payment_ids: [], bill_ids: [],
    project_ids: [], status: "spoiled", void_reason: "Torn in the printer", recorded_at: "2026-09-30T17:00:00Z", number_reused: false, spoiled_id: 5 },
  { check_number: "1030", check_key: "1030", kind: "check", paid_date: "2026-09-20", payee: "=HYPERLINK(\"x\")", vendor_contact_id: null, payment_ids: [8],
    bill_ids: [1], project_ids: [6], status: "cleared", cleared_on: "2026-09-25", recorded_at: "2026-09-20T17:00:00Z", number_reused: false, spoiled_id: null,
    amount: 120.5, written_amount: 120.5 },
  { check_number: "TEST-1", check_key: "TEST1", kind: "check", paid_date: "2026-10-27", payee: "Smoke Test", vendor_contact_id: null, payment_ids: [13],
    bill_ids: [5], project_ids: [7], status: "written", recorded_at: "2026-10-27T17:00:00Z", number_reused: false, spoiled_id: null, amount: 1, written_amount: 1 },
];
const PAYS = [
  { id: 11, bill_id: 3, project_id: 7, paid_date: "2026-10-28", method: "check", check_number: "1043", pickup_told_at: "2026-10-28T18:00:00Z", pickup_told_how: "email", version: 2, created_at: "2026-10-28T17:00:00Z" },
  { id: 12, bill_id: 4, project_id: 7, paid_date: "2026-10-28", method: "check", check_number: "1043", pickup_told_at: "2026-10-28T18:00:00Z", pickup_told_how: "email", version: 2, created_at: "2026-10-28T17:00:00Z" },
  { id: 10, bill_id: 2, project_id: 7, paid_date: "2026-10-02", method: "check", check_number: "1041", voided_at: "2026-10-03T17:00:00Z", void_reason: "lost in the mail", version: 3 },
  { id: 8, bill_id: 1, project_id: 6, paid_date: "2026-09-20", method: "check", check_number: "1030", cleared_on: "2026-09-25", picked_up_at: "2026-09-21T19:00:00Z", version: 4 },
  { id: 13, bill_id: 5, project_id: 7, paid_date: "2026-10-27", method: "check", check_number: "TEST-1", version: 1 },
];
const reg = (rows) => C.buildRegister({ rows: rows || ROWS, payments: PAYS, projects: [{ id: 7, number: "A900", name: "Made-up Cabin" }, { id: 6, number: "A901", name: "" }],
  contacts: [{ id: 9, name: "Pat Sample", company: "Made-up Framing LLC" }], files: [{ id: 70, payment_id: 11, name: "check.jpg" }, { id: 71, payment_id: 12, name: "stub.pdf" }],
  next: { next: "1044", last: { number: "1043", paidDate: "2026-10-28", payee: "Made-up Framing LLC" } }, voidEnabled: false }, { today: "2026-10-28" });

test("buildRegister: newest first (the date on the check, then the number), the payments behind each line, its jobs, contact and files", () => {
  const d = reg();
  assert.deepEqual(d.rows.map((r) => r.number), ["1043", "TEST-1", "1041", "1040", "1030"]);
  const r = d.rows[0];
  assert.deepEqual([r.kind, r.payee, r.jobs, r.billIds, r.paymentIds, r.files.map((f) => f.id), r.contact.company, r.toldHow, r.month],
    ["check", "Made-up Framing LLC", ["A900"], [3, 4], [11, 12], [70, 71], "Made-up Framing LLC", "email", "2026-10"]);
  assert.deepEqual(r.live.map((p) => [p.id, p.version]), [[11, 2], [12, 2]], "the versions the RPCs need");
  assert.equal(d.rows[2].live.length, 0, "a void check has no live payment");
  assert.deepEqual(d.counts, { written: 1, told: 1, picked_up: 0, cleared: 1, void: 1, spoiled: 1 });
  assert.equal(C.nextText(d.next), "Next check: #1044 — after #1043 to Made-up Framing LLC, Oct 28");
  assert.equal(C.nextText({ next: null, last: null }), "");
});

test("the gaps: all-digit numbers only (a TEST- check never), a spoiled or voided number fills its place; a long run is said once and softly", () => {
  const d = reg();
  assert.deepEqual(d.gaps.map((g) => [g.from, g.to, g.count, g.small]), [["1042", "1042", 1, true], ["1031", "1039", 9, true]]);
  assert.equal(C.gapText(d.gaps[0]), "#1042 missing — spoil it or find it");
  assert.equal(C.gapText(d.gaps[1]), "#1031–#1039 missing (9) — spoil them or find them");
  const long = C.findGaps([{ checkKey: "1100" }, { checkKey: "5000" }, { checkKey: "TEST1" }, { checkKey: "5001" }]);
  assert.deepEqual(long.map((g) => [g.from, g.to, g.count, g.small]), [["1101", "4999", 3899, false]]);
  assert.equal(C.gapText(long[0]), "#1101–#4999 are not in the register (3,899 numbers): another checkbook, or checks not entered here");
  assert.deepEqual(C.findGaps([{ checkKey: "99999999999999999998" }, { checkKey: "100000000000000000000" }]).map((g) => g.from), ["99999999999999999999"],
    "numbers beyond 2^53 keep their digits");
});

test("filterRegister: status, month, payee / job / number, a number range (all-digit numbers only)", () => {
  const rows = reg().rows;
  const n = (f) => C.filterRegister(rows, f).map((r) => r.number);
  assert.deepEqual(n({ status: "void" }), ["1041"]);
  assert.deepEqual(n({ month: "2026-09" }), ["1040", "1030"]);
  assert.deepEqual(n({ q: "framing" }), ["1043"], "a payee");
  assert.deepEqual(n({ q: "cabin" }), ["1043", "TEST-1", "1041"], "a job's name");
  assert.deepEqual(n({ q: "a901" }), ["1030"], "a job number");
  assert.deepEqual(n({ q: "test" }), ["TEST-1"], "a number");
  assert.deepEqual(n({ from: "1035", to: "1041" }), ["1041", "1040"]);
  assert.deepEqual(n({ from: "#1043" }), ["1043"]);
  assert.ok(!C.filtered({}) && C.filtered({ status: "void" }) && C.filtered({ q: " x " }));
  assert.deepEqual(C.monthsOf(rows), [{ id: "2026-10", label: "October 2026" }, { id: "2026-09", label: "September 2026" }]);
});

test("rowActions: what a line offers (the database decides) - Void only while the switch is on, never on a cleared check", () => {
  const d = reg();
  const by = (n) => d.rows.find((r) => r.number === n);
  assert.deepEqual(C.rowActions(by("1043"), { voidEnabled: false }), { pickUp: true, undoPickUp: false, clear: true, unclear: false, void: false, unspoil: false });
  assert.equal(C.rowActions(by("1043"), { voidEnabled: true }).void, true);
  assert.deepEqual(C.rowActions(by("1030"), { voidEnabled: true }), { pickUp: false, undoPickUp: false, clear: false, unclear: true, void: false, unspoil: false });
  assert.deepEqual(C.rowActions(by("1041"), { voidEnabled: true }), { pickUp: false, undoPickUp: false, clear: false, unclear: false, void: false, unspoil: false });
  assert.deepEqual(C.rowActions(by("1040"), {}), { pickUp: false, undoPickUp: false, clear: false, unclear: false, void: false, unspoil: true });
  assert.equal(C.firstDay({ paidDate: "2026-11-15", recordedDay: "2026-10-28" }), "2026-10-28", "a post-dated check is handed over before its date");
  assert.equal(C.firstDay({ paidDate: "2026-10-01", recordedDay: "2026-10-28" }), "2026-10-01");
});

test("the Checks CSV: BOM, CRLF, every cell quoted, the formula guard; the amount ONLY with the prices switch (S4)", () => {
  const rows = reg().rows;
  const priced = toCsv(rows, C.checkColumns(true));
  const plain = toCsv(rows, C.checkColumns(false));
  for (const text of [priced, plain]) {
    assert.equal(text.charCodeAt(0), 0xfeff, "a BOM");
    assert.ok(text.endsWith("\r\n") && !/[^\r]\n/.test(text), "CRLF only");
    assert.ok(text.includes('"\'=HYPERLINK(""x"")"'), "a formula-looking payee is made text");
  }
  assert.match(priced.split("\r\n")[0], /^\uFEFF"Check No","Date","Payee","Jobs","Amount","Status",/);
  assert.ok(priced.includes('"250.00"'), "a void check's written amount");
  assert.ok(!/Amount/.test(plain) && !/"\d+\.\d\d"/.test(plain) && !/900\.00|120\.5|250\.00/.test(plain), "no amount without prices: " + plain);
  assert.equal(C.checkColumns(false).length + 1, C.checkColumns(true).length);
});

test("clashText: the database's own words for a reused or spoiled number (23505), never the generic sentence; anything else is not its", () => {
  const e = { code: "23505", message: "check 1043 is already in the check register (Made-up Framing LLC, Oct 28, 2026): a check number is used once - one check may pay several bills of the same payee on the same day" };
  assert.equal(C.clashText(e), "Check 1043 is already in the check register (Made-up Framing LLC, Oct 28, 2026): a check number is used once - one check may pay several bills of the same payee on the same day.");
  assert.match(C.clashText({ code: "23505", message: "check 1040 is already marked spoiled (Sep 30, 2026)" }), /^Check 1040 is already marked spoiled/);
  assert.match(C.clashText({ code: "23505", message: "check 1043 was written (Made-up Framing LLC, Oct 28, 2026): only a blank never used is spoiled - void the check instead" }), /void the check instead\.$/);
  assert.equal(C.clashText({ code: "23505", message: "duplicate key value violates unique constraint \"spoiled_checks_key\"" }), "");
  assert.equal(C.clashText({ code: "22023", message: "check 1 is already in the check register (x): y" }), "");
});

test("the payment date: today - 400 to today + 31 (I11), a post-dated check allowed", () => {
  assert.deepEqual(payDateBounds("2026-10-28"), { min: "2025-09-23", max: "2026-11-28", today: "2026-10-28" });
  assert.deepEqual(payDateBounds("2028-03-01"), { min: "2027-01-26", max: "2028-04-01", today: "2028-03-01" }, "across a leap day");
  assert.equal(payDateProblem("2026-10-28", "2026-10-28"), "");
  assert.equal(payDateProblem("2026-11-28", "2026-10-28"), "", "31 days ahead");
  assert.equal(payDateProblem("2025-09-23", "2026-10-28"), "", "400 days back");
  assert.match(payDateProblem("2026-11-29", "2026-10-28"), /at most 31 days ahead \(Nov 28, 2026\)/);
  assert.match(payDateProblem("2025-09-22", "2026-10-28"), /at most 400 days back \(Sep 23, 2025\)/);
  assert.match(payDateProblem("", "2026-10-28"), /Pick the date/);
});

test("the Books' piles: a voided payment counts as paid on no bill, and nobody is told about a voided or picked-up check", () => {
  const bills = [{ id: 1, project_id: 1, vendor_name: "Made-up Framing LLC", invoice_number: "F-1", amount: 500, approved_at: "2026-10-01T00:00:00Z",
    approved_amount: 500, pay_method: "check", document_file_id: 9, void: false, version: 1 }];
  const pay = (id, extra) => Object.assign({ id, bill_id: 1, project_id: 1, paid_date: "2026-10-10", amount: 500, method: "check", check_number: String(1000 + id), version: 1 }, extra);
  const p = toPayment(pay(1, { voided_at: "2026-10-11T00:00:00Z", void_reason: "lost", picked_up_at: null, cleared_on: null }));
  assert.deepEqual([p.voided, p.live, p.voidReason], [true, false, "lost"]);
  const voided = buildDesk({ bills, payments: [pay(1, { voided_at: "2026-10-11T00:00:00Z", void_reason: "lost" })], projects: [{ id: 1, number: "A900" }] }, { today: "2026-10-28" });
  assert.equal(voided.checks.toPay.length, 1, "owed again after its only check was voided");
  assert.equal(voided.checks.toPay[0].owed, 500);
  assert.equal(voided.checks.toTell.length, 0, "nobody is told about a voided check");
  const picked = buildDesk({ bills, payments: [pay(2, { picked_up_at: "2026-10-12T00:00:00Z" })], projects: [{ id: 1, number: "A900" }] }, { today: "2026-10-28" });
  assert.equal(picked.checks.toTell.length, 0, "a check already picked up is told about no more");
  const plain = buildDesk({ bills, payments: [pay(3, {})], projects: [{ id: 1, number: "A900" }] }, { today: "2026-10-28" });
  assert.deepEqual([plain.checks.toTell.length, plain.checks.toPay.length], [1, 0]);
});

test("printTitle: the printed page's header (the span of the lines shown, who printed it and when)", () => {
  const rows = reg().rows;
  assert.equal(C.printTitle(rows, "2026-10-28", "Casey Sample"), "Check register · Sep 20, 2026–Oct 28, 2026 · printed Oct 28, 2026 by Casey Sample · 5 lines");
  assert.equal(C.printTitle([], "2026-10-28", ""), "Check register · no checks · printed Oct 28, 2026 · 0 lines");
});
