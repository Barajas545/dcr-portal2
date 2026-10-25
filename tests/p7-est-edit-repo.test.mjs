// The web estimate editor's data (owner 2026-10-24: Q12 reversed; site/js/repo/estimate-edit.js, repo/estimates.js
// estimateAccess) over the DEMO database (tools/fake/p5a-est.js: migration 20261028000100's rules - the Estimator
// switch, the approval gate, the approved lock, the money words, the answers without money, estimate_edit_read and
// save_estimate_item), as every kind of demo account: an admin, an Estimator with prices (Quinn), an Estimator without
// prices (Robin: quantities only), a manager without the switch, a lead, an accountant, field, view-only, the agents
// account. tools/schema-check-p7-est.mjs runs the same module against the REAL migration. Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as edit from "../site/js/repo/estimate-edit.js";
import * as estRepo from "../site/js/repo/estimates.js";
import * as M from "../site/js/map/estimate-edit.js";
import { estimateEditor } from "../site/js/map/estimates.js";

const skip = !available && "the demo database (tools/fake) is not here";
const SANDBOX = 268;   // A267, the sandbox project
const DOLLARS = /\$\s?\d/;
// keys that carry money, the internal notes or the terms; "prices" only as the head's true / false, "totals" only {men_hours}
const MONEY_KEYS = ["labor", "material", "total", "labor_total", "material_total", "labor_per_area", "material_per_area", "client_notes", "notes",
  "labor_rate", "labor_unit_price", "labor_markup_pct", "material_unit_price", "material_markup_pct", "quoted_price", "unit_price", "amount"];

/** a client that records what was asked (and with what) and what came back */
function recording(engine, uid) {
  const c = clientAs(engine, uid);
  const log = [];
  const wrap = (p, what, args) => p.then((res) => { log.push({ what, args, data: res.data, error: res.error }); return res; });
  return {
    log,
    client: {
      from(t) {
        const q = c.from(t);
        const then = q.then.bind(q);
        q.then = (ok, bad) => wrap(then((r) => r), "from:" + t, q.body).then(ok, bad);
        return q;
      },
      rpc: (name, args) => wrap(c.rpc(name, args), "rpc:" + name, args),
      storage: c.storage,
    },
  };
}

/** what in this answer a person without prices must never hold (a key path), or [] */
function moneyIn(v, path, out, top) {
  out = out || [];
  if (Array.isArray(v)) { v.forEach((x, i) => moneyIn(x, path + "[" + i + "]", out, false)); return out; }
  if (!v || typeof v !== "object") return out;
  for (const k of Object.keys(v)) {
    const p = path + "." + k;
    if (MONEY_KEYS.includes(k)) out.push(p);
    else if (k === "prices" && !(top && typeof v[k] === "boolean")) out.push(p);
    else if (k === "totals" && Object.keys(v[k] || {}).some((x) => x !== "men_hours")) out.push(p);
    else moneyIn(v[k], p, out, false);
  }
  return out;
}

async function as(e, key) {
  const p = await person(key);
  useClient(clientAs(e, p.id));
  return { id: p.id, role: p.role, active: true };
}
const byName = (model, name) => model.estimates.find((x) => x.name === name || x.name === M.groupKey(name));
const itemNamed = (est, name) => est.items.find((i) => i.name === name);
async function refused(fn, code, msg) {
  try { await fn(); } catch (e) {
    assert.equal(String(e.code), code, msg + ": " + e.code + " " + e.message);
    return e;
  }
  assert.fail(msg + ": expected " + code + ", but it was allowed");
}

/* ── who gets the editor ─────────────────────────────────────────────── */

