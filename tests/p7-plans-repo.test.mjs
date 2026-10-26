// The plan buttons (owner decisions 2026-10-26): site/js/repo/onedrive.js plansFor over a stub of supabase-js
// functions.invoke - the exact body of op plans_for (1 to 50 different project ids a call), how the answer is read
// (only {number, plans}; a malformed project left out, a project not asked never used), the answers kept in the page,
// the feature off (503 takeoff_not_configured, the function not deployed) as a quiet empty answer, the other errors
// thrown with the broker's codes (the pages say nothing: tests/p7-plans-pages.test.mjs) and a busy broker waited out;
// site/js/map/plans.js (the link, the button, the Floor Plans card per role) and site/js/pages/plan-buttons.js (the
// slots filled, or left hidden). Made-up numbers only.
import test from "node:test";
import assert from "node:assert/strict";
import { useClient } from "../site/js/repo/_db.js";
import * as onedrive from "../site/js/repo/onedrive.js";
import * as plans from "../site/js/map/plans.js";
import { paintPlans } from "../site/js/pages/plan-buttons.js";

function stub(answer) {
  const calls = [];
  useClient({ functions: { invoke: async (name, o) => { calls.push({ name, body: o && o.body }); return answer(o && o.body, name); } } });
  onedrive.forgetPlans();
  return calls;
}
const ok = (data) => ({ data, error: null });
const http = (status, body, headers) => ({ data: null, error: { name: "FunctionsHttpError",
  context: new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: Object.assign({ "content-type": "application/json" }, headers || {}) }) } });
/** the broker as the contract has it: each id asked -> its number and a count (made up) */
const broker = (counts) => (b) => {
  const projects = {};
  for (const id of b.project_ids) if (counts[id] !== undefined) projects[String(id)] = { number: "A" + String(id).padStart(3, "0"), plans: counts[id] };
  return ok({ projects, checked_at: "2026-10-26T18:00:00.000Z" });
};
async function refusal(p) {
  try { await p; } catch (e) { return e; }
  assert.fail("expected a refusal");
}
const FIELD = { role: "field", active: true };

test("plansFor: the contract's body - op plans_for, project_ids as different positive whole numbers; nothing sent for none", async () => {
  const calls = stub(broker({ 7: 2, 8: 0 }));
  const got = await onedrive.plansFor([7, "8", 7, " 8 ", "x", -1, 0, 1.5, null, "12345678901234567890", "9e2"]);
  assert.deepEqual(calls, [{ name: "onedrive", body: { op: "plans_for", project_ids: [7, 8] } }]);
  assert.deepEqual(got, { 7: { number: "A007", plans: 2 }, 8: { number: "A008", plans: 0 } });
  assert.deepEqual(await onedrive.plansFor([]), {});
  assert.deepEqual(await onedrive.plansFor(["x", 0, null]), {});
  assert.deepEqual(await onedrive.plansFor(undefined), {});
  assert.equal(calls.length, 1, "no call without a project");
  // one id on its own is taken too (the project page)
  const one = stub(broker({ 31: 1 }));
  assert.deepEqual(await onedrive.plansFor(31), { 31: { number: "A031", plans: 1 } });
  assert.deepEqual(one.map((c) => c.body.project_ids), [[31]]);
});

test("plansFor: at most 50 projects a call (the broker's limit), the answers merged", async () => {
  const counts = {};
  for (let i = 1; i <= 120; i++) counts[i] = i % 3;
  const calls = stub(broker(counts));
  const ids = Object.keys(counts).map(Number);
  const got = await onedrive.plansFor(ids);
  assert.equal(onedrive.PLANS_BATCH, 50);
  assert.deepEqual(calls.map((c) => c.body.project_ids.length), [50, 50, 20]);
  assert.deepEqual(calls.map((c) => c.body.project_ids[0]), [1, 51, 101]);
  assert.ok(calls.every((c) => new Set(c.body.project_ids).size === c.body.project_ids.length), "different ids in each call");
  assert.equal(Object.keys(got).length, 120);
  assert.deepEqual(got[119], { number: "A119", plans: 2 });
});

test("plansFor: only {number, plans} of the projects asked - a malformed project left out, names, ids and links never kept", async () => {
  stub(() => ok({ checked_at: "2026-10-26T18:00:00.000Z", projects: {
    1: { number: "A001", plans: 3, name: "A001 - 12 Made Up Way.takeoff", item_id: "01ABCDEFGH", url: "https://example.invalid/x", folders: ["x"] },
    2: { number: "A002", plans: -1 }, 3: { number: "A003", plans: "2" }, 4: { number: "", plans: 1 }, 5: { plans: 1 }, 6: null, 7: "A007",
    8: { number: "A008", plans: 1.5 }, 9: { number: "x".repeat(41), plans: 1 }, 10: { number: "A0\u000710", plans: 1 },
    11: { number: " A024-B ", plans: 2 }, 99: { number: "A099", plans: 4 },
  } }));
  const got = await onedrive.plansFor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(got, { 1: { number: "A001", plans: 3 }, 11: { number: "A024-B", plans: 2 } }, "a project not asked (99) is not used either");
  for (const bad of [ok(null), ok({}), ok({ projects: [] }), ok({ projects: "x" }), ok("x")]) {
    stub(() => bad);
    assert.deepEqual(await onedrive.plansFor([1]), {}, JSON.stringify(bad.data));
  }
});

