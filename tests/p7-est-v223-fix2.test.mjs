// DCR 2.23 second review round, the Portal 2 side (findings RC4, RC5): a New item whose add got no answer may be in
// the estimate already - its sheet never sends it again and closing it only asks "Close this item?" (RC4, as DCR
// Desktop 2's item editor); group names are never inherited keys in the PM model's and the editor's group maps (RC5:
// "Constructor", "__proto__"); a deadlock (40P01) reads as a conflict, as 40001 does (DCR Desktop 2's errors.py).
// Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { makeDom } from "./console/console-page-dom.mjs";
import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as M from "../site/js/map/estimate-edit.js";
import * as PM from "../site/js/map/pm.js";
import * as common2 from "../site/js/common2.js";

const skip = !available && "the demo database (tools/fake) is not here";
const SANDBOX = 268;   // A267, the sandbox project
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── RC4: an add whose answer was lost is never sent again ─────────────── */
test("RC4 New item: an add whose answer was lost (no database code) turns Add item off for good, says it may have been added, and closing asks only \"Close this item?\"; a database refusal keeps Save changes?", { skip }, async () => {
  globalThis.Node = class { static [Symbol.hasInstance](x) { return !!x && typeof x.nodeType === "number"; } };
  globalThis.window = { DCR2: common2.DCR2, addEventListener() {}, removeEventListener() {} };
  globalThis.document = makeDom();
  globalThis.getComputedStyle = () => ({ lineHeight: "21px" });
  try {
    const page = await import("../site/js/pages/project-estimate-edit.js");
    const e = await freshEngine();
    const c = clientAs(e, (await person("estimator")).id);
    let mode = "", adds = 0;
    const orig = c.rpc;
    c.rpc = (n, a) => {
      if (n !== "add_estimate_item") return orig(n, a);
      adds++;
      const m = mode;
      mode = "";
      // a database refusal: nothing is added, the answer has its SQLSTATE
      if (m === "refused") return Promise.resolve({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" }, status: 500 });
      // the server commits, the answer is lost on the way back
      if (m === "lost") return orig(n, a).then(() => ({ data: null, error: { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" }, status: 0 }));
      return orig(n, a);
    };
    useClient(c);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const asked = [];
    page.render({ pid: SANDBOX, toast() {}, errorText: common2.errorText, setEditing() {},
      confirm: async (text, opts) => { asked.push([opts && opts.title, text]); return true; } }, host);
    for (let i = 0; i < 50 && !document.querySelector(".es-card"); i++) await sleep(20);
    const deck = e.rows.estimates.find((x) => x.project_id === SANDBOX && x.name === "Deck option");
    host.querySelectorAll("[data-act=add]").find((b) => b.getAttribute("data-est") === String(deck.id)).click();
    await sleep(50);
    const nameBox = document.getElementById("ef_name");
    nameBox.value = "Lost reply post";
    document._dispatch(nameBox, { type: "input" });
    const rows = () => e.rows.estimate_items.filter((i) => i.name === "Lost reply post" && !i.deleted_at).length;
    const save = () => document.getElementById("esSave");
    const err = () => document.getElementById("esSheetErr").textContent;
    const modalOpen = () => { const mh = document.getElementById("dcrModalHost"); return !!mh && mh.classList.contains("open"); };

    // a database refusal: nothing went in, Add item stays on, closing asks "Save changes?"
    mode = "refused";
    save().click();
    await sleep(100);
    assert.deepEqual([rows(), adds, save().disabled], [0, 1, false], "refused: Add item may be tried again");
    assert.match(err(), /not answering/);
    document.querySelector("#esSheet .es-x").click();
    await sleep(50);
    assert.ok(modalOpen() && /Save changes\?/.test(document.getElementById("dcrModalHost").textContent), "Save changes?");
    document._dispatch(document.body, { type: "keydown", key: "Escape" });
    await sleep(50);
    assert.ok(!modalOpen() && !document.getElementById("esSheet").hidden, "Cancel: the sheet stays");

    // the answer is lost after the server added it
    mode = "lost";
    save().click();
    await sleep(100);
    assert.deepEqual([rows(), adds], [1, 2]);
    assert.ok(save().disabled, "Add item is off (setBusy did not turn it on again)");
    assert.match(err(), /may already have been added\. Close this sheet, read again \(↻\) and check the estimate/);
    // Enter in a box and the button itself send nothing
    const box = document.querySelectorAll("#esSheet input").find((n) => !n.disabled);
    document._dispatch(box, { type: "keydown", key: "Enter" });
    save().click();
    await sleep(100);
    assert.deepEqual([rows(), adds], [1, 2], "never sent again");
    // closing: the discard question only, never Save
    document.querySelector("#esSheet .es-x").click();
    await sleep(50);
    assert.ok(!modalOpen(), "no \"Save changes?\"");
    assert.equal(asked.length, 1);
    assert.equal(asked[0][0], "Close this item?");
    assert.match(asked[0][1], /may already have been added.*What is typed here is not kept\./);
    assert.ok(document.getElementById("esSheet").hidden, "closed");
    document._dispatch(document.body, { type: "keydown", key: "Enter" });
    await sleep(100);
    assert.deepEqual([rows(), adds], [1, 2], "one item, one add");
  } finally {
    useClient(null);
    delete globalThis.document; delete globalThis.window; delete globalThis.Node; delete globalThis.getComputedStyle;
  }
});

/* ── RC5: a group named "Constructor" or "__proto__" ───────────────────── */
test("RC5 group maps: a group named \"Constructor\" or \"__proto__\" is a group like any other in the PM model (orderItems, toPayload) and the editor (groupsInOrder), listed or not, empty or not", () => {
  const items = [
    { id: 1, sort: 1, group_name: "Constructor", name: "A" }, { id: 2, sort: 2, group_name: "__proto__", name: "B" },
    { id: 3, sort: 3, group_name: "Roof", name: "C" }, { id: 4, sort: 4, group_name: "constructor ", name: "D" },
  ];
  // the PM model's order
  assert.deepEqual(PM.orderItems(items, ["roof", "CONSTRUCTOR", "__proto__"]).map((i) => i.id), [3, 1, 4, 2], "listed");
  assert.deepEqual(PM.orderItems(items, []).map((i) => i.id).sort(), [1, 2, 3, 4], "unlisted: every item once");
  assert.deepEqual(PM.orderItems(items, ["Roof"]).slice(0, 1).map((i) => i.id), [3], "a listed group first, the others after");
  const p = PM.toPayload({
    estimates: [{ id: 10, number: 1, kind: "estimate", status: "approved", group_order: ["Constructor"] }],
    items: items.map((i) => Object.assign({ estimate_id: 10 }, i)),
  }, { today: "2026-10-27", prices: true, money: false });
  assert.deepEqual(p.items.map((i) => [i.itemId, i.groupName]), [[1, "Constructor"], [4, "Constructor"], [2, "__proto__"], [3, "Roof"]],
    "a group's name is its first item's spelling");
  // the editor's groups
  const g = M.groupsInOrder(items, ["__proto__", "Constructor"]);
  assert.deepEqual(g.map((s) => [s.name, s.items.map((i) => i.id)]), [["__proto__", [2]], ["Constructor", [1, 4]], ["Roof", [3]]]);
  assert.deepEqual(M.groupsInOrder(items, []).map((s) => s.items.map((i) => i.id).join()).sort(), ["1,4", "2", "3"], "unlisted");
  const empty = M.groupsInOrder([{ id: 3, sort: 1, group_name: "Roof" }], ["Constructor", "__proto__", "Roof"], { includeEmpty: true });
  assert.deepEqual(empty.map((s) => [s.name, s.items.length]), [["Constructor", 0], ["__proto__", 0], ["Roof", 1]], "listed empty groups are there");
});

/* ── a deadlock reads as a conflict ────────────────────────────────────── */
test("40P01 (deadlock) reads as 40001 does: a conflict, \"someone else saved\"", () => {
  for (const code of ["40001", "40P01"]) {
    const m = common2.mapError({ code, message: code === "40P01" ? "deadlock detected" : "could not serialize access due to concurrent update" });
    assert.deepEqual([m.status, m.kind, m.message, m.retryable], [409, "conflict", "Someone else saved this record while you were editing it.", false], code);
  }
});
