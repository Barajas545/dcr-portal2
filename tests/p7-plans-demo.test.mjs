// The plan buttons (owner decisions 2026-10-26) over the demo database: tools/fake/p7-onedrive.js's plans_for - the
// broker's stand-in and its made-up takeoff folder ("Projects-Takeoff-Files") - reached through site/js/repo/onedrive.js
// and site/js/pages/plan-buttons.js exactly as the pages reach them, as each role. The REAL broker: DCR Desktop 2
// supabase/functions/onedrive/*_test.ts (and tools/schema-check-p7-onedrive.mjs once it has plans_for). Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { available, loadFake, freshEngine, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as onedrive from "../site/js/repo/onedrive.js";
import { paintPlans } from "../site/js/pages/plan-buttons.js";

const skip = !available && "the demo database (tools/fake) is not here";
let F, E;
async function setup() {
  F = await loadFake();
  E = await freshEngine(new Date());
}
const id = (key) => F.PEOPLE.find((p) => p.key === key).id;
const ext = () => E.exts.find((x) => x.name === "p7-onedrive");
const project = (number) => E.rows.projects.find((p) => p.number === number);
function as(key) {
  const c = clientAs(E, key ? id(key) : null);
  const calls = [];
  useClient({ from: c.from, rpc: c.rpc, storage: c.storage,
    functions: { invoke: (name, o) => { calls.push([name, o && o.body]); return c.functions.invoke(name, o); } } });
  onedrive.forgetPlans();
  return calls;
}
async function refusal(p) {
  try { await p; } catch (e) { return e; }
  assert.fail("expected a refusal");
}
// the made-up takeoff folder (the fake's header): what each project's folder(s) hold
const WANT = { A267: 3, A024: 1, "A024-B": 2, A120: 2, A005: 1, A007: 2, A003: 0, A001: 0, A000T2: 0, A305: 1, A304: 0 };

test("demo plans_for: every active person gets the same counts (decision 2) - at any depth, a suffix number's folder apart, two folders added", { skip }, async () => {
  await setup();
  const ids = Object.keys(WANT).map((n) => project(n).id);
  const expected = {};
  for (const n of Object.keys(WANT)) expected[String(project(n).id)] = { number: n, plans: WANT[n] };
  for (const key of ["admin", "manager", "manager_prices", "accountant", "lead", "field", "viewer", "newhire"]) {
    const calls = as(key);
    assert.deepEqual(await onedrive.plansFor(ids), expected, key);
    assert.deepEqual(calls, [["onedrive", { op: "plans_for", project_ids: ids }]], key + ": one call");
  }
});

test("demo plans_for: the answer carries no name, item id or link; a deleted project is left out (an admin's ask too)", { skip }, async () => {
  await setup();
  const gone = project("A150");
  gone.deleted_at = new Date().toISOString();
  for (const key of ["admin", "field"]) {
    as(key);
    const raw = await onedrive.call({ op: "plans_for", project_ids: [project("A267").id, gone.id, 999999] });
    assert.deepEqual(Object.keys(raw).sort(), ["checked_at", "projects"]);
    assert.ok(!isNaN(Date.parse(raw.checked_at)));
    assert.deepEqual(raw.projects, { [String(project("A267").id)]: { number: "A267", plans: 3 } }, key);
    assert.ok(Object.values(raw.projects).every((p) => Object.keys(p).join() === "number,plans"), "only the number and the count");
    assert.ok(!/takeoff|Test Way|Sandbox|01DEMO|https?:|\//i.test(JSON.stringify(raw)), JSON.stringify(raw));
  }
});

test("demo plans_for: who - the agents account and a turned-off person refused, signed out 401; the body's rules", { skip }, async () => {
  await setup();
  const one = [project("A267").id];
  for (const key of ["agents", "inactive"]) { as(key); assert.equal((await refusal(onedrive.plansFor(one))).code, "forbidden", key); }
  as(null);
  assert.equal((await refusal(onedrive.plansFor(one))).code, "auth");
  as("field");
  const many = Array.from({ length: 51 }, (_, i) => i + 1);
  for (const body of [{ project_ids: [] }, { project_ids: many }, { project_ids: [1, 1] }, { project_ids: [0] }, { project_ids: ["7"] },
    { project_ids: 7 }, {}, { project_ids: [1], project_id: 1 }]) {
    const e = await refusal(onedrive.call(Object.assign({ op: "plans_for" }, body)));
    assert.deepEqual([e.code, e.status], ["invalid", 400], JSON.stringify(body));
  }
  // fifty is the limit, not an error
  assert.equal(Object.keys(await onedrive.call({ op: "plans_for", project_ids: many.slice(0, 50) })).length, 2);
});

test("demo plans_for: the takeoff folder not set up - 503 takeoff_not_configured, a quiet empty answer, no button drawn", { skip }, async () => {
  await setup();
  ext().setTakeoff(false);
  try {
    as("admin");
    const e = await refusal(onedrive.call({ op: "plans_for", project_ids: [project("A267").id] }));
    assert.deepEqual([e.code, e.status], ["takeoff_not_configured", 503]);
    assert.deepEqual(await onedrive.plansFor([project("A267").id]), {});
    const slot = { attrs: { "data-plans": String(project("A267").id), "data-plans-style": "icon" }, hidden: true, innerHTML: "",
      getAttribute(n) { return this.attrs[n] || null; } };
    assert.equal(await paintPlans({ querySelectorAll: () => [slot] }, { role: "admin", active: true }), 0);
    assert.deepEqual([slot.hidden, slot.innerHTML], [true, ""]);
  } finally { ext().setTakeoff(null); }
  as("admin");
  assert.deepEqual(await onedrive.plansFor([project("A267").id]), { [String(project("A267").id)]: { number: "A267", plans: 3 } }, "on again");
});

test("demo plan buttons: Search's slots as a field person - A267, A024-B and A120 get theirs, A001 and A003 none", { skip }, async () => {
  await setup();
  as("field");
  const numbers = ["A267", "A024-B", "A120", "A001", "A003"];
  const made = numbers.map((n) => ({ n, attrs: { "data-plans": String(project(n).id), "data-plans-style": "icon" }, hidden: true, innerHTML: "",
    getAttribute(k) { return this.attrs[k] || null; } }));
  assert.equal(await paintPlans({ querySelectorAll: () => made }, { role: "field", active: true }), 3);
  assert.deepEqual(made.map((s) => [s.n, !s.hidden]), [["A267", true], ["A024-B", true], ["A120", true], ["A001", false], ["A003", false]]);
  assert.match(made[1].innerHTML, /#plans=A024-B" target="_blank" rel="noopener" aria-label="Plans for A024-B — open in the takeoff app" title="2 takeoff files for A024-B/);
});