test("estimateAccess and estimateEditor per account; the database's own can_edit agrees; the agents account reads nothing", { skip }, async () => {
  const e = await freshEngine();
  const want = { admin: true, manager_prices: true, estimator: true, manager: false, lead: false, accountant: false, field: false, viewer: false };
  for (const [key, yes] of Object.entries(want)) {
    const me = await as(e, key);
    const access = await estRepo.estimateAccess(me);
    assert.equal(estimateEditor(me, access), yes, key);
    const model = await edit.loadEditor(SANDBOX);
    assert.equal(model.canEdit, yes, key + ": estimate_edit_read's can_edit");
    assert.equal(model.estimates.length, 5, key + ": every live estimate and change order, the archived one too (deleted never)");
  }
  const agents = await as(e, "agents");
  assert.equal(estimateEditor(agents, await estRepo.estimateAccess(agents)), false);
  await refused(() => edit.loadEditor(SANDBOX), "42501", "the agents account");
  // a database before 20261028000100: no column, no editor (and no broken page)
  useClient({ from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { code: "42703", message: "column profiles.can_estimate does not exist" } }) }) }) });
  assert.deepEqual(await estRepo.estimateAccess({ id: "x", role: "manager" }), { can_estimate: false, missing: true });
  useClient({ rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.estimate_edit_read" } }) });
  await refused(() => edit.loadEditor(SANDBOX), "MISSING", "no editor read in the database: the tab stays read only");
});

/* ── people with prices ──────────────────────────────────────────────── */

test("an admin and an Estimator with prices: new estimate and change order (the database numbers them), an item with its prices, row and prices saved together, approval", { skip }, async () => {
  for (const key of ["admin", "manager_prices"]) {
    const e = await freshEngine();
    await as(e, key);
    const made = await edit.createEstimate(SANDBOX, "estimate", { name: "Garage framing", description: "Detached garage" });
    assert.deepEqual([made.number, made.co_number, made.kind, made.status], [7, null, "estimate", "draft"], key + ": the next number counts deleted ones too");
    const co = await edit.createEstimate(SANDBOX, "change_order", { name: "Extra blocking" });
    assert.deepEqual([co.number, co.co_number], [8, 3], key + ": a change order's own number");
    const added = await edit.addItem(made.id, { name: "Garage walls", item_type: "both", labor_guys: 4, labor_days: 2, material_qty: 100, group_name: "Walls" },
      { material_unit_price: 6.5, material_markup_pct: 10 }, { prices: true });
    assert.deepEqual([added.prices.labor_rate, added.prices.material_unit_price], [90, 6.5], key + ": the project's rate, the price given");
    let model = await edit.loadEditor(SANDBOX);
    assert.equal(model.prices, true);
    let est = model.estimates.find((x) => x.id === made.id);
    let item = itemNamed(est, "Garage walls");
    assert.deepEqual(item.money, { labor: 576000, material: 71500, total: 647500 }, "4 x 2 x 8 x $90 + 100 x $6.50 x 1.10");
    assert.equal(est.client_notes, null, "the terms are there (empty) for people with prices");
    const saved = await edit.saveItem(item, { labor_guys: 5 }, { labor_markup_pct: 10 }, { prices: true });
    assert.deepEqual([saved.version, saved.prices.version, saved.totals.total], [item.version + 1, item.prices.version + 1, 8635],
      key + ": both rows, one call (5 x 2 x 8 x $90 x 1.10 + 100 x $6.50 x 1.10)");
    // a second person saves first: the row's version, then the price row's, each named in the refusal
    model = await edit.loadEditor(SANDBOX);
    item = itemNamed(model.estimates.find((x) => x.id === made.id), "Garage walls");
    const other = clientAs(e, (await person("admin")).id);
    await other.rpc("save_estimate_item", { p_item_id: item.id, p_item_version: item.version, p_fields: { labor_days: 3 } });
    let err = await refused(() => edit.saveItem(item, { labor_guys: 6 }, {}, { prices: true }), "PT409", key + ": a stale row");
    assert.deepEqual(edit.conflictInfo(err), { table: "estimate_items", id: item.id, version: item.version + 1 });
    model = await edit.loadEditor(SANDBOX);
    item = itemNamed(model.estimates.find((x) => x.id === made.id), "Garage walls");
    await other.rpc("save_estimate_item", { p_item_id: item.id, p_prices: { material_unit_price: 6.75 }, p_price_version: item.prices.version });
    err = await refused(() => edit.saveItem(item, {}, { material_unit_price: 7 }, { prices: true }), "PT409", key + ": stale prices");
    assert.equal(edit.conflictInfo(err).table, "estimate_item_prices");
    assert.equal(e.rows.estimate_item_prices.find((p) => p.item_id === item.id).material_unit_price, 6.75, "nothing of the stale save landed");
    // approval: people with prices approve
    est = (await edit.loadEditor(SANDBOX)).estimates.find((x) => x.id === made.id);
    const appr = await edit.updateEstimate(est, { status: "approved" }, { prices: true });
    assert.equal(appr.status, "approved");
    assert.ok(appr.approved_date, "the database stamps the day");
    assert.ok(e.rows.activity.some((a) => a.project_id === SANDBOX && a.text === "Estimate #7 approved: Garage framing"), "its log line");
  }
});

