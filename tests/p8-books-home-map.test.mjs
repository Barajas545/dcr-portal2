// The Books program, release B part 2a (P4): the Accounting page's piles (site/js/map/books-home.js) over The Books'
// own shapes (map/books.js buildDesk - I24: no SQL copy of the desk): waiting with the last ask, approved without a pay
// method, on her first, the check desk, the payees to tell (one group per payee and kind), told and waiting at the
// office, paid in the last 30 days (by the date on the check, today - 29 inclusive, across a month end), the counts
// (the home page's "N to do"), who a bill-less pick-up goes to (I36: never a loose guess). Made-up rows only.
import test from "node:test";
import assert from "node:assert/strict";
import { buildDesk } from "../site/js/map/books.js";
import * as H from "../site/js/map/books-home.js";

const TODAY = "2026-11-02";
const doc = (id, pid) => ({ id, project_id: pid, bill_id: null, payment_id: null, name: "x.pdf" });
function bill(id, f) {
  return Object.assign({ id, project_id: 1, vendor_contact_id: null, vendor_name: "Madeup Framing", invoice_number: "M-" + id, invoice_date: "2026-10-01",
    due_date: "2026-11-15", amount: 1000, description: null, document_file_id: 100 + id, void: false, approved_by: null, approved_at: null, approved_amount: null,
    pay_method: null, approval_note: null, kind: "Subcontractor", qbo_entered_at: null, deleted_at: null, created_at: "2026-10-20T17:00:00Z", version: 1 }, f || {});
}
function pay(id, billId, f) {
  return Object.assign({ id, bill_id: billId, project_id: 1, paid_date: "2026-10-30", amount: 400, method: "check", check_number: String(5000 + id), reference: null,
    payee: null, memo: null, pickup_told_at: null, pickup_told_by: null, pickup_told_how: null, voided_at: null, picked_up_at: null, cleared_on: null, version: 1 }, f || {});
}
const APPROVED = { approved_by: "u-admin", approved_at: "2026-10-22T17:00:00Z", approved_amount: 1000 };

function desk() {
  const bills = [
    bill(1),                                                                   // waiting (documented)
    bill(2, { document_file_id: null }),                                       // blocked: no document
    bill(3, Object.assign({}, APPROVED, { pay_method: null })),                // approved, nobody said how to pay
    bill(4, Object.assign({}, APPROVED, { pay_method: "check", vendor_contact_id: 7, vendor_name: "Madeup Concrete" })),   // to pay (part paid)
    bill(5, Object.assign({}, APPROVED, { pay_method: "transfer" })),          // to send
    bill(6, Object.assign({}, APPROVED, { pay_method: "both", vendor_contact_id: 7, vendor_name: "Madeup Concrete", amount: 2000, approved_amount: 2000 })),
    bill(8, Object.assign({}, APPROVED, { pay_method: "cash", vendor_name: "Walk-in Sub", quote_id: 31 })),
  ];
  const payments = [
    pay(1, 4, { paid_date: "2026-10-04", amount: 300 }),                          // 29 days back: inside the window (today - 29)
    pay(2, 4, { paid_date: "2026-10-03", amount: 100 }),                          // 30 days back: outside
    pay(3, 6, { method: "check", amount: 500, paid_date: "2026-11-01" }),         // to tell (contact 7)
    pay(4, 6, { method: "check", amount: 600, paid_date: "2026-11-02" }),         // to tell, same payee and kind -> one group
    pay(5, 6, { method: "cash", check_number: null, amount: 200 }),               // to tell, same payee, cash -> its own group
    pay(6, 6, { method: "check", amount: 100, pickup_told_at: "2026-10-31T17:00:00Z", pickup_told_how: "email", pickup_told_by: "Casey" }),  // at the office
    pay(7, 6, { method: "check", amount: 100, voided_at: "2026-10-31T18:00:00Z" }),  // voided: nowhere
    pay(8, 8, { method: "cash", check_number: null, amount: 250, payee: "Walk-in Sub" }),
    pay(9, 6, { method: "check", amount: 50, pickup_told_at: "2026-10-30T17:00:00Z", picked_up_at: "2026-10-31T17:00:00Z" }),  // picked up
  ];
  const contacts = [{ id: 7, name: "Sam Madeup", company: "Madeup Concrete", email: "sam@example.com", phone: "(805) 555-0177" },
    { id: 9, name: "Walk-in Sub", company: null, email: "walk@example.com", phone: null }, { id: 10, name: "Quote Person", company: "Quote Co", email: "q@example.com", phone: "(805) 555-0178" }];
  const files = bills.filter((b) => b.document_file_id).map((b) => doc(b.document_file_id, 1));
  const d = buildDesk({ bills, payments, contacts, quotes: [{ id: 31, project_id: 1, vendor_contact_id: null }], projects: [{ id: 1, number: "A901", name: "Madeup Barn" }] },
    { today: TODAY, nameOf: () => "" });
  // the bills' documents are live files: buildDesk is given them through the view in the app; here through files
  return { d, files, bills };
}

