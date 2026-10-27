// P5a (estimates, change orders, takeoffs; BLUEPRINT 3.3.11, P5 acceptance check 1): the pure modules
// (site/js/map/estimates.js, map/takeoffs.js, pages/est-render.js) and repo/estimates.js over the DEMO database
// (tools/fake/p5a-est.js: M5a's estimate_print / takeoff_print with their rules), as every demo account — a
// person without prices is never sent an amount (no money key, typed amounts scrubbed), on screen or on paper.
// tools/schema-check.mjs runs the same repo module against the real migrations. Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as est from "../site/js/map/estimates.js";
import * as tko from "../site/js/map/takeoffs.js";
import * as repo from "../site/js/repo/estimates.js";
import { estimateSheetHtml, takeoffSheetHtml, estimateCardsHtml, takeoffCardsHtml, contractStripHtml, plain } from "../site/js/pages/est-render.js";

const skip = !available && "the demo database (tools/fake) is not here";
const SANDBOX = 268;   // A267, the sandbox project
const COMPANY = { name: "DCR Framing", legalName: "DCR Framing LLC", logo: "icons/logo.jpg" };
// every key that carries money (or the words only printed with prices) in M5a's answers; "prices" may only be the
// answer's own true / false and "totals" only {men_hours}
const MONEY_KEYS = ["labor", "material", "total", "labor_total", "material_total", "labor_per_area", "material_per_area", "contract",
  "client_notes", "unit_price", "line_total", "subtotal", "amount", "labor_rate", "labor_unit_price", "material_unit_price",
  "quoted_price", "tax", "tax_rate"];
const DOLLARS = /\$\s?\d/;

/* ── exact money ────────────────────────────────────────────────────── */

test("cents: the database's decimal text, half away from zero; never binary floating point", () => {
  assert.equal(est.toCents(1.005), 101);
  assert.equal(est.toCents("1,200.5"), 120050);
  assert.equal(est.toCents(-2.345), -235);
  assert.equal(est.toCents(13092), 1309200);
  assert.equal(est.toCents(null), null);
  assert.equal(est.toCents("abc"), null);
  assert.equal(est.mulCents(64, 48.75), 312000);
  assert.equal(est.mulCents(0.333, 3.33), 111);
  assert.equal(est.mulCents("1.5", null), 0);
  assert.equal(est.pctOfCents(1274160, 8), 101933, "8 % of $12,741.60 = $1,019.33 (the takeoff_print tax)");
  assert.equal(est.pctOfCents(1001, 8.25), 83);
  assert.equal(est.pctOfCents(1001, -5), 0, "a negative rate is no tax");
  assert.equal(est.moneyText(123456), "$1,234.56");
  assert.equal(est.moneyText(-1200), "-$12.00");
  assert.equal(est.moneyText(0, true), "—");
  assert.equal(est.moneyText(0), "$0.00");
  assert.equal(est.moneyText(null), "");
  assert.equal(est.qtyText(1200), "1,200");
  assert.equal(est.qtyText(12.5), "12.5");
  assert.equal(est.qtyText(0), "", "a zero quantity prints blank (not an order for none)");
  assert.equal(est.qtyText(0, false), "0");
  assert.equal(est.qtyText("1.0005"), "1.001");
  assert.equal(est.qtyText(null), "");
  assert.equal(est.pctText(8), "8%");
  assert.equal(est.pctText("8.25"), "8.25%");
});

test("words: the crew line (screen and paper), labels, names, status, list order", () => {
  assert.equal(est.crewText({ labor_guys: 1, labor_days: 1 }), "1 guy × 1 day · 8 men-hours");
  assert.equal(est.crewText({ labor_guys: 4, labor_days: 2.5 }), "4 guys × 2.5 days · 80 men-hours");
  assert.equal(est.crewText({ labor_guys: 4 }), "4 guys × 0 days", "shown when either is set (est_logic.crew_text)");
  assert.equal(est.crewText({}), "");
  assert.equal(est.crewPrint({ labor_guys: 4 }), "", "printed only when both are set (printing/estimates.py)");
  assert.equal(est.crewPrint({ labor_guys: 2, labor_days: 1 }), "2 guys × 1 day");
  assert.equal(est.estimateLabel({ kind: "estimate", number: 3 }), "Estimate #3");
  assert.equal(est.estimateLabel({ kind: "change_order", number: 4, co_number: 2 }), "Change Order #2");
  assert.equal(est.estimateName({ kind: "change_order", co_number: 2, name: "  Covered   porch " }), "CO #2 — Covered porch");
  assert.equal(est.estimateName({ kind: "estimate", number: 5, name: "" }), "Estimate #5");
  assert.equal(est.estimateTitle({ kind: "estimate", number: 5, name: "Framing" }), "Framing");
  assert.equal(est.statusText("approved"), "Approved");
  assert.equal(est.statusText("weird"), "Draft");
  const order = [{ id: 9, kind: "change_order", co_number: 2, number: 4 }, { id: 2, kind: "estimate", number: 2 },
    { id: 7, kind: "change_order", co_number: 1, number: 3 }, { id: 1, kind: "estimate", number: 1 }].sort(est.estimateOrder).map((e) => e.id);
  assert.deepEqual(order, [1, 2, 7, 9], "estimates by number, then change orders by CO number");
});