test("plansFor: answers are kept in the page for PLANS_KEEP_MS (Search asks again as one types); only new projects are asked", async () => {
  const calls = stub(broker({ 1: 1, 2: 0 }));
  await onedrive.plansFor([1, 2, 3]);
  const again = await onedrive.plansFor([2, 1, 3]);
  assert.deepEqual(again, { 1: { number: "A001", plans: 1 }, 2: { number: "A002", plans: 0 } }, "3 was not in the answer: kept as not there");
  assert.equal(calls.length, 1, "nothing asked again");
  await onedrive.plansFor([1, 4]);
  assert.deepEqual(calls.map((c) => c.body.project_ids), [[1, 2, 3], [4]]);
  const real = Date.now;
  try {
    Date.now = () => real() + onedrive.PLANS_KEEP_MS + 1000;
    await onedrive.plansFor([1, 2]);
  } finally { Date.now = real; }
  assert.deepEqual(calls[2].body.project_ids, [1, 2], "asked again once the kept answer is old");
  onedrive.forgetPlans();
  await onedrive.plansFor([1]);
  assert.equal(calls.length, 4);
});

test("plansFor: the feature off - 503 takeoff_not_configured or the function not deployed - is a quiet empty answer, asked again later", async () => {
  for (const answer of [http(503, { error: "takeoff_not_configured", message: "The takeoff folder is not set up yet (missing: ONEDRIVE_TAKEOFF_ITEM_ID)." }),
    http(404, { code: "NOT_FOUND", message: "Requested function was not found" })]) {
    const calls = stub(() => answer);
    assert.deepEqual(await onedrive.plansFor([1, 2]), {});
    assert.deepEqual(await onedrive.plansFor([1, 2]), {});
    assert.equal(calls.length, 2, "nothing is kept from a feature that is off");
  }
  // the code is the broker's own and its 503 sentence is the page's (a setting's name is never shown)
  assert.ok(onedrive.CONTRACT.includes("takeoff_not_configured"));
  stub(() => http(503, { error: "takeoff_not_configured", message: "missing: ONEDRIVE_TAKEOFF_ITEM_ID" }));
  const e = await refusal(onedrive.call({ op: "plans_for", project_ids: [1] }));
  assert.deepEqual([e.code, e.status], ["takeoff_not_configured", 503]);
  assert.ok(!/ONEDRIVE_|missing/.test(e.message), e.message);
});

test("plansFor: other errors are thrown with the broker's codes (the pages say nothing); a busy broker's Retry-After is waited out", async () => {
  const cases = [
    [http(401, { error: "unauthorized", message: "Sign in first." }), "auth", 401],
    [http(403, { error: "forbidden", message: "You don't have permission to do that." }), "forbidden", 403],
    [http(400, { error: "invalid", message: "project_ids must be 1 to 50 different positive whole numbers", field: "project_ids" }), "invalid", 400],
    [http(503, { error: "onedrive_not_authorized", message: "x" }), "not_authorized", 503],
    [http(503, { error: "onedrive_not_configured", message: "x" }), "not_configured", 503],
    [http(503, { error: "takeoff_root_missing", message: "x (ONEDRIVE_TAKEOFF_ITEM_ID)" }), "takeoff_root_missing", 503],
    [http(502, { error: "onedrive_failed", message: "OneDrive did not answer as expected. Try again in a few minutes." }), "onedrive_failed", 502],
    [http(500, { error: "server_error", message: "Something went wrong on our side. Try again in a few minutes." }), "server_error", 500],
    [http(502, "<html>bad gateway</html>"), "failed", 502],
    [{ data: null, error: { name: "FunctionsFetchError", context: new TypeError("Failed to fetch") } }, "offline", 0],
  ];
  for (const [answer, code, status] of cases) {
    stub(() => answer);
    const e = await refusal(onedrive.plansFor([1]));
    assert.deepEqual([e.code, e.status], [code, status], code);
    assert.ok(!/ONEDRIVE_/.test(e.message), code + ": " + e.message);
  }
  // busy: thrown once, then nothing is asked until Retry-After has passed (what is kept still answers)
  let busy = true;
  const calls = stub((b) => (busy ? http(503, { error: "busy", message: "x" }, { "Retry-After": "7" }) : broker({ 1: 1, 2: 2 })(b)));
  busy = false;
  await onedrive.plansFor([1]);
  busy = true;
  const e = await refusal(onedrive.plansFor([2]));
  assert.deepEqual([e.code, e.retryAfter], ["busy", 7]);
  assert.deepEqual(await onedrive.plansFor([1, 2]), { 1: { number: "A001", plans: 1 } }, "kept answers only, nothing asked");
  assert.equal(calls.length, 2);
  busy = false;
  const real = Date.now;
  try {
    Date.now = () => real() + 8000;
    assert.deepEqual(await onedrive.plansFor([2]), { 2: { number: "A002", plans: 2 } });
  } finally { Date.now = real; }
  assert.equal(calls.length, 3);
});

