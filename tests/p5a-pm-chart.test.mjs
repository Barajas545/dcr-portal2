// P5a: the Progress Chart's engine (site/js/pm-chart.js, the port of the old pm-chart.js) and its data mapper
// (site/js/map/pm.js): Desktop 2's status-to-milestone map, a lane per estimate item, the quote chase clock on the
// company day, the item flags, the money tiles only with prices AND financials, and no amount anywhere for a person
// without prices (BLUEPRINT 2.1 principle 8, P5 acceptance check 1). Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";

import * as C from "../site/js/pm-chart.js";
import * as M from "../site/js/map/pm.js";

const TODAY = "2026-10-21";

function rows(over) {
  return Object.assign({
    project: { id: 7, number: "A267", name: "Sandbox Residence", address: "1 Test Way", city: "Sandbox", client_name: "Sandbox client",
      status: "in_progress", created_at: "2026-09-01T17:00:00Z", completed_date: null, version: 4 },
    activity: [
      { id: 1, kind: "status", from_status: "new_request", to_status: "estimating", text: "Status: New Request → Estimating", created_at: "2026-09-05T17:00:00Z" },
      { id: 2, kind: "status", from_status: "estimating", to_status: "sent", text: "Status: Estimating → Sent", created_at: "2026-09-12T17:00:00Z" },
      { id: 3, kind: "status", from_status: "sent", to_status: "approved", text: "Status: Sent → Approved", created_at: "2026-09-20T17:00:00Z" },
      { id: 4, kind: "status", from_status: "approved", to_status: "in_progress", text: "Status: Approved → In Progress", created_at: "2026-09-28T06:30:00Z" },
    ],
    estimates: [
      { id: 10, number: 1, kind: "estimate", co_number: null, name: "Main framing", status: "approved", group_order: ["Walls", "Floor"] },
      { id: 11, number: 2, kind: "change_order", co_number: 1, name: "Extra window", status: "approved", group_order: [] },
      { id: 12, number: 3, kind: "estimate", co_number: null, name: "Old layout", status: "declined", group_order: [] },
      { id: 13, number: 4, kind: "estimate", co_number: null, name: "Archived", status: "draft", archived_at: "2026-09-02T00:00:00Z" },
    ],
    items: [
      { id: 100, estimate_id: 10, group_name: "Floor", group_code: "06.10", sort: 1, name: "Floor joists", description: "TJI 230", material_description: "OSB", item_type: "both", assigned_contact_id: 501 },
      { id: 101, estimate_id: 10, group_name: "Walls", group_code: "06.11", sort: 1, name: "Exterior walls", description: "Ask about the $1,200 credit", item_type: "labor", assigned_text: "DCR crew" },
      { id: 102, estimate_id: 10, group_name: " walls ", sort: 2, name: "Interior walls", item_type: "both" },
      { id: 103, estimate_id: 11, group_name: null, sort: 1, name: "Rough opening", item_type: "both" },
      { id: 104, estimate_id: 12, name: "Declined item" },
      { id: 105, estimate_id: 13, name: "Archived item" },
      { id: 106, estimate_id: 10, group_name: "Floor", sort: 2, name: "Deleted item", deleted_at: "2026-10-01T00:00:00Z" },
    ],
    totals: [{ item_id: 100, total: 9150 }, { item_id: 101, total: 27000.5 }, { item_id: 102, total: 0 }, { item_id: 103, total: 1450 }],
    itemPrices: [{ item_id: 102, quoted_price: 3100 }],
    flags: [
      { item_id: 100, state: "complete", note: "Inspected", due_date: null, by: "u-lead", at: "2026-10-12T17:00:00Z", version: 1 },
      { item_id: 101, state: "important", note: "Inspection - $300 fee", due_date: "2026-10-19", by: "u-lead", at: "2026-10-18T17:00:00Z", version: 2 },
    ],
    quotes: [
      { id: 1, estimate_item_id: 100, vendor_contact_id: 501, vendor_name: "Kestrel Lumber Supply", kind: "quote", status: "awarded", requested_date: "2026-09-10",
        received_date: "2026-09-14", follow_ups: 0, version: 2, prices: { amount: 9150, document_url: "https://example.com/q1.pdf", notes: "Quoted $9,150" } },
      { id: 2, estimate_item_id: 102, vendor_contact_id: 502, vendor_name: "Marlow Concrete", kind: "quote", status: "requested", requested_date: "2026-09-25",
        follow_ups: 1, last_follow_up: "2026-10-02", version: 3, prices: { amount: null, document_url: null } },
      { id: 3, estimate_item_id: 103, vendor_contact_id: null, vendor_name: "Ashgrove Trim", kind: "change_order", status: "awarded", requested_date: "2026-10-01",
        received_date: "2026-10-03", version: 1, prices: { amount: 860, document_url: null } },
      { id: 4, estimate_item_id: null, vendor_name: "Dumpster Co", kind: "quote", status: "received", requested_date: "2026-10-10", received_date: "2026-10-12", version: 1 },
      { id: 5, estimate_item_id: 101, vendor_name: "DCR crew", kind: "quote", status: "self", requested_date: null, version: 1 },
    ],
    contacts: [{ id: 501, name: "Ana Fernhill", company: "Kestrel Lumber Supply", email: "orders@example.com" }, { id: 502, name: "Bo Marlow", company: null, email: "bo@example.com" }],
    takeoffs: [{ id: 1, estimate_item_id: 100, name: "Floor package", rows: 6 }],
    bills: [
      { id: 50, estimate_item_id: 100, quote_id: 1, vendor_name: "Kestrel Lumber Supply", invoice_number: "4101", invoice_date: "2026-09-30", due_date: "2026-10-30",
        amount: 9150, approved_at: "2026-10-01T17:00:00Z", approved_amount: 9150, approved_by: "u-admin", payments: [{ amount: 9150 }], document_file_id: 9 },
      { id: 51, estimate_item_id: null, quote_id: 3, vendor_name: "Ashgrove Trim", amount: 980, approved_at: "2026-10-10T17:00:00Z", approved_amount: 980,
        due_date: "2026-10-15", payments: [], document_file_id: 10 },
      { id: 52, estimate_item_id: null, quote_id: null, vendor_name: "Pump Rental", amount: 650, payments: [] },
      { id: 53, estimate_item_id: 100, amount: 99, void: true, payments: [] },
    ],
    invoices: [
      { id: 70, number: "A267-01", status: "sent", invoice_date: "2026-10-01", sent_date: "2026-10-01", due_date: "2026-10-16",
        invoice_lines: [{ estimate_id: 10, amount: 14800 }], client_payments: [{ amount: 5000 }] },
      { id: 71, number: "A267-02", status: "paid", invoice_date: "2026-10-05", due_date: "2026-10-20",
        invoice_lines: [{ estimate_id: 11, amount: 1450 }], client_payments: [{ amount: 1450 }] },
      { id: 72, number: "A267-03", status: "void", invoice_lines: [{ estimate_id: 10, amount: 1 }] },
    ],
    costs: [{ id: 80, estimate_item_id: null, cost_date: "2026-10-11", kind: "equipment", description: "Generator fuel", amount: 86.4 }],
    commitments: [{ quote_id: 1, committed: 9150, billed: 9150, approved: 9150, paid: 9150, pct_billed: 100, pct_paid: 100, over_billed: false, over_paid: false, paid_unapproved: 0, waiting_count: 0 },
      { quote_id: 3, committed: 860, billed: 980, approved: 980, paid: 0, pct_billed: 113.95, pct_paid: 0, over_billed: true, over_billed_by: 120, over_paid: false, paid_unapproved: 0 }],
    tasks: [{ id: 9, estimate_item_id: 101, title: "Book the $300 inspection", status: "open", priority: "urgent", assigned_to: "u-lead", created_at: "2026-10-19T17:00:00Z" }],
    files: [{ id: 33, estimate_item_id: 101, folder: "item", name: "Shear schedule.pdf", storage: "local" }, { id: 34, estimate_item_id: null, folder: "item", name: "x" }],
  }, over || {});
}
const nameOf = (u) => ({ "u-lead": "Riley Lead", "u-admin": "Avery Admin" })[u] || "";
const everything = { today: TODAY, prices: true, money: true, nameOf };
const nothing = { today: TODAY, prices: false, money: false, nameOf };