const PRICED = {
  prices: true,
  estimate: { id: 1, kind: "estimate", number: 1, name: "Main", status: "approved", client_notes: "Good for 30 days ($2,500 allowance)" },
  groups: [
    { key: "walls", name: "Walls", title: "Walls", code: "06.11.00", total: 100.5,
      items: [{ id: 11, name: "Walls", notes: "yard $6.85", totals: { labor: 80, material: 20.5, total: 100.5 } }] },
    { key: "", name: "", title: "General", code: "", total: 0.1,
      items: [{ id: 12, name: "Cleanup", totals: { labor: 0.1, material: 0, total: 0.1 } }] },
  ],
  totals: { men_hours: 8, labor: 80.1, material: 20.5, total: 100.6 },
};
const PRICELESS = {
  prices: false,
  estimate: { id: 1, kind: "estimate", number: 1, name: "Main", status: "approved" },
  groups: [{ key: "walls", name: "Walls", title: "Walls", code: "06.11.00", items: [{ id: 11, name: "Walls", description: "credit of [amount]" }] }],
  totals: { men_hours: 8 },
};

test("fromEstimatePrint: the database's answer shaped; money in cents only when it was sent; flags by item", () => {
  const flags = est.flagsByItem([{ item_id: 11, state: "blocked", note: "trusses late" }, { item_id: 99, state: "complete" }]);
  const a = est.fromEstimatePrint(PRICED, flags);
  assert.equal(a.label, "Estimate #1");
  assert.equal(a.statusText, "Approved");
  assert.deepEqual(a.groups.map((g) => [g.title, g.label, g.code]), [["Walls", "Walls", "06.11.00"], ["General", "(no group)", ""]]);
  assert.deepEqual(a.items.map((i) => i.money), [{ labor: 8000, material: 2050, total: 10050 }, { labor: 10, material: 0, total: 10 }]);
  assert.deepEqual(a.total, { labor: 8010, material: 2050, total: 10060 }, "the cents add up exactly");
  assert.equal(a.priced, true);
  assert.equal(a.items[0].flags[0].state, "blocked");
  assert.equal(a.contract, null);
  const b = est.fromEstimatePrint(PRICELESS, {});
  assert.equal(b.priced, false);
  assert.equal(b.total, null);
  assert.equal(b.items[0].money, null);
  assert.equal(est.moneyShown(true, [b]), false, "a row without money never prints as $0.00");
  assert.equal(est.moneyShown(false, [a]), false);
  assert.equal(est.moneyShown(true, [a]), true);
  const co = est.fromEstimatePrint(Object.assign({}, PRICED, { estimate: { id: 3, kind: "change_order", co_number: 1, number: 3, status: "approved" },
    contract: { original: 63196.16, previous: 0, this: 1682.9, new_total: 64879.06 } }), {});
  assert.deepEqual(co.contract, { original: 6319616, previous: 0, self: 168290, newTotal: 6487906 });
});

test("contract summary (the Estimate tab's strip): estimates not declined + approved change orders; pending apart; archived never; no money -> counts only", () => {
  const e = (id, kind, status, total, extra) => Object.assign({ id, kind, status, total: total === null ? null : { labor: 0, material: 0, total } }, extra || {});
  const list = [e(1, "estimate", "approved", 100000), e(2, "estimate", "sent", 5000), e(3, "estimate", "declined", 999),
    e(4, "change_order", "approved", 1500), e(5, "change_order", "draft", 700), e(6, "change_order", "declined", 50),
    e(7, "estimate", "approved", 1, { archived_at: "2026-10-01T00:00:00Z" })];
  assert.deepEqual(est.contractSummary(list), { money: { original: 105000, approved: 1500, pending: 700, contract: 106500 },
    estimates: 2, approvedCount: 1, pendingCount: 1 });
  const hidden = est.contractSummary(list.map((x) => Object.assign({}, x, { total: null })));
  assert.equal(hidden.money, null);
  assert.equal(hidden.estimates, 2);
  assert.deepEqual(est.pickForPrint(list, "all").map((x) => x.id), [1, 2, 3, 4, 5, 6], "every estimate that counts (archived left out)");
  assert.deepEqual(est.pickForPrint(list, "7").map((x) => x.id), [7], "one asked for by id, archived or not");
  assert.deepEqual(est.pickForPrint(list, "42"), []);
  assert.deepEqual(est.itemFlags({ flags: [{ state: "complete" }, { state: "x" }, { state: "blocked" }] }).map((f) => f.state), ["blocked", "complete"]);
});

