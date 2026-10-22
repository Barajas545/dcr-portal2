// P5b The Books - the pure module (site/js/map/books.js): the piles, the check desk, the CSV hand-off (Q13), the
// approvals card, the gates (the owner's rule: an accountant NEVER approves). Made-up vendors and jobs only.
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../site/js/map/books.js";
import * as L from "../site/js/map/ledger.js";

const TODAY = "2026-10-21";
const projects = [{ id: 1, number: "A900", name: "Made-up Cabin", address: "1 Elm St", city: "Pine Hollow", client_name: "Pat Example" },
  { id: 2, number: "A901", name: "Made-up Shop", client_name: "Lee Example" }];
const contacts = [
  { id: 10, name: "Rory Vendor", company: "Vendor Framing LLC", email: "rory@example.com", phone: "(805) 555-0190" },
  { id: 11, name: "Sam Supply", company: "", email: "", phone: "" },
  { id: 12, name: "Kit Quote", company: "Quoted Concrete", email: "kit@example.com", phone: "" },
];
const bill = (f) => Object.assign({ id: 1, project_id: 1, estimate_item_id: null, quote_id: null, vendor_contact_id: 10, vendor_name: "Vendor Framing LLC",
  invoice_number: "V-100", invoice_date: "2026-10-01", due_date: "2026-10-31", amount: 1000, description: "Walls", document_file_id: 5, void: false,
  approved_by: null, approved_at: null, approved_amount: null, pay_method: null, approval_note: null, kind: "Subcontractor", qbo_entered_at: null,
  qbo_entered_by: null, qbo_ref: null, created_at: "2026-10-01T17:00:00Z", created_by: "u-acc", version: 3 }, f);
const approved = (f) => bill(Object.assign({ approved_by: "u-adm", approved_at: "2026-10-05T18:00:00Z", approved_amount: 1000, pay_method: "check" }, f));
const nameOf = (u) => ({ "u-adm": "Ada Admin", "u-acc": "Ace Accounts" }[u] || "");

test("gates: the financials switch opens The Books; only an admin or a manager with approve (and financials) approves - an accountant never", () => {
  const p = (role, f) => Object.assign({ role, active: true, can_see_prices: false, can_see_financials: false, can_approve_payments: false }, f);
  assert.equal(M.seesBooks(p("admin")), true);
  assert.equal(M.seesBooks(p("accountant", { can_see_financials: true })), true);
  assert.equal(M.seesBooks(p("manager")), false, "Q1: a manager without the switches sees no money");
  assert.equal(M.seesBooks(p("lead")), false);
  assert.equal(M.seesBooks(p("agents", { can_see_financials: true })), false);
  assert.equal(M.canApprove(p("admin")), true);
  assert.equal(M.canApprove(p("manager", { can_approve_payments: true, can_see_financials: true })), true);
  assert.equal(M.canApprove(p("manager", { can_approve_payments: true })), false, "approve needs financials too");
  assert.equal(M.canApprove(p("accountant", { can_approve_payments: true, can_see_financials: true })), false, "never an accountant");
  assert.equal(M.canApprove(p("admin", { active: false })), false);
  assert.equal(M.canMoney(p("accountant", { can_see_financials: true })), true);
  assert.equal(M.canMoney(p("manager", { can_see_financials: true })), true);
  assert.equal(M.canMoney(p("manager")), false);
  assert.equal(M.canMoney(p("lead", { can_see_financials: true })), false);
});

test("bill kinds: the database's words (M5b) and older spellings read the same", () => {
  assert.equal(M.kindLabel("Material supplier"), "Material supplier");
  assert.equal(M.kindLabel("material_supplier"), "Material supplier");
  assert.equal(M.kindLabel("Subcontractor"), "Subcontractor");
  assert.equal(M.kindLabel(null), "");
  assert.deepEqual(M.allowedMethods("both"), ["check", "cash"]);
  assert.deepEqual(M.allowedMethods("cash"), ["cash"]);
  assert.deepEqual(M.allowedMethods(null), [], "nobody said: nothing is allowed yet (never a default)");
  assert.equal(M.payMethodWords("both"), "by check or in cash");
});

