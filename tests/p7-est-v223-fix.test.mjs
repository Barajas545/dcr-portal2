// DCR 2.23 review fixes, the Portal 2 side (findings C0, C20, C21, C22): the web estimate editor finds a group by its
// name, never by the per-read gid, in the New item sheet and Move to group (C20); a sheet with a Save asks "Save
// changes?" - Save / Don't save / Cancel - before it closes with changes (C21: the modal's optional third button); a
// listed takeoff group is named as the group order spells it (C22, DCR Desktop 2's figures.takeoff_levels); the demo's
// reorder_estimate writes a group's new spelling when no live item still spells it the old way (C0, migration
// 20261029000100). Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeDom } from "./console/console-page-dom.mjs";
import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as edit from "../site/js/repo/estimate-edit.js";
import * as M from "../site/js/map/estimate-edit.js";
import * as tko from "../site/js/map/takeoffs.js";
import { itemFormHtml, toGroupValue, toGroupKey } from "../site/js/pages/est-sheet.js";
import { modal, confirm } from "../site/js/common2.js";

const skip = !available && "the demo database (tools/fake) is not here";
const SANDBOX = 268;   // A267, the sandbox project
const read = (rel) => readFileSync(new URL("../site/" + rel, import.meta.url), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

async function as(e, key) {
  const p = await person(key);
  useClient(clientAs(e, p.id));
}
const byName = (model, name) => model.estimates.find((x) => x.name === name);
const deckOf = async () => byName(await edit.loadEditor(SANDBOX), "Deck option");

/* ── C22: the takeoff's group order spells its listed groups ───────────── */
test("C22 takeoff groups: a listed group is named as the takeoff's group order spells it (tidy, its first spelling), whatever its first line says; the others by their first line", () => {
  assert.deepEqual(tko.takeoffLevels([{ id: 1, level: "main level" }, { id: 2, level: "Roof" }], ["Main Level", "Roof"]).map((l) => l.name),
    ["Main Level", "Roof"], "figures.takeoff_levels: spelled.get(key) or clean_name(level)");
  const rows = [
    { id: 1, sort: 1, level: "garage" }, { id: 2, sort: 2, level: "roof" }, { id: 3, sort: 3, level: "" },
    { id: 4, sort: 4, level: "GARAGE" }, { id: 5, sort: 5, level: "deck  BOARDS" },
  ];
  const lv = tko.takeoffLevels(rows, [" ROOF ", "Garage", "garage", ""]);
  assert.deepEqual(lv.map((l) => l.name), ["ROOF", "Garage", "", "deck BOARDS"], "tidy; a name listed twice keeps its first spelling; \"\" stays; unlisted: its first line, tidy");
  assert.deepEqual(tko.allRows(lv[1]).map((r) => r.id), [1, 4], "one group, any case");
  const t = tko.fromTakeoffPrint({ prices: false, takeoffs: [{ takeoff: { id: 9, group_order: ["MAIN LEVEL", "Extras [amount]"] },
    rows: [{ id: 1, sort: 1, level: "Main Level" }, { id: 2, sort: 2, level: "extras [amount]" }] }] });
  assert.deepEqual(t.takeoffs[0].levels.map((l) => tko.levelName(l.name)), ["MAIN LEVEL", "Extras [amount]"], "the tab and the Material List band as the order spells it");
  assert.deepEqual(tko.takeoffLevels([{ id: 1, level: "Constructor" }, { id: 2, level: "__proto__" }, { id: 3, level: "toString" }], ["constructor"])
    .map((l) => l.name), ["constructor", "__proto__", "toString"], "a group name is never an inherited key");
});

/* ── C20: a group by its name, never the per-read gid ──────────────────── */
test("C20 Move to group: each option is the group's name key (\"=\" alone is General), never its gid; toGroupKey reads it back", { skip }, async () => {
  const e = await freshEngine();
  await as(e, "manager_prices");
  let deck = await deckOf();
  await edit.reorder(deck, M.planNewGroup(M.slotsOf(deck), "Alpha").groupOrder, [], { prices: true });
  deck = await deckOf();
  await edit.reorder(deck, M.planNewGroup(M.slotsOf(deck), "Beta").groupOrder, [], { prices: true });
  await edit.addItem(deck.id, { name: "No group", item_type: "labor", labor_guys: 1, labor_days: 1 }, null, { prices: true });
  deck = await deckOf();
  assert.deepEqual(deck.groups.map((g) => [g.gid, g.title]), [["g1", "Deck"], ["g2", "Alpha"], ["g3", "Beta"], ["g4", "General"]]);
  const it = deck.groups[0].items[0];
  const html = itemFormHtml(it, { prices: true, est: deck, estimates: [deck] });
  const values = Array.from(html.split('id="efToGroup"')[1].split("</select>")[0].matchAll(/<option value="([^"]*)">([^<]*)</g)).map((m) => [m[1], m[2]]);
  assert.deepEqual(values, [["", "—"], ["=alpha", "Alpha"], ["=beta", "Beta"], ["=", "General"], ["*new", "New group…"]], "by name, General too; never a gid");
  assert.deepEqual(["=alpha", "=", "", "*new", "g2", null].map(toGroupKey), ["alpha", "", null, null, null, null]);
  assert.equal(toGroupValue({ name: "  Stair   RAIL " }), "=stair rail");
  // why: someone else moves Beta up - the gids are per read, the names stay
  await as(e, "admin");
  await edit.reorder(deck, M.planGroupStep(M.slotsOf(deck), "g3", -1), [], { prices: true });
  await as(e, "manager_prices");
  const now = await deckOf();
  assert.deepEqual(now.groups.map((g) => [g.gid, g.title]), [["g1", "Deck"], ["g2", "Beta"], ["g3", "Alpha"], ["g4", "General"]]);
  assert.equal(now.groups.find((g) => g.gid === "g3").title, "Alpha", "the gid the sheet was drawn with is another group now");
  assert.equal(now.groups.find((g) => M.groupKey(g.name) === toGroupKey("=beta")).title, "Beta", "its name key still finds Beta");
});

test("C20 the page: the New item sheet keeps its group's name key and adds by it (gone: refused, never General); Move to group resolves the key; a live read re-finds the group", () => {
  const page = code(read("js/pages/project-estimate-edit.js"));
  const fn = (name) => { const i = page.indexOf("function " + name + "("); assert.ok(i !== -1, name); return page.slice(i, i + page.slice(i).search(/\r?\n\}\r?\n/)); };
  assert.match(fn("openNewItem"), /key: g \? M\.groupKey\(g\.name\) : ""/, "the group's name key (\"\" = General) with the sheet");
  const add = fn("addNewItem");
  assert.match(add, /est\.groups\.find\(function \(x\) \{ return M\.groupKey\(x\.name\) === s\.key; \}\)/, "added by its name as it is now");
  assert.match(add, /if \(!g && s\.key\) \{ showErr\(GROUP_GONE\); return; \}/, "renamed or deleted: nothing added");
  assert.ok(add.indexOf("showErr(GROUP_GONE)") < add.indexOf("repo.addItem"), "refused before anything is sent");
  assert.ok(!/x\.gid === s\.gid/.test(add), "never by the gid the sheet was drawn with");
  const move = fn("moveToGroup");
  assert.match(move, /const k = toGroupKey\(sel\.value\);/);
  assert.match(move, /M\.groupKey\(x\.name\) === k/);
  assert.ok(!/gid: sel\.value/.test(move), "never the select's value as a gid");
  const live = fn("adoptLive");
  assert.ok(live.indexOf('s.kind === "item" && s.isNew') !== -1 && live.indexOf('s.kind === "item" && s.isNew') < live.indexOf("if (!s || s.isNew || s.pending) return;"),
    "a New item sheet meets a live read too");
  assert.match(live, /s\.gid = g \? g\.gid : null;\s*notice\(g \|\| !s\.key \? "" : GROUP_GONE\);/);
});

