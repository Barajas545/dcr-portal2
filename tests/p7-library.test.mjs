// The Plans Library (owner 2026-10-26: the old portal's offline plan copies, brought to Portal 2): the rules in
// site/js/map/plan-library.js (statuses, versions, what downloads by itself, what a sweep keeps), the broker calls in
// site/js/repo/onedrive.js (plansList, planLink over a stub of functions.invoke), the 📐 menu's rows and button
// (site/js/pages/plan-buttons.js menuRows, map/plans.js), and plans_list / plan_link of the demo broker
// (tools/fake/p7-onedrive.js) as each role. The REAL broker: DCR Desktop 2 supabase/functions/onedrive/takeoff_test.ts.
// The storage and the downloads themselves (js/plan-library.js, js/plan-library-worker.js) are a browser's: the demo
// server and a browser check them. Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { useClient } from "../site/js/repo/_db.js";
import * as onedrive from "../site/js/repo/onedrive.js";
import * as plans from "../site/js/map/plans.js";
import * as lib from "../site/js/map/plan-library.js";
import { menuRows } from "../site/js/pages/plan-buttons.js";
import { available, loadFake, freshEngine, clientAs } from "./pages-engine.mjs";

const AT = "2026-10-26T18:00:00.000Z";
const NOW = Date.parse(AT);
const F1 = { id: "01FAKEPLAN0001", name: "A900 Bid.takeoff", folder: "A900 - 12 Made Up Lane", size: 1234, modified: AT, version: "qx:AAA" };
const F2 = { id: "01FAKEPLAN0002", name: "L1 walls.takeoff", folder: "A900 - 12 Made Up Lane/Rev 2/Level 1", size: 99, modified: AT, version: "sm:99:x" };
const F3 = { id: "01FAKEPLAN0003", name: "Annex.takeoff", folder: "A900 - 12 Made Up Lane/Rev 2", size: 5, modified: null, version: "qx:CCC" };

/* ── map/plan-library.js ─────────────────────────────────────────────────────────────────────────────────────── */

test("planFileOf: only a .takeoff file with an item id and a version; the rest of OneDrive's words are dropped", () => {
  assert.deepEqual(lib.planFileOf(Object.assign({ webUrl: "https://x", "@microsoft.graph.downloadUrl": "https://y" }, F1)), F1);
  assert.deepEqual(lib.planFileOf(Object.assign({}, F1, { size: -1, modified: "not a time", folder: "a\u0000b" })),
    Object.assign({}, F1, { size: null, modified: null, folder: "" }));
  for (const bad of [null, "x", {}, Object.assign({}, F1, { id: "short" }), Object.assign({}, F1, { name: "A900.pdf" }),
    Object.assign({}, F1, { name: "../A900.takeoff" }), Object.assign({}, F1, { name: "A900.takeoff.autosave" }),
    Object.assign({}, F1, { version: "" }), Object.assign({}, F1, { version: "v".repeat(201) })]) {
    assert.equal(lib.planFileOf(bad), null, JSON.stringify(bad));
  }
});

test("folders and order: below the project's folder, the top folder's files first, then by folder and name", () => {
  assert.equal(lib.folderLabel("A900 - 12 Made Up Lane/Rev 2/Level 1"), "Rev 2/Level 1");
  assert.equal(lib.folderLabel("A900 - 12 Made Up Lane"), "");
  assert.equal(lib.folderLabel(""), "");
  assert.deepEqual(lib.sortFiles([F2, F3, F1]).map((f) => f.name), ["A900 Bid.takeoff", "Annex.takeoff", "L1 walls.takeoff"]);
});