/* ── the mapper ── */
test("statusDates: the company day the project last moved to each status; an imported old line read with the old words", () => {
  const d = M.statusDates(rows().activity.concat([
    { kind: "note", text: "Status changed: Recived → Estimating", created_at: "2026-10-01T17:00:00Z" },
    { kind: "note", text: "Status changed: Estimating → Garbled", created_at: "2026-10-02T17:00:00Z" },
    { kind: "status", to_status: "sent", text: "Status: Estimating → Sent — client asked twice", created_at: "2026-09-10T17:00:00Z" },
  ]));
  assert.equal(d.estimating, "2026-10-01");          // the imported line is later than the status row
  assert.equal(d.sent, "2026-09-12");                // the latest of two
  assert.equal(d.in_progress, "2026-09-27");         // 06:30 UTC is still the 27th in California
  assert.equal(d.new_request, undefined);            // "Garbled" maps to nothing
  assert.equal(M.statusDates([{ kind: "note", text: "Status: New Request → Follow Up", created_at: "2026-10-03T17:00:00Z" }]).follow_up, "2026-10-03");
});

test("orderItems: group_order first, then group code naturally, then named before unnamed; inside a group by sort then id", () => {
  const items = [
    { id: 1, group_name: "Roof", group_code: "06.17.00", sort: 1 },
    { id: 2, group_name: "Floor", group_code: "06.10.00", sort: 2 },
    { id: 3, group_name: null, sort: 1 },
    { id: 4, group_name: "floor ", group_code: "", sort: 1 },
    { id: 5, group_name: "Walls", group_code: "06.9", sort: null },
    { id: 6, group_name: "Walls", sort: 1 },
  ];
  assert.deepEqual(M.orderItems(items, []).map((i) => i.id), [6, 5, 4, 2, 1, 3]);
  assert.deepEqual(M.orderItems(items, ["Roof", "  WALLS"]).map((i) => i.id), [1, 6, 5, 4, 2, 3]);
  assert.equal(M.naturalCmp("06.9", "06.10"), -1);
  assert.equal(M.naturalCmp("", "06.10"), 1);
});