/* ── takeoffs ───────────────────────────────────────────────────────── */

test("takeoff groups: group (the level) -> category -> sub-category in the order the first row comes (sort, then id); names any case; blanks their own group", () => {
  const rows = [
    { id: 5, sort: 3, level: "Roof", category: "", subcategory: "" },
    { id: 1, sort: 1, level: "Main Level", category: "Walls", subcategory: "Exterior" },
    { id: 2, sort: 2, level: "main level", category: "walls", subcategory: "Interior" },
    { id: 9, sort: null, level: "", category: "", subcategory: "" },
    { id: 4, sort: 2, level: "Main Level", category: "Floor", subcategory: "" },
  ];
  const lv = tko.takeoffLevels(rows);
  assert.deepEqual(lv.map((l) => l.name), ["Main Level", "Roof", ""]);
  assert.deepEqual(lv[0].children.map((c) => c.name), ["Walls", "Floor"]);
  assert.deepEqual(lv[0].children[0].children.map((s) => s.name), ["Exterior", "Interior"]);
  assert.deepEqual(tko.allRows(lv[0]).map((r) => r.id), [1, 2, 4]);
  assert.equal(tko.levelName(""), "(no group)", "owner 2026-10-27: a line's group is its level");
  assert.equal(tko.levelName("Roof"), "Roof");
  assert.equal(tko.categoryBand(lv[1].children[0]), false, "a blank category with no named sub-category draws no band");
  assert.equal(tko.categoryBand({ name: "", children: [{ name: "Exterior" }] }), true);
});

test("takeoff groups in the takeoff's group order (migration 20261029000200): listed first in that order (tidy, any case; \"\" = no group), the rest by their first row; a listed group with no line is not drawn", () => {
  const rows = [
    { id: 1, sort: 1, level: "Main Level", category: "Walls" },
    { id: 2, sort: 2, level: "Roof" },
    { id: 3, sort: 3, level: "" },
    { id: 4, sort: 4, level: "Garage" },
    { id: 5, sort: 5, level: "main  level", category: "Floor" },
    { id: 6, sort: 6, level: "Deck" },
  ];
  assert.deepEqual(tko.takeoffLevels(rows).map((l) => l.name), ["Main Level", "Roof", "", "Garage", "Deck"], "no order: first appearance");
  assert.deepEqual(tko.takeoffLevels(rows, []).map((l) => l.name), ["Main Level", "Roof", "", "Garage", "Deck"]);
  const lv = tko.takeoffLevels(rows, ["ROOF", "", "Empty group", " main   LEVEL "]);
  assert.deepEqual(lv.map((l) => l.name), ["ROOF", "", "main LEVEL", "Garage", "Deck"], "listed first, in the order's order and spelling (tidy); the others by first row");
  assert.deepEqual(tko.allRows(lv[2]).map((r) => r.id), [1, 5], "'main  level' is the same group (tidy, any case)");
  assert.deepEqual(lv[2].children.map((c) => c.name), ["Walls", "Floor"], "an older line's category still bands");
  assert.equal(tko.groupKey("  Main \t Level "), "main level");
  assert.deepEqual(tko.takeoffLevels(rows, "nonsense").map((l) => l.name), ["Main Level", "Roof", "", "Garage", "Deck"], "not a list: no order");
  const t = tko.fromTakeoffPrint({ prices: false, takeoffs: [{ takeoff: { id: 3, group_order: ["Deck", "Garage"] }, rows }] });
  assert.deepEqual(t.takeoffs[0].levels.map((l) => tko.levelName(l.name)), ["Deck", "Garage", "Main Level", "Roof", "(no group)"]);
  assert.deepEqual(t.takeoffs[0].group_order, ["Deck", "Garage"], "the order stays on the takeoff");
  const old = tko.fromTakeoffPrint({ prices: false, takeoffs: [{ takeoff: { id: 3 }, rows }] });
  assert.deepEqual(old.takeoffs[0].levels.map((l) => l.name), ["Main Level", "Roof", "", "Garage", "Deck"], "a database before the migration: first appearance");
});