test("plansFor: a busy answer with a short Retry-After (the broker's first walk ran out of time, its counts kept) is asked once more", async () => {
  assert.equal(onedrive.PLANS_RETRY_S, 5);
  let n = 0;
  const calls = stub((b) => (++n === 1 ? http(503, { error: "busy", message: "x" }, { "Retry-After": "1" }) : broker({ 1: 2 })(b)));
  const t0 = Date.now();
  assert.deepEqual(await onedrive.plansFor([1]), { 1: { number: "A001", plans: 2 } });
  assert.ok(Date.now() - t0 >= 900, "after its Retry-After");
  assert.equal(calls.length, 2);
  // only once: busy again is thrown (and waited out)
  const twice = stub(() => http(503, { error: "busy", message: "x" }, { "Retry-After": "1" }));
  assert.equal((await refusal(onedrive.plansFor([1]))).code, "busy");
  assert.equal(twice.length, 2);
  assert.deepEqual(await onedrive.plansFor([1]), {}, "nothing asked within the wait");
  assert.equal(twice.length, 2);
});

test("plansShownFor: every active person but the agents account (decision 2), once LIVE", () => {
  assert.equal(onedrive.LIVE, true);
  for (const role of ["admin", "manager", "accountant", "lead", "field", "viewer"]) assert.equal(onedrive.plansShownFor({ role, active: true }), true, role);
  assert.equal(onedrive.plansShownFor({ role: "manager" }), true, "active unless said otherwise");
  assert.equal(onedrive.plansShownFor({ role: "agents", active: true }), false);
  assert.equal(onedrive.plansShownFor({ role: "admin", active: false }), false);
  assert.equal(onedrive.plansShownFor(null), false);
});

/* ── map/plans.js ── */
test("map/plans: the link (the number encoded), takeoff-web's own plans for the card", () => {
  assert.equal(plans.TAKEOFF_WEB, "https://barajas545.github.io/takeoff-web/index.html");
  assert.equal(plans.PLANS_HOME, plans.TAKEOFF_WEB + "#plans");
  assert.equal(plans.plansLink("A068"), plans.TAKEOFF_WEB + "#plans=A068");
  assert.equal(plans.plansLink(" A024-B "), plans.TAKEOFF_WEB + "#plans=A024-B");
  assert.equal(plans.plansLink("A0 #&?"), plans.TAKEOFF_WEB + "#plans=A0%20%23%26%3F");
  assert.equal(plans.plansLink(""), plans.PLANS_HOME);
});