test("estimateName and liveEstimates: names as Desktop 2 says them; deleted, archived and declined ones are not tracked", () => {
  assert.equal(M.estimateName({ kind: "change_order", co_number: 2, name: "Extra  window" }), "CO #2 — Extra window");
  assert.equal(M.estimateName({ kind: "change_order", co_number: 3 }), "Change order #3");
  assert.equal(M.estimateName({ kind: "estimate", number: 4, name: " " }), "Estimate #4");
  assert.deepEqual(M.liveEstimates(rows().estimates.concat([{ id: 14, kind: "estimate", number: 5, deleted_at: "x" }])).map((e) => e.id), [10, 11]);
});

test("toPayload with prices and financials: a lane per live item in estimate order, the assignee, flags, quotes with amounts, money", () => {
  const p = M.toPayload(rows(), everything);
  assert.deepEqual(p.items.map((i) => i.name), ["Exterior walls", "Interior walls", "Floor joists", "Rough opening"]);
  const floor = p.items.find((i) => i.itemId === 100);
  assert.deepEqual(floor.assignees, [{ name: "Kestrel Lumber Supply" }]);
  assert.equal(floor.estTotal, 9150);
  assert.deepEqual(floor.takeoff, { lines: 6, names: ["Floor package"] });
  assert.equal(floor.flag.state, "complete");
  assert.equal(floor.flag.by, "Riley Lead");
  assert.equal(floor.flag.at, "2026-10-12");
  const inner = p.items.find((i) => i.itemId === 102);
  assert.equal(inner.groupName, "Walls", "a group's name is its first item's spelling (' walls ' is in group Walls)");
  assert.equal(inner.quotedPrice, 3100);
  assert.equal(inner.priced, true);                     // on an approved estimate (and a quoted price)
  assert.equal(p.items.find((i) => i.itemId === 103).estimateName, "CO #1 — Extra window");
  const q1 = p.quotes.find((q) => q.id === 1);
  assert.equal(q1.amount, 9150);
  assert.equal(q1.documentUrl, "https://example.com/q1.pdf");
  assert.equal(q1.notes, "Quoted $9,150", "the quote's notes come with its price row (quote_prices.notes)");
  assert.equal(q1.vendorEmail, "orders@example.com");
  assert.equal(p.bills.length, 3, "the void bill is left out");
  assert.deepEqual(p.bills.find((b) => b.id === 50), Object.assign({}, p.bills.find((b) => b.id === 50), { paid: 9150, owed: 0, approved: true, approvedBy: "Avery Admin" }));
  assert.deepEqual(p.invoices.map((i) => [i.number, i.total, i.paid, i.estimateIds]), [["A267-01", 14800, 5000, [10]], ["A267-02", 1450, 1450, [11]]]);
  assert.equal(p.commitments.find((x) => x.quoteId === 3).overBilledBy, 120);
  assert.equal(p.files.length, 1);
  assert.equal(p.pricesHidden, false);
  assert.equal(p.moneyHidden, false);
});

