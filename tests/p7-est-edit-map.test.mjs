// The web estimate editor's pure rules (owner 2026-10-24: Q12 reversed; site/js/map/estimate-edit.js): DCR Desktop 2's
// item types (est_logic.py - its tests' cases), the planners (domain/estimate_order.py - tests/test_estimate_order_archive.py's
// cases), the money (domain/estimate_math.py - tests/vectors/estimate-math.json, DCR Desktop 2's
// tools/pglite_check/estimate_math_cases.json), the group names (tests/vectors/group-key.json, group_key_cases.json),
// the money words as the database judges them (tests/vectors/scrub-money.json), what a sheet sends and refuses, and
// the conflict plan (est_save.py). Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../site/js/map/estimate-edit.js";
import { estimateEditor, toCents } from "../site/js/map/estimates.js";

const vec = (f) => JSON.parse(readFileSync(new URL("./vectors/" + f, import.meta.url), "utf8"));
const it = (id, group, sort, code, version, extra) => Object.assign({ id, group_name: group, group_code: code === undefined ? null : code, sort,
  version: version === undefined ? 1 : version, locked: [] }, extra || {});
/** the database's groups (estimate_edit_read: screen order, gids g1, g2 ...) for planner cases */
const slotsFrom = (items, order) => M.groupsInOrder(items, order || []).map((s, i) => ({ gid: "g" + (i + 1), key: s.key, name: s.name, code: s.code,
  locked: false, items: s.items }));
const gidOf = (slots, name) => slots.find((s) => s.key === M.groupKey(name)).gid;

/* ── who gets the editor ─────────────────────────────────────────────── */

test("estimateEditor: an admin, or a manager whose Estimator switch is on - never anyone else, never the agents account", () => {
  assert.equal(estimateEditor({ role: "admin" }, null), true);
  assert.equal(estimateEditor({ role: "manager" }, { can_estimate: true }), true);
  assert.equal(estimateEditor({ role: "manager" }, { can_estimate: false }), false);
  assert.equal(estimateEditor({ role: "manager" }, { can_estimate: false, missing: true }), false, "an older database: read only");
  for (const role of ["lead", "accountant", "field", "viewer", "agents"]) assert.equal(estimateEditor({ role }, { can_estimate: true }), false, role);
  assert.equal(estimateEditor({ role: "admin", active: false }, null), false, "a turned-off account");
  assert.equal(estimateEditor(null, { can_estimate: true }), false);
});

/* ── the item types (est_logic.py) ───────────────────────────────────── */

test("item types: what counts as a value a switch would clear, and what it is cleared to", () => {
  assert.equal(M.holdsValue("material_qty", 1), false, "Qty 1 is the default");
  assert.equal(M.holdsValue("labor_qty", 0), false);
  assert.equal(M.holdsValue("labor_qty", 3), true);
  assert.equal(M.holdsValue("labor_rate", 110), false, "the hourly rate is the project's");
  assert.equal(M.holdsValue("labor_markup_pct", 20), true);
  assert.equal(M.holdsValue("material_area", "0.000"), false);
  assert.equal(M.holdsValue("material_description", "Studs"), true);
  assert.equal(M.holdsValue("description", "   "), false);
  assert.deepEqual([M.clearedValue("material_qty"), M.clearedValue("material_area"), M.clearedValue("material_description")], [1, 0, null]);
});

test("item types: which fields each type hides (the shown keys of est_logic)", () => {
  const values = { description: "Frame walls", labor_guys: 4, labor_days: 3, labor_rate: 110, labor_qty: 1, labor_unit_price: 0, labor_markup_pct: 20,
    material_description: "Studs", material_qty: 400, material_unit_price: 4.25, material_markup_pct: 15 };
  assert.deepEqual(M.valuesLost("both", values), []);
  assert.deepEqual(M.valuesLost("labor", values), ["material_description", "material_qty", "material_unit_price", "material_markup_pct"]);
  assert.deepEqual(M.valuesLost("material", values), ["description", "labor_guys", "labor_days", "labor_markup_pct"]);
  assert.deepEqual(M.valuesLost("sub", values), ["labor_guys", "labor_days", "material_description", "material_qty", "material_unit_price",
    "material_markup_pct"], "a sub keeps the scope, area, qty, unit price and markup (the labor columns)");
  assert.deepEqual([...M.shownKeys("nonsense")], [...M.shownKeys("both")]);
  assert.deepEqual([...M.shownKeys("sub")].sort(), ["description", "labor_area", "labor_markup_pct", "labor_qty", "labor_unit_price"]);
  assert.equal(M.itemType(" Labor "), "labor");
  assert.equal(M.itemType("crew"), null);
  assert.deepEqual(M.unseenPricesCleared("sub", "labor"), [], "labor -> sub hides no more prices");
  assert.deepEqual(M.unseenPricesCleared("labor", "both"), ["material_unit_price", "material_markup_pct"]);
});