test("an admin and an Estimator with prices: Up / Down, another group, rename, code, another estimate, duplicate, archive and restore, delete", { skip }, async () => {
  for (const key of ["admin", "manager_prices"]) {
    const e = await freshEngine();
    await as(e, key);
    let deck = byName(await edit.loadEditor(SANDBOX), "Deck option");
    const stairs = itemNamed(deck, "Stairs, 4 risers");
    await edit.reorder(deck, null, M.planItemStep(M.slotsOf(deck), stairs.id, -1), { prices: true });
    deck = byName(await edit.loadEditor(SANDBOX), "Deck option");
    assert.deepEqual(deck.items.map((i) => i.name), ["Stairs, 4 risers", "Deck framing 12x16"], key + ": Up");
    await edit.reorder(deck, null, M.planItemDrop(M.slotsOf(deck), stairs.id, { name: "Stairs" }, null), { prices: true });
    deck = byName(await edit.loadEditor(SANDBOX), "Deck option");
    assert.deepEqual(deck.groups.map((g) => g.title), ["Deck", "Stairs"], key + ": a new group");
    const plan = M.planRename(M.slotsOf(deck), deck.group_order, deck.groups[0].gid, "Deck framing");
    await edit.reorder(deck, plan.groupOrder, plan.moves, { prices: true });
    deck = byName(await edit.loadEditor(SANDBOX), "Deck option");
    await edit.reorder(deck, null, M.planCode(M.slotsOf(deck)[0], "06.15.00"), { prices: true });
    deck = byName(await edit.loadEditor(SANDBOX), "Deck option");
    assert.deepEqual(deck.groups.map((g) => [g.title, g.code]), [["Deck framing", "06.15.00"], ["Stairs", ""]], key + ": renamed, coded");
    // another estimate (the draft change order)
    let model = await edit.loadEditor(SANDBOX);
    const porch = model.estimates.find((x) => x.name === "Covered porch");
    const moving = itemNamed(byName(model, "Deck option"), "Stairs, 4 risers");
    await edit.moveItems(M.planMoveToEstimate(moving, porch), { prices: true });
    model = await edit.loadEditor(SANDBOX);
    assert.ok(itemNamed(model.estimates.find((x) => x.id === porch.id), "Stairs, 4 risers"), key + ": moved to the change order");
    // duplicate: a draft copy with its items and their prices
    deck = byName(model, "Deck option");
    const copy = await edit.duplicateEstimate(deck);
    assert.deepEqual([copy.name, copy.status, copy.items.length], ["Deck option (copy)", "draft", 1]);
    const src = e.rows.estimate_item_prices.find((p) => p.item_id === deck.items[0].id);
    const dst = e.rows.estimate_item_prices.find((p) => p.item_id === copy.items[0].id);
    assert.equal(dst.material_unit_price, src.material_unit_price, "its prices too");
    // archive, then out of the archive
    await edit.setArchived(deck, true);
    deck = byName(await edit.loadEditor(SANDBOX), "Deck option");
    assert.equal(deck.archived, true);
    await edit.setArchived(deck, false);
    deck = byName(await edit.loadEditor(SANDBOX), "Deck option");
    assert.equal(deck.archived, false);
    // delete: its items go with it, tombstones for both
    const p2 = (await edit.loadEditor(SANDBOX)).estimates.find((x) => x.id === porch.id);
    await edit.deleteEstimate(p2);
    model = await edit.loadEditor(SANDBOX);
    assert.ok(!model.estimates.some((x) => x.id === porch.id), key + ": gone");
    assert.ok(e.rows.estimate_items.filter((i) => i.estimate_id === porch.id).every((i) => i.deleted_at), "its items with it");
    assert.ok(e.rows.deletions.some((d) => d.table_name === "estimates" && d.row_id === porch.id));
    assert.ok(e.rows.deletions.some((d) => d.table_name === "estimate_items" && p2.items.some((i) => i.id === d.row_id)));
    // one item
    const one = itemNamed(byName(model, "Deck option"), "Deck framing 12x16");
    await edit.deleteItem(one);
    assert.ok(!itemNamed(byName(await edit.loadEditor(SANDBOX), "Deck option"), "Deck framing 12x16"));
  }
});