test("file names: plain characters, one per person, file and version; never the same for two versions", () => {
  const a = lib.fileNameFor("00000000-0000-4000-8000-000000000003", "01FAKE!PLAN.0001", "qx:AAA");
  assert.match(a, lib.FILE_RE);
  assert.notEqual(a, lib.fileNameFor("00000000-0000-4000-8000-000000000003", "01FAKE!PLAN.0001", "qx:AAB"));
  assert.notEqual(a, lib.fileNameFor("00000000-0000-4000-8000-000000000004", "01FAKE!PLAN.0001", "qx:AAA"));
  assert.equal(a, lib.fileNameFor("00000000-0000-4000-8000-000000000003", "01FAKE!PLAN.0001", "qx:AAA"));
});

const rec = (over) => Object.assign({ key: "u|" + F1.id, owner: "u", itemId: F1.id, projectId: "7", number: "A900", name: F1.name,
  folder: F1.folder, file: "p1-x-1.takeoff", size: 1234, modified: AT, version: "qx:AAA", savedAt: AT, dl: null, latest: null }, over || {});

test("statusOf: saved, outdated, downloading (here or in another window), paused, stopped, gone, denied, missing", () => {
  assert.equal(lib.statusOf(rec()), "saved");
  assert.equal(lib.statusOf(rec({ latest: { status: "ok", version: "qx:AAA" } })), "saved");
  assert.equal(lib.statusOf(rec({ latest: { status: "ok", version: "qx:BBB" } })), "outdated");
  assert.equal(lib.statusOf(rec(), { done: 1, size: 2 }), "downloading");
  assert.equal(lib.statusOf(rec({ dl: { state: "running" } }), null, true), "downloading", "another window holds its lock");
  assert.equal(lib.statusOf(rec({ dl: { state: "running" } }), null, false), "paused", "a closed window's download");
  assert.equal(lib.statusOf(rec({ dl: { state: "paused", userPaused: true } })), "paused");
  assert.equal(lib.statusOf(rec({ dl: { state: "error", error: "no room" } })), "stopped");
  assert.equal(lib.statusOf(rec({ latest: { status: "gone" } })), "gone");
  assert.equal(lib.statusOf(rec({ latest: { status: "denied" } })), "denied");
  assert.equal(lib.statusOf(rec({ file: "" })), "missing");
  assert.equal(lib.statusOf(null), "missing");
  for (const s of ["saved", "outdated", "downloading", "paused", "stopped", "gone", "denied", "missing"]) assert.ok(lib.statusText(s), s);
});

test("applyCheck: the version OneDrive holds now, gone when the project no longer has the file, denied when the project is not visible", () => {
  const r = rec();
  const ok = lib.applyCheck(r, { files: [Object.assign({}, F1, { version: "qx:NEW" }), F2] }, AT);
  assert.deepEqual(ok.latest, { status: "ok", checkedAt: AT, version: "qx:NEW", size: 1234, modified: AT, name: F1.name, folder: F1.folder });
  assert.equal(ok.file, r.file, "the saved copy is never touched here");
  assert.equal(lib.statusOf(ok), "outdated");
  assert.deepEqual(lib.applyCheck(r, { files: [F2] }, AT).latest, { status: "gone", checkedAt: AT });
  assert.deepEqual(lib.applyCheck(r, null, AT).latest, { status: "denied", checkedAt: AT });
  assert.equal(r.latest, null, "the record given is not changed");
});

test("what downloads by itself: a newer version, an interrupted or never-finished download - never one paused by the person, stopped, gone or denied", () => {
  assert.equal(lib.needsWork(rec()), false);
  assert.equal(lib.needsWork(rec({ latest: { status: "ok", version: "qx:BBB" } })), true);
  assert.equal(lib.needsWork(rec({ file: "" })), true);
  assert.equal(lib.needsWork(rec({ dl: { state: "running" } })), true);
  assert.equal(lib.needsWork(rec({ dl: { state: "paused" } })), true);
  assert.equal(lib.needsWork(rec({ dl: { state: "paused", userPaused: true } })), false);
  assert.equal(lib.needsWork(rec({ dl: { state: "error" } })), false);
  assert.equal(lib.needsWork(rec({ latest: { status: "gone" }, file: "" })), false);
  assert.equal(lib.needsWork(rec({ latest: { status: "denied" }, file: "" })), false);
  assert.equal(lib.dueForCheck(null, NOW), true);
  assert.equal(lib.dueForCheck(new Date(NOW - lib.CHECK_EVERY_MS + 1000).toISOString(), NOW), false);
  assert.equal(lib.dueForCheck(new Date(NOW - lib.CHECK_EVERY_MS).toISOString(), NOW), true);
  assert.equal(lib.dueForCheck(new Date(NOW + 3600000).toISOString(), NOW), true, "a clock set wrong does not stop the checks");
});