test("item types: the question names what goes (and, without prices, the prices nobody here can see)", () => {
  let q = M.switchQuestion("labor", ["material_description", "material_qty", "material_unit_price"],
    { material_description: "Studs", material_qty: 400, material_unit_price: 4.25 });
  assert.equal(q.title, "Switch to Labor?");
  assert.equal(q.text, "Switching to Labor only clears the material on this item: Material description “Studs”, Material qty 400 and Material unit price $4.25.");
  assert.equal(M.switchQuestion("sub", ["labor_guys"], { labor_guys: 4 }).text, "Switching to Sub-contractor clears the hours on this item: Guys 4.");
  assert.match(M.switchQuestion("material", ["labor_markup_pct"], { labor_markup_pct: 20 }).text, /clears the labor on this item: Labor markup 20%/);
  q = M.switchQuestion("material", [], {}, ["labor_unit_price", "labor_markup_pct"]);
  assert.match(q.text, /any labor prices on it \(your account can't see prices\)/);
  q = M.switchQuestion("labor", ["material_description"], { material_description: "Studs about [amount] a piece" }, ["material_unit_price"]);
  assert.ok(!/\$\s?\d/.test(q.text), "a word the person may not see is never put back");
});

/* ── names, groups and their order (the database's own rules) ────────── */

test("group names and keys as the database tidies them (tests/vectors/group-key.json)", () => {
  const v = vec("group-key.json");
  for (const c of v.cases) {
    assert.equal(M.groupKey(c.name), c.key, JSON.stringify(c.name));
  }
  for (const o of v.orders) assert.deepEqual(M.cleanGroupOrder(o.names), o.clean, JSON.stringify(o.names));
  assert.equal(M.groupOrderProblem(Array(600).fill("A")), null, "one group, 600 times");
  assert.match(M.groupOrderProblem(Array.from({ length: 501 }, (_, i) => "G" + i)), /500/);
  assert.match(M.groupOrderProblem(["x".repeat(201)]), /200/);
});

test("groupsInOrder: listed groups first, then by code naturally, then by name; items by sort (estimate_order.py)", () => {
  const items = [it(1, "Walls", 2, "06.11.00"), it(2, "walls ", 1), it(3, "Roof", 1, "06.17.00"), it(4, null, 1), it(5, "Demolition", 1, "02.41.00"),
    it(6, "Blocking", 1), it(7, "Arches", null)];
  let slots = M.groupsInOrder(items, []);
  assert.deepEqual(slots.map((s) => s.name), ["Demolition", "walls", "Roof", "Arches", "Blocking", ""]);
  assert.deepEqual([slots[1].key, slots[1].code, slots[1].items.map((i) => i.id)], ["walls", "06.11.00", [2, 1]]);
  slots = M.groupsInOrder(items, ["ROOF", "", "Walls"]);
  assert.deepEqual(slots.map((s) => s.key), ["roof", "", "walls", "demolition", "arches", "blocking"]);
});

/* ── the planners (tests/test_estimate_order_archive.py's cases, over the database's gids) ── */

test("planItemDrop: a sort between the neighbours; where it already is: nothing; at the end of the group", () => {
  const items = [it(1, "Walls", 1), it(2, "Walls", 2), it(3, "Walls", 3), it(4, "Roof", 1, "06.17.00")];
  const s = slotsFrom(items);
  const walls = { gid: gidOf(s, "walls") };
  assert.deepEqual(M.planItemDrop(s, 3, walls, 2), [{ id: 3, version: 1, sort: 1.5 }]);
  assert.deepEqual(M.planItemDrop(s, 3, walls, 1), [{ id: 3, version: 1, sort: 0 }], "at the top: one less than the first");
  assert.deepEqual(M.planItemDrop(s, 1, walls, null), [{ id: 1, version: 1, sort: 4 }], "at the end of the group");
  assert.deepEqual(M.planItemDrop(s, 2, walls, 3), [], "where it already is");
  assert.deepEqual(M.planItemDrop(s, 3, walls, null), [], "already last");
  assert.deepEqual(M.planItemDrop(s, 2, walls, 2), [], "onto itself");
  assert.deepEqual(M.planItemDrop(s, 99, walls, null), [], "not there");
});

test("planItemDrop: into another group only the name moves (the database gives the code); a new group; no group", () => {
  const items = [it(1, "Walls", 1, "06.11.00"), it(2, "Walls", 2, "06.11.00"), it(4, "Roof", 1, "06.17.00")];
  let s = slotsFrom(items);
  assert.deepEqual(M.planItemDrop(s, 2, { gid: gidOf(s, "roof") }, 4), [{ id: 2, version: 1, sort: 0, group_name: "Roof" }],
    "the group as the estimate spells it; no code");
  assert.deepEqual(M.planItemDrop(s, 2, { name: "Brand  new " }, null), [{ id: 2, version: 1, sort: 1, group_name: "Brand new" }]);
  s = slotsFrom(items.concat([it(9, null, 1)]));
  assert.deepEqual(M.planItemDrop(s, 2, { gid: gidOf(s, "") }, null), [{ id: 2, version: 1, sort: 2, group_name: null }], "no group: null");
});

test("planItemDrop: without room between the neighbours the group is renumbered (only the rows that change)", () => {
  let s = slotsFrom([it(1, "Walls", 1, null, 4), it(2, "Walls", 1, null, 5), it(3, "Walls", 3), it(5, "Roof", 2)]);
  assert.deepEqual(M.planItemDrop(s, 5, { gid: gidOf(s, "walls") }, 2), [{ id: 5, version: 1, sort: 2, group_name: "Walls" },
    { id: 2, version: 5, sort: 3 }, { id: 3, version: 1, sort: 4 }]);
  s = slotsFrom([it(1, "Walls", "1.000"), it(2, "Walls", "1.001"), it(3, "Walls", 9)]);
  assert.deepEqual(M.planItemDrop(s, 3, { gid: s[0].gid }, 2), [{ id: 3, version: 1, sort: 2 }, { id: 2, version: 1, sort: 3 }],
    "no 3-decimal number fits between 1.000 and 1.001");
});

test("planItemStep: Up / Down cross a group's edge; nothing at the very top or bottom", () => {
  const s = slotsFrom([it(1, "Walls", 1, "06.11.00"), it(2, "Walls", 2, "06.11.00"), it(3, "Roof", 1, "06.17.00")]);
  assert.deepEqual(M.planItemStep(s, 2, -1), [{ id: 2, version: 1, sort: 0 }]);
  assert.deepEqual(M.planItemStep(s, 1, +1), [{ id: 1, version: 1, sort: 3 }]);
  assert.deepEqual(M.planItemStep(s, 2, +1), [{ id: 2, version: 1, sort: 0, group_name: "Roof" }], "into the group below, first");
  assert.deepEqual(M.planItemStep(s, 3, -1), [{ id: 3, version: 1, sort: 3, group_name: "Walls" }], "into the group above, last");
  assert.deepEqual(M.planItemStep(s, 1, -1), [], "the very top");
  assert.deepEqual(M.planItemStep(s, 3, +1), [], "the very bottom");
});

test("planGroupStep / planRename / planCode: the whole new order; a rename keeps the group's place; codes only where they differ", () => {
  const items = [it(1, "Walls", 1, "06.11.00"), it(2, "Roof", 1, "06.17.00"), it(3, null, 1), it(4, "Demo", 1, "02.41.00")];
  const s = slotsFrom(items);
  assert.deepEqual(s.map((x) => x.name), ["Demo", "Walls", "Roof", ""]);
  assert.deepEqual(M.planGroupStep(s, gidOf(s, "roof"), -1), ["Demo", "Roof", "Walls", ""]);
  assert.equal(M.planGroupStep(s, gidOf(s, "demo"), -1), null);
  assert.equal(M.planGroupStep(s, gidOf(s, ""), +1), null);
  // not listed, and the new name keeps the order (the code decides): the items only
  assert.deepEqual(M.planRename(s, [], gidOf(s, "walls"), "Exterior walls"), { groupOrder: null, moves: [{ id: 1, version: 1, group_name: "Exterior walls" }] });
  // listed: the order names it in its place
  assert.deepEqual(M.planRename(slotsFrom(items, ["Roof", "Walls"]), ["Roof", "Walls"], gidOf(slotsFrom(items, ["Roof", "Walls"]), "walls"), "Shear walls"),
    { groupOrder: ["Roof", "Shear walls"], moves: [{ id: 1, version: 1, group_name: "Shear walls" }] });
  // not listed, no codes: a new name that would move it -> the whole order keeps it where it was
  const plain = slotsFrom([it(1, "Beta", 1), it(2, "Gamma", 1)]);
  assert.deepEqual(M.planRename(plain, [], gidOf(plain, "beta"), "Zeta"), { groupOrder: ["Zeta", "Gamma"], moves: [{ id: 1, version: 1, group_name: "Zeta" }] });
  assert.equal(M.planRename(plain, [], gidOf(plain, "beta"), "Beta"), null, "the same name: nothing");
  assert.equal(M.planRename(plain, [], gidOf(plain, "beta"), "   "), null);
  const walls = slotsFrom([it(1, "Walls", 1, "06.11.00"), it(2, "Walls", 2, null), it(3, "Walls", 3, " 06.11.00 ")])[0];
  assert.deepEqual(M.planCode(walls, "06.11.00"), [{ id: 2, version: 1, group_code: "06.11.00" }], "a code that reads the same after a trim is the same");
  assert.deepEqual(M.planCode(walls, ""), [{ id: 1, version: 1, group_code: null }, { id: 3, version: 1, group_code: null }]);
});

test("planMoveToEstimate: last in its own group there, or last of all", () => {
  const target = { id: 9, items: [{ id: 50, group_name: "Walls", sort: 4 }, { id: 51, group_name: "Roof", sort: 7 }] };
  assert.deepEqual(M.planMoveToEstimate({ id: 3, version: 2, group_name: " walls" }, target), [{ id: 3, version: 2, estimate_id: 9, sort: 5 }]);
  assert.deepEqual(M.planMoveToEstimate({ id: 3, version: 2, group_name: "Deck" }, target), [{ id: 3, version: 2, estimate_id: 9, sort: 8 }]);
  assert.deepEqual(M.planMoveToEstimate({ id: 3, version: 2, group_name: null }, { id: 9, items: [] }), [{ id: 3, version: 2, estimate_id: 9, sort: 1 }]);
});

test("wordsRefusal: without prices nothing touches a locked group name or code, and no group order is sent while one is locked", () => {
  const est = {
    group_order: ["Walls"], groupOrderLocked: false,
    groups: [{ gid: "g1", name: "Walls", code: "", locked: false, items: [] }, { gid: "g2", name: "Deck [amount]", code: "", locked: true, items: [] }],
    items: [it(1, "Walls", 1), it(2, "Deck [amount]", 1, null, 1, { locked: ["group_name"] })],
  };
  est.groups[0].items = [est.items[0]];
  est.groups[1].items = [est.items[1]];
  const no = { prices: false };
  assert.equal(M.wordsRefusal(est, null, [{ id: 1, version: 1, sort: 2 }], no), null, "a sort alone");
  assert.equal(M.wordsRefusal(est, null, [{ id: 2, version: 1, sort: 2 }], no), null, "a sort inside a locked group");
  assert.equal(M.wordsRefusal(est, null, [{ id: 2, version: 1, group_name: "Walls" }], no), M.LOCKED_HINT, "out of a locked group (Rule A)");
  assert.equal(M.wordsRefusal(est, null, [{ id: 1, version: 1, group_name: "Deck [amount]" }], no), M.LOCKED_HINT, "into one");
  assert.match(M.wordsRefusal(est, null, [{ id: 1, version: 1, group_name: "Deck $400" }], no), /price boxes/, "a new name that quotes an amount (Rule C)");
  assert.equal(M.wordsRefusal(est, ["Deck [amount]", "Walls"], [], no), M.LOCKED_HINT, "a group order adding the hidden copy (Rule B)");
  assert.equal(M.wordsRefusal(Object.assign({}, est, { groupOrderLocked: true }), ["Walls"], [], no), M.LOCKED_HINT, "the stored order holds an amount name");
  assert.equal(M.wordsRefusal(est, ["Deck $400"], [{ id: 1, version: 1, group_name: "Deck $400" }], { prices: true }), null, "with prices: the database's rules only");
});

/* ── the money words, as the database judges them ────────────────────── */

test("quotesAmount = app.quotes_amount (scrub-money vectors); holdsMask; wordsProblem: Rule B, then C", () => {
  for (const c of vec("scrub-money.json").cases) assert.equal(M.quotesAmount(c.in), c.in !== c.out, JSON.stringify(c.in));
  assert.equal(M.quotesAmount(null), false);
  assert.equal(M.holdsMask("Deck [AMOUNT] extra"), true);
  assert.equal(M.holdsMask("about (amount hidden) each"), true);
  assert.equal(M.holdsMask("Deck framing"), false);
  assert.match(M.wordsProblem("Includes a $4,500 allowance"), /price boxes/);
  assert.match(M.wordsProblem("Includes an [amount] allowance"), /hidden copy/);
  assert.equal(M.wordsProblem("Shear walls per S-2"), null);
  for (const c of vec("money-mask.json").cases) {
    if (c.in !== c.out) assert.ok(M.quotesAmount(c.in) || M.holdsMask(c.out), "an amount the screen masks is one the database refuses: " + c.in);
  }
});

/* ── what a sheet sends and refuses ──────────────────────────────────── */

const BASE = { id: 7, version: 3, name: "Exterior walls", item_type: "both", description: "Includes a [amount] credit", labor_guys: 5, labor_days: 6,
  labor_qty: 1, labor_area: null, material_description: "2x6 studs", material_qty: 420, material_area: null, assigned_text: null,
  assigned_contact_id: 12, locked: ["description"] };
const PBASE = Object.assign({}, BASE, { description: "Includes a $1,200 credit", locked: [], notes: "Yard quoted $6.85",
  prices: { labor_rate: 90, labor_unit_price: null, labor_markup_pct: 10, material_unit_price: 6.85, material_markup_pct: 12, quoted_price: null, version: 4 } });

test("diffItem without prices: only what changed; never a locked box, the notes or a price", () => {
  const form = { name: "Exterior walls", item_type: "both", description: "new words", labor_guys: "5", labor_days: "6.5", labor_qty: "1",
    material_description: "2x6 studs and plates", material_qty: "420", notes: "x", labor_rate: "200", material_unit_price: "9", assigned_contact_id: null };
  const d = M.diffItem(BASE, form, { prices: false });
  assert.deepEqual(d, { fields: { labor_days: 6.5, material_description: "2x6 studs and plates", assigned_contact_id: null }, prices: {} });
  assert.deepEqual(M.diffItem(BASE, { name: "Exterior walls", labor_guys: "5.000", material_qty: "420" }, { prices: false }), { fields: {}, prices: {} },
    "5 and 5.000 are one number");
  assert.deepEqual(M.diffItem(BASE, { name: "  ", material_description: "  " }, { prices: false }).fields, { name: "  ", material_description: null },
    "a blank name stays a name (not null); blank words are none");
});

test("diffItem with prices: the price changes apart; a blank markup is 0; the type", () => {
  const d = M.diffItem(PBASE, { item_type: "labor", material_unit_price: "", material_markup_pct: "", labor_markup_pct: "10", labor_rate: "95.50",
    notes: "Yard quoted $6.85 (12th)", description: "Includes a $1,200 credit" }, { prices: true });
  assert.deepEqual(d.fields, { item_type: "labor", notes: "Yard quoted $6.85 (12th)" });
  assert.deepEqual(d.prices, { labor_rate: 95.5, material_unit_price: null, material_markup_pct: 0 });
});

test("validateItem: numbers that fit their columns; markups above -100 %; a rate of 0 or more; without prices no amount in the words", () => {
  const no = { prices: false }, yes = { prices: true };
  assert.equal(M.validateItem(BASE, { labor_guys: "4" }, no), null);
  assert.match(M.validateItem(BASE, { labor_guys: "four" }, no), /Guys: type a number/);
  assert.match(M.validateItem(BASE, { material_qty: "1.0005" }, no), /at most 3 decimal places/);
  assert.match(M.validateItem(BASE, { labor_area: "1000000000" }, no), /too large/);
  assert.equal(M.validateItem(BASE, { labor_rate: "-5" }, no), null, "without prices a price box is not looked at (and never sent)");
  assert.match(M.validateItem(PBASE, { labor_rate: "-5" }, yes), /cannot be below 0/);
  assert.match(M.validateItem(PBASE, { labor_markup_pct: "-100" }, yes), /above -100%/);
  assert.match(M.validateItem(PBASE, { material_unit_price: "4.255" }, yes), /2 decimal places/);
  assert.match(M.validateItem(PBASE, { labor_markup_pct: "12345" }, yes), /too large/);
  assert.equal(M.validateItem(PBASE, { material_unit_price: "$1,250.50", labor_markup_pct: "15%" }, yes), null, "a $ and a % are fine");
  assert.match(M.validateItem(BASE, { material_description: "Studs, about $6 each" }, no), /Material description: Amounts go in the price boxes/);
  assert.match(M.validateItem(BASE, { name: "Walls [amount]" }, no), /hidden copy/);
  assert.equal(M.validateItem(BASE, { description: "something else" }, no), null, "a locked box is never sent, so never refused");
  assert.equal(M.validateItem(PBASE, { material_description: "Studs, about $6 each" }, yes), null, "with prices words are words");
});

test("diffEstimate / validateEstimate: never the terms or a locked word without prices; Approved only with prices", () => {
  const e = { id: 1, version: 2, name: "Deck [amount] option", description: "Rear deck", status: "sent", locked: ["name"] };
  assert.deepEqual(M.diffEstimate(e, { name: "x", description: "Rear deck, PT", client_notes: "terms", status: "declined" }, { prices: false }),
    { description: "Rear deck, PT", status: "declined" });
  assert.match(M.validateEstimate(e, { status: "approved" }, { prices: false }), /Only someone who sees prices/);
  assert.match(M.validateEstimate(e, { description: "Budget $9,000" }, { prices: false }), /Description: Amounts go in the price boxes/);
  assert.equal(M.validateEstimate(Object.assign({}, e, { locked: [] }), { status: "approved", client_notes: "Valid 30 days, $500 deposit" }, { prices: true }), null);
  assert.deepEqual(M.statusesFor({ status: "sent" }, false), ["draft", "sent", "declined"]);
  assert.deepEqual(M.statusesFor({ status: "approved" }, false), [], "an approved one keeps its status");
  assert.deepEqual(M.statusesFor({ status: "approved" }, true), ["draft", "sent", "approved", "declined"]);
  assert.equal(M.approvedLock({ status: "approved" }, false), true);
  assert.equal(M.approvedLock({ status: "approved" }, true), false);
});

test("parseNum / numText: what a box takes and shows", () => {
  assert.deepEqual(M.parseNum(""), { ok: true, value: null, places: 0 });
  assert.deepEqual(M.parseNum(" 1,200.5 "), { ok: true, value: 1200.5, places: 1 });
  assert.equal(M.parseNum("$12.50").value, 12.5);
  assert.equal(M.parseNum("15%").value, 15);
  assert.equal(M.parseNum("1.2.3").ok, false);
  assert.equal(M.numText("material_qty", 420), "420");
  assert.equal(M.numText("material_qty", "1450.000"), "1450");
  assert.equal(M.numText("labor_area", 7.125), "7.125");
  assert.equal(M.numText("material_unit_price", 6.85), "6.85");
  assert.equal(M.numText("material_unit_price", 48), "48");
  assert.equal(M.numText("labor_rate", null), "");
});

/* ── one item's money (estimate_math.py; the database's view: the same vectors) ── */

test("itemMath: every shared case to the cent (tests/vectors/estimate-math.json); no money without prices", () => {
  const cents = (v) => (v === null ? null : toCents(v));
  for (const c of vec("estimate-math.json").cases) {
    const m = M.itemMath(c.item, c.prices);
    assert.equal(m.menHours, c.expected.men_hours, c.name + ": men-hours");
    assert.deepEqual([m.labor, m.material, m.total, m.laborPerArea, m.materialPerArea],
      [cents(c.expected.labor_total), cents(c.expected.material_total), cents(c.expected.total), cents(c.expected.labor_per_area), cents(c.expected.material_per_area)], c.name);
  }
  const none = M.itemMath({ labor_guys: 4, labor_days: 3 }, null);
  assert.deepEqual(none, { menHours: 96, labor: null, material: null, total: null, laborPerArea: null, materialPerArea: null });
});

/* ── conflicts (est_save.py) ─────────────────────────────────────────── */

test("conflictPlan: already so -> done; they changed other fields -> resend; they changed these -> clash", () => {
  const base = M.flatItem(PBASE);
  assert.equal(base.material_unit_price, 6.85);
  assert.equal(base.price_version, 4);
  let cur = Object.assign({}, base, { material_qty: 400, version: 4 });
  assert.deepEqual(M.conflictPlan(base, cur, { material_qty: 400 }), { kind: "done", mine: {}, clash: [] });
  assert.deepEqual(M.conflictPlan(base, cur, { labor_guys: 6 }), { kind: "resend", mine: { labor_guys: 6 }, clash: [] });
  assert.deepEqual(M.conflictPlan(base, cur, { material_qty: 420.5, labor_guys: 6 }), { kind: "clash", mine: { material_qty: 420.5, labor_guys: 6 }, clash: ["material_qty"] });
  cur = Object.assign({}, base, { material_unit_price: 7.1 });
  assert.deepEqual(M.conflictPlan(base, cur, { material_unit_price: 7.25 }).clash, ["material_unit_price"], "a price too");
  assert.equal(M.shownValue("material_unit_price", 7.1), "$7.10");
  assert.equal(M.shownValue("item_type", "sub"), "Sub-contractor");
  assert.equal(M.shownValue("material_qty", null), "—");
});

/* ── the model the cards and the sheets draw ─────────────────────────── */

test("fromEditRead: the database's groups by gid, the model's flags and locks; money only with prices", () => {
  const item = { id: 2, estimate_id: 1, version: 3, gid: "g2", sort: 1, group_name: "Walls", group_code: "06.11.00", name: "Exterior walls",
    item_type: "both", description: "a [amount] credit", labor_guys: 5, labor_days: 6, labor_qty: 1, men_hours: 240, material_qty: 420,
    priced: true, locked: ["description"] };
  const answer = { project_id: 268, prices: false, can_edit: true, estimates: [{ id: 1, kind: "estimate", number: 1, label: "Estimate #1",
    name: "Main", status: "approved", archived: false, group_order: ["Walls"], locked: [], group_order_locked: false,
    groups: [{ gid: "g1", name: "", code: "", title: "General", locked: false }, { gid: "g2", name: "Walls", code: "06.11.00", title: "Walls", locked: false }],
    items: [item], totals: { men_hours: 240 } }] };
  const m = M.fromEditRead(answer, { 2: [{ item_id: 2, state: "blocked" }] });
  assert.deepEqual([m.prices, m.canEdit, m.projectId], [false, true, 268]);
  const e = m.estimates[0];
  assert.deepEqual(e.groups.map((g) => [g.gid, g.label, g.items.length]), [["g1", "(no group)", 0], ["g2", "Walls", 1]]);
  assert.deepEqual([e.approvedLock, e.addable, e.groups[1].addable, e.total, e.priced], [true, false, false, null, false], "approved, no prices: nothing added");
  assert.deepEqual([e.items[0].locked, e.items[0].money, e.items[0].flags.length], [["description"], null, 1]);
  assert.equal(M.isLocked(e.items[0], "description"), true);
  const withPrices = M.fromEditRead(Object.assign({}, answer, { prices: true, estimates: [Object.assign({}, answer.estimates[0], { client_notes: "Valid 30 days",
    items: [Object.assign({}, item, { locked: undefined, totals: { labor: 23760, material: 3222.04, total: 26982.04 } })] })] }), {});
  const p = withPrices.estimates[0];
  assert.deepEqual([p.approvedLock, p.items[0].locked, p.items[0].money, p.total], [false, [], { labor: 2376000, material: 322204, total: 2698204 },
    { labor: 2376000, material: 322204, total: 2698204 }]);
});