test("toPayload without prices: no amount copied in even if a row carried one, the typed words masked, quotes still listed", () => {
  const p = M.toPayload(rows(), nothing);
  const text = JSON.stringify(p);
  assert.ok(!/\$\s?\d/.test(text), "no $ amount anywhere: " + (text.match(/.{20}\$\s?\d.{10}/) || [""])[0]);
  for (const k of ["amount", "estTotal", "quotedPrice", "total"]) {
    for (const it of p.items) assert.ok(it[k] === undefined || it[k] === null, k);
  }
  assert.equal(p.quotes.length, 5, "every quote and change order is listed (Q11)");
  assert.ok(p.quotes.every((q) => !("amount" in q) && q.documentUrl === "" && q.notes === ""), "no amount, no priced document, no notes");
  assert.equal(p.bills, null);
  assert.equal(p.invoices, null);
  assert.equal(p.costs, null);
  assert.equal(p.commitments, null);
  assert.match(p.items.find((i) => i.itemId === 101).laborNames[0], /amount hidden/);
  assert.match(p.items.find((i) => i.itemId === 101).flag.note, /amount hidden/);
  assert.match(p.tasks[0].title, /amount hidden/);
  // priced from the estimate's status (everyone can tell an estimate went out), never from a price
  assert.equal(p.items.find((i) => i.itemId === 102).priced, true);
  // prices but no financials: amounts on items and quotes, still no money tiles
  const q = M.toPayload(rows(), { today: TODAY, prices: true, money: false });
  assert.equal(q.items.find((i) => i.itemId === 100).estTotal, 9150);
  assert.equal(q.bills, null);
  assert.equal(q.moneyHidden, true);
});

test("worksitePayload: every amount taken out of a price person's payload", () => {
  const p = M.worksitePayload(M.toPayload(rows(), everything));
  assert.equal(p.pricesHidden, true);
  assert.equal(p.moneyHidden, true);
  assert.equal(p.bills, null);
  assert.ok(p.items.every((i) => i.estTotal === null && i.quotedPrice === null));
  assert.ok(p.quotes.every((q) => !("amount" in q)));
  const m = C.derive(p, { expandedA: true, expandedB: true });
  const svg = C.svg(m, C.layout(m, { compact: true, labels: false }), { interactive: false });
  assert.ok(!/\$\d/.test(svg));
});

test("worksitePayload masks every word a price person's payload carries as typed (review: the worksite copy printed \"$1,200\")", () => {
  const typed = rows({
    project: Object.assign({}, rows().project, { name: "Deck $40k job", status_note: "deposit $2,000 in" }),
    items: rows().items.map((i) => i.id === 101 ? Object.assign({}, i, { name: "Exterior walls 2x6 (credit asked $1,200)", group_name: "Walls $5 extra",
      material_description: "Studs at $4.10" }) : i),
    flags: [{ item_id: 101, state: "important", note: "client deposit $1,500 first", due_date: "2026-10-24", by: "u-lead", at: "2026-10-18T17:00:00Z", version: 2 }],
    takeoffs: [{ id: 1, estimate_item_id: 101, name: "Walls ($640 of nails)", rows: 2 }],
    files: [{ id: 33, estimate_item_id: 101, folder: "item", name: "Valley Truss quote $4,850.pdf", storage: "local" }],
  });
  const full = M.toPayload(typed, everything);
  assert.ok(/\$1,200/.test(JSON.stringify(full)), "a price person's payload keeps the words as typed (Q28)");
  const w = M.worksitePayload(full);
  const text = JSON.stringify(w);
  assert.ok(!/\$\s?\d/.test(text), "no $ amount left: " + (text.match(/.{30}\$\s?\d.{10}/) || [""])[0]);
  const lane = w.items.find((i) => i.itemId === 101);
  assert.equal(lane.name, "Exterior walls 2x6 (credit asked amount hidden)");
  assert.equal(lane.flag.note, "client deposit (amount hidden) first");
  assert.equal(w.project.name, "Deck (amount hidden) job");
  assert.ok(w.quotes.every((q) => q.notes === "" && q.documentUrl === ""), "no quote notes, no priced document");
  // what report-pm draws from it: the chart and the lane status words
  const m = C.derive(w, { expandedA: true, expandedB: true });
  const drawn = C.svg(m, C.layout(m, { compact: true, labels: false }), { interactive: false }) +
    m.lanes.map((l) => l.name + " " + l.groupName + " " + C.laneStatus(l, false) + " " + (l.flag ? l.flag.note : "")).join(" ");
  assert.ok(!/\$\s?\d/.test(drawn), "no $ on the sheet");
  // a person without prices: the same words masked already, and masking twice changes nothing
  const plain = M.toPayload(typed, nothing);
  assert.equal(M.worksitePayload(plain).items.find((i) => i.itemId === 101).name, plain.items.find((i) => i.itemId === 101).name);
});

