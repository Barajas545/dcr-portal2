// P5a: the Progress Chart's data module (site/js/repo/pm.js) over the DEMO database (tools/fake/p5a-est.js +
// p5a-pm.js: M5a's rules - quotes read by everyone, their money in quote_prices behind the prices switch, the item
// flags written by admin / manager / lead with one amount-free log line, quote_follow_up for quote editors, the
// money tables and quote_commitments behind financials). Per role: what is asked for and what comes back - a
// person without prices is never sent an amount column (P5 acceptance check 1). Made-up people and jobs only.
import test from "node:test";
import assert from "node:assert/strict";

import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as pm from "../site/js/repo/pm.js";
import { clearPeople } from "../site/js/repo/people.js";
import * as C from "../site/js/pm-chart.js";

const skip = !available;
const MONEY_TABLES = ["quote_prices", "estimate_item_totals", "estimate_item_prices", "bills", "payments", "invoices", "invoice_lines",
  "client_payments", "costs", "quote_commitments"];
const MONEY_KEYS = ["amount", "total", "labor_total", "material_total", "quoted_price", "unit_price", "approved_amount", "committed",
  "billed", "paid", "document_url", "labor_rate", "material_unit_price"];

/** an engine, the profile row of `key`, and every select it answers recorded */
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
  useClient(clientAs(e, who.id));
  return { e, me, log, uid: who.id };
}
const sandbox = (e) => e.rows.projects.find((p) => p.number === "A267");
const keysIn = (rows) => {
  const out = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.keys(v).forEach((k) => { out.add(k); walk(v[k]); });
  };
  walk(rows);
  return out;
};

test("a lead, a manager without prices, field and view-only: quotes and flags listed, no amount column in any answer", { skip }, async () => {
  const engine = await freshEngine();
  const admin = await as("admin", engine);
  const pricedByAdmin = (await pm.load(sandbox(engine).id, admin.me)).payload.items.map((i) => [i.itemId, i.priced]);
  for (const key of ["lead", "manager", "field", "viewer"]) {
    const { me, log } = await as(key, engine);
    const got = await pm.load(sandbox(engine).id, me);
    const asked = new Set(log.map((x) => x.table));
    for (const t of MONEY_TABLES.filter((x) => x !== "estimate_item_totals")) assert.ok(!asked.has(t), key + " never asks for " + t);
    // estimate_item_totals: only the database's "priced" yes / no (M5a review) - never a money column
    const totals = log.filter((x) => x.table === "estimate_item_totals");
    assert.ok(totals.length === 1 && totals[0].rows.length > 0, key + ": asks for priced");
    assert.deepEqual([...keysIn(totals[0].rows)].sort(), ["item_id", "priced"], key + ": the totals answer carries item_id and priced only");
    assert.deepEqual(got.payload.items.map((i) => [i.itemId, i.priced]), pricedByAdmin, key + ": the same 'priced' as the admin's");
    assert.ok(got.payload.quotes.every((q) => q.notes === ""), key + ": no quote notes (they name the price: quote_prices)");
    const keys = keysIn(log.map((x) => x.rows));
    for (const k of MONEY_KEYS) assert.ok(!keys.has(k), key + ": no '" + k + "' in any answer");
    assert.ok(got.payload.quotes.length >= 8, key + " sees the quotes and change orders (Q11)");
    assert.ok(got.payload.quotes.some((q) => q.kind === "change_order"));
    assert.ok(got.payload.items.some((i) => i.flag && i.flag.state === "blocked"), key + " sees the flags");
    assert.equal(got.payload.pricesHidden, true);
    assert.equal(got.payload.bills, null);
    const m = C.derive(got.payload, { expandedA: true, expandedB: true });
    const svg = C.svg(m, C.layout(m, {}), {});
    assert.ok(!/\$\s?\d/.test(JSON.stringify(got.payload)) && !/\$\s?\d/.test(svg), key + ": no amount on the chart or in the data");
  }
});

test("a manager with prices (no financials): amounts on items and quotes, no money tables", { skip }, async () => {
  const { e, me, log } = await as("manager_prices");
  const got = await pm.load(sandbox(e).id, me);
  const asked = new Set(log.map((x) => x.table));
  assert.ok(asked.has("quote_prices") || log.some((x) => x.table === "quotes" && x.rows.some((r) => r.prices)), "the prices embed");
  assert.ok(asked.has("estimate_item_totals"));
  for (const t of ["bills", "invoices", "costs", "quote_commitments"]) assert.ok(!asked.has(t), t);
  assert.ok(got.payload.quotes.some((q) => q.amount > 0));
  assert.ok(got.payload.items.some((i) => i.estTotal > 0));
  assert.equal(got.payload.moneyHidden, true);
});