test("a sweep keeps every record's copy and part (anyone's: a shared tablet) and a copy handed to the takeoff app within a day", () => {
  const records = [rec(), rec({ owner: "v", file: "p2-y-1.takeoff", dl: { file: "p2-y-2.takeoff" } })];
  const handed = { "p9-old-1.takeoff": new Date(NOW - 3600000).toISOString(), "p9-old-2.takeoff": new Date(NOW - lib.HANDED_GRACE_MS - 1).toISOString() };
  assert.deepEqual([...lib.keepSet(records, handed, NOW)].sort(), ["p1-x-1.takeoff", "p2-y-1.takeoff", "p2-y-2.takeoff", "p9-old-1.takeoff"]);
  assert.deepEqual(Object.keys(lib.pruneHanded(Object.assign({ "../evil": AT }, handed), NOW)), ["p9-old-1.takeoff"]);
  assert.deepEqual(lib.projectBatches([rec({ projectId: "3" }), rec({ projectId: "3" }), rec({ projectId: "x" }), rec({ projectId: "5" })], 1), [[3], [5]]);
  assert.equal(lib.fmtSize(195.7 * 1048576), "195.7 MB");
  assert.equal(lib.fmtAgo(new Date(NOW - 7200000).toISOString(), NOW), "2 h ago");
});

/* ── the 📐 menu ─────────────────────────────────────────────────────────────────────────────────────────────── */

test("the 📐 button: for the people who see prices it opens the menu of plan files (the link stays); everyone else's is the link", () => {
  const e = { number: "A900", plans: 3 };
  const link = plans.planButtonHtml(e, "icon");
  assert.ok(!/data-plan-menu/.test(link));
  const menu = plans.planButtonHtml(e, "icon", true);
  assert.match(menu, /href="https:\/\/barajas545\.github\.io\/takeoff-web\/index\.html#plans=A900" target="_blank" rel="noopener"/);
  assert.match(menu, /data-plan-menu="A900" aria-haspopup="dialog"/);
  assert.match(menu, /aria-label="Plans for A900 — open or save the plan files"/);
  assert.equal(plans.planButtonHtml({ number: "A900", plans: 0 }, "icon", true), "");
  for (const [me, yes] of [[{ role: "admin" }, true], [{ role: "manager", can_see_prices: true }, true], [{ role: "manager" }, false],
    [{ role: "lead" }, false], [{ role: "field" }, false], [{ role: "agents", can_see_prices: true }, false], [{ role: "admin", active: false }, false], [null, false]]) {
    assert.equal(plans.planFilesFor(me), yes, JSON.stringify(me));
  }
  assert.equal(plans.TAKEOFF_ORIGIN, "https://barajas545.github.io");
  assert.equal(plans.handoffLink("Zk3pQ9_x-7LmN2aBcD4e"), "https://barajas545.github.io/takeoff-web/index.html#portal=Zk3pQ9_x-7LmN2aBcD4e");
  assert.throws(() => plans.handoffLink("short"));
  assert.throws(() => plans.handoffLink("a b c d e f g h i j k l m"));
});