test("all or nothing: a stale item among the moves writes nothing; nor does a refused one", { skip }, async () => {
  const e = await freshEngine();
  await as(e, "manager_prices");
  const main = byName(await edit.loadEditor(SANDBOX), "Main house framing");
  const [a, b] = main.items;
  const stale = Object.assign({}, b, { version: b.version - 1 || 99 });
  await refused(() => edit.reorder(main, null, [{ id: a.id, version: a.version, sort: 50 }, { id: stale.id, version: stale.version, sort: 51 }], { prices: true }),
    "PT409", "one stale item");
  assert.equal(e.rows.estimate_items.find((i) => i.id === a.id).sort, a.sort, "the first is not moved either");
  // a no-price Estimator: the second move is out of an approved estimate (refused), the first not written
  await as(e, "estimator");
  const model = await edit.loadEditor(SANDBOX);
  const deck = byName(model, "Deck option"), porch = model.estimates.find((x) => x.name === "Covered porch");
  const d0 = deck.items[0], m0 = byName(model, "Main house framing").items[0];
  await refused(() => edit.moveItems([{ id: d0.id, version: d0.version, estimate_id: porch.id, sort: 9 }, { id: m0.id, version: m0.version, estimate_id: porch.id, sort: 10 }]),
    "42501", "out of an approved estimate");
  assert.equal(e.rows.estimate_items.find((i) => i.id === d0.id).estimate_id, deck.id, "the first stays where it was");
});

/* ── an Estimator WITHOUT prices (quantities only) ───────────────────── */