test("buildHome: the piles from buildDesk's shapes - waiting, approved without a pay method, blocked, to pay / send", () => {
  const { d } = desk();
  // the made-up rows carry no books_desk.documented: the documents are judged by the pointer here (the view decides in the app)
  d.waiting.forEach((b) => { b.hasDocument = true; });
  const h = H.buildHome(d, { messages: [] }, { today: TODAY });
  assert.ok(h.ready, "the messages were read");
  assert.deepEqual(h.toDecide.map((b) => b.id), [3]);
  assert.deepEqual(h.toPay.map((b) => b.id).sort(), [4, 6, 8]);
  assert.deepEqual(h.toSend.map((b) => b.id), [5]);
  assert.equal(H.buildHome(d, { messages: null }, { today: TODAY }).ready, false, "no money_messages yet: not ready");
});

test("paid in the last 30 days: paid_date >= today - 29 inclusive, across a month end; live payments only, newest first; each with its files", () => {
  const { d } = desk();
  const files = [{ id: 501, payment_id: 1, bill_id: 4, name: "photo.jpg" }, { id: 502, payment_id: null, bill_id: 4, name: "invoice.pdf" }];
  const p = H.paid30(d.payments, d.byId, files, TODAY);
  assert.ok(p.some((x) => x.id === 1), "2026-10-04 is today - 29: in");
  assert.ok(!p.some((x) => x.id === 2), "2026-10-03 is today - 30: out");
  assert.ok(!p.some((x) => x.id === 7), "a voided check paid nothing");
  assert.deepEqual(p.map((x) => x.paidDate), p.map((x) => x.paidDate).slice().sort().reverse(), "newest first");
  const one = p.find((x) => x.id === 1);
  assert.deepEqual([one.fileCount, one.files.map((f) => f.id)], [2, [501, 502]], "the payment's files, then the bill's");
  assert.equal(H.paidKind("ach"), "transfer");
  assert.equal(H.paidKind("wire"), "transfer");
  assert.equal(H.paidKind("card"), "card");
  assert.deepEqual(H.PAID_FILTERS.map((f) => f.label), ["All", "Checks", "Cash", "Transfer", "Card"]);
  assert.equal(H.paidState(Object.assign({}, one, { clearedOn: "2026-10-30" })), "cleared Oct 30");
  assert.equal(H.paidState(Object.assign({}, one, { toldAt: "2026-10-28T17:00:00Z", toldHow: "text message" })), "told by text Oct 28");
  assert.equal(H.paidState(one), "not told yet");
});

test("to tell: one group per payee and kind (a check and cash of one payee are two messages); told and waiting at the office; picked up and voided nowhere", () => {
  const { d } = desk();
  const groups = H.tellGroups(d.checks.toTell, []);
  const of = (cash, who) => groups.find((g) => g.isCash === cash && (who ? g.vendorContactId === who : g.vendorContactId === null));
  assert.deepEqual(of(false, 7).paymentIds.sort(), [1, 2, 3, 4], "the checks of one payee (two of their bills): one group");
  assert.deepEqual(of(true, 7).paymentIds, [5], "their cash: its own group (tell_payee: all checks or all cash)");
  assert.equal(of(false, 7).amount, 1500);
  assert.deepEqual(of(true, null).paymentIds, [8], "a bill with no contact: grouped by the payee's name");
  const office = H.waitingPickup(d.payments, d.byId);
  assert.deepEqual(office.map((p) => p.id), [6], "told, not picked up; a picked-up one and a voided one are not waiting");
  // at most 20 payments a group (tell_payee's limit)
  const many = Array.from({ length: 23 }, (_, i) => ({ paymentId: 100 + i, payee: "Madeup", vendorContactId: 7, isCash: false, amount: 1 }));
  assert.deepEqual(H.tellGroups(many, []).map((g) => g.payments.length), [20, 3]);
});