test("the menu's rows: OneDrive's files in order with what is saved here; offline, the saved ones alone", () => {
  const saved = { [F2.id]: Object.assign(rec({ itemId: F2.id, name: F2.name, folder: F2.folder }), { status: "saved" }),
    "01FAKEPLANGONE": Object.assign(rec({ itemId: "01FAKEPLANGONE", name: "Old.takeoff", folder: "A900 - x/Old" }), { status: "gone" }) };
  const rows = menuRows([F2, F3, F1], saved);
  assert.deepEqual(rows.map((r) => [r.name, r.where, r.status, !!r.file]), [
    ["A900 Bid.takeoff", "", "", true], ["Annex.takeoff", "Rev 2", "", true], ["L1 walls.takeoff", "Rev 2/Level 1", "saved", true],
    ["Old.takeoff", "Old", "gone", false],
  ]);
  assert.deepEqual(menuRows([], saved).map((r) => r.name), ["L1 walls.takeoff", "Old.takeoff"], "offline: what is saved");
});

/* ── repo/onedrive.js: plansList, planLink ───────────────────────────────────────────────────────────────────── */

function stub(answer) {
  const calls = [];
  useClient({ functions: { invoke: async (name, o) => { calls.push({ name, body: o && o.body }); return answer(o && o.body, name); } } });
  return calls;
}
const ok = (data) => ({ data, error: null });
const http = (status, body) => ({ data: null, error: { name: "FunctionsHttpError",
  context: new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }) } });
async function refusal(p) {
  try { await p; } catch (e) { return e; }
  assert.fail("expected a refusal");
}

test("plansList: op plans_list, 1 to 20 projects a call; each project's files read through planFileOf (a malformed one left out)", async () => {
  const calls = stub((b) => {
    const projects = {};
    for (const id of b.project_ids) projects[String(id)] = { number: "A" + id, files: [F1, { id: "bad", name: "x.pdf" }, F2] };
    projects["999"] = { number: "A999", files: [F3] };             // not asked: never used
    return ok({ projects, checked_at: AT });
  });
  const ids = Array.from({ length: 45 }, (_, i) => i + 1);
  const got = await onedrive.plansList(ids.concat(["3", "x", 0]));
  assert.deepEqual(calls.map((c) => [c.name, c.body.op, c.body.project_ids.length]), [["onedrive", "plans_list", 20], ["onedrive", "plans_list", 20], ["onedrive", "plans_list", 5]]);
  assert.equal(onedrive.LIST_BATCH, 20);
  assert.deepEqual(got["7"], { number: "A7", files: [F1, F2] });
  assert.equal(got["999"], undefined);
  assert.equal(Object.keys(got).length, 45);
  assert.deepEqual(await onedrive.plansList([]), {});
  const refused = stub(() => http(403, { error: "forbidden", message: "Plan files are for the people who see prices." }));
  const e = await refusal(onedrive.plansList([7]));
  assert.deepEqual([e.code, e.status, e.message], ["forbidden", 403, "Plan files are for the people who see prices."]);
  assert.equal(refused.length, 1);
});

test("planLink: op plan_link; the link must point at the owner's OneDrive host; the file must be the one asked", async () => {
  const url = "https://" + onedrive.ONEDRIVE_HOST + "/personal/x/_layouts/15/download.aspx?UniqueId=1&tempauth=abc";
  const calls = stub(() => ok(Object.assign({ url }, F1)));
  assert.deepEqual(await onedrive.planLink(7, F1.id), Object.assign({ url }, F1));
  assert.deepEqual(calls[0].body, { op: "plan_link", project_id: 7, item_id: F1.id });
  stub(() => ok(Object.assign({ url: "https://evil.example.test/x" }, F1)));
  assert.equal((await refusal(onedrive.planLink(7, F1.id))).code, "bad_link");
  stub(() => ok(Object.assign({ url }, F2)));
  assert.equal((await refusal(onedrive.planLink(7, F1.id))).code, "failed", "another file's answer is not used");
  const none = stub(() => ok({}));
  assert.equal((await refusal(onedrive.planLink(7, "../x"))).code, "not_found");
  assert.equal(none.length, 0, "a malformed id is never sent");
  stub(() => http(404, { error: "not_found", message: "That file or folder was not found." }));
  assert.equal((await refusal(onedrive.planLink(7, F1.id))).code, "not_found");
});