test("fromTakeoffPrint: rows by sort, newest takeoff first, prices only when the database sent them; quote totals as the database's", () => {
  const answer = {
    prices: true, project: { id: 268 },
    takeoffs: [
      { takeoff: { id: 1, name: "Main", takeoff_date: "2026-09-26" }, item: null, subtotal: 13.7,
        rows: [{ id: 2, sort: 2, qty: 3, unit_price: 1.5, line_total: 4.5 }, { id: 1, sort: 1, qty: 2, unit_price: 4.6, line_total: 9.2 }] },
      { takeoff: { id: 2, name: "Deck", takeoff_date: "2026-10-16" }, item: { id: 7, name: "Deck framing", estimate_label: "Estimate #2" }, rows: [] },
    ],
    totals: { subtotal: 13.7, tax_rate: 8.25, tax: 1.13, total: 14.83 },
  };
  const t = tko.fromTakeoffPrint(answer);
  assert.equal(t.prices, true);
  assert.equal(t.taxRate, 8.25);
  assert.deepEqual(t.takeoffs.map((x) => x.id), [2, 1], "newest first");
  const main = t.takeoffs[1];
  assert.deepEqual(main.rows.map((r) => r.id), [1, 2]);
  assert.deepEqual(main.rows[0].prices, { unit_price: 4.6, line_total: 9.2 });
  assert.ok(!("unit_price" in main.rows[0]), "the price lives under prices");
  assert.equal(tko.rowTotal(main.rows[0]), 920);
  assert.deepEqual(tko.quoteTotals(main.rows, t.taxRate), { subtotal: 1370, ratePct: 8.25, tax: 113, total: 1483 });
  assert.equal(main.priced, true);
  const none = tko.fromTakeoffPrint({ prices: false, takeoffs: [{ takeoff: { id: 1 }, rows: [{ id: 1, qty: 3 }] }] });
  assert.equal(none.taxRate, null);
  assert.equal(none.takeoffs[0].rows[0].prices, undefined);
  assert.equal(none.takeoffs[0].priced, false);
  assert.equal(tko.unitPrice(none.takeoffs[0].rows[0]), null);
  assert.equal(tko.rowItemName({ item_name: " ", material_code: "LB-268" }), "LB-268");
});

/* ── the repo over the demo database, as each account ───────────────── */

/** a client that records what was asked and what came back */
function recording(engine, uid) {
  const c = clientAs(engine, uid);
  const log = [];
  const wrap = (p, what) => p.then((res) => { log.push({ what, data: res.data, error: res.error }); return res; });
  return {
    log,
    client: {
      from(t) {
        const q = c.from(t);
        const then = q.then.bind(q);
        q.then = (ok, bad) => wrap(then((r) => r), "from:" + t).then(ok, bad);
        return q;
      },
      rpc: (name, args) => wrap(c.rpc(name, args), "rpc:" + name),
      storage: c.storage,
    },
  };
}

function keysDeep(v, out) {
  out = out || new Set();
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") Object.keys(v).forEach((k) => { out.add(k); keysDeep(v[k], out); });
  return out;
}

