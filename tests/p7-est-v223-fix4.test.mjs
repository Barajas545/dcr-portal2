// DCR 2.23 fourth review round, the Portal 2 side: a person without prices reads an amount typed into an item's, a
// group's, an estimate's or a takeoff's words nowhere - by the database's no-price rule (app.priceless_text: scrubMoney
// over maskAmounts - "$" amounts AND "400 dollars", "Deposit 1,200", "5k budget"), as the Estimate tab and DCR
// Desktop 2 (est_logic.hide_amounts), not the page mask's "$" amounts only:
//   * the Progress Chart's payload (map/pm.js toPayload; the worksite copy, worksitePayload, for everyone);
//   * the global search's item hits (map/search.js), shown and matched; and a hit the database found through words
//     the page doesn't show (an item's material, a task's description) stays when the words typed have no digit;
//   * the cost dialog's Estimate line choices and the Expenses rows' line (map/ledger.js lineLabel), for a manager
//     with financials but no prices.
// Display only: nothing masked is written back (the chart's quick note keeps its own logName). Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import { clearPeople } from "../site/js/repo/people.js";
import * as projects from "../site/js/repo/projects.js";
import { maskAmounts } from "../site/js/money-mask.js";
import { scrubMoney } from "../site/js/scrub-money.js";
import * as M from "../site/js/map/pm.js";
import { toGroups } from "../site/js/map/search.js";
import { lineLabel, toLedgerRow, searchMatch } from "../site/js/map/ledger.js";
import * as EF from "../site/js/expense-filter.js";
import * as ledger from "../site/js/repo/ledger.js";