test("map/plans: the button - only with at least one takeoff file; a new tab, its accessible name, the count in its title, escaped", () => {
  assert.equal(plans.planButtonHtml({ number: "A068", plans: 0 }, "icon"), "");
  assert.equal(plans.planButtonHtml(null, "icon"), "");
  assert.equal(plans.planButtonHtml({ number: "", plans: 3 }, "icon"), "");
  assert.equal(plans.planButtonHtml({ number: "A068", plans: "3" }, "icon"), "");
  const icon = plans.planButtonHtml({ number: "A068", plans: 3 }, "icon");
  assert.match(icon, /^<a class="se-plan-go" href="https:\/\/barajas545\.github\.io\/takeoff-web\/index\.html#plans=A068" target="_blank" rel="noopener" /);
  assert.match(icon, /aria-label="Plans for A068 — open in the takeoff app"/);
  assert.match(icon, /title="3 takeoff files for A068 — opens its plans in the takeoff app/);
  assert.match(icon, /<span class="ic" aria-hidden="true">📐<\/span>/);
  assert.match(plans.planButtonHtml({ number: "A001", plans: 1 }, "icon"), /title="1 takeoff file for A001 /);
  const btn = plans.planButtonHtml({ number: "A024-B", plans: 2 }, "button");
  assert.match(btn, /^<a class="pj-btn" href="[^"]+#plans=A024-B" target="_blank" rel="noopener" aria-label="Plans for A024-B — open in the takeoff app"/);
  assert.match(btn, />📐 Plans ↗<\/span><\/a>$/);
  const evil = plans.planButtonHtml({ number: 'A0"><img src=x>', plans: 1 }, "icon");
  assert.ok(!/<img/.test(evil), evil);
  assert.deepEqual(evil.match(/<[a-z]+/g), ["<a", "<span", "<span"], "no element but the button's own");
  assert.match(evil, /#plans=A0%22%3E%3Cimg%20src%3Dx%3E"/);
  assert.match(evil, /aria-label="Plans for A0&quot;&gt;&lt;img src=x&gt; — open/);
});

test("map/plans: the Floor Plans card for the people who see prices - an admin, or Sees prices (decision 4)", () => {
  const card = (p) => plans.plansCardFor(Object.assign({ active: true }, p));
  assert.equal(card({ role: "admin" }), true);
  assert.equal(card({ role: "manager" }), false);
  assert.equal(card({ role: "manager", can_see_prices: true }), true);
  assert.equal(card({ role: "accountant", can_see_prices: true }), true);
  assert.equal(card({ role: "accountant" }), false);
  assert.equal(card({ role: "lead" }), false);
  assert.equal(card({ role: "field" }), false);
  assert.equal(card({ role: "viewer" }), false);
  assert.equal(card({ role: "viewer", can_see_prices: true }), true);
  assert.equal(card({ role: "admin", active: false }), false);
  assert.equal(card({ role: "agents", can_see_prices: true }), false);
  assert.equal(plans.plansCardFor(null), false);
});

/* ── pages/plan-buttons.js: the slots ── */
function slots(list) {
  const made = list.map(([id, style]) => ({ attrs: { "data-plans": id, "data-plans-style": style }, hidden: true, innerHTML: "",
    getAttribute(n) { return this.attrs[n] === undefined ? null : this.attrs[n]; } }));
  return { slots: made, root: { querySelectorAll: (sel) => { assert.equal(sel, "[data-plans]"); return made; } } };
}

test("paintPlans: one call for every slot; a project with a takeoff file gets its button, the others stay hidden", async () => {
  const calls = stub(broker({ 7: 2, 8: 0 }));
  const s = slots([["7", "icon"], ["8", "icon"], ["9", "icon"], ["", "icon"]]);
  assert.equal(await paintPlans(s.root, FIELD), 1);
  assert.deepEqual(calls.map((c) => c.body), [{ op: "plans_for", project_ids: [7, 8, 9] }]);
  assert.equal(s.slots[0].hidden, false);
  assert.match(s.slots[0].innerHTML, /^<a class="se-plan-go" href="[^"]+#plans=A007" target="_blank" rel="noopener"/);
  assert.deepEqual(s.slots.slice(1).map((x) => [x.hidden, x.innerHTML]), [[true, ""], [true, ""], [true, ""]]);
  // the header's style
  stub(broker({ 7: 2 }));
  const h = slots([["7", "button"]]);
  await paintPlans(h.root, { role: "viewer", active: true });
  assert.match(h.slots[0].innerHTML, /^<a class="pj-btn" /);
});

test("paintPlans: a newer search drew in the meantime - nothing drawn; no slot or no person - nothing asked", async () => {
  const calls = stub(broker({ 7: 2 }));
  const s = slots([["7", "icon"]]);
  assert.equal(await paintPlans(s.root, FIELD, () => false), 0);
  assert.deepEqual([s.slots[0].hidden, s.slots[0].innerHTML], [true, ""]);
  assert.equal(await paintPlans(slots([]).root, FIELD), 0);
  for (const who of [null, { role: "agents", active: true }, { role: "field", active: false }]) {
    assert.equal(await paintPlans(slots([["7", "icon"]]).root, who), 0);
  }
  assert.equal(await paintPlans(null, FIELD), 0);
  assert.equal(calls.length, 1, "only the first one asked");
});

test("paintPlans: the feature off and every error - quiet: the slots stay hidden and nothing is thrown", async () => {
  for (const answer of [http(503, { error: "takeoff_not_configured" }), http(404, { code: "NOT_FOUND" }), http(503, { error: "busy" }, { "Retry-After": "30" }),
    http(403, { error: "forbidden" }), http(500, { error: "server_error" }), http(401, { error: "unauthorized" }),
    { data: null, error: { name: "FunctionsFetchError" } }, ok({ projects: { 7: { number: "A007", plans: "lots" } } })]) {
    stub(() => answer);
    const s = slots([["7", "icon"]]);
    assert.equal(await paintPlans(s.root, FIELD), 0, JSON.stringify(answer.data));
    assert.deepEqual([s.slots[0].hidden, s.slots[0].innerHTML], [true, ""]);
  }
  stub(() => { throw new TypeError("network"); });
  assert.equal(await paintPlans(slots([["7", "icon"]]).root, FIELD), 0);
});