test("listEstimates / listTakeoffs: a person WITHOUT prices is sent no amount at all — no money key, typed amounts scrubbed, no price table read", { skip }, async () => {
  const e = await freshEngine();
  // "manager" stays a manager WITHOUT the Estimator switch (20261028000100): the read-only tab, as before; the
  // no-price Estimator's editor reads are tests/p7-est-edit-repo.test.mjs's
  for (const key of ["manager", "lead", "field", "viewer"]) {
    const p = await person(key);
    const r = recording(e, p.id);
    useClient(r.client);
    const res = await repo.listEstimates(SANDBOX, { archived: true });
    const tk = await repo.listTakeoffs(SANDBOX);
    assert.equal(res.prices, false, key);
    assert.equal(tk.prices, false, key);
    assert.ok(res.estimates.length >= 5, key + ": every live estimate, archived too when asked");
    assert.ok(res.estimates.every((x) => x.total === null && x.items.every((i) => i.money === null)), key + ": no money");
    const asked = r.log.map((l) => l.what);
    assert.ok(asked.every((w) => /^(from:estimates|from:estimate_item_flags|rpc:estimate_print|rpc:takeoff_print)$/.test(w)), key + " asked only " + [...new Set(asked)].join(", "));
    for (const l of r.log) {
      const keys = keysDeep(l.data);
      const money = MONEY_KEYS.filter((k) => keys.has(k));
      assert.deepEqual(money, [], key + " " + l.what + " carried " + money.join(", "));
      if (l.data && !Array.isArray(l.data) && "prices" in l.data) {
        assert.equal(l.data.prices, false, key + " " + l.what + ": the database says no prices");
        assert.deepEqual(Object.keys(l.data.totals || {}).filter((k) => k !== "men_hours"), [], key + " " + l.what + ": totals carry only the men-hours");
      }
      assert.ok(!JSON.stringify(l.data).includes('"prices":{'), key + " " + l.what + ": a price row");
      // an estimate item's notes are its internal pricing notes: only with prices (a takeoff's notes are scrubbed words)
      if (l.what === "rpc:estimate_print") assert.ok(!keys.has("notes"), key + ": an item's internal notes");
      assert.ok(!DOLLARS.test(JSON.stringify(l.data)), key + " " + l.what + ": a typed amount reached the browser");
    }
    const words = JSON.stringify(res.estimates);
    assert.ok(words.includes("[amount]"), key + ": the typed amounts read [amount] (the database scrubbed them)");
  }
});

test("listEstimates / listTakeoffs: a person WITH prices gets the database's money; the change order's contract; the tax rate", { skip }, async () => {
  const e = await freshEngine();
  for (const key of ["admin", "manager_prices", "accountant"]) {
    const p = await person(key);
    useClient(clientAs(e, p.id));
    const res = await repo.listEstimates(SANDBOX);
    assert.equal(res.prices, true, key);
    assert.deepEqual(res.estimates.map((x) => x.label), ["Estimate #1", "Estimate #2", "Change order #1", "Change order #2"], key + ": archived and deleted left out, list order");
    const main = res.estimates[0];
    assert.equal(main.priced, true);
    assert.deepEqual(main.groups.map((g) => g.title), ["Floor system", "Walls", "Roof", "General"], "the office's group order, then the unnamed group");
    assert.equal(main.groups[1].items.length, 2, "'Walls' and '  walls ' are one group");
    assert.deepEqual(main.items[0].money, { labor: 950400, material: 358800, total: 1309200 }, "4 guys x 3 days x 8 x $90 x 1.10 + 64 x $48.75 x 1.15");
    assert.equal(main.total.total, main.items.reduce((s, i) => s + i.money.total, 0));
    assert.ok(main.client_notes && DOLLARS.test(main.client_notes), "the terms, as typed, for people with prices");
    const co = res.estimates[2];
    assert.equal(co.contract.original, main.total.total, "original contract = the approved estimate");
    assert.equal(co.contract.newTotal, co.contract.original + co.contract.previous + co.contract.self);
    const tk = await repo.listTakeoffs(SANDBOX);
    assert.equal(tk.prices, true);
    assert.equal(Number(tk.taxRate), 8);
    const t1 = tk.takeoffs.find((t) => t.name === "Main house framing");
    assert.equal(t1.lines, 10);
    assert.equal(t1.priced, true);
    assert.equal(tko.quoteTotals(t1.rows, tk.taxRate).subtotal, 1274160);
  }
});

test("listEstimates: archived only on request (counted always); deleted never; the agents account reads nothing", { skip }, async () => {
  const e = await freshEngine();
  useClient(clientAs(e, (await person("lead")).id));
  const a = await repo.listEstimates(SANDBOX);
  assert.equal(a.archived, 1);
  assert.ok(!a.estimates.some((x) => x.archived));
  const b = await repo.listEstimates(SANDBOX, { archived: true });
  assert.ok(b.estimates.some((x) => x.archived && /superseded/.test(x.name)));
  assert.ok(!b.estimates.some((x) => /Deleted/.test(x.name)), "a deleted estimate is never read");
  const agents = clientAs(e, (await person("agents")).id);
  useClient(agents);
  const c = await repo.listEstimates(SANDBOX);
  assert.deepEqual(c.estimates, []);
  const r = await agents.rpc("estimate_print", { p_estimate_id: 1 });
  assert.equal(r.error.code, "42501", "is_active() refuses the agents account");
  const t = await agents.rpc("takeoff_print", { p_takeoff_id: null, p_project_id: SANDBOX });
  assert.equal(t.error.code, "42501");
});

/* ── the HTML: never an amount for a person without prices ───────────── */