test("an Estimator without prices: no answer carries money, a note or the terms; nothing reads or writes a price row; the words come amount-free with their locks", { skip }, async () => {
  const e = await freshEngine();
  const p = await person("estimator");
  const r = recording(e, p.id);
  useClient(r.client);
  let model = await edit.loadEditor(SANDBOX);
  assert.deepEqual([model.prices, model.canEdit], [false, true]);
  const main = byName(model, "Main house framing");
  const walls = itemNamed(main, "Exterior walls 2x6 at 16\" o.c.");
  assert.ok(walls.description.includes("[amount]") && walls.locked.includes("description"), "the stored $1,200 comes as [amount], locked");
  assert.deepEqual([main.approvedLock, main.addable, main.groupOrderLocked], [true, false, false]);
  const words = JSON.stringify(model.estimates);
  assert.ok(!/"(notes|client_notes|prices)":/.test(words), "no notes, terms or price rows in the model");
  assert.ok(model.estimates.every((x) => x.total === null && x.items.every((i) => i.money === null)), "no money in it");
  assert.ok(!DOLLARS.test(words), "no typed amount in it");
  // a working session: a new change order, an item, a save, Up, a move, archive, a rename of the estimate, deletes
  const co = await edit.createEstimate(SANDBOX, "change_order", { name: "Blocking at the stairs" });
  const added = await edit.addItem(co.id, { name: "Blocking", item_type: "labor", labor_guys: 2, labor_days: 1, group_name: "Stairs" }, { labor_rate: 500 }, { prices: false });
  model = await edit.loadEditor(SANDBOX);
  let mine = model.estimates.find((x) => x.id === co.id);
  const it = itemNamed(mine, "Blocking");
  await edit.saveItem(it, { labor_days: 1.5, description: "2x blocking at 24\"" }, { labor_rate: 1 }, { prices: false });
  model = await edit.loadEditor(SANDBOX);
  mine = model.estimates.find((x) => x.id === co.id);
  await edit.addItem(co.id, { name: "Hangers", item_type: "material", material_qty: 12, group_name: "Stairs" }, null, { prices: false });
  model = await edit.loadEditor(SANDBOX);
  mine = model.estimates.find((x) => x.id === co.id);
  await edit.reorder(mine, null, M.planItemStep(M.slotsOf(mine), itemNamed(mine, "Hangers").id, -1), { prices: false });
  model = await edit.loadEditor(SANDBOX);
  const deck = byName(model, "Deck option");
  await edit.moveItems(M.planMoveToEstimate(itemNamed(deck, "Stairs, 4 risers"), model.estimates.find((x) => x.id === co.id)), { prices: false });
  model = await edit.loadEditor(SANDBOX);
  mine = model.estimates.find((x) => x.id === co.id);
  await edit.updateEstimate(mine, { name: "Blocking and stairs" }, { prices: false });
  mine = (await edit.loadEditor(SANDBOX)).estimates.find((x) => x.id === co.id);
  await edit.setArchived(mine, true);
  mine = (await edit.loadEditor(SANDBOX)).estimates.find((x) => x.id === co.id);
  await edit.deleteItem(itemNamed(mine, "Hangers"));
  mine = (await edit.loadEditor(SANDBOX)).estimates.find((x) => x.id === co.id);
  await edit.deleteEstimate(mine);
  // what went over the wire
  const asked = [...new Set(r.log.map((l) => l.what))];
  assert.ok(!asked.includes("from:estimate_item_prices"), "never a price row: " + asked.join(", "));
  for (const l of r.log) {
    assert.equal(l.error, null, l.what + " was refused: " + JSON.stringify(l.error));
    assert.deepEqual(moneyIn(l.data, l.what, [], true), [], l.what + " carried money, a note or the terms");
    assert.ok(!DOLLARS.test(JSON.stringify(l.data)), l.what + ": a typed amount reached the browser");
    if (l.what === "rpc:save_estimate_item") assert.deepEqual([l.args.p_prices, l.args.p_price_version], [null, null], "never prices without the switch");
    if (l.what === "rpc:add_estimate_item") assert.equal(l.args.prices, null);
  }
  assert.equal(e.rows.estimate_item_prices.find((x) => x.item_id === added.id).labor_rate, 90, "the new item's price row has the project's rate");
  assert.ok(e.rows.activity.some((a) => a.text === "Change order #3 created: Blocking at the stairs"));
});