test("piles: ready, entered, waiting, blocked - and the database's own state (books_desk) wins", () => {
  const rows = [approved({ id: 1 }), bill({ id: 2 }), bill({ id: 3, document_file_id: null }), approved({ id: 4, qbo_entered_at: "2026-10-10T17:00:00Z",
    qbo_entered_by: "u-acc", qbo_ref: "QB-1" }), bill({ id: 5, void: true }), bill({ id: 6, amount: 0 })];
  const d = M.buildDesk({ bills: rows, projects, contacts }, { today: TODAY, nameOf });
  assert.deepEqual(d.ready.map((b) => b.id), [1]);
  assert.deepEqual(d.waiting.map((b) => b.id), [2]);
  assert.deepEqual(d.blocked.map((b) => b.id), [3]);
  assert.deepEqual(d.entered.map((b) => b.id), [4]);
  assert.equal(d.blocked[0].reason, "No invoice attached, so it cannot be approved.");
  assert.equal(d.waiting[0].reason, "Waiting for a manager or admin to approve it.");
  assert.equal(d.entered[0].enteredByName, "Ace Accounts");
  assert.equal(d.entered[0].qboRef, "QB-1");
  assert.equal(d.ready[0].projectLabel, "A900 — Made-up Cabin");
  // the view's answer (state, reason, paid_total, owed) is taken as it is
  const desk = [Object.assign({}, approved({ id: 1 }), { state: "ready", paid_total: 400, owed: 600 }), Object.assign({}, bill({ id: 2 }), { state: "blocked", reason: "No amount on it yet." })];
  const v = M.buildDesk({ bills: desk, desk, projects, contacts }, { today: TODAY, nameOf });
  assert.deepEqual(v.blocked.map((b) => b.id), [2]);
  assert.equal(v.blocked[0].reason, "No amount on it yet.");
  assert.equal(v.ready[0].paid, 400);
  assert.equal(v.checks.toPay[0].owed, 600);
});

test("the check desk: the cap is the FROZEN approved amount minus what is paid; payee the company; memo job · invoice · what (<= 100)", () => {
  const rows = [approved({ id: 1, amount: 1200, approved_amount: 1000 }), approved({ id: 2, vendor_contact_id: 11, vendor_name: null, pay_method: "both" }),
    approved({ id: 3, pay_method: "cash", description: "x".repeat(200) })];
  const payments = [{ id: 7, bill_id: 1, project_id: 1, paid_date: "2026-10-10", amount: 300, method: "check", check_number: "501", version: 1 }];
  const d = M.buildDesk({ bills: rows, payments, projects, contacts }, { today: TODAY, nameOf });
  const one = d.checks.toPay.find((b) => b.id === 1);
  assert.equal(one.owed, 700, "1000 approved - 300 paid (never the bill's current 1200)");
  assert.equal(one.partial, true);
  assert.equal(one.payee, "Vendor Framing LLC");
  assert.equal(one.memo, "A900 — Made-up Cabin · Inv V-100 · Walls");
  const two = d.checks.toPay.find((b) => b.id === 2);
  assert.equal(two.payee, "Sam Supply");
  assert.equal(two.payeeNote, "Only a person's name is on file, no company.");
  assert.deepEqual(two.allowed, ["check", "cash"]);
  assert.ok(d.checks.toPay.find((b) => b.id === 3).memo.length <= M.MEMO_MAX);
  assert.equal(d.checks.totals.checkCount, 1);
  assert.equal(d.checks.totals.cashCount, 1);
  assert.equal(d.checks.totals.eitherCount, 1);
  assert.equal(d.checks.toTell.length, 1, "a check nobody was told about");
  assert.equal(d.checks.toTell[0].amount, 300);
  assert.equal(d.checks.toTell[0].version, 1, "payment_told is versioned");
  const told = M.buildDesk({ bills: rows, payments: [Object.assign({}, payments[0], { pickup_told_at: "2026-10-11T17:00:00Z", pickup_told_how: "phone" })],
    projects, contacts }, { today: TODAY });
  assert.equal(told.checks.toTell.length, 0);
  // a wire is not collected in person
  assert.equal(M.buildDesk({ bills: rows, payments: [Object.assign({}, payments[0], { method: "wire" })], projects, contacts }, { today: TODAY }).checks.toTell.length, 0);
});