test("priced is the database's (estimate_item_totals.priced): the same bidding steps, percentages and words for every role", () => {
  // a draft change order whose item has a price: only the database knows it for a person without prices
  const r = rows({
    estimates: rows().estimates.map((e) => e.id === 11 ? Object.assign({}, e, { status: "draft" }) : e),
    quotes: [],
  });
  const totals = [{ item_id: 100, total: 9150, priced: true }, { item_id: 101, total: 27000.5, priced: true },
    { item_id: 102, total: 0, priced: true }, { item_id: 103, total: 1450, priced: true }];
  const priceless = totals.map((t) => ({ item_id: t.item_id, priced: t.priced }));        // what repo/pm.js reads without prices
  const admin = C.derive(M.toPayload(Object.assign({}, r, { totals }), everything), { expandedA: true, expandedB: true });
  const lead = C.derive(M.toPayload(Object.assign({}, r, { totals: priceless, itemPrices: null }), nothing), { expandedA: true, expandedB: true });
  const co = (m) => m.lanes.find((l) => l.itemId === 103);
  assert.equal(co(lead).priced, true, "the draft change order's priced item reads priced without prices too");
  assert.deepEqual(["A0", "A1", "A2"].map((k) => co(lead).nodes[k].s), ["A0", "A1", "A2"].map((k) => co(admin).nodes[k].s));
  assert.deepEqual(lead.lanes.map((l) => l.pctA), admin.lanes.map((l) => l.pctA));
  assert.equal(lead.regions.pctA, admin.regions.pctA);
  assert.equal(lead.regions.humanA, admin.regions.humanA);
  assert.equal(C.laneStatus(co(lead), false), C.laneStatus(co(admin), false));
  // an item the database says is not priced stays unpriced for everyone (its estimate is a draft)
  const none = M.toPayload(Object.assign({}, r, { totals: priceless.map((t) => t.item_id === 103 ? { item_id: 103, priced: false } : t) }), nothing);
  assert.equal(none.items.find((i) => i.itemId === 103).priced, false);
});

test("an item document's name is typed words: masked without prices (the drawer; review: \"$4,850\" in the Documents section)", () => {
  const r = rows({ files: [{ id: 33, estimate_item_id: 101, folder: "item", name: "Valley Truss quote $4,850.pdf", storage: "local" }] });
  assert.equal(M.toPayload(r, nothing).files[0].name, "Valley Truss quote (amount hidden).pdf");
  assert.equal(M.toPayload(r, everything).files[0].name, "Valley Truss quote $4,850.pdf");
});

test("logName: the project log names an item by the database's scrub rule - the same words for every role, never an amount", () => {
  const r = rows({ items: rows().items.map((i) => i.id === 101 ? Object.assign({}, i, { name: "Exterior walls 2x6 (credit asked $1,200)" }) : i) });
  const a = M.toPayload(r, everything).items.find((i) => i.itemId === 101);
  const b = M.toPayload(r, nothing).items.find((i) => i.itemId === 101);
  assert.equal(a.logName, "Exterior walls 2x6 (credit asked [amount])");
  assert.equal(b.logName, a.logName, "not the display mask of one person");
});

test("the gates hide controls the database would refuse (M5a: item_flags = admin, manager, lead; quote_follow_up = quote editors)", () => {
  const me = (role, extra) => Object.assign({ role, active: true }, extra || {});
  assert.deepEqual(["admin", "manager", "lead", "accountant", "field", "viewer", "agents"].map((r) => M.canFlag(me(r))), [true, true, true, false, false, false, false]);
  assert.equal(M.canFollowUp(me("admin")), true);
  assert.equal(M.canFollowUp(me("manager")), false);
  assert.equal(M.canFollowUp(me("manager", { can_see_prices: true })), true);
  assert.equal(M.canFollowUp(me("accountant", { can_see_prices: true })), true);
  assert.equal(M.canFollowUp(me("lead", { can_see_prices: true })), false);
  assert.equal(M.seesMoney(me("manager", { can_see_financials: true })), false, "financials without prices: no amount (principle 8)");
  assert.equal(M.seesMoney(me("manager", { can_see_financials: true, can_see_prices: true })), true);
  assert.equal(M.seesMoney(me("admin")), true);
  assert.equal(M.canStatus(me("lead")), false);
  assert.equal(M.canNote(me("accountant")), true);
  assert.equal(M.canFlag(me("lead", { active: false })), false);
});

