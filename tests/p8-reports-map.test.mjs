// The Books program, release B part 2b (P5): the Reports page's words and CSVs (site/js/map/books-reports.js and
// map/checks.js PAYMENT_COLUMNS) - the math is the database's (books_ap_aging, books_vendor_balances, books_1099,
// books_payments_by_month: DCR Desktop 2 migration 20261030000500_books_reports), so this checks the shaping only: the
// periods, the aging buckets and their totals, payments by month (cash never clears), the Bill payments CSV, the
// approval log, the money history in words (every kind of money_events, never a body or an address), and every CSV's
// BOM, CRLF and formula guard. Made-up rows only.
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../site/js/map/books-reports.js";
import { PAYMENT_COLUMNS } from "../site/js/map/checks.js";
import { toCsv } from "../site/js/map/books.js";

const lines = (t) => t.replace(/^﻿/, "").split("\r\n");
const csvOk = (t) => t.startsWith("﻿") && t.endsWith("\r\n") && !/[^\r]\n/.test(t) && lines(t).slice(0, -1).every((l) => /^"([^"]|"")*"(,"([^"]|"")*")*$/.test(l));

test("the six reports; AR aging and job profit are said to be deferred in ONE line", () => {
  assert.deepEqual(R.REPORTS.map((r) => r.id), ["aging", "vendors", "1099", "months", "approvals", "history"]);
  assert.match(R.DEFERRED, /AR aging/);
  assert.match(R.DEFERRED, /job profit/);
  assert.ok(!/\n/.test(R.DEFERRED));
});