test("admin and accountant: the money tables and the commitments roll-up (over-billing reported, never clamped)", { skip }, async () => {
  for (const key of ["admin", "accountant"]) {
    const { e, me } = await as(key);
    const got = await pm.load(sandbox(e).id, me);
    assert.ok(got.payload.bills.length >= 4, key + " bills");
    assert.ok(got.payload.invoices.length >= 2, key + " invoices");
    assert.ok(got.payload.costs.length >= 2, key + " costs");
    const over = got.payload.commitments.find((c) => c.overBilled);
    assert.ok(over && over.overBilledBy > 0 && over.pctBilled > 100, key + ": the change order billed past its price");
    const m = C.derive(got.payload, { expandedA: true, expandedB: true });
    assert.equal(m.showMoney, true);
    assert.ok(m.lanes.some((l) => l.nodes.B3.s === "attention"), "a bill waiting for approval");
    assert.ok(m.lanes.some((l) => l.nodes.B4.s === "attention"), "an approved bill past due");
    assert.ok(m.unlinkedBills.length >= 1 && m.unassignedRows.length >= 1);
  }
});

test("item flags: a lead sets, changes and clears one - by and at are the database's, one amount-free log line each", { skip }, async () => {
  const { e, me, uid } = await as("lead");
  const pid = sandbox(e).id;
  const got = await pm.load(pid, me);
  const lane = got.payload.items.find((i) => !i.flag);
  const before = e.rows.activity.length;
  const made = await pm.setFlag(lane.itemId, "blocked", "  waiting on\nthe permit ", null, null);
  assert.equal(made.state, "blocked");
  assert.equal(made.note, "waiting on the permit");
  assert.equal(made.by, uid);
  assert.ok(made.at);
  assert.equal(made.project_id, pid);
  const lines = e.rows.activity.slice(before);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, "system");
  assert.match(lines[0].text, /^Item ".+" flagged blocked$/);
  const changed = await pm.setFlag(lane.itemId, "important", "Order the hold-downs", "2026-11-02", { version: made.version });
  assert.equal(changed.state, "important");
  assert.equal(changed.due_date, "2026-11-02");
  assert.match(e.rows.activity[e.rows.activity.length - 1].text, /flagged important \(due 2026-11-02\)$/);
  // a stale version: someone changed it since -> PT409 with theirs
  await assert.rejects(() => pm.setFlag(lane.itemId, "complete", null, null, { version: made.version }), (err) => err.code === "PT409" && err.current && err.current.state === "important");
  await assert.rejects(() => pm.clearFlag(lane.itemId, { version: made.version }), (err) => err.code === "PT409");
  assert.equal(await pm.clearFlag(lane.itemId, { version: changed.version }), true);
  assert.equal(e.rows.estimate_item_flags.some((f) => f.item_id === lane.itemId), false);
  assert.match(e.rows.activity[e.rows.activity.length - 1].text, /flag cleared$/);
  assert.equal(await pm.clearFlag(lane.itemId, null), true, "already cleared is cleared");
  // a new flag where someone set one meanwhile -> PT409, not a second flag
  await pm.setFlag(lane.itemId, "complete", null, null, null);
  await assert.rejects(() => pm.setFlag(lane.itemId, "blocked", "x", null, null), (err) => err.code === "PT409");
});

test("item flags: refused for field, view-only and the accountant (M5a item_flags: admin, manager, lead)", { skip }, async () => {
  const engine = await freshEngine();
  for (const key of ["field", "viewer", "accountant"]) {
    const { me } = await as(key, engine);
    const got = await pm.load(sandbox(engine).id, me);
    const free = got.payload.items.find((i) => !i.flag);
    await assert.rejects(() => pm.setFlag(free.itemId, "blocked", "x", null, null), (err) => err.code === "42501", key + " adds none");
    const flagged = got.payload.items.find((i) => i.flag);
    await assert.rejects(() => pm.setFlag(flagged.itemId, "complete", null, null, flagged.flag), (err) => err.code === "42501", key + " changes none");
    await assert.rejects(() => pm.clearFlag(flagged.itemId, flagged.flag), (err) => err.code === "42501", key + " clears none");
  }
  const { me } = await as("manager", engine);
  const got = await pm.load(sandbox(engine).id, me);
  const free = got.payload.items.find((i) => !i.flag);
  assert.equal((await pm.setFlag(free.itemId, "important", "Call the inspector", null, null)).state, "important", "a manager flags");
});

test("quote_follow_up: quote editors only, one more today; PT404 for a quote that is not there", { skip }, async () => {
  const engine = await freshEngine();
  const q = engine.rows.quotes.find((x) => x.status === "requested");
  const today = engine.rows.profiles.length && new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  for (const key of ["manager", "lead", "field"]) {
    await as(key, engine);
    await assert.rejects(() => pm.followUp(q.id), (err) => err.code === "42501", key);
  }
  await as("manager_prices", engine);
  const before = q.follow_ups;
  const r = await pm.followUp(q.id);
  assert.equal(r.follow_ups, before + 1);
  assert.equal(r.last_follow_up, today);
  assert.ok(!("amount" in r), "the quote row back, no money in it");
  await assert.rejects(() => pm.followUp(999999), (err) => err.code === "PT404");
});

test("the agents account reads no quote, flag or price; a project nobody can see is 'not found'", { skip }, async () => {
  const { e } = await as("agents");
  const c = clientAs(e, (await person("agents")).id);
  for (const t of ["quotes", "quote_prices", "estimate_item_flags", "quote_commitments", "bills"]) {
    const r = await c.from(t).select("*");
    assert.deepEqual(r.data || [], [], t);
  }
  const { me } = await as("admin", e);
  await assert.rejects(() => pm.load(987654, me), (err) => err.code === "PT404");
});