/* ── C21: Save changes? ────────────────────────────────────────────────── */
test("C21 the modal's optional third button: Cancel | altText | OK; it answers \"alt\", OK true, Cancel / Esc / the backdrop null; without altText nothing changes", async () => {
  // a small stand-in browser for common2.js modal() (it reads document at call time), put back afterwards
  globalThis.Node = class { static [Symbol.hasInstance](x) { return !!x && typeof x.nodeType === "number"; } };
  globalThis.document = makeDom();
  try {
    const ask = () => modal({ title: "Save changes?", message: "This item has changes that are not saved yet.", okText: "Save", altText: "Don't save", cancelText: "Cancel", fields: [] });
    const host = () => document.getElementById("dcrModalHost");
    const press = (key) => document._dispatch(document.body, { type: "keydown", key });
    let p = ask();
    assert.deepEqual(host().querySelectorAll(".dcr-mo-ft button").map((b) => [b.id, b.textContent]),
      [["dcrMoNo", "Cancel"], ["dcrMoAlt", "Don't save"], ["dcrMoYes", "Save"]], "Cancel | Don't save | Save");
    assert.ok(host().classList.contains("open"));
    document.getElementById("dcrMoAlt").click();
    assert.equal(await p, "alt", "Don't save");
    assert.ok(!host().classList.contains("open"), "closed");
    p = ask(); document.getElementById("dcrMoYes").click();
    assert.equal(await p, true, "Save");
    p = ask(); press("Enter");
    assert.equal(await p, true, "Enter is Save (the default)");
    p = ask(); document.getElementById("dcrMoNo").click();
    assert.equal(await p, null, "Cancel stays");
    p = ask(); press("Escape");
    assert.equal(await p, null, "Esc stays");
    p = ask(); host().click();
    assert.equal(await p, null, "the backdrop stays");
    // the other callers: no third button, the same answers
    p = confirm("Delete this row?", { okText: "Delete", danger: true });
    assert.equal(document.getElementById("dcrMoAlt"), null, "no altText: two buttons");
    document.getElementById("dcrMoYes").click();
    assert.equal(await p, true);
    p = confirm("Delete this row?");
    document.getElementById("dcrMoNo").click();
    assert.equal(await p, false);
  } finally { delete globalThis.document; delete globalThis.Node; }
});