test("printed estimate: the worksite copy has no amount, no total, no terms, no signature line; the full copy adds them up", { skip }, async () => {
  const e = await freshEngine();
  const project = { internalIDNumber: "A267", projectName: "Sandbox — test project", projectAddress: "1 Test Way", projectCity: "Sandbox" };
  useClient(clientAs(e, (await person("lead")).id));
  const lead = (await repo.listEstimates(SANDBOX)).estimates;
  const w = estimateSheetHtml(project, est.pickForPrint(lead, "all"), { show: est.moneyShown(false, lead), company: COMPANY, date: "2026-10-21" });
  assert.ok(w.html.includes(est.WORKSITE_TAG));
  assert.ok(!DOLLARS.test(w.html), "no dollar amount on the worksite copy");
  assert.ok(!/GRAND TOTAL|Terms &amp; notes|Client signature/.test(w.html));
  assert.ok(w.html.includes("[amount]"), "the typed amount, scrubbed by the database");
  assert.ok(/4 guys × 3 days/.test(w.html), "the crew and quantities stay: the scope of work");
  useClient(clientAs(e, (await person("admin")).id));
  const all = (await repo.listEstimates(SANDBOX)).estimates;
  const list = est.pickForPrint(all, "all");
  const full = estimateSheetHtml(project, list, { show: est.moneyShown(true, list), company: COMPANY, date: "2026-10-21" });
  const grand = list.reduce((s, x) => s + x.total.total, 0);
  assert.ok(full.html.includes("GRAND TOTAL") && full.html.includes(est.moneyText(grand)));
  assert.ok(full.html.includes("$1,200"), "a person with prices reads the words as typed");
  // a price viewer's own worksite copy: drawn again without money, typed amounts masked
  const mine = estimateSheetHtml(project, list, { show: false, company: COMPANY, date: "2026-10-21" });
  assert.ok(!DOLLARS.test(mine.html));
  assert.ok(mine.html.includes("(amount hidden)"));
  // one change order: the contract figures and the approval
  const co = all.find((x) => x.kind === "change_order" && x.status === "approved");
  const sheet = estimateSheetHtml(project, [co], { show: true, company: COMPANY, date: "2026-10-21" });
  assert.ok(sheet.html.includes("CHANGE ORDER") && sheet.html.includes("NEW CONTRACT TOTAL") && sheet.html.includes("Client approval"));
  assert.ok(sheet.html.includes(est.moneyText(co.contract.newTotal)));
  const coLead = lead.find((x) => x.id === co.id);
  const s2 = estimateSheetHtml(project, [coLead], { show: false, company: COMPANY, date: "2026-10-21" });
  assert.ok(!DOLLARS.test(s2.html) && !/CONTRACT TOTAL/.test(s2.html) && s2.html.includes(est.WORKSITE_TAG));
});

test("every typed word is masked on the worksite copy - levels (takeoff groups), categories, sub-categories, units (review: \"$2,500\" in a group code - no longer drawn at all, owner 2026-10-27); the database scrubs them for a person without prices", { skip }, async () => {
  const e = await freshEngine();
  const project = { internalIDNumber: "A267", projectName: "Sandbox — test project" };
  const it = e.rows.estimate_items.find((x) => x.project_id === SANDBOX && !x.deleted_at && x.group_code);
  it.group_code = "Allowance $2,500";
  const row = e.rows.takeoff_rows.find((x) => x.project_id === SANDBOX);
  Object.assign(row, { level: "L1 $3,100", category: "Walls $1,250", subcategory: "Sub $640", unit: "$12/ea", formula: "=3*$12" });
  for (const key of ["admin", "lead"]) {
    useClient(clientAs(e, (await person(key)).id));
    const ests = (await repo.listEstimates(SANDBOX)).estimates;
    const tks = (await repo.listTakeoffs(SANDBOX)).takeoffs;
    const html = estimateCardsHtml(ests, { show: false, pid: SANDBOX }) + estimateSheetHtml(project, est.pickForPrint(ests, "all"), { show: false, company: COMPANY, date: "2026-10-21" }).html +
      takeoffCardsHtml(tks, { show: false, pid: SANDBOX }) + takeoffSheetHtml(project, tks, { quote: false, company: COMPANY, date: "2026-10-21" }).html;
    assert.ok(!DOLLARS.test(html), key + ": no $ amount on the worksite tab or paper: " + (html.match(/.{40}\$\s?\d.{10}/) || [""])[0]);
    for (const x of ["2,500", "3,100", "1,250"]) assert.ok(!html.includes(x), key + ": " + x);
    assert.ok(!html.includes("Allowance"), key + ": the group code is not drawn (owner 2026-10-27)");
    if (key === "admin") {
      assert.ok(html.includes("L1 (amount hidden)"), "the price person's own worksite copy masks them");
      const full = estimateCardsHtml(ests, { show: true, pid: SANDBOX }) + takeoffCardsHtml(tks, { show: true, pid: SANDBOX });
      assert.ok(full.includes("L1 $3,100") && full.includes("$12/ea"), "with prices: as typed");
      assert.ok(!full.includes("Allowance") && !/class="es-code"/.test(full), "with prices too: no group code");
    } else {
      assert.ok(html.includes("L1 [amount]") && html.includes("[amount]/ea"), "scrubbed by the database");
    }
  }
});