test("who a pick-up goes to (I20 / I36): the bill's own contact (nothing given), else the quote's vendor, else the payee's exact name - never a loose guess", () => {
  const contacts = new Map([[7, { id: 7, name: "Sam Madeup", company: "Madeup Concrete", kind: "subcontractor", email: "sam@example.com", phone: "(805) 555-0177" }],
    [9, { id: 9, name: "Walk-in Sub", company: null, kind: "subcontractor", email: "walk@example.com", phone: "" }],
    [10, { id: 10, name: "Quote Person", company: "Quote Co", kind: "supplier", email: "bad, list@example.com", phone: "(805) 555-0178" }],
    [11, { id: 11, name: "Walk", company: "Walk-in Subcontracting Inc", kind: "service", email: "w2@example.com", phone: "(805) 555-0179" }]].map(([k, v]) => [String(k), v]));
  const links = { contacts, quotes: new Map([["31", { id: 31, vendor_contact_id: 10 }]]) };
  const own = H.pickupContact({ vendorContactId: 7, first: {} }, links);
  assert.deepEqual([own.source, own.contactId, own.email, own.phone], ["bill", null, "sam@example.com", "(805) 555-0177"], "the bill's own: the database takes it from the bill");
  const quote = H.pickupContact({ vendorContactId: null, quoteId: 31, first: {} }, links);
  assert.deepEqual([quote.source, quote.contactId, quote.email], ["quote", 10, ""], "the quote's vendor; an address list is no address");
  const name = H.pickupContact({ vendorContactId: null, quoteId: null, first: { payee: "  walk-in   SUB " } }, links);
  assert.deepEqual([name.source, name.contactId, name.phone], ["name", 9, ""], "case and spaces aside, the exact name");
  const none = H.pickupContact({ vendorContactId: null, quoteId: null, first: { payee: "Walk-in" } }, links);
  assert.deepEqual([none.source, none.contactId], ["none", null], "a partial name is never a match (the database refuses anyone else)");
});

test("who a pick-up goes to, a bill with no contact: only a payee kind (I36) - a same-name client or employee is never the payee", () => {
  // the demo seed's collision: a client and the sub share a name, and the client has the lower id
  const contacts = new Map([[2, { id: 2, name: "Rowan Sample", company: null, kind: "client", email: "rowan.client@example.com", phone: "(805) 555-0102" }],
    [3, { id: 3, name: "Kit Worker", company: "Kit Framing", kind: "employee", email: "kit@example.com", phone: "(805) 555-0103" }],
    [4, { id: 4, name: "Old Sub", company: "Gone Co", kind: "subcontractor", email: "gone@example.com", phone: "(805) 555-0104", deleted_at: "2026-10-01T00:00:00Z" }],
    [5, { id: 5, name: "Pat Client", company: "Example Concrete", kind: "Client", email: "pat@example.com", phone: "(805) 555-0105" }],
    [9, { id: 9, name: "Sam Sub", company: "Example Concrete", kind: "subcontractor", email: "sam@example.com", phone: "(805) 555-0109" }],
    [40, { id: 40, name: "Rowan Sample", company: null, kind: "subcontractor", email: "rowan.sub@example.com", phone: "(805) 555-0140" }],
    [41, { id: 41, name: "Quote Client", company: null, kind: "client", email: "qc@example.com", phone: "(805) 555-0141" }],
    [42, { id: 42, name: "Other Payee", company: null, kind: "other", email: "", phone: "(805) 555-0142" }]].map(([k, v]) => [String(k), v]));
  const quotes = new Map([["31", { id: 31, vendor_contact_id: 41 }], ["32", { id: 32, vendor_contact_id: 4 }]]);
  const links = { contacts, quotes };
  const sub = H.pickupContact({ vendorContactId: null, quoteId: null, first: { payee: "Rowan Sample" } }, links);
  assert.deepEqual([sub.source, sub.contactId, sub.email, sub.phone], ["name", 40, "rowan.sub@example.com", "(805) 555-0140"], "the sub, not the lower-id client");
  const co = H.pickupContact({ vendorContactId: null, quoteId: null, first: { payee: "", vendor: "example concrete" } }, links);
  assert.deepEqual([co.source, co.contactId], ["name", 9], "a company match skips a client at that company (kind case aside)");
  const emp = H.pickupContact({ vendorContactId: null, quoteId: null, first: { payee: "Kit Worker", vendorCompany: "Kit Framing" } }, links);
  assert.deepEqual([emp.source, emp.contactId, emp.email, emp.phone], ["none", null, "", ""], "only an employee matches: nobody (never dial or show the employee)");
  const gone = H.pickupContact({ vendorContactId: null, quoteId: null, first: { payee: "Gone Co" } }, links);
  assert.deepEqual([gone.source, gone.contactId], ["none", null], "a deleted contact is never the payee");
  const other = H.pickupContact({ vendorContactId: null, quoteId: null, first: { payee: "other payee" } }, links);
  assert.deepEqual([other.source, other.contactId], ["name", 42], "kind other is a payee kind");
  const q = H.pickupContact({ vendorContactId: null, quoteId: 31, first: { payee: "Rowan Sample" } }, links);
  assert.deepEqual([q.source, q.contactId], ["name", 40], "a quote whose vendor contact is a client falls through to the name tier");
  const qGone = H.pickupContact({ vendorContactId: null, quoteId: 32, first: { payee: "Nobody Here" } }, links);
  assert.deepEqual([qGone.source, qGone.contactId], ["none", null], "a deleted quote vendor is nobody");
  const noKind = new Map([["2", { id: 2, name: "Rowan Sample", company: null, email: "rowan.client@example.com", phone: "(805) 555-0102" }]]);
  assert.equal(H.pickupContact({ vendorContactId: null, quoteId: null, first: { payee: "Rowan Sample" } }, { contacts: noKind }).source, "none",
    "a contact read without its kind is never taken for a payee");
  const own = H.pickupContact({ vendorContactId: 2, first: { payee: "Rowan Sample" } }, links);
  assert.deepEqual([own.source, own.contactId, own.email], ["bill", null, "rowan.client@example.com"], "the bill's own contact stays, whatever its kind (the database takes it from the bill)");
  assert.deepEqual(H.PAYEE_KINDS, ["subcontractor", "supplier", "service", "other"], "tell_payee's kinds (20261030000400 c_payee)");
});