const read = (p) => readFileSync(new URL("../site/" + p, import.meta.url), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const skip = !available && "the demo database (tools/fake) is not here";

/* ── the Progress Chart ───────────────────────────────────────────────── */
const AMOUNTS = ["400", "1,200", "12,000", "300", "900", "5k", "4170"];
const found = (x) => AMOUNTS.filter((a) => JSON.stringify(x).includes(a));
function chartRows() {
  return {
    project: { id: 7, number: "A267", name: "Sandbox Residence", status: "in_progress", created_at: "2026-09-01T17:00:00Z", version: 1 },
    activity: [],
    estimates: [{ id: 10, number: 1, kind: "estimate", co_number: null, name: "Option B 12,000 dollars", status: "draft", group_order: [] }],
    items: [{ id: 21, estimate_id: 10, group_name: "Deposit 1,200", sort: 1, name: "Framing 400 dollars", description: "Paid 300 to framer",
      material_description: "Cedar 5k budget", item_type: "both", assigned_text: "Framer paid 4170" }],
    totals: [], itemPrices: [], flags: [], quotes: [], contacts: [],
    takeoffs: [{ id: 1, estimate_item_id: 21, name: "Rail 900 dollars", rows: 2 }],
    tasks: [], files: [],
  };
}

test("Progress Chart: without prices the item's, group's, estimate's and takeoff's words are amount-free by the database's rule (the page's maskAmounts mask)", () => {
  const p = M.toPayload(chartRows(), { today: "2026-10-27", prices: false, mask: (t) => maskAmounts(t == null ? "" : String(t)) });
  assert.deepEqual(found(p), [], "no amount anywhere in the payload");
  const it = p.items[0];
  assert.deepEqual([it.name, it.groupName, it.estimateName, it.laborNames, it.materialNames, it.assignees, it.takeoff.names],
    ["Framing [amount]", "[amount]", "Option B [amount]", ["[amount] to framer"], ["Cedar [amount]"], [{ name: "Framer [amount]" }], ["Rail [amount]"]]);
  assert.equal(it.logName, "Framing [amount]", "the quick note's name: the database's scrub rule, as before");
  // no mask said: the same rule
  assert.deepEqual(found(M.toPayload(chartRows(), { today: "2026-10-27", prices: false })), []);
});

test("Progress Chart: with prices the words as typed; the worksite copy (every role) amount-free by the same rule; logName unchanged", () => {
  const p = M.toPayload(chartRows(), { today: "2026-10-27", prices: true, money: true });
  const it = p.items[0];
  assert.deepEqual([it.name, it.groupName, it.estimateName, it.laborNames, it.materialNames, it.assignees, it.takeoff.names],
    ["Framing 400 dollars", "Deposit 1,200", "Option B 12,000 dollars", ["Paid 300 to framer"], ["Cedar 5k budget"], [{ name: "Framer paid 4170" }], ["Rail 900 dollars"]]);
  assert.equal(it.logName, scrubMoney("Framing 400 dollars"));
  const w = M.worksitePayload(p);
  assert.deepEqual(found(w.items), [], "a price person's worksite copy");
  assert.equal(w.items[0].name, "Framing [amount]");
  // the page and the printed report hand the page's mask on: toPayload does the rest
  assert.ok(/state\.mask = maskFor\(me\);/.test(code(read("js/pages/pm.js"))), "the chart");
  assert.ok(/pmRepo\.load\(pid, me, \{ mask: maskFor\(me\),/.test(code(read("js/pages/report-pm.js"))), "the printed chart");
});

/* ── the global search ────────────────────────────────────────────────── */
const ROWS = () => ({
  projects: [], contacts: [],
  items: [{ id: 1, project_id: 7, project_number: "A267", name: "Framing 400 dollars", group_name: "Deposit 1,200" },
    { id: 2, project_id: 7, project_number: "A267", name: "Deck boards", group_name: "Deck", material_description: "Cedar 2x6" },
    { id: 3, project_id: 7, project_number: "A267", name: "Posts", group_name: "Deck", description: "Allowance 12,000" }],
  tasks: [{ id: 4, project_id: 7, title: "Deck work", description: "stain the deck", category: "Finish", status: "open" }],
  files: [],
});
// what the database answers q with: the rows whose searched words hold it as typed (public.search, any case)
const SEARCHED = { items: ["name", "description", "group_name", "material_description"], tasks: ["title", "description", "category"] };
const DB = (q) => {
  const a = ROWS(), n = q.trim().toLowerCase();
  Object.keys(SEARCHED).forEach((k) => { a[k] = a[k].filter((r) => SEARCHED[k].some((f) => String(r[f] || "").toLowerCase().includes(n))); });
  return a;
};
const NO = { mask: maskAmounts, prices: false };
const hits = (q, opts) => toGroups(DB(q), Object.assign({ q }, opts)).map((g) => [g.key, g.items.map((i) => i.title + " | " + i.sub)]);

test("global search: without prices an item's name and group show and match by the database's rule - \"400\" never finds \"Framing 400 dollars\"", () => {
  assert.deepEqual(hits("400", NO), []);
  assert.deepEqual(hits("1,200", NO), [], "its group as shown");
  assert.deepEqual(hits("dollars", NO), [], "a word the page hides");
  assert.deepEqual(hits("framing", NO), [["items", ["Framing [amount] | A267 · [amount]"]]]);
  assert.deepEqual(found(toGroups(DB("framing"), Object.assign({ q: "framing" }, NO))), []);
  // with prices: as typed
  assert.deepEqual(hits("400", { mask: (t) => t, prices: true }), [["items", ["Framing 400 dollars | A267 · Deposit 1,200"]]]);
});

test("global search: without prices a hit found through words the page doesn't show stays (material, a task's description), unless the words typed hold a digit", () => {
  assert.deepEqual(hits("cedar", NO), [["items", ["Deck boards | A267 · Deck"]]], "its material description");
  assert.deepEqual(hits("stain", NO), [["tasks", ["Deck work | Open"]]], "its description");
  assert.deepEqual(hits("finish", NO), [["tasks", ["Deck work | Open"]]], "its category");
  assert.deepEqual(hits("12,000", NO), [], "an amount in a description is never found by typing it");
  assert.deepEqual(hits("cedar", { mask: (t) => t, prices: true }), hits("cedar", NO));
  assert.deepEqual(hits("12,000", { mask: (t) => t, prices: true }), [["items", ["Posts | A267 · Deck"]]]);
});

/* ── the expense ledger's estimate lines ──────────────────────────────── */
test("ledger: lineLabel without prices is amount-free by the database's rule; with prices (or not said) as typed", () => {
  const item = { id: 5, name: "Rail $12,000", group_name: "Deposit 1,200" };
  const co = { kind: "change_order", co_number: 2 };
  const hidden = lineLabel(item, co, false);
  assert.equal(hidden, "CO #2 · [amount] — Rail (amount hidden) · line #5");   // round 5: the line's id (p7-est-v223-fix5)
  assert.equal(lineLabel({ id: 6, name: "Walls", group_name: "Framing 400 dollars" }, null, false), "Framing [amount] — Walls · line #6");
  assert.equal(lineLabel({ id: 7, name: "", description: "Paid 300 to framer" }, null, false), "[amount] to framer · line #7");
  for (const p of [true, undefined]) assert.equal(lineLabel(item, co, p), "CO #2 · Deposit 1,200 — Rail $12,000");
  // the Expenses row, its search and its line filter: what is shown
  const ctx = (prices) => ({ items: { 5: Object.assign({ estimate_id: 3 }, item) }, estimates: { 3: co }, prices });
  const cost = { id: 1, project_id: 7, estimate_item_id: 5, kind: "material", cost_date: "2026-10-20", amount: 55, description: "Lumber" };
  const row = toLedgerRow(cost, ctx(false));
  assert.equal(row.group, hidden);
  assert.equal(EF.groupOf(row), hidden);
  assert.equal(searchMatch(row, "1,200"), false);
  assert.equal(toLedgerRow(cost, ctx(true)).group, "CO #2 · Deposit 1,200 — Rail $12,000");
});

test("ledger pages: the cost dialog's lines, the Expenses tab, its printed report and the ledger say the prices switch", () => {
  const has = (file, re) => assert.ok(re.test(code(read(file))), file + " " + re);
  has("js/pages/expense-dialog.js", /repo\.lineChoices\(ctx\.pid, line, !!ctx\.prices\)/);
  has("js/pages/project-expenses.js", /repo\.projectExpenses\(st\.ctx\.pid, \{ prices: !!st\.ctx\.prices \}\)/);
  has("js/pages/report-expenses.js", /repo\.projectExpenses\(pid, \{ prices: seesPrices\(me\) \}\)/);
  has("js/pages/ledger.js", /repo\.loadLedger\(\{ prices: seesPrices\(state\.me\) \}\)/);
  has("js/pages/project.js", /ctx\.prices = seesPrices\(ctx\.me\);/);     // the tab's ctx carries it
});

test("ledger repo: lineChoices, projectExpenses and loadLedger without prices name the line amount-free; the cost stays booked to it", { skip }, async () => {
  const e = await freshEngine();
  const pid = e.rows.projects.find((p) => p.number === "A267").id;
  const who = await person("admin");
  clearPeople();
  projects.forgetProjects();
  useClient(clientAs(e, who.id));
  try {
    const first = (await ledger.lineChoices(pid))[0];
    const it = e.rows.estimate_items.find((i) => i.id === first.id);
    Object.assign(it, { name: "Framing 400 dollars", group_name: "Deposit 1,200" });
    const cost = await ledger.addCost({ project_id: pid, kind: "material", cost_date: "2026-10-20", description: "Made-up lumber", amount: 55,
      estimate_item_id: it.id, card: "untagged" });
    const leaks = (s) => ["400", "1,200", "dollars"].filter((a) => String(s).includes(a));
    const label = (await ledger.lineChoices(pid, null, false)).find((l) => l.id === it.id).label;
    assert.deepEqual(leaks(label), [], label);
    assert.match(label, /\[amount\]/);
    assert.equal((await ledger.lineChoices(pid, null, true)).find((l) => l.id === it.id).label, "Deposit 1,200 — Framing 400 dollars");
    const tab = (await ledger.projectExpenses(pid, { prices: false })).find((r) => r.id === cost.id);
    assert.deepEqual([tab.itemId, leaks(tab.group)], [it.id, []]);
    assert.deepEqual(leaks((await ledger.loadLedger({ prices: false })).rows.find((r) => r.id === cost.id).group), []);
    assert.equal((await ledger.projectExpenses(pid, { prices: true })).find((r) => r.id === cost.id).group, "Deposit 1,200 — Framing 400 dollars");
    assert.equal(e.rows.estimate_items.find((i) => i.id === it.id).name, "Framing 400 dollars", "nothing written back");
  } finally { useClient(null); }
});