test("C21 the editor: the item, estimate and new-group sheets ask \"Save changes?\" (Save closes once the save went through, Don't save closes, Cancel stays); the group sheet keeps its question", () => {
  const page = code(read("js/pages/project-estimate-edit.js"));
  const close = page.slice(page.indexOf("async function closeSheet("), page.indexOf("function showErr("));
  assert.match(page, /const SAVE_QUESTION = \{ item: "This item has changes that are not saved yet\.", est: "[^"]+",\s*newgrp: "[^"]+" \};/,
    "DCR Desktop 2's words for an item");
  assert.match(close, /modal\(\{ title: "Save changes\?", message: SAVE_QUESTION\[s\.kind\], okText: "Save", altText: "Don't save", cancelText: "Cancel", fields: \[\] \}\)/);
  assert.match(close, /if \(state\.sheet !== s \|\| \(r !== true && r !== "alt"\)\) return;\s*if \(r === true\) \{ sheetAct\("save"\); return; \}/,
    "Save is the sheet's own Save: it closes the sheet only when the write went through");
  assert.match(close, /Leave without saving\?/, "the group sheet (no Save) keeps its question");
  assert.ok(!/[{,\s]grp:/.test(page.slice(page.indexOf("const SAVE_QUESTION"), page.indexOf("async function closeSheet("))), "not for the group sheet");
  assert.match(code(read("js/common2.js")), /const alt = card\.querySelector\("#dcrMoAlt"\);\s*if \(alt\) alt\.addEventListener\("click", \(\) => close\("alt"\)\);/);
});

/* ── C0: the demo's reorder_estimate writes a group's new spelling ─────── */
test("C0 demo reorder_estimate: a group's new spelling is written when no live item still spells it the old way (an empty group's case-only rename sticks); the same order in any case with the items' spelling is still no new version", { skip }, async () => {
  for (const key of ["manager_prices", "estimator"]) {
    const prices = key !== "estimator";
    const e = await freshEngine();
    await as(e, key);
    const row = () => e.rows.estimates.find((x) => x.project_id === SANDBOX && x.name === "Deck option");
    let deck = await deckOf();
    await edit.reorder(deck, M.planNewGroup(M.slotsOf(deck), "roof framing").groupOrder, [], { prices });
    deck = await deckOf();
    assert.deepEqual(row().group_order, ["Deck", "roof framing"]);
    // the empty group's case-only rename: the order alone, and now it is written
    let v = row().version;
    const ren = M.planRename(M.slotsOf(deck), deck.group_order, deck.groups[1].gid, "Roof Framing");
    assert.deepEqual(ren, { groupOrder: ["Deck", "Roof Framing"], moves: [] });
    await edit.reorder(deck, ren.groupOrder, ren.moves, { prices });
    assert.deepEqual([row().group_order, row().version], [["Deck", "Roof Framing"], v + 1], key + ": the new spelling, a new version");
    deck = await deckOf();
    assert.deepEqual(deck.groups.map((g) => [g.title, g.empty]), [["Deck", false], ["Roof Framing", true]], key + ": read back as renamed");
    // the same order in another case while the items still spell the group the old way: nothing new (DCR Desktop 2's check)
    v = row().version;
    await edit.reorder(deck, [" deck", "Roof Framing"], [], { prices });
    assert.deepEqual([row().group_order, row().version], [["Deck", "Roof Framing"], v], key + ": the items' spelling stays, no new version");
    // a group with items renamed in case only: the moves carry the new spelling, and the order follows
    const ren2 = M.planRename(M.slotsOf(deck), deck.group_order, deck.groups[0].gid, "DECK");
    assert.equal(ren2.moves.length, 2);
    await edit.reorder(deck, ren2.groupOrder, ren2.moves, { prices });
    assert.deepEqual([row().group_order, row().version], [["DECK", "Roof Framing"], v + 1], key + ": the order as its items now spell it");
    assert.deepEqual(e.rows.estimate_items.filter((i) => i.estimate_id === row().id && !i.deleted_at).map((i) => i.group_name), ["DECK", "DECK"]);
    // a different order is written as before
    deck = await deckOf();
    await edit.reorder(deck, M.planGroupStep(M.slotsOf(deck), deck.groups[1].gid, -1), [], { prices });
    assert.deepEqual([row().group_order, row().version], [["Roof Framing", "DECK"], v + 2], key + ": a group moved");
  }
});
