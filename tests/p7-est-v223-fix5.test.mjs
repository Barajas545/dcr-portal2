// DCR 2.23 fifth review round, the Portal 2 side: without prices an estimate line's label is amount-free (round 4,
// map/ledger.js lineLabel) AND still names one line. The label is the key the Expenses tab's bands and subtotals, its
// "Line:" filter, the printed expense report and the cost dialog's choices go by, so two lines whose words differ only
// by an amount ("Rail $900", "Rail $1,200") must not read alike: a label with words hidden ends in the line's id
// (" · line #5", not an amount). Labels for people with prices are as typed. Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import { clearPeople } from "../site/js/repo/people.js";
import * as projects from "../site/js/repo/projects.js";
import { lineLabel, toLedgerRow } from "../site/js/map/ledger.js";
import * as EF from "../site/js/expense-filter.js";
import * as ledger from "../site/js/repo/ledger.js";

const skip = !available && "the demo database (tools/fake) is not here";
const est = { id: 3, kind: "estimate" };
const ITEMS = { 5: { id: 5, estimate_id: 3, name: "Rail $900", group_name: "Deck" }, 6: { id: 6, estimate_id: 3, name: "Rail $1,200", group_name: "Deck" } };
const COSTS = [
  { id: 1, project_id: 7, estimate_item_id: 5, kind: "material", cost_date: "2026-10-20", amount: 100, description: "Lumber A" },
  { id: 2, project_id: 7, estimate_item_id: 6, kind: "material", cost_date: "2026-10-21", amount: 250, description: "Lumber B" },
];
const rows = (prices) => COSTS.map((c) => toLedgerRow(c, { items: ITEMS, estimates: { 3: est }, prices }));
const bands = (prices) => EF.group(rows(prices)).map((g) => [g.name, g.rows.map((r) => r.id), EF.totals(g.rows).cost]);
const leaks = (s) => ["900", "1,200"].filter((a) => String(s).includes(a));

test("ledger: without prices two lines that differ only by an amount keep two labels, two bands and two filter choices", () => {
  const a = lineLabel(ITEMS[5], est, false), b = lineLabel(ITEMS[6], est, false);
  assert.notEqual(a, b);
  assert.deepEqual([a, b], ["Deck — Rail (amount hidden) · line #5", "Deck — Rail (amount hidden) · line #6"]);
  assert.deepEqual(leaks(a + b), []);
  assert.deepEqual(bands(false), [["Deck — Rail (amount hidden) · line #5", [1], 100], ["Deck — Rail (amount hidden) · line #6", [2], 250]]);
  // the "Line:" filter (project-expenses.js: one option per EF.groupOf; EF.filter compares it)
  const r = rows(false);
  assert.deepEqual(EF.filter(r, Object.assign(EF.defaults(), { group: a })).map((x) => x.id), [1]);
  assert.deepEqual(EF.filter(r, Object.assign(EF.defaults(), { group: b })).map((x) => x.id), [2]);
});

test("ledger: with prices (or not said) the labels are as typed, no id; a line with nothing hidden has no id either", () => {
  for (const p of [true, undefined]) {
    assert.deepEqual(bands(p), [["Deck — Rail $1,200", [2], 250], ["Deck — Rail $900", [1], 100]]);
    assert.equal(lineLabel(ITEMS[5], est, p), "Deck — Rail $900");
  }
  assert.equal(lineLabel({ id: 8, name: "Walls 2x6", group_name: "Framing" }, est, false), "Framing — Walls 2x6");
  assert.equal(lineLabel({ id: 9, name: "Walls", group_name: "Deposit 1,200" }, { kind: "change_order", co_number: 2 }, false),
    "CO #2 · [amount] — Walls · line #9", "a hidden group name");
});

test("ledger repo: the cost dialog's choices without prices tell two such lines apart; the cost is booked to the one chosen", { skip }, async () => {
  const e = await freshEngine();
  const pid = e.rows.projects.find((p) => p.number === "A267").id;
  const who = await person("admin");
  clearPeople();
  projects.forgetProjects();
  useClient(clientAs(e, who.id));
  try {
    const [first, second] = await ledger.lineChoices(pid);
    const one = e.rows.estimate_items.find((i) => i.id === first.id), two = e.rows.estimate_items.find((i) => i.id === second.id);
    Object.assign(one, { name: "Rail $900", group_name: "Deck" });
    Object.assign(two, { name: "Rail $1,200", group_name: "Deck", estimate_id: one.estimate_id });
    const choices = (await ledger.lineChoices(pid, null, false)).filter((l) => l.id === one.id || l.id === two.id);
    assert.equal(choices.length, 2);
    assert.notEqual(choices[0].label, choices[1].label);
    assert.deepEqual(leaks(choices.map((l) => l.label).join(" ")), []);
    const cost = await ledger.addCost({ project_id: pid, kind: "material", cost_date: "2026-10-20", description: "Made-up lumber", amount: 55,
      estimate_item_id: two.id, card: "untagged" });
    const tab = (await ledger.projectExpenses(pid, { prices: false })).find((r) => r.id === cost.id);
    assert.deepEqual([tab.itemId, tab.group], [two.id, choices.find((l) => l.id === two.id).label], "its band: the label it was chosen by");
    assert.equal(e.rows.estimate_items.find((i) => i.id === two.id).name, "Rail $1,200", "nothing written back");
  } finally { useClient(null); }
});
