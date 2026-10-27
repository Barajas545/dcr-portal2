// The web estimate editor's pages (owner 2026-10-24: Q12 reversed): the cards' edit hooks (pages/est-render.js), the
// sheets (pages/est-sheet.js) drawn from the DEMO database's estimate_edit_read for an Estimator with and without
// prices, and the static rules - the editor is a lazy import of the Estimate tab (never in a crew phone's offline set,
// site/sw.js), the sheet is the whole screen on a phone, the old "edited in DCR Desktop 2" words are gone. Made-up data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as edit from "../site/js/repo/estimate-edit.js";
import { estimateCardsHtml, estimateSheetHtml } from "../site/js/pages/est-render.js";
import { itemFormHtml, estimateFormHtml, groupFormHtml, newGroupFormHtml, conflictHtml, sheetHtml, liveLineHtml, nameRows, NAME_ROWS } from "../site/js/pages/est-sheet.js";
import * as M from "../site/js/map/estimate-edit.js";
import { moneyShown } from "../site/js/map/estimates.js";

const skip = !available && "the demo database (tools/fake) is not here";
const SANDBOX = 268;
const DOLLARS = /\$\s?\d/;
const PRICE_BOX = /name="(labor_rate|labor_unit_price|labor_markup_pct|material_unit_price|material_markup_pct|quoted_price|notes|client_notes)"/;
const read = (rel) => readFileSync(new URL("../site/" + rel, import.meta.url), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

async function modelAs(key) {
  const e = await freshEngine();
  useClient(clientAs(e, (await person(key)).id));
  return edit.loadEditor(SANDBOX);
}
const byName = (m, name) => m.estimates.find((x) => x.name === name);

test("the cards: the edit hooks only with opts.edit; the group by its database gid, never its name; + Item only where one may add", { skip }, async () => {
  const m = await modelAs("estimator");
  const list = m.estimates.filter((x) => !x.archived);
  const show = moneyShown(m.prices, list);
  const plain = estimateCardsHtml(list, { show, pid: SANDBOX });
  assert.ok(!/data-act=|es-add|tabindex=/.test(plain), "the read-only tab's cards are unchanged");
  const html = estimateCardsHtml(list, { show, pid: SANDBOX, edit: true });
  assert.ok(/data-act="est" data-est="1"/.test(html) && /data-act="item" data-est="2"/.test(html));
  assert.ok(/data-act="grp" data-est="2" data-grp="g1"/.test(html), "a group by its gid");
  assert.ok(!/data-grp="[^g]/.test(html), "never a group name in an attribute");
  const main = html.split('data-est="1"')[0] + html.split('<div class="es-card').find((c) => /data-est="1"/.test(c));
  assert.ok(!/data-act="add" data-est="1"|data-act="addgrp" data-est="1"/.test(main), "nothing is added to an approved estimate without prices");
  assert.ok(/data-act="add" data-est="2" data-grp="g1"/.test(html) && /data-act="addgrp" data-est="2"/.test(html), "the deck option takes new items");
  assert.ok(!DOLLARS.test(html), "no amount on a no-price Estimator's cards");
  const pm = await modelAs("manager_prices");
  const priced = estimateCardsHtml(pm.estimates.filter((x) => !x.archived), { show: moneyShown(pm.prices, pm.estimates.filter((x) => !x.archived)), pid: SANDBOX, edit: true });
  assert.ok(DOLLARS.test(priced) && /data-act="add" data-est="1"/.test(priced), "with prices: the money, and the approved estimate takes items");
});

test("the item sheet without prices: no price box, no notes; a locked box disabled and masked; an approved item's type and quantities kept", { skip }, async () => {
  const m = await modelAs("estimator");
  const main = byName(m, "Main house framing");
  const walls = main.items.find((i) => i.locked.includes("description"));
  const html = itemFormHtml(walls, { prices: false, est: main, estimates: m.estimates });
  assert.ok(!PRICE_BOX.test(html), "no price box, no notes box at all");
  assert.ok(!DOLLARS.test(html), "no amount");
  assert.match(html, /<textarea id="ef_description" name="description" data-key="description" disabled data-masked="1" title="Contains an amount — hidden for you"/);
  assert.match(html, /\[amount\]/, "the words as the database sent them");
  assert.match(html, /<select id="ef_item_type" name="item_type" data-key="item_type" disabled/, "approved: the type stays");
  assert.match(html, /id="ef_labor_guys" name="labor_guys" data-key="labor_guys" disabled/, "approved: the quantities stay");
  assert.match(html, /id="efToEst" disabled/, "approved: nothing moves out");
  const deck = byName(m, "Deck option");
  const free = itemFormHtml(deck.items[0], { prices: false, est: deck, estimates: m.estimates });
  assert.ok(!/ disabled/.test(free.split('id="efToGroup"')[0]), "an item of a sent estimate: every box open");
  assert.ok(!/<option value="1">/.test(free.split('id="efToEst"')[1].split("</select>")[0]), "no approved estimate offered as a target");
  assert.match(free, /inputmode="decimal"/, "a phone's number pad");
  const sheet = sheetHtml("Item", free, { save: "Save", danger: { act: "deleteItem", text: "Delete", disabled: true, title: "x" } });
  assert.match(sheet, /role="dialog" aria-modal="true"/);
  assert.match(sheet, /data-act="deleteItem" disabled title="x"/);
  assert.match(liveLineHtml({ labor_guys: 2, labor_days: 3 }, null), /2 guys × 3 days · 48 men-hours/);
  assert.ok(!DOLLARS.test(liveLineHtml({ labor_guys: 2, labor_days: 3 }, null)), "no money line without prices");
});

test("the item sheet with prices: the price boxes, the notes, the live total; a sub-contractor's card", { skip }, async () => {
  const m = await modelAs("manager_prices");
  const main = byName(m, "Main house framing");
  const walls = main.items.find((i) => /Exterior walls/.test(i.name));
  const html = itemFormHtml(walls, { prices: true, est: main, estimates: m.estimates });
  for (const k of ["labor_rate", "labor_unit_price", "labor_markup_pct", "material_unit_price", "material_markup_pct", "notes"]) assert.match(html, new RegExp('name="' + k + '"'), k);
  assert.ok(!/ disabled/.test(html.split('id="esLive"')[0]), "nothing locked with prices (an approved one too)");
  assert.match(html, /\$1,200 credit/, "the words as typed");
  assert.match(html, /Total \$[0-9,]+\.\d\d/);
  const crane = main.items.find((i) => i.item_type === "sub");
  const sub = itemFormHtml(crane, { prices: true, est: main, estimates: m.estimates });
  assert.match(sub, /<legend id="efLaborLegend">Sub-contractor<\/legend>/);
  assert.match(sub, /<label for="ef_description" id="efDescLabel">Scope of work/);
  assert.match(sub, /<fieldset class="es-part" data-part="material" hidden>/, "a sub has no material card");
  const deck = byName(m, "Deck option");
  const fresh = itemFormHtml({ item_type: "labor", labor_qty: 1, material_qty: 1 }, { prices: true, est: deck, isNew: true, gid: deck.groups[0].gid, type: "labor" });
  assert.match(fresh, /Group: <b>Deck<\/b>/, "a new item goes into the group it was added to");
  assert.ok(!/name="group_name"|name="group_code"/.test(fresh), "no group boxes on an item (a new group is a name only: newGroupFormHtml)");
  assert.ok(!/es-moves/.test(fresh), "a new item has no moves yet");
  assert.match(itemFormHtml({ name: "<b>Bold</b>" }, { prices: true, est: {}, isNew: true }), /&lt;b&gt;Bold&lt;\/b&gt;/, "words are text, never HTML");
});

test("the estimate and group sheets: Approved and Duplicate only with prices; an approved one's status, archive and delete kept; locked groups", { skip }, async () => {
  const m = await modelAs("estimator");
  const main = byName(m, "Main house framing"), deck = byName(m, "Deck option");
  const a = estimateFormHtml(main, { prices: false });
  assert.match(a, /<select id="ef_status" name="status" data-key="status" disabled/);
  assert.match(a, /data-act="archive" disabled/);
  assert.match(a, /data-act="delete" disabled/);
  assert.ok(!/data-act="duplicate"/.test(a) && !/name="client_notes"/.test(a), "no Duplicate, no terms");
  const s = estimateFormHtml(deck, { prices: false });
  assert.ok(!/value="approved"/.test(s), "no Approved to pick");
  assert.ok(/value="sent" selected/.test(s) && /value="declined"/.test(s));
  const pm = await modelAs("admin");
  const p = estimateFormHtml(byName(pm, "Deck option"), { prices: true });
  assert.ok(/value="approved"/.test(p) && /data-act="duplicate"/.test(p) && /name="client_notes"/.test(p));
  // a group whose name quotes an amount (the office's), for an Estimator without prices
  const locked = { gid: "g1", name: "Allowance [amount]", code: "", title: "Allowance [amount]", locked: true, items: [{ id: 1 }], addable: false };
  const est = { label: "Estimate #2", groups: [locked, { gid: "g2", name: "Deck", code: "", locked: false, items: [] }], addable: true };
  const g = groupFormHtml(locked, { prices: false, est });
  assert.match(g, /data-act="rename" disabled/);
  assert.match(g, /data-act="gup" disabled/);
  assert.match(g, /data-act="gdelete" disabled/);
  assert.ok(!/data-act="addHere"/.test(g), "nothing added to a locked group");
  const open = groupFormHtml(est.groups[1], { prices: false, est });
  assert.ok(!/data-act="rename" disabled/.test(open), "an unlocked group is renamed");
  assert.match(open, /data-act="gup" disabled/, "groups are not reordered while one of them is locked");
  assert.match(open, /data-act="gdelete" disabled title="Contains an amount/, "nor is a group deleted then (it sends the group order)");
  for (const html of [g, open]) assert.ok(!/group_code|data-act="code"|Group code|Set code/.test(html), "no group code (owner 2026-10-27)");
  const c = conflictHtml([{ label: "Material qty", theirs: "420", mine: "400" }], "Riley");
  assert.match(c, /Riley changed Material qty: theirs <b>420<\/b> · yours <b>400<\/b>/);
  assert.match(c, /data-act="keepTheirs"/);
});

test("the item name is a text area of its lines (owner 2026-10-27): a name of several lines is shown as it is and, saved as it was, sends nothing", { skip }, async () => {
  const m = await modelAs("estimator");
  const deck = byName(m, "Deck option");
  const item = Object.assign({}, deck.items[0], { name: "Deck framing 12x16\nPT joists at 16\" o.c.\nper sheet S-4" });
  const html = itemFormHtml(item, { prices: false, est: deck, estimates: m.estimates });
  assert.match(html, /<textarea id="ef_name" name="name" data-key="name" class="es-grow" rows="3">Deck framing 12x16\nPT joists at 16&quot; o\.c\.\nper sheet S-4<\/textarea>/,
    "a text area, a row per line, the line breaks kept (an <input> would join them)");
  assert.ok(!/<input[^>]*id="ef_name"/.test(html), "never a one-line box");
  // the box hands the words back as they are: nothing to send
  const value = /<textarea id="ef_name"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)[1].replace(/&quot;/g, '"');
  assert.deepEqual(M.diffItem(item, { name: value }, { prices: false }), { fields: {}, prices: {} });
  assert.equal(nameRows("one"), 1);
  assert.equal(nameRows(""), 1);
  assert.equal(nameRows("a\r\nb\nc"), 3);
  assert.equal(nameRows("1\n2\n3\n4\n5\n6\n7\n8"), NAME_ROWS, "at most six rows, then it scrolls");
  assert.equal(NAME_ROWS, 6);
  assert.match(itemFormHtml({ name: "\nStarts on a new line" }, { prices: true, est: {}, isNew: true }), /rows="2">\n\nStarts on a new line<\/textarea>/,
    "the parser drops the first line break after <textarea>: one more keeps the name's own");
  const walls = byName(m, "Main house framing").items[0];
  const locked = itemFormHtml(Object.assign({}, walls, { locked: ["name"], name: "Allowance [amount]\nsecond line" }), { prices: false, est: byName(m, "Main house framing"), estimates: m.estimates });
  assert.match(locked, /<textarea id="ef_name" name="name" data-key="name" disabled data-masked="1" title="Contains an amount — hidden for you" aria-describedby="efLockedNote" class="es-grow" rows="2">/,
    "a locked name: read only, masked, never sent");
  const page = code(read("js/pages/project-estimate-edit.js"));
  assert.match(page, /t\.tagName === "INPUT"/, "Enter is Save in a one-line box only: in the name it is a new line");
  assert.match(page, /if \(t\.id === "ef_name"\) fitName\(t\);/, "the name's box grows as one types");
  assert.match(read("css/estimates.css"), /\.es-form textarea\.es-grow\{resize:none; overflow-y:auto; max-height:calc\(6 \* 1\.4em \+ 22px\);\}/);
});

test("empty groups in the editor (owner 2026-10-27): the demo's estimate_edit_read sends a listed name with no item; its card says Empty, its sheet deletes it; the read-only tab and the paper never show it", { skip }, async () => {
  const e = await freshEngine();
  const deckRow = e.rows.estimates.find((x) => x.project_id === SANDBOX && x.name === "Deck option");
  deckRow.group_order = ["Deck", "Stairs and rail", "Allowance $400"];
  for (const key of ["estimator", "manager_prices"]) {
    useClient(clientAs(e, (await person(key)).id));
    const m = await edit.loadEditor(SANDBOX);
    const prices = key === "manager_prices";
    const deck = byName(m, "Deck option");
    const amount = prices ? "Allowance $400" : "Allowance [amount]";
    assert.deepEqual(deck.groups.map((g) => [g.name, g.items.length, g.empty, g.locked]),
      [["Deck", 2, false, false], ["Stairs and rail", 0, true, false], [amount, 0, true, !prices]], key + ": the empty groups in their listed place, locked by their own words");
    const html = estimateCardsHtml([deck], { show: moneyShown(m.prices, [deck]), pid: SANDBOX, edit: true });
    assert.match(html, /<tr class="pj-grp es-grp-empty"><td colspan="\d">Stairs and rail <span class="es-empty">Empty<\/span><button type="button" class="es-act es-grp-act" data-act="grp" data-est="\d+" data-grp="g2"/);
    assert.match(html, /data-act="add" data-est="\d+" data-grp="g2">＋ Item</, key + ": ＋ Item into the empty group");
    if (!prices) assert.match(html, /\(amount hidden\) <span class="es-empty">Empty<\/span>|\[amount\] <span class="es-empty">Empty<\/span>/, "a locked empty group: its words amount-free");
    if (!prices) assert.ok(!/data-grp="g3">＋ Item/.test(html), "nothing added to a locked empty group");
    assert.ok(!/Subtotal — Stairs and rail/.test(html), key + ": an empty group has no subtotal");
    assert.match(html, /data-act="addgrp" data-est="\d+">＋ New group</, key + ": a new group is a name only");
    const sheet = groupFormHtml(deck.groups[1], { prices: m.prices, est: deck });
    assert.match(sheet, /Empty: no items yet/);
    if (prices) assert.match(sheet, /<button type="button" class="es-act es-danger" data-act="gdelete">Delete group<\/button>/, "an empty group is deleted from its sheet");
    else assert.match(sheet, /data-act="gdelete" disabled title="Contains an amount/, "not while a group name of this estimate quotes an amount (the order is locked)");
    const full = groupFormHtml(deck.groups[0], { prices: true, est: deck });
    assert.match(full, /data-act="gdelete" disabled title="Move or delete its items first\."/, "a group with items is never deleted here");
    const readOnly = estimateCardsHtml([deck], { show: false, pid: SANDBOX });
    assert.ok(!/Stairs and rail|es-empty/.test(readOnly), key + ": without the edit hooks an empty group is not drawn");
    const paper = estimateSheetHtml({ internalIDNumber: "A267" }, [deck], { show: false, company: { name: "DCR" }, date: "2026-10-27" }).html;
    assert.ok(!/Stairs and rail/.test(paper), key + ": never printed");
  }
  const ng = newGroupFormHtml({ label: "Estimate #2" });
  assert.match(ng, /<input type="text" autocomplete="off" id="ef_group_name" name="group_name" data-key="group_name" value="" maxlength="200">/);
  assert.ok(!/group_code|First item|name="name"/.test(ng), "a name only: no code, no first item");
  assert.ok(!/es-code/.test(read("js/pages/est-render.js")) && !/\.es-code\{/.test(read("css/estimates.css")), "the group code chip is gone");
});

test("the Estimate tab: the editor is a lazy import (never in a crew phone's offline set); the old words are gone; the phone sheet", () => {
  const tab = read("js/pages/project-estimate.js");
  assert.match(code(tab), /import\("\.\/project-estimate-edit\.js"\)/, "fetched only for an Estimator");
  assert.ok(!/^import [^\n]*project-estimate-edit/m.test(tab), "never a static import");
  assert.ok(!/edited in DCR Desktop 2|written in DCR Desktop 2/.test(tab), "the old read-only words");
  assert.match(tab, / · view only/);
  assert.ok(!/Estimates are written in DCR Desktop 2/.test(read("js/pages/report-estimate.js")));
  const sw = read("sw.js");
  for (const f of ["js/pages/project-estimate-edit.js", "js/repo/estimate-edit.js", "js/map/estimate-edit.js", "js/pages/est-sheet.js"]) {
    assert.ok(!sw.includes('"' + f + '"'), f + " is not kept ahead on every phone");
  }
  const ed = code(read("js/pages/project-estimate-edit.js"));
  assert.ok(!/\.rpc\(|\.from\(/.test(ed), "the data through repo/estimate-edit.js only");
  assert.match(ed, /repo\.saveItem\(base, d\.fields, d\.prices, \{ prices: prices\(\) \}\)/, "the repo is told whether prices may go");
  assert.ok(/beforeunload/.test(ed) && /setEditing\(true\)/.test(ed), "unsaved sheet: the page guard and presence");
  const css = read("css/estimates.css");
  const phone = css.split("@media (max-width:640px)").slice(-1)[0];
  assert.match(phone, /\.es-sheet\{padding:0; align-items:stretch;\}/);
  assert.match(phone, /\.es-sheet-card\{max-width:none; max-height:none; min-height:100%;[^}]*overflow:visible;\}/, "the whole screen; the footer can stick");
  assert.match(css, /\.es-sheet\{position:fixed; inset:0;/);
  assert.match(css, /\.es-sheet-ft\{position:sticky; bottom:0;/, "Save stays in view");
  assert.match(css, /\.es-f2\{display:grid; grid-template-columns:1fr 1fr; gap:8px;\}/);
  assert.match(css, /\.es-sheet \.es-act\{min-height:44px;\}/);
  assert.match(css, /\.es-form input, \.es-form select, \.es-form textarea\{min-height:44px;/);
});