test("the demo's takeoff_print sends each takeoff's group_order (migration 20261029000200): as stored with prices, each name scrubbed without; the tab and the paper draw the groups in it", { skip }, async () => {
  const e = await freshEngine();
  const t1 = e.rows.takeoffs.find((t) => t.project_id === SANDBOX && t.name === "Main house framing");
  t1.group_order = ["Roof", "", "Second Level $900"];
  for (const r of e.rows.takeoff_rows.filter((x) => x.takeoff_id === t1.id && x.level === "Second Level")) r.level = "Second Level $900";
  const project = { internalIDNumber: "A267", projectName: "Sandbox — test project" };
  for (const key of ["admin", "lead"]) {
    useClient(clientAs(e, (await person(key)).id));
    const tk = await repo.listTakeoffs(SANDBOX);
    const t = tk.takeoffs.find((x) => x.id === t1.id);
    const prices = key === "admin";
    assert.deepEqual(t.group_order, prices ? ["Roof", "", "Second Level $900"] : ["Roof", "", "Second Level [amount]"], key + ": the order as the database sends it");
    assert.deepEqual(t.levels.map((l) => tko.levelName(l.name)), ["Roof", "(no group)", prices ? "Second Level $900" : "Second Level [amount]", "Main Level"],
      key + ": listed first in that order, the unlisted after");
    const cards = takeoffCardsHtml([t], { show: prices, pid: SANDBOX });
    const bands = Array.from(cards.matchAll(/<tr class="tk-lvl"><td colspan="\d">([^<]*)<\/td>/g)).map((m) => m[1]);
    assert.deepEqual(bands, ["Roof", "(no group)", prices ? "Second Level $900" : "Second Level [amount]", "Main Level"], key + ": the tab's bands");
    const sheet = takeoffSheetHtml(project, [t], { quote: false, company: COMPANY, date: "2026-10-21" });
    const paper = Array.from(sheet.html.matchAll(/<tr class="ml-lvl"><td colspan="\d">([^<]*)<\/td>/g)).map((m) => m[1]);
    assert.deepEqual(paper, ["Roof", "(no group)", prices ? "Second Level (amount hidden)" : "Second Level [amount]", "Main Level"],
      key + ": the Material List's bands (its words masked; scrubbed by the database without prices)");
    assert.equal(sheet.lines, 10, key + ": every line printed once");
  }
});