test("bank transfer and card (owner decision 2026-10-21): the five pay methods, what each allows, its pile - transfer and card bills go to the 'Pay by bank transfer or card' list, never the check desk; nobody is told about an ACH, wire or card payment", () => {
  assert.deepEqual(M.PAY_METHODS.map((m) => m.id), ["check", "cash", "both", "transfer", "card"]);
  assert.deepEqual(M.PAY_METHODS.map((m) => m.label), ["By check", "In cash", "Either — check or cash, split if needed", "By bank transfer (ACH or wire)", "By card"]);
  assert.deepEqual(M.allowedMethods("transfer"), ["ach", "wire"]);
  assert.deepEqual(M.allowedMethods("card"), ["card"]);
  assert.deepEqual(M.allowedMethods("other"), [], "never a person's");
  assert.equal(M.payMethodWords("transfer"), "by bank transfer (ACH or wire)");
  assert.equal(M.payMethodWords("card"), "by card");
  assert.deepEqual(["check", "cash", "both", "transfer", "card", null].map(M.payPile), ["check_desk", "check_desk", "check_desk", "transfer_card", "transfer_card", ""]);
  assert.equal(M.isPayMethod("transfer"), true);
  assert.equal(M.isPayMethod("ach"), false, "a payment method is not a pay method");
  assert.deepEqual(["check", "cash", "ach", "wire", "card", "other"].map(M.paymentLabel), ["Check", "Cash", "ACH transfer", "Wire transfer", "Card", "Other"]);
  const rows = [approved({ id: 1 }), approved({ id: 2, pay_method: "transfer", amount: 4120, approved_amount: 4120 }),
    approved({ id: 3, pay_method: "card", amount: 386.5, approved_amount: 386.5 }), approved({ id: 4, pay_method: "both" }),
    approved({ id: 5, pay_method: "transfer", amount: 900, approved_amount: 900 })];
  const payments = [
    { id: 70, bill_id: 2, project_id: 1, paid_date: "2026-10-12", amount: 2000, method: "ach", reference: "ACH 0041", version: 1 },
    { id: 71, bill_id: 5, project_id: 1, paid_date: "2026-10-13", amount: 900, method: "wire", reference: "W-1", version: 1 },
    { id: 72, bill_id: 4, project_id: 1, paid_date: "2026-10-14", amount: 100, method: "check", check_number: "9", version: 1 }];
  const d = M.buildDesk({ bills: rows, payments, projects, contacts }, { today: TODAY, nameOf });
  assert.deepEqual(d.checks.toPay.map((b) => b.id).sort(), [1, 4], "the check desk: check, cash and either only");
  assert.deepEqual(d.checks.toSend.map((b) => b.id).sort(), [2, 3], "transfer and card on their own list (a paid one off it)");
  const t = d.checks.toSend.find((b) => b.id === 2);
  assert.deepEqual([t.owed, t.partial, t.pile, t.allowed], [2120, true, "transfer_card", ["ach", "wire"]], "4120 approved - 2000 sent by ACH");
  assert.deepEqual(d.checks.toSend.find((b) => b.id === 3).allowed, ["card"]);
  assert.deepEqual(d.checks.toTell.map((x) => x.paymentId), [72], "only the check is told about - never the ACH or the wire");
  const T = d.checks.totals;
  assert.deepEqual([T.toPayCount, T.toSendCount, T.outCount, T.transferCount, T.transferAmount, T.cardCount, T.cardAmount],
    [2, 2, 4, 1, 2120, 1, 386.5]);
  // the pay panel's reference field (review fix: a transfer bill asked for a "Check number" until ACH or wire was picked)
  const lab = (m, pm) => M.refField(m, M.allowedMethods(pm)).label;
  assert.equal(lab("", "transfer"), "Confirmation number (optional)", "a transfer bill, nothing picked yet: the bank's confirmation");
  assert.match(M.refField("", ["ach", "wire"]).sub, /bank's confirmation — no check number, and nobody to tell/);
  assert.doesNotMatch(M.refField("", ["ach", "wire"]).placeholder, /2041/, "no check-number example on a transfer bill");
  assert.deepEqual(["ach", "wire"].map((m) => lab(m, "transfer")), ["Confirmation number (optional)", "Confirmation number (optional)"]);
  assert.equal(M.refField("wire", ["ach", "wire"]).placeholder, "e.g. WIRE 0041-7781");
  assert.equal(lab("card", "card"), "Confirmation number (optional)");
  assert.match(M.refField("", ["card"]).sub, /card's authorisation/, "a card bill, whatever is picked: the card's number");
  assert.equal(lab("", "both"), "Check number", "the check desk keeps 'Check number' while check or cash is still open");
  assert.equal(lab("check", "check"), "Check number");
  assert.equal(lab("check", "both"), "Check number");
  assert.equal(lab("cash", "both"), "Reference (optional)");
  assert.equal(lab("cash", "cash"), "Reference (optional)");
  assert.equal(lab("", null), "Check number", "nobody said: the old wording (the panel is never shown for it)");
  assert.equal(T.outAmount, Math.round((T.toPayAmount + T.toSendAmount) * 100) / 100);
  const todo = d.todo.filter((x) => x.kind === "transfer" || x.kind === "card");
  assert.deepEqual(todo.map((x) => [x.text, x.amount, x.to]), [["Send 1 bank transfer (ACH or wire)", 2120, "secSend"], ["Pay 1 bill by card", 386.5, "secSend"]]);
  // the database's pile wins when the view gives one
  const desk = [Object.assign({}, rows[1], { state: "ready", paid_total: 2000, owed: 2120, pay_pile: "transfer_card" })];
  assert.equal(M.buildDesk({ bills: desk, desk, payments, projects, contacts }, { today: TODAY }).checks.toSend[0].pile, "transfer_card");
  // an ACH payment is never collectable
  assert.equal(M.toPayment(payments[0]).collectable, false);
  assert.equal(M.toPayment(payments[2]).collectable, true);
});

test("amounts typed for a check: only $ , and spaces are stripped; over the cap is refused", () => {
  assert.equal(M.parseAmount("$4,500.00"), 4500);
  assert.ok(Number.isNaN(M.parseAmount("-100")), "a stripped minus would be a hundred-dollar check");
  assert.ok(Number.isNaN(M.parseAmount("1e5")));
  assert.ok(Number.isNaN(M.parseAmount("12.345")));
  assert.equal(M.amountAllowed(700, 700).ok, true);
  assert.equal(M.amountAllowed(700.01, 700).ok, false);
  assert.match(M.amountAllowed(800, 700).reason, /more than the \$700\.00 still authorised/);
  assert.equal(M.amountAllowed(0, 700).ok, false);
  assert.equal(M.checkCap(M.toBill(bill({}), {})).ok, false, "not approved: nothing may be paid");
  assert.match(M.checkCap(M.toBill(approved({}), { paid: new Map([["1", 1000]]) })).reason, /already paid in full/);
});

test("the CSV (Q13: a manual hand-off): every cell quoted, a formula-looking cell made text, a BOM, CRLF", () => {
  assert.equal(M.csvCell("=SUM(A1)"), "\"'=SUM(A1)\"");
  assert.equal(M.csvCell("+1"), "\"'+1\"");
  assert.equal(M.csvCell("-10% retainage"), "\"'-10% retainage\"");
  assert.equal(M.csvCell("@cmd"), "\"'@cmd\"");
  assert.equal(M.csvCell("\tx"), "\"'\tx\"");
  assert.equal(M.csvCell('Smith, "Sons" & Co'), '"Smith, ""Sons"" & Co"');
  assert.equal(M.csvCell(null), '""');
  const d = M.buildDesk({ bills: [approved({ id: 9, description: "=cmd|' /C calc'!A0", vendor_name: "Peña Framing", kind: "Material supplier" })], projects, contacts },
    { today: TODAY, nameOf });
  const csv = M.toCsv(d.ready, M.BILL_COLUMNS);
  assert.ok(csv.startsWith("﻿"), "the BOM");
  assert.ok(csv.endsWith("\r\n"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], '"Vendor","Bill No","Bill Date","Due Date","Amount","Category","Customer/Project","Memo","Approved By","Approved On","Pay Method","Portal Bill ID"');
  assert.equal(lines[1], '"Peña Framing","V-100","2026-10-01","2026-10-31","1000.00","Material supplier","A900 — Made-up Cabin","\'=cmd|\' /C calc\'!A0","Ada Admin","2026-10-05","Check","9"');
  // how the approver said it is paid (owner decision 2026-10-21: also by bank transfer and by card)
  const ways = M.buildDesk({ bills: ["check", "cash", "both", "transfer", "card"].map((m, i) => approved({ id: 20 + i, pay_method: m })), projects, contacts },
    { today: TODAY, nameOf });
  const cells = M.toCsv(ways.ready, M.BILL_COLUMNS).slice(1).split("\r\n").slice(1, -1).map((l) => l.split('","')[10]);
  assert.deepEqual(cells, ["Check", "Cash", "Check or cash", "Bank transfer", "Card"]);
  assert.ok(!/\r\n\r\n/.test(csv));
  assert.equal(M.csvName("bills", TODAY), "dcr-bills-2026-10-21.csv");
  const iv = M.toInvoice({ id: 4, project_id: 2, number: "A901-01", invoice_date: "2026-10-02", due_date: "2026-10-17", status: "paid", sent_date: "2026-10-02",
    invoice_lines: [{ amount: 500 }, { amount: 250.5 }], client_payments: [{ amount: 750.5, paid_date: "2026-10-12" }] }, { projects: new Map(projects.map((p) => [String(p.id), p])) });
  const icsv = M.toCsv([iv], M.INVOICE_COLUMNS).slice(1).split("\r\n");
  assert.equal(icsv[1], '"Lee Example","A901-01","2026-10-02","2026-10-17","750.50","A901 — Made-up Shop","Yes","2026-10-12","4"');
  assert.equal(M.cleanRef("  QB\r\n 17 "), "QB 17");
  assert.equal(M.cleanRef("x".repeat(90)).length, 80);
});

test("money in: invoices sent and not entered are to key in; the marker takes them off (M5b gives invoices one)", () => {
  const inv = (f) => Object.assign({ id: 1, project_id: 1, number: "A900-01", invoice_date: "2026-10-01", due_date: "2026-10-10", status: "sent", sent_date: "2026-10-01",
    qbo_entered_at: null, deleted_at: null, invoice_lines: [{ amount: 100 }], client_payments: [] }, f);
  const d = M.buildDesk({ invoices: [inv({}), inv({ id: 2, status: "draft", sent_date: null }), inv({ id: 3, qbo_entered_at: "2026-10-12T17:00:00Z", qbo_ref: "INV-1" }),
    inv({ id: 4, status: "void" }), inv({ id: 5, invoice_lines: [] })], projects }, { today: TODAY });
  assert.deepEqual(d.ar.ready.map((x) => x.id), [1]);
  assert.deepEqual(d.ar.entered.map((x) => x.id), [3]);
  assert.equal(d.ar.ready[0].lateBy, 11);
  assert.equal(d.totals.arReadyCount, 1);
  assert.ok(d.todo.some((t) => t.kind === "ar" && t.text === "Enter 1 invoice in QuickBooks"));
});

test("the to-do list, in the order it makes sense; the spend glance", () => {
  const rows = [approved({ id: 1 }), approved({ id: 2, pay_method: "cash" }), approved({ id: 3, pay_method: "both" }), bill({ id: 4 })];
  const payments = [{ id: 1, bill_id: 1, amount: 100, method: "check", check_number: "9", paid_date: "2026-10-12" }];
  const d = M.buildDesk({ bills: rows, payments, projects, contacts, costs: [{ id: 1, cost_date: "2026-10-20", kind: "material", amount: 50 },
    { id: 2, cost_date: "2026-08-01", kind: "material", amount: 70 }, { id: 3, cost_date: "2026-10-01", kind: "labor", amount: 20 },
    { id: 4, cost_date: "2026-10-02", kind: "equipment", amount: 500 }], noReceipt: new Set(["3"]) }, { today: TODAY });
  assert.deepEqual(d.todo.map((t) => t.kind), ["check", "cash", "either", "tell", "qbo"]);
  assert.equal(d.todo[0].text, "Write 1 check");
  assert.equal(d.todo[0].amount, 900);
  assert.deepEqual(d.spend, { days: 30, from: "2026-09-22", to: TODAY, count: 3, cost: 70, other: 500, noReceipt: 1 });
  assert.equal(M.spendGlance(null, null, TODAY), null);
});

test("review fix: the spend glance and the ledger it links to give the SAME figures for the same 30 days - a credit subtracted, labour by the hour, equipment listed apart, the same receipts", () => {
  const costs = [
    { id: 1, project_id: 1, cost_date: "2026-10-20", kind: "material", amount: 512.4 },
    { id: 2, project_id: 1, cost_date: "2026-10-16", kind: "material", amount: -64.25, description: "Returned lumber (credit)" },
    { id: 3, project_id: 1, cost_date: "2026-10-19", kind: "labor", hours: 4, rate: 50, amount: null },
    { id: 4, project_id: 1, cost_date: "2026-10-18", kind: "subcontractor", amount: 900 },
    { id: 5, project_id: 1, cost_date: "2026-10-17", kind: "equipment", amount: 120 },
    { id: 6, project_id: 1, cost_date: "2026-10-12", kind: "material", amount: 0 },
    { id: 7, project_id: 1, cost_date: "2026-09-01", kind: "material", amount: 999 },
  ];
  const noReceipt = new Set(["2", "3", "5", "6", "7"]);
  const g = M.spendGlance(costs, noReceipt, TODAY);
  // the ledger page's default view over the same rows (its receipts from files.cost_id)
  const receipts = { 1: [{ id: 91 }], 4: [{ id: 92 }] };
  const v = L.ledgerView(costs.map((c) => L.toLedgerRow(c, { receipts })), { period: "30", today: TODAY });
  assert.deepEqual([g.count, g.cost, g.other, g.noReceipt], [v.totals.count, v.totals.cost, v.totals.other, v.totals.noReceipt]);
  assert.deepEqual([g.count, g.cost, g.other, g.noReceipt], [5, 1548.15, 120, 3], "512.40 - 64.25 + 200 + 900; the credit listed and subtracted");
  assert.equal(g.from, v.bounds.from);
  assert.equal(M.spendGlance(costs, null, TODAY).noReceipt, null, "receipts unknown: not said");
});

test("who to tell: the bill's vendor contact, the quote it is billed against, an exact name, a LABELLED guess, or nobody", () => {
  const links = { contacts: new Map(contacts.map((c) => [String(c.id), c])), quotes: new Map([["7", { id: 7, vendor_contact_id: 12 }]]) };
  const a = M.resolvePayee({ vendorContactId: 10, vendorCompany: "Vendor Framing LLC" }, links);
  assert.equal(a.email, "rory@example.com");
  assert.equal(a.source, "contact");
  assert.equal(a.needsConfirming, false);
  const b = M.resolvePayee({ vendorContactId: 11, quoteId: 7, vendorCompany: "" }, links);
  assert.equal(b.source, "quote", "the vendor contact has no way to reach them: the quote's contact");
  assert.equal(b.email, "kit@example.com");
  const c = M.resolvePayee({ vendorCompany: "Quoted Concrete" }, links);
  assert.equal(c.source, "contacts");
  assert.equal(c.confidence, "likely");
  const g = M.resolvePayee({ vendorCompany: "Vendor Framing" }, links);
  assert.equal(g.confidence, "guess");
  assert.equal(g.needsConfirming, true);
  assert.match(g.why, /check this is them/);
  const n = M.resolvePayee({ vendorCompany: "Nobody Known Inc" }, links);
  assert.equal(n.source, "none");
  assert.equal(n.email, "");
});

test("the pick-up message is about ONE payment: its own amount and number, never the bill's balance", () => {
  const m = M.pickupMessage({ company: "Vendor Framing LLC", amount: 300, checkNumber: "501", projectLabel: "A900 — Made-up Cabin", invoiceNumber: "V-100", from: "DCR Framing" });
  assert.equal(m.subject, "Your check is ready for pickup — A900 — Made-up Cabin");
  assert.match(m.body, /^Hello Vendor Framing LLC,/);
  assert.match(m.body, /Your check for \$300\.00 has been written/);
  assert.match(m.body, /Check number: 501/);
  const cash = M.pickupMessage({ payee: "Sam Supply", amount: 50, checkNumber: "slip 4", isCash: true });
  assert.match(cash.body, /Your payment of \$50\.00 in cash has been prepared/);
  assert.ok(!/Check number/.test(cash.body));
});

test("the approvals card: waiting bills across projects (not void, not deleted, an amount), the paperwork said, overdue said", () => {
  const q = M.approvalsQueue([bill({ id: 1, due_date: "2026-10-01" }), bill({ id: 2, document_file_id: null, due_date: "2026-11-01" }), approved({ id: 3 }),
    bill({ id: 4, void: true }), bill({ id: 5, deleted_at: "2026-10-02T00:00:00Z" }), bill({ id: 6, amount: 0 })], { projects, today: TODAY });
  assert.equal(q.count, 2);
  assert.equal(q.amount, 2000);
  assert.equal(q.missingDocument, 1);
  assert.deepEqual(q.queue.map((b) => [b.id, b.late, b.hasDocument, b.dueText]), [[1, true, true, "Oct 1"], [2, false, false, "Nov 1"]]);
  assert.equal(M.billHref(5), "bill.html?id=5");
});

test("refused[] in the accountant's words (mark_bills_entered / mark_invoices_entered answer {id, reason})", () => {
  const d = M.buildDesk({ bills: [approved({ id: 1, invoice_number: "V-7" })], projects, contacts }, { today: TODAY });
  assert.deepEqual(M.refusedLines([{ id: 1, reason: "Waiting for a manager or admin to approve it." }, { id: 99, reason: "No such bill." }], d.byId),
    ["Vendor Framing LLC #V-7: Waiting for a manager or admin to approve it.", "#99: No such bill."]);
});

test("review fix: two refused invoices of ONE client are told apart by their numbers (the double-entry risk refused[] exists for)", () => {
  const inv = (id, number) => ({ id, project_id: 1, number, status: "sent", invoice_date: "2026-10-01", invoice_lines: [{ amount: 100 }], client_payments: [] });
  const d = M.buildDesk({ bills: [], invoices: [inv(5, "A900-01"), inv(6, "A900-02"), Object.assign(inv(7, ""), { number: "" })], projects, contacts }, { today: TODAY });
  const lines = M.refusedLines([{ id: 5, reason: "Already entered as QB-9." }, { id: 6, reason: "Already entered as QB-9." }, { id: 7, reason: "Not sent yet." }],
    d.invoicesById);
  assert.deepEqual(lines, ["Pat Example #A900-01: Already entered as QB-9.", "Pat Example #A900-02: Already entered as QB-9.", "Pat Example #7: Not sent yet."]);
  assert.equal(new Set(lines.slice(0, 2)).size, 2);
});

test("company days: a timestamp's day is the Pacific day, a date stays as written", () => {
  assert.equal(M.dayOf("2026-10-21T05:30:00Z"), "2026-10-20", "10:30 pm Pacific the evening before");
  assert.equal(M.dayOf("2026-10-21"), "2026-10-21");
  assert.equal(M.daysLate("2026-10-11", TODAY), 10);
  assert.equal(M.daysLate("", TODAY), null);
  // a bill paid in full is late for nobody
  const paid = M.toBill(approved({ due_date: "2026-10-01" }), { paid: new Map([["1", 1000]]), today: TODAY });
  assert.equal(paid.lateBy, null);
});