test("cleanFlag: the state, a tidy note of at most 300 characters, a real date", () => {
  assert.deepEqual(M.cleanFlag("blocked", "  waiting on\n the permit ", ""), { state: "blocked", note: "waiting on the permit", due_date: null });
  assert.equal(M.cleanFlag("important", "x".repeat(400), "2026-10-30").note.length, 300);
  assert.throws(() => M.cleanFlag("urgent", "x"), /not an item flag/);
  assert.throws(() => M.cleanFlag("important", "x", "10/30/2026"), /must be a date/);
  assert.equal(M.cleanFlag("complete").note, null);
});

test("followUpMail: the project, the item and when it was asked - no amount", () => {
  const m = M.followUpMail({ number: "A267", name: "Sandbox", address: "1 Test Way", city: "Sandbox" }, { name: "Interior walls" },
    { vendor: "Marlow Concrete", requestedDate: "2026-09-25", amount: 1200 });
  assert.match(m.subject, /A267 Sandbox — Interior walls/);
  assert.match(m.body, /Hello Marlow Concrete/);
  assert.ok(!/1200|1,200|\$/.test(m.subject + m.body));
  // an amount typed into the item's name never goes to the vendor
  const t = M.followUpMail({ number: "A267", name: "Sandbox", address: "1 Test Way" }, { name: "Interior walls 2x4 (yard said $4.10 a stud)" },
    { vendor: "Marlow Concrete", requestedDate: "2026-09-25" });
  assert.ok(!/\$\s?\d|4\.10/.test(t.subject + t.body), t.subject + " | " + t.body);
  assert.match(t.subject, /Interior walls 2x4 \(yard said \(amount hidden\) a stud\)/);
});

/* ── the engine ── */
test("Desktop 2's status-to-milestone map: every status lands on its milestone; on hold is history only", () => {
  const want = {
    new_request: { done: [1], current: 2 }, estimating: { done: [1, 2], current: null }, sent: { done: [1, 2, 3], current: 4 },
    follow_up: { done: [1, 2, 3, 4], current: 5 }, approved: { done: [1, 2, 3, 4, 5], current: null }, in_progress: { done: [1, 2, 3, 4, 5], current: null },
    completed: { done: [1, 2, 3, 4, 5, 6, 7], current: null }, closed: { done: [1, 2, 3, 4, 5, 6, 7], current: null },
  };
  for (const [status, w] of Object.entries(want)) {
    const m = C.derive({ project: { status }, items: [], quotes: [], today: TODAY, pricesHidden: true, moneyHidden: true });
    assert.deepEqual(m.milestones.filter((x) => x.done).map((x) => x.n), w.done, status);
    assert.deepEqual(m.milestones.filter((x) => x.current).map((x) => x.n), w.current ? [w.current] : [], status);
    assert.equal(m.known, true);
  }
  const hold = C.derive({ project: { status: "on_hold" }, items: [], today: TODAY, statusDates: { estimating: "2026-09-05", sent: "2026-09-12" } });
  assert.equal(hold.onHold, true);
  assert.equal(hold.known, false);
  assert.deepEqual(hold.milestones.filter((x) => x.done).map((x) => x.n), [1, 3, 4], "reached before the hold");
  assert.equal(hold.pulseAt, null);
  assert.equal(C.NEXT_STATUS.sent, "approved");
  assert.equal(C.NEXT_STATUS.in_progress, "completed");
});