test("the printed change order keeps its approval and signature lines together (one Letter page for a short one: the .co-sheet / .co-sign rules)", { skip }, async () => {
  const e = await freshEngine();
  useClient(clientAs(e, (await person("admin")).id));
  const all = (await repo.listEstimates(SANDBOX)).estimates;
  const co = all.find((x) => x.kind === "change_order" && x.status === "approved");
  const sheet = estimateSheetHtml({ internalIDNumber: "A267" }, [co], { show: true, company: COMPANY, date: "2026-10-21" });
  assert.ok(sheet.html.startsWith('<div class="co-sheet">'));
  assert.match(sheet.html, /<div class="co-sign"><table class="tot">.*?NEW CONTRACT TOTAL.*?<\/table><div class="co-two"><div class="terms" contenteditable="true" spellcheck="false">.*?<div class="terms appr"><h4>Client approval<\/h4>.*?<div class="sig">.*?<div class="sig">.*?<div class="sig"><div>[^<]*<\/div><div>Date<\/div><\/div><\/div><div class="foot">/);
  const css = readFileSync(new URL("../site/report-estimate.html", import.meta.url), "utf8");
  assert.match(css, /\.co-sign\{break-inside:avoid/);
  assert.match(css, /table\.tot\{[^}]*break-inside:avoid/);
  assert.match(readFileSync(new URL("../site/report-takeoff.html", import.meta.url), "utf8"), /table\.tot\{[^}]*break-inside:avoid/);
});

test("material list / quote: the list never prices (typed amounts masked even for the office); the quote adds tax; L# runs over the sheet", { skip }, async () => {
  const e = await freshEngine();
  const project = { internalIDNumber: "A267", projectName: "Sandbox — test project" };
  useClient(clientAs(e, (await person("admin")).id));
  const tk = await repo.listTakeoffs(SANDBOX);
  const t1 = tk.takeoffs.filter((t) => t.name === "Main house framing");
  const list = takeoffSheetHtml(project, t1, { quote: false, company: COMPANY, date: "2026-10-21" });
  assert.equal(list.lines, 10);
  assert.ok(!DOLLARS.test(list.html), "the Material List carries no price, not even a typed one");
  assert.ok(list.html.includes("(amount hidden)"));
  assert.ok(/<td class="c-ln">10<\/td>/.test(list.html), "L# 1..10 across the levels");
  const quote = takeoffSheetHtml(project, t1, { quote: true, rate: tk.taxRate, company: COMPANY, date: "2026-10-21" });
  assert.ok(quote.html.includes("Sales tax (8%)") && quote.html.includes("$1,019.33") && quote.html.includes("$13,760.93"));
  assert.ok(quote.html.includes("Subtotal — Main Level"));
  useClient(clientAs(e, (await person("field")).id));
  const f = await repo.listTakeoffs(SANDBOX);
  const fl = takeoffSheetHtml(project, f.takeoffs, { quote: false, company: COMPANY, date: "2026-10-21" });
  assert.ok(!DOLLARS.test(fl.html) && /Material List/.test(fl.html));
});

test("the tabs' HTML: amounts and the money strip only with prices; the worksite tab says prices are hidden", { skip }, async () => {
  const e = await freshEngine();
  useClient(clientAs(e, (await person("viewer")).id));
  const v = (await repo.listEstimates(SANDBOX)).estimates;
  const cards = estimateCardsHtml(v, { show: est.moneyShown(false, v), pid: SANDBOX }) + contractStripHtml(v, false);
  assert.ok(!DOLLARS.test(cards));
  assert.ok(/Hidden/.test(cards) && /report-estimate\.html\?id=268&amp;est=/.test(cards));
  const vt = await repo.listTakeoffs(SANDBOX);
  const tcards = takeoffCardsHtml(vt.takeoffs, { show: false, pid: SANDBOX });
  assert.ok(!DOLLARS.test(tcards) && !/Material quote/.test(tcards));
  useClient(clientAs(e, (await person("manager_prices")).id));
  const m = (await repo.listEstimates(SANDBOX)).estimates;
  const mc = estimateCardsHtml(m, { show: est.moneyShown(true, m), pid: SANDBOX }) + contractStripHtml(m, true);
  assert.ok(DOLLARS.test(mc) && /Contract/.test(mc) && /Subtotal — Walls/.test(mc));
  const mt = await repo.listTakeoffs(SANDBOX);
  assert.ok(/Material quote/.test(takeoffCardsHtml(mt.takeoffs, { show: true, pid: SANDBOX })));
});

test("plain(): pasted markup is text, never live HTML; outer blank lines dropped", () => {
  assert.equal(plain("<b>Walls</b><br>2x6<script>x</script>\n\n"), "Walls\n2x6x");
  assert.equal(plain(null), "");
});

test("the pages: project.html has the Estimate and Takeoffs tabs; the print pages load their own module", () => {
  const html = readFileSync(new URL("../site/project.html", import.meta.url), "utf8");
  assert.ok(/data-tab="estimate"/.test(html) && /data-tab="takeoffs"/.test(html) && /id="pane-estimate"/.test(html) && /id="pane-takeoffs"/.test(html));
  assert.ok(/css\/estimates\.css/.test(html));
  for (const [page, mod] of [["report-estimate.html", "js/pages/report-estimate.js"], ["report-takeoff.html", "js/pages/report-takeoff.js"]]) {
    const src = readFileSync(new URL("../site/" + page, import.meta.url), "utf8");
    assert.ok(src.includes('<script type="module" src="' + mod + '"></script>'), page);
  }
  // the switches a person without prices never sees start hidden (the page shows them only with prices)
  const re = readFileSync(new URL("../site/report-estimate.html", import.meta.url), "utf8");
  assert.ok(/id="rpNoPricesBox" hidden/.test(re) && /id="rpNotesBox" hidden/.test(re));
  const rt = readFileSync(new URL("../site/report-takeoff.html", import.meta.url), "utf8");
  assert.ok(/id="rpQuoteBox" hidden/.test(rt));
});