test("lastAsked: the latest ask naming the bill, with each of its recipients; its words; a pick-up's last message", () => {
  const msgs = [
    { id: 1, group_id: "g1", kind: "approval_request", channel: "email", bill_ids: [1], to_name: "Avery Admin", status: "sent", sent_at: "2026-10-28T17:44:00Z", created_at: "2026-10-28T17:40:00Z" },
    { id: 2, group_id: "g2", kind: "approval_request", channel: "email", bill_ids: [1, 3], to_name: "Avery Admin", status: "queued", created_at: "2026-11-01T17:00:00Z", created_by: "u-me" },
    { id: 3, group_id: "g2", kind: "approval_request", channel: "sms", bill_ids: [1, 3], to_name: "Drew Approver", status: "sent", sent_at: "2026-11-01T17:05:00Z", created_at: "2026-11-01T17:00:00Z" },
    { id: 4, group_id: "g3", kind: "payment_pickup", channel: "email", bill_ids: [6], payment_ids: [3, 4], to_name: "Sam Madeup", status: "not_sent", status_note: "opted out", created_at: "2026-11-01T18:00:00Z" },
  ];
  const la = H.lastAsked(1, msgs);
  assert.deepEqual(la.entries.map((m) => m.id), [2, 3], "the latest ask, both its recipients");
  assert.equal(H.lastAskedText(la), "Asked Avery · e-mail waiting for the reminder PC; Drew · text (by hand) Nov 1");
  assert.equal(H.lastAskedText(H.lastAsked(9, msgs)), "Not asked yet");
  assert.equal(H.askedWords(H.lastAsked(1, msgs.slice(0, 1)).entries[0]), "e-mail ✓ sent Oct 28 10:44 AM");
  assert.equal(H.lastPickup([4], msgs).id, 4);
  assert.equal(H.lastPickup([99], msgs), null);
  const { d } = desk();
  assert.equal(H.buildHome(d, { messages: msgs }, { today: TODAY, me: { id: "u-me" } }).waitingEmail, true, "one of MY e-mails waits: poll");
  assert.equal(H.buildHome(d, { messages: msgs }, { today: TODAY, me: { id: "u-other" } }).waitingEmail, false, "someone else's: no poll");
});

test("the counts: the chips and the home page's 'N to do' (waiting + blocked + checks to write + payees to tell); the pending submissions", () => {
  const { d } = desk();
  const h = H.buildHome(d, { messages: [], subs: [{ id: 3, state: "pending", created_at: "2026-10-30" }, { id: 2, state: "pending", created_at: "2026-10-29" },
    { id: 4, state: "accepted", created_at: "2026-10-28" }] }, { today: TODAY });
  const c = h.counts;
  assert.equal(c.todo, h.waiting.length + h.blocked.length + h.toPay.length + h.toSend.length + c.pickups);
  assert.equal(c.pickups, d.checks.toTell.length);
  assert.equal(c.approvals, h.waiting.length + h.toDecide.length + h.blocked.length);
  assert.equal(H.todoBadge(c), c.todo + " to do");
  assert.equal(H.todoBadge({ todo: 0 }), "");
  assert.deepEqual([h.subs.count, h.subs.oldest.map((s) => s.id)], [2, [2, 3]], "pending only, oldest first");
});