test("the chart for someone with prices and financials: every tile, amounts in the chips, the money states", () => {
  const m = C.derive(M.toPayload(rows(), everything), { expandedA: true, expandedB: true });
  assert.equal(m.showMoney, true);
  assert.equal(m.bNodes.length, 6);
  // the milestone dates: created, then the day it last moved to each status (no row for new_request: created so)
  assert.deepEqual(m.milestones.map((x) => x.date), ["9/1/26", "", "9/5/26", "9/12/26", "", "9/20/26", ""]);
  const lane = (id) => m.lanes.find((l) => l.itemId === id);
  // floor: awarded, billed, approved, paid in full, flagged complete
  assert.deepEqual(["B1", "B2", "B3", "B4"].map((k) => lane(100).nodes[k].s), ["done", "done", "done", "done"]);
  assert.equal(lane(100).nodes.B1.chip, "$9.2k Kestrel");
  assert.equal(lane(100).pctB, 100);
  // the change order billed past its agreed price (the bill reaches the lane through its quote)
  assert.equal(lane(103).nodes.B2.s, "attention");
  assert.match(lane(103).nodes.B2.chip, /over$/);
  assert.equal(lane(103).nodes.B4.s, "attention", "approved, unpaid, past due");
  // money in: the main estimate's invoice is past due; the change order's is paid
  assert.equal(lane(101).nodes.B5.chip, "A267-01");
  assert.equal(lane(101).nodes.B6.s, "attention");
  assert.equal(lane(103).nodes.B6.s, "done");
  assert.equal(m.unlinkedQuotes.length, 1);
  assert.equal(m.unlinkedBills.length, 1);
  assert.equal(m.unassignedCosts, 86.4);
  assert.equal(m.totals.estimate, 9150 + 27000.5 + 0 + 1450);
  const svg = C.svg(m, C.layout(m, {}), {});
  assert.match(svg, /\$9\.2k/);
  assert.match(svg, /data-pm="lane:i100:B4"/);
});

test("the money tiles: a voided payment (the check register's Void) is paid against nothing - the bill is owed again", () => {
  const b = M.toBill({ id: 60, vendor_name: "Made-up Framing", amount: 1000, approved_at: "2026-10-01T17:00:00Z", approved_amount: 1000,
    payments: [{ amount: 1000, voided_at: "2026-10-06T17:00:00Z" }, { amount: 250, voided_at: null }, { amount: 100 }] }, { nameOf });
  assert.deepEqual([b.paid, b.owed], [350, 650]);
  const all = M.toPayload(rows({ bills: [{ id: 61, amount: 500, approved_at: "2026-10-01T17:00:00Z", approved_amount: 500, document_file_id: 3,
    payments: [{ amount: 500, voided_at: "2026-10-06T17:00:00Z" }] }] }), everything);
  assert.deepEqual([all.bills[0].paid, all.bills[0].owed], [0, 500]);
});

test("the quote chase clock runs from the last follow-up, on the company day; a declined or received quote is answered", () => {
  const base = M.toPayload(rows(), everything);
  const lane = (m) => m.lanes.find((l) => l.itemId === 102);
  // requested 9/25, chased 10/2: 19 days on 10/21 -> asks about it
  let m = C.derive(base, {});
  assert.equal(lane(m).nodes.A0.s, "attention");
  assert.equal(lane(m).nodes.A0.chip, "1 sent · chased · 19d");
  assert.equal(lane(m).attention, true);
  // chased again on 10/15: quiet again
  m = C.derive(Object.assign({}, base, { quotes: base.quotes.map((q) => q.id === 2 ? Object.assign({}, q, { lastFollowUp: "2026-10-15", followUps: 2 }) : q) }), {});
  assert.equal(lane(m).nodes.A0.s, "done");
  assert.equal(lane(m).nodes.A0.chip, "1 sent · chased ×2");
  m = C.derive(Object.assign({}, base, { quotes: base.quotes.map((q) => q.id === 2 ? Object.assign({}, q, { status: "declined" }) : q) }), {});
  assert.equal(lane(m).nodes.A1.s, "done");
  // "today" is the payload's (company) day, never the machine's
  m = C.derive(Object.assign({}, base, { today: "2026-10-10" }), {});
  assert.equal(lane(m).nodes.A0.s, "done");
});

test("flags: complete reads every stage done; blocked and important ask for attention; the badges are drawn", () => {
  const m = C.derive(M.toPayload(rows(), nothing), { expandedA: true, expandedB: true });
  const floor = m.lanes.find((l) => l.itemId === 100);
  assert.equal(floor.pctA, 100);
  assert.equal(floor.pctB, 100);
  assert.equal(floor.attention, false);
  // complete closes the item's own steps with no stale chip; the client's money (B5 / B6) is not the flag's
  const full = C.derive(M.toPayload(rows(), everything), { expandedA: true, expandedB: true });
  const f2 = full.lanes.find((l) => l.itemId === 100);
  assert.equal(f2.nodes.B6.s, "attention", "the estimate's invoice A267-01 is overdue: a complete flag does not tick it");
  assert.equal(f2.nodes.B6.chip, "overdue");
  assert.ok(["A0", "A1", "A2", "B1", "B2", "B3", "B4"].every((k) => f2.nodes[k].s === "done" || f2.nodes[k].s === "skipped" || f2.nodes[k].s === "na"));
  const forced = C.derive(M.toPayload(rows({ quotes: rows().quotes.map((q) => q.id === 1 ? Object.assign({}, q, { status: "requested", received_date: null,
    requested_date: "2026-09-01" }) : q) }), everything), {}).lanes.find((l) => l.itemId === 100);
  assert.equal(forced.nodes.A0.s, "done");
  assert.equal(forced.nodes.A0.chip, "", "a step closed by the flag drops the chip of its old state (\"1 sent · 50d\")");
  const walls = m.lanes.find((l) => l.itemId === 101);
  assert.equal(walls.attention, true);
  const svg = C.svg(m, C.layout(m, {}), {});
  assert.match(svg, />DONE</);
  assert.match(svg, /⚑ OVERDUE/, "due 10/19, today 10/21");
  const blocked = C.derive(Object.assign(M.toPayload(rows(), nothing), {}), {});
  assert.ok(blocked.attentionCount >= 1);
});