test("periods on the company's today: this month, last month (across a year end), this year, last year, the last 90 and 30 days", () => {
  assert.deepEqual(R.periodOf("month", "2026-10-29"), { from: "2026-10-01", to: "2026-10-29" });
  assert.deepEqual(R.periodOf("lastmonth", "2026-01-15"), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(R.periodOf("lastmonth", "2026-03-31"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(R.periodOf("year", "2026-10-29"), { from: "2026-01-01", to: "2026-10-29" });
  assert.deepEqual(R.periodOf("lastyear", "2026-10-29"), { from: "2025-01-01", to: "2025-12-31" });
  assert.deepEqual(R.periodOf("90", "2026-10-29"), { from: "2026-08-01", to: "2026-10-29" });
  assert.deepEqual(R.periodOf("30", "2026-10-29"), { from: "2026-09-30", to: "2026-10-29" });
  assert.equal(R.periodWords("2026-10-01", "2026-10-29"), "Oct 1, 2026 – Oct 29, 2026");
  assert.equal(R.periodWords("2026-10-29", "2026-10-29"), "Oct 29, 2026");
  assert.equal(R.periodProblem("2026-10-02", "2026-10-01"), "The second day is before the first.");
  assert.equal(R.periodProblem("", "2026-10-01"), "Pick both days.");
  assert.equal(R.periodProblem("2026-10-01", "2026-10-01"), "");
});

test("AP aging: the database's buckets shaped, their totals added up, its CSV", () => {
  const rows = [
    { as_of: "2026-10-29", vendor_contact_id: 41, vendor_key: "c41", vendor_name: "Madeup Framing Co", open_bills: 2, current: "100.00", d1_30: "200.10", d31_60: 0,
      d61_90: 0, d90_plus: "50", no_due: 0, waiting_approval: "100.00", total: "350.10", oldest_due_date: "2026-07-01", bill_ids: [9, 4] },
    { as_of: "2026-10-29", vendor_contact_id: null, vendor_key: "n=sum(a1)", vendor_name: "=SUM(A1)", open_bills: 1, current: 0, d1_30: 0, d31_60: 0, d61_90: 0,
      d90_plus: 0, no_due: "75.5", waiting_approval: 0, total: "75.5", oldest_due_date: null, bill_ids: [12] },
  ].map(R.toAging);
  assert.deepEqual([rows[0].d1_30, rows[0].total, rows[0].billIds, rows[1].linked], [200.1, 350.1, ["9", "4"], false]);
  const t = R.agingTotals(rows);
  assert.deepEqual([t.current, t.d1_30, t.d90_plus, t.no_due, t.waiting, t.total, t.openBills], [100, 200.1, 50, 75.5, 100, 425.6, 3]);
  const csv = toCsv(rows, R.AGING_COLUMNS);
  assert.ok(csvOk(csv), csv);
  assert.equal(lines(csv)[0], '"As Of","Vendor","Open Bills","Not Due Yet","1-30 Days Late","31-60 Days Late","61-90 Days Late","Over 90 Days Late","No Due Date","Waiting Approval","Total","Oldest Due","Portal Bill IDs"');
  assert.match(lines(csv)[2], /^"2026-10-29","'=SUM\(A1\)","1",/, "the formula guard");
  assert.deepEqual(R.AGING_BUCKETS.map((b) => b[0]), ["current", "d1_30", "d31_60", "d61_90", "d90_plus", "no_due"]);
});

test("payments by month: per method, cash never clears (NULL, never 0), a month's sums; its CSV", () => {
  const rows = [
    { month: "2026-09-01", method: "check", payments: 2, total: "500.00", voided: 1, voided_total: "40", cleared: 1, cleared_total: "200", not_cleared: 1, not_cleared_total: "300" },
    { month: "2026-09-01", method: "cash", payments: 1, total: "80", voided: 0, voided_total: 0, cleared: null, cleared_total: null, not_cleared: null, not_cleared_total: null },
    { month: "2026-10-01", method: "ach", payments: 1, total: "1000", voided: 0, voided_total: 0, cleared: 0, cleared_total: 0, not_cleared: 1, not_cleared_total: "1000" },
  ].map(R.toMonth);
  assert.deepEqual([rows[0].month, rows[0].monthLabel, rows[1].cleared, rows[1].notCleared, rows[2].methodLabel], ["2026-09", "September 2026", null, null, "ACH"]);
  const g = R.monthTotals(rows);
  assert.deepEqual(g.map((x) => [x.month, x.payments, x.total, x.voided, x.lines.length]), [["2026-09", 3, 580, 1, 2], ["2026-10", 1, 1000, 0, 1]]);
  const csv = toCsv(rows, R.MONTH_COLUMNS);
  assert.ok(csvOk(csv));
  assert.equal(lines(csv)[2], '"2026-09","Cash","1","80.00","0","0.00","","","",""', "cash: blank, not 0");
});

test("the Bill payments CSV (map/checks.js PAYMENT_COLUMNS): one line a payment, for keying - the guard, the check number or the reference", () => {
  const ctx = { bills: new Map([["3", { id: 3, project_id: 7, vendor_name: "Madeup Framing Co", invoice_number: "@INV-9" }]]), projects: new Map([["7", { id: 7, number: "A900", name: "Made-up Cabin" }]]) };
  const a = R.toPaymentLine({ id: 11, bill_id: 3, paid_date: "2026-10-02", amount: "1200.5", method: "check", check_number: "5401", reference: null, payee: "Madeup Framing Co" }, ctx);
  const b = R.toPaymentLine({ id: 12, bill_id: 3, paid_date: "2026-10-03", amount: 99, method: "wire", check_number: null, reference: "-WIRE-77", payee: null }, ctx);
  assert.equal(R.PAYMENT_LINE_COLUMNS, PAYMENT_COLUMNS);
  const csv = toCsv([a, b], PAYMENT_COLUMNS);
  assert.ok(csvOk(csv));
  assert.deepEqual(lines(csv).slice(0, 3), [
    '"Date","Vendor","Bill No","Amount","Method","Check No / Ref","Customer/Project","Portal Payment ID"',
    '"2026-10-02","Madeup Framing Co","\'@INV-9","1200.50","Check","5401","A900 — Made-up Cabin","11"',
    '"2026-10-03","Madeup Framing Co","\'@INV-9","99.00","Wire","\'-WIRE-77","A900 — Made-up Cabin","12"',
  ]);
});

test("the approval log: one line per person asked, newest first - the outcome in words, approved when and by whom, how long it took", () => {
  const msgs = [
    { id: 1, group_id: "g1", kind: "approval_request", channel: "email", bill_ids: [3], to_name: "Avery Admin", status: "sent", sent_at: "2026-10-27T17:00:00Z",
      created_at: "2026-10-27T16:40:00Z", created_by: "u-acc" },
    { id: 2, group_id: "g1", kind: "approval_request", channel: "sms", bill_ids: [3], to_name: "<img src=x onerror=alert(1)>", status: "draft", created_at: "2026-10-27T16:40:00Z", created_by: "u-acc" },
    { id: 3, group_id: "g2", kind: "payment_pickup", channel: "email", payment_ids: [8], to_name: "Sub", status: "queued", created_at: "2026-10-28T16:40:00Z", created_by: "u-acc" },
  ];
  const ctx = { bills: new Map([["3", { id: 3, project_id: 7, vendor_name: "Madeup Framing Co", invoice_number: "INV-9", approved_at: "2026-10-28T02:40:00Z", approved_by: "u-adm" }]]),
    projects: new Map([["7", { id: 7, number: "A900" }]]), nameOf: (u) => ({ "u-acc": "Casey Accounts", "u-adm": "Avery Admin" }[u] || "") };
  const rows = R.approvalRows(msgs, ctx);
  assert.equal(rows.length, 2, "approval requests only");
  assert.deepEqual(rows.map((r) => r.id), [2, 1]);
  const e = rows.find((r) => r.id === 1);
  assert.deepEqual([e.byName, e.how, e.outcomeCls, e.bills, e.took], ["Casey Accounts", "e-mail", "ok", ["Madeup Framing Co #INV-9 · A900"], "10 h"]);
  assert.match(e.outcome, /^e-mail sent ✓ Oct 27/);
  assert.match(e.approvedWords, /^Oct 27 7:40 PM by Avery Admin$/);
  const t = rows.find((r) => r.id === 2);
  assert.deepEqual([t.how, t.outcome], ["text (by hand)", "text written — not marked sent yet"]);
  const csv = toCsv(rows, R.APPROVAL_COLUMNS);
  assert.ok(csvOk(csv));
  assert.equal(lines(csv)[0], '"Asked","Asked By","Asked Who","How","Outcome","Bills","Approved","Took","Portal Bill IDs"');
  // not approved yet
  ctx.bills.get("3").approved_at = null;
  assert.deepEqual([R.approvalRows(msgs, ctx)[1].approvedWords, R.approvalRows(msgs, ctx)[1].took], ["", ""]);
});

test("the money history: every kind of money_events has words; the detail says ids, states and short facts - never a body or an address", () => {
  // the kinds of money_events (20261030000300_check_register: the money_events kind check)
  const KINDS = ["bill_added", "bill_changed", "bill_approved", "bill_unapproved", "bill_pay_method", "bill_voided", "bill_deleted", "bill_restored",
    "bill_entered", "bill_unentered", "payment_recorded", "payment_changed", "payment_voided", "payment_deleted", "payment_told", "payment_untold",
    "payment_picked_up", "payment_pickup_undone", "payment_cleared", "payment_uncleared", "file_attached", "file_removed", "message_queued",
    "message_sent", "message_not_sent", "text_sent", "text_cancelled", "vendor_changed", "check_spoiled", "check_unspoiled", "template_saved", "template_reset"];
  assert.deepEqual(Object.keys(R.EVENT_WORDS).sort(), KINDS.slice().sort());
  const grouped = R.EVENT_GROUPS.filter((g) => g.kinds).flatMap((g) => g.kinds);
  assert.deepEqual(grouped.slice().sort(), KINDS.slice().sort(), "every kind in exactly one group");
  assert.equal(R.detailText("bill_changed", { amount: [1, 2], invoiceNumber: ["a", "b"] }), "changed: amount, invoice number");
  assert.equal(R.detailText("bill_approved", { payMethod: "both", note: "ok" }), "to be paid by check or cash · note: ok");
  assert.equal(R.detailText("bill_pay_method", { payMethod: ["check", "cash"] }), "check → cash");
  assert.equal(R.detailText("payment_recorded", { method: "check", checkNumber: "5401", paidDate: "2026-10-02" }), "check #5401 dated Oct 2");
  assert.equal(R.detailText("payment_told", { how: "text message", by: "Casey" }), "by text (Casey)");
  assert.equal(R.detailText("payment_cleared", { on: "2026-10-20", was: null }), "on Oct 20");
  assert.equal(R.detailText("payment_voided", { reason: "Lost in the mail" }), "why: Lost in the mail");
  assert.equal(R.detailText("check_spoiled", { number: "5307", reason: "Torn" }), "#5307 · Torn");
  assert.equal(R.detailText("message_sent", { messageKind: "payment_pickup", channel: "email", toContactId: 4 }), "ready to pick up · e-mail");
  assert.equal(R.detailText("template_saved", { key: "check_ready", channel: "sms", old: { body: "x" }, new: { body: "y" } }), "check ready · text", "never the texts");
  // vendor_changed carries the database's camelCase keys (t97_vendor_profiles_money_events): a first save {added: true, ...}
  assert.equal(R.detailText("vendor_changed", { tax1099: [false, true], notes: "changed" }), "changed: 1099, notes");
  assert.equal(R.detailText("vendor_changed", { added: true, tax1099: true, w9ReceivedOn: "2026-10-01", workersCompExempt: true, notes: "set" }),
    "added: 1099, W-9 date, workers' comp exempt, notes");
  assert.equal(R.detailText("vendor_changed", { insuranceExpiresOn: ["2026-10-01", "2027-10-01"], licenseNumber: [null, "C-1"], workersCompExpiresOn: [null, "2027-01-01"] }),
    "changed: insurance date, workers' comp date, license", "in one fixed order, whatever order the keys came in");
  assert.equal(R.detailText("bill_changed", { invoiceNumber: ["a", "b"], void: [true, false], amount: [1, 2] }), "changed: amount, invoice number, void");
  assert.equal(R.detailText("payment_recorded", { method: "cash", backfilled: true }), "cash · from before the history began");
  assert.equal(R.detailText("file_attached", { name: "x".repeat(200) }).length, 80, "short");
  assert.equal(R.detailText("nonsense", { a: 1 }), "");
});

test("toEvent / filterEvents / the history CSV", () => {
  const ctx = { bills: new Map([["3", { id: 3, project_id: 7, vendor_name: "Madeup Framing Co", invoice_number: "INV-9" }]]), projects: new Map([["7", { id: 7, number: "A900" }]]) };
  const ev = [
    { id: 5, at: "2026-10-28T16:00:00Z", actor_name: "Casey Accounts", kind: "payment_told", project_id: 7, bill_id: 3, payment_id: 8, amount: "500.00", detail: { how: "phone" } },
    { id: 6, at: "2026-10-28T17:00:00Z", actor_name: "Avery Admin", kind: "bill_approved", project_id: 7, bill_id: 3, amount: "500", detail: { payMethod: "check" } },
    { id: 7, at: "2026-10-28T18:00:00Z", actor_name: null, kind: "template_reset", project_id: null, bill_id: null, amount: null, detail: { key: "approval_request", channel: "email" } },
  ].map((e) => R.toEvent(e, ctx));
  assert.deepEqual([ev[0].what, ev[0].bill, ev[0].job, ev[0].amount, ev[0].detail], ["Payee told", "Madeup Framing Co #INV-9 · A900", "A900", 500, "by phone"]);
  assert.equal(ev[2].actor, "System");
  assert.deepEqual(R.filterEvents(ev, { group: "bill" }).map((e) => e.id), [6]);
  assert.deepEqual(R.filterEvents(ev, { group: "payment" }).map((e) => e.id), [5]);
  assert.deepEqual(R.filterEvents(ev, { q: "avery" }).map((e) => e.id), [6]);
  assert.deepEqual(R.filterEvents(ev, { q: "a900" }).map((e) => e.id), [5, 6]);
  const csv = toCsv(ev, R.HISTORY_COLUMNS);
  assert.ok(csvOk(csv));
  assert.equal(lines(csv)[0], '"When","Who","What","Bill","Vendor","Job","Amount","Detail","Portal Event ID"');
  // a vendor's details changed: the contact the event names (ctx.contacts), searchable
  const vc = R.toEvent({ id: 9, at: "2026-10-28T19:00:00Z", actor_name: "Casey Accounts", kind: "vendor_changed", contact_id: 4, detail: { tax1099: [false, true] } },
    Object.assign({}, ctx, { contacts: new Map([["4", { id: 4, name: "Ada Madeup", company: "Madeup Framing Co" }]]) }));
  assert.deepEqual([vc.what, vc.bill, vc.vendor, vc.detail], ["Vendor details changed", "", "Madeup Framing Co", "changed: 1099"]);
  assert.deepEqual(R.filterEvents([vc], { q: "framing co" }).map((e) => e.id), [9]);
});

test("file names and the printed page's header", () => {
  assert.equal(R.csvFile("Unpaid bills by age", "2026-10-29"), "dcr-unpaid-bills-by-age-2026-10-29.csv");
  assert.equal(R.csvFile("Payments by month", "2026-01-01", "2026-10-29"), "dcr-payments-by-month-2026-01-01-to-2026-10-29.csv");
  assert.equal(R.csvFile("1099-2026", "2026-10-29", "2026-10-29"), "dcr-1099-2026-2026-10-29.csv");
  assert.equal(R.printLine("Money history", "Oct 1, 2026 – Oct 29, 2026", "2026-10-29", "Casey Accounts", 12),
    "Money history · Oct 1, 2026 – Oct 29, 2026 · printed Oct 29, 2026 by Casey Accounts · 12 lines");
});