test("an Estimator without prices: every rule of the database refuses (the demo mirrors each: D5 approval and the approved lock, D6 the words)", { skip }, async () => {
  const e = await freshEngine();
  // the office (prices) adds a group whose name quotes an amount, and lists it in the order
  await as(e, "admin");
  let deckA = byName(await edit.loadEditor(SANDBOX), "Deck option");
  await edit.addItem(deckA.id, { name: "Allowance for hardware", item_type: "material", group_name: "Allowance $500" }, null, { prices: true });
  deckA = byName(await edit.loadEditor(SANDBOX), "Deck option");
  await edit.reorder(deckA, ["Allowance $500", "Deck"], [], { prices: true });
  const est = await as(e, "estimator");
  const client = clientAs(e, est.id);
  let model = await edit.loadEditor(SANDBOX);
  const main = byName(model, "Main house framing");
  let deck = byName(model, "Deck option");
  const walls = itemNamed(main, "Exterior walls 2x6 at 16\" o.c.");
  const floor = itemNamed(main, "Floor joists and subfloor");
  const framing = itemNamed(deck, "Deck framing 12x16");
  assert.deepEqual([deck.groupOrderLocked, deck.groups.map((g) => [g.title, g.locked])], [true, [["Allowance [amount]", true], ["Deck", false]]]);
  // prices: never (the repo does not even send them; the database refuses a crafted call)
  await refused(async () => { const r = await client.rpc("save_estimate_item", { p_item_id: framing.id, p_item_version: framing.version, p_prices: { labor_rate: 1 }, p_price_version: 1 }); if (r.error) throw r.error; },
    "42501", "a crafted price save");
  await refused(async () => { const r = await client.rpc("add_estimate_item", { estimate_id: deck.id, fields: { name: "x" }, prices: { material_unit_price: 1 } }); if (r.error) throw r.error; },
    "42501", "a crafted price on a new item");
  await refused(() => edit.duplicateEstimate(deck), "42501", "Duplicate (a copy carries prices)");
  // D5: approval, and an approved estimate's lock
  await refused(() => edit.updateEstimate(deck, { status: "approved" }, { prices: false }), "42501", "Approved");
  await refused(async () => { const r = await client.from("estimates").insert({ project_id: SANDBOX, name: "x", status: "approved" }).select("id"); if (r.error) throw r.error; },
    "42501", "a new one already approved");
  await refused(() => edit.updateEstimate(main, { status: "sent" }, { prices: false }), "42501", "taking an approval back");
  await refused(() => edit.setArchived(main, true), "42501", "archiving an approved one");
  await refused(() => edit.deleteEstimate(main), "42501", "deleting an approved one");
  await refused(() => edit.saveItem(floor, { labor_guys: 9 }, null, { prices: false }), "42501", "a quantity of an approved one");
  await refused(() => edit.saveItem(floor, { item_type: "labor" }, null, { prices: false }), "42501", "a type of an approved one");
  await refused(() => edit.addItem(main.id, { name: "Extra" }, null, { prices: false }), "42501", "an item into an approved one");
  await refused(() => edit.deleteItem(floor), "42501", "an item out of an approved one");
  await refused(() => edit.moveItems([{ id: framing.id, version: framing.version, estimate_id: main.id, sort: 99 }]), "42501", "a move into an approved one");
  const named = await edit.saveItem(floor, { name: "Floor joists, subfloor and blocking" }, null, { prices: false });
  assert.equal(named.name, "Floor joists, subfloor and blocking", "an approved one's words (without amounts) still change");
  // D6: the words
  await refused(() => edit.saveItem(walls, { description: "new words" }, null, { prices: false }), "42501", "Rule A: words that quote an amount");
  await refused(() => edit.saveItem(framing, { description: "Includes an [amount] allowance" }, null, { prices: false }), "22023", "Rule B: the hidden copy");
  await refused(() => edit.saveItem(framing, { material_description: "PT 2x8, about $18 each" }, null, { prices: false }), "22023", "Rule C: a new amount");
  await refused(() => edit.createEstimate(SANDBOX, "estimate", { name: "Deck $400 add" }), "22023", "Rule C on a new estimate");
  await refused(() => edit.addItem(deck.id, { name: "Rail", group_name: "Allowance $300" }, null, { prices: false }), "22023", "Rule C on a new group");
  await refused(async () => { const r = await client.rpc("save_estimate_item", { p_item_id: framing.id, p_item_version: framing.version, p_fields: { notes: "x" } }); if (r.error) throw r.error; },
    "42501", "item notes");
  await refused(() => edit.updateEstimate(deck, { client_notes: "Valid 30 days" }, { prices: true }), "42501", "the terms (even a crafted call)");
  await refused(() => edit.reorder(deck, ["Deck"], [], { prices: false }), "42501", "a group order dropping a name that quotes an amount");
  await refused(() => edit.reorder(deck, ["Deck", "Allowance [amount]"], [], { prices: false }), "42501",
    "the hidden copy in place of the stored name: Rule A first (the stored amount name is gone)");
  const porch = model.estimates.find((x) => x.name === "Covered porch");
  await refused(() => edit.reorder(porch, ["Porch", "Deck [amount]"], [], { prices: false }), "22023", "a new group order element holding the hidden copy (Rule B)");
  model = await edit.loadEditor(SANDBOX);
  deck = byName(model, "Deck option");
  const into = M.planItemDrop(M.slotsOf(deck), framing.id, { gid: deck.groups[0].gid }, null);
  assert.equal(M.wordsRefusal(deck, null, into, { prices: false }), M.LOCKED_HINT, "the page never sends it ...");
  await refused(() => edit.reorder(deck, null, into, { prices: false }), "22023", "... and the database refuses it: into a locked group");
  // t25: a type switch clears the prices the new type hides (the database does it: nobody here sees them)
  model = await edit.loadEditor(SANDBOX);
  const fr = itemNamed(byName(model, "Deck option"), "Deck framing 12x16");
  await edit.saveItem(fr, { item_type: "labor", material_description: null, material_qty: 1 }, null, { prices: false });
  const pr = e.rows.estimate_item_prices.find((x) => x.item_id === fr.id);
  assert.deepEqual([pr.material_unit_price, pr.material_markup_pct, pr.labor_rate], [0, 0, 90], "material prices cleared, the rate kept");
});