/* ── the demo broker ─────────────────────────────────────────────────────────────────────────────────────────── */

const skip = !available && "the demo database (tools/fake) is not here";
let FK, E;
async function setup() {
  FK = await loadFake();
  E = await freshEngine(new Date());
}
const idOf = (key) => FK.PEOPLE.find((p) => p.key === key).id;
const project = (number) => E.rows.projects.find((p) => p.number === number);
function as(key) {
  const c = clientAs(E, key ? idOf(key) : null);
  useClient({ from: c.from, rpc: c.rpc, storage: c.storage, functions: { invoke: (name, o) => c.functions.invoke(name, o) } });
}

test("demo plans_list: the people who see prices get each project's .takeoff files (plans_for's count of them); everyone else 403", { skip }, async () => {
  await setup();
  const a267 = project("A267"), ab = project("A024-B"), a001 = project("A001");
  for (const key of ["admin", "manager_prices", "accountant"]) {
    as(key);
    const got = await onedrive.plansList([a267.id, ab.id, a001.id]);
    assert.deepEqual(got[String(a267.id)].files.map((f) => f.name).sort(), ["A267 Bid.takeoff", "A267 Rev 2.takeoff", "L1 walls.takeoff"], key);
    assert.deepEqual(got[String(ab.id)].files.map((f) => f.name).sort(), ["A024-B Framing.takeoff", "A024-B Roof.takeoff"], key);
    assert.deepEqual(got[String(a001.id)], { number: "A001", files: [] }, key);
    const counts = await onedrive.plansFor([a267.id, ab.id]);
    assert.equal(counts[String(a267.id)].plans, got[String(a267.id)].files.length);
    assert.ok(got[String(a267.id)].files.every((f) => lib.planFileOf(f) && /^A267 - /.test(f.folder)), key);
  }
  for (const key of ["manager", "lead", "field", "viewer", "agents", "inactive"]) {
    as(key);
    const e = await refusal(onedrive.plansList([a267.id]));
    assert.equal(e.code, "forbidden", key);
  }
});

test("demo plan_link: a link answering byte ranges whose bytes start PDFCACHE1; another project's file, or a project not visible, 404", { skip }, async () => {
  await setup();
  const a267 = project("A267"), ab = project("A024-B");
  as("manager_prices");
  const files = (await onedrive.plansList([a267.id]))[String(a267.id)].files;
  const l = await onedrive.planLink(a267.id, files[0].id);
  assert.equal(l.id, files[0].id);
  assert.equal(l.version, files[0].version);
  const ext = E.exts.find((x) => x.name === "p7-onedrive");
  const head = ext.http("GET", l.url, { Range: "bytes=0-8" });
  assert.equal(head.status, 206);
  assert.equal(String(typeof head.body === "string" ? head.body : await head.body.text()), lib.MAGIC);
  const whole = ext.http("GET", l.url, {});
  assert.equal(whole.status, 200);
  assert.equal(typeof whole.body === "string" ? whole.body.length : whole.body.size, l.size);
  assert.equal((await refusal(onedrive.planLink(ab.id, files[0].id))).code, "not_found");
  as("field");
  assert.equal((await refusal(onedrive.planLink(a267.id, files[0].id))).code, "forbidden");
  // a new save in OneDrive: a new version
  as("admin");
  ext.setPlanVersion(files[0].folder + "/" + files[0].name, "qx:demo-new-save");
  assert.equal((await onedrive.planLink(a267.id, files[0].id)).version, "qx:demo-new-save");
  ext.setPlanVersion(files[0].folder + "/" + files[0].name, null);
});