test("without prices: no money tile is drawn and no amount reaches the model or the drawing (acceptance check 1)", () => {
  // even a payload that wrongly carried amounts: the engine ignores them when prices are hidden
  const leaky = M.toPayload(rows(), everything);
  leaky.pricesHidden = true;
  leaky.moneyHidden = true;
  for (const [p, isLeaky] of [[M.toPayload(rows(), nothing), false], [leaky, true]]) {
    const m = C.derive(p, { expandedA: true, expandedB: true });
    assert.equal(m.showMoney, false);
    assert.deepEqual(m.bNodes.map((d) => d.key), ["B1"]);
    assert.equal(m.totals.estimate, null);
    assert.equal(m.totals.awarded, null);
    for (const l of m.lanes) {
      assert.equal(l.estTotal, null);
      assert.equal(l.awarded, null);
      for (const k of Object.keys(l.nodes)) assert.ok(!/\$/.test(l.nodes[k].chip), k + " " + l.nodes[k].chip);
    }
    assert.ok(!/\$\d/.test(m.regions.humanB));
    for (const opts of [{}, { compact: true }, { compact: true, labels: false }]) {
      const svg = C.svg(m, C.layout(m, opts), {});
      // the proper payload's typed words are masked too; the leaky one shows that no AMOUNT comes from the data
      if (!isLeaky) assert.ok(!/\$\s?\d/.test(svg), "no $ in the drawing");
      assert.ok(!/9150|9,150|9\.2k|27000|1450/.test(svg), "no amount in any form");
    }
    // the awarded vendor is still shown (Q11: they see that a quote exists)
    assert.equal(m.lanes.find((l) => l.itemId === 100).nodes.B1.chip, "Kestrel");
    assert.equal(m.lanes.find((l) => l.itemId === 101).nodes.B1.chip, "Self");
  }
});

test("execution without the money switches: the award is a quarter; a completed project is done", () => {
  const p = M.toPayload(rows({ flags: [] }), nothing);
  let m = C.derive(p, {});
  assert.equal(m.lanes.find((l) => l.itemId === 100).pctB, 25);
  m = C.derive(Object.assign({}, p, { project: Object.assign({}, p.project, { status: "completed" }) }), {});
  assert.equal(m.lanes.find((l) => l.itemId === 100).pctB, 100);
  assert.equal(m.lanes.find((l) => l.itemId === 102).pctB, 0, "nothing awarded there");
});

test("layout: the regions and node columns follow the tiles drawn; laneStatus words", () => {
  const all = C.derive(M.toPayload(rows(), everything), { expandedA: true, expandedB: true });
  const few = C.derive(M.toPayload(rows(), nothing), { expandedA: true, expandedB: true });
  assert.equal(C.layout(all, {}).nodeX.B.length, 6);
  assert.equal(C.layout(few, {}).nodeX.B.length, 1);
  assert.ok(C.layout(all, {}).W > C.layout(few, {}).W);
  const l = (m, id) => m.lanes.find((x) => x.itemId === id);
  assert.equal(C.laneStatus(l(all, 100), true), "Complete");
  assert.equal(C.laneStatus(l(few, 103), false), "In progress");
  assert.equal(C.laneStatus(l(few, 102), false), "Bidding");
  assert.equal(C.daysBetween("2026-10-02", TODAY), 19);
  assert.equal(C.fmtDay("2026-10-02"), "10/2/26");
  assert.equal(C.money(12147.5), "$12,147.50");
  assert.equal(C.money(12147.5, true), "$12k");
  assert.equal(C.esc('<a href="x">'), "&lt;a href=&quot;x&quot;&gt;");
});
