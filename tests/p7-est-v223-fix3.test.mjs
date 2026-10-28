// DCR 2.23 third review round, the Portal 2 side. R3C5: a New item tapped while the device has no signal
// (navigator.onLine === false) is never sent, so it is not a maybe-added - the sheet says "Can't reach the server",
// keeps what was typed and Add item stays on; once the signal is back the same tap adds it, once. R3C3's Portal side:
// a person without prices searches what they are shown - the global search (its database matches the words as typed,
// for every caller), Leads, Marketing and Vehicles match the masked words, so typing "12,000" and watching which rows
// stay can't spell out "(amount hidden)". Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeDom } from "./console/console-page-dom.mjs";
import { makeClient } from "./pages-stub.mjs";
import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as common2 from "../site/js/common2.js";
import { maskAmounts } from "../site/js/money-mask.js";
import { toGroups, LIMIT } from "../site/js/map/search.js";
import * as searchRepo from "../site/js/repo/search.js";
import * as L from "../site/js/map/leads.js";
import * as MK from "../site/js/map/marketing.js";
import * as V from "../site/js/map/vehicles.js";

const read = (p) => readFileSync(new URL("../site/" + p, import.meta.url), "utf8");

const skip = !available && "the demo database (tools/fake) is not here";
const SANDBOX = 268;   // A267, the sandbox project
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("R3C5 New item: Add item with no signal sends nothing, says \"Can't reach the server\", keeps the typed values and Add item on; back online the same tap adds it once", { skip }, async () => {
  const navWas = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const net = { onLine: false };
  Object.defineProperty(globalThis, "navigator", { value: net, configurable: true, writable: true });
  globalThis.Node = class { static [Symbol.hasInstance](x) { return !!x && typeof x.nodeType === "number"; } };
  globalThis.window = { DCR2: common2.DCR2, addEventListener() {}, removeEventListener() {} };
  globalThis.document = makeDom();
  globalThis.getComputedStyle = () => ({ lineHeight: "21px" });
  try {
    const page = await import("../site/js/pages/project-estimate-edit.js");
    const e = await freshEngine();
    const c = clientAs(e, (await person("estimator")).id);
    let adds = 0;
    const orig = c.rpc;
    c.rpc = (n, a) => {
      if (n !== "add_estimate_item") return orig(n, a);
      adds++;
      // what supabase-js gives when fetch fails at once: no code, status 0
      if (net.onLine === false) return Promise.resolve({ data: null, error: { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" }, status: 0 });
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
    nameBox.value = "No signal post";
    document._dispatch(nameBox, { type: "input" });
    const rows = () => e.rows.estimate_items.filter((i) => i.name === "No signal post" && !i.deleted_at).length;
    const save = () => document.getElementById("esSave");
    const err = () => document.getElementById("esSheetErr").textContent;

    // no signal: nothing leaves the device, nothing may have been added
    save().click();
    await sleep(100);
    assert.deepEqual([rows(), adds, save().disabled], [0, 0, false], "not sent; Add item stays on");
    assert.match(err(), /Can't reach the server/);
    assert.doesNotMatch(err(), /may already have been added/);
    assert.equal(document.getElementById("ef_name").value, "No signal post", "what was typed is kept");
    // Enter in a box: still nothing sent
    const box = document.querySelectorAll("#esSheet input").find((n) => !n.disabled);
    document._dispatch(box, { type: "keydown", key: "Enter" });
    await sleep(100);
    assert.deepEqual([rows(), adds, save().disabled], [0, 0, false]);

    // the signal is back: the same tap adds it, once
    net.onLine = true;
    save().click();
    await sleep(150);
    assert.deepEqual([rows(), adds], [1, 1], "one add, one item");
    assert.equal(asked.length, 0, "never \"Close this item?\"");
  } finally {
    useClient(null);
    delete globalThis.document; delete globalThis.window; delete globalThis.Node; delete globalThis.getComputedStyle;
    if (navWas) Object.defineProperty(globalThis, "navigator", navWas); else delete globalThis.navigator;
  }
});

/* ── R3C3 (Portal): search what is shown ──────────────────────────────── */
const ANSWER = () => ({
  projects: [{ id: 7, number: "A267", name: "Sandbox Residence", status: "in_progress" }],
  contacts: [],
  items: [{ id: 4, estimate_id: 2, project_id: 7, project_number: "A267", name: "Rail $12,000", group_name: "Deck" },
    { id: 5, estimate_id: 2, project_id: 7, project_number: "A267", name: "Posts", group_name: "Extras $12,000 allowance" },
    { id: 6, estimate_id: 2, project_id: 7, project_number: "A267", name: "Rail 12,000 lf", group_name: "Deck" }],
  tasks: [{ id: 1, project_id: 7, title: "Pay the yard $12,000", status: "open" }],
  files: [{ id: 9, project_id: 7, folder: "documents", name: "Bid $12,000.pdf", version_no: 1 }],
});
// what the database answers q with: the rows whose searched words hold it as typed (public.search, any case)
const SEARCHED = { projects: ["number", "name"], items: ["name", "description", "group_name", "material_description"],
  tasks: ["title", "description", "category"], files: ["name"] };
const DB = (q) => {
  const a = ANSWER(), n = q.trim().toLowerCase();
  Object.keys(SEARCHED).forEach((k) => { a[k] = a[k].filter((r) => SEARCHED[k].some((f) => String(r[f] || "").toLowerCase().includes(n))); });
  return a;
};

test("R3C3 global search: without prices an item, task or file stays only when the words typed are in what is shown (masked); with prices the database's answer as it is", async () => {
  const hidden = toGroups(ANSWER(), { mask: maskAmounts, prices: false, q: " 12,000 " });
  assert.deepEqual(hidden.map((g) => [g.key, g.items.map((i) => i.title)]), [["projects", ["A267 — Sandbox Residence"]], ["items", ["Rail 12,000 lf"]]],
    "\"Rail (amount hidden)\", \"Extras (amount hidden) allowance\", the task and the file are not kept; the words as shown are");
  assert.doesNotMatch(JSON.stringify(hidden), /\$\s?\d/);
  // what is shown is still found: the masked words themselves, any case
  assert.deepEqual(toGroups(DB("RAIL"), { mask: maskAmounts, prices: false, q: "RAIL" })[0].items.map((i) => i.title), ["Rail (amount hidden)", "Rail 12,000 lf"]);
  // (every row as the answer: "Rail 12,000 lf" in the group "Deck" holds no "amount hidden" as typed either, so only
  // words the page doesn't show could have found it - kept, as a description's hit; round 4)
  assert.deepEqual(toGroups(ANSWER(), { mask: maskAmounts, prices: false, q: "amount hidden" }).map((g) => [g.key, g.total]),
    [["projects", 1], ["items", 3], ["tasks", 1], ["files", 1]]);
  assert.deepEqual(toGroups(DB("deck"), { mask: maskAmounts, prices: false, q: "deck" })[0].items.map((i) => i.title), ["Rail (amount hidden)", "Rail 12,000 lf"], "the group's name");
  // with prices (or no flag): as the database answered
  for (const opts of [{ prices: true, q: "12,000" }, { q: "12,000" }, { mask: maskAmounts, q: "12,000" }]) {
    assert.deepEqual(toGroups(ANSWER(), opts).map((g) => [g.key, g.total]), [["projects", 1], ["items", 3], ["tasks", 1], ["files", 1]], JSON.stringify(opts));
  }
  // "more" is the database's own limit, before the hits left out
  const many = { items: Array.from({ length: LIMIT }, (_, n) => ({ id: n + 1, project_id: 7, name: n ? "Rail $12,000" : "Rail 12,000 lf", group_name: "" })) };
  const g = toGroups(many, { mask: maskAmounts, prices: false, q: "12,000" });
  assert.deepEqual([g[0].total, g[0].more], [1, true]);
});

test("R3C3 global search: repo search() hands the words typed to the filter, and the page passes its prices switch", async () => {
  const c = makeClient({}, { search: () => ({ data: ANSWER(), error: null }) });
  useClient(c);
  try {
    const g = await searchRepo.search("12,000", { mask: maskAmounts, prices: false });
    assert.deepEqual(g.map((x) => [x.key, x.total]), [["projects", 1], ["items", 1]]);
    assert.deepEqual((await searchRepo.search("12,000", { prices: true })).map((x) => [x.key, x.total]), [["projects", 1], ["items", 3], ["tasks", 1], ["files", 1]]);
  } finally { useClient(null); }
  assert.match(read("js/pages/search.js"), /searchRepo\.search\(q, \{.*, mask: mask, prices: seesPrices\(me\) \}\);/);
});

test("R3C3 Leads, Marketing, Vehicles: the search box matches the words as the page shows them (its mask), so a hidden amount is never found", () => {
  const leads = [{ id: 1, leadClientName: "Rowan", leadDate: "2026-10-18", leadNotes: "budget $12,000 firm", leadSource: "Web $500 ad" },
    { id: 2, leadClientName: "Marisol", leadDate: "2026-10-09", leadNotes: "12,000 sf", leadClientPhone: "805-555-0100" }];
  assert.deepEqual(L.visibleLeads(leads, { q: "12,000", mask: maskAmounts }).map((l) => l.id), [2]);
  assert.deepEqual(L.visibleLeads(leads, { q: "$500", mask: maskAmounts }).map((l) => l.id), []);
  assert.deepEqual(L.visibleLeads(leads, { q: "budget hidden", mask: maskAmounts }).map((l) => l.id), [1], "the masked words are found");
  assert.deepEqual(L.visibleLeads(leads, { q: "555-0100", mask: maskAmounts }).map((l) => l.id), [2], "the phone as typed");
  assert.deepEqual(L.visibleLeads(leads, { q: "12,000" }).map((l) => l.id), [1, 2], "with prices: as typed");
  assert.match(read("js/pages/leads.js"), /visibleLeads\(state\.leads, \{ show: state\.show, cat: state\.cat, q: state\.q, mask: state\.mask \}\)/);

  const tasks = [{ id: 1, marketingTaskName: "Drone $1,200 flyover", projectID: null, marketingTaskDate: "2026-10-19" },
    { id: 2, marketingTaskName: "Photos", marketingTaskDescripiton: "paid $1,200", projectID: null, marketingTaskDate: "2026-10-12" },
    { id: 3, marketingTaskName: "Signs", marketingTaskCaterogy: "Print $1,200", marketingTaskCompletedWork: "1,200 flyers", projectID: null, marketingTaskDate: "2026-10-11" }];
  const ids = (gs) => gs.flatMap((x) => x.rows.map((t) => t.id));
  assert.deepEqual(ids(MK.groups(tasks, { filter: "all", q: "1,200", mask: maskAmounts })), [3], "only the words shown");
  assert.deepEqual(ids(MK.groups(tasks, { filter: "all", q: "drone hidden", mask: maskAmounts })), [1]);
  assert.deepEqual(ids(MK.groups(tasks, { filter: "all", q: "1,200" })), [1, 2, 3], "with prices: as typed");
  assert.match(read("js/pages/marketing.js"), /groups\(state\.tasks, \{ filter: state\.filter, q: state\.q, byId: state\.byId, mask: state\.mask \}\)/);

  const vs = [{ id: 1, fleetNumber: "T-01", vehicleDescription: "Crew truck $9,500 lift", vehicleDriverInformation: "Jordan", insuranceProvider: "Acme" },
    { id: 2, fleetNumber: "T-02", vehicleDescription: "Flatbed", vehicleDriverInformation: "Sam ($200 deposit)", insuranceProvider: "Acme 9,500" },
    { id: 3, fleetNumber: "T-03", vehicleDescription: "Van", insuranceProvider: "Policy $9,500 deductible" }];
  const found = (q, opts) => V.board(vs, [], "2026-10-27", q, opts).all.map((x) => x.v.id);
  assert.deepEqual(found("9,500", { mask: maskAmounts }), [2], "the label and the insurer as shown");
  assert.deepEqual(found("$200", { mask: maskAmounts }), [], "the driver as shown");
  assert.deepEqual(found("lift", { mask: maskAmounts }), [1]);
  assert.deepEqual(found("9,500", {}), [1, 2, 3], "with prices: as typed");
  assert.match(read("js/pages/vehicles.js"), /board\(state\.vehicles, state\.maint, t, state\.q, \{ retired: state\.retired, mask: state\.mask \}\)/);
});