/* ── everyone else: read only ────────────────────────────────────────── */

test("a manager without the switch, a lead, an accountant, field, view-only: no editor and every write refused; the read-only tab reads as before", { skip }, async () => {
  const e = await freshEngine();
  for (const key of ["manager", "lead", "accountant", "field", "viewer"]) {
    const me = await as(e, key);
    assert.equal(estimateEditor(me, await estRepo.estimateAccess(me)), false, key);
    const model = await edit.loadEditor(SANDBOX);
    assert.equal(model.canEdit, false, key);
    const deck = byName(model, "Deck option");
    const it = deck.items[0];
    await refused(() => edit.createEstimate(SANDBOX, "estimate", { name: "x" }), "42501", key + " create");
    await refused(() => edit.updateEstimate(deck, { name: "x" }, { prices: model.prices }), "42501", key + " rename");
    await refused(() => edit.setArchived(deck, true), "42501", key + " archive");
    await refused(() => edit.deleteEstimate(deck), "42501", key + " delete");
    await refused(() => edit.duplicateEstimate(deck), "42501", key + " duplicate");
    await refused(() => edit.addItem(deck.id, { name: "x" }, null, { prices: model.prices }), "42501", key + " add");
    await refused(() => edit.saveItem(it, { labor_guys: 3 }, null, { prices: model.prices }), "42501", key + " save");
    await refused(() => edit.deleteItem(it), "42501", key + " delete an item");
    await refused(() => edit.reorder(deck, null, [{ id: it.id, version: it.version, sort: 9 }], { prices: model.prices }), "42501", key + " reorder");
    await refused(() => edit.moveItems([{ id: it.id, version: it.version, sort: 9 }], { prices: model.prices }), "42501", key + " move");
    const ro = await estRepo.listEstimates(SANDBOX);
    assert.deepEqual(ro.estimates.map((x) => x.label), ["Estimate #1", "Estimate #2", "Change order #1", "Change order #2"], key + ": the read-only tab as before");
  }
  assert.ok(!e.rows.estimates.some((x) => x.name === "x"), "nothing was written");
});
