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

await import("../site/js/quickxor.js");
const QX = globalThis.DCR2QuickXor;

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

test("file names: plain characters; different for another person, file, version or download (a copy kept for the takeoff app is never written over)", () => {
  const U = "00000000-0000-4000-8000-000000000003";
  const a = lib.fileNameFor(U, "01FAKE!PLAN.0001", "qx:AAA", "lx3k9a1b");
  assert.match(a, lib.FILE_RE);
  assert.notEqual(a, lib.fileNameFor(U, "01FAKE!PLAN.0001", "qx:AAB", "lx3k9a1b"));
  assert.notEqual(a, lib.fileNameFor("00000000-0000-4000-8000-000000000004", "01FAKE!PLAN.0001", "qx:AAA", "lx3k9a1b"));
  assert.notEqual(a, lib.fileNameFor(U, "01FAKE!PLAN.0001", "qx:AAA", "lx3k9a1c"), "the same version saved again: a new name");
  assert.equal(a, lib.fileNameFor(U, "01FAKE!PLAN.0001", "qx:AAA", "lx3k9a1b"));
  assert.match(lib.fileNameFor(U, "x", "v", "../!$"), lib.FILE_RE);
});

test("the automatic downloads wait after a failure: 5 min, doubling, up to 6 h; a person's own Save never waits; a new version starts afresh", () => {
  assert.deepEqual([1, 2, 3, 4, 7, 8, 30].map(lib.backoffMs), [5, 10, 20, 40, 320, 360, 360].map((m) => m * 60000));
  const r = rec({ latest: { status: "ok", version: "qx:BBB" } });
  assert.equal(lib.dueForWork(r, NOW), true);
  const f1 = lib.withFailure(r, NOW);
  assert.deepEqual([f1.fails, f1.retryAt], [1, new Date(NOW + 5 * 60000).toISOString()]);
  assert.equal(lib.dueForWork(f1, NOW + 4 * 60000), false, "waits");
  assert.equal(lib.dueForWork(f1, NOW + 5 * 60000), true, "then goes on");
  assert.equal(lib.needsWork(f1), true, "a person's own Resume or Update now is never held back (needsWork ignores the wait)");
  assert.equal(lib.withFailure(f1, NOW).fails, 2);
  assert.equal(lib.dueForWork(lib.withFailure(rec({ dl: { state: "paused", userPaused: true } }), NOW), NOW + 9e9), false, "paused by the person");
  // a check that finds a NEW version clears the old one's waits; the same version keeps them
  const same = lib.applyCheck(Object.assign({}, f1), { files: [Object.assign({}, F1, { version: "qx:BBB" })] }, AT);
  assert.deepEqual([same.fails, same.retryAt], [1, f1.retryAt]);
  const fresh = lib.applyCheck(Object.assign({}, f1), { files: [Object.assign({}, F1, { version: "qx:CCC" })] }, AT);
  assert.deepEqual([fresh.fails, fresh.retryAt, lib.dueForWork(fresh, NOW)], [0, null, true]);
  // which failures stop every automatic download for a while: OneDrive's or the connection's, never one file's
  for (const code of ["busy", "unavailable", "failed", "server_error", "onedrive_failed", "not_authorized", "takeoff_root_missing", "auth", "offline", "bad_link"]) {
    assert.equal(lib.brokerWide(code), true, code);
  }
  for (const code of ["gone", "forbidden", "not_plan", "no_size", "space", "changed", "removed", "paused", "", undefined]) assert.equal(lib.brokerWide(code), false, String(code));
});

test("the second review's rules: an unfinished walk never says gone; a file that keeps changing keeps its wait; a clock that was wrong never freezes the waits", () => {
  const r = rec({ latest: { status: "ok", version: "qx:AAA" } });
  assert.deepEqual(lib.applyCheck(r, { files: [], complete: false }, AT).latest, r.latest, "not reached by the walk: nothing changes");
  assert.deepEqual(lib.applyCheck(r, { files: [], complete: true }, AT).latest, { status: "gone", checkedAt: AT });
  assert.deepEqual(lib.applyCheck(r, { files: [] }, AT).latest, { status: "gone", checkedAt: AT }, "an answer without the flag is a finished walk");
  // "the file kept changing": a new version from a check does not cancel that wait (no download thrown away all day)
  const changing = Object.assign(lib.withFailure(rec({ latest: { status: "ok", version: "qx:BBB" } }), NOW), { failCode: "changed" });
  const next = lib.applyCheck(changing, { files: [Object.assign({}, F1, { version: "qx:CCC" })] }, AT);
  assert.deepEqual([next.fails, next.retryAt], [1, changing.retryAt]);
  const other = Object.assign({}, changing, { failCode: "space" });
  assert.deepEqual(lib.applyCheck(other, { files: [Object.assign({}, F1, { version: "qx:CCC" })] }, AT).fails, 0);
  // waits written while the clock was a year ahead are over once it is right again
  const ahead = lib.withFailure(rec({ latest: { status: "ok", version: "qx:BBB" } }), NOW + 365 * 86400000);
  assert.equal(lib.dueForWork(ahead, NOW), true);
  assert.equal(lib.holding(NOW + 60000, NOW, lib.RETRY_CAP_MS), true);
  assert.equal(lib.holding(NOW - 1, NOW, lib.RETRY_CAP_MS), false);
  assert.equal(lib.holding(NOW + 365 * 86400000, NOW, lib.RETRY_CAP_MS), false);
  assert.equal(lib.holding(undefined, NOW, lib.RETRY_CAP_MS), false);
});

test("an iPhone or iPad home-screen app: told at once to use Safari (no tab, no saving); Safari, Android and computers are not", async () => {
  const { iosHomeScreen, handoffProblem, IOS_HOME } = await import("../site/js/plan-handoff.js");
  const win = (ua, standalone, touch) => ({ navigator: { userAgent: ua, standalone, maxTouchPoints: touch || 0 },
    matchMedia: () => ({ matches: !!standalone }) });
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";
  const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
  assert.equal(iosHomeScreen(win(IPHONE, true)), true);
  assert.equal(iosHomeScreen(win(IPAD, true, 5)), true, "an iPad calls itself a Mac");
  assert.equal(iosHomeScreen(win(IPHONE, false)), false, "Safari itself");
  assert.equal(iosHomeScreen(win(IPAD, true, 0)), false, "a real Mac");
  assert.equal(iosHomeScreen(win(ANDROID, true)), false, "an Android home-screen app keeps its opener");
  assert.equal(handoffProblem({ ok: false, why: "ios_home" }), IOS_HOME);
  assert.match(IOS_HOME, /Safari/);
  assert.equal(handoffProblem({ ok: true }), "");
});

test("a sign-in refused for a turned-off account finds whose plans to remove by its e-mail (sb.js reads the library's hint with the same short hash)", async () => {
  const store = new Map();
  const had = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    const { planOwnerFor } = await import("../site/js/sb.js");
    const U = "00000000-0000-4000-8000-000000000003";
    store.set("dcr2-plan-owner-mail", JSON.stringify({ [lib.hashOf("manager2@demo.test")]: U }));
    assert.equal(planOwnerFor("  Manager2@Demo.test "), U, "trimmed, any case");
    assert.equal(planOwnerFor("someone.else@demo.test"), null);
    store.set("dcr2-plan-owner-mail", "not json");
    assert.equal(planOwnerFor("manager2@demo.test"), null);
  } finally {
    if (had === undefined) delete globalThis.localStorage; else globalThis.localStorage = had;
  }
});

test("a copy handed to the takeoff app is kept a week; 'the takeoff app is kept on this device' is believed six days", () => {
  assert.equal(lib.HANDED_GRACE_MS, 7 * 24 * 3600 * 1000);
  const handed = { "p9-old-1.takeoff": new Date(NOW - 6 * 86400000).toISOString() };
  assert.ok(lib.keepSet([], handed, NOW).has("p9-old-1.takeoff"), "six days after it was handed over: kept");
  assert.ok(!lib.keepSet([], handed, NOW + 2 * 86400000).has("p9-old-1.takeoff"), "eight days: gone at the next sweep");
  assert.equal(lib.readyFresh(new Date(NOW - 5 * 86400000).toISOString(), NOW), true);
  assert.equal(lib.readyFresh(new Date(NOW - 7 * 86400000).toISOString(), NOW), false);
  assert.equal(lib.readyFresh(null, NOW), false);
  assert.equal(lib.statusText("gone", true), "No longer in OneDrive — this copy still opens");
  assert.equal(lib.statusText("gone", false), "No longer in OneDrive");
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

test("the green bar (owner 2026-10-27): filling while a plan saves, full only once it is saved, grey part way when paused; none otherwise", () => {
  const row = (status, over) => Object.assign(rec(over), { status });
  assert.deepEqual(lib.progressOf(row("downloading"), 450, 1000), { pct: 45, kind: "run" });
  assert.deepEqual(lib.progressOf(row("downloading"), 0, 0), { pct: 0, kind: "run" }, "the size not known yet: an empty bar");
  assert.deepEqual(lib.progressOf(row("downloading"), 1200, 1000), { pct: 99, kind: "run" }, "never past 99 while it downloads");
  assert.deepEqual(lib.progressOf(row("downloading"), 1000, 1000), { pct: 99, kind: "run" },
    "the last byte came: 99 until it is checked against OneDrive and saved (full green means complete)");
  assert.deepEqual(lib.progressOf(row("saved")), { pct: 100, kind: "done" }, "saved: full - the file is complete");
  assert.deepEqual(lib.progressOf(row("paused", { dl: { state: "paused", done: 250, size: 1000 } })), { pct: 25, kind: "held" });
  assert.deepEqual(lib.progressOf(row("stopped", { dl: { state: "error", done: 999, size: 1000 } })), { pct: 99, kind: "held" });
  assert.deepEqual(lib.progressOf(row("paused", { dl: { state: "paused", done: 1000, size: 1000 } })), { pct: 99, kind: "held" },
    "downloaded, not checked yet (offline): not full");
  assert.equal(lib.progressOf(row("stopped", { dl: { state: "error", done: 0, size: 0 } })), null, "nothing downloaded: no bar");
  for (const s of ["outdated", "gone", "denied", "missing"]) assert.equal(lib.progressOf(row(s)), null, s);
  assert.equal(lib.progressOf(null), null);
  const full = lib.progressHtml({ pct: 100, kind: "done" });
  assert.match(full, /^<div class="plan-prog done" role="progressbar" aria-label="Saved on this device" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><i style="width:100%"><\/i><\/div>$/);
  assert.match(lib.progressHtml(null), /^<div class="plan-prog" [^>]* aria-valuenow="0" hidden><i style="width:0%"><\/i><\/div>$/);
  assert.match(lib.progressHtml({ pct: 45, kind: "run" }), /class="plan-prog run"[^>]*aria-valuenow="45"><i style="width:45%">/);
});

test("the menu's rows and the library's draw the bar; it is green (the site's own --ok) in both", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (f) => readFileSync(new URL("../site/" + f, import.meta.url), "utf8");
  const css = read("css/styles.css");
  assert.match(css, /\.plan-prog i \{[^}]*background: var\(--ok\);/);
  assert.match(css, /\.plan-prog\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.plan-prog\.held i \{ background: var\(--text-muted\);/, "paused or stopped part way: grey, not green");
  assert.match(read("js/pages/plan-buttons.js"), /"Downloading " \+ Math\.min\(99, /, "the menu's words never say 100% before it is saved");
  assert.match(read("js/pages/plans-library.js"), /const pct = size \? Math\.min\(99, /, "nor the library's");
  const pb = read("js/pages/plan-buttons.js");
  // (the save back, P4: a row whose own save waits shows that save's bar instead - map/plan-library.js sendBar)
  assert.match(pb, /progressHtml\(barOf\(s, s && s\.job \? s\.job\.done : 0, s && s\.job \? s\.job\.size : 0\)\)/);
  assert.match(pb, /function barOf\(s, done, size\) \{\s*if \(s && s\.save && s\.status !== "downloading"\) return sendBar\(s\.save\);\s*return s \? progressOf\(s, done, size\) : null;\s*\}/);
  assert.match(pb, /setBar\(row\.querySelector\("\.plan-prog"\), progressOf\(s, m\.done, m\.size\)\);/);
  const page = read("js/pages/plans-library.js");
  assert.match(page, /progressHtml\(line\.bar\)/);
  assert.match(page, /setBar\(row\.querySelector\("\.plan-prog"\), line\.bar\);/);
  assert.ok(!/lib-bar-p/.test(page + read("plans-library.html")), "the old blue bar is gone");
});

test("the library's project pictures: pictureIds reads two columns of the projects asked (deleted ones left out); the page loads them lazily", async () => {
  const asked = [];
  useClient({ from(table) {
    const q = { table, select: null, ids: null };
    asked.push(q);
    return { select(cols) { q.select = cols; return this; }, in(col, ids) { q.col = col; q.ids = ids;
      return Promise.resolve({ data: [{ id: 7, thumbnail_file_id: 55, deleted_at: null }, { id: 8, thumbnail_file_id: null, deleted_at: null },
        { id: 9, thumbnail_file_id: 66, deleted_at: AT }], error: null }); } };
  } });
  const projectsRepo = await import("../site/js/repo/projects.js");
  try {
    assert.deepEqual(await projectsRepo.pictureIds(["7", "8", "9", "7", "x", null]), [{ id: "7", thumbnailFileId: "55" }, { id: "8", thumbnailFileId: null }]);
    assert.deepEqual(asked.map((q) => [q.table, q.select, q.col, q.ids]), [["projects", "id, thumbnail_file_id, deleted_at", "id", [7, 8, 9]]]);
    assert.deepEqual(await projectsRepo.pictureIds([]), []);
    assert.equal(asked.length, 1, "nothing asked for no project");
  } finally { useClient(null); }
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../site/js/pages/plans-library.js", import.meta.url), "utf8");
  // a dynamic import: a page whose pictures cannot load still lists and opens the plans
  assert.match(page, /const P = await import\("\.\.\/plan-pictures\.js"\);/);
  assert.match(page, /if \(fresh\) import\("\.\.\/plan-pictures\.js"\)\.then\(function \(P\) \{ return P\.forgetAll\(L\.owner\(\)\); \}\)/);
  assert.match(page, /state\.pics = await P\.shown\(who, pids\);/);
  assert.match(page, /state\.pics = await P\.refresh\(who, pids, L\.ownersHere\(\)\);/);
  assert.match(page, /L\.maybeCheck\(state\.me, \{ fresh \}\);\s*if \(navigator\.onLine !== false && state\.picsFor !== null\) loadPictures\(projectIds\(\), true\);/,
    "every 5 minutes too: a picture that failed is fetched again with no reload");
  const pics = readFileSync(new URL("../site/js/plan-pictures.js", import.meta.url), "utf8");
  assert.ok(!/localStorage|sessionStorage|caches\./.test(pics), "kept in IndexedDB only");
  assert.match(pics, /const DB = "dcr2-plan-pictures";/);
});

test("a plan saved from a project's sub-folder (a Backup's, before the owner's rule of 2026-10-27) is never shown, and goes once a check says OneDrive no longer lists it; one moved up is a plan again", async () => {
  assert.equal(lib.inSubFolder("A267 - 1 Test Way/Backups"), true);
  assert.equal(lib.inSubFolder("A267 - 1 Test Way/Plans/Rev 2"), true);
  assert.equal(lib.inSubFolder("A267 - 1 Test Way"), false, "right in the project's folder: a plan");
  assert.equal(lib.inSubFolder(""), false);
  assert.equal(lib.inSubFolder(null), false);
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../site/js/plan-library.js", import.meta.url), "utf8");
  assert.match(src, /const all = \(await getAll\("plans"\)\)\.filter\(\(r\) => r\.owner === who && !inSubFolder\(r\.folder\)\);/, "list() leaves them out");
  // maybeCheck takes one off the device only once a check says OneDrive no longer lists it (a copy handed to the takeoff
  // app lately after its grace, as any Remove) - after the check, so a file moved up into the project's folder is kept
  const drop = src.slice(src.indexOf("async function dropSubFolderCopies"), src.indexOf("/** A hold after a failure"));
  // (P4: never one with a save of the person's own waiting on the device - that goes only with their own Remove)
  assert.match(drop, /for \(const r of \(await getAll\("plans"\)\)\.filter\(\(x\) => x\.owner === who && inSubFolder\(x\.folder\) && x\.latest && x\.latest\.status !== "ok" && !hasLocal\(x\)\)\) \{\s*try \{ await remove\(r\.itemId, \{ owner: who \}\); \}/,
    "gone, or denied (the project not visible: never found moved up)");
  const mc = src.slice(src.indexOf("export async function maybeCheck"), src.indexOf("/* ── opening in the takeoff app"));
  assert.ok(mc.indexOf("await dropSubFolderCopies(who);") > mc.indexOf("await checkUpdates();"), "maybeCheck: after the check");
  const cu = src.slice(src.indexOf("export async function checkUpdates"), src.indexOf("async function dropSubFolderCopies"));
  assert.match(cu, /if \(!next \|\| inSubFolder\(next\.folder\)\) continue;/, "Check now never counts a Backup's copy");
  assert.ok(cu.indexOf("await dropSubFolderCopies(who);") > cu.indexOf("sum.checked++"), "and takes them off at its end (Check now too)");
  // a check and a Save take the folder OneDrive lists the file in now
  assert.match(src, /const folder = a\.latest && a\.latest\.status === "ok" && a\.latest\.folder \? a\.latest\.folder : c\.folder;/);
  assert.match(src, /wide: false, folder: f\.folder \|\| r\.folder \}\);/);
  // and the rule itself: a sub-folder copy is gone at the next check (the broker never lists it), one moved up is ok again
  const backup = rec({ folder: F1.folder + "/Backups" });
  assert.equal(lib.applyCheck(backup, { files: [F2] }, AT).latest.status, "gone");
  const movedUp = lib.applyCheck(backup, { files: [F1] }, AT);
  assert.deepEqual([movedUp.latest.status, movedUp.latest.folder, lib.inSubFolder(movedUp.latest.folder)], ["ok", F1.folder, false]);
});

/* ── js/plan-pictures.js over an in-memory IndexedDB and a stub client ──────────────────────────────────────────── */

/** Just enough of IndexedDB for js/plan-pictures.js: open (with its upgrade), one store, getAll / put / delete. */
function memoryIndexedDB() {
  const dbs = new Map();
  return {
    dbs,
    open(name) {
      const req = {};
      setTimeout(function () {
        let stores = dbs.get(name);
        const fresh = !stores;
        if (fresh) { stores = new Map(); dbs.set(name, stores); }
        req.result = {
          createObjectStore(s) { stores.set(s, new Map()); },
          transaction(s) {
            const data = stores.get(s);
            const t = {
              objectStore() {
                return {
                  getAll() { return { result: Array.from(data.values()) }; },
                  put(v, k) { data.set(k, v); return {}; },
                  delete(k) { data.delete(k); return {}; },
                };
              },
            };
            setTimeout(function () { if (t.oncomplete) t.oncomplete(); }, 0);
            return t;
          },
          close() {},
        };
        if (fresh && req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    },
  };
}

test("the library's pictures (js/plan-pictures.js): kept per person, fetched again after a failure, a kept one never swapped for a link, let go only once replaced on the page", async () => {
  const idb = memoryIndexedDB();
  const realFetch = globalThis.fetch, realRevoke = URL.revokeObjectURL;
  globalThis.indexedDB = idb;
  // the made-up world: project id -> its picture's file id; Storage's signing and the bytes can fail
  const W = { pics: { 7: 55, 8: 66, 9: 77 }, signFails: false, fetchFails: false, fetched: [], signed: 0, revoked: [] };
  useClient({
    from(table) {
      return {
        select() { return this; },
        in(col, ids) {
          const rows = table === "projects"
            ? ids.filter((id) => id in W.pics).map((id) => ({ id, thumbnail_file_id: W.pics[id], deleted_at: null }))
            : ids.map((id) => ({ id, storage_path: "p/x/thumbnail/" + id + "/thumbnail.jpg", preview_path: null, storage: "cloud" }));
          return Promise.resolve({ data: rows, error: null });
        },
      };
    },
    storage: { from() { return { async createSignedUrls(paths) {
      W.signed++;
      if (W.signFails) return { data: null, error: { message: "Failed to fetch", status: 0 } };
      return { data: paths.map((pth) => ({ path: pth, signedUrl: "https://made-up.supabase.co/sign/" + pth + "?t=" + W.signed, error: null })), error: null };
    } }; } },
  });
  globalThis.fetch = async (u) => {
    W.fetched.push(String(u));
    if (W.fetchFails) throw new TypeError("Failed to fetch");
    return new Response(new Blob(["made-up picture " + u], { type: "image/jpeg" }));
  };
  URL.revokeObjectURL = (u) => { W.revoked.push(u); return realRevoke.call(URL, u); };
  const kept = () => Array.from(idb.dbs.get("dcr2-plan-pictures").get("pics").entries()).map(([k, v]) => k + "=" + v.fileId).sort();
  try {
    const P = await import("../site/js/plan-pictures.js");
    // A's picture of 7 is fetched and kept under A's name
    const a1 = await P.refresh("userA", ["7"], ["userA"]);
    assert.match(a1["7"], /^blob:/);
    assert.deepEqual(kept(), ["userA|7=55"]);
    // B (plans for 9 only) on the same device: A's stays, B's is kept apart
    const b1 = await P.refresh("userB", ["9"], ["userA", "userB"]);
    assert.match(b1["9"], /^blob:/);
    assert.deepEqual(kept(), ["userA|7=55", "userB|9=77"], "one person's visit never takes another's picture");
    assert.deepEqual(Object.keys(await P.shown("userA", ["7", "9"])), ["7"], "each person sees their own");
    // Storage's signing fails once: nothing shown, nothing kept - and the next refresh signs again and keeps it
    W.signFails = true;
    assert.deepEqual(await P.refresh("userA", ["7", "8"], ["userA", "userB"]), { 7: a1["7"] }, "8 not loaded");
    W.signFails = false;
    const a2 = await P.refresh("userA", ["7", "8"], ["userA", "userB"]);
    assert.match(a2["8"], /^blob:/, "signed again: a failed signing is never remembered as 'no picture'");
    assert.deepEqual(kept(), ["userA|7=55", "userA|8=66", "userB|9=77"]);
    // 7's picture changes but its bytes cannot be fetched: the kept one stays shown (it opens with no signal), never the link
    W.pics[7] = 56;
    W.fetchFails = true;
    const a3 = await P.refresh("userA", ["7", "8"], ["userA", "userB"]);
    assert.equal(a3["7"], a1["7"], "the picture kept before stays");
    assert.deepEqual(kept(), ["userA|7=55", "userA|8=66", "userB|9=77"]);
    // fetched again at the next refresh: the new one shown and kept; the old object URL is let go only at the call after
    W.fetchFails = false;
    const before = W.revoked.length;
    const a4 = await P.refresh("userA", ["7", "8"], ["userA", "userB"]);
    assert.ok(a4["7"] && a4["7"] !== a1["7"] && /^blob:/.test(a4["7"]));
    assert.deepEqual(kept(), ["userA|7=56", "userA|8=66", "userB|9=77"]);
    assert.equal(W.revoked.length, before, "not let go while the page may still draw it");
    await P.shown("userA", ["7"]);
    assert.ok(W.revoked.indexOf(a1["7"]) !== -1, "let go at the next call, once the page drew its replacement");
    // a new project with no picture kept and its bytes failing: the link itself while online, fetched again next time
    W.pics[10] = 88;
    W.fetchFails = true;
    const a5 = await P.refresh("userA", ["7", "8", "10"], ["userA", "userB"]);
    assert.match(a5["10"], /^https:\/\/made-up\.supabase\.co\/sign\//);
    W.fetchFails = false;
    const a6 = await P.refresh("userA", ["7", "8", "10"], ["userA", "userB"]);
    assert.match(a6["10"], /^blob:/, "fetched again and kept");
    assert.ok(kept().includes("userA|10=88"));
    // A removed the plans of 8 and 10: their pictures go; B is no longer on this device: B's goes too
    await P.refresh("userA", ["7"], ["userA"]);
    assert.deepEqual(kept(), ["userA|7=56"]);
    // a picture taken off the project goes
    delete W.pics[7];
    assert.deepEqual(await P.refresh("userA", ["7"], ["userA"]), {});
    assert.deepEqual(kept(), []);
    // offline (no answer from the database): what is kept is shown, nothing is pruned
    W.pics[7] = 57;
    await P.refresh("userC", ["7"], ["userC"]);
    useClient({ from() { return { select() { return this; }, in() { return Promise.reject(Object.assign(new Error("Failed to fetch"), { code: "NETWORK" })); } }; } });
    const c1 = await P.refresh("userC", ["7"], ["userC"]);
    assert.match(c1["7"], /^blob:/);
    assert.deepEqual(kept(), ["userC|7=57"]);
    // forgetAll is one person's only
    await P.forgetAll("userZ");
    assert.deepEqual(kept(), ["userC|7=57"]);
    await P.forgetAll("userC");
    assert.deepEqual(kept(), []);
    assert.deepEqual(await P.shown("userC", ["7"]), {});
    // a link that is not Storage's https one (the demo's data:) is shown, never fetched
    W.fetched.length = 0;
    useClient({
      from(table) { return { select() { return this; }, in(col, ids) {
        return Promise.resolve({ data: table === "projects" ? [{ id: 12, thumbnail_file_id: 99, deleted_at: null }]
          : [{ id: 99, storage_path: "p/x/thumbnail/99/thumbnail.jpg", preview_path: null, storage: "cloud" }], error: null }); } }; },
      storage: { from() { return { async createSignedUrls(paths) { return { data: paths.map((pth) => ({ path: pth, signedUrl: "data:image/svg+xml,x", error: null })), error: null }; } }; } },
    });
    assert.deepEqual(await P.refresh("userD", ["12"], ["userD"]), { 12: "data:image/svg+xml,x" });
    assert.deepEqual(W.fetched, []);
    assert.deepEqual(await P.shown(""), {}, "no person: nothing");
  } finally {
    useClient(null);
    globalThis.fetch = realFetch;
    URL.revokeObjectURL = realRevoke;
    delete globalThis.indexedDB;
  }
});

test("the library's pictures with two tabs open: what the other tab kept wins over a link or an older picture this tab shows", async () => {
  const idb = memoryIndexedDB();
  const realFetch = globalThis.fetch;
  globalThis.indexedDB = idb;
  const W = { pics: { 20: 200, 21: 210 }, fetchFails: false, signed: 0 };
  useClient({
    from(table) {
      return { select() { return this; }, in(col, ids) {
        const rows = table === "projects"
          ? ids.filter((id) => id in W.pics).map((id) => ({ id, thumbnail_file_id: W.pics[id], deleted_at: null }))
          : ids.map((id) => ({ id, storage_path: "p/x/thumbnail/" + id + "/thumbnail.jpg", preview_path: null, storage: "cloud" }));
        return Promise.resolve({ data: rows, error: null });
      } };
    },
    storage: { from() { return { async createSignedUrls(paths) {
      W.signed++;
      return { data: paths.map((pth) => ({ path: pth, signedUrl: "https://made-up.supabase.co/sign/" + pth + "?t=" + W.signed, error: null })), error: null };
    } }; } },
  });
  globalThis.fetch = async (u) => {
    if (W.fetchFails) throw new TypeError("Failed to fetch");
    return new Response(new Blob(["made-up picture " + u], { type: "image/jpeg" }));
  };
  try {
    // two tabs: two copies of the module (each page has its own), one IndexedDB
    const T1 = await import("../site/js/plan-pictures.js?tab=1");
    const T2 = await import("../site/js/plan-pictures.js?tab=2");
    // tab 1 keeps 21's picture; 20's bytes fail there: the link
    W.fetchFails = true;
    await T1.refresh("userA", ["21"], ["userA"]);
    W.fetchFails = false;
    const one = await T1.refresh("userA", ["21"], ["userA"]);
    assert.match(one["21"], /^blob:/);
    W.fetchFails = true;
    const linked = await T1.refresh("userA", ["20", "21"], ["userA"]);
    assert.match(linked["20"], /^https:/, "tab 1: 20 only as a link");
    // 21's picture changes; tab 2 (working connection) keeps both 20 and the new 21
    W.pics[21] = 211;
    W.fetchFails = false;
    const two = await T2.refresh("userA", ["20", "21"], ["userA"]);
    assert.match(two["20"], /^blob:/);
    // tab 1, with no connection to fetch anything: the kept ones win - 20's kept picture, not the link; 21's new one
    W.fetchFails = true;
    const again = await T1.refresh("userA", ["20", "21"], ["userA"]);
    assert.match(again["20"], /^blob:/, "the kept picture, never the link that runs out");
    assert.ok(again["21"] && again["21"] !== one["21"] && /^blob:/.test(again["21"]), "the new picture tab 2 kept, not the old one");
    // and offline (no answer at all): what tab 1 shows now stays
    useClient({ from() { return { select() { return this; }, in() { return Promise.reject(new Error("Failed to fetch")); } }; } });
    assert.deepEqual(await T1.refresh("userA", ["20", "21"], ["userA"]), again);
    assert.deepEqual(await T1.shown("userA", ["20", "21"]), again);
  } finally {
    useClient(null);
    globalThis.fetch = realFetch;
    delete globalThis.indexedDB;
  }
});

test("the library page loads (and prunes) pictures only after its first draw: the rows are this person's then", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../site/js/pages/plans-library.js", import.meta.url), "utf8");
  assert.match(page, /picsFor: null,/);
  assert.match(page, /if \(state\.picsFor !== null\) loadPictures\(projectIds\(\), true\);/, "the 'online' handler");
  assert.match(page, /if \(navigator\.onLine !== false && state\.picsFor !== null\) loadPictures\(projectIds\(\), true\);/, "the 5 minutes");
  assert.equal((page.match(/loadPictures\(/g) || []).length, 6, "its own line, render's two calls, the again path, the 'online' handler, the interval");
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
/** a broker answer with a Retry-After (seconds), as the broker's 503s carry it (exposed to this site) */
const httpRA = (status, body, ra) => ({ data: null, error: { name: "FunctionsHttpError",
  context: new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "Retry-After": String(ra) } }) } });
async function refusal(p) {
  try { await p; } catch (e) { return e; }
  assert.fail("expected a refusal");
}

test("plansList: op plans_list, 1 to 20 projects a call; each project's files read through planFileOf (a malformed one left out)", async () => {
  const calls = stub((b) => {
    const projects = {};
    for (const id of b.project_ids) projects[String(id)] = { number: "A" + id, files: [F1, { id: "bad", name: "x.pdf" }, F2] };
    if (projects["8"]) projects["8"].complete = false;              // a walk that did not finish
    if (projects["9"]) projects["9"].save_back = true;              // the broker takes a save of A9's plans (addendum 3 D1)
    if (projects["10"]) projects["10"].save_back = "yes";           // not its true: never taken for one
    projects["999"] = { number: "A999", files: [F3] };             // not asked: never used
    return ok({ projects, checked_at: AT });
  });
  const ids = Array.from({ length: 45 }, (_, i) => i + 1);
  const got = await onedrive.plansList(ids.concat(["3", "x", 0]));
  assert.deepEqual(calls.map((c) => [c.name, c.body.op, c.body.project_ids.length]), [["onedrive", "plans_list", 20], ["onedrive", "plans_list", 20], ["onedrive", "plans_list", 5]]);
  assert.equal(onedrive.LIST_BATCH, 20);
  assert.deepEqual(got["7"], { number: "A7", files: [F1, F2], complete: true, saveBack: false }, "complete unless the broker says false; no save_back: false (an older broker)");
  assert.equal(got["8"].complete, false, "the broker's false comes through");
  assert.deepEqual([got["9"].saveBack, got["10"].saveBack], [true, false], "save_back: only the broker's true");
  // ...and kept on the record by applyCheck: the frame offers a save only while it is true (a project not visible: false)
  assert.deepEqual([lib.applyCheck(rec({}), got["9"], AT).saveBack, lib.applyCheck(rec({ saveBack: true }), got["7"], AT).saveBack,
    lib.applyCheck(rec({ saveBack: true }), null, AT).saveBack, lib.applyCheck(rec({ saveBack: true }), Object.assign({}, got["9"], { files: [], complete: false }), AT).saveBack],
    [true, false, false, true], "the latest answer's, also from a walk that did not finish");
  // and through applyCheck: a saved plan missing from that unfinished list is not taken for gone
  const kept = rec({ latest: { status: "ok", version: "qx:AAA" } });
  assert.deepEqual(lib.applyCheck(kept, Object.assign({}, got["8"], { files: [] }), AT).latest, kept.latest);
  assert.equal(lib.applyCheck(rec({ latest: null, file: "" }), { files: [], complete: false }, AT).latest, null,
    "a first download not finished keeps latest null (checkUpdates' summary reads it null-safe)");
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
  assert.deepEqual(await onedrive.planLink(7, F1.id), Object.assign({ url }, F1, { saveBack: false }), "no save_back (an older broker): false");
  assert.deepEqual(calls[0].body, { op: "plan_link", project_id: 7, item_id: F1.id });
  stub(() => ok(Object.assign({ url, save_back: true }, F1)));
  assert.equal((await onedrive.planLink(7, F1.id)).saveBack, true, "the broker's save_back (addendum 3 D1)");
  stub(() => ok(Object.assign({ url, save_back: 1 }, F1)));
  assert.equal((await onedrive.planLink(7, F1.id)).saveBack, false, "only its true");
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
    assert.deepEqual(got[String(a001.id)], { number: "A001", files: [], complete: true, saveBack: key !== "accountant" }, key + ": save_back - the save back's gate and the switch");
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

/** The demo's broker through Portal 2's own uploader, as js/plan-library.js drives it (session with the plan's name,
    the broker's commit of a deferred replace, plan_save_done with the save's hash; a dropped replace sent again as a
    copy) - the transport is the demo's OneDrive host. */
function demoSend(ext) {
  return (j) => new Promise((resolve) => {
    const up = createUploaderRef({
      send: async (req) => {
        const r = ext.http(req.method, req.url, Object.assign({}, req.headers), req.body);
        return { status: r.status, header: (n) => r.headers[String(n).toLowerCase()] || null, text: () => (typeof r.body === "string" ? r.body : "") };
      },
      broker: {
        session: (job) => onedrive.planSaveSession({ projectId: job.projectId, itemId: job.meta.itemId, version: job.meta.base, size: job.size,
          name: job.meta.name, mode: job.meta.mode === "copy" ? "copy" : undefined }),
        done: (job, itemId, ticket) => onedrive.planSaveDone(job.projectId, itemId, ticket, job.meta.hash),
        commit: async (job) => {
          try {
            return await onedrive.planSaveCommit({ projectId: job.projectId, itemId: job.meta.itemId, ticket: job.session.ticket, uploadUrl: job.session.uploadUrl,
              hash: job.meta.hash, landed: job.chunkLanded === true });
          } catch (x) {
            if (x && x.code === "plan_changed") { job.meta.mode = "copy"; job.meta.why = x.info && x.info.why; x.restart = true; }
            throw x;
          }
        },
        find: async () => [],
      },
      // (a wait - the broker's 503 asked again, Retry-After 30 s in DCR Desktop 2 - ends once the demo's OneDrive hashed
      // what landed, as Microsoft's would have by then)
      setTimeout: (fn) => { ext.hashed().then(() => setTimeout(fn, 0)); }, wait: () => 1,
    });
    up.onChange((items) => { const x = items[0]; if (x && ["done", "failed", "cancelled"].includes(x.state)) resolve(x); });
    up.add(j);
  });
}
let createUploaderRef = null;
const bytesOf = (n, fill) => new Uint8Array(n).fill(fill);

test("demo plan_save_session / plan_save_commit / plan_save_done (the iPad's save back): a replace is deferred and committed by the broker, keeps the plan's id and gives it a new version (sm:, then OneDrive's REAL quickXorHash of the same bytes); a changed plan becomes a copy beside it; the gate is prices AND the upload switch", { skip }, async () => {
  await setup();
  createUploaderRef = (await import("../site/js/onedrive-upload.js")).createUploader;
  const a267 = project("A267");
  const ext = E.exts.find((x) => x.name === "p7-onedrive");
  const send = demoSend(ext);
  as("manager_prices");
  const before = (await onedrive.plansList([a267.id]))[String(a267.id)].files;
  const plan = before.find((f) => f.name === "A267 Bid.takeoff");
  const raw = bytesOf(3 * 327680 + 11, 80);
  const bytes = new File([raw], plan.name);
  const hash = QX.quickXorHash(raw);
  const s0 = await onedrive.planSaveSession({ projectId: a267.id, itemId: plan.id, version: plan.version, size: 5, name: plan.name });
  assert.deepEqual([s0.mode, s0.commit], ["replace", "broker"], "a replace is deferred: the broker commits it");
  const job = await send({ projectId: a267.id, file: bytes, name: plan.name, meta: { itemId: plan.id, base: plan.version, name: plan.name, hash } });
  assert.equal(job.state, "done", job.error);
  assert.deepEqual([job.result.mode, job.result.id, job.result.size], ["replace", plan.id, bytes.size], "the plan itself, by its id");
  // (DCR Desktop 2 48dc59e: a replace is verified on OneDrive's hash only - its check waits for it, never answers on a
  // size: the commit's answer is OneDrive's quickXorHash of the bytes, the device's own)
  assert.equal(job.result.version, "qx:" + hash, "OneDrive's quickXorHash of the bytes - the device's own");
  await ext.hashed();
  const after = (await onedrive.plansList([a267.id]))[String(a267.id)].files.find((f) => f.id === plan.id);
  assert.equal(after.version, "qx:" + hash, "plans_list says so too");
  // a device whose base is the sm: form of those bytes (an answer before OneDrive hashed them): the same bytes - a
  // replace (BRK-7)
  const smOf = "sm:" + bytes.size + ":" + after.modified;
  const sm = await onedrive.planSaveSession({ projectId: a267.id, itemId: plan.id, version: smOf, size: 5, name: plan.name });
  assert.deepEqual([sm.mode, sm.commit], ["replace", "broker"], "sm:<size>:<time> of the plan now is its version");
  assert.deepEqual([after.size, after.modified], [bytes.size, job.result.modified], "the same bytes...");
  const smAnswer = Object.assign({}, job.result, { version: smOf });
  assert.ok(/^qx:/.test(after.version) && lib.keptAs({ file: "p1-a-1.takeoff", version: smOf, size: bytes.size,
    expect: lib.expectOf(smAnswer) }, after), "...under OneDrive's hash: taken without a download");
  // someone saved it meanwhile (the device still has the old version): a copy beside it, the plan untouched
  const copy = await send({ projectId: a267.id, file: new File([new Uint8Array(100).fill(80)], plan.name), name: plan.name,
    meta: { itemId: plan.id, base: plan.version } });
  assert.equal(copy.state, "done", copy.error);
  assert.equal(copy.result.mode, "copy");
  assert.match(copy.result.name, /^A267 Bid - iPad \d{4}-\d{2}-\d{2} \d{4}\.takeoff$/);
  const files = (await onedrive.plansList([a267.id]))[String(a267.id)].files;
  assert.ok(files.some((f) => f.id === copy.result.id && f.name === copy.result.name && f.folder === plan.folder), "a plan of the project now");
  assert.equal(files.find((f) => f.id === plan.id).size, bytes.size, "the plan as the first save left it");
  // the same minute again: " (2)"
  const second = await send({ projectId: a267.id, file: new File([new Uint8Array(100).fill(80)], plan.name), name: plan.name,
    meta: { itemId: plan.id, base: plan.version } });
  assert.match(second.result.name, /^A267 Bid - iPad \d{4}-\d{2}-\d{2} \d{4}(?: \(2\))?\.takeoff$/);
  // a done for another ticket, or before the bytes landed: not_saved
  const s = await onedrive.planSaveSession({ projectId: a267.id, itemId: plan.id, version: after.version, size: 5 });
  assert.equal(s.mode, "replace");
  assert.equal((await refusal(onedrive.planSaveDone(a267.id, plan.id, s.ticket))).code, "not_saved");
  // the gate: prices AND the upload switch (an accountant with prices, no switch: told so); no prices at all; too large
  as("accountant");
  const no = await refusal(onedrive.planSaveSession({ projectId: a267.id, itemId: plan.id, version: after.version, size: 5 }));
  assert.equal(no.code, "forbidden");
  assert.match(no.message, /Can upload to OneDrive/);
  as("field");
  assert.equal((await refusal(onedrive.planSaveSession({ projectId: a267.id, itemId: plan.id, version: after.version, size: 5 }))).code, "forbidden");
  as("admin");
  const big = await refusal(onedrive.planSaveSession({ projectId: a267.id, itemId: plan.id, version: after.version, size: 4096 * 1024 * 1024 + 1 }));
  assert.deepEqual([big.code, big.info.max_bytes], ["too_large", 4096 * 1024 * 1024]);
  assert.equal((await refusal(onedrive.planSaveSession({ projectId: a267.id, itemId: "01DEMONOTAPLAN", version: after.version, size: 5 }))).code, "not_found");
});

test("demo broker as DCR Desktop 2's since the repair round (contract addendum 3): the switch ONEDRIVE_PLAN_SAVE (save_back, 503 save_back_off before anything else); every replace checked by the version history - verified, or a crossed office save put back and plan_changed; landed; PUT refused -> the POST; both refused -> why refused; no history -> unverified; a hashless deferred ticket -> need hash (at any age since addendum 4); OneDrive's hash missing -> unproved; a retried commit checked before a copy; an identical re-save found landed", { skip }, async () => {
  let shift = 0;
  FK = await loadFake();
  E = FK.createEngine({ maxFileSize: 500 * 1024 * 1024, clock: () => new Date(Date.now() + shift) });
  E.load(FK.seed({ now: new Date() }));
  createUploaderRef = (await import("../site/js/onedrive-upload.js")).createUploader;
  const a267 = project("A267"), a024 = project("A024");
  const ext = E.exts.find((x) => x.name === "p7-onedrive");
  const send = demoSend(ext);
  const files = async (pid) => (await onedrive.plansList([pid]))[String(pid)].files;
  const fresh = async (name) => {
    const f = (await files(a267.id)).find((x) => x.name === name);
    const fx = ext.setPlanFixture("A267", new Blob([bytesOf(5000, 11)]), name);           // a version of its own (its base)
    return Object.assign({}, f, { size: fx.size, version: fx.version, modified: (await files(a267.id)).find((x) => x.id === f.id).modified, full: fx.full });
  };
  const sendOf = (plan, raw, extra) => send({ projectId: a267.id, file: new File([raw], plan.name), name: plan.name,
    meta: Object.assign({ itemId: plan.id, base: plan.version, name: plan.name, hash: QX.quickXorHash(raw) }, extra || {}) });
  const past = (ms) => { shift += ms; };                         // the demo's clock moves on (an office save comes later)
  const refuse = (on) => ext.refuseCopyCommits(on);
  try {
    // (D1) the switch: save_back per project for those who pass the gate; plan_save_session's 503 after the gate
    as("manager_prices");
    const NOT_UNDERSTOOD = ["only:A267,all", "on", "only:A267 A024", "a ll", "only:A267\tA024"];
    for (const [v, a, b] of [["all", true, true], ["off", false, false], ["", false, false], ["only:a267", true, false], ["only: A024 , A999", false, true],
      ["only:A267,all", false, false], ["on", false, false], ["  only : a267 ,  A024  ", true, true], [" ALL ", true, true],
      // (DCR Desktop 2 f1376ea) a space INSIDE a part: not understood - never two numbers merged into one, nor "a ll" all
      ["only:A267 A024", false, false], ["a ll", false, false], ["only:A267\tA024", false, false]]) {
      ext.setPlanSave(v);
      ext.logLines(true);
      const got = await onedrive.plansList([a267.id, a024.id]);
      assert.deepEqual([got[String(a267.id)].saveBack, got[String(a024.id)].saveBack], [a, b], JSON.stringify(v));
      const said = ext.logLines(true).filter((l) => /not understood/.test(l));
      assert.equal(said.length > 0, NOT_UNDERSTOOD.includes(v), JSON.stringify(v) + ": the log says it was not understood (never the value)");
      assert.ok(said.every((l) => l === "onedrive plans_list: ONEDRIVE_PLAN_SAVE not understood: off"));
      const p0 = (await files(a267.id))[0];
      assert.equal((await onedrive.planLink(a267.id, p0.id)).saveBack, a, "plan_link's too");
      if (!a) {
        const e = await refusal(onedrive.planSaveSession({ projectId: a267.id, itemId: p0.id, version: p0.version, size: 5 }));
        assert.deepEqual([e.code, e.status], ["save_back_off", 503], JSON.stringify(v));
      }
    }
    ext.setPlanSave("off");
    as("accountant");                                        // no upload switch: the person's gate first (403, as before)
    assert.equal((await refusal(onedrive.planSaveSession({ projectId: a267.id, itemId: (await files(a267.id))[0].id, version: "qx:x", size: 5 }))).code, "forbidden");
    as("field");
    assert.equal((await refusal(onedrive.planSaveSession({ projectId: a267.id, itemId: "01DEMOTKO000F000", version: "qx:x", size: 5 }))).code, "forbidden");
    ext.setPlanSave("only:A267");
    as("admin");
    // (D2 step 4) a replace: the version history shows the base right under the save - verified
    const p1 = await fresh("A267 Bid.takeoff");
    const r1 = bytesOf(2 * 327680 + 9, 21);
    ext.logLines(true);
    const j1 = await sendOf(p1, r1);
    assert.deepEqual([j1.state, j1.result.mode, j1.result.verified], ["done", "replace", true], j1.error);
    assert.ok(ext.logLines().includes("onedrive plan_save_commit: the version history shows the base right under this save: verified"));
    const v1 = ext.versionsOf(p1.id);
    assert.deepEqual([v1[0].size, v1[1].size], [r1.length, 5000], "this save over the base");
    // a crossing: an office save between the commit's walk and its commit, OneDrive not holding the PUT's If-Match - the
    // office save is put back (a new version of its bytes: ours stays in the history), and the save goes as a copy
    past(3000);
    const base2 = (await files(a267.id)).find((x) => x.id === p1.id);
    ext.graphModes({ putIfMatch: "ignored" });
    ext.betweenWalkAndCommit(p1.full);
    ext.logLines(true);
    const r2 = bytesOf(327680 + 3, 22);
    const j2 = await sendOf(Object.assign({}, p1, { version: base2.version }), r2);
    assert.deepEqual([j2.state, j2.result.mode], ["done", "copy"], j2.error);
    assert.match(j2.result.name, /^A267 Bid - iPad \d{4}-\d{2}-\d{2} \d{4}(?: \(\d\))?\.takeoff$/);
    const log2 = ext.logLines();
    assert.ok(log2.includes("onedrive plan_save_commit: crossed: the office save was put back"), JSON.stringify(log2));
    // (repair round 2, S4) put back only on the hash's proof: the commit's own check came before the demo's OneDrive had
    // hashed the bytes it just landed - 503, asked again
    assert.ok(log2.indexOf("onedrive plan_save_commit: crossed: OneDrive has no hash of the newest version yet, so it is not known to be this save: asked again") !== -1 &&
      log2.indexOf("onedrive plan_save_commit: crossed: OneDrive has no hash of the newest version yet, so it is not known to be this save: asked again") <
      log2.indexOf("onedrive plan_save_commit: crossed: the office save was put back"), JSON.stringify(log2));
    const now2 = (await files(a267.id)).find((x) => x.id === p1.id);
    assert.match(now2.version, /^qx:demo-office-/, "the office's save is the plan again");
    const v2 = ext.versionsOf(p1.id);
    assert.deepEqual(v2.slice(0, 3).map((v) => v.size), [now2.size, r2.length, now2.size], "the restored office save, ours under it, the office save");
    // (D3) landed: OneDrive committed at the last chunk itself (deferCommit ignored), an office save during the upload -
    // the broker only checks: crossed, put back, a copy; never adopted from the last chunk's answer
    ext.graphModes({ reset: true, deferCommit: "ignored" });
    const p3 = await fresh("A267 Rev 2.takeoff");
    past(3000);
    ext.duringUpload(p3.full, "office");
    ext.logLines(true);
    const r3 = bytesOf(2 * 327680 + 1, 23);
    const j3 = await sendOf(p3, r3);
    assert.deepEqual([j3.state, j3.result && j3.result.mode], ["done", "copy"], j3.error + " " + JSON.stringify(ext.logLines()));
    const log3 = ext.logLines();
    assert.ok(log3.includes("onedrive plan_save_commit: OneDrive committed at the last chunk: deferCommit not honoured here"), JSON.stringify(log3));
    assert.ok(log3.includes("onedrive plan_save_commit: crossed: the office save was put back"));
    assert.match((await files(a267.id)).find((x) => x.id === p3.id).version, /^qx:demo-office-/, "the office save stays the plan");
    // ...without an office save: landed, checked, verified
    const p3b = await fresh("A267 Rev 2.takeoff");
    const j3b = await sendOf(p3b, bytesOf(327680 + 5, 24));
    assert.deepEqual([j3b.state, j3b.result.mode, j3b.result.verified], ["done", "replace", true], j3b.error);
    // (D2 attempt B) the PUT refused: the zero-length POST commits it
    ext.graphModes({ reset: true, putCommit: "refused" });
    const p4 = await fresh("L1 walls.takeoff");
    ext.logLines(true);
    const j4 = await sendOf(p4, bytesOf(327680 + 7, 25));
    assert.deepEqual([j4.state, j4.result.mode, j4.result.verified], ["done", "replace", true], j4.error);
    assert.ok(ext.logLines().includes("onedrive plan_save_commit: the PUT commit was refused (400): the POST commit"));
    // ...an office save between attempt B's own walk and its POST (the checkers' repair round 2): the POST's If-Match
    // honoured - Microsoft's 412, the same upload committed as the copy; ignored (it is not documented there) - the POST
    // lands over the office save and the version check puts it back, the save going again as a copy
    const PUT_BACK = "onedrive plan_save_commit: crossed: the office save was put back";
    const GOT_412 = "onedrive plan_save_commit: the plan changed just now (412): the same upload is committed as a copy";
    for (const [postIfMatch, has, hasNot] of [["honoured", [GOT_412], [PUT_BACK]], ["ignored", [PUT_BACK], [GOT_412]]]) {
      ext.graphModes({ reset: true, putCommit: "refused", postIfMatch });
      const pb = await fresh("L1 walls.takeoff");
      past(3000);
      ext.betweenWalkAndCommit(pb.full);
      ext.logLines(true);
      const rb = bytesOf(327680 + 13, 29);
      const jb = await sendOf(pb, rb);
      const logB = ext.logLines();
      assert.deepEqual([jb.state, jb.result && jb.result.mode], ["done", "copy"], postIfMatch + ": " + jb.error + JSON.stringify(logB));
      assert.ok(logB.includes("onedrive plan_save_commit: the PUT commit was refused (400): the POST commit") && has.every((x) => logB.includes(x)) &&
        !hasNot.some((x) => logB.includes(x)), postIfMatch + JSON.stringify(logB));
      const nowB = (await files(a267.id)).find((x) => x.id === pb.id);
      assert.match(nowB.version, /^qx:demo-office-/, postIfMatch + ": the office save is the plan");
      assert.equal((await ext.planBlobOf(jb.result.id).arrayBuffer()).byteLength, rb.length, "the copy holds the save");
    }
    // (repair round 2, S2) a restore Microsoft does not take: 503, asked again - never plan_changed with the iPad's bytes
    // over the office save; once it goes through, put back
    for (const status of [503, 423, 403]) {
      ext.graphModes({ reset: true, putIfMatch: "ignored", restoreStatus: status });
      const pr = await fresh("A267 Bid.takeoff");
      past(3000);
      ext.betweenWalkAndCommit(pr.full);
      const rr = bytesOf(327680 + 15, 30);
      const sr = await onedrive.planSaveSession({ projectId: a267.id, itemId: pr.id, version: pr.version, size: rr.length, name: pr.name });
      for (const [a, z] of [[0, 327679], [327680, rr.length - 1]]) ext.http("PUT", sr.uploadUrl, { "Content-Range": "bytes " + a + "-" + z + "/" + rr.length }, new Blob([rr.subarray(a, z + 1)]));
      const body = { projectId: a267.id, itemId: pr.id, ticket: sr.ticket, uploadUrl: sr.uploadUrl, hash: QX.quickXorHash(rr) };
      assert.equal((await refusal(onedrive.planSaveCommit(body))).code, "busy", status + ": OneDrive has no hash yet");
      await ext.hashed();
      ext.logLines(true);
      const er = await refusal(onedrive.planSaveCommit(body));
      assert.deepEqual([er.code, er.status], [status === 403 ? "not_authorized" : "busy", 503], status + ": the restore did not go through - asked again");
      // (DCR Desktop 2 e1fd4c4, contract addendum 6 H1: a 503 does not say whether it went through - the history read
      // again shows it did not; a plain refusal, 423 / 403, says so itself)
      assert.ok(ext.logLines().includes(status === 503 ? "onedrive plan_save_commit: crossed: the restore's answer was lost: checking again"
        : "onedrive plan_save_commit: crossed: the office save could not be put back (" + status + "): asked again"), JSON.stringify(ext.logLines()));
      assert.equal((await files(a267.id)).find((x) => x.id === pr.id).version, "qx:" + QX.quickXorHash(rr), status + ": still the iPad's bytes (no plan_changed yet)");
      ext.graphModes({ restoreStatus: 0 });
      const ok2 = await refusal(onedrive.planSaveCommit(body));
      assert.deepEqual([ok2.code, ok2.info && ok2.info.why], ["plan_changed", "changed"], status + ": the retry put it back");
      assert.match((await files(a267.id)).find((x) => x.id === pr.id).version, /^qx:demo-office-/);
    }
    // (repair round 2, S3) an office version timed at or before the base under ours is a crossing all the same: put back
    ext.graphModes({ reset: true, putIfMatch: "ignored" });
    {
      const p3s = await fresh("A267 Rev 2.takeoff");
      past(-60000);                                        // the office's clock is behind: its save is timed before the base
      ext.betweenWalkAndCommit(p3s.full);
      const r3s = bytesOf(327680 + 17, 31);
      ext.logLines(true);
      const j3s = await sendOf(p3s, r3s);
      past(60000);
      assert.deepEqual([j3s.state, j3s.result && j3s.result.mode], ["done", "copy"], j3s.error + JSON.stringify(ext.logLines()));
      assert.ok(ext.logLines().includes("onedrive plan_save_commit: crossed: the office save was put back"));
      assert.match((await files(a267.id)).find((x) => x.id === p3s.id).version, /^qx:demo-office-/, "the office save is the plan");
    }
    // (contract addendum 4 E1; DCR Desktop 2 49cca8c) no hash of the save: no deferred replace is committed or settled -
    // 409 not_saved {need: "hash"} at ANY age, before anything of OneDrive's: nothing committed, nothing restored
    {
      const p4s = await fresh("A267 Bid.takeoff");
      past(3000);
      const r4s = bytesOf(327680 + 19, 32);
      const s4s = await onedrive.planSaveSession({ projectId: a267.id, itemId: p4s.id, version: p4s.version, size: r4s.length, name: p4s.name });
      for (const [a, z] of [[0, 327679], [327680, r4s.length - 1]]) ext.http("PUT", s4s.uploadUrl, { "Content-Range": "bytes " + a + "-" + z + "/" + r4s.length }, new Blob([r4s.subarray(a, z + 1)]));
      ext.logLines(true);
      const before = ext.versionsOf(p4s.id).length;
      for (const landed of [false, true]) {
        const e4 = await refusal(onedrive.planSaveCommit({ projectId: a267.id, itemId: p4s.id, ticket: s4s.ticket, uploadUrl: s4s.uploadUrl, landed }));
        assert.deepEqual([e4.code, e4.info && e4.info.need, e4.message], ["not_saved", "hash", "This save can be checked now only with the file's hash - send it again with the hash."], "landed " + landed);
      }
      const e4d = await refusal(onedrive.planSaveDone(a267.id, p4s.id, s4s.ticket));
      assert.deepEqual([e4d.code, e4d.info && e4d.info.need], ["not_saved", "hash"], "plan_save_done right after the session too (D4 was past 48 hours only)");
      assert.deepEqual(ext.logLines(), ["onedrive plan_save_commit: a deferred replace is committed or settled only with the file's hash: not saved, the hash is needed",
        "onedrive plan_save_commit: a deferred replace is committed or settled only with the file's hash: not saved, the hash is needed",
        "onedrive plan_save_done: a deferred replace is committed or settled only with the file's hash: not saved, the hash is needed"]);
      assert.deepEqual([ext.versionsOf(p4s.id).length, (await files(a267.id)).find((x) => x.id === p4s.id).version], [before, p4s.version], "nothing committed");
      // through the uploader without a hash: never a copy of it either (js/plan-library.js never asks so: its rule)
      const j4s = await sendOf(p4s, r4s, { hash: null });
      assert.deepEqual([j4s.state, j4s.code], ["failed", "not_saved"]);
      assert.equal((await files(a267.id)).find((x) => x.id === p4s.id).version, p4s.version);
    }
    // (contract addendum 4 E1) OneDrive gives no hash of the newest version: the crossing waits for it (503, asked
    // again) until HASH_WAIT_MS after the plan's change, then "unproved" - nothing put back, the admin's log line;
    // plan_save_commit's 409 plan_changed {why: "unproved"}, plan_save_done's 409 not_saved {why: "unproved"}
    const UNPROVED = "OneDrive could not show whether this save went over an office save: it is sent again as a separate file - check the plan's version history in OneDrive.";
    const NOT_PROVED = "crossed: not proved (OneDrive gave no hash): check the plan's version history by hand";
    for (const op of ["plan_save_commit", "plan_save_done"]) {
      ext.graphModes({ reset: true, hashes: "off", deferCommit: "ignored" });
      const pu = await fresh("A267 Rev 2.takeoff");
      past(3000);
      ext.duringUpload(pu.full, "office");
      const ru = bytesOf(327680 + 25, 35);
      const hu = QX.quickXorHash(ru);
      const su = await onedrive.planSaveSession({ projectId: a267.id, itemId: pu.id, version: pu.version, size: ru.length, name: pu.name });
      for (const [a, z] of [[0, 327679], [327680, ru.length - 1]]) ext.http("PUT", su.uploadUrl, { "Content-Range": "bytes " + a + "-" + z + "/" + ru.length }, new Blob([ru.subarray(a, z + 1)]));
      const ask = () => refusal(op === "plan_save_commit" ? onedrive.planSaveCommit({ projectId: a267.id, itemId: pu.id, ticket: su.ticket, uploadUrl: su.uploadUrl, hash: hu, landed: true })
        : onedrive.planSaveDone(a267.id, pu.id, su.ticket, hu));
      ext.logLines(true);
      const before = ext.versionsOf(pu.id).length;
      const w1 = await ask();
      assert.deepEqual([w1.code, w1.status], ["busy", 503], op + ": OneDrive may hash it yet - asked again");
      // (plan_save_done finds it by its size alone first: the same wait, in its settle's words)
      assert.ok(ext.logLines().includes("onedrive " + op + ": " + (op === "plan_save_commit" ? "crossed: OneDrive has no hash of the newest version yet, so it is not known to be this save"
        : "the plan is this save's size, but OneDrive has no hash of it yet, so it is not known to be this save") + ": asked again"), JSON.stringify(ext.logLines()));
      ext.passTime(31 * 60 * 1000);
      try {
        ext.logLines(true);
        const end = await ask();
        assert.deepEqual([end.code, end.info && end.info.why, end.message, op === "plan_save_commit" ? end.info.retry : "copy"],
          [op === "plan_save_commit" ? "plan_changed" : "not_saved", "unproved", UNPROVED, "copy"], op);
        assert.ok(ext.logLines().includes("onedrive " + op + ": " + NOT_PROVED), JSON.stringify(ext.logLines()));
      } finally { ext.passTime(0); }
      assert.equal(ext.versionsOf(pu.id).length, before, op + ": nothing put back (no restore)");
      assert.equal((await ext.planBlobOf(pu.id).arrayBuffer()).byteLength, ru.length, op + ": the plan holds the iPad's bytes - only the version history has the office save");
    }
    // (THE PRINCIPLE) a deferred replace found landed by its size alone (OneDrive never hashed it, no crossing): never
    // "saved" on that - waited for, then "unproved"
    {
      ext.graphModes({ reset: true, hashes: "off", deferCommit: "ignored" });
      const pz = await fresh("L1 walls.takeoff");
      const rz = bytesOf(327680 + 27, 36);
      const sz = await onedrive.planSaveSession({ projectId: a267.id, itemId: pz.id, version: pz.version, size: rz.length, name: pz.name });
      for (const [a, z] of [[0, 327679], [327680, rz.length - 1]]) ext.http("PUT", sz.uploadUrl, { "Content-Range": "bytes " + a + "-" + z + "/" + rz.length }, new Blob([rz.subarray(a, z + 1)]));
      ext.logLines(true);
      const wz = await refusal(onedrive.planSaveDone(a267.id, pz.id, sz.ticket, QX.quickXorHash(rz)));
      assert.deepEqual([wz.code, ext.logLines()], ["busy", ["onedrive plan_save_done: the plan is this save's size, but OneDrive has no hash of it yet, so it is not known to be this save: asked again"]]);
      ext.passTime(31 * 60 * 1000);
      try {
        const ez = await refusal(onedrive.planSaveDone(a267.id, pz.id, sz.ticket, QX.quickXorHash(rz)));
        assert.deepEqual([ez.code, ez.info && ez.info.why], ["not_saved", "unproved"]);
      } finally { ext.passTime(0); }
    }
    // (contract addendum 4 E3) the version check's 503 after the PUT committed (a restore that did not go through), and
    // the commit asked again with the same body: Microsoft keeps the committed session usable (fake_graph afterCommit) -
    // the plan holds this save (its tag moved), so it is checked as a commit and put back: never the same upload as a copy
    for (const afterCommit of ["gone", "usable"]) {
      ext.graphModes({ reset: true, putIfMatch: "ignored", restoreStatus: 503, afterCommit });
      const pe = await fresh("A267 Bid.takeoff");
      past(3000);
      ext.betweenWalkAndCommit(pe.full);
      const re = bytesOf(327680 + 29, 37);
      const se = await onedrive.planSaveSession({ projectId: a267.id, itemId: pe.id, version: pe.version, size: re.length, name: pe.name });
      for (const [a, z] of [[0, 327679], [327680, re.length - 1]]) ext.http("PUT", se.uploadUrl, { "Content-Range": "bytes " + a + "-" + z + "/" + re.length }, new Blob([re.subarray(a, z + 1)]));
      const body = { projectId: a267.id, itemId: pe.id, ticket: se.ticket, uploadUrl: se.uploadUrl, hash: QX.quickXorHash(re) };
      assert.equal((await refusal(onedrive.planSaveCommit(body))).code, "busy", afterCommit + ": OneDrive has no hash yet");
      await ext.hashed();
      assert.equal((await refusal(onedrive.planSaveCommit(body))).code, "busy", afterCommit + ": the restore did not go through");
      ext.graphModes({ restoreStatus: 0 });
      ext.logLines(true);
      const before = (await files(a267.id)).length;
      const end = await refusal(onedrive.planSaveCommit(body));
      const logE = ext.logLines();
      assert.deepEqual([end.code, end.info && end.info.why], ["plan_changed", "changed"], afterCommit + ": " + JSON.stringify(logE));
      assert.ok(logE.includes("onedrive plan_save_commit: crossed: the office save was put back"), JSON.stringify(logE));
      if (afterCommit === "usable") assert.ok(logE.includes("onedrive plan_save_commit: the plan changed during the upload, and it holds this save already (its commit's answer was lost): it is checked as a commit"), JSON.stringify(logE));
      assert.equal((await files(a267.id)).length, before, afterCommit + ": no copy committed of the same upload");
      assert.match((await files(a267.id)).find((x) => x.id === pe.id).version, /^qx:demo-office-/, afterCommit + ": the office save is the plan again");
    }
    // (DCR Desktop 2 dd29c6a) an identical re-save found landed WITHOUT its commit (the page closed after the 202): the
    // newest version is the base itself, byte for byte this save - verified, and the older version under it is never put back
    {
      ext.graphModes({ reset: true });
      const pi = await fresh("L1 walls.takeoff");
      const ri = bytesOf(327680 + 31, 38);
      const ji = await sendOf(pi, ri);
      assert.equal(ji.result.mode, "replace", ji.error);
      await ext.hashed();
      const now = (await files(a267.id)).find((x) => x.id === pi.id);
      assert.equal(now.version, "qx:" + QX.quickXorHash(ri));
      const si = await onedrive.planSaveSession({ projectId: a267.id, itemId: pi.id, version: now.version, size: ri.length, name: pi.name });
      for (const [a, z] of [[0, 327679], [327680, ri.length - 1]]) ext.http("PUT", si.uploadUrl, { "Content-Range": "bytes " + a + "-" + z + "/" + ri.length }, new Blob([ri.subarray(a, z + 1)]));
      const before = ext.versionsOf(pi.id).length;
      ext.logLines(true);
      const di = await onedrive.planSaveDone(a267.id, pi.id, si.ticket, QX.quickXorHash(ri));
      assert.deepEqual([di.mode, di.verified, ext.versionsOf(pi.id).length], ["replace", true, before], JSON.stringify(ext.logLines()));
      assert.ok(ext.logLines().includes("onedrive plan_save_done: the newest version is the base itself, byte for byte this save: nothing to put back, verified"));
    }
    // (D5) both refused: plan_changed {why: "refused"} (no blame) - and through the uploader it goes again at once as a
    // copy, with that why
    ext.graphModes({ reset: true, putCommit: "refused", postStatus: 400 });
    const p5 = await fresh("L1 walls.takeoff");
    const raw5 = bytesOf(327680 + 9, 26);
    const s5 = await onedrive.planSaveSession({ projectId: a267.id, itemId: p5.id, version: p5.version, size: raw5.length, name: p5.name });
    for (const [a, z] of [[0, 327679], [327680, raw5.length - 1]]) ext.http("PUT", s5.uploadUrl, { "Content-Range": "bytes " + a + "-" + z + "/" + raw5.length }, new Blob([raw5.subarray(a, z + 1)]));
    const e5 = await refusal(onedrive.planSaveCommit({ projectId: a267.id, itemId: p5.id, ticket: s5.ticket, uploadUrl: s5.uploadUrl, hash: QX.quickXorHash(raw5) }));
    assert.deepEqual([e5.code, e5.info.why, e5.info.retry, e5.message], ["plan_changed", "refused", "copy", "OneDrive would not replace the plan: the save is sent again as a separate file."]);
    const meta5 = { itemId: p5.id, base: p5.version, name: p5.name, hash: QX.quickXorHash(raw5) };
    const j5 = await send({ projectId: a267.id, file: new File([raw5], p5.name), name: p5.name, meta: meta5 });
    assert.deepEqual([j5.state, j5.result.mode, meta5.why], ["done", "copy", "refused"], j5.error);
    // a plan that changed (an office save between the commit's walk and its commit, the PUT's If-Match honoured: 412),
    // and Microsoft not committing the upload as the copy: why "changed" (other bytes: the same ones would be found as
    // the copy above, "OneDrive holds the save already")
    ext.graphModes({ reset: true });
    const p5b = await fresh("L1 walls.takeoff");
    ext.betweenWalkAndCommit(p5b.full);
    refuse(true);
    const raw5b = bytesOf(327680 + 9, 28);
    const meta5b = { itemId: p5b.id, base: p5b.version, name: p5b.name, hash: QX.quickXorHash(raw5b) };
    const j5b = await send({ projectId: a267.id, file: new File([raw5b], p5b.name), name: p5b.name, meta: meta5b });
    refuse(false);
    assert.deepEqual([j5b.state, j5b.result && j5b.result.mode, meta5b.why], ["done", "copy", "changed"], j5b.error + JSON.stringify(ext.logLines()));
    // no history to read: saved, unverified (the go-live self-test's line)
    ext.graphModes({ reset: true, versions: "failing" });
    const p6 = await fresh("A267 Bid.takeoff");
    ext.logLines(true);
    const j6 = await sendOf(p6, bytesOf(327680 + 11, 27));
    assert.deepEqual([j6.state, j6.result.mode, j6.result.verified], ["done", "replace", false], j6.error);
    assert.ok(ext.logLines().includes("onedrive plan_save_commit: version history not available: unverified"));
    // (repair round 2, S6) the listing in a moment's trouble is no "history off": 503, asked again - and the retry checks it
    ext.graphModes({ reset: true, versions: "failing", versionsStatus: 503 });
    {
      const p6s = await fresh("A267 Bid.takeoff");
      const r6s = bytesOf(327680 + 21, 33);
      const s6s = await onedrive.planSaveSession({ projectId: a267.id, itemId: p6s.id, version: p6s.version, size: r6s.length, name: p6s.name });
      for (const [a, z] of [[0, 327679], [327680, r6s.length - 1]]) ext.http("PUT", s6s.uploadUrl, { "Content-Range": "bytes " + a + "-" + z + "/" + r6s.length }, new Blob([r6s.subarray(a, z + 1)]));
      const body6 = { projectId: a267.id, itemId: p6s.id, ticket: s6s.ticket, uploadUrl: s6s.uploadUrl, hash: QX.quickXorHash(r6s) };
      for (const st of [503, 429, 500]) {
        ext.graphModes({ versionsStatus: st });
        assert.deepEqual([(await refusal(onedrive.planSaveCommit(body6))).code], ["busy"], st + ": asked again, never unverified");
      }
      ext.graphModes({ reset: true });
      const j6s = await onedrive.planSaveCommit(body6);
      assert.deepEqual([j6s.mode, j6s.verified], ["replace", true], "checked once the listing answers");
    }
    // (D4, at any age since contract addendum 4 E1) a deferred replace's ticket settles only with the hash - past 48
    // hours too
    ext.graphModes({ reset: true });
    const p7 = await fresh("A267 Bid.takeoff");
    const s7 = await onedrive.planSaveSession({ projectId: a267.id, itemId: p7.id, version: p7.version, size: 9, name: p7.name });
    try {
      shift += 49 * 3600 * 1000;
      const e7 = await refusal(onedrive.planSaveDone(a267.id, p7.id, s7.ticket));
      assert.deepEqual([e7.code, e7.info && e7.info.need, e7.message], ["not_saved", "hash", "This save can be checked now only with the file's hash - send it again with the hash."]);
      const e7b = await refusal(onedrive.planSaveDone(a267.id, p7.id, s7.ticket, QX.quickXorHash(bytesOf(9, 1))));
      assert.deepEqual([e7b.code, e7b.info && e7b.info.need], ["not_saved", undefined], "with a hash: the plain answer (not this save)");
    } finally { shift -= 49 * 3600 * 1000; }
    // (repair round 2, S1) a LATER page settles a deferred replace with plan_save_done (its own page closed before the
    // commit's answer; the upload address is gone): the broker checks it as a commit - OneDrive committed it at the last
    // chunk over an office save: put back, 409 not_saved (the device sends it again: a copy); no crossing: verified
    ext.graphModes({ reset: true, deferCommit: "ignored" });
    for (const office of [true, false]) {
      const p8 = await fresh("A267 Rev 2.takeoff");
      past(3000);
      if (office) ext.duringUpload(p8.full, "office");
      const r8 = bytesOf(327680 + 23, 34);
      const h8 = QX.quickXorHash(r8);
      const s8 = await onedrive.planSaveSession({ projectId: a267.id, itemId: p8.id, version: p8.version, size: r8.length, name: p8.name });
      for (const [a, z] of [[0, 327679], [327680, r8.length - 1]]) ext.http("PUT", s8.uploadUrl, { "Content-Range": "bytes " + a + "-" + z + "/" + r8.length }, new Blob([r8.subarray(a, z + 1)]));
      await ext.hashed();
      ext.logLines(true);
      if (office) {
        const e8 = await refusal(onedrive.planSaveDone(a267.id, p8.id, s8.ticket, h8));
        assert.deepEqual([e8.code, e8.status], ["not_saved", 409], "the crossing is not this save as the plan");
        const log8 = ext.logLines();
        assert.ok(log8.includes("onedrive plan_save_done: crossed: the office save was put back") &&
          log8.includes("onedrive plan_save_done: not saved as the plan (the check above): the save is sent again"), JSON.stringify(log8));
        assert.match((await files(a267.id)).find((x) => x.id === p8.id).version, /^qx:demo-office-/, "the office save is the plan again");
        // ...and the device's send again is a copy (the plan's version moved)
        const s8b = await onedrive.planSaveSession({ projectId: a267.id, itemId: p8.id, version: p8.version, size: r8.length, name: p8.name });
        assert.equal(s8b.mode, "copy");
      } else {
        const d8 = await onedrive.planSaveDone(a267.id, p8.id, s8.ticket, h8);
        assert.deepEqual([d8.mode, d8.verified], ["replace", true], "checked by plan_save_done: verified");
        // past 48 hours the commit only looks, and checks what it finds (it used to answer verified false)
        shift += 49 * 3600 * 1000;
        try {
          const c8 = await onedrive.planSaveCommit({ projectId: a267.id, itemId: p8.id, ticket: s8.ticket, uploadUrl: s8.uploadUrl, hash: h8 });
          assert.deepEqual([c8.mode, c8.verified], ["replace", true]);
        } finally { shift -= 49 * 3600 * 1000; }
      }
    }
    ext.graphModes({ reset: true });
    // a non-boolean landed: 400 field landed
    const bad = await refusal(onedrive.call({ op: "plan_save_commit", project_id: a267.id, item_id: p7.id, ticket: s7.ticket, upload_url: s7.uploadUrl, landed: "yes" }));
    assert.deepEqual([bad.code, bad.field], ["invalid", "landed"]);
  } finally {
    ext.setPlanSave(null);
    ext.graphModes({ reset: true });
    as("admin");
  }
});

test("demo broker as DCR Desktop 2 9969d61 (the final checker's round 3b): the check's own 503 says why \"checking\" (a listing's moment of trouble too, since 48dc59e); a newer office save on top of an iPad save that went over one - the retry (OneDrive's hash late, a restore refused), the PUT path's retry (usable or gone) and a later page all answer \"unproved\" with the admin's line, nothing put back, never the plain copy or not_saved - on the base too, since 48dc59e; no history and the plan not this save, or a listing that ends at this save - unproved; a 412 from this very save's own earlier commit (two requests overlapping) - checked, a replace, never the same bytes as a copy", { skip }, async () => {
  let shift = 0;
  FK = await loadFake();
  E = FK.createEngine({ maxFileSize: 500 * 1024 * 1024, clock: () => new Date(Date.now() + shift) });
  E.load(FK.seed({ now: new Date() }));
  const a267 = project("A267");
  const ext = E.exts.find((x) => x.name === "p7-onedrive");
  const files = async () => (await onedrive.plansList([a267.id]))[String(a267.id)].files;
  const fresh = async (name) => {
    const f = (await files()).find((x) => x.name === name);
    const fx = ext.setPlanFixture("A267", new Blob([bytesOf(5000, 11)]), name);
    return Object.assign({}, f, { size: fx.size, version: fx.version, modified: (await files()).find((x) => x.id === f.id).modified, full: fx.full });
  };
  const past = (ms) => { shift += ms; };
  /** a deferred replace's session and every chunk of `raw` (its commit left to the check) */
  const upload = async (plan, raw) => {
    const s = await onedrive.planSaveSession({ projectId: a267.id, itemId: plan.id, version: plan.version, size: raw.length, name: plan.name });
    for (const [a, z] of [[0, 327679], [327680, raw.length - 1]]) ext.http("PUT", s.uploadUrl, { "Content-Range": "bytes " + a + "-" + z + "/" + raw.length }, new Blob([raw.subarray(a, z + 1)]));
    return s;
  };
  const commitOf = (plan, s, raw, landed) => refusal(onedrive.planSaveCommit({ projectId: a267.id, itemId: plan.id, ticket: s.ticket, uploadUrl: s.uploadUrl, hash: QX.quickXorHash(raw), landed: !!landed }));
  const BY_HAND = "crossed: not put back (newer save): check the plan's version history by hand";
  const UNPROVED = "OneDrive could not show whether this save went over an office save: it is sent again as a separate file - check the plan's version history in OneDrive.";
  const has = (op, line) => ext.logLines().includes("onedrive " + op + ": " + line);
  const sizes = (plan) => ext.versionsOf(plan.id).map((v) => v.size);
  try {
    as("admin");
    // (N1, N1b) OneDrive committed at the last chunk over an office save X, and the check could not finish at once -
    // OneDrive's hash not there yet, or a restore refused: 503 {why: "checking"}; then the office saves again (Y): the
    // retry answers "unproved" with the admin's line, nothing put back over Y
    for (const how of ["hash wait", "restore refused"]) {
      ext.graphModes({ reset: true, deferCommit: "ignored", hashes: how === "hash wait" ? "off" : "on", restoreStatus: how === "restore refused" ? 503 : 0 });
      const pl = await fresh("A267 Rev 2.takeoff");
      past(3000);
      ext.duringUpload(pl.full, "office");
      const raw = bytesOf(327680 + (how === "hash wait" ? 41 : 42), 51);
      const s = await upload(pl, raw);
      let c1 = await commitOf(pl, s, raw, true);
      if (how === "restore refused") { await ext.hashed(); c1 = await commitOf(pl, s, raw, true); }
      assert.deepEqual([c1.code, c1.status, c1.info && c1.info.why], ["busy", 503, "checking"], how + ": the check's own 503");
      ext.graphModes({ hashes: "on", restoreStatus: 0 });
      past(2 * 60 * 1000);
      ext.officeSave(pl.full);
      await ext.hashed();
      ext.logLines(true);
      const before = sizes(pl);
      const c2 = await commitOf(pl, s, raw, true);
      assert.deepEqual([c2.code, c2.info && c2.info.why, c2.info && c2.info.retry, c2.message], ["plan_changed", "unproved", "copy", UNPROVED], how + ": " + JSON.stringify(ext.logLines()));
      assert.ok(has("plan_save_commit", BY_HAND), how + ": " + JSON.stringify(ext.logLines()));
      assert.deepEqual(sizes(pl), before, how + ": nothing put back over Y");
      assert.equal(sizes(pl).slice(0, 2)[1], raw.length, how + ": [Y, the iPad's, X, ...]");
      assert.match((await files()).find((x) => x.id === pl.id).version, /^qx:demo-office-/, how + ": Y stays the plan");
    }
    // (N2) the PUT path: the PUT's If-Match ignored over an office save X between the walk and the PUT, the check ends
    // 503 {why: "checking"} (a restore refused, or OneDrive's hash not there yet), Y lands - the retried commit answers
    // "unproved": never the same upload committed as a copy, nor the plain not_saved - Microsoft keeping the committed
    // session usable or not
    for (const why of ["restore", "hash"]) for (const afterCommit of ["usable", "gone"]) {
      const name = why + ", " + afterCommit;
      ext.graphModes({ reset: true, putIfMatch: "ignored", afterCommit, hashes: why === "hash" ? "off" : "on", restoreStatus: why === "restore" ? 503 : 0 });
      const pl = await fresh("A267 Bid.takeoff");
      past(3000);
      ext.betweenWalkAndCommit(pl.full);
      const raw = bytesOf(327680 + 60 + 2 * (why === "hash" ? 1 : 0) + (afterCommit === "gone" ? 1 : 0), 52);
      const s = await upload(pl, raw);
      let c1 = await commitOf(pl, s, raw);
      if (why === "restore") { await ext.hashed(); c1 = await commitOf(pl, s, raw); }
      assert.deepEqual([c1.code, c1.info && c1.info.why], ["busy", "checking"], name + ": the check's own 503");
      ext.graphModes({ hashes: "on", restoreStatus: 0 });
      past(2 * 60 * 1000);
      ext.officeSave(pl.full);
      await ext.hashed();
      const count = (await files()).length;
      ext.logLines(true);
      const c2 = await commitOf(pl, s, raw);
      assert.deepEqual([c2.code, c2.info && c2.info.why, c2.info && c2.info.retry], ["plan_changed", "unproved", "copy"], name + ": " + JSON.stringify(ext.logLines()));
      assert.ok(has("plan_save_commit", BY_HAND) && !ext.logLines().some((l) => /committed as a copy/.test(l)), name + ": " + JSON.stringify(ext.logLines()));
      assert.equal((await files()).length, count, name + ": no copy committed of the same upload");
      assert.match((await files()).find((x) => x.id === pl.id).version, /^qx:demo-office-/, name + ": Y stays the plan");
    }
    // (N4) the page closed before its commit's check; Y lands; the later page's plan_save_done answers not_saved {why:
    // "unproved"} with the admin's line - never the plain not_saved (the copy's words say nothing was overwritten)
    {
      ext.graphModes({ reset: true, deferCommit: "ignored" });
      const pl = await fresh("A267 Rev 2.takeoff");
      past(3000);
      ext.duringUpload(pl.full, "office");
      const raw = bytesOf(327680 + 45, 53);
      const s = await upload(pl, raw);
      await ext.hashed();
      past(20 * 60 * 1000);
      ext.officeSave(pl.full);
      past(60 * 60 * 1000);
      ext.logLines(true);
      const before = sizes(pl);
      const d = await refusal(onedrive.planSaveDone(a267.id, pl.id, s.ticket, QX.quickXorHash(raw)));
      assert.deepEqual([d.code, d.info && d.info.why, d.message], ["not_saved", "unproved", UNPROVED], JSON.stringify(ext.logLines()));
      assert.ok(has("plan_save_done", BY_HAND), JSON.stringify(ext.logLines()));
      assert.deepEqual(sizes(pl), before, "nothing put back");
    }
    // the iPad's bytes right on the base, then Y on top before the check: this save WAS the plan, and nothing proves Y's
    // writer had its work - "unproved" with the admin's line (DCR Desktop 2 48dc59e, contract addendum 5 G1: plain words
    // only on proof; it was the plain "changed" / not_saved at 9969d61)
    for (const op of ["plan_save_commit", "plan_save_done"]) {
      ext.graphModes({ reset: true, deferCommit: "ignored" });
      const pl = await fresh("A267 Rev 2.takeoff");
      const raw = bytesOf(327680 + (op === "plan_save_commit" ? 47 : 48), 54);
      const s = await upload(pl, raw);
      await ext.hashed();
      past(60 * 1000);
      ext.officeSave(pl.full);
      ext.logLines(true);
      const e = op === "plan_save_commit" ? await commitOf(pl, s, raw, true) : await refusal(onedrive.planSaveDone(a267.id, pl.id, s.ticket, QX.quickXorHash(raw)));
      assert.deepEqual([e.code, e.info && e.info.why], op === "plan_save_commit" ? ["plan_changed", "unproved"] : ["not_saved", "unproved"], op + ": " + JSON.stringify(ext.logLines()));
      assert.ok(has(op, op === "plan_save_commit" ? "committed: not proved (a newer save is on top of this save): check the plan's version history by hand"
        : "not proved (a version of this save's size is under a newer save): check the plan's version history by hand"), op + ": the admin's line " + JSON.stringify(ext.logLines()));
    }
    // no version history to read, and the plan not this save now (Y after the iPad's bytes landed): "unproved" - nothing
    // shows what this save went over
    {
      ext.graphModes({ reset: true, deferCommit: "ignored", versions: "off" });
      const pl = await fresh("L1 walls.takeoff");
      const raw = bytesOf(327680 + 49, 55);
      const s = await upload(pl, raw);
      await ext.hashed();
      past(5000);
      ext.officeSave(pl.full);
      ext.logLines(true);
      const e = await commitOf(pl, s, raw, true);
      assert.deepEqual([e.code, e.info && e.info.why], ["plan_changed", "unproved"], JSON.stringify(ext.logLines()));
      assert.ok(has("plan_save_commit", "committed: not proved (no version history to read): check the plan's version history by hand"), JSON.stringify(ext.logLines()));
    }
    // the iPad's bytes right on the base, then nine office saves on top - the WHOLE first page is read (no cut at ten):
    // this save is shown right on the base under newer saves - "unproved" all the same (a newer save is on top)
    {
      ext.graphModes({ reset: true, deferCommit: "ignored" });
      const pl = await fresh("L1 walls.takeoff");
      const raw = bytesOf(327680 + 51, 56);
      const s = await upload(pl, raw);
      await ext.hashed();
      for (let i = 0; i < 9; i++) { past(60 * 1000); ext.officeSave(pl.full); }
      ext.logLines(true);
      const e = await commitOf(pl, s, raw, true);
      assert.deepEqual([e.code, e.info && e.info.why], ["plan_changed", "unproved"], JSON.stringify(ext.logLines()));
      assert.ok(has("plan_save_commit", "committed: not proved (a newer save is on top of this save): check the plan's version history by hand"), JSON.stringify(ext.logLines()));
      assert.equal(sizes(pl)[10], 5000, "the demo's history has the base under it");
    }
    // the listing's own moment of trouble (versions failing 503) after the bytes landed: the check's "checking" (DCR
    // Desktop 2 48dc59e, contract addendum 5 G4 - it was a plain busy at 9969d61)
    {
      ext.graphModes({ reset: true, versions: "failing", versionsStatus: 503 });
      const pl = await fresh("A267 Bid.takeoff");
      const raw = bytesOf(327680 + 53, 57);
      const s = await upload(pl, raw);
      const e0 = await commitOf(pl, s, raw);
      assert.deepEqual([e0.code, e0.status, e0.info && e0.info.why], ["busy", 503, "checking"], "OneDrive's hash first");
      await ext.hashed();
      const e = await commitOf(pl, s, raw);
      assert.deepEqual([e.code, e.status, e.info && e.info.why], ["busy", 503, "checking"]);
    }
    // (N6) two commits of one save overlap - this very session committed by the device's other request just before this
    // one's commit (attempt A's PUT, or attempt B's POST: its If-Match 412): read afresh, the plan holds this save - the
    // check (OneDrive's hash first: 503 {why: "checking"}), then a replace, verified; never the same bytes as a copy
    for (const form of ["PUT", "POST"]) for (const afterCommit of ["usable", "gone"]) {
      const name = form + ", " + afterCommit;
      ext.graphModes({ reset: true, afterCommit, putCommit: form === "POST" ? "refused" : "accepted" });
      const pl = await fresh("A267 Bid.takeoff");
      ext.betweenWalkAndCommit(pl.full, "self");
      const raw = bytesOf(327680 + 70 + 2 * (form === "POST" ? 1 : 0) + (afterCommit === "gone" ? 1 : 0), 58);
      const s = await upload(pl, raw);
      const count = (await files()).length;
      ext.logLines(true);
      const c1 = await commitOf(pl, s, raw);
      assert.deepEqual([c1.code, c1.info && c1.info.why], ["busy", "checking"], name + ": the plan holds a save of this size, OneDrive has no hash of it yet: " + JSON.stringify(ext.logLines()));
      assert.ok(!ext.logLines().some((l) => /committed as a copy/.test(l)), name + ": never the copy on the walk before the commit " + JSON.stringify(ext.logLines()));
      await ext.hashed();
      const c2 = await onedrive.planSaveCommit({ projectId: a267.id, itemId: pl.id, ticket: s.ticket, uploadUrl: s.uploadUrl, hash: QX.quickXorHash(raw) });
      assert.deepEqual([c2.mode, c2.id, c2.version, c2.verified], ["replace", pl.id, "qx:" + QX.quickXorHash(raw), true], name);
      assert.deepEqual([(await files()).length, sizes(pl).slice(0, 2)], [count, [raw.length, 5000]], name + ": no copy; this save right over the base");
    }
  } finally {
    ext.graphModes({ reset: true });
    as("admin");
  }
});

test("demo broker as DCR Desktop 2 48dc59e (repair round 4, contract addendum 5): plain words only on proof - ten or more office saves on top (the whole first page read; a paged one that does not reach back), a listing cut short before a copy, a same-size office save crossed; a restore that never goes through ends not_put_back after its 30 minutes; overlapping POSTs answered 400 decided on the plan read after the attempt; the device's own double commit verified (If-Match ignored, the session usable), never 'put back'; the plain copy and not_saved only on neverHeld's proof", { skip }, async () => {
  let shift = 0;
  FK = await loadFake();
  E = FK.createEngine({ maxFileSize: 500 * 1024 * 1024, clock: () => new Date(Date.now() + shift) });
  E.load(FK.seed({ now: new Date() }));
  const a267 = project("A267");
  const ext = E.exts.find((x) => x.name === "p7-onedrive");
  const files = async () => (await onedrive.plansList([a267.id]))[String(a267.id)].files;
  const fresh = async (name) => {
    const f = (await files()).find((x) => x.name === name);
    const fx = ext.setPlanFixture("A267", new Blob([bytesOf(5000, 11)]), name);
    return Object.assign({}, f, { size: fx.size, version: fx.version, modified: (await files()).find((x) => x.id === f.id).modified, full: fx.full });
  };
  const past = (ms) => { shift += ms; };
  const upload = async (plan, raw) => {
    const s = await onedrive.planSaveSession({ projectId: a267.id, itemId: plan.id, version: plan.version, size: raw.length, name: plan.name });
    for (const [a, z] of [[0, 327679], [327680, raw.length - 1]]) ext.http("PUT", s.uploadUrl, { "Content-Range": "bytes " + a + "-" + z + "/" + raw.length }, new Blob([raw.subarray(a, z + 1)]));
    return s;
  };
  const commitOf = (plan, s, raw, landed) => refusal(onedrive.planSaveCommit({ projectId: a267.id, itemId: plan.id, ticket: s.ticket, uploadUrl: s.uploadUrl, hash: QX.quickXorHash(raw), landed: !!landed }));
  const doneOf = (plan, s, raw) => refusal(onedrive.planSaveDone(a267.id, plan.id, s.ticket, QX.quickXorHash(raw)));
  const has = (op, line) => ext.logLines().includes("onedrive " + op + ": " + line);
  const BY_HAND = ": check the plan's version history by hand";
  const sizes = (plan) => ext.versionsOf(plan.id).map((v) => v.size);
  const UNPROVED_WORDS = "OneDrive could not show whether this save went over an office save: it is sent again as a separate file - check the plan's version history in OneDrive.";
  const NOT_PUT_BACK = "This save went over an office save and OneDrive would not put the office save back: it is sent again as a separate file - put the office save back by hand from the plan's version history in OneDrive.";
  try {
    as("admin");
    // (F1) the page closed before its check: the iPad's bytes over an office save X, then 10 or 12 office saves on top -
    // a later page's plan_save_done is "unproved" with the admin's line (the whole first page read: the iPad's version
    // over X is in it), never the plain not_saved; the listing paged at ten (a nextLink) does not reach back - unproved too
    for (const [n, page] of [[10, 0], [12, 0], [10, 10]]) {
      const name = n + " on top" + (page ? ", paged" : "");
      ext.graphModes({ reset: true, deferCommit: "ignored", versionsPage: page });
      const pl = await fresh("A267 Rev 2.takeoff");
      past(3000);
      ext.duringUpload(pl.full, "office");
      const raw = bytesOf(327680 + 90 + n + page, 91);
      const s = await upload(pl, raw);
      await ext.hashed();
      for (let i = 0; i < n; i++) { past(60 * 1000); ext.officeSave(pl.full); }
      ext.logLines(true);
      const before = sizes(pl);
      const d = await doneOf(pl, s, raw);
      assert.deepEqual([d.code, d.info && d.info.why, d.message], ["not_saved", "unproved", UNPROVED_WORDS], name + ": " + JSON.stringify(ext.logLines()));
      assert.ok(has("plan_save_done", (page ? "not proved (the version history does not reach back to this save)" : "crossed: not put back (newer save)") + BY_HAND), name + ": " + JSON.stringify(ext.logLines()));
      assert.deepEqual(sizes(pl), before, name + ": nothing put back");
    }
    // (F2) the PUT path's parked retry after ten office saves on top of a crossing: "unproved", never the same upload as
    // a copy (the copy's words say nothing was overwritten)
    {
      ext.graphModes({ reset: true, putIfMatch: "ignored", afterCommit: "usable", restoreStatus: 503 });
      const pl = await fresh("A267 Bid.takeoff");
      past(3000);
      ext.betweenWalkAndCommit(pl.full);
      const raw = bytesOf(327680 + 120, 92);
      const s = await upload(pl, raw);
      await commitOf(pl, s, raw);                                 // OneDrive's hash first (503 checking)
      await ext.hashed();
      const c1 = await commitOf(pl, s, raw);
      assert.deepEqual([c1.code, c1.info && c1.info.why], ["busy", "checking"], "the restore refused: the check's own 503");
      ext.graphModes({ restoreStatus: 0 });
      for (let i = 0; i < 10; i++) { past(60 * 1000); ext.officeSave(pl.full); }
      const count = (await files()).length;
      ext.logLines(true);
      const c2 = await commitOf(pl, s, raw);
      assert.deepEqual([c2.code, c2.info && c2.info.why], ["plan_changed", "unproved"], JSON.stringify(ext.logLines()));
      assert.ok(has("plan_save_commit", "crossed: not put back (newer save)" + BY_HAND) && !ext.logLines().some((l) => /committed as a copy/.test(l)), JSON.stringify(ext.logLines()));
      assert.equal((await files()).length, count, "no copy committed of the same upload");
    }
    // a listing cut short (its first page one entry, a nextLink) before the copy: the office saved during the upload, so
    // the same upload would be the copy - but nothing proves the plan never held this save: "unproved"; read whole, the
    // listing reaches back to the base - the plain copy (neverHeld's proof)
    for (const page of [1, 0]) {
      ext.graphModes({ reset: true, versionsPage: page });
      const pl = await fresh("L1 walls.takeoff");
      past(3000);
      ext.duringUpload(pl.full, "office");
      const raw = bytesOf(327680 + 130 + page, 93);
      const s = await upload(pl, raw);
      ext.logLines(true);
      if (page) {
        const e = await commitOf(pl, s, raw);
        assert.deepEqual([e.code, e.info && e.info.why], ["plan_changed", "unproved"], JSON.stringify(ext.logLines()));
        assert.ok(has("plan_save_commit", "not proved (the version history does not reach back to this save)" + BY_HAND), JSON.stringify(ext.logLines()));
      } else {
        const c = await onedrive.planSaveCommit({ projectId: a267.id, itemId: pl.id, ticket: s.ticket, uploadUrl: s.uploadUrl, hash: QX.quickXorHash(raw) });
        assert.equal(c.mode, "copy", "proved: the plain copy");
        assert.ok(!ext.logLines().some((l) => /by hand/.test(l)));
      }
    }
    // a same-size office save crossed (OneDrive committed at the last chunk over it): a listing has no hash - this save's
    // own earlier commit and an office save of its size look alike there: never put back, "unproved"
    {
      ext.graphModes({ reset: true, deferCommit: "ignored" });
      const pl = await fresh("A267 Rev 2.takeoff");
      past(3000);
      ext.duringUpload(pl.full, "office-same-size");
      const raw = bytesOf(327680 + 140, 94);
      const s = await upload(pl, raw);
      await ext.hashed();
      ext.logLines(true);
      const before = sizes(pl);
      assert.deepEqual(before.slice(0, 2), [raw.length, raw.length], "[the iPad's, the office's of its size, ...]");
      const e = await commitOf(pl, s, raw, true);
      assert.deepEqual([e.code, e.info && e.info.why], ["plan_changed", "unproved"], JSON.stringify(ext.logLines()));
      assert.ok(has("plan_save_commit", "crossed: not proved (the version under this save has its size)" + BY_HAND), JSON.stringify(ext.logLines()));
      assert.deepEqual(sizes(pl), before, "nothing put back");
    }
    // (F3) a proved crossing whose restore Microsoft keeps refusing: 503 checking (not allowed in) for 30 minutes after
    // this save's version was made, then not_put_back with the admin's line - plan_save_commit's plan_changed and a later
    // page's not_saved alike; never "checking" for the ticket's 30 days
    for (const op of ["plan_save_commit", "plan_save_done"]) {
      ext.graphModes({ reset: true, deferCommit: "ignored", restoreStatus: 403 });
      const pl = await fresh("A267 Rev 2.takeoff");
      past(3000);
      ext.duringUpload(pl.full, "office");
      const raw = bytesOf(327680 + 150 + (op === "plan_save_done" ? 1 : 0), 95);
      const s = await upload(pl, raw);
      await ext.hashed();
      const ask = () => (op === "plan_save_commit" ? commitOf(pl, s, raw, true) : doneOf(pl, s, raw));
      const w1 = await ask();
      assert.deepEqual([w1.code, w1.status, w1.info && w1.info.why], ["not_authorized", 503, "checking"], op + ": asked again");
      ext.passTime(29 * 60 * 1000);
      const w2 = await ask();
      assert.deepEqual([w2.code, w2.info && w2.info.why], ["not_authorized", "checking"], op + ": at 29 minutes still the check");
      ext.passTime(31 * 60 * 1000);
      ext.logLines(true);
      const w3 = await ask();
      assert.deepEqual([w3.code, w3.info && w3.info.why, w3.message], [op === "plan_save_commit" ? "plan_changed" : "not_saved", "not_put_back", NOT_PUT_BACK], op + ": " + JSON.stringify(ext.logLines()));
      assert.ok(has(op, "crossed: the office save could not be put back: put it back by hand from the version history"), op + ": " + JSON.stringify(ext.logLines()));
      if (op === "plan_save_commit") assert.equal(w3.info.retry, "copy");
      ext.passTime(0);
    }
    // (F4) two POSTs of one save overlap: request 1's lands, request 2's is refused 400 (the committed session kept, so
    // Microsoft refuses it rather than answering 404) - decided on the plan read after that attempt (it holds this
    // save): checked, a replace, verified - never "OneDrive would not replace the plan"
    {
      ext.graphModes({ reset: true, putCommit: "refused", postStatus: 400, afterCommit: "usable" });
      const pl = await fresh("A267 Bid.takeoff");
      ext.betweenWalkAndCommit(pl.full, "self");
      const raw = bytesOf(327680 + 160, 96);
      const s = await upload(pl, raw);
      ext.logLines(true);
      const c1 = await commitOf(pl, s, raw);
      assert.deepEqual([c1.code, c1.info && c1.info.why], ["busy", "checking"], "the plan is a save of this size, OneDrive has no hash of it yet: " + JSON.stringify(ext.logLines()));
      assert.ok(!ext.logLines().some((l) => /sent again as a copy/.test(l)), JSON.stringify(ext.logLines()));
      await ext.hashed();
      const c2 = await onedrive.planSaveCommit({ projectId: a267.id, itemId: pl.id, ticket: s.ticket, uploadUrl: s.uploadUrl, hash: QX.quickXorHash(raw) });
      assert.deepEqual([c2.mode, c2.id, c2.verified], ["replace", pl.id, true], "a replace, verified");
    }
    // (F6) two commits of one save overlap, the If-Match ignored, the committed session usable: request 2 commits the same
    // bytes again - [this save, this save, base], both written by this app: the device's own double commit, verified,
    // nothing restored (never its own first version "put back")
    for (const form of ["PUT", "POST"]) {
      ext.graphModes({ reset: true, afterCommit: "usable", putIfMatch: "ignored", postIfMatch: "ignored", putCommit: form === "POST" ? "refused" : "accepted" });
      const pl = await fresh("A267 Bid.takeoff");
      ext.betweenWalkAndCommit(pl.full, "self");
      const raw = bytesOf(327680 + 170 + (form === "POST" ? 1 : 0), 97);
      const s = await upload(pl, raw);
      const c1 = await commitOf(pl, s, raw);
      assert.deepEqual([c1.code, c1.info && c1.info.why], ["busy", "checking"], form + ": OneDrive's hash first");
      await ext.hashed();
      ext.logLines(true);
      const c2 = await onedrive.planSaveCommit({ projectId: a267.id, itemId: pl.id, ticket: s.ticket, uploadUrl: s.uploadUrl, hash: QX.quickXorHash(raw) });
      assert.deepEqual([c2.mode, c2.verified, sizes(pl).slice(0, 3)], ["replace", true, [raw.length, raw.length, 5000]], form + ": " + JSON.stringify(ext.logLines()));
      assert.ok(has("plan_save_commit", "committed twice (an overlapping request): verified"), form + ": " + JSON.stringify(ext.logLines()));
      assert.ok(!ext.logLines().some((l) => /put back/.test(l)), form + ": nothing restored");
    }
    // ...and Microsoft keeping it gone instead (its 404 before any If-Match, as fake_graph.ts's): request 2 finds it
    // committed - looked for, checked, verified; the bytes committed once
    for (const form of ["PUT", "POST"]) {
      ext.graphModes({ reset: true, afterCommit: "gone", putIfMatch: "ignored", postIfMatch: "ignored", putCommit: form === "POST" ? "refused" : "accepted" });
      const pl = await fresh("A267 Bid.takeoff");
      ext.betweenWalkAndCommit(pl.full, "self");
      const raw = bytesOf(327680 + 175 + (form === "POST" ? 1 : 0), 97);
      const s = await upload(pl, raw);
      ext.logLines(true);
      const c1 = await commitOf(pl, s, raw);
      assert.deepEqual([c1.code, c1.info && c1.info.why], ["busy", "checking"], form + " gone: OneDrive's hash first");
      assert.ok(has("plan_save_commit", "the upload session is gone (committed already, or run out): the save is looked for"), form + " gone: " + JSON.stringify(ext.logLines()));
      await ext.hashed();
      const c2 = await onedrive.planSaveCommit({ projectId: a267.id, itemId: pl.id, ticket: s.ticket, uploadUrl: s.uploadUrl, hash: QX.quickXorHash(raw) });
      assert.deepEqual([c2.mode, c2.verified, sizes(pl).slice(0, 2)], ["replace", true, [raw.length, 5000]], form + " gone: committed once, right on the base");
    }
    // a 503 before any commit attempt stays unmarked: the listing is never read then - a session's own walk only; here
    // the plan's tag unchanged and nothing committed - a later page's plan_save_done: the plain not_saved (its content
    // tag the session's: neverHeld's first proof)
    {
      ext.graphModes({ reset: true });
      const pl = await fresh("L1 walls.takeoff");
      const raw = bytesOf(327680 + 180, 98);
      const s = await upload(pl, raw);
      const d = await doneOf(pl, s, raw);
      assert.deepEqual([d.code, d.info && d.info.why], ["not_saved", undefined], "never landed, the plan untouched: the plain not_saved");
      // ...with no version history to read the plan's content tag is the only proof - and it is enough
      ext.graphModes({ reset: true, versions: "off" });
      const pl2 = await fresh("L1 walls.takeoff");
      const s2 = await upload(pl2, bytesOf(327680 + 181, 98));
      const d2 = await doneOf(pl2, s2, bytesOf(327680 + 181, 98));
      assert.deepEqual([d2.code, d2.info && d2.info.why], ["not_saved", undefined], "no history, the plan's tag the session's: the plain not_saved");
    }
  } finally {
    ext.graphModes({ reset: true });
    ext.passTime(0);
    as("admin");
  }
});

test("demo hooks for the real-app e2e: a made-up real .takeoff as a project's plan (its bytes, size, own version) until a save lands; the office's save; OneDrive's bytes of an item", { skip }, async () => {
  await setup();
  const a267 = project("A267");
  const ext = E.exts.find((x) => x.name === "p7-onedrive");
  as("admin");
  const plan = (await onedrive.plansList([a267.id]))[String(a267.id)].files[0];
  const blob = new Blob([new TextEncoder().encode("PDFCACHE1" + "x".repeat(4000))]);
  const fx = ext.setPlanFixture("A267", blob);
  assert.deepEqual([fx.id, fx.name, fx.size, fx.version], [plan.id, plan.name, blob.size, "qx:demo-fixture-" + blob.size]);
  assert.equal(fx.full, plan.folder + "/" + plan.name);
  const now = (await onedrive.plansList([a267.id]))[String(a267.id)].files.find((f) => f.id === plan.id);
  assert.deepEqual([now.size, now.version], [blob.size, fx.version], "plans_list says so");
  assert.equal(ext.planBlobOf(plan.id), blob, "OneDrive's bytes are the fixture's");
  assert.equal(ext.setPlanFixture("A001", blob), null, "no plan there");
  // the office saves it: another version and other bytes, the fixture gone
  const v = ext.officeSave(fx.full);
  assert.match(v, /^qx:demo-office-\d+$/);
  const later = (await onedrive.plansList([a267.id]))[String(a267.id)].files.find((f) => f.id === plan.id);
  assert.deepEqual([later.version, later.size], [v, blob.size + 7]);
  assert.equal((await ext.planBlobOf(plan.id).text()).slice(0, 9), "PDFCACHE1");
  assert.equal(ext.officeSave("A999 - Nowhere/None.takeoff"), null);
  // (contract addendum 4 E4) the house model copied into two lots' folders: the same name in two projects, each its own
  // plan (its own id, folder and file), byte-identical once both hold the same fixture
  const a024 = project("A024");
  const h1 = ext.addPlanFile("A267", "House model.takeoff");
  const h2 = ext.addPlanFile("A024", "House model.takeoff");
  assert.ok(h1 && h2 && h1.id !== h2.id && h1.folder !== h2.folder && h1.name === h2.name, JSON.stringify([h1, h2]));
  assert.deepEqual(ext.addPlanFile("A267", "House model.takeoff"), h1, "once only");
  const same = new Blob([new TextEncoder().encode("PDFCACHE1" + "h".repeat(3000))]);
  ext.setPlanFixture("A267", same, h1.name);
  ext.setPlanFixture("A024", same, h2.name);
  const l1 = (await onedrive.plansList([a267.id]))[String(a267.id)].files.find((f) => f.id === h1.id);
  const l2 = (await onedrive.plansList([a024.id]))[String(a024.id)].files.find((f) => f.id === h2.id);
  assert.deepEqual([l1.name, l2.name, l1.size, l2.size], [h1.name, h1.name, same.size, same.size]);
  assert.equal(ext.planBlobOf(h1.id), ext.planBlobOf(h2.id));
  for (const bad of [["A001", "X.takeoff"], ["A267", "X.pdf"], ["A267", "a/X.takeoff"], ["A999", "X.takeoff"]]) assert.equal(ext.addPlanFile(...bad), null, JSON.stringify(bad));
  // the broker's clock ahead (passTime: OneDrive's 30 minutes without a hash, in a walk) and back
  assert.deepEqual([ext.passTime(31 * 60 * 1000), ext.passTime(0), ext.passTime(-5)], [31 * 60 * 1000, 0, 0]);
});

/* ── the save back (P4; owner decisions Q1-Q3, 2026-11-04; contract C3): the rules ──────────────────────────────── */

const SAVE = "p1-x-2.takeoff";
const local = (over) => Object.assign({ file: SAVE, base: "qx:AAA", savedAt: AT, size: 2000, hash: null, state: "waiting", error: "", code: "", fails: 0,
  retryAt: null, sends: [] }, over || {});

test("the save back's rules: a save waiting here is never downloaded over, kept by a sweep, sent by itself once its wait is over", () => {
  // kept on the device: its base is the version the work was done on; a later save before it is sent keeps that base
  const a = lib.withSave(rec(), SAVE, 2000, AT);
  assert.deepEqual(a.rec.local, local());
  assert.equal(a.old, "", "nothing replaced");
  assert.equal(a.rec.file, rec().file, "the plan's own copy stays (the app reads it still)");
  const b = lib.withSave(Object.assign({}, a.rec, { version: "qx:CCC", local: local({ sends: [{ file: SAVE, ticket: "tk1" }] }) }), "p1-x-3.takeoff", 2100, AT);
  assert.deepEqual([b.rec.local.base, b.rec.local.file, b.rec.local.size, b.old, b.rec.local.sends.length], ["qx:AAA", "p1-x-3.takeoff", 2100, SAVE, 1],
    "the first save's base; the replaced save goes; its session stays to be settled");
  assert.equal(lib.hasLocal(a.rec), true);
  assert.equal(lib.hasLocal(rec({ local: { file: "../evil" } })), false, "only a library file name");
  // never downloaded over, whatever OneDrive holds; never swept
  const outdatedWithSave = Object.assign({}, a.rec, { latest: { status: "ok", version: "qx:BBB" } });
  assert.equal(lib.needsWork(rec({ latest: { status: "ok", version: "qx:BBB" } })), true, "(without one: downloaded)");
  assert.equal(lib.needsWork(outdatedWithSave), false);
  assert.equal(lib.dueForWork(outdatedWithSave, NOW), false);
  assert.ok(lib.keepSet([a.rec], {}, NOW).has(SAVE));
  // sent by itself: at once, then after its wait; a refusal that waits for the person never by itself
  assert.equal(lib.dueToSend(a.rec, NOW), true);
  assert.equal(lib.dueToSend(rec(), NOW), false, "nothing to send");
  assert.equal(lib.dueToSend(rec({ local: local({ state: "failed", retryAt: new Date(NOW + 60000).toISOString() }) }), NOW), false);
  assert.equal(lib.dueToSend(rec({ local: local({ state: "failed", retryAt: new Date(NOW - 1).toISOString() }) }), NOW), true);
  assert.equal(lib.dueToSend(rec({ local: local({ state: "failed", retryAt: new Date(NOW + lib.RETRY_CAP_MS * 3).toISOString() }) }), NOW), true, "a clock that was wrong");
  for (const code of lib.SEND_FINAL) assert.equal(lib.dueToSend(rec({ local: local({ state: "failed", code }) }), NOW), false, code);
  assert.equal(lib.baseOk("qx:AAA"), true);
  assert.equal(lib.baseOk(""), false);
});

test("the save back's rules: once OneDrive has it - a replace adopts the saved bytes, a copy keeps the plan and gives the save a record of its own", () => {
  const r = rec({ local: local(), latest: { status: "ok", version: "qx:AAA" } });
  const ans = { saved: true, mode: "replace", id: F1.id, name: F1.name, size: 2000, modified: "2026-11-04T18:30:00.000Z", version: "qx:NEW" };
  const rep = lib.adoptSent(r, SAVE, ans, AT);
  assert.deepEqual([rep.rec.file, rep.rec.version, rep.rec.size, rep.rec.modified, rep.rec.local, rep.rec.expect, rep.rec.dl], [SAVE, "qx:NEW", 2000, ans.modified, null, null, null]);
  assert.deepEqual(rep.rec.latest, { status: "ok", checkedAt: AT, version: "qx:NEW", size: 2000, modified: ans.modified, name: F1.name, folder: F1.folder });
  assert.deepEqual(rep.rec.sent, { mode: "replace", name: F1.name, at: AT });
  assert.deepEqual([rep.old, rep.copy], [[r.file], null], "the old copy is retired (its grace kept by retire)");
  assert.equal(lib.statusOf(rep.rec), "saved");
  // the "sm:" form (no hash yet): the size and time to know the bytes by later
  const sm = lib.adoptSent(r, SAVE, Object.assign({}, ans, { version: "sm:2000:2026-11-04T18:30:00.000Z" }), AT);
  assert.deepEqual(sm.rec.expect, { size: 2000, modified: ans.modified });
  // a later save came while this one went: OneDrive moved to the sent bytes, so the later save builds on them
  const later = rec({ local: local({ file: "p1-x-3.takeoff", sends: [{ file: SAVE, ticket: "tk1" }, { file: "p1-x-3.takeoff", ticket: "tk2" }] }) });
  const moved = lib.adoptSent(later, SAVE, ans, AT);
  assert.deepEqual([moved.rec.file, moved.rec.local.file, moved.rec.local.base, moved.rec.local.sends.map((s) => s.ticket), moved.old],
    [later.file, "p1-x-3.takeoff", "qx:NEW", ["tk2"], [SAVE]]);
  // a copy (Q3): the plan stays as it was; the save is the copy's own record, opening with no download
  const copy = lib.adoptSent(r, SAVE, Object.assign({}, ans, { mode: "copy", id: "01FAKECOPY0001", name: "A900 Bid - iPad 2026-11-04 1030.takeoff" }), AT);
  assert.deepEqual([copy.rec.file, copy.rec.version, copy.rec.local, copy.rec.sent.mode, copy.rec.sent.name, copy.old],
    [r.file, "qx:AAA", null, "copy", "A900 Bid - iPad 2026-11-04 1030.takeoff", []]);
  assert.deepEqual([copy.copy.key, copy.copy.itemId, copy.copy.file, copy.copy.version, copy.copy.projectId, copy.copy.folder, copy.copy.from],
    ["u|01FAKECOPY0001", "01FAKECOPY0001", SAVE, "qx:NEW", "7", F1.folder, F1.id]);
  assert.equal(lib.statusOf(copy.copy), "saved");
  assert.equal(lib.needsWork(Object.assign({}, copy.rec, { latest: { status: "ok", version: "qx:OFFICE" } })), true,
    "once nothing waits here the plan downloads OneDrive's version by itself");
  // removed meanwhile: nothing is kept
  assert.deepEqual(lib.adoptSent(null, SAVE, ans, AT), { rec: null, copy: null, old: [SAVE] });
});

test("the save back's rules for one opening of the frame: the base is the version the app's work was done on; a copy's later saves go on in the copy; handed with the save's own time", () => {
  const A = rec().file;
  const line = { file: A, base: "qx:AAA" };
  // the record still holds what the app has: its own version (a save sent and adopted moves both on together)
  assert.equal(lib.saveBase(rec(), line), "");
  assert.equal(lib.saveBase(rec({ file: SAVE, version: "qx:NEW" }), { file: SAVE, base: "qx:AAA" }), "", "after its own save was adopted");
  // a newer version downloaded while the app was open (the office's): the app's work still goes against what it had (Q3)
  assert.equal(lib.saveBase(rec({ file: "p1-office-1.takeoff", version: "qx:OFFICE" }), line), "qx:AAA");
  assert.equal(lib.withSave(rec({ file: "p1-office-1.takeoff", version: "qx:OFFICE" }), SAVE, 9, AT, lib.saveBase(rec({ file: "p1-office-1.takeoff" }), line)).rec.local.base, "qx:AAA");
  // a save waiting here keeps its own base (withSave); no line (a test's, an older caller): the record's version
  assert.equal(lib.saveBase(rec({ local: local() }), line), "");
  assert.equal(lib.saveBase(rec({ file: "p1-office-1.takeoff" }), null), "");
  assert.equal(lib.withSave(rec(), SAVE, 9, AT, "").rec.local.base, "qx:AAA");
  // the record a Save of the opening goes on: the one whose waiting save is the app's, else whose copy is
  const plan = rec({ owner: "u1" });
  const copyRec = rec({ owner: "u1", key: "u1|01FAKECOPY0001", itemId: "01FAKECOPY0001", file: SAVE });
  const other = rec({ owner: "u2", key: "u2|" + F1.id, file: SAVE });
  assert.equal(lib.recordOfLine([plan, other, copyRec], "u1", SAVE), copyRec, "the copy (never another person's)");
  const waiting = rec({ owner: "u1", local: local({ file: "p1-x-3.takeoff" }) });
  assert.equal(lib.recordOfLine([copyRec, waiting], "u1", "p1-x-3.takeoff"), waiting);
  assert.equal(lib.recordOfLine([plan], "u1", "p1-gone-9.takeoff"), null);
  // adopted after a send: handed with the time the save was KEPT, not OneDrive's upload time (takeoff-web compares its
  // drafts with it); a copy's record too; a later download of another version: OneDrive's time again
  const r = rec({ local: local({ savedAt: "2026-11-04T18:00:00.000Z" }) });
  const ans = { saved: true, mode: "replace", id: F1.id, name: F1.name, size: 2000, modified: "2026-11-04T19:02:00.000Z", version: "qx:NEW" };
  const rep = lib.adoptSent(r, SAVE, ans, AT).rec;
  assert.deepEqual(rep.adopted, { file: SAVE, keptAt: "2026-11-04T18:00:00.000Z" });
  assert.equal(lib.handedTime(rep), Date.parse("2026-11-04T18:00:00.000Z"));
  assert.equal(lib.handedTime(Object.assign({}, rep, { file: "p1-office-1.takeoff", modified: "2026-11-05T08:00:00.000Z" })), Date.parse("2026-11-05T08:00:00.000Z"));
  assert.equal(lib.handedTime(r), Date.parse("2026-11-04T18:00:00.000Z"), "a save waiting here: its own time");
  assert.equal(lib.handedTime(rec({ modified: "2026-10-01T10:00:00.000Z" })), Date.parse("2026-10-01T10:00:00.000Z"));
  assert.ok(Number.isNaN(lib.handedTime(null)));
  const cp = lib.adoptSent(r, SAVE, Object.assign({}, ans, { mode: "copy", id: "01FAKECOPY0001", name: "A900 Bid - iPad 2026-11-04 1030.takeoff" }), AT).copy;
  assert.equal(lib.handedTime(cp), Date.parse("2026-11-04T18:00:00.000Z"));
  // OneDrive's hash of bytes it named "sm:" (the save before was taken before the hash): the same size and time
  assert.equal(lib.hashedBase("sm:2000:2026-11-04T18:30:00.000Z", { size: 2000, modified: "2026-11-04T18:30:00Z", version: "qx:HASHED" }), "qx:HASHED");
  assert.equal(lib.hashedBase("sm:2000:2026-11-04T18:30:00.000Z", { size: 2001, modified: "2026-11-04T18:30:00Z", version: "qx:HASHED" }), "", "other bytes");
  assert.equal(lib.hashedBase("sm:2000:2026-11-04T18:30:00.000Z", { size: 2000, modified: "2026-11-04T18:31:00Z", version: "qx:HASHED" }), "", "saved again since");
  assert.equal(lib.hashedBase("sm:2000:2026-11-04T18:30:00.000Z", { size: 2000, modified: "2026-11-04T18:30:00Z", version: "sm:2000:2026-11-04T18:30:00.000Z" }), "");
  assert.equal(lib.hashedBase("qx:AAA", { size: 2000, modified: AT, version: "qx:B" }), "", "only an sm: base");
  assert.equal(lib.hashedBase("sm:?:?", { size: 2000, modified: AT, version: "qx:B" }), "", "nothing to know the bytes by");
});

test("the save back's rules: OneDrive's own hash of bytes adopted with an 'sm:' version is taken without a download (the same size and time)", () => {
  const kept = rec({ file: SAVE, version: "sm:2000:2026-11-04T18:30:00.000Z", size: 2000, expect: { size: 2000, modified: "2026-11-04T18:30:00.000Z" },
    latest: { status: "ok", version: "sm:2000:2026-11-04T18:30:00.000Z" } });
  const hashed = Object.assign({}, F1, { size: 2000, modified: "2026-11-04T18:30:00Z", version: "qx:HASHED" });
  assert.equal(lib.keptAs(kept, hashed), true, "the same time however it is written");
  const c = lib.applyCheck(kept, { files: [hashed] }, AT);
  assert.deepEqual([c.version, c.expect, c.latest.version, lib.statusOf(c), lib.needsWork(c)], ["qx:HASHED", null, "qx:HASHED", "saved", false]);
  // anything else is another version: downloaded as ever
  for (const other of [Object.assign({}, hashed, { size: 2001 }), Object.assign({}, hashed, { modified: "2026-11-04T18:31:00Z" })]) {
    const o = lib.applyCheck(kept, { files: [other] }, AT);
    assert.deepEqual([o.version, lib.statusOf(o), lib.needsWork(o)], [kept.version, "outdated", true]);
  }
  assert.equal(lib.keptAs(rec(), hashed), false, "no adopted bytes, nothing to take");
});

test("the save back's words: Saved on this iPad, Sending 45%, Sent, Saved as a separate file, Not sent - tap to retry", () => {
  const r = rec({ local: local() });
  assert.deepEqual(lib.saveStateOf(r, null, NOW), { state: "kept" });
  assert.deepEqual(lib.saveStateOf(r, { sent: 900, size: 2000 }, NOW), { state: "sending", pct: 45 });
  assert.deepEqual(lib.saveStateOf(r, { sent: 2000, size: 2000 }, NOW), { state: "sending", pct: 99 }, "100 only once OneDrive has it");
  assert.deepEqual(lib.saveStateOf(r, null, NOW, true), { state: "sending", pct: null }, "another window sends it");
  assert.deepEqual(lib.saveStateOf(rec({ local: local({ state: "sending" }) }), null, NOW), { state: "kept" }, "a page closed while it went: waiting again");
  assert.deepEqual(lib.saveStateOf(rec({ local: local({ state: "failed", error: "OneDrive is busy.", code: "busy" }) }), null, NOW),
    { state: "failed", why: "OneDrive is busy.", final: false, code: "busy" });
  assert.deepEqual(lib.saveStateOf(rec({ sent: { mode: "replace", at: AT } }), null, NOW), { state: "sent" });
  assert.deepEqual(lib.saveStateOf(rec({ sent: { mode: "copy", name: "A - iPad 2026-11-04 1030.takeoff", at: AT } }), null, NOW),
    { state: "copy", name: "A - iPad 2026-11-04 1030.takeoff" });
  assert.equal(lib.saveStateOf(rec({ sent: { mode: "replace", at: AT } }), null, NOW + lib.SENT_NOTE_MS), null, "said for a while only");
  assert.equal(lib.saveStateOf(rec(), null, NOW), null);
  assert.match(lib.saveText({ state: "kept" }, "iPad"), /^Saved on this iPad — not in OneDrive yet/);
  assert.match(lib.saveText({ state: "kept" }), /^Saved on this device/);
  assert.equal(lib.saveText({ state: "sending", pct: 45 }), "Sending 45% — keep this screen open");
  assert.equal(lib.saveText({ state: "sending", pct: null }), "Sending to OneDrive…");
  assert.equal(lib.saveText({ state: "failed", why: "OneDrive is busy." }), "Not sent — tap to retry (OneDrive is busy)");
  // the broker's switch off for its project (contract addendum 3 D1): the row says it waits - nothing to retry
  const off = lib.saveStateOf(rec({ local: local({ state: "failed", error: "x", code: "save_back_off" }) }), null, NOW);
  assert.deepEqual([off.state, off.final, off.code], ["failed", false, "save_back_off"]);
  assert.equal(lib.saveText(off, "iPad"), "Saving back to OneDrive is turned off for now - this save waits on this iPad.");
  assert.equal(lib.saveBackOffWords("iPad"), "Saving back to OneDrive is turned off for now - this save waits on this iPad.");
  // a copy made because OneDrive would not replace the plan (plan_changed {why: "refused"}, D5): nobody is blamed
  assert.equal(lib.refusedTold("A900 Bid - iPad 2026-11-04 1030.takeoff"),
    "OneDrive would not replace the plan, so your work was saved as 'A900 Bid - iPad 2026-11-04 1030.takeoff' next to it - nothing was overwritten.");
  assert.ok(!/office|Someone/.test(lib.refusedTold("x.takeoff")));
  assert.equal(lib.saveText({ state: "sent" }), "Sent to OneDrive");
  assert.match(lib.saveText({ state: "copy", name: "A - iPad.takeoff" }), /^Saved as a separate file: A - iPad\.takeoff/);
  assert.equal(lib.copyTold("A900 Bid - iPad 2026-11-04 1030.takeoff", "iPad"),
    "Someone saved this plan in the office after your iPad got it. Your work was saved as 'A900 Bid - iPad 2026-11-04 1030.takeoff' next to it - nothing was overwritten.");
  assert.deepEqual(lib.sendBar({ state: "sending", pct: 45 }), { pct: 45, kind: "run" });
  assert.deepEqual(lib.sendBar({ state: "sent" }), { pct: 100, kind: "done" });
  assert.equal(lib.sendBar({ state: "kept" }), null);
  assert.equal(plans.deviceWord({ navigator: { userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" } }), "iPad");
  assert.equal(plans.deviceWord({ navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 } }), "iPad");
  assert.equal(plans.deviceWord({ navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" } }), "iPhone");
  assert.equal(plans.deviceWord({ navigator: { userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X710)" } }), "device");
});

test("who may save back (Q2): an admin, or Sees prices AND Can upload to OneDrive; the switch PLAN_SAVE_BACK", () => {
  assert.equal(plans.PLAN_SAVE_BACK, true, "on in the code (the go-live keeps the owner's write grant first)");
  const me = (o) => Object.assign({ id: "u", role: "manager", active: true, can_see_prices: false, can_upload_onedrive: false }, o);
  assert.equal(plans.canSaveBack(me({ role: "admin" })), true, "an admin always");
  assert.equal(plans.canSaveBack(me({ can_see_prices: true, can_upload_onedrive: true })), true);
  assert.equal(plans.canSaveBack(me({ can_see_prices: true })), false, "prices without the upload switch");
  assert.equal(plans.canSaveBack(me({ can_upload_onedrive: true })), false, "the switch without prices");
  assert.equal(plans.canSaveBack(me({ role: "agents", can_see_prices: true, can_upload_onedrive: true })), false);
  assert.equal(plans.canSaveBack(me({ active: false, can_see_prices: true, can_upload_onedrive: true })), false);
  assert.equal(plans.canSaveBack(null), false);
  assert.equal(plans.saveBackFor(me({ role: "admin" }), false), false, "the switch off: never offered");
  assert.equal(plans.saveBackFor(me({ role: "admin" })), true);
});

/* ── the save back over a made-up phone (tests/plan-device.mjs): js/plan-library.js and its REAL worker ────────── */

const { installDevice, savedProject } = await import("./plan-device.mjs");
const { readFileSync: readSiteFile } = await import("node:fs");
const read = (f) => readSiteFile(new URL("../site/" + f, import.meta.url), "utf8");
const UNIT = 327680;
const MiB = 1024 * 1024;
// the made-up phone is installed by the first of these tests (the tests above keep their own globals), and the
// library's module imported then - with no BroadcastChannel: a node one would keep the test running (the module reads
// it once, at its import)
let DEV = null, LIB = null;
async function device() {
  if (!DEV) {
    DEV = installDevice();
    LIB = await import("../site/js/plan-library.js");
  } else DEV.apply();
  DEV.store.setItem("dcr2-auth", JSON.stringify({ user: { id: "u1", email: "made-up@example.test" } }));
  return DEV;
}
test.after(() => { if (DEV) DEV.uninstall(); });

/** The broker and Microsoft's upload address for one made-up plan, as contract C1 has them - and, with o.deferred, as
    addendum 2 C1b has them (DCR Desktop 2's handler.ts since the review round): a replace session answers commit
    "broker", its last chunk answers 202 and commits nothing, plan_save_commit commits it onto the plan only while the
    plan still has the session's tag (else the SAME upload becomes the copy, or - w.commitRefuse - plan_changed), the
    session finds the plan by its name when its id is gone (a desktop save), and plan_save_done takes the device's hash
    (with OneDrive's: they alone decide) and a ticket for 30 days (w.expired: one past them). w.realHash: OneDrive's
    version of saved bytes is their real quickXorHash. w.during(s): run when a session's last chunk arrives (an office
    save while it goes up). And addendum 3: w.landAtChunk - OneDrive ignores the deferral, the last chunk commits the
    replace and answers 200 with the file; w.refusedAll - both commit forms refused: plan_changed {why: "refused"};
    w.commitWhy - the why of w.commitRefuse's plan_changed (none: an older broker); w.refuseField - the field of
    w.refuse's error; w.needHash - plan_save_done without a hash: 409 not_saved {need: "hash"}. And addendum 4:
    w.commitQueue - plan_save_commit's next answers (a 503 with a Retry-After, need hash: a test's), as w.doneQueue is
    plan_save_done's; w.commitVerified - the commit's replace answer carries that `verified`; w.parts - more parts of
    the library's uploader (its maxTries: a test that must not wait). */
function saveWorld(o) {
  const w = Object.assign({ calls: [], bodies: [], sessions: new Map(), n: 0, refuse: null, hash: false, loseFinal: false, puts: 0, bytes: 0,
    deferred: false, realHash: false, commitRefuse: false, loseCommit: false, expired: false, during: null, landAtChunk: false, refusedAll: false,
    commitWhy: null, refuseField: null, needHash: false, doneVerified: true, doneQueue: [], commitQueue: [], parts: null }, o || {});
  w.plan = Object.assign({ id: F1.id, name: F1.name, folder: F1.folder, size: 1500, modified: AT, version: "qx:AAA", rev: 1 }, (o && o.plan) || {});
  w.files = [w.plan];
  const file = (f) => ({ id: f.id, name: f.name, folder: f.folder, size: f.size, modified: f.modified, version: f.version });
  const nameKey = (n) => String(n).normalize("NFC").toLowerCase();
  const smMatch = (v, f) => { const m = /^sm:([0-9]+):(.+)$/.exec(v); return !!m && Number(m[1]) === f.size && Date.parse(m[2]) === Date.parse(f.modified); };
  /** the last chunk's bytes landed: the plan replaced (same id), or a copy beside it */
  const land = async (s, asCopy) => {
    const at = new Date(NOW + 3600000 + w.n * 1000).toISOString();
    const blob = new Blob(s.parts);
    const version = w.realHash ? "qx:" + QX.quickXorHash(new Uint8Array(await blob.arrayBuffer())) : w.hash ? "qx:SAVED" + w.n : "sm:" + s.size + ":" + at;
    let f;
    if (!asCopy) { f = w.files.find((x) => x.id === s.item); Object.assign(f, { size: s.size, modified: at, version, rev: (f.rev || 1) + 1 }); }
    else { f = { id: "01FAKECOPY000" + w.n, name: asCopy, folder: w.plan.folder, size: s.size, modified: at, version, rev: 1 }; w.files.push(f); }
    w.saved = blob;
    s.done = f.id;
    return f;
  };
  const copyName = (n) => "A900 Bid - iPad 2026-11-04 1030" + (n > 1 ? " (" + n + ")" : "") + ".takeoff";
  const freeCopyName = () => { for (let n = 1; ; n++) if (!w.files.some((x) => nameKey(x.name) === nameKey(copyName(n)))) return copyName(n); };
  const saved = (mode, f) => ok(Object.assign({ saved: true, mode }, file(f)));
  useClient({ functions: { invoke: async (name, x) => {
    const b = x.body;
    w.calls.push(b.op);
    w.bodies.push(b);
    if (b.op === "plans_list") return ok({ projects: { "7": { number: "A900", files: w.files.map(file), complete: true } } });
    if (b.op === "plan_link") return ok(Object.assign({ url: "https://" + onedrive.ONEDRIVE_HOST + "/dl/" + b.item_id }, file(w.files.find((f) => f.id === b.item_id))));
    if (b.op === "plan_save_session") {
      w.sessionBody = b;
      if (w.refuse) return http(w.refuse[0], Object.assign({ error: w.refuse[1], message: "made up" }, w.refuseField ? { field: w.refuseField } : {}));
      let f = w.files.find((x) => x.id === b.item_id), byName = false;
      if (!f && w.deferred && b.name) {
        const same = w.files.filter((x) => nameKey(x.name) === nameKey(b.name));
        if (same.length === 1) [f, byName] = [same[0], true];
      }
      if (!f) return http(404, { error: "not_found" });
      const match = f.version === b.version || (w.deferred && smMatch(b.version, f));
      const mode = !byName && b.mode !== "copy" && match ? "replace" : "copy";
      const n = ++w.n;
      const url = "https://" + onedrive.ONEDRIVE_HOST + "/up/" + n;
      const s = { mode, item: f.id, name: mode === "replace" ? f.name : freeCopyName(), size: b.size, offset: 0, parts: [], done: null, ticket: "tk" + n,
        deferred: w.deferred && mode === "replace", rev: f.rev, url };
      w.sessions.set(url, s);
      return ok(Object.assign({ mode }, s.deferred ? { commit: "broker" } : {}, { upload_url: url, expires_at: AT, chunk_bytes: 4 * UNIT, chunk_multiple: UNIT,
        max_chunk_bytes: 191 * UNIT, max_bytes: 4096 * MiB, ticket: s.ticket, name: s.name }));
    }
    if (b.op === "plan_save_commit") {
      if (w.commitQueue.length) { const a = w.commitQueue.shift(); return typeof a === "function" ? a(b) : a; }
      const s = Array.from(w.sessions.values()).find((x) => x.ticket === b.ticket);
      if (!s || !s.deferred) return http(400, { error: "invalid", field: "ticket", message: "made up" });
      if (b.upload_url !== s.url) return http(400, { error: "invalid", field: "upload_url", message: "That is not the upload URL of this save's session." });
      if (s.done) {
        // gone: committed earlier, its answer lost - plan_save_done's checks
        const g = w.files.find((f) => f.id === s.done);
        return g && (!b.hash || !w.realHash || g.version.indexOf("qx:") !== 0 || g.version === "qx:" + b.hash) ? saved(g.id === s.item ? "replace" : "copy", g)
          : http(409, { error: "not_saved", message: "OneDrive did not get the whole file - send it again." });
      }
      if (s.offset !== s.size || w.notSaved) return http(409, { error: "not_saved", message: "OneDrive did not get the whole file - send it again." });
      if (w.refusedAll) { w.sessions.delete(s.url); return http(409, { error: "plan_changed", retry: "copy", why: "refused", message: "OneDrive would not replace the plan: the save is sent again as a separate file." }); }
      const plan = w.files.find((f) => f.id === s.item);
      let f;
      if (plan && plan.rev === s.rev) f = await land(s, null);
      else if (w.commitRefuse) {
        w.sessions.delete(s.url);
        return http(409, Object.assign({ error: "plan_changed", retry: "copy", message: "OneDrive's plan changed while the save was sent: it is sent again as a separate file." }, w.commitWhy ? { why: w.commitWhy } : {}));
      }
      else f = await land(s, freeCopyName());
      if (w.loseCommit) { w.loseCommit = false; return { data: null, error: { name: "FunctionsFetchError", message: "Failed to send", context: new TypeError("offline") } }; }
      // (w.commitVerified: the broker's version check said so - false: no history to read)
      return f.id === s.item && typeof w.commitVerified === "boolean" ? ok(Object.assign({ saved: true, mode: "replace" }, file(f), { verified: w.commitVerified }))
        : saved(f.id === s.item ? "replace" : "copy", f);
    }
    if (b.op === "plan_save_done") {
      // a test's answers first (the broker's check of a later page's settle: busy, a crossing it put back - repair round 2)
      if (w.doneQueue.length) { const a = w.doneQueue.shift(); return typeof a === "function" ? a(b) : a; }
      if (w.expired) return http(400, { error: "invalid", field: "ticket", message: "This save's ticket is not valid or has run out: save the plan again." });
      if (w.needHash && !b.hash) return http(409, { error: "not_saved", need: "hash", message: "This save can be checked now only with the file's hash - send it again with the hash." });
      const s = Array.from(w.sessions.values()).find((x) => x.ticket === b.ticket);
      const f = s && s.done ? w.files.find((x) => x.id === s.done) : null;
      if (!f || f.id !== b.item_id) return http(409, { error: "not_saved", message: "OneDrive did not get the whole file - send it again." });
      // the hashes decide when both are there (only real ones: w.realHash - a made-up "qx:SAVED" is no hash of anything)
      if (b.hash && w.realHash && f.version.indexOf("qx:") === 0 && f.version !== "qx:" + b.hash) return http(409, { error: "not_saved", message: "OneDrive did not get the whole file - send it again." });
      const mode = s.mode === "replace" && f.id === s.item ? "replace" : "copy";
      // a deferred replace found landed is checked by the broker's version history (DCR Desktop 2 since its repair round
      // 2): its answer carries `verified` - an older broker's none (w.doneVerified null)
      return ok(Object.assign({ saved: true, mode }, file(f), s.deferred && mode === "replace" && typeof w.doneVerified === "boolean" ? { verified: w.doneVerified } : {}));
    }
    return http(400, { error: "invalid" });
  } } });
  LIB.useTransport(async function (req) {
    const res = (status, body) => ({ status, header: () => null, text: () => JSON.stringify(body) });
    const s = w.sessions.get(req.url);
    if (!s || s.done) return res(404, { error: { code: "itemNotFound" } });
    if (req.method === "GET") return res(200, { nextExpectedRanges: s.offset < s.size ? [s.offset + "-"] : [] });
    assert.ok(!Object.keys(req.headers).some((k) => /authorization/i.test(k)), "no sign-in on Microsoft's address");
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers["Content-Range"]);
    if (Number(m[1]) !== s.offset) return res(416, { nextExpectedRanges: [s.offset + "-"] });
    w.puts++;
    w.bytes += req.body.size;
    s.parts.push(req.body);
    s.offset = Number(m[2]) + 1;
    if (s.offset < s.size) { if (typeof w.chunk === "function") w.chunk(s); return res(202, { nextExpectedRanges: [s.offset + "-"] }); }
    if (typeof w.during === "function") { const d = w.during; w.during = null; d(s); }
    // a deferred replace: the last chunk commits nothing (the broker's plan_save_commit does) - unless OneDrive ignores
    // the deferral (w.landAtChunk): then it commits it, 200 with the file (addendum 3 D3)
    if (s.deferred && !w.landAtChunk) return res(202, { expirationDateTime: AT, nextExpectedRanges: [] });
    // the last chunk: OneDrive has it - the plan replaced (same id), or a copy beside it
    const f = await land(s, s.mode === "replace" ? null : s.name);
    if (w.loseFinal) { w.loseFinal = false; throw Object.assign(new Error("No connection"), { code: "offline" }); }
    return res(s.deferred ? 200 : 201, { id: f.id, name: f.name, size: f.size });
  }, w.parts);
  return w;
}
/** An office save of the plan in place (its tag moves): other bytes, another version. */
const officeSave = (w) => Object.assign(w.plan, { size: w.plan.size + 7, version: "qx:OFFICE" + (++w.n), modified: new Date(NOW + 1800000).toISOString(), rev: w.plan.rev + 1 });

const KEY = "u1|" + F1.id;
const PLANS = () => DEV.idb.rows("dcr2-plan-library", "plans");
const ROW = (k) => PLANS().find((r) => r.key === (k || KEY)) || null;
const LIBFILES = () => DEV.fs.files("plan-library");

/** A clean device holding one saved plan (its copy's bytes on the device): the record as the library writes it. */
async function devicePlan(over) {
  await device();
  await LIB.list();                                          // the library's database is there
  const st = DEV.idb.dbs.get("dcr2-plan-library").stores;
  st.forEach((s) => s.data.clear());
  DEV.fs.root.entries.clear();
  DEV.nav.onLine = true;
  const copy = "p" + lib.hashOf("u1") + "-old-1.takeoff";
  const d = await DEV.fs.root.getDirectoryHandle("plan-library", { create: true });
  const h = await d.getFileHandle(copy, { create: true });
  h.bytes = new TextEncoder().encode("PDFCACHE1 the plan as this device got it" + ".".repeat(1460));
  const r = Object.assign({ key: KEY, owner: "u1", itemId: F1.id, projectId: "7", number: "A900", projectTitle: "Made Up Lane", name: F1.name,
    folder: F1.folder, file: copy, size: h.bytes.length, modified: AT, version: "qx:AAA", savedAt: AT, dl: null,
    latest: { status: "ok", checkedAt: AT, version: "qx:AAA", size: h.bytes.length, modified: AT, name: F1.name, folder: F1.folder },
    fails: 0, retryAt: null, failCode: null }, over || {});
  st.get("plans").data.set(KEY, structuredClone(r));
  return r;
}
const saveOf = (p) => ({ req: "sAAAAAAAAA", name: F1.name, size: p.blob.size, file: p.blob });
const same = async (a, b) => Buffer.compare(Buffer.from(await a.arrayBuffer()), Buffer.from(b)) === 0;

test("keepSave: the takeoff app's Save is copied into a NEW file in slices of 8 MiB (never read whole), checked, and the record gets its save; it opens from then on and nothing downloads over it", async () => {
  const before = await devicePlan({ latest: { status: "ok", checkedAt: AT, version: "qx:BBB", size: 9, modified: AT, name: F1.name, folder: F1.folder } });
  const w = saveWorld();
  DEV.nav.onLine = false;                                    // kept now, sent later (offline: nothing is asked)
  const p = savedProject(17 * MiB + 123);
  const out = await LIB.keepSave(F1.id, saveOf(p));
  assert.equal(out.state, "kept", out.why);
  await out.sent;
  assert.equal(p.log.whole, 0, "never arrayBuffer() / text() of the whole save");
  assert.ok(p.log.slices.length >= 3 && p.log.slices.every(([a, b]) => b - a <= 8 * MiB), JSON.stringify(p.log.slices));
  const r = ROW();
  assert.ok(r.local && r.local.file !== before.file && lib.FILE_RE.test(r.local.file), "a new library file");
  assert.deepEqual([r.local.base, r.local.size, r.local.state, r.file, r.version], ["qx:AAA", p.blob.size, "waiting", before.file, "qx:AAA"]);
  assert.ok(await same(new Blob([LIBFILES()[r.local.file]]), p.bytes), "the very bytes of the save");
  // OneDrive's quickXorHash of them, from the worker's own slices (contract addendum 2, C3b): the broker's proof
  assert.equal(r.local.hash, QX.quickXorHash(p.bytes), "the save's quickXorHash, kept with it");
  assert.ok(LIBFILES()[before.file], "the plan's own copy stays (the app still reads it)");
  assert.deepEqual(w.calls, [], "nothing asked of the broker offline");
  // the row says so; and it is what a phone opens (map: open hands local.file)
  const row = (await LIB.list())[0];
  assert.deepEqual(row.save, { state: "kept" });
  assert.equal(row.status, "outdated", "OneDrive has a newer version...");
  DEV.nav.onLine = true;
  await LIB.autoWork();
  assert.deepEqual(w.calls, [], "...but nothing downloads over the save");
  assert.deepEqual(await LIB.resume(F1.id), { local: true }, "not even the person's own Update");
  await LIB.sweep();
  assert.ok(LIBFILES()[r.local.file], "a sweep keeps the save");
  const src = read("js/plan-library.js");
  assert.match(src, /const which = \(c\) => \(hasLocal\(c\) \? c\.local\.file : c\.file\);/, "open() hands the save when one waits");
});

test("keepSave's heartbeat (takeoff-web's 'keeping'): from the worker's own progress, a pct of the save, at most one every BEAT_MS, never after the answer", async () => {
  await devicePlan();
  saveWorld();
  DEV.nav.onLine = false;                                    // kept only (nothing is sent offline)
  const real = Date.now;
  let t = real();
  try {
    // a slow device: every clock reading 2.5 s on - every slice the worker reports is a word to the app
    Date.now = () => (t += 2500);
    const beats = [];
    let over = false;
    const p = savedProject(17 * MiB + 9);
    const out = await LIB.keepSave(F1.id, saveOf(p), (state, extra) => beats.push([state, extra, over]));
    over = true;
    assert.equal(out.state, "kept", out.why);
    const keeping = beats.filter((b) => b[0] === "keeping");
    assert.ok(keeping.length >= 3, "one per slice of 8 MiB: " + JSON.stringify(beats));
    assert.ok(keeping.every((b) => b[2] === false), "all before the answer");
    const pcts = keeping.map((b) => b[1].pct);
    assert.ok(pcts.every((x, i) => Number.isInteger(x) && x >= 0 && x <= 100 && (i === 0 || x >= pcts[i - 1])), JSON.stringify(pcts));
    assert.ok(pcts.includes(47) && pcts[pcts.length - 1] === 100, "8 MiB of 17 is 47%, the whole of it 100%: " + JSON.stringify(pcts));
    await out.sent;
    assert.equal(beats.filter((b) => b[0] === "keeping" && b[2]).length, 0, "nothing after the answer");
    // a fast device: the clock barely moves - one word in all (BEAT_MS apart at most)
    t = real();
    Date.now = () => (t += 1);
    const fast = [];
    const out2 = await LIB.keepSave(F1.id, saveOf(savedProject(17 * MiB + 11)), (state, extra) => fast.push([state, extra]));
    assert.equal(out2.state, "kept", out2.why);
    assert.equal(fast.filter((b) => b[0] === "keeping").length, 1, JSON.stringify(fast));
    await out2.sent;
    // a worker that reports every slice (each clock reading 0.3 s on: over its 250 ms) - the app hears far fewer words
    t = real();
    Date.now = () => (t += 300);
    const mid = [];
    const out3 = await LIB.keepSave(F1.id, saveOf(savedProject(48 * MiB + 5)), (state, extra) => mid.push([state, extra]));
    assert.equal(out3.state, "kept", out3.why);
    const n = mid.filter((b) => b[0] === "keeping").length;
    assert.ok(n >= 1 && n <= 3, "7 slices reported, at most one word every 2 s: " + n);
    await out3.sent;
  } finally {
    Date.now = real;
  }
  assert.equal(LIB.BEAT_MS, 2000);
  // derived from the worker's messages only: no timer of the page's own for it
  const src = read("js/plan-library.js");
  assert.match(src, /if \(d <= done\) return;[^\n]*\n\s*done = d;\s*dog\.moved\(\);\s*if \(!over && typeof onProgress === "function"\)/);
  assert.match(src, /const spool = async function \(\) \{\s*const w = await runSpool\(key, name, s\.file, size, beat\);/);
  assert.ok(!/setInterval\([^)]*keeping/.test(src) && !/setTimeout\([^)]*keeping/.test(src));
});

test("keepSave: not a takeoff project, not whole, not a plan saved here, no room - refused or no-room, nothing left behind", async () => {
  await devicePlan();
  saveWorld();
  DEV.nav.onLine = false;
  const names = () => Object.keys(LIBFILES()).sort();
  const start = names();
  const bad = await LIB.keepSave(F1.id, saveOf(savedProject(3 * MiB, "NOTAPLAN!")));
  assert.deepEqual([bad.state, bad.why], ["refused", "what the takeoff app saved is not a takeoff project file"],
    "one plain clause: the app says it inside its own words (contract addendum 3 D7)");
  const half = savedProject(4096);
  assert.deepEqual(await LIB.keepSave(F1.id, { req: "s1", name: F1.name, size: 4097, file: half.blob }), { state: "refused", why: "the save did not arrive whole" },
    "its size is not the file's");
  assert.deepEqual(await LIB.keepSave("01FAKEPLAN9999", saveOf(savedProject(64))), { state: "refused", why: "this plan is no longer saved on this device" },
    "not a plan saved on this device");
  // the room asked first (the quota), then the worker's own write running out of it: either way no-room
  const quota = DEV.fs.quota;
  DEV.fs.quota = DEV.fs.used() + 70 * MiB;
  const full = await LIB.keepSave(F1.id, saveOf(savedProject(20 * MiB)));
  assert.equal(full.state, "no-room", full.why);
  const est = DEV.nav.storage.estimate;
  DEV.nav.storage.estimate = async () => ({ quota: 64 * 1024 * MiB, usage: 0 });  // a browser that says there is room
  DEV.fs.quota = DEV.fs.used() + 5 * MiB;
  const short = await LIB.keepSave(F1.id, saveOf(savedProject(12 * MiB)));
  assert.equal(short.state, "no-room", short.why);
  DEV.nav.storage.estimate = est;
  DEV.fs.quota = quota;
  assert.deepEqual(names(), start, "no part of a save is ever left on the device");
  assert.equal(ROW().local, undefined, "and the record has no save");
});

test("sent: a replace - the saved bytes ARE the plan's copy now (no download), the old copy retired, the screen kept awake meanwhile; OneDrive's hash of them later is taken without a download", async () => {
  const before = await devicePlan();
  const w = saveWorld();
  const p = savedProject(3 * MiB + 77, "PDFCACHE1", 3);
  const news = [];
  const out = await LIB.keepSave(F1.id, saveOf(p), (state, extra) => news.push([state, extra]));
  assert.equal(out.state, "kept");
  const sent = await out.sent;
  assert.deepEqual([sent.sent, sent.mode], [true, "replace"]);
  assert.deepEqual(w.calls, ["plan_save_session", "plan_save_done"], "one session, then its check - no plan_link, no download");
  assert.deepEqual([w.sessionBody.item_id, w.sessionBody.version, w.sessionBody.size, "mode" in w.sessionBody], [F1.id, "qx:AAA", p.blob.size, false]);
  assert.ok(await same(w.saved, p.bytes), "OneDrive got exactly the save");
  const r = ROW();
  assert.equal(r.local, null);
  assert.ok(r.file && r.file !== before.file && LIBFILES()[r.file], "the save's own file is the plan's copy");
  assert.equal(r.version.indexOf("sm:" + p.blob.size + ":"), 0, "OneDrive had no hash yet: its sm: form");
  assert.deepEqual(r.expect, { size: p.blob.size, modified: w.plan.modified });
  assert.deepEqual([r.size, r.sent.mode, lib.statusOf(r)], [p.blob.size, "replace", "saved"]);
  assert.equal(LIBFILES()[before.file], undefined, "the old copy went (not handed to the app lately)");
  assert.deepEqual([DEV.wake.asked > 0, DEV.wake.held], [true, 0], "the screen was held awake while it went, and let go");
  // the app hears how it went: the end (and "sending" on the way when the upload takes a while)
  assert.deepEqual(news.map((n) => n[0]).filter((s) => s !== "sending" && s !== "keeping"), ["sent"], JSON.stringify(news));
  assert.equal(news[0][0], "keeping", "the heartbeat while it was kept came first");
  assert.deepEqual((await LIB.list())[0].save, { state: "sent" });
  // the next check: OneDrive now gives its hash of the same bytes (the same size and time) - taken, nothing downloaded
  w.plan.version = "qx:HASHEDNOW";
  w.calls.length = 0;
  await LIB.checkUpdates();
  const c = ROW();
  assert.deepEqual([c.version, c.expect, c.file, lib.statusOf(c)], ["qx:HASHEDNOW", null, r.file, "saved"]);
  await LIB.autoWork();
  assert.deepEqual(w.calls, ["plans_list"], "no plan_link, no download");
});

test("someone saved the plan in the office meanwhile (Q3): the save becomes a separate file beside it - the plan's record stays, the copy gets one of its own (no download), and the person is told", async () => {
  const before = await devicePlan();
  const w = saveWorld();
  w.plan.version = "qx:OFFICE";                              // the office's save after this device got qx:AAA
  w.hash = true;
  const p = savedProject(2 * MiB + 5);
  const news = [];
  const out = await LIB.keepSave(F1.id, saveOf(p), (state, extra) => news.push([state, extra]));
  const sent = await out.sent;
  assert.deepEqual([sent.mode, sent.name], ["copy", "A900 Bid - iPad 2026-11-04 1030.takeoff"]);
  const r = ROW();
  assert.deepEqual([r.file, r.version, r.local, r.sent.mode, r.sent.name], [before.file, "qx:AAA", null, "copy", "A900 Bid - iPad 2026-11-04 1030.takeoff"],
    "the plan's record keeps its copy (nothing overwritten anywhere)");
  const c = ROW("u1|01FAKECOPY0001");
  assert.ok(c && c.file && LIBFILES()[c.file] && (await same(new Blob([LIBFILES()[c.file]]), p.bytes)), "the save is the copy's own record");
  assert.deepEqual([c.itemId, c.name, c.version, c.folder, lib.statusOf(c)], ["01FAKECOPY0001", "A900 Bid - iPad 2026-11-04 1030.takeoff", "qx:SAVED1", F1.folder, "saved"]);
  // the copy's news names the copy AND its own plan word - the word open() hands the copy's record to the frame with
  // (its number, folder and name: map/plans.js planWord), never the plan's - so the app keeps the work done after this
  // save with the copy (takeoff-web d1cbf16; the final checker's round 3b, problem 3)
  const copyWord = await plans.planWord(c.number, c.folder, c.name);
  assert.deepEqual(news.find((n) => n[0] === "copy"), ["copy", { name: "A900 Bid - iPad 2026-11-04 1030.takeoff", plan: copyWord }]);
  assert.deepEqual([copyWord, c.number, c.folder], [await plans.planWord("A900", F1.folder, "A900 Bid - iPad 2026-11-04 1030.takeoff"), "A900", F1.folder]);
  assert.ok(plans.PLAN_RE.test(copyWord) && copyWord !== (await plans.planWord(r.number, r.folder, r.name)), "the copy's word, not the plan's");
  const rows = await LIB.list();
  assert.deepEqual(rows.find((x) => x.key === KEY).save, { state: "copy", name: "A900 Bid - iPad 2026-11-04 1030.takeoff" });
  assert.ok(!w.calls.includes("plan_link"), "no download of the copy");
  // once nothing waits here the plan itself is a plan like any other: OneDrive's newer version downloads by itself
  await LIB.checkUpdates();
  assert.equal(lib.needsWork(ROW()), true);
});

test("one opening, Save after Save: each replaces the plan (also once OneDrive hashed the bytes it first named sm:); never a copy of the person's own save", async () => {
  const before = await devicePlan();
  const w = saveWorld();                                      // OneDrive answers "sm:" (no hash yet) after each save
  const line = { file: before.file, base: "qx:AAA" };         // what open() hands the frame's app
  const p1 = savedProject(1 * MiB + 3, "PDFCACHE1", 5);
  const o1 = await LIB.keepSave(F1.id, saveOf(p1), null, line);
  assert.equal(o1.state, "kept");
  assert.equal((await o1.sent).mode, "replace");
  const r1 = ROW();
  assert.deepEqual([line.file, r1.file, r1.version.indexOf("sm:")], [r1.file, r1.file, 0], "the app's work is that save, adopted as the plan's copy");
  // meanwhile OneDrive works out its hash of those bytes (the same size and time)
  w.plan.version = "qx:HASHOFSAVE1";
  w.calls.length = 0;
  const p2 = savedProject(1 * MiB + 9, "PDFCACHE1", 6);
  const o2 = await LIB.keepSave(F1.id, { req: "sBBBBBBBBB", name: F1.name, size: p2.blob.size, file: p2.blob }, null, line);
  assert.equal(o2.state, "kept");
  const s2 = await o2.sent;
  assert.deepEqual([s2.sent, s2.mode], [true, "replace"], "the second Save replaced the plan too");
  assert.deepEqual([w.sessionBody.version, w.calls], ["qx:HASHOFSAVE1", ["plans_list", "plan_save_session", "plan_save_done"]],
    "sent against OneDrive's hash of the bytes it built on (one plans_list asked first)");
  assert.equal(w.files.length, 1, "no copy anywhere");
  assert.ok(await same(w.saved, p2.bytes));
  // and again without the hash: the sm: base is already OneDrive's current version - nothing more to ask
  w.calls.length = 0;
  const p3 = savedProject(1 * MiB + 15, "PDFCACHE1", 7);
  const o3 = await LIB.keepSave(F1.id, { req: "sCCCCCCCCC", name: F1.name, size: p3.blob.size, file: p3.blob }, null, line);
  const keptAt = ROW().local.savedAt;
  const s3 = await o3.sent;
  assert.equal(s3.mode, "replace");
  assert.equal(w.files.length, 1);
  // handed again later: the time the last save was kept, not OneDrive's upload time
  const r3 = ROW();
  assert.deepEqual([r3.adopted.keptAt, lib.handedTime(r3)], [keptAt, Date.parse(keptAt)]);
  assert.notEqual(r3.modified, keptAt, "(OneDrive's own time of the upload is another)");
});

test("the office saved while the frame was open and the portal downloaded it: the app's Save still goes against what it had - a copy, never over the office's save (Q3); the next Save of that opening goes on in the copy", async () => {
  const before = await devicePlan();
  const w = saveWorld();
  w.hash = true;
  const line = { file: before.file, base: "qx:AAA" };
  // the office's save, and the library's own download of it while the app is open (its commit, as run() makes it)
  w.plan.version = "qx:OFFICE";
  const d = await DEV.fs.root.getDirectoryHandle("plan-library", { create: true });
  const newer = "p" + lib.hashOf("u1") + "-office-1.takeoff";
  (await d.getFileHandle(newer, { create: true })).bytes = new TextEncoder().encode("PDFCACHE1 the office's version" + ".".repeat(1470));
  const st = DEV.idb.dbs.get("dcr2-plan-library").stores.get("plans").data;
  st.set(KEY, Object.assign(structuredClone(st.get(KEY)), { file: newer, version: "qx:OFFICE", size: 1500 }));
  const p = savedProject(2 * MiB + 1, "PDFCACHE1", 8);
  const out = await LIB.keepSave(F1.id, saveOf(p), null, line);
  assert.equal(out.state, "kept");
  assert.equal(ROW().local.base, "qx:AAA", "the version the app's work was done on, not the one downloaded meanwhile");
  const sent = await out.sent;
  assert.equal(sent.mode, "copy", "a separate file: the office's save is not overwritten");
  assert.equal(w.sessionBody.version, "qx:AAA");
  const plan = ROW();
  assert.deepEqual([plan.file, plan.version, plan.local], [newer, "qx:OFFICE", null], "the plan's record keeps the office's version");
  const copyKey = "u1|01FAKECOPY0001";
  assert.equal(ROW(copyKey).file, line.file, "the app's work is the copy now");
  // the next Save of the same opening: the copy is replaced (one copy, not a copy of a copy)
  w.calls.length = 0;
  const q = savedProject(2 * MiB + 7, "PDFCACHE1", 9);
  const o2 = await LIB.keepSave(F1.id, { req: "sDDDDDDDDD", name: F1.name, size: q.blob.size, file: q.blob }, null, line);
  assert.equal(o2.state, "kept");
  assert.ok(ROW(copyKey).local, "kept on the copy's record");
  const s2 = await o2.sent;
  assert.deepEqual([s2.mode, w.sessionBody.item_id, w.sessionBody.version], ["replace", "01FAKECOPY0001", "qx:SAVED1"]);
  assert.equal(w.files.length, 2, "the plan and one copy");
  assert.deepEqual([ROW().file, ROW().version], [newer, "qx:OFFICE"], "the plan untouched");
  assert.ok(await same(w.saved, q.bytes));
});

test("a copy the frame's app has open is never removed while it is open, however long (the person's Remove, a newer version, a sweep); once it closes it goes at once - nothing names it, and the frame was followed exactly (STORE-1: no week's grace)", async () => {
  const before = await devicePlan();
  saveWorld();
  let close;
  const closed = new Promise((r) => { close = r; });
  const freed = LIB.holdForFrame(before.file, closed);
  // handed more than a week ago: the grace alone would no longer keep it
  const meta = DEV.idb.dbs.get("dcr2-plan-library").stores.get("meta").data;
  meta.set("handed", { key: "handed", value: { [before.file]: new Date(Date.now() - 8 * 86400000).toISOString() } });
  assert.ok((await DEV.locks.query()).held.some((l) => l.name === "dcr2-plan-rd:" + before.file + "|" + l.name.split("|")[1]), "a Web Lock other windows see");
  await LIB.remove(F1.id);                                   // the person's Remove (retire)
  assert.equal(ROW(), null);
  await LIB.sweep();
  assert.ok(LIBFILES()[before.file], "still there while the frame reads it");
  close();
  await freed();                                             // (what follows the frame's close, waited for)
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await DEV.locks.query()).held.some((l) => l.name.indexOf("dcr2-plan-rd:") === 0), false, "let go when the frame closed");
  assert.equal(LIBFILES()[before.file], undefined, "gone once the frame closed (nothing names it, nothing reads it): no week of a plan-sized copy");
  assert.ok(!(meta.get("handed").value || {})[before.file], "and no note of it left");
  // another window's frame (only its Web Lock is seen here): kept too
  const other = await devicePlan();
  let release;
  const held = new Promise((r) => { release = r; });
  DEV.locks.request("dcr2-plan-rd:" + other.file + "|elsewhere", () => held);
  await new Promise((r) => setTimeout(r, 5));
  await LIB.remove(F1.id, { });
  meta.set("handed", { key: "handed", value: {} });
  await LIB.sweep();
  assert.ok(LIBFILES()[other.file], "another window's frame reads it");
  release();
  await new Promise((r) => setTimeout(r, 5));
});

test("a send OneDrive did not take waits (Not sent - tap to retry); before the owner's write grant nothing is asked again and again; the person's Retry sends it", async () => {
  await devicePlan();
  const w = saveWorld({ refuse: [503, "onedrive_not_authorized"] });
  const out = await LIB.keepSave(F1.id, saveOf(savedProject(1 * MiB)));
  await out.sent;
  const r = ROW();
  assert.deepEqual([r.local.state, r.local.code, r.local.fails], ["failed", "save_not_allowed", 1]);
  assert.match(r.local.error, /does not take plan saves from the portal yet/);
  assert.ok(Date.parse(r.local.retryAt) > Date.now(), "it waits");
  assert.equal(w.calls.filter((c) => c === "plan_save_session").length, 1, "asked once, not eight times");
  assert.equal((await LIB.list())[0].save.state, "failed");
  assert.equal(await LIB.sendWaiting(), 0);
  assert.equal(w.calls.filter((c) => c === "plan_save_session").length, 1, "not again before its wait is over");
  // the person's Retry (the grant is there now): sent
  w.refuse = null;
  const again = await LIB.sendSaved(F1.id, { manual: true });
  assert.deepEqual([again.sent, again.mode, ROW().local], [true, "replace", null]);
  // a plan no longer in its project's folder: final (no automatic resend), said plainly
  await devicePlan();
  const gone = saveWorld();
  gone.files = [];
  await (await LIB.keepSave(F1.id, saveOf(savedProject(4096)))).sent;
  assert.deepEqual([ROW().local.code, lib.dueToSend(ROW(), Date.now() + 365 * 86400000)], ["not_found", false]);
  assert.match(ROW().local.error, /no longer has this plan in its project's folder/);
});

test("a send whose last answer was lost: in the page (the session gone) it is found, never sent twice; across pages (the page closed) it is settled with its ticket before anything is sent again", async () => {
  await devicePlan();
  const w = saveWorld({ loseFinal: true });
  const p = savedProject(2 * MiB + 9);
  const out = await LIB.keepSave(F1.id, saveOf(p));
  const sent = await out.sent;
  assert.equal(sent.sent, true);
  assert.deepEqual([w.n, w.bytes], [1, p.blob.size], "one session, every byte once");
  assert.equal(ROW().local, null);
  // the page closed after the last byte: the save's session is in its record, OneDrive has the bytes
  await devicePlan();
  const w2 = saveWorld();
  const q = savedProject(1 * MiB + 1);
  DEV.nav.onLine = false;
  await (await LIB.keepSave(F1.id, saveOf(q))).sent;
  DEV.nav.onLine = true;
  const r = ROW();
  w2.sessions.set("https://" + onedrive.ONEDRIVE_HOST + "/up/99", { mode: "replace", item: F1.id, name: F1.name, size: q.blob.size, done: F1.id, ticket: "tk99" });
  Object.assign(w2.plan, { size: q.blob.size, modified: "2026-11-04T19:00:00.000Z", version: "qx:LANDED" });
  const st = DEV.idb.dbs.get("dcr2-plan-library").stores.get("plans").data;
  st.set(KEY, Object.assign({}, r, { local: Object.assign({}, r.local, { sends: [{ file: r.local.file, ticket: "tk99", mode: "replace", name: F1.name, size: q.blob.size, at: AT }] }) }));
  const settled = await LIB.sendSaved(F1.id, { manual: true });
  assert.equal(settled.sent, true);
  assert.deepEqual(w2.calls, ["plan_save_done"], "settled with its ticket: no new session, no byte sent again");
  assert.deepEqual([ROW().local, ROW().version, ROW().file], [null, "qx:LANDED", r.local.file]);
});

test("the purge on lost prices: the saves waiting here go, and on this site the takeoff app's own drafts and kept copies", async () => {
  await devicePlan();
  saveWorld();
  DEV.nav.onLine = false;
  await (await LIB.keepSave(F1.id, saveOf(savedProject(4096)))).sent;
  assert.ok(ROW().local);
  // what the takeoff app keeps here (made up): a kept copy, a draft, their indexes
  const kept = await DEV.fs.root.getDirectoryHandle("plans-kept", { create: true });
  (await kept.getFileHandle("kabc-1.takeoff", { create: true })).bytes = new Uint8Array(10);
  await new Promise((done) => {
    const r = DEV.idb.open("ptt-drafts", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("drafts");
    r.onsuccess = () => { const t = r.result.transaction("drafts", "readwrite"); t.objectStore("drafts").put({ items: [{ unit_cost: 4.25 }] }, "A900 Bid.takeoff|1500"); t.oncomplete = () => { r.result.close(); done(); }; };
  });
  DEV.store.setItem("ptt.keptPlans.v1", JSON.stringify({ v: 1, entries: [{ file: "kabc-1.takeoff" }] }));
  DEV.store.setItem("ptt.recent.v1", "[\"A900 Bid.takeoff\"]");
  DEV.store.setItem("dcr2-takeoff-users", JSON.stringify(["u1"]));
  DEV.store.setItem("ptt.settings.v1", "{}");
  // Sees prices taken away, read online: everything of theirs goes
  DEV.nav.onLine = true;
  await LIB.maybeCheck({ id: "u1", role: "manager", active: true, can_see_prices: false }, { fresh: true });
  assert.deepEqual([PLANS().length, Object.keys(LIBFILES()).length], [0, 0], "the record, its copy and the save");
  assert.equal(DEV.fs.root.entries.has("plans-kept"), false, "the takeoff app's kept copies");
  assert.equal(DEV.idb.dbs.has("ptt-drafts"), false, "its drafts (they carry unit costs)");
  assert.deepEqual(["ptt.keptPlans.v1", "ptt.recent.v1", "dcr2-takeoff-users"].map((k) => DEV.store.getItem(k)), [null, null, null]);
  assert.equal(DEV.store.getItem("ptt.settings.v1"), "{}", "its settings stay");
});

test("a turned-off account's purge also finds a person who only opened the takeoff app here (sb.js forgetSavedPlans); the 📐 pages ask for it", () => {
  const sbjs = read("js/sb.js");
  assert.match(sbjs, /users = JSON\.parse\(localStorage\.getItem\("dcr2-takeoff-users"\) \|\| "\[\]"\);/);
  assert.match(sbjs, /if \(!id \|\| \(owners\.indexOf\(id\) === -1 && users\.indexOf\(id\) === -1\)\) return;/);
  assert.match(read("js/pages/plan-buttons.js"), /\["dcr2-plan-owners", "dcr2-takeoff-users"\]\.forEach/);
  assert.match(read("js/plan-library.js"), /if \(o\.fresh && tracesHere\(who\)\) tellPurge\(await purgeOwner\(who\)\);/);
  assert.match(read("js/plan-library.js"), /return !!who && \(ownersHere\(\)\.indexOf\(who\) !== -1 \|\| takeoffUsers\(\)\.indexOf\(who\) !== -1\);/);
});

/* ── round A of the review (2026-11-04): the purge's reach and words, the e-mail hint of the takeoff app's people ── */

const HINTS = ["dcr2-plan-owners", "dcr2-plan-owner-mail", "dcr2-takeoff-users", "ptt.recent.v1", "ptt.keptPlans.v1"];
/** A clean set of hints, and no takeoff-app database on the made-up phone. */
function freshHints() {
  HINTS.forEach((k) => DEV.store.removeItem(k));
  DEV.idb.dbs.delete("ptt-drafts");
  DEV.idb.dbs.delete("ptt-plans-archive");
}
/** A draft of the takeoff app's in ptt-drafts (its connection closed again, as when its frame closed). */
function putDraft(key, value) {
  return new Promise((done) => {
    const r = DEV.idb.open("ptt-drafts", 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("drafts")) r.result.createObjectStore("drafts"); };
    r.onsuccess = () => { const t = r.result.transaction("drafts", "readwrite"); t.objectStore("drafts").put(value, key); t.oncomplete = () => { r.result.close(); done(); }; };
  });
}
const signedIn = (id, email) => DEV.store.setItem("dcr2-auth", JSON.stringify({ user: { id, email: email || id + "@example.test" } }));

test("a purge for a person with no trace here takes nothing of anyone's - the takeoff app's stores and the other people's ids stay; for a person who opened the app here they go (PRICE-2)", async () => {
  await devicePlan();                                        // u1's plan, saved here
  saveWorld();
  freshHints();
  // A, a price person, worked in the frame here and left unsaved work: only the takeoff app's draft has it
  await putDraft("A900 Bid.takeoff|1500", { by: "A", items: [{ unit_cost: 4.25 }] });
  DEV.store.setItem("dcr2-takeoff-users", JSON.stringify(["uA"]));
  DEV.store.setItem("ptt.recent.v1", "[\"A900 Bid.takeoff\"]");
  // B (no prices, never saved a plan here, never opened the app) reaches the Plans Library page: B's own purge
  signedIn("uB");
  assert.equal(LIB.tracesHere("uB"), false, "nothing of B's here");
  assert.deepEqual(await LIB.purgeOwner("uB"), { plans: 0, unsent: 0, takeoff: false });
  await LIB.maybeCheck({ id: "uB", role: "lead", active: true, can_see_prices: false }, { fresh: true });
  assert.deepEqual(DEV.idb.rows("ptt-drafts", "drafts"), [{ by: "A", items: [{ unit_cost: 4.25 }] }], "A's unsaved work stays");
  assert.deepEqual([DEV.store.getItem("dcr2-takeoff-users"), DEV.store.getItem("ptt.recent.v1")], ["[\"uA\"]", "[\"A900 Bid.takeoff\"]"], "A's id and the app's own keys stay");
  assert.ok(ROW(), "u1's plan is u1's: untouched");
  // the page asks the same before it purges
  assert.match(read("js/pages/plans-library.js"), /if \(fresh && L\.supported\(\) && L\.tracesHere\(L\.owner\(\)\)\) \{ try \{ gone = await L\.purgeOwner\(L\.owner\(\)\); \}/);
  // A, once A's Sees prices is turned off: A opened the app here, so its stores go (everyone's: the device's)
  signedIn("uA");
  assert.equal(LIB.tracesHere("uA"), true);
  assert.deepEqual(await LIB.purgeOwner("uA"), { plans: 0, unsent: 0, takeoff: "removed" });
  assert.deepEqual([DEV.idb.dbs.has("ptt-drafts"), DEV.store.getItem("dcr2-takeoff-users"), DEV.store.getItem("ptt.recent.v1")], [false, null, null]);
  signedIn("u1", "made-up@example.test");
});

test("a person who only opened the takeoff app in the frame here (no plan kept, say a device with no room: online) is found by e-mail when a turned-off account's sign-in is refused - their drafts go (PRICE-3)", async () => {
  const { planOwnerFor, forgetSavedPlans } = await import("../site/js/sb.js");
  await devicePlan();
  saveWorld();
  freshHints();
  DEV.idb.dbs.get("dcr2-plan-library").stores.get("plans").data.clear();      // nothing of u1's saved here
  signedIn("u1", "Made-Up@Example.test");
  // opened online in the frame (no room to keep it): nothing saved, but the app's drafts may now carry u1's prices
  const said = [];
  LIB.openOnline("7", "A900", { id: F1.id }, (r) => said.push(r), { title: F1.name });
  assert.deepEqual(JSON.parse(DEV.store.getItem("dcr2-takeoff-users")), ["u1"]);
  await putDraft("A900 Bid.takeoff|1500", { items: [{ unit_cost: 9.5 }] });
  assert.equal(planOwnerFor(" made-up@example.TEST "), "u1", "the e-mail hint names them");
  // a page with no plans of theirs mends the hints (noteOwner(u1, false)): kept while they are on the takeoff app's list
  await LIB.maybeCheck({ id: "u1", role: "manager", active: true, can_see_prices: true }, {});
  assert.equal(planOwnerFor("made-up@example.test"), "u1");
  // and the same from a plan opened from the device (open(): the frame)
  freshHints();
  LIB.open(F1.id, () => {}, { title: F1.name });
  assert.equal(planOwnerFor("made-up@example.test"), "u1");
  await putDraft("A900 Bid.takeoff|1500", { items: [{ unit_cost: 9.5 }] });
  // the account is turned off and its session has lapsed: the refused sign-in (user_banned) finds whose they were
  await forgetSavedPlans(planOwnerFor("made-up@example.test"));
  assert.equal(DEV.idb.dbs.has("ptt-drafts"), false, "the drafts with u1's prices went");
  assert.deepEqual([DEV.store.getItem("dcr2-takeoff-users"), planOwnerFor("made-up@example.test")], [null, null], "and the hints with them");
  signedIn("u1", "made-up@example.test");
});

test("the purge's words (LW-4): the plans, the saves not yet in OneDrive deleted with them, the takeoff app's own - said on the page that purged (a toast on Search, a project, home; the Plans Library's own)", async () => {
  assert.equal(lib.purgeText(null), "");
  assert.equal(lib.purgeText({ plans: 0, unsent: 0, takeoff: false }, "iPad"), "");
  assert.equal(lib.purgeText({ plans: 2, unsent: 1, takeoff: "removed" }, "iPad"), "Your account no longer sees prices, so the 2 plans you had saved on this iPad were removed from it. " +
    "1 save of yours that was not in OneDrive yet was deleted with them. What the takeoff app kept on this iPad (unsaved work, kept plans) was removed too.");
  // ...and only what really went (contract addendum 3 D8): a delete still waiting for the app, or one that failed
  assert.equal(lib.purgeText({ plans: 2, unsent: 0, takeoff: "waiting" }, "iPad"), "Your account no longer sees prices, so the 2 plans you had saved on this iPad were removed from it. " +
    "What the takeoff app kept on this iPad (unsaved work, kept plans) is removed once the takeoff app closes.");
  assert.equal(lib.purgeText({ plans: 1, unsent: 0, takeoff: "failed" }, "iPad"), "Your account no longer sees prices, so the 1 plan you had saved on this iPad was removed from it. " +
    "What the takeoff app kept on this iPad (unsaved work, kept plans) could not be removed now - the next online page tries again.");
  assert.equal(lib.purgeText({ plans: 0, unsent: 0, takeoff: "waiting" }, "iPad"), "Your account no longer sees prices, so what the takeoff app kept on this iPad (unsaved work, kept plans) is removed once the takeoff app closes.");
  assert.equal(lib.purgeText({ plans: 0, unsent: 0, takeoff: "failed" }), "Your account no longer sees prices, so what the takeoff app kept on this device (unsaved work, kept plans) could not be removed now - the next online page tries again.");
  assert.equal(lib.purgeText({ plans: 0, unsent: 0, takeoff: true }, "iPad"), "", "only the three words of how it went count");
  assert.equal(lib.purgeText({ plans: 1, unsent: 1, takeoff: false }), "Your account no longer sees prices, so the 1 plan you had saved on this device was removed from it. " +
    "1 save of yours that was not in OneDrive yet was deleted with it.");
  assert.equal(lib.purgeText({ plans: 3, unsent: 2, takeoff: false }, "iPhone").split(". ")[1], "2 saves of yours that were not in OneDrive yet were deleted with them.");
  assert.equal(lib.purgeText({ plans: 0, unsent: 0, takeoff: "removed" }, "iPad"), "Your account no longer sees prices, so what the takeoff app kept on this iPad (unsaved work, kept plans) was removed.");
  // the made-up phone: a save waiting here, then Sees prices taken away (a page that read the profile online)
  await devicePlan();
  saveWorld();
  freshHints();
  DEV.nav.onLine = false;
  await (await LIB.keepSave(F1.id, saveOf(savedProject(4096)))).sent;
  DEV.nav.onLine = true;
  DEV.store.setItem("dcr2-takeoff-users", JSON.stringify(["u1"]));
  const toasts = [];
  globalThis.DCR2 = { toast: (t, o) => toasts.push([t, o && o.kind]) };
  try {
    await LIB.maybeCheck({ id: "u1", role: "manager", active: true, can_see_prices: false }, { fresh: true });
  } finally { delete globalThis.DCR2; }
  assert.deepEqual(toasts, [["Your account no longer sees prices, so the 1 plan you had saved on this iPad was removed from it. 1 save of yours that was not in " +
    "OneDrive yet was deleted with it. What the takeoff app kept on this iPad (unsaved work, kept plans) was removed too.", "warn"]]);
  // the broker's own refusal (plans_list 403: the check of a page whose profile was older) says what went too
  const refused = async () => {
    await devicePlan();
    freshHints();
    DEV.nav.onLine = false;
    await (await LIB.keepSave(F1.id, saveOf(savedProject(4096)))).sent;
    DEV.nav.onLine = true;
    useClient({ functions: { invoke: async (name, x) => (x.body.op === "plans_list" ? http(403, { error: "forbidden", message: "made up" }) : http(400, { error: "invalid" })) } });
  };
  await refused();
  toasts.length = 0;
  globalThis.DCR2 = { toast: (t, o) => toasts.push([t, o && o.kind]) };
  try {
    await LIB.maybeCheck({ id: "u1", role: "manager", active: true, can_see_prices: true }, { force: true });
  } finally { delete globalThis.DCR2; }
  assert.deepEqual([toasts, PLANS().length], [[[lib.purgeText({ plans: 1, unsent: 1, takeoff: false }, "iPad"), "warn"]], 0], "said on the page whose check it was");
  await refused();
  const s = await LIB.checkUpdates();
  assert.deepEqual([s.revoked, s.purged], [1, { plans: 1, unsent: 1, takeoff: false }]);
  assert.match(read("js/pages/plans-library.js"), /say\(purgeText\(s\.purged, deviceWord\(window\)\) \|\|/);
  assert.match(read("js/pages/plans-library.js"), /const said = purgeText\(gone, deviceWord\(window\)\);/);
});

test("the purge's takeoff app part (contract addendum 3 D8): also for an owner with plans here when stores that only /takeoff/ as a page of its own writes are here (its kept plans, their index, its Plans Archive) - never for a person with no trace here - and it says how it went: removed, waiting for the app to close, or failed (the next page asks again)", async () => {
  const archive = () => new Promise((done) => { const r = DEV.idb.open("ptt-plans-archive", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => { r.result.close(); done(); }; });
  const stores = () => [DEV.idb.dbs.has("ptt-drafts"), DEV.idb.dbs.has("ptt-plans-archive"), DEV.fs.root.entries.has("plans-kept"), DEV.store.getItem("ptt.keptPlans.v1")];
  // u1 keeps a plan here and never opened the frame here (not on the takeoff app's list); no standalone store: the
  // takeoff app's drafts (the frame's: anyone's work) are not u1's to take
  await devicePlan();
  freshHints();
  await putDraft("A900 Bid.takeoff|1500|@someoneELSE1", { by: "frame" });
  assert.deepEqual(await LIB.purgeOwner("u1"), { plans: 1, unsent: 0, takeoff: false });
  assert.equal(DEV.idb.rows("ptt-drafts", "drafts").length, 1, "no store of a standalone /takeoff/ here: the drafts stay");
  // each such store alone is enough: the kept plans' index, their folder, the Plans Archive's database (asked of
  // indexedDB.databases(), never opened)
  for (const kind of ["index", "folder", "archive"]) {
    await devicePlan();
    freshHints();
    await putDraft("A900 Bid.takeoff|1500", { items: [{ unit_cost: 4.25 }] });
    if (kind === "index") DEV.store.setItem("ptt.keptPlans.v1", JSON.stringify({ v: 1, entries: [] }));
    if (kind === "folder") await DEV.fs.root.getDirectoryHandle("plans-kept", { create: true });
    if (kind === "archive") await archive();
    assert.deepEqual(await LIB.purgeOwner("u1"), { plans: 1, unsent: 0, takeoff: "removed" }, kind);
    assert.deepEqual(stores(), [false, false, false, null], kind);
    assert.equal(DEV.store.getItem("dcr2-takeoff-users"), null, kind + ": all gone, nobody left on the list");
  }
  // a person with no trace here: never, whatever is here
  await devicePlan();
  freshHints();
  await putDraft("A900 Bid.takeoff|1500", { items: [{ unit_cost: 4.25 }] });
  DEV.store.setItem("ptt.keptPlans.v1", "{}");
  await archive();
  assert.deepEqual(await LIB.purgeOwner("uZ"), { plans: 0, unsent: 0, takeoff: false });
  assert.deepEqual(stores(), [true, true, false, "{}"], "nothing of anyone's taken");
  // waiting: the takeoff app holds its drafts open (a frame of another window) - said so, and u1 stays on the takeoff
  // app's list, so the next online page asks again (the plans, u1's other trace, are gone)
  const held = await new Promise((done) => { const r = DEV.idb.open("ptt-drafts", 1); r.onsuccess = () => done(r.result); });
  const w = await LIB.purgeOwner("u1");
  assert.deepEqual(w, { plans: 1, unsent: 0, takeoff: "waiting" });
  assert.match(lib.purgeText(w, "iPad"), /is removed once the takeoff app closes.$/);
  assert.deepEqual([LIB.tracesHere("u1"), DEV.store.getItem("dcr2-takeoff-users")], [true, "[\"u1\"]"]);
  held.close();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(DEV.idb.dbs.has("ptt-drafts"), false, "the queued delete ran once the app let go");
  assert.deepEqual(await LIB.purgeOwner("u1"), { plans: 0, unsent: 0, takeoff: "removed" }, "the next page: the rest goes");
  assert.equal(LIB.tracesHere("u1"), false);
  // failed: the kept plans' folder would not go - said so, and asked again next time
  await devicePlan();
  freshHints();
  await DEV.fs.root.getDirectoryHandle("plans-kept", { create: true });
  const rm = DEV.fs.root.removeEntry;
  DEV.fs.root.removeEntry = async function (n, o) {
    if (n === "plans-kept") throw Object.assign(new Error("made up"), { name: "InvalidStateError" });
    return rm.call(this, n, o);
  };
  try {
    const f = await LIB.purgeOwner("u1");
    assert.deepEqual(f, { plans: 1, unsent: 0, takeoff: "failed" });
    assert.match(lib.purgeText(f, "iPad"), /could not be removed now - the next online page tries again.$/);
    assert.equal(LIB.tracesHere("u1"), true, "the next page asks again");
  } finally { DEV.fs.root.removeEntry = rm; }
  assert.deepEqual(await LIB.purgeOwner("u1"), { plans: 0, unsent: 0, takeoff: "removed" });
  // the header no longer says "only for a person on USERS_KEY"
  assert.match(read("js/takeoff-stores.js"), /standaloneStores: "ptt\.keptPlans\.v1", the "plans-kept"\s+folder, "ptt-plans-archive"/);
});

/** A second portal window on the made-up phone: the library's module again, with its own state (its own spooling,
    sending, jobs), the same storage and Web Locks. */
let LIB2 = null;
async function window2() {
  await device();                                            // the made-up phone first: the module reads it at its import
  if (!LIB2) LIB2 = await import("../site/js/plan-library.js?window2");
  assert.equal(LIB2.supported(), true, "window 2 sees the made-up phone");
  return LIB2;
}

test("two openings of one plan (two windows or tabs): a Save never supersedes the other opening's save waiting here - it is refused in plain words, so its app keeps its draft (LW-1)", async () => {
  const W2 = await window2();
  const before = await devicePlan();
  saveWorld();
  DEV.nav.onLine = false;                                    // kept, not sent: the saves wait here
  const lineA = { file: before.file, base: "qx:AAA" };       // what open() hands each opening
  const lineB = { file: before.file, base: "qx:AAA" };
  const oA = await LIB.keepSave(F1.id, saveOf(savedProject(2 * MiB + 1, "PDFCACHE1", 3)), null, lineA);
  assert.equal(oA.state, "kept");
  await oA.sent;
  const fileA = ROW().local.file;
  const names = Object.keys(LIBFILES()).sort();
  // B (another window) saves work that has none of A's: refused, A's save untouched, nothing of B's left
  const oB = await W2.keepSave(F1.id, { req: "sBBBBBBBBB", name: F1.name, size: 2 * MiB + 7, file: savedProject(2 * MiB + 7, "PDFCACHE1", 9).blob }, null, lineB);
  assert.equal(oB.state, "refused");
  // one plain clause (contract addendum 3 D7): the app says it in its own words - "Not saved: the portal did not take
  // this save (<why>). Your changes are still in this window - use Save a copy to Files to keep them." - so the why
  // gives no advice of its own, and never says that opening the plan again brings these changes back
  assert.equal(oB.why, "this plan has a save from another window or tab on this iPad that is not in OneDrive yet");
  assert.ok(!/Save a copy|again|reopen|offer|back/i.test(oB.why), "no promise, no advice of its own");
  const { portalRefusedWords } = await import("../site/takeoff/js/core/save-route.js");
  assert.equal(portalRefusedWords({ portalWhy: oB.why, dirty: true }), "Not saved: the portal did not take this save (this plan has a save from another " +
    "window or tab on this iPad that is not in OneDrive yet). Your changes are still in this window - use Save a copy to Files to keep them.",
    "what the vendored takeoff app says with it: one sentence of the portal's, inside the app's, no promise");
  assert.ok(oB.why.length <= 300, "whole in the app's answer");
  assert.deepEqual([ROW().local.file, !!LIBFILES()[fileA], Object.keys(LIBFILES()).sort(), lineB.file], [fileA, true, names, before.file]);
  // A's own next Save goes on (its line is its save now)
  const oA2 = await LIB.keepSave(F1.id, { req: "sCCCCCCCCC", name: F1.name, size: 2 * MiB + 3, file: savedProject(2 * MiB + 3, "PDFCACHE1", 4).blob }, null, lineA);
  assert.equal(oA2.state, "kept");
  await oA2.sent;
  assert.equal(ROW().local.file, lineA.file);
  // the other way round: C opened after A's save (handed it), A saved again meanwhile - C's Save is refused too
  const lineC = { file: ROW().local.file, base: "qx:AAA" };
  const oA3 = await LIB.keepSave(F1.id, { req: "sDDDDDDDDD", name: F1.name, size: 1 * MiB + 1, file: savedProject(1 * MiB + 1, "PDFCACHE1", 5).blob }, null, lineA);
  await oA3.sent;
  const oC = await W2.keepSave(F1.id, { req: "sEEEEEEEEE", name: F1.name, size: 1 * MiB + 2, file: savedProject(1 * MiB + 2, "PDFCACHE1", 6).blob }, null, lineC);
  assert.deepEqual([oC.state, ROW().local.file], ["refused", lineA.file]);
  // both at once, before either was kept: the one whose record write comes second is refused there (its copy removed)
  const fresh = await devicePlan();
  saveWorld();
  DEV.nav.onLine = false;
  const l1 = { file: fresh.file, base: "qx:AAA" }, l2 = { file: fresh.file, base: "qx:AAA" };
  const [o1, o2] = await Promise.all([
    LIB.keepSave(F1.id, { req: "sFFFFFFFFF", name: F1.name, size: 3 * MiB + 1, file: savedProject(3 * MiB + 1, "PDFCACHE1", 7).blob }, null, l1),
    W2.keepSave(F1.id, { req: "sGGGGGGGGG", name: F1.name, size: 3 * MiB + 2, file: savedProject(3 * MiB + 2, "PDFCACHE1", 8).blob }, null, l2)]);
  assert.deepEqual([o1.state, o2.state], ["kept", "refused"]);
  assert.deepEqual([ROW().local.file, Object.keys(LIBFILES()).sort()], [l1.file, [fresh.file, l1.file].sort()], "the refused one left nothing behind");
  await o1.sent;
});

test("one passing error of the storage's never loses a save: only a file the storage says is not there counts, and a sweep keeps it until a later check confirms - or brings it back (LW-2)", async () => {
  await devicePlan();
  saveWorld();
  DEV.nav.onLine = false;
  const o = await LIB.keepSave(F1.id, saveOf(savedProject(1 * MiB + 5)));
  await o.sent;
  const f = ROW().local.file;
  const d = await DEV.fs.root.getDirectoryHandle("plan-library");
  const once = (name) => {
    d.getFileHandle = async (n, opt) => {
      if (n === f) { delete d.getFileHandle; throw Object.assign(new Error("made up"), { name }); }
      return DEV.fs.DirHandle.prototype.getFileHandle.call(d, n, opt);
    };
  };
  // WebKit's passing UnknownError at a check: nothing is decided, the sweep keeps the save
  once("UnknownError");
  await LIB.verifyFiles();
  assert.equal(ROW().local && ROW().local.file, f, "a passing error decides nothing");
  await LIB.sweep();
  assert.ok(LIBFILES()[f], "and the sweep keeps it");
  // the same at a send: not sent, not lost - it waits, and goes again after its wait
  DEV.nav.onLine = true;
  once("InvalidStateError");
  await assert.rejects(LIB.sendSaved(F1.id, { manual: true }), (e) => e.code === "storage");
  assert.deepEqual([ROW().local.file, ROW().local.state, ROW().local.code], [f, "failed", "storage"]);
  assert.match(ROW().local.error, /storage did not answer/);
  DEV.nav.onLine = false;
  // a NotFoundError at one check while the file is there after all: marked lost - but kept from every sweep, and the
  // next check finds it: the save is the record's again
  once("NotFoundError");
  await LIB.verifyFiles();
  assert.deepEqual([ROW().local, ROW().sent.mode, ROW().sent.was.file], [null, "lost", f]);
  assert.deepEqual((await LIB.list())[0].save, { state: "lost" });
  await LIB.sweep();
  assert.ok(LIBFILES()[f], "a sweep keeps a save found lost only once");
  await LIB.verifyFiles();
  assert.deepEqual([ROW().local && ROW().local.file, ROW().sent], [f, null], "found again: the save is back");
  // really gone: lost at one check, confirmed at the next (the note stays, without the save)
  d.entries.delete(f);
  await LIB.verifyFiles();
  assert.equal(ROW().sent.was.file, f);
  await LIB.verifyFiles();
  assert.deepEqual([ROW().local, Object.keys(ROW().sent).sort()], [null, ["at", "mode"]]);
  assert.equal(lib.lostSave(ROW()), null);
  assert.ok(lib.keepSet([{ sent: { mode: "lost", at: AT, was: { file: SAVE, size: 9 } } }], {}, NOW).has(SAVE), "keepSet keeps a save found lost once");
});

test("no sweep of another window ever takes a save being kept: its record is written under the spool's lock, and a sweep lists the files before it reads the records (LW-3)", async () => {
  const W2 = await window2();
  await devicePlan();
  saveWorld();
  DEV.nav.onLine = false;
  // window 2's sweep (its 5-minute check) right after this window's spool lock is let go
  const realReq = DEV.locks.request;
  let swept = false;
  DEV.locks.request = async function (name, o, cb) {
    const out = await realReq.call(DEV.locks, name, o, cb);
    if (!swept && String(name).indexOf("dcr2-plan-sp:") === 0) { swept = true; await W2.sweep(); }
    return out;
  };
  let o;
  try { o = await LIB.keepSave(F1.id, saveOf(savedProject(1 * MiB + 9))); } finally { DEV.locks.request = realReq; }
  assert.ok(swept);
  assert.equal(o.state, "kept");
  assert.ok(ROW().local && LIBFILES()[ROW().local.file], "the save it was told was kept is on the device");
  await o.sent;
  // window 2's sweep under way while a save is kept here, start to end, between its listing and its look at the records
  await devicePlan();
  saveWorld();
  DEV.nav.onLine = false;
  const d = await DEV.fs.root.getDirectoryHandle("plan-library");
  let o2 = null;
  d.keys = async function* () {
    delete d.keys;
    o2 = await LIB.keepSave(F1.id, saveOf(savedProject(2 * MiB + 9)));
    for (const k of Array.from(d.entries.keys())) yield k;
  };
  await W2.sweep();
  assert.equal(o2 && o2.state, "kept");
  assert.ok(ROW().local && LIBFILES()[ROW().local.file], "kept by that sweep too");
  await o2.sent;
  // and a save whose copy is whole (its worker done, the file let go) but not yet in a record when that sweep's
  // listing ends: the sweep asks again after its listing, sees the spool's lock, and takes nothing
  await devicePlan();
  saveWorld();
  DEV.nav.onLine = false;
  const d3 = await DEV.fs.root.getDirectoryHandle("plan-library");
  const seen = DEV.workers.length;
  let release = null, p3 = null;
  d3.keys = async function* () {
    delete d3.keys;
    p3 = LIB.keepSave(F1.id, saveOf(savedProject(3 * MiB + 9)));
    // the spool's worker: its last word ("spooled": the file whole and let go) held back from the page a while
    for (let i = 0; i < 2000 && !release; i++) {
      const w = DEV.workers.slice(seen).find((x) => typeof x.onmessage === "function" && !x.held);
      if (w) {
        const real = w.onmessage;
        w.held = true;
        w.onmessage = (ev) => { if (ev.data && ev.data.type === "spooled") release = () => real(ev); else real(ev); };
      }
      await new Promise((r) => setTimeout(r, 1));
    }
    assert.ok(release, "the spool reached its last word");
    for (const k of Array.from(d3.entries.keys())) yield k;
  };
  await W2.sweep();
  release();
  const o3 = await p3;
  assert.equal(o3.state, "kept");
  assert.ok(ROW().local && LIBFILES()[ROW().local.file], "the whole copy, not yet in a record during that sweep, is still there");
  await o3.sent;
});

/** A saved project whose `at`-th slice is read only once `open()` is called (or never). */
function heldProject(size, at) {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("PDFCACHE1"));
  let n = 0, go = null;
  const gate = new Promise((r) => { go = r; });
  class Held extends Blob {
    slice(a, b, t) {
      const s = super.slice(a, b, t);
      if (++n === at) return { size: b - a, arrayBuffer: () => gate.then(() => s.arrayBuffer()) };
      return s;
    }
  }
  return { blob: new Held([bytes]), size, open: () => go() };
}
/** The watchdogs short (and a worker's own timers fast) for one test. */
const standIns = [];                                         // stand-in workers of a test (ended after it, whatever happened)
async function quickWatch(fn) {
  const was = Object.assign({}, LIB.WATCH);
  const seen = DEV.workers.length;
  Object.assign(LIB.WATCH, { tick: 20, stall: 400 });
  DEV.workerSpeed = 200;                                     // the worker's 10 s beat: every 50 ms
  try { return await fn(); } finally {
    Object.assign(LIB.WATCH, was);
    DEV.workerSpeed = 1;
    delete globalThis.document;
    DEV.apply();
    // a failed test may leave a worker running: ended, so the file's process can end
    DEV.workers.slice(seen).forEach((w) => { if (!w.terminated) w.terminate(); });
    standIns.splice(0).forEach((w) => w.terminate());
  }
}
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r("still waiting"), ms))]);

test("a slice read that never settles ends the keep after the watchdog's wait - no 'keeping' without bytes moving (the worker's beat and the page's count both follow progress), the copy cut short removed, a Save again kept (LW-6, SPOOL-1)", async () => {
  await devicePlan();
  saveWorld();
  DEV.nav.onLine = false;
  await quickWatch(async () => {
    const start = Object.keys(LIBFILES()).sort();
    const p = heldProject(20 * MiB, 2);                       // the 2nd slice never comes
    const words = [];
    const beats = [];
    // every word the spool's worker says to the page (the made-up phone's worker, its page handler wrapped)
    const Real = globalThis.Worker;
    globalThis.Worker = class extends Real {
      constructor(u) {
        super(u);
        let h = null;
        Object.defineProperty(this, "onmessage", { get: () => h, set: (fn) => { h = typeof fn === "function" ? (ev) => { words.push(ev.data); fn(ev); } : fn; } });
      }
    };
    let got;
    try {
      got = await within(LIB.keepSave(F1.id, { req: "sAAAAAAAAA", name: F1.name, size: p.size, file: p.blob }, (state, x) => beats.push([state, x && x.pct])), 5000);
    } finally { DEV.apply(); }
    assert.notEqual(got, "still waiting", "the keep ended");
    assert.deepEqual([got.state, /stopped responding/.test(got.why)], ["failed", true], JSON.stringify(got));
    const progress = words.filter((m) => m.type === "progress").map((m) => m.done);
    assert.ok(progress.length >= 1 && progress.every((d, i) => i === 0 || d > progress[i - 1]), "the worker spoke only when bytes moved: " + JSON.stringify(progress));
    assert.deepEqual(beats, [["keeping", 40]], "the app heard 'keeping' for the bytes that moved, and nothing during the stall");
    // the ended worker could not tidy its copy: the page did (a re-Save at once has its room)
    assert.deepEqual(Object.keys(LIBFILES()).sort(), start, "no part of the save left on the device");
    assert.equal(ROW().local, undefined);
    const again = await LIB.keepSave(F1.id, saveOf(savedProject(3 * MiB + 1)));
    assert.equal(again.state, "kept", again.why);
    await again.sent;
  });
});

test("a worker that only says it is alive (no bytes moving) is ended all the same: the page counts progress, not words (LW-6)", async () => {
  await devicePlan();
  saveWorld();
  DEV.nav.onLine = false;
  await quickWatch(async () => {
    // a stand-in for the spool's worker: a 'progress' of the same bytes every 30 ms, for ever (and a probe answered)
    class Chatty {
      constructor() { this.onmessage = null; this.t = null; standIns.push(this); }
      postMessage(m) {
        if (m.op === "probe") { setTimeout(() => this.onmessage && this.onmessage({ data: { type: "probe", ok: true } }), 0); return; }
        this.t = setInterval(() => this.onmessage && this.onmessage({ data: { type: "progress", id: m.id, done: 4096 } }), 30);
      }
      terminate() { clearInterval(this.t); }
    }
    globalThis.Worker = Chatty;
    const heard = [];
    let got;
    try {
      got = await within(LIB.keepSave(F1.id, saveOf(savedProject(1 * MiB)), (s, x) => heard.push([s, x && x.pct])), 5000);
    } finally { DEV.apply(); }
    assert.notEqual(got, "still waiting", "ended although the worker kept talking");
    assert.equal(got.state, "failed");
    assert.ok(heard.filter((h) => h[0] === "keeping").length <= 1, "one word for its one move, none for the rest: " + JSON.stringify(heard));
  });
});

test("the watchdogs never count time the page was hidden or asleep: iOS suspends the page, the frame and the worker together - a long switch to another app is no stall (SPOOL-1)", async () => {
  await devicePlan();
  saveWorld();
  DEV.nav.onLine = false;
  await quickWatch(async () => {
    const vis = { visibilityState: "visible" };
    globalThis.document = vis;
    // hidden for well over the watchdog's wait: the keep goes on, and finishes once the bytes move again
    const p = heldProject(20 * MiB, 2);
    const out = LIB.keepSave(F1.id, { req: "sAAAAAAAAA", name: F1.name, size: p.size, file: p.blob });
    await new Promise((r) => setTimeout(r, 60));
    vis.visibilityState = "hidden";
    assert.equal(await within(out, 1300), "still waiting", "not ended while hidden");
    vis.visibilityState = "visible";
    p.open();
    const got = await within(out, 5000);
    assert.equal(got.state, "kept", JSON.stringify(got));
    await got.sent;
    // asleep while "visible" (the page frozen, its timers far overdue when it wakes): not counted either
    const real = Date.now;
    let ahead = 0;
    Date.now = () => real() + ahead;
    try {
      const q = heldProject(20 * MiB, 2);
      const out2 = LIB.keepSave(F1.id, { req: "sBBBBBBBBB", name: F1.name, size: q.size, file: q.blob });
      await new Promise((r) => setTimeout(r, 60));
      ahead += 120000;                                       // two minutes asleep
      assert.equal(await within(out2, 150), "still waiting", "not ended for the time it slept");
      q.open();
      const got2 = await within(out2, 5000);
      assert.equal(got2.state, "kept", JSON.stringify(got2));
      await got2.sent;
    } finally { Date.now = real; }
    // a download's watchdog likewise: a silent worker while hidden is no stall; once in front, it ends as a pause
    await devicePlan();
    const w = saveWorld();
    w.plan.version = "qx:NEWER";                              // a newer version to download
    DEV.nav.onLine = true;
    class Silent {
      constructor() { this.onmessage = null; standIns.push(this); }
      postMessage(m) { if (m.op === "probe") setTimeout(() => this.onmessage && this.onmessage({ data: { type: "probe", ok: true } }), 0); }
      terminate() {}
    }
    globalThis.Worker = Silent;
    try {
      vis.visibilityState = "hidden";
      const dl = LIB.resume(F1.id).then(() => "done", (e) => e.code);
      assert.equal(await within(dl, 1300), "still waiting", "a hidden page's silent download is not ended");
      vis.visibilityState = "visible";
      assert.equal(await within(dl, 3000), "paused", "in front and silent: ended as a pause");
      assert.match(ROW().dl.error, /stopped responding/);
    } finally { DEV.apply(); }
  });
});

test("the frame's copies never pile up (STORE-1): a day's open, save and send leaves one copy once the frame closes; a copy a record still names stays (its note dropped); another window's frame, or a save still being kept, keeps it", async () => {
  const meta = () => (DEV.idb.dbs.get("dcr2-plan-library").stores.get("meta").data.get("handed") || { value: {} }).value;
  const frameOn = (file) => { let close; const closed = new Promise((r) => { close = r; }); const free = LIB.holdForFrame(file, closed); return () => { close(); return free(); }; };
  // three days of: open the plan in the frame, Save, the save sent and adopted, Close
  const before = await devicePlan();
  saveWorld();
  let file = before.file;
  for (let day = 0; day < 3; day++) {
    const shut = frameOn(file);
    const line = { file, base: ROW().version };
    const o = await LIB.keepSave(F1.id, { req: "sDAY" + day + "XXXXX", name: F1.name, size: 1 * MiB + day, file: savedProject(1 * MiB + day, "PDFCACHE1", 20 + day).blob }, null, line);
    assert.equal(o.state, "kept");
    assert.equal((await o.sent).mode, "replace");
    assert.ok(LIBFILES()[file], "the copy the app reads stays while its frame is open");
    await shut();
    assert.equal(LIBFILES()[file], undefined, "day " + day + ": the copy it read went when the frame closed");
    file = ROW().file;
  }
  assert.deepEqual(Object.keys(LIBFILES()), [ROW().file], "one plan, one copy on the device");
  assert.deepEqual(meta(), {}, "nothing kept for a week");
  // a copy a record still names stays when its frame closes, and an old note of it goes (a later retire needs no week)
  const r = ROW();
  DEV.idb.dbs.get("dcr2-plan-library").stores.get("meta").data.set("handed", { key: "handed", value: { [r.file]: new Date().toISOString() } });
  await frameOn(r.file)();
  assert.ok(LIBFILES()[r.file], "the plan's own copy stays");
  assert.deepEqual(meta(), {}, "its note dropped");
  // another window's frame on it: this window's close leaves it (that window's close frees it)
  let release;
  DEV.locks.request("dcr2-plan-rd:" + r.file + "|elsewhere", () => new Promise((go) => { release = go; }));
  await new Promise((res) => setTimeout(res, 5));
  const shut2 = frameOn(r.file);
  await LIB.remove(F1.id);
  await shut2();
  assert.ok(LIBFILES()[r.file], "another window's frame still reads it");
  release();
  await new Promise((res) => setTimeout(res, 5));
  await LIB.sweep();
  assert.equal(LIBFILES()[r.file], undefined, "a sweep takes it once no frame reads it");
  // a save still being kept when the frame closes (its Blob is slices of the handed file): kept until the spool is done
  const b = await devicePlan();
  saveWorld();
  DEV.nav.onLine = false;
  const held = heldProject(20 * MiB, 2);
  const shut3 = frameOn(b.file);
  const keeping = LIB.keepSave(F1.id, { req: "sKEEPXXXXX", name: F1.name, size: held.size, file: held.blob }, null, { file: b.file, base: "qx:AAA" });
  await new Promise((res) => setTimeout(res, 30));
  await LIB.remove(F1.id);                                   // removed meanwhile: nothing names the handed copy now
  await shut3();
  assert.ok(LIBFILES()[b.file], "not removed under a save still being kept");
  held.open();
  await keeping;
  await LIB.sweep();
  assert.equal(LIBFILES()[b.file], undefined, "a sweep takes it after");
});

/* ── the broker protocol of contract addendum 2 (C1b, C3b): the deferred commit, the plan's name, the hash ── */
const UPS = (n) => "https://" + onedrive.ONEDRIVE_HOST + "/up/" + n;

test("a replace the broker commits (addendum 2; review Q3-2, BRK-1): the session names the plan, its last chunk commits nothing, plan_save_commit commits it with the session's own address and the save's hash; the session is kept with the save, never its address", async () => {
  const before = await devicePlan();
  const w = saveWorld({ deferred: true, realHash: true });
  const p = savedProject(3 * MiB + 77, "PDFCACHE1", 3);
  const hash = QX.quickXorHash(p.bytes);
  let sends = null;
  w.during = () => { sends = ROW().local.sends; };               // what the record holds while the save goes up
  const out = await LIB.keepSave(F1.id, saveOf(p));
  const sent = await out.sent;
  assert.deepEqual([sent && sent.sent, sent && sent.mode], [true, "replace"]);
  assert.deepEqual(w.calls, ["plan_save_session", "plan_save_commit"], "the session, then the broker's commit - its answer is the proof");
  assert.deepEqual(w.sessionBody, { op: "plan_save_session", project_id: 7, item_id: F1.id, version: "qx:AAA", size: p.blob.size,
    modified: w.sessionBody.modified, name: F1.name }, "the plan's file name goes with it (the way to it after a desktop save)");
  assert.deepEqual(w.bodies[1], { op: "plan_save_commit", project_id: 7, item_id: F1.id, ticket: "tk1", upload_url: UPS(1), hash },
    "the session's own address and OneDrive's quickXorHash of the save");
  assert.deepEqual([w.bytes, w.plan.version], [p.blob.size, "qx:" + hash], "every byte once; OneDrive holds exactly the save");
  assert.ok(await same(w.saved, p.bytes));
  assert.deepEqual(sends.map((x) => Object.keys(x).sort()), [["at", "commit", "file", "hash", "mode", "name", "size", "ticket"]]);
  assert.deepEqual([sends[0].commit, sends[0].hash, sends[0].ticket], ["broker", hash, "tk1"]);
  assert.ok(!JSON.stringify(PLANS()).includes("/up/"), "the upload address is never stored");
  const r = ROW();
  assert.deepEqual([r.local, r.sent.mode, r.version, r.file !== before.file], [null, "replace", "qx:" + hash, true]);
});

test("an office save that lands WHILE the iPad's replace goes up is never overwritten (Q3-2, BRK-1): the broker commits the same upload as a copy beside it - the plan's record keeps the plan, the person is told; or, Microsoft refusing that (plan_changed), it is sent again at once as a copy against the old base", async () => {
  const before = await devicePlan();
  const w = saveWorld({ deferred: true, realHash: true });
  w.during = () => officeSave(w);
  const p = savedProject(2 * MiB + 5, "PDFCACHE1", 4);
  const news = [];
  const out = await LIB.keepSave(F1.id, saveOf(p), (state, extra) => news.push([state, extra]));
  const sent = await out.sent;
  assert.deepEqual([sent && sent.mode, sent && sent.name], ["copy", "A900 Bid - iPad 2026-11-04 1030.takeoff"]);
  assert.deepEqual([w.calls, w.bytes], [["plan_save_session", "plan_save_commit"], p.blob.size], "the same upload became the copy: nothing sent twice");
  assert.equal(w.plan.version.indexOf("qx:OFFICE"), 0, "the office's save is still the plan");
  const r = ROW();
  assert.deepEqual([r.file, r.version, r.local, r.sent.mode], [before.file, "qx:AAA", null, "copy"], "the plan's record keeps its copy");
  const c = ROW("u1|01FAKECOPY0002");
  assert.ok(c && (await same(new Blob([LIBFILES()[c.file]]), p.bytes)), "the save is the copy's own record");
  assert.deepEqual(news.find((n) => n[0] === "copy"), ["copy", { name: "A900 Bid - iPad 2026-11-04 1030.takeoff", plan: await plans.planWord(c.number, c.folder, c.name) }]);
  // Microsoft would not commit the session as the copy: the broker dropped it (plan_changed, retry copy) - the save goes
  // again at once as a copy, against the version the work was done on, and that copy is checked by plan_save_done
  await devicePlan();
  const w2 = saveWorld({ deferred: true, realHash: true, commitRefuse: true });
  w2.during = () => officeSave(w2);
  const q = savedProject(1 * MiB + 9, "PDFCACHE1", 5);
  const s2 = await (await LIB.keepSave(F1.id, saveOf(q))).sent;
  assert.deepEqual([s2 && s2.mode, w2.calls], ["copy", ["plan_save_session", "plan_save_commit", "plan_save_session", "plan_save_done"]]);
  const second = w2.bodies[2];
  assert.deepEqual([second.mode, second.version, second.item_id, second.name], ["copy", "qx:AAA", F1.id, F1.name], "a copy, the OLD base");
  assert.equal(w2.bodies[3].hash, QX.quickXorHash(q.bytes), "the copy's check carries the hash");
  assert.equal(w2.bytes, 2 * q.blob.size, "sent twice: the replace dropped, then the copy");
  assert.deepEqual([ROW().local, ROW().sent.mode], [null, "copy"]);
});

test("an office desktop save made the plan a NEW item (the old one moved into Backups; review Q3-1, BRK-4): the session's plan name finds it, the save becomes a copy beside it - never a 404 left on the device", async () => {
  const before = await devicePlan();
  const w = saveWorld({ deferred: true, realHash: true });
  // the desktop app moved the item the device has into Backups and put a new item on the name
  Object.assign(w.plan, { id: "01FAKEPLANNEW1", version: "qx:DESKTOP", rev: 9 });
  const p = savedProject(1 * MiB + 1, "PDFCACHE1", 6);
  const news = [];
  const sent = await (await LIB.keepSave(F1.id, saveOf(p), (state, extra) => news.push([state, extra]))).sent;
  assert.deepEqual([sent && sent.mode, sent && sent.name], ["copy", "A900 Bid - iPad 2026-11-04 1030.takeoff"]);
  assert.deepEqual([w.sessionBody.item_id, w.sessionBody.name, w.calls], [F1.id, F1.name, ["plan_save_session", "plan_save_done"]],
    "the old id and the plan's name: a copy session (its last chunk commits it), then its check");
  assert.equal(w.bodies[1].hash, QX.quickXorHash(p.bytes));
  const r = ROW();
  assert.deepEqual([r.file, r.local, r.sent.mode], [before.file, null, "copy"]);
  assert.ok(ROW("u1|01FAKECOPY0001"), "the save is the copy's own record");
  assert.ok(news.some((n) => n[0] === "copy"), "the person is told");
  // without a plan of that name either: final, in plain words (not a resend for ever)
  await devicePlan();
  const w2 = saveWorld({ deferred: true });
  Object.assign(w2.plan, { id: "01FAKEPLANNEW2", name: "Another name.takeoff" });
  await (await LIB.keepSave(F1.id, saveOf(savedProject(4096)))).sent;
  assert.deepEqual([ROW().local.code, lib.dueToSend(ROW(), Date.now() + 365 * 86400000)], ["not_found", false]);
  assert.match(ROW().local.error, /not one file of its name/);
});

test("a commit whose answer was lost (contract addendum 5 G2): its request may still run in the broker, so it is never asked again before the broker's longest run (ANSWER_LOST_MS) - the save waits in plain words, its session kept, the person's Retry waits too - then the commit is asked again (nothing sent again); across pages the save is settled with plan_save_done and its hash (review BRK-3, TICKET-1, LW-7) - and past the broker's 30 days it is found by its hash alone, never sent again as a copy of itself", async () => {
  const timers = new Map();
  let tn = 0;
  LIB.useAgainClock({ set: (fn, ms) => { const id = ++tn; timers.set(id, { fn, ms }); return id; }, clear: (id) => { timers.delete(id); } });
  const settleDown = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 5)); };
  try {
    await devicePlan();
    const w = saveWorld({ deferred: true, realHash: true, loseCommit: true });
    const p = savedProject(2 * MiB + 3, "PDFCACHE1", 7);
    const news = [];
    const first = await (await LIB.keepSave(F1.id, saveOf(p), (state, extra) => news.push([state, extra]))).sent;
    await settleDown();
    assert.equal(first, null, "not sent yet: the commit's answer never came");
    assert.deepEqual([w.calls, w.bytes], [["plan_save_session", "plan_save_commit"], p.blob.size], "asked once - never again at once (the broker may still be committing it)");
    const WORDS = lib.answerLostWords("iPad");
    const l = ROW().local;
    assert.deepEqual([l.state, l.code, l.error, l.fails, Number(l.notSaved) || 0], ["checking", "answer_lost", WORDS, 0, 0], "waits: no failure counted");
    assert.ok(Date.parse(l.sends[0].asking) > 0 && Date.parse(l.sends[0].lost) >= Date.parse(l.sends[0].asking), "the send's marks: asked, and its answer lost");
    const at = Date.parse(l.retryAt) - Date.now();
    assert.ok(at > lib.ANSWER_LOST_MS - 5000 && at <= lib.ANSWER_LOST_MS, "its wait: the broker's longest run (" + at + ")");
    assert.deepEqual(Array.from(timers.values()).map((t) => t.ms), [lib.ANSWER_LOST_MS], "E7's timer then");
    const row = (await LIB.list()).find((x) => x.key === KEY);
    assert.deepEqual([row.save, lib.saveText(row.save, "iPad")], [{ state: "checking", code: "answer_lost" }, WORDS]);
    assert.ok(!news.some((x) => x[0] === "failed"), "the app never hears 'failed': " + JSON.stringify(news));
    // the person's Retry meanwhile: nothing is asked (the wait holds)
    const e = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    await settleDown();
    assert.deepEqual([e && e.code, w.calls.length, ROW().local.code], ["answer_lost", 2, "answer_lost"], "the Retry waits too");
    assert.equal(timers.size, 1, "one timer, for what is left of the wait");
    // the wait over (the marks and the wait as ANSWER_LOST_MS ago): the timer asks again - the same session committed
    // (the broker finds it landed), nothing sent again
    const old = new Date(Date.now() - lib.ANSWER_LOST_MS - 1000).toISOString();
    const st = DEV.idb.dbs.get("dcr2-plan-library").stores.get("plans").data;
    const cur = ROW();
    st.set(KEY, Object.assign({}, cur, { local: Object.assign({}, cur.local, { retryAt: old, sends: cur.local.sends.map((s) => Object.assign({}, s, { asking: old, lost: old })) }) }));
    const [id] = Array.from(timers.keys());
    const t = timers.get(id);
    timers.delete(id);
    t.fn();
    await settleDown();
    assert.deepEqual([w.calls, w.bytes, ROW().local, ROW().sent.mode], [["plan_save_session", "plan_save_commit", "plan_save_commit"], p.blob.size, null, "replace"]);
    assert.equal(news[news.length - 1][0], "sent");
  } finally { LIB.useAgainClock(null); }
  // the page closed after the commit landed: the session is in the save's record (its ticket and hash), OneDrive has it
  const setUp = async (seed) => {
    await devicePlan();
    const w2 = saveWorld({ deferred: true, realHash: true });
    const q = savedProject(1 * MiB + seed, "PDFCACHE1", seed);
    DEV.nav.onLine = false;
    await (await LIB.keepSave(F1.id, saveOf(q))).sent;
    DEV.nav.onLine = true;
    const r = ROW();
    const hash = QX.quickXorHash(q.bytes);
    w2.sessions.set(UPS(99), { mode: "replace", item: F1.id, name: F1.name, size: q.blob.size, done: F1.id, ticket: "tk99", deferred: true, url: UPS(99) });
    Object.assign(w2.plan, { size: q.blob.size, modified: "2026-11-04T19:00:00.000Z", version: "qx:" + hash, rev: 2 });
    const st = DEV.idb.dbs.get("dcr2-plan-library").stores.get("plans").data;
    st.set(KEY, Object.assign({}, r, { local: Object.assign({}, r.local, { sends: [{ file: r.local.file, ticket: "tk99", mode: "replace", name: F1.name,
      size: q.blob.size, at: AT, hash, commit: "broker" }] }) }));
    return { w2, q, r, hash };
  };
  const a = await setUp(11);
  const settled = await LIB.sendSaved(F1.id, { manual: true });
  assert.equal(settled.sent, true);
  assert.deepEqual(a.w2.calls, ["plan_save_done"], "settled with its ticket: no new session, no byte sent again");
  assert.equal(a.w2.bodies[0].hash, a.hash, "and the save's hash");
  assert.deepEqual([ROW().local, ROW().version, ROW().sent.mode], [null, "qx:" + a.hash, "replace"]);
  // the broker no longer takes the ticket (past its 30 days): plans_list's hash of the plan is the save's - adopted as
  // the replace it was; no session, no copy, no word about the office
  const b = await setUp(12);
  b.w2.expired = true;
  const late = await LIB.sendSaved(F1.id, { manual: true });
  assert.deepEqual([late.sent, late.mode, b.w2.calls], [true, "replace", ["plan_save_done", "plans_list"]], JSON.stringify(b.w2.calls));
  assert.deepEqual([ROW().local, ROW().version, ROW().sent.mode, b.w2.files.length], [null, "qx:" + b.hash, "replace", 1]);
  // ...and when OneDrive does not hold those bytes (the commit never happened), the session is over: sent again
  const c = await setUp(13);
  c.w2.expired = true;
  // (an office save of the very same size there: only the hash tells it is not this save - review BRK-2)
  Object.assign(c.w2.plan, { version: "qx:AAA", size: c.q.blob.size, modified: AT, rev: 1 });
  c.w2.sessions.get(UPS(99)).done = null;
  const again = await LIB.sendSaved(F1.id, { manual: true });
  assert.deepEqual([again.sent, again.mode, c.w2.calls], [true, "replace", ["plan_save_done", "plans_list", "plan_save_session", "plan_save_commit"]]);
  assert.deepEqual(ROW().local, null);
});

test("a later page settles a deferred replace only on the broker's version check (the checkers' repair round 2, S1): its answer carries verified - adopted (true; or false: no history to read); none (a broker older than its repair round 2) - never adopted: the save waits, its session kept, at least 30 minutes and never final, in words that never say 'not sent', then adopted once the broker checks it; busy - asked again with the same ticket and hash; a crossing the broker put back (not_saved) - the save goes again as a copy", async () => {
  /** a save whose page closed before its commit's answer: OneDrive holds its bytes as the plan (the last chunk committed
      them over an office save, or the broker's commit did), and its session - the ticket and the hash - is the save's */
  const setUp = async (seed, o) => {
    await devicePlan();
    const w = saveWorld(Object.assign({ deferred: true, realHash: true }, o || {}));
    const q = savedProject(1 * MiB + seed, "PDFCACHE1", seed);
    DEV.nav.onLine = false;
    await (await LIB.keepSave(F1.id, saveOf(q))).sent;
    DEV.nav.onLine = true;
    const r = ROW();
    const hash = QX.quickXorHash(q.bytes);
    w.sessions.set(UPS(99), { mode: "replace", item: F1.id, name: F1.name, size: q.blob.size, done: F1.id, ticket: "tk99", deferred: true, url: UPS(99) });
    Object.assign(w.plan, { size: q.blob.size, modified: "2026-11-04T19:00:00.000Z", version: "qx:" + hash, rev: 2 });
    const st = DEV.idb.dbs.get("dcr2-plan-library").stores.get("plans").data;
    st.set(KEY, Object.assign({}, r, { local: Object.assign({}, r.local, { sends: [{ file: r.local.file, ticket: "tk99", mode: "replace", name: F1.name,
      size: q.blob.size, at: AT, hash, commit: "broker" }] }) }));
    return { w, q, hash };
  };
  const sendsOf = () => (ROW().local.sends || []).map((x) => x.ticket);
  // checked: verified true - the replace it was; verified false (the broker could not read the history) - the same
  for (const v of [true, false]) {
    const a = await setUp(41, { doneVerified: v });
    const out = await LIB.sendSaved(F1.id, { manual: true });
    assert.deepEqual([out.sent, out.mode, a.w.calls], [true, "replace", ["plan_save_done"]], "verified " + v);
    assert.deepEqual([a.w.bodies[0].ticket, a.w.bodies[0].hash], ["tk99", a.hash]);
    assert.deepEqual([ROW().local, ROW().version, ROW().sent.mode], [null, "qx:" + a.hash, "replace"]);
  }
  // an older broker: plan_save_done answers the plan without its check - never taken; nothing sent again, the session kept
  const b = await setUp(42, { doneVerified: null });
  const t0 = Date.now();
  const e = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
  assert.deepEqual([e && e.code, b.w.calls], ["unchecked", ["plan_save_done"]], "no new session, no byte sent again");
  const l = ROW().local;
  assert.deepEqual([l.state, l.code, sendsOf(), ROW().version], ["failed", "unchecked", ["tk99"], "qx:AAA"], "the save waits; the record's version is not moved");
  assert.equal(l.error, lib.uncheckedWords("iPad"));
  assert.ok(Date.parse(l.retryAt) - t0 >= 30 * 60 * 1000, "a long wait");
  assert.deepEqual([lib.dueToSend(ROW(), Date.now() + 29 * 60 * 1000), lib.dueToSend(ROW(), Date.now() + 31 * 60 * 1000)], [false, true], "never final");
  const row = (await LIB.list())[0];
  assert.deepEqual([row.save.final, lib.saveText(row.save, "iPad")], [false, lib.uncheckedWords("iPad")]);
  assert.doesNotMatch(lib.saveText(row.save, "iPad"), /not sent/i, "it was sent: the row never says otherwise");
  // ...once the broker checks it: the same ticket and hash, adopted
  b.w.doneVerified = true;
  const late = await LIB.sendSaved(F1.id, { manual: true });
  assert.deepEqual([late.sent, late.mode, b.w.calls], [true, "replace", ["plan_save_done", "plan_save_done"]]);
  assert.deepEqual([b.w.bodies[1].ticket, b.w.bodies[1].hash], ["tk99", b.hash]);
  assert.deepEqual([ROW().local, ROW().version], [null, "qx:" + b.hash]);
  // the broker's check could not finish (503 busy: OneDrive's hash of the plan not there yet, a restore that did not go
  // through): nothing taken, nothing sent - the next send asks the same again
  const c = await setUp(43);
  c.w.doneQueue.push(http(503, { error: "busy", message: "made up" }));
  const busy = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
  assert.deepEqual([busy && busy.code, c.w.calls, sendsOf(), ROW().version], ["busy", ["plan_save_done"], ["tk99"], "qx:AAA"]);
  const again = await LIB.sendSaved(F1.id, { manual: true });
  assert.deepEqual([again.sent, again.mode, c.w.calls], [true, "replace", ["plan_save_done", "plan_save_done"]]);
  assert.deepEqual([c.w.bodies[1].ticket, c.w.bodies[1].hash], ["tk99", c.hash], "the same body");
  // a crossing: the broker put the office save back and answered not_saved - the session is over, the save goes again
  // against the version the work was done on (the plan's moved): a copy beside it, the plan's record keeps its copy
  const d = await setUp(44);
  d.w.doneQueue.push(() => { Object.assign(d.w.plan, { size: 1507, version: "qx:OFFICE1", modified: "2026-11-04T19:05:00.000Z", rev: 3 });
    return http(409, { error: "not_saved", message: "OneDrive did not get the whole file - send it again." }); });
  const before = ROW().file;
  const copy = await LIB.sendSaved(F1.id, { manual: true });
  assert.deepEqual([copy.sent, copy.mode, d.w.calls], [true, "copy", ["plan_save_done", "plan_save_session", "plan_save_done"]]);
  assert.deepEqual([d.w.bodies[1].version, d.w.bodies[1].item_id], ["qx:AAA", F1.id], "the old base: the broker makes it a copy");
  assert.equal(d.w.plan.version, "qx:OFFICE1", "the office save is the plan");
  assert.deepEqual([ROW().file, ROW().local, ROW().sent.mode], [before, null, "copy"]);
  const cr = PLANS().find((x) => x.key !== KEY);
  assert.ok(cr && (await same(new Blob([LIBFILES()[cr.file]]), d.q.bytes)), "the save is the copy's own record");
  // the rule itself: only a deferred replace's send found as the replace
  const send = { commit: "broker", mode: "replace" };
  assert.deepEqual([
    lib.uncheckedReplace(send, { mode: "replace" }), lib.uncheckedReplace(send, { mode: "replace", verified: "true" }),
    lib.uncheckedReplace(send, { mode: "replace", verified: true }), lib.uncheckedReplace(send, { mode: "replace", verified: false }),
    lib.uncheckedReplace(send, { mode: "copy" }), lib.uncheckedReplace({ mode: "replace" }, { mode: "replace" }),
    lib.uncheckedReplace({ commit: "broker", mode: "copy" }, { mode: "replace" }), lib.uncheckedReplace(null, { mode: "replace" }), lib.uncheckedReplace(send, null),
  ], [true, true, false, false, false, false, false, false, false]);
});

test("a byte-identical re-save is saved, never a loop (review BRK-5): the hash is the proof; and OneDrive saying not_saved twice, or the broker refusing what it was sent (invalid), waits for the person - never the whole plan again by itself", async () => {
  await devicePlan();
  const w = saveWorld({ deferred: true, realHash: true });
  const p = savedProject(1 * MiB + 21, "PDFCACHE1", 8);
  const line = { file: ROW().file, base: "qx:AAA" };
  assert.equal((await (await LIB.keepSave(F1.id, saveOf(p), null, line)).sent).mode, "replace");
  const v1 = ROW().version;
  w.calls.length = 0;
  // Save again with nothing changed: the same bytes
  const again = { req: "sBBBBBBBBB", name: F1.name, size: p.blob.size, file: new Blob([p.bytes]) };
  const s2 = await (await LIB.keepSave(F1.id, again, null, line)).sent;
  assert.deepEqual([s2 && s2.sent, s2 && s2.mode, w.calls, ROW().version, ROW().local], [true, "replace", ["plan_save_session", "plan_save_commit"], v1, null],
    "a replace onto its own bytes, saved once");
  assert.equal(w.files.length, 1, "no copy");
  // OneDrive says not_saved: sent again after its wait - once; the second not_saved waits for the person
  await devicePlan();
  const w2 = saveWorld({ deferred: true, realHash: true, notSaved: true });
  await (await LIB.keepSave(F1.id, saveOf(savedProject(4096, "PDFCACHE1", 9)))).sent;
  assert.deepEqual([ROW().local.code, ROW().local.notSaved, lib.dueToSend(ROW(), Date.now() + 365 * 86400000)], ["not_saved", 1, true]);
  const st = DEV.idb.dbs.get("dcr2-plan-library").stores.get("plans").data;
  st.set(KEY, Object.assign({}, ROW(), { local: Object.assign({}, ROW().local, { retryAt: new Date(Date.now() - 1000).toISOString() }) }));
  await LIB.sendWaiting();
  assert.equal(w2.calls.filter((c) => c === "plan_save_session").length, 2, "sent once more by itself");
  assert.deepEqual([ROW().local.notSaved, lib.dueToSend(ROW(), Date.now() + 365 * 86400000), (await LIB.list())[0].save.final], [2, false, true],
    "then it waits for the person's Retry");
  st.set(KEY, Object.assign({}, ROW(), { local: Object.assign({}, ROW().local, { retryAt: new Date(Date.now() - 1000).toISOString() }) }));
  await LIB.sendWaiting();
  assert.equal(w2.calls.filter((c) => c === "plan_save_session").length, 2, "never again by itself");
  // a 400 from the broker (a name or a field it does not take): final at once
  await devicePlan();
  saveWorld({ refuse: [400, "invalid"] });
  await (await LIB.keepSave(F1.id, saveOf(savedProject(4096)))).sent;
  assert.deepEqual([ROW().local.code, lib.dueToSend(ROW(), Date.now() + 365 * 86400000)], ["invalid", false]);
});

test("the save-back rules (addendum 3 D1, D6): the broker's switch off (save_back_off) and a broker not deployed yet (not_deployed) wait at least 30 minutes, and are never final", () => {
  assert.deepEqual([lib.LONG_WAIT_MS, lib.LONG_WAIT.slice().sort()], [30 * 60 * 1000, ["need_hash", "not_deployed", "save_back_off", "unchecked"]]);
  assert.deepEqual([1, 2, 3, 9].map((n) => lib.sendWaitMs("save_back_off", n)), [30, 30, 30, 360].map((m) => m * 60000), "at least 30 min, then the backoff's");
  assert.deepEqual([1, 9].map((n) => lib.sendWaitMs("not_deployed", n)), [30, 360].map((m) => m * 60000));
  assert.deepEqual([1, 2].map((n) => lib.sendWaitMs("busy", n)), [5, 10].map((m) => m * 60000), "any other code: the backoff's");
  const l = (over) => ({ local: Object.assign({ file: "p1-x-2.takeoff", state: "failed", retryAt: null }, over) });
  assert.deepEqual(["save_back_off", "not_deployed"].map((code) => lib.dueToSend(l({ code, fails: 40 }), NOW)), [true, true], "never final");
  assert.deepEqual(["save_back_off", "not_deployed"].map((code) => lib.saveStateOf(l({ code, error: "x" }), null, NOW).final), [false, false]);
});

test("the broker's switch turned off after a save was kept (503 save_back_off, addendum 3 D1), and a broker older than this page (400 invalid for the field op, D6): the save waits on the device - at least 30 minutes, never final, the row in plain words - and goes once the broker takes it", async () => {
  for (const [refuse, field, code, words] of [[[503, "save_back_off"], null, "save_back_off", "Saving back to OneDrive is turned off for now - this save waits on this iPad."],
    [[400, "invalid"], "op", "not_deployed", "The portal's OneDrive connection does not take plan saves yet. The save stays on this iPad and is sent later."]]) {
    await devicePlan();
    const w = saveWorld({ deferred: true, realHash: true, refuse, refuseField: field });
    const t0 = Date.now();
    await (await LIB.keepSave(F1.id, saveOf(savedProject(4096, "PDFCACHE1", 31)))).sent;
    const l = ROW().local;
    assert.deepEqual([l.code, l.error, l.state], [code, words, "failed"], code);
    assert.deepEqual(w.calls, ["plan_save_session"], code + ": asked once in the page (no retry loop), nothing sent");
    assert.ok(Date.parse(l.retryAt) - t0 >= 30 * 60 * 1000, code + ": a long wait");
    assert.equal(lib.dueToSend(ROW(), Date.now() + 29 * 60 * 1000), false, code + ": not before it");
    assert.equal(lib.dueToSend(ROW(), Date.now() + 31 * 60 * 1000), true, code + ": never final - it goes again by itself");
    const row = (await LIB.list())[0];
    assert.equal(row.save.final, false);
    if (code === "save_back_off") assert.equal(lib.saveText(row.save, "iPad"), words, "the row says it waits");
    // the switch on again (the broker deployed): the person's Retry, or the wait over, sends it
    w.refuse = null;
    const out = await LIB.sendSaved(F1.id, { manual: true });
    assert.deepEqual([out.sent, out.mode, ROW().local], [true, "replace", null], code);
  }
});

test("OneDrive ignoring the deferral (addendum 3 D3): a last chunk that answers 200 with the file is never adopted - the broker is asked to check it (plan_save_commit with landed: true); a session found gone after its last chunk is asked of the broker too, never of plan_save_done", async () => {
  await devicePlan();
  const w = saveWorld({ deferred: true, realHash: true, landAtChunk: true });
  const p = savedProject(2 * MiB + 13, "PDFCACHE1", 32);
  const sent = await (await LIB.keepSave(F1.id, saveOf(p))).sent;
  assert.deepEqual([sent && sent.sent, sent && sent.mode], [true, "replace"]);
  assert.deepEqual(w.calls, ["plan_save_session", "plan_save_commit"], "the broker's check, never plan_save_done");
  assert.deepEqual(w.bodies[1], { op: "plan_save_commit", project_id: 7, item_id: F1.id, ticket: "tk1", upload_url: UPS(1), hash: QX.quickXorHash(p.bytes), landed: true });
  // the last chunk's answer lost, the session gone: the broker settles and checks it (no landed: it cannot be known)
  await devicePlan();
  const w2 = saveWorld({ deferred: true, realHash: true, landAtChunk: true, loseFinal: true });
  const q = savedProject(1 * MiB + 17, "PDFCACHE1", 33);
  const s2 = await (await LIB.keepSave(F1.id, saveOf(q))).sent;
  assert.deepEqual([s2 && s2.sent, s2 && s2.mode], [true, "replace"]);
  assert.deepEqual(w2.calls, ["plan_save_session", "plan_save_commit"], "the gone session goes to the broker's commit");
  assert.equal(w2.bodies[1].landed, undefined);
  assert.equal(w2.bytes, q.blob.size, "nothing sent twice");
  // a deferred session that is gone part way and never landed (it ran out): the broker's commit, asked, says not_saved -
  // a new session at once, as a gone upload session always did
  await devicePlan();
  const w3 = saveWorld({ deferred: true, realHash: true });
  const r = savedProject(3 * MiB + 19, "PDFCACHE1", 34);
  w3.chunk = (s) => { if (!w3.cut) { w3.cut = true; s.done = "ran-out"; } };     // gone after its first chunk
  const s3 = await (await LIB.keepSave(F1.id, saveOf(r))).sent;
  assert.deepEqual([s3 && s3.sent, s3 && s3.mode], [true, "replace"], JSON.stringify(w3.calls));
  assert.deepEqual(w3.calls, ["plan_save_session", "plan_save_commit", "plan_save_session", "plan_save_commit"]);
});

test("why OneDrive made a copy (addendum 3 D5): plan_changed {why: \"refused\"} - OneDrive would not replace the plan - is told without blaming the office (and the takeoff app hears no 'copy' news, whose words say the office saved), here and when settled in a later page; \"changed\" - the copy words; no why (an older broker) or one this page does not know - \"unproved\" (contract addendum 5 G1)", async () => {
  const toasts = [];
  globalThis.DCR2 = { toast: (t) => toasts.push(t) };
  try {
    await devicePlan();
    const w = saveWorld({ deferred: true, realHash: true, refusedAll: true });
    const news = [];
    const p = savedProject(1 * MiB + 23, "PDFCACHE1", 35);
    const sent = await (await LIB.keepSave(F1.id, saveOf(p), (state, extra) => news.push([state, extra]))).sent;
    assert.deepEqual([sent && sent.mode, w.calls], ["copy", ["plan_save_session", "plan_save_commit", "plan_save_session", "plan_save_done"]]);
    assert.deepEqual([w.bodies[2].mode, w.bodies[2].version], ["copy", "qx:AAA"], "sent again as a copy against the old base");
    assert.deepEqual(toasts, ["OneDrive would not replace the plan, so your work was saved as 'A900 Bid - iPad 2026-11-04 1030.takeoff' next to it - nothing was overwritten."]);
    assert.ok(!news.some((n) => n[0] === "copy"), "no 'copy' news to the app (its words blame an office save)");
    assert.deepEqual(news[news.length - 1], ["sent", {}], "'sent' instead: its 'sending' line ends (the frame's bar says where the work went)");
    // "changed": the copy words; no why (an older broker) or one this page does not know: "unproved" (contract addendum
    // 5 G1 - the plain copy words only on the broker's "changed" or "refused"), the app told "sent", the mark kept
    for (const why of ["changed", null, "crossed_somehow"]) {
      toasts.length = 0;
      await devicePlan();
      const w2 = saveWorld({ deferred: true, realHash: true, commitRefuse: true, commitWhy: why });
      w2.during = () => officeSave(w2);
      const n2 = [];
      await (await LIB.keepSave(F1.id, saveOf(savedProject(1 * MiB + 29, "PDFCACHE1", 36)), (state, extra) => n2.push([state, extra]))).sent;
      const plain = why === "changed";
      assert.deepEqual(toasts, [plain ? lib.copyTold("A900 Bid - iPad 2026-11-04 1030.takeoff", "iPad") : lib.unprovedTold("A900 Bid - iPad 2026-11-04 1030.takeoff", "iPad")], String(why));
      assert.equal(n2.some((n) => n[0] === "copy"), plain, String(why) + ": the office's copy news only on 'changed'");
      assert.equal(ROW().sent.why, plain ? undefined : "unproved", String(why) + ": the row never says nothing was overwritten");
      if (!plain) assert.equal(w2.bodies[2].mode, "copy", String(why) + ": sent again as a copy");
    }
    // the copy session's end never heard (the page closed after its last byte): its why is kept with it, and the later
    // page's settle says the neutral words too
    toasts.length = 0;
    const q = savedProject(1 * MiB + 31, "PDFCACHE1", 37);
    await devicePlan();
    const w4 = saveWorld({ deferred: true, realHash: true });
    const hash = QX.quickXorHash(q.bytes);
    const r = ROW();
    const st = DEV.idb.dbs.get("dcr2-plan-library").stores.get("plans").data;
    const file = "p" + lib.hashOf("u1") + "-save-9.takeoff";
    const d = await DEV.fs.root.getDirectoryHandle("plan-library", { create: true });
    (await d.getFileHandle(file, { create: true })).bytes = q.bytes.slice();
    const copyName = "A900 Bid - iPad 2026-11-04 1030.takeoff";
    w4.files.push({ id: "01FAKECOPY00099", name: copyName, folder: F1.folder, size: q.blob.size, modified: AT, version: "qx:" + hash, rev: 1 });
    w4.sessions.set(UPS(99), { mode: "copy", item: F1.id, name: copyName, size: q.blob.size, done: "01FAKECOPY00099", ticket: "tk99", deferred: false, url: UPS(99) });
    st.set(KEY, Object.assign({}, r, { local: { file, base: "qx:AAA", savedAt: AT, size: q.blob.size, hash, state: "waiting", error: "", code: "", fails: 0, retryAt: null,
      sends: [{ file, ticket: "tk99", mode: "copy", name: copyName, size: q.blob.size, at: AT, hash, why: "refused" }] } }));
    toasts.length = 0;
    const settled = await LIB.sendSaved(F1.id, { manual: true });
    assert.deepEqual([settled.sent, settled.mode, w4.calls], [true, "copy", ["plans_list", "plan_save_done"]]);
    assert.deepEqual(toasts, ["OneDrive would not replace the plan, so your work was saved as '" + copyName + "' next to it - nothing was overwritten."]);
    // and a session the library opens after a refusal keeps that why (never its address)
    await devicePlan();
    const w5 = saveWorld({ deferred: true, realHash: true, refusedAll: true });
    let sends = null;
    w5.during = function look(sx) { if (sx.mode === "copy") sends = ROW().local.sends; else w5.during = look; };
    await (await LIB.keepSave(F1.id, saveOf(savedProject(4096, "PDFCACHE1", 38)))).sent;
    assert.deepEqual(sends.map((x) => [x.mode, x.why]), [["replace", undefined], ["copy", "refused"]]);
  } finally { delete globalThis.DCR2; }
});

test("a kept save without its hash (its spool could not load js/quickxor.js - addendum 3 D4) is hashed again in a second worker pass before it is sent or settled; one the broker settles only with a hash (need: hash) that this device cannot hash is never settled without it - it waits, and is not sent again", async () => {
  await devicePlan();
  const w = saveWorld({ deferred: true, realHash: true });
  DEV.nav.onLine = false;
  await LIB.canWrite();                                     // (its probe worker first: it would take the failure)
  DEV.importFails = 1;                                       // the spool's worker cannot load the hash
  const p = savedProject(2 * MiB + 41, "PDFCACHE1", 39);
  await (await LIB.keepSave(F1.id, saveOf(p))).sent;
  DEV.importFails = 0;
  assert.equal(ROW().local.hash, null, "kept without a hash");
  DEV.nav.onLine = true;
  const out = await LIB.sendSaved(F1.id, { manual: true });
  assert.deepEqual([out.sent, out.mode], [true, "replace"]);
  const hash = QX.quickXorHash(p.bytes);
  assert.equal(w.bodies.find((b) => b.op === "plan_save_commit").hash, hash, "hashed again before the send: the commit carries it");
  // a session whose end was never heard, of a save with no hash, past the broker's 48 hours (need: hash): the second
  // pass hashes the file, and the settle goes with it
  const setUp = async (seed) => {
    await devicePlan();
    const w2 = saveWorld({ deferred: true, realHash: true, needHash: true });
    const q = savedProject(1 * MiB + seed, "PDFCACHE1", seed);
    DEV.nav.onLine = false;
    await LIB.canWrite();                                     // (its probe worker first: it would take the failure)
    DEV.importFails = 1;
    await (await LIB.keepSave(F1.id, saveOf(q))).sent;
    DEV.importFails = 0;
    DEV.nav.onLine = true;
    const r = ROW();
    w2.sessions.set(UPS(99), { mode: "replace", item: F1.id, name: F1.name, size: q.blob.size, done: F1.id, ticket: "tk99", deferred: true, url: UPS(99) });
    Object.assign(w2.plan, { size: q.blob.size, modified: "2026-11-04T19:00:00.000Z", version: "qx:" + QX.quickXorHash(q.bytes), rev: 2 });
    const st = DEV.idb.dbs.get("dcr2-plan-library").stores.get("plans").data;
    st.set(KEY, Object.assign({}, r, { local: Object.assign({}, r.local, { sends: [{ file: r.local.file, ticket: "tk99", mode: "replace", name: F1.name,
      size: q.blob.size, at: AT, hash: null, commit: "broker" }] }) }));
    return { w2, q };
  };
  const a = await setUp(42);
  const settled = await LIB.sendSaved(F1.id, { manual: true });
  assert.deepEqual([settled.sent, settled.mode, a.w2.calls], [true, "replace", ["plan_save_done"]], JSON.stringify(a.w2.calls));
  assert.equal(a.w2.bodies[0].hash, QX.quickXorHash(a.q.bytes), "settled with the hash of the second pass");
  // ...and when this device cannot hash it now either: never settled without it, nor sent again - it waits
  const b = await setUp(43);
  DEV.importFails = 2;                                       // the second pass's worker cannot load it either
  const e = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
  DEV.importFails = 0;
  assert.equal(e && e.code, "need_hash");
  assert.deepEqual(b.w2.calls, [], "never asked without a hash (contract addendum 4 E1) - and never a new session");
  const l = ROW().local;
  assert.deepEqual([l.code, l.sends.map((x) => x.ticket), lib.dueToSend(ROW(), Date.now() + 365 * 86400000)], ["need_hash", ["tk99"], true],
    "the session kept, the save waiting (tried again later)");
  // tried again - the second pass's worker could not load it when it started, and asks for it once more itself: the
  // hash, and the save settled with it
  DEV.importFails = 1;
  const again = await LIB.sendSaved(F1.id, { manual: true });
  DEV.importFails = 0;
  assert.deepEqual([again.sent, b.w2.calls.slice(-1)[0], b.w2.bodies.slice(-1)[0].hash], [true, "plan_save_done", QX.quickXorHash(b.q.bytes)]);
  // the worker's second pass: slices of 8 MiB, never the whole file, and nothing written
  const worker = read("js/plan-library-worker.js");
  assert.match(worker, /async function hashFile\(m\) \{[\s\S]*?var end = Math\.min\(pos \+ CHUNK, size\);\s*var buf = new Uint8Array\(await readSlice\(f\.slice\(pos, end\)\)\);/);
  const pass = worker.slice(worker.indexOf("async function hashFile"), worker.indexOf("async function start"));
  assert.ok(pass.length > 200 && !/createSyncAccessHandle|\.write\(|create: true/.test(pass), "no access handle, nothing made: nothing written");
});

test("the save-back rules (addendum 2): a send waits for the person on SEND_FINAL (invalid now too) or on NOT_SAVED_MAX not_saved answers; hashOk is the broker's form", () => {
  const l = (over) => ({ local: Object.assign({ file: "p1-x-2.takeoff", state: "failed", retryAt: null }, over) });
  assert.deepEqual(["not_found", "too_large", "lost", "bad_base", "invalid"].map((code) => lib.dueToSend(l({ code }), NOW)), [false, false, false, false, false]);
  assert.deepEqual([lib.dueToSend(l({ code: "not_saved", notSaved: 1 }), NOW), lib.dueToSend(l({ code: "not_saved", notSaved: lib.NOT_SAVED_MAX }), NOW)], [true, false]);
  assert.deepEqual([lib.dueToSend(l({ code: "offline", notSaved: 5 }), NOW), lib.dueToSend(l({ code: "not_saved" }), NOW)], [true, true], "only a not_saved counts");
  assert.equal(lib.saveStateOf(l({ code: "not_saved", notSaved: 2, error: "x" }), null, NOW).final, true);
  assert.deepEqual([lib.hashOk("PbG6uWfEwQF5DpbKoNh7NwBgQ+0="), lib.hashOk("PbG6uWfEwQF5DpbKoNh7NwBgQ+0"), lib.hashOk("qx:PbG6uWfEwQF5DpbKoNh7NwBgQ+0="), lib.hashOk(null)],
    [true, false, false, false]);
  assert.equal(lib.withSave({ version: "qx:A" }, "p1-x-2.takeoff", 9, AT, "", "PbG6uWfEwQF5DpbKoNh7NwBgQ+0=").rec.local.hash, "PbG6uWfEwQF5DpbKoNh7NwBgQ+0=");
  assert.equal(lib.withSave({ version: "qx:A" }, "p1-x-2.takeoff", 9, AT, "", "not one").rec.local.hash, null);
});

test("demo broker as DCR Desktop 2's since the review round (addendum 2 C1b): an office save during the upload makes the SAME upload a copy; Microsoft refusing that is plan_changed (sent again as a copy); a desktop save is found by name; an identical re-save is saved; a lost commit answer and a 30-day ticket settle with the hash; the commit's refusals", { skip }, async () => {
  // this engine's clock can be moved on (a ticket's 30 days)
  let shift = 0;
  FK = await loadFake();
  E = FK.createEngine({ maxFileSize: 500 * 1024 * 1024, clock: () => new Date(Date.now() + shift) });
  E.load(FK.seed({ now: new Date() }));
  createUploaderRef = (await import("../site/js/onedrive-upload.js")).createUploader;
  const a267 = project("A267");
  const ext = E.exts.find((x) => x.name === "p7-onedrive");
  const send = demoSend(ext);
  as("admin");
  const list = async () => (await onedrive.plansList([a267.id]))[String(a267.id)].files;
  const plan = (await list()).find((f) => f.name === "A267 Rev 2.takeoff");
  const full = plan.folder + "/" + plan.name;
  // (1) an office save lands while the save goes up: the same upload committed as the copy (bytes once), the plan the office's
  const r1 = bytesOf(2 * 327680 + 1, 81);
  ext.duringUpload(full, "office");
  const j1 = await send({ projectId: a267.id, file: new File([r1], plan.name), name: plan.name, meta: { itemId: plan.id, base: plan.version, name: plan.name, hash: QX.quickXorHash(r1) } });
  assert.equal(j1.state, "done", j1.error);
  assert.deepEqual([j1.result.mode, /^A267 Rev 2 - iPad \d{4}-\d{2}-\d{2} \d{4}\.takeoff$/.test(j1.result.name)], ["copy", true], JSON.stringify(j1.result));
  const p1 = (await list()).find((f) => f.id === plan.id);
  assert.match(p1.version, /^qx:demo-office-/, "the office's save is still the plan");
  // (2) Microsoft refusing to commit it as the copy: plan_changed, the session dropped - sent again as a copy, old base
  ext.refuseCopyCommits(true);
  ext.duringUpload(full, "office");
  const r2 = bytesOf(327680 + 2, 82);
  const m2 = { itemId: plan.id, base: p1.version, name: plan.name, hash: QX.quickXorHash(r2) };
  const j2 = await send({ projectId: a267.id, file: new File([r2], plan.name), name: plan.name, meta: m2 });
  ext.refuseCopyCommits(false);
  assert.deepEqual([j2.state, j2.result && j2.result.mode, m2.mode], ["done", "copy", "copy"], j2.error);
  // (3) the office's DESKTOP app saved it (the old item into Backups, a new item on the name): found by name, a copy
  const d = ext.desktopSave(full);
  assert.ok(d && d.id !== plan.id);
  const now3 = await list();
  assert.ok(!now3.some((f) => f.id === plan.id) && now3.some((f) => f.id === d.id && f.name === plan.name), "the plan is another item now");
  const r3 = bytesOf(327680 + 3, 83);
  const j3 = await send({ projectId: a267.id, file: new File([r3], plan.name), name: plan.name, meta: { itemId: plan.id, base: p1.version, name: plan.name, hash: QX.quickXorHash(r3) } });
  assert.deepEqual([j3.state, j3.result && j3.result.mode], ["done", "copy"], j3.error);
  assert.equal((await refusal(onedrive.planSaveSession({ projectId: a267.id, itemId: plan.id, version: p1.version, size: 5 }))).code, "not_found", "without the name: 404");
  // (4) an identical re-save of the new item: replace onto its own bytes, saved (never "the version the device had")
  const r4 = bytesOf(327680 + 4, 84);
  const h4 = QX.quickXorHash(r4);
  const j4 = await send({ projectId: a267.id, file: new File([r4], plan.name), name: plan.name, meta: { itemId: d.id, base: d.version, name: plan.name, hash: h4 } });
  assert.equal(j4.result.mode, "replace", j4.error);
  await ext.hashed();
  const v4 = (await list()).find((f) => f.id === d.id).version;
  assert.equal(v4, "qx:" + h4);
  const j4b = await send({ projectId: a267.id, file: new File([r4], plan.name), name: plan.name, meta: { itemId: d.id, base: v4, name: plan.name, hash: h4 } });
  assert.deepEqual([j4b.state, j4b.result && j4b.result.mode, j4b.result && j4b.result.id], ["done", "replace", d.id], j4b.error);
  await ext.hashed();
  assert.equal((await list()).find((f) => f.id === d.id).version, "qx:" + h4, "the same bytes, the same hash");
  // (5) settling: a replace session whose commit landed but whose answer was lost - plan_save_done with the hash finds it
  //     (and finds nothing with another hash); the commit asked again settles too
  const s5 = await onedrive.planSaveSession({ projectId: a267.id, itemId: d.id, version: v4, size: 327680 + 5, name: plan.name });
  const r5 = bytesOf(327680 + 5, 85);
  const put = (url, a, z, total, body) => ext.http("PUT", url, { "Content-Range": "bytes " + a + "-" + z + "/" + total }, body);
  assert.equal(put(s5.uploadUrl, 0, 327679, r5.length, new Blob([r5.subarray(0, 327680)])).status, 202);
  assert.equal(put(s5.uploadUrl, 327680, r5.length - 1, r5.length, new Blob([r5.subarray(327680)])).status, 202, "the last chunk commits nothing");
  assert.equal((await refusal(onedrive.planSaveDone(a267.id, d.id, s5.ticket, QX.quickXorHash(r5)))).code, "not_saved", "nothing landed before the commit");
  // (committed; OneDrive has no hash of it yet - the check waits for it, never answers on a size: DCR Desktop 2 48dc59e)
  const c5a = await refusal(onedrive.planSaveCommit({ projectId: a267.id, itemId: d.id, ticket: s5.ticket, uploadUrl: s5.uploadUrl, hash: QX.quickXorHash(r5) }));
  assert.deepEqual([c5a.code, c5a.status, c5a.info && c5a.info.why], ["busy", 503, "checking"]);
  await ext.hashed();
  const c5 = await onedrive.planSaveCommit({ projectId: a267.id, itemId: d.id, ticket: s5.ticket, uploadUrl: s5.uploadUrl, hash: QX.quickXorHash(r5) });
  assert.equal(c5.mode, "replace");
  await ext.hashed();
  const again = await onedrive.planSaveCommit({ projectId: a267.id, itemId: d.id, ticket: s5.ticket, uploadUrl: s5.uploadUrl, hash: QX.quickXorHash(r5) });
  assert.deepEqual([again.mode, again.id], ["replace", d.id], "a commit asked again (its answer lost) settles as the replace it was");
  assert.equal((await onedrive.planSaveDone(a267.id, d.id, s5.ticket, QX.quickXorHash(r5))).mode, "replace");
  assert.equal((await refusal(onedrive.planSaveDone(a267.id, d.id, s5.ticket, QX.quickXorHash(r4)))).code, "not_saved", "another hash: not this save");
  // a ticket 29 days old still settles; one past 30 days does not
  try {
    shift = 29 * 86400000;
    assert.equal((await onedrive.planSaveDone(a267.id, d.id, s5.ticket, QX.quickXorHash(r5))).mode, "replace", "29 days");
    shift = 31 * 86400000;
    const old = await refusal(onedrive.planSaveDone(a267.id, d.id, s5.ticket, QX.quickXorHash(r5)));
    assert.deepEqual([old.code, old.field], ["invalid", "ticket"], "31 days");
  } finally { shift = 0; }
  // the commit's refusals: another session's address, another host, a copy's ticket, another item, a hash out of shape
  const s6 = await onedrive.planSaveSession({ projectId: a267.id, itemId: d.id, version: (await list()).find((f) => f.id === d.id).version, size: 9, name: plan.name });
  assert.equal(s6.commit, "broker");
  const bad = async (o, field) => {
    const e = await refusal(onedrive.call(Object.assign({ op: "plan_save_commit", project_id: a267.id, item_id: d.id, ticket: s6.ticket, upload_url: s6.uploadUrl }, o)));
    assert.deepEqual([e.code, e.field], ["invalid", field], JSON.stringify(o));
  };
  await bad({ upload_url: s5.uploadUrl }, "upload_url");
  await bad({ upload_url: "https://evil.example.com/__demo/up/x" }, "upload_url");
  await bad({ ticket: j3.result ? (await onedrive.planSaveSession({ projectId: a267.id, itemId: d.id, version: "qx:old", size: 9, name: plan.name })).ticket : "" }, "ticket");
  await bad({ item_id: plan.id }, "item_id");
  await bad({ hash: "abc" }, "hash");
});

/* ── contract addendum 4 (the final check's round): E1 no hash, no deferred replace - and "unproved"; E2 the unchecked
   words; E7 a check's 503 asked again on a timer ── */

/** a save whose page closed before its commit's answer (as the repair round 2 test's): OneDrive holds its bytes as the
    plan, its session - the ticket and the hash - is the save's */
async function landedElsewhere(seed, o) {
  await devicePlan();
  const w = saveWorld(Object.assign({ deferred: true, realHash: true }, o || {}));
  const q = savedProject(1 * MiB + seed, "PDFCACHE1", seed);
  DEV.nav.onLine = false;
  await (await LIB.keepSave(F1.id, saveOf(q))).sent;
  DEV.nav.onLine = true;
  const r = ROW();
  const hash = QX.quickXorHash(q.bytes);
  w.sessions.set(UPS(99), { mode: "replace", item: F1.id, name: F1.name, size: q.blob.size, done: F1.id, ticket: "tk99", deferred: true, url: UPS(99) });
  Object.assign(w.plan, { size: q.blob.size, modified: "2026-11-04T19:00:00.000Z", version: "qx:" + hash, rev: 2 });
  const st = DEV.idb.dbs.get("dcr2-plan-library").stores.get("plans").data;
  st.set(KEY, Object.assign({}, r, { local: Object.assign({}, r.local, { sends: [{ file: r.local.file, ticket: "tk99", mode: "replace", name: F1.name,
    size: q.blob.size, at: AT, hash, commit: "broker" }] }) }));
  return { w, q, hash, st };
}
const COPY1 = "A900 Bid - iPad 2026-11-04 1030.takeoff";
const UNPROVED_WORDS = "OneDrive could not show whether this save went over an office save: it is sent again as a separate file - check the plan's version history in OneDrive.";
const toastsOn = () => { const t = []; globalThis.DCR2 = { toast: (x) => t.push(x) }; return t; };
/** kept without a hash: the spool's worker could not load js/quickxor.js */
async function keptHashless(w, seed, size) {
  DEV.nav.onLine = false;
  await LIB.canWrite();                                     // (its probe worker first: it would take the failure)
  DEV.importFails = 1;
  const p = savedProject(size || 1 * MiB + seed, "PDFCACHE1", seed);
  await (await LIB.keepSave(F1.id, saveOf(p))).sent;
  DEV.importFails = 0;
  DEV.nav.onLine = true;
  assert.equal(ROW().local.hash, null, "kept without a hash");
  return p;
}

test("no hash, no deferred replace (contract addendum 4 E1): a kept save neither the spool nor the second worker pass could hash is never sent as a replace - no session is started, nothing asked; it waits on the device in plain words, at least 30 minutes and never final, its copy kept - and goes, hashed, once the device can; a copy (an 'unproved' save's) may go without a hash", async () => {
  const toasts = toastsOn();
  try {
    await devicePlan();
    const w = saveWorld({ deferred: true, realHash: true });
    const p = await keptHashless(w, 54);
    DEV.importFails = 2;                                     // the second pass's worker cannot load it either
    const t0 = Date.now();
    const awake0 = DEV.wake.asked;
    const e = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    DEV.importFails = 0;
    assert.deepEqual([e && e.code, e && e.message], ["need_hash", "This save is getting ready to send - it waits on this iPad."]);
    assert.deepEqual(w.calls, [], "no session started, nothing asked of the broker");
    assert.equal(DEV.wake.asked, awake0, "no send began at all (the screen was never held awake for one)");
    const l = ROW().local;
    assert.deepEqual([l.state, l.code, l.error, l.hash, l.notSaved], ["failed", "need_hash", lib.needHashWords("iPad"), null, 0]);
    assert.ok(LIBFILES()[l.file] && LIBFILES()[l.file].length === p.blob.size, "its own copy kept, whole");
    assert.ok(Date.parse(l.retryAt) - t0 >= 30 * 60 * 1000, "a long wait");
    assert.deepEqual([lib.dueToSend(ROW(), Date.now() + 29 * 60 * 1000), lib.dueToSend(ROW(), Date.now() + 31 * 60 * 1000)], [false, true], "never final: it goes again by itself");
    const row = (await LIB.list())[0];
    assert.deepEqual([row.save.final, lib.saveText(row.save, "iPad")], [false, "This save is getting ready to send - it waits on this iPad."]);
    assert.doesNotMatch(lib.saveText(row.save, "iPad"), /not sent|retry/i);
    // the device can hash it now: the next send hashes it and goes - the session, then the commit with that hash
    const out = await LIB.sendSaved(F1.id, { manual: true });
    assert.deepEqual([out.sent, out.mode, w.calls], [true, "replace", ["plan_save_session", "plan_save_commit"]]);
    assert.equal(w.bodies[1].hash, QX.quickXorHash(p.bytes), "the commit carries it");
    // the library's broker itself never starts a replace session nor commits without one (the rule at its source)
    const src = read("js/plan-library.js");
    assert.match(src, /session: async function \(j\) \{\s*const m = j\.meta \|\| \{\};\s*if \(m\.mode !== "copy" && !hashOk\(m\.hash\)\) throw needHash\(\);/);
    assert.match(src, /if \(!hashOk\(m\.hash\)\) throw needHash\(\);\s*const ticket = j\.session\.ticket;\s*try \{\s*return await askBroker\(m\.key, ticket, \(\) => onedrive\.planSaveCommit\(/);
    // a copy covers nothing: a save the broker could not prove (local.why "unproved") goes as a copy, hash or none
    await devicePlan();
    const w2 = saveWorld({ deferred: true, realHash: true });
    await keptHashless(w2, 55, 4096);
    const st = DEV.idb.dbs.get("dcr2-plan-library").stores.get("plans").data;
    st.set(KEY, Object.assign({}, ROW(), { local: Object.assign({}, ROW().local, { why: "unproved" }) }));
    DEV.importFails = 2;
    toasts.length = 0;
    const c = await LIB.sendSaved(F1.id, { manual: true });
    DEV.importFails = 0;
    assert.deepEqual([c.sent, c.mode, w2.calls], [true, "copy", ["plan_save_session", "plan_save_done"]]);
    assert.deepEqual([w2.bodies[0].mode, w2.bodies[0].version, "hash" in w2.bodies[1]], ["copy", "qx:AAA", false], "a copy session, the old base; no hash to send");
    assert.deepEqual(toasts, [lib.unprovedTold(COPY1, "iPad")]);
    // and the broker's own need hash on a commit (it cannot come: the commit always carries it) waits the same way
    await devicePlan();
    const w3 = saveWorld({ deferred: true, realHash: true });
    w3.commitQueue.push(http(409, { error: "not_saved", need: "hash", message: "This save can be checked now only with the file's hash - send it again with the hash." }));
    await (await LIB.keepSave(F1.id, saveOf(savedProject(4096, "PDFCACHE1", 56)))).sent;
    const l3 = ROW().local;
    assert.deepEqual([l3.code, l3.error, l3.notSaved, lib.dueToSend(ROW(), Date.now() + 31 * 60 * 1000)], ["need_hash", lib.needHashWords("iPad"), 0, true]);
  } finally { delete globalThis.DCR2; }
});

test("why \"unproved\" (contract addendum 4 E1): the broker could not prove whether the plan holds the save over an office save - in the page (plan_changed) or settled by a later page (not_saved) the save goes again as a copy, and the person is told so: never 'nothing was overwritten', never the office's copy news to the app; the mark stays with the save (a later Save of it too) until the copy lands", async () => {
  const toasts = toastsOn();
  try {
    // (1) the commit: plan_changed {why: "unproved"} - the same upload is dropped, the save goes again at once as a copy
    await devicePlan();
    const w = saveWorld({ deferred: true, realHash: true, commitRefuse: true, commitWhy: "unproved" });
    let during = null;
    w.during = function look(sx) {
      if (sx.mode === "copy") during = { sends: ROW().local.sends, why: ROW().local.why };
      else { officeSave(w); w.during = look; }
    };
    const news = [];
    const p = savedProject(1 * MiB + 57, "PDFCACHE1", 57);
    const sent = await (await LIB.keepSave(F1.id, saveOf(p), (state, extra) => news.push([state, extra]))).sent;
    assert.deepEqual([sent && sent.mode, w.calls], ["copy", ["plan_save_session", "plan_save_commit", "plan_save_session", "plan_save_done"]]);
    assert.deepEqual([w.bodies[2].mode, w.bodies[2].version], ["copy", "qx:AAA"], "a copy, against the old base");
    assert.deepEqual(toasts, ["Your work was saved as '" + COPY1 + "' next to the plan. OneDrive could not show whether your iPad's version went over an office save - " +
      "if someone saved this plan in the office while your iPad was sending, ask them to check the plan's version history in OneDrive."]);
    assert.ok(!news.some((n) => n[0] === "copy"), "no 'copy' news to the app (its words say nothing was overwritten)");
    assert.deepEqual(news[news.length - 1], ["sent", {}]);
    assert.deepEqual([during && during.why, during && during.sends.map((x) => [x.mode, x.why])], ["unproved", [["replace", undefined], ["copy", "unproved"]]],
      "kept with the save while it goes, and with its copy's session (a later page tells it the same)");
    const r = ROW();
    assert.deepEqual([r.local, r.sent.mode, r.sent.why], [null, "copy", "unproved"]);
    const row = (await LIB.list()).find((x) => x.key === KEY);
    const words = lib.saveText(row.save, "iPad");
    assert.doesNotMatch(words, /nothing was overwritten/, words);
    assert.match(words, /^Saved as a separate file: A900 Bid - iPad .+ — OneDrive could not show whether your iPad's version went over an office save: check the plan's version history in OneDrive$/);
    // (2) a later page: plan_save_done answers not_saved {why: "unproved"} - the session is over, the save goes as a copy
    toasts.length = 0;
    const a = await landedElsewhere(58);
    a.w.doneQueue.push(http(409, { error: "not_saved", why: "unproved", message: UNPROVED_WORDS }));
    const out = await LIB.sendSaved(F1.id, { manual: true });
    assert.deepEqual([out.sent, out.mode, a.w.calls], [true, "copy", ["plan_save_done", "plan_save_session", "plan_save_done"]]);
    assert.deepEqual([a.w.bodies[0].hash, a.w.bodies[1].mode, a.w.bodies[1].version], [a.hash, "copy", "qx:AAA"], "settled with the hash; then a copy, the old base");
    assert.deepEqual(toasts, [lib.unprovedTold(COPY1, "iPad")]);
    assert.deepEqual([ROW().sent.mode, ROW().sent.why, ROW().local], ["copy", "unproved", null]);
    // ...and while it waits (the copy's session refused just then), a later Save of it keeps the mark: told the same,
    // sent as a copy
    toasts.length = 0;
    const b = await landedElsewhere(59);
    b.w.doneQueue.push(() => { b.w.refuse = [503, "onedrive_not_authorized"]; return http(409, { error: "not_saved", why: "unproved", message: UNPROVED_WORDS }); });
    const off = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    assert.deepEqual([off && off.code, b.w.sessionBody.mode], ["save_not_allowed", "copy"], "the resend was a copy's session");
    assert.equal(ROW().local.why, "unproved", "marked");
    assert.deepEqual(ROW().local.sends, [], "the session is over");
    b.w.refuse = null;
    DEV.nav.onLine = false;
    await (await LIB.keepSave(F1.id, { req: "sCCCCCCCCC", name: F1.name, size: 4096, file: savedProject(4096, "PDFCACHE1", 60).blob })).sent;
    assert.equal(ROW().local.why, "unproved", "a later Save of the same save keeps it");
    DEV.nav.onLine = true;
    const later = await LIB.sendSaved(F1.id, { manual: true });
    assert.deepEqual([later.mode, b.w.bodies.slice(-2).map((x) => [x.op, x.mode])], ["copy", [["plan_save_session", "copy"], ["plan_save_done", undefined]]]);
    assert.deepEqual(toasts, [lib.unprovedTold(COPY1, "iPad")]);
    // the rules: withSave keeps only that mark; a row's copy says nothing was overwritten only when it was not unproved
    const base = { version: "qx:A", local: { file: "p1-x-2.takeoff", base: "qx:A", why: "unproved", sends: [] } };
    assert.equal(lib.withSave(base, "p1-y-3.takeoff", 9, AT, "", null).rec.local.why, "unproved");
    assert.ok(!("why" in lib.withSave({ version: "qx:A", local: { file: "p1-x-2.takeoff", base: "qx:A", why: "other" } }, "p1-y-3.takeoff", 9, AT, "", null).rec.local));
    assert.ok(!("why" in lib.withSave({ version: "qx:A" }, "p1-y-3.takeoff", 9, AT, "", null).rec.local));
    assert.match(lib.saveText({ state: "copy", name: "X.takeoff" }, "iPad"), /nothing was overwritten/);
    assert.equal(lib.adoptSent({ owner: "u1", itemId: "i1", local: { file: "p1-x-2.takeoff", savedAt: AT } }, "p1-x-2.takeoff", { mode: "copy", id: "c1", name: "C.takeoff", size: 9 }, AT, "unproved").rec.sent.why, "unproved");
    assert.ok(!("why" in lib.adoptSent({ owner: "u1", itemId: "i1", local: { file: "p1-x-2.takeoff", savedAt: AT } }, "p1-x-2.takeoff", { mode: "copy", id: "c1", name: "C.takeoff", size: 9 }, AT, "refused").rec.sent));
  } finally { delete globalThis.DCR2; }
});

test("the unchecked words (contract addendum 4 E2): a deferred replace found by its hash alone - its ticket no longer unseals (a rotated secret, or past 30 days) - is adopted, it did replace the plan, but the person is told it could not be checked against office saves; the same for the broker's verified false (no history), from a later page or the commit itself; verified true keeps the plain words", async () => {
  const toasts = toastsOn();
  const UNCHECKED = "Your save is in OneDrive: it replaced the plan there. It could not be checked against office saves this time - if someone saved this plan in the office " +
    "while your iPad was sending, ask them to check the plan's version history in OneDrive.";
  try {
    // the ticket does not unseal (400 invalid {field: "ticket"}): found by its hash alone in plans_list
    const a = await landedElsewhere(62);
    a.w.expired = true;
    const out = await LIB.sendSaved(F1.id, { manual: true });
    assert.deepEqual([out.sent, out.mode, a.w.calls], [true, "replace", ["plan_save_done", "plans_list"]]);
    assert.deepEqual([ROW().local, ROW().version], [null, "qx:" + a.hash], "adopted: the plan holds exactly these bytes");
    assert.deepEqual(toasts, [UNCHECKED]);
    assert.equal(lib.uncheckedTold("iPad"), UNCHECKED);
    // verified false from a later page's plan_save_done
    toasts.length = 0;
    await landedElsewhere(63, { doneVerified: false });
    assert.equal((await LIB.sendSaved(F1.id, { manual: true })).mode, "replace");
    assert.deepEqual(toasts, [UNCHECKED]);
    // ...and from the commit itself
    toasts.length = 0;
    await devicePlan();
    saveWorld({ deferred: true, realHash: true, commitVerified: false });
    assert.equal((await (await LIB.keepSave(F1.id, saveOf(savedProject(4096, "PDFCACHE1", 64)))).sent).mode, "replace");
    assert.deepEqual(toasts, [UNCHECKED]);
    // verified true: the plain words (said on the frame's bar only - no toast)
    toasts.length = 0;
    await devicePlan();
    saveWorld({ deferred: true, realHash: true, commitVerified: true });
    assert.equal((await (await LIB.keepSave(F1.id, saveOf(savedProject(4096, "PDFCACHE1", 65)))).sent).mode, "replace");
    assert.deepEqual(toasts, []);
    await landedElsewhere(66, { doneVerified: true });
    assert.equal((await LIB.sendSaved(F1.id, { manual: true })).mode, "replace");
    assert.deepEqual(toasts, []);
  } finally { delete globalThis.DCR2; }
});

test("a check's 503 with a Retry-After is asked again on a timer while the page is open (contract addendum 4 E7): a later page's settle and the commit alike - at the Retry-After, at least 30 s, at most the long wait; one timer per send; it stops when the page hides or the send settles", async () => {
  const timers = new Map();
  const cleared = [];
  let n = 0;
  LIB.useAgainClock({ set: (fn, ms) => { const id = ++n; timers.set(id, { fn, ms }); return id; }, clear: (id) => { cleared.push(id); timers.delete(id); } });
  const st = () => DEV.idb.dbs.get("dcr2-plan-library").stores.get("plans").data;
  const settleDown = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 5)); };
  /** the time of the timer has come: the save's wait is over (as 30 s later), and the timer fires */
  const fire = async (id) => {
    const t = timers.get(id);
    timers.delete(id);
    st().set(KEY, Object.assign({}, ROW(), { local: Object.assign({}, ROW().local, { retryAt: new Date(Date.now() - 1000).toISOString() }) }));
    t.fn();
    await settleDown();
  };
  const busy = (ra) => httpRA(503, { error: "busy", message: "OneDrive is busy just now. Try again in a minute." }, ra);
  try {
    assert.deepEqual([5, 30, 45, 120, 0, NaN, 1e9].map(lib.checkAgainMs), [30000, 30000, 45000, 120000, 30000, 30000, lib.LONG_WAIT_MS]);
    assert.equal(lib.CHECK_AGAIN_MIN_MS, 30000);
    // (1) a later page's settle: plan_save_done 503 busy, Retry-After 30 (the broker waits on OneDrive's hash)
    const a = await landedElsewhere(67);
    a.w.doneQueue.push(busy(30));
    const t0 = Date.now();
    const e = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    await settleDown();
    assert.deepEqual([e && e.code, e && e.retryAfter], ["busy", 30]);
    assert.deepEqual(Array.from(timers.values()).map((t) => t.ms), [30000], "one timer, at the Retry-After");
    const at = Date.parse(ROW().local.retryAt) - t0;
    assert.ok(at >= 30000 && at < 31000, "the save's wait moved to then: " + at);
    assert.equal(lib.dueToSend(ROW(), Date.now()), false, "nothing else sends it before then");
    // one timer per send: the person's Retry meanwhile stops it; a second 503 sets the next one
    a.w.doneQueue.push(busy(120));
    const first = Array.from(timers.keys())[0];
    await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    await settleDown();
    assert.ok(cleared.includes(first), "the earlier timer stopped when the send ran");
    assert.deepEqual(Array.from(timers.values()).map((t) => t.ms), [120000], "one timer still, at the new Retry-After");
    // the person's Retry settles it before the timer's time: the timer is done with (none left)
    const settled = await LIB.sendSaved(F1.id, { manual: true });
    await settleDown();
    assert.deepEqual([settled.sent, settled.mode, timers.size, ROW().local], [true, "replace", 0, null], "the send settled: its timer stopped");
    // its time comes: the same ticket and hash, adopted - and no timer after (the send settled)
    const a2 = await landedElsewhere(70);
    a2.w.doneQueue.push(busy(30));
    await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    await settleDown();
    assert.equal(timers.size, 1);
    await fire(Array.from(timers.keys())[0]);
    assert.deepEqual([a2.w.calls, ROW().local, ROW().version], [["plan_save_done", "plan_save_done"], null, "qx:" + a2.hash]);
    assert.deepEqual([a2.w.bodies[1].ticket, a2.w.bodies[1].hash], ["tk99", a2.hash], "the same ticket and hash");
    assert.equal(timers.size, 0);
    // (2) the commit (the uploader's own tries spent): 503 busy, Retry-After 45 - the session kept, asked again on the
    // timer, committed - nothing sent twice
    await devicePlan();
    const w = saveWorld({ deferred: true, realHash: true, parts: { maxTries: 1 } });
    w.commitQueue.push(busy(45));
    const p = savedProject(2 * MiB + 7, "PDFCACHE1", 68);
    await (await LIB.keepSave(F1.id, saveOf(p))).sent;
    await settleDown();
    assert.deepEqual([w.calls, ROW().local.code], [["plan_save_session", "plan_save_commit"], "busy"]);
    assert.deepEqual(Array.from(timers.values()).map((t) => t.ms), [45000]);
    await fire(Array.from(timers.keys())[0]);
    assert.deepEqual([w.calls, w.bytes, ROW().local, ROW().sent.mode], [["plan_save_session", "plan_save_commit", "plan_save_commit"], p.blob.size, null, "replace"]);
    assert.equal(timers.size, 0);
    // (3) the page hides: every timer stops (and none is set while it is hidden); a 503 without a Retry-After: none
    const doc = { visibilityState: "visible", ls: [], addEventListener(t, fn) { if (t === "visibilitychange") this.ls.push(fn); } };
    globalThis.document = doc;
    try {
      const b = await landedElsewhere(69);
      b.w.doneQueue.push(busy(30));
      await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
      await settleDown();
      assert.equal(timers.size, 1);
      const id = Array.from(timers.keys())[0];
      doc.visibilityState = "hidden";
      doc.ls.forEach((fn) => fn());
      assert.deepEqual([timers.size, cleared.includes(id)], [0, true], "stopped when the page hid");
      b.w.doneQueue.push(busy(30));
      await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
      await settleDown();
      assert.equal(timers.size, 0, "none while hidden");
      doc.visibilityState = "visible";
      b.w.doneQueue.push(http(503, { error: "busy", message: "made up" }));
      await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
      await settleDown();
      assert.equal(timers.size, 0, "no Retry-After: no timer (the next page, or Retry)");
    } finally { delete globalThis.document; }
  } finally { LIB.useAgainClock(null); }
});

/* ── the final checker's round 3b (DCR Desktop 2 9969d61): the version check's own 503 (why "checking") ── */

/** a broker 503 of its version check itself (DCR Desktop 2 checkWait: busy, or onedrive_not_authorized when Microsoft
    refused the restore), with its Retry-After */
const checkRA = (error, ra) => httpRA(503, { error: error || "busy", message: "OneDrive is busy just now. Try again in a minute.", why: "checking" }, ra || 30);

test("the broker's version check waits on OneDrive (its 503 why \"checking\": OneDrive has no hash of the plan yet, a restore not done - the final checker's round 3b, problem 2): the save is being checked, never 'not sent' - the row, the app's news and the record say so while the commit is asked again and once the uploader's tries are spent (no failure counted, its session kept), and a later page's settle the same; it is asked again at the Retry-After (E7), and when the page is in front again; a 503 without that why is OneDrive busy as before", async () => {
  const timers = new Map();
  let n = 0;
  LIB.useAgainClock({ set: (fn, ms) => { const id = ++n; timers.set(id, { fn, ms }); return id; }, clear: (id) => { timers.delete(id); } });
  const st = () => DEV.idb.dbs.get("dcr2-plan-library").stores.get("plans").data;
  const settleDown = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 5)); };
  const fire = async (id) => {
    const t = timers.get(id);
    timers.delete(id);
    st().set(KEY, Object.assign({}, ROW(), { local: Object.assign({}, ROW().local, { retryAt: new Date(Date.now() - 1000).toISOString() }) }));
    t.fn();
    await settleDown();
  };
  const CHECKING = "Your save is being checked against office saves in OneDrive - keep the portal open; there is nothing to do. It stays on this iPad meanwhile.";
  try {
    // the rules: only the check's own 503 is one; its words never say "not sent", "retry", "replaced", "overwritten" -
    // nor that the save is in OneDrive (during OneDrive's hash wait only a version of its size is there)
    assert.equal(lib.checkingWords("iPad"), CHECKING);
    assert.doesNotMatch(CHECKING, /not sent|retry|fail|could not|replaced|overwritten|is in OneDrive/i);
    assert.deepEqual([{ status: 503, info: { error: "busy", why: "checking" } }, { status: 503, info: { error: "onedrive_not_authorized", why: "checking" } }, { status: 503, info: { error: "busy" } },
      { status: 409, info: { error: "not_saved", why: "checking" } }, { status: 503 }, null].map(lib.checkWaitOf), [true, true, false, false, false, false]);
    const loc = { file: "p1-x-2.takeoff", base: "qx:A" };
    assert.deepEqual(lib.saveStateOf({ local: Object.assign({ state: "checking" }, loc) }, null, Date.now()), { state: "checking" });
    assert.deepEqual(lib.saveStateOf({ local: Object.assign({ state: "sending" }, loc) }, { sent: 5, size: 10, checking: true }, Date.now()), { state: "checking" });
    assert.deepEqual(lib.saveStateOf({ local: Object.assign({ state: "sending" }, loc) }, { sent: 5, size: 10 }, Date.now()), { state: "sending", pct: 50 });
    assert.deepEqual([lib.saveText({ state: "checking" }, "iPad"), lib.sendBar({ state: "checking" }), lib.sendFinal({ state: "checking", code: "checking" })], [CHECKING, null, false]);
    // (the frame's bar while it is open: the uploader's job's words, and a later page's settle's - the browser walk
    // tools/e2e-p7-plans.mjs (xii-a) sees the bar)
    const src = read("js/plan-library.js");
    assert.match(src, /if \(s\.checking\) \{\s*news\(key, "checking"\);\s*if \(frameIsOpen\(\)\) frameSay\(checkingWords\(deviceWord\(here\(\)\)\)\);/);
    assert.match(src, /async function checkSend\(key, file, x\) \{[\s\S]*?changed\(key\);\s*if \(frameIsOpen\(\)\) frameSay\(x\.message\);\s*\}/);
    // (1) the commit: OneDrive committed over an office save and has no hash of it yet - 503 why "checking", Retry-After
    // 30, three times: while the uploader asks again the row is "being checked", the app hears "checking" (never
    // "failed"), no progress words after it; its tries spent, the save is in the check - not a failure - and E7's timer
    // asks again at the Retry-After: the same session committed, nothing sent twice, no "checking" told again first
    await devicePlan();
    const w = saveWorld({ deferred: true, realHash: true, parts: { maxTries: 3, setTimeout: (fn) => setTimeout(fn, 0) } });
    let during = null;
    w.commitQueue.push(checkRA("busy"), async () => { during = (await LIB.list()).find((x) => x.key === KEY).save; return checkRA("onedrive_not_authorized"); }, checkRA("busy"));
    const news = [];
    const p = savedProject(2 * MiB + 9, "PDFCACHE1", 73);
    await (await LIB.keepSave(F1.id, saveOf(p), (state, extra) => news.push([state, extra]))).sent;
    await settleDown();
    assert.deepEqual(during, { state: "checking" }, "while the commit is asked again: being checked");
    const l = ROW().local;
    assert.deepEqual([l.state, l.code, l.error, l.fails, Number(l.notSaved) || 0], ["checking", "checking", CHECKING, 0, 0], "in the check: no failure counted");
    const at = Date.parse(l.retryAt) - Date.now();
    assert.ok(at > 25000 && at <= 30000, "its wait: the Retry-After (" + at + ")");
    assert.deepEqual([lib.dueToSend(ROW(), Date.now()), lib.dueToSend(ROW(), Date.now() + 31000)], [false, true], "never final: asked again by itself");
    const row = (await LIB.list()).find((x) => x.key === KEY);
    assert.deepEqual([row.save, lib.saveText(row.save, "iPad")], [{ state: "checking" }, CHECKING]);
    const told = news.map((x) => x[0]);
    assert.ok(told.includes("checking") && !told.includes("failed"), JSON.stringify(told));
    assert.ok(!told.slice(told.indexOf("checking")).includes("sending"), "no progress words once it is in the check: " + JSON.stringify(told));
    assert.deepEqual(Array.from(timers.values()).map((t) => t.ms), [30000], "E7's timer at the Retry-After");
    assert.deepEqual([w.calls, w.bytes], [["plan_save_session", "plan_save_commit", "plan_save_commit", "plan_save_commit"], p.blob.size]);
    news.length = 0;
    await fire(Array.from(timers.keys())[0]);
    assert.deepEqual([w.calls.length, w.bytes, ROW().local, ROW().sent.mode], [5, p.blob.size, null, "replace"], "the same session committed: nothing sent again");
    assert.deepEqual(news.map((x) => x[0]), ["sent"], "resumed in the check: no 'checking' told again, no 'Sending' first");
    // (2) a later page's settle: plan_save_done 503 why "checking" (busy; a restore Microsoft refused: not allowed in) -
    // the save is in the check, its session kept (the same ticket asked again), the timer at the Retry-After
    for (const error of ["busy", "onedrive_not_authorized"]) {
      timers.clear();
      const a = await landedElsewhere(error === "busy" ? 74 : 75);
      a.w.doneQueue.push(checkRA(error));
      const e = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
      await settleDown();
      assert.deepEqual([e && e.code, e && e.retryAfter, e && e.message], ["checking", 30, CHECKING], error);
      const l2 = ROW().local;
      assert.deepEqual([l2.state, l2.code, l2.fails, Number(l2.notSaved) || 0, l2.sends.map((s) => s.ticket)], ["checking", "checking", 0, 0, ["tk99"]], error + ": its session kept");
      assert.equal(lib.saveText((await LIB.list()).find((x) => x.key === KEY).save, "iPad"), CHECKING);
      assert.deepEqual(Array.from(timers.values()).map((t) => t.ms), [30000], error + ": asked again at the Retry-After");
      await fire(Array.from(timers.keys())[0]);
      assert.deepEqual([a.w.calls, a.w.bodies[1].ticket, a.w.bodies[1].hash, ROW().local, ROW().version], [["plan_save_done", "plan_save_done"], "tk99", a.hash, null, "qx:" + a.hash], error + ": then adopted");
    }
    // the check's 503 without a Retry-After (a gateway's copy of it): in the check all the same, its own wait the
    // shortest (checkAgainMs: 30 s) - no timer without a Retry-After (E7), the next page or the page in front asks
    timers.clear();
    const a3 = await landedElsewhere(79);
    a3.w.doneQueue.push(http(503, { error: "busy", message: "OneDrive is busy just now. Try again in a minute.", why: "checking" }));
    const e3 = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    await settleDown();
    const at3 = Date.parse(ROW().local.retryAt) - Date.now();
    assert.deepEqual([e3 && e3.code, e3 && e3.retryAfter, ROW().local.state, timers.size], ["checking", undefined, "checking", 0]);
    assert.ok(at3 > 25000 && at3 <= 30000, "its own wait: 30 s (" + at3 + ")");
    // a 503 of OneDrive's without the check's why: busy, as before - not the check's state
    timers.clear();
    const b = await landedElsewhere(76);
    b.w.doneQueue.push(httpRA(503, { error: "busy", message: "OneDrive is busy just now. Try again in a minute." }, 30));
    const eb = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    await settleDown();
    assert.deepEqual([eb && eb.code, ROW().local.state, (await LIB.list()).find((x) => x.key === KEY).save.state], ["busy", "waiting", "kept"]);
    // (3) the page hidden, then in front again: a save in the check gets its timer again, for what is left of its wait;
    // one that is not in the check gets none
    timers.clear();
    const doc = { visibilityState: "visible", ls: [], addEventListener(t, fn) { if (t === "visibilitychange") this.ls.push(fn); } };
    globalThis.document = doc;
    try {
      const c = await landedElsewhere(77);
      c.w.doneQueue.push(checkRA("busy"));
      await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
      await settleDown();
      assert.equal(timers.size, 1);
      doc.visibilityState = "hidden";
      doc.ls.forEach((fn) => fn());
      assert.equal(timers.size, 0, "stopped when the page hid");
      doc.visibilityState = "visible";
      doc.ls.forEach((fn) => fn());
      await settleDown();
      const left = Array.from(timers.values()).map((t) => t.ms);
      assert.ok(left.length === 1 && left[0] > 20000 && left[0] <= 30000, "its timer again, for what is left of its wait: " + JSON.stringify(left));
      await fire(Array.from(timers.keys())[0]);
      assert.deepEqual([c.w.calls, ROW().local, ROW().version], [["plan_save_done", "plan_save_done"], null, "qx:" + c.hash], "asked again and adopted");
      await landedElsewhere(78);
      doc.visibilityState = "hidden";
      doc.ls.forEach((fn) => fn());
      doc.visibilityState = "visible";
      doc.ls.forEach((fn) => fn());
      await settleDown();
      assert.equal(timers.size, 0, "a save not in the check: no timer");
    } finally { delete globalThis.document; }
  } finally { LIB.useAgainClock(null); }
});

/* ── contract addendum 5 (the closing round): one commit at a time per save (G2), the words of a why nobody proved
   (G1), a restore that never goes through (G3), every 503 the broker marks "checking" (G4) ── */

test("contract addendum 5's rules: the broker's longest run (Supabase's documented wall-clock limit, the largest of any plan) and the wait after a lost answer; what counts as a lost answer; the whys and their words", () => {
  assert.deepEqual([lib.BROKER_RUN_MAX_MS, lib.ANSWER_LOST_MS], [400000, 420000], "400 s (paid plans; free 150 s) and 20 s for the way there");
  const src = read("js/map/plan-library.js");
  assert.match(src, /https:\/\/supabase\.com\/docs\/guides\/functions\/limits, read 2026-11-05\) - "Maximum Duration \(Wall clock limit\)": Free\s+plan 150 s, Paid plans 400 s/, "the page is cited where the number is");
  // a lost answer: no answer at all, or a 5xx without the broker's own code (the gateway's 504 at its idle timeout) - its
  // own code as js/repo/onedrive.js call() marks it (`broker`: the body names one of CONTRACT's codes; contract addendum 6
  // H3: an `error` word that is not one of them is the gateway's)
  assert.deepEqual([{ code: "offline", status: 0 }, { code: "failed", status: 504, info: { code: "GATEWAY", message: "x" } }, { code: "failed", status: 502, info: null },
    { code: "unavailable", status: 503, info: {} }, { code: "busy", status: 503, info: { error: "busy" }, broker: true }, { code: "onedrive_failed", status: 502, info: { error: "onedrive_failed" }, broker: true },
    { code: "plan_changed", status: 409, info: { error: "plan_changed" }, broker: true }, { code: "auth", status: 401 }, null,
    { code: "failed", status: 504, info: { error: "Gateway Timeout" }, broker: false }, { code: "failed", status: 502, info: { error: "upstream_error" }, broker: false },
    { code: "unavailable", status: 503, info: { error: "not-a-broker-code" }, broker: false }].map(lib.answerLostOf),
  [true, true, true, true, false, false, false, false, false, true, true, true]);
  // the wait: from the later of the send's marks, ANSWER_LOST_MS; none without a mark; a mark in the future past a minute holds nothing
  const now = Date.parse("2026-11-05T12:00:00.000Z");
  const iso = (ms) => new Date(now + ms).toISOString();
  assert.deepEqual([lib.askWait({}, now), lib.askWait(null, now), lib.askWait({ asking: iso(-10000) }, now), lib.askWait({ asking: iso(-100000), lost: iso(-20000) }, now),
    lib.askWait({ lost: iso(-lib.ANSWER_LOST_MS - 1) }, now), lib.askWait({ asking: iso(30000) }, now), lib.askWait({ asking: iso(2 * 3600 * 1000) }, now), lib.askWait({ asking: "nonsense" }, now)],
  [0, 0, lib.ANSWER_LOST_MS - 10000, lib.ANSWER_LOST_MS - 20000, 0, lib.ANSWER_LOST_MS + 30000, 0, 0]);
  // the whys: plan_changed's - anything but the four, or none, "unproved"; not_saved's - none plain, not_put_back, else unproved
  assert.deepEqual(["changed", "refused", "unproved", "not_put_back", undefined, null, "", "crossed", 7].map(lib.copyWhyOf),
    ["changed", "refused", "unproved", "not_put_back", "unproved", "unproved", "unproved", "unproved", "unproved"]);
  assert.deepEqual([undefined, null, "", "unproved", "not_put_back", "something new", "changed"].map(lib.notSavedWhyOf), ["", "", "", "unproved", "not_put_back", "unproved", "unproved"]);
  assert.deepEqual([["", ""], ["unproved", ""], ["", "not_put_back"], ["unproved", "not_put_back"], ["not_put_back", "unproved"], [undefined, "unproved"]].map((x) => lib.strongerWhy(x[0], x[1])),
    ["", "unproved", "not_put_back", "not_put_back", "not_put_back", "unproved"]);
  // the words: G3's, the lost answer's - never "not sent", "nothing was overwritten", "in OneDrive"
  assert.equal(lib.notPutBackTold("A900 Bid - iPad 2026-11-05 1200.takeoff", "iPad"), "Your work was saved as 'A900 Bid - iPad 2026-11-05 1200.takeoff' next to the plan. Your iPad's version went over an office save and OneDrive would not put the office save back - ask the office to restore it from the plan's version history in OneDrive.");
  const lost = lib.answerLostWords("iPad");
  assert.equal(lost, "OneDrive's answer about this save has not reached this iPad yet - the portal asks again in a few minutes. Keep the portal open; there is nothing to do. It stays on this iPad meanwhile.");
  assert.doesNotMatch(lost + lib.notPutBackTold("x", "iPad"), /not sent|nothing was overwritten|is in OneDrive|retry/i);
  // the rows: a copy told so (the mark kept by a later save, not_put_back over unproved), the lost answer's wait
  const loc = { file: "p1-x-2.takeoff", base: "qx:A", savedAt: AT, size: 9, state: "waiting", sends: [] };
  assert.equal(lib.withSave({ itemId: "i", version: "qx:A", local: Object.assign({}, loc, { why: "not_put_back" }) }, "p1-x-3.takeoff", 9, AT).rec.local.why, "not_put_back");
  assert.equal(lib.withSave({ itemId: "i", version: "qx:A", local: Object.assign({}, loc, { why: "unproved" }) }, "p1-x-3.takeoff", 9, AT).rec.local.why, "unproved");
  assert.equal(lib.withSave({ itemId: "i", version: "qx:A", local: loc }, "p1-x-3.takeoff", 9, AT).rec.local.why, undefined);
  const rec = { key: "u1|i", owner: "u1", itemId: "i", projectId: "7", number: "A900", name: F1.name, folder: F1.folder, file: "p1-old.takeoff", version: "qx:A", local: loc };
  const ans = { saved: true, mode: "copy", id: "01FAKECOPY0009", name: "A900 Bid - iPad 2026-11-05 1200.takeoff", size: 9, modified: AT, version: "qx:C" };
  const sent = lib.adoptSent(rec, loc.file, ans, AT, "not_put_back").rec.sent;
  assert.equal(sent.why, "not_put_back");
  const st = lib.saveStateOf({ sent }, null, NOW);
  assert.deepEqual(st, { state: "copy", name: ans.name, why: "not_put_back" });
  assert.equal(lib.saveText(st, "iPad"), "Saved as a separate file: " + ans.name + " — your iPad's version went over an office save and OneDrive would not put it back: ask the office to restore it from the plan's version history in OneDrive");
  assert.deepEqual(lib.saveStateOf({ local: Object.assign({}, loc, { state: "checking", code: "answer_lost" }) }, null, NOW), { state: "checking", code: "answer_lost" });
  assert.equal(lib.saveText({ state: "checking", code: "answer_lost" }, "iPad"), lost);
  assert.equal(lib.saveText({ state: "checking" }, "iPad"), lib.checkingWords("iPad"), "the check's own words stay");
  // G4: a 503 the broker marks "checking", whatever its code; one it did not, never
  assert.deepEqual([{ status: 503, info: { error: "takeoff_root_missing", why: "checking" } }, { status: 503, info: { error: "busy", why: "checking" } }, { status: 503, info: { error: "busy" } }].map(lib.checkWaitOf), [true, true, false]);
});

/** a broker answer that never came back (a connection that dropped, a page that slept): js/repo/onedrive.js "offline" */
const lostAnswer = () => ({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send", context: new TypeError("offline") } });
/** the gateway's own 504 (Supabase's idle timeout: the function may still run) - no broker code in its body */
const gateway504 = () => http(504, { code: "IDLE_TIMEOUT", message: "made up" });

test("one commit or settle at a time per save (contract addendum 5 G2): a settle after a page that closed or slept mid-request, another window's request in flight (its Web Lock; or, with no Web Locks, its mark in the save's record), a gateway's 504 - never asked again before the broker's longest run is over; then asked, once", async () => {
  const timers = new Map();
  let tn = 0;
  LIB.useAgainClock({ set: (fn, ms) => { const id = ++tn; timers.set(id, { fn, ms }); return id; }, clear: (id) => { timers.delete(id); } });
  const settleDown = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 5)); };
  const WORDS = lib.answerLostWords("iPad");
  const markSends = (a, marks) => {
    const cur = ROW();
    a.st.set(KEY, Object.assign({}, cur, { local: Object.assign({}, cur.local, { sends: cur.local.sends.map((s) => Object.assign({}, s, marks)) }) }));
  };
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  try {
    // (1) the page that sent it closed (or slept) while its settle was asked: the mark `asking` stays - the next page waits
    // the rest of the broker's longest run, in the lost answer's words; past it, asked once and adopted
    const a = await landedElsewhere(81);
    markSends(a, { asking: ago(60 * 1000) });
    const e1 = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    await settleDown();
    assert.deepEqual([e1 && e1.code, a.w.calls, ROW().local.state, ROW().local.code, ROW().local.error], ["answer_lost", [], "checking", "answer_lost", WORDS], "nothing asked while the other request may still run");
    const left = Date.parse(ROW().local.retryAt) - Date.now();
    assert.ok(left > lib.ANSWER_LOST_MS - 65000 && left <= lib.ANSWER_LOST_MS - 59000, "the rest of the wait: " + left);
    assert.equal(lib.dueToSend(ROW(), Date.now()), false);
    markSends(a, { asking: ago(lib.ANSWER_LOST_MS + 1000) });
    const ok1 = await LIB.sendSaved(F1.id, { manual: true });
    assert.deepEqual([ok1.sent, ok1.mode, a.w.calls, ROW().local], [true, "replace", ["plan_save_done"], null], "past it: asked once, adopted");
    // (2) another window's settle of it in flight: its Web Lock is held - never a second request; the wait is that
    // window's mark's (or 30 s at least)
    const b = await landedElsewhere(82);
    const lockName = "dcr2-plan-ask:" + lib.hashOf("tk99");
    DEV.locks.held.set(lockName, []);
    try {
      markSends(b, { asking: ago(5000) });
      const e2 = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
      await settleDown();
      assert.deepEqual([e2 && e2.code, b.w.calls], ["answer_lost", []], "the other window's request runs: none from here");
      assert.ok(Date.parse(ROW().local.retryAt) - Date.now() > lib.ANSWER_LOST_MS - 10000, "its mark's wait");
      markSends(b, { asking: ago(lib.ANSWER_LOST_MS + 1000) });
      const e2b = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
      await settleDown();
      assert.deepEqual([e2b && e2b.code, b.w.calls, e2b && e2b.retryAfter], ["answer_lost", [], 30], "its lock still held, its mark old: asked again in 30 s, never now");
    } finally { DEV.locks.held.delete(lockName); }
    const ok2 = await LIB.sendSaved(F1.id, { manual: true });
    assert.deepEqual([ok2.sent, b.w.calls], [true, ["plan_save_done"]], "its lock let go: asked once");
    // (3) a browser without Web Locks: the save's own mark - read and written in one transaction - is the guard between
    // windows: another window's fresh `asking` holds this one off; once over, this page's own mark goes on before the
    // request and is cleared by the answer
    const c = await landedElsewhere(83);
    const locks = DEV.nav.locks;
    delete DEV.nav.locks;
    try {
      markSends(c, { asking: ago(2000) });
      const e3 = await LIB.sendSaved(F1.id).then(() => null, (x) => x);
      await settleDown();
      assert.deepEqual([e3 && e3.code, c.w.calls], ["answer_lost", []]);
      markSends(c, { asking: ago(lib.ANSWER_LOST_MS + 1000) });
      let during = null;
      c.w.doneQueue.push(async () => { during = ROW().local.sends[0]; return http(503, { error: "busy", message: "OneDrive is busy just now. Try again in a minute." }); });
      const e3b = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
      await settleDown();
      assert.ok(during && Date.parse(during.asking) > Date.now() - 5000, "this page's own mark, written before its request: " + JSON.stringify(during));
      assert.deepEqual([e3b && e3b.code, c.w.calls, ROW().local.sends[0].asking, ROW().local.sends[0].lost], ["busy", ["plan_save_done"], undefined, undefined], "the broker's answer (busy) clears it: asked again soon, as before");
      // (4) the gateway's 504 (Supabase's idle timeout: the function may run on) is a lost answer too
      c.w.doneQueue.push(gateway504());
      const e4 = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
      await settleDown();
      const s4 = ROW().local.sends[0];
      assert.deepEqual([e4 && e4.code, e4 && e4.retryAfter, c.w.calls.length, ROW().local.code], ["answer_lost", 420, 2, "answer_lost"]);
      assert.ok(Date.parse(s4.lost) > Date.now() - 5000 && Date.parse(s4.asking) > 0, "its marks: asked, lost " + JSON.stringify(s4));
      const e4b = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
      assert.deepEqual([e4b && e4b.code, c.w.calls.length], ["answer_lost", 2], "the person's Retry waits too");
    } finally { DEV.nav.locks = locks; }
    // (5) plan_save_done after a session's last chunk (a send its last chunk commits): its answer lost - the same wait,
    // never asked again at once
    await devicePlan();
    const d = saveWorld({ realHash: true });
    d.doneQueue.push(lostAnswer());
    await (await LIB.keepSave(F1.id, saveOf(savedProject(1 * MiB + 45, "PDFCACHE1", 80)))).sent;
    await settleDown();
    assert.deepEqual([d.calls, ROW().local.code, ROW().local.state], [["plan_save_session", "plan_save_done"], "answer_lost", "checking"], "asked once, then it waits");
    const e5 = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    assert.deepEqual([e5 && e5.code, d.calls.length], ["answer_lost", 2], "the Retry waits too");
  } finally { LIB.useAgainClock(null); }
});

test("one commit at a time in one page too (contract addendum 5 G2): a newer save while the earlier one's commit is still in flight (its send stopped, its request not) - the earlier session is settled only once that request has answered, never beside it", async () => {
  await devicePlan();
  const w = saveWorld({ deferred: true, realHash: true });
  const events = [];
  let open = null;
  const gate = new Promise((r) => { open = r; });
  let inFlight = 0, most = 0;
  const track = async (what, fn) => { inFlight++; most = Math.max(most, inFlight); events.push(what + " asked"); try { return await fn(); } finally { inFlight--; events.push(what + " answered"); } };
  // the first save's commit: held by the broker until the test lets it answer (not committed: not_saved)
  w.commitQueue.push((b) => track("commit " + b.ticket, async () => { await gate; return http(409, { error: "not_saved", message: "OneDrive did not get the whole file - send it again." }); }));
  w.doneQueue.push((b) => track("settle " + b.ticket, async () => http(409, { error: "not_saved", message: "OneDrive did not get the whole file - send it again." })));
  const p1 = savedProject(1 * MiB + 41, "PDFCACHE1", 84);
  const line = { file: "", base: "" };
  const first = await LIB.keepSave(F1.id, saveOf(p1), null, line);
  for (let i = 0; i < 200 && !events.length; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(events, ["commit tk1 asked"], "the first save's commit is in flight");
  // the app saves again before it answered: the first save's send stops (its request does not), the newer one's settle of
  // tk1 waits for that request
  const p2 = savedProject(1 * MiB + 43, "PDFCACHE1", 85);
  const second = await LIB.keepSave(F1.id, Object.assign(saveOf(p2), { req: "sBBBBBBBBB" }), null, line);
  assert.equal(second.state, "kept");
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(events, ["commit tk1 asked"], "nothing else asked of that send while its commit is in flight");
  open();
  const sent = await second.sent;
  await first.sent;
  assert.deepEqual(events.slice(0, 3), ["commit tk1 asked", "commit tk1 answered", "settle tk1 asked"], "the settle of tk1 only after its commit answered: " + JSON.stringify(events));
  assert.equal(most, 1, "never two at once");
  assert.deepEqual([sent && sent.sent, sent && sent.mode, ROW().local], [true, "replace", null], "then the newer save goes");
});

test("a restore that never goes through (contract addendum 5 G3): plan_changed / not_saved why \"not_put_back\" - the save goes again as a copy, the mark kept with it, and once the copy lands the person is told the office save is still under the iPad's (ask the office to restore it); the app hears 'sent', never the office's 'copy' news; the row says so", async () => {
  const toasts = toastsOn();
  const NPB = "This save went over an office save and OneDrive would not put the office save back: it is sent again as a separate file - put the office save back by hand from the plan's version history in OneDrive.";
  try {
    // the commit's answer
    await devicePlan();
    const w = saveWorld({ deferred: true, realHash: true });
    w.commitQueue.push(http(409, { error: "plan_changed", retry: "copy", why: "not_put_back", message: NPB }));
    const news = [];
    const p = savedProject(1 * MiB + 51, "PDFCACHE1", 86);
    // (while the copy goes up: the save keeps the mark - a later send of it goes as such a copy too - and the copy's own
    // session carries that why, for a later page's settle)
    let during = null;
    w.during = function look(sx) { if (sx.mode === "copy") during = { why: ROW().local.why, sends: ROW().local.sends.map((x) => [x.mode, x.why]) }; else w.during = look; };
    const sent = await (await LIB.keepSave(F1.id, saveOf(p), (state, extra) => news.push([state, extra]))).sent;
    assert.deepEqual([sent && sent.mode, w.calls], ["copy", ["plan_save_session", "plan_save_commit", "plan_save_session", "plan_save_done"]]);
    assert.deepEqual(during, { why: "not_put_back", sends: [["replace", undefined], ["copy", "not_put_back"]] });
    assert.deepEqual([w.bodies[2].mode, w.bodies[2].version], ["copy", "qx:AAA"], "sent again as a copy against the old base");
    assert.deepEqual(toasts, [lib.notPutBackTold(sent.name, "iPad")]);
    assert.ok(!news.some((n) => n[0] === "copy") && news[news.length - 1][0] === "sent", JSON.stringify(news));
    const row = (await LIB.list()).find((x) => x.key === KEY);
    assert.deepEqual([row.save.state, row.save.why], ["copy", "not_put_back"]);
    assert.match(lib.saveText(row.save, "iPad"), /went over an office save and OneDrive would not put it back/);
    // a later page's settle: not_saved {why: "not_put_back"} - the mark kept (a later Save of the same opening too), the
    // copy told so
    toasts.length = 0;
    const a = await landedElsewhere(87);
    a.w.doneQueue.push(http(409, { error: "not_saved", why: "not_put_back", message: NPB }));
    const s2 = await LIB.sendSaved(F1.id, { manual: true });
    assert.deepEqual([s2 && s2.mode, a.w.calls, a.w.bodies[1] && a.w.bodies[1].mode], ["copy", ["plan_save_done", "plan_save_session", "plan_save_done"], "copy"]);
    assert.deepEqual(toasts, [lib.notPutBackTold(s2.name, "iPad")]);
    // not_put_back over unproved: a save marked unproved that then hears not_put_back says not_put_back
    toasts.length = 0;
    const b = await landedElsewhere(88);
    const cur = ROW();
    b.st.set(KEY, Object.assign({}, cur, { local: Object.assign({}, cur.local, { why: "unproved" }) }));
    b.w.doneQueue.push(http(409, { error: "not_saved", why: "not_put_back", message: NPB }));
    await LIB.sendSaved(F1.id, { manual: true });
    assert.equal(toasts.length, 1);
    assert.match(toasts[0], /went over an office save and OneDrive would not put the office save back/);
    // a not_saved whose why this page does not know: "unproved" (G1), the copy told so
    toasts.length = 0;
    const c = await landedElsewhere(89);
    c.w.doneQueue.push(http(409, { error: "not_saved", why: "something_new", message: "made up" }));
    await LIB.sendSaved(F1.id, { manual: true });
    assert.equal(toasts.length, 1);
    assert.match(toasts[0], /OneDrive could not show whether your iPad's version went over an office save/);
    // a copy answer that names a why of its own (none does today: the broker's 200 copy is its proved "changed"): the
    // words follow it - one this page knows its words, any other "unproved" (G1)
    for (const [why, words] of [["not_put_back", /would not put the office save back/], ["new_reason", /OneDrive could not show whether/]]) {
      toasts.length = 0;
      await devicePlan();
      const w3 = saveWorld({ deferred: true, realHash: true });
      w3.commitQueue.push(ok({ saved: true, mode: "copy", id: "01FAKECOPY0077", name: COPY1, folder: F1.folder, size: 0, modified: AT, version: "qx:COPY77", why }));
      const p3 = savedProject(1 * MiB + 53, "PDFCACHE1", 99);
      const q3 = w3.commitQueue[0];
      q3.data.size = p3.blob.size;
      const s3 = await (await LIB.keepSave(F1.id, saveOf(p3))).sent;
      assert.deepEqual([s3 && s3.mode, toasts.length], ["copy", 1], why);
      assert.match(toasts[0], words, why);
      assert.equal(ROW().sent.why, why === "not_put_back" ? "not_put_back" : "unproved", why);
    }
  } finally { delete globalThis.DCR2; }
});

test("every 503 the broker marks \"checking\" is the check, whatever its code (contract addendum 5 G4): the commit's (its takeoff folder's proof running out) is asked again as the check, its session kept - never dropped, never 'not sent'; a 503 it did not mark stays as it was", async () => {
  const timers = new Map();
  let tn = 0;
  LIB.useAgainClock({ set: (fn, ms) => { const id = ++tn; timers.set(id, { fn, ms }); return id; }, clear: (id) => { timers.delete(id); } });
  const settleDown = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 5)); };
  try {
    await devicePlan();
    const w = saveWorld({ deferred: true, realHash: true, parts: { maxTries: 2, setTimeout: (fn) => setTimeout(fn, 0) } });
    w.commitQueue.push(httpRA(503, { error: "takeoff_root_missing", message: "made up", why: "checking" }, 2), httpRA(503, { error: "takeoff_root_missing", message: "made up", why: "checking" }, 2));
    const news = [];
    const p = savedProject(1 * MiB + 61, "PDFCACHE1", 90);
    await (await LIB.keepSave(F1.id, saveOf(p), (state, extra) => news.push([state, extra]))).sent;
    await settleDown();
    const l = ROW().local;
    assert.deepEqual([w.calls, l.state, l.code, l.fails], [["plan_save_session", "plan_save_commit", "plan_save_commit"], "checking", "checking", 0], "asked again as the check, then in the check");
    assert.ok(news.some((n) => n[0] === "checking") && !news.some((n) => n[0] === "failed"), JSON.stringify(news));
    assert.deepEqual(Array.from(timers.values()).map((t) => t.ms), [30000], "E7's 30 s floor (its Retry-After was 2)");
    const [id] = Array.from(timers.keys());
    const t = timers.get(id);
    timers.delete(id);
    const st = DEV.idb.dbs.get("dcr2-plan-library").stores.get("plans").data;
    st.set(KEY, Object.assign({}, ROW(), { local: Object.assign({}, ROW().local, { retryAt: new Date(Date.now() - 1000).toISOString() }) }));
    t.fn();
    await settleDown();
    assert.deepEqual([w.calls.length, w.bytes, ROW().local, ROW().sent.mode], [4, p.blob.size, null, "replace"], "its session kept: committed, nothing sent again");
    // a later page's settle of an EARLIER save's session (a save of the same opening replaced it since) answered the
    // check's 503: the save waiting now is in the check too - nothing goes before that session is known
    const a = await landedElsewhere(64);
    const cur = ROW();
    a.st.set(KEY, Object.assign({}, cur, { local: Object.assign({}, cur.local, { sends: cur.local.sends.map((s) => Object.assign({}, s, { file: "p1-an-earlier-save.takeoff" })) }) }));
    a.w.doneQueue.push(httpRA(503, { error: "takeoff_root_missing", message: "made up", why: "checking" }, 30));
    const ea = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    await settleDown();
    assert.deepEqual([ea && ea.code, a.w.calls, ROW().local.state, ROW().local.code], ["checking", ["plan_save_done"], "checking", "checking"], "an earlier save's session in the check: this save waits in it");
    // a 503 the broker did not mark (before any commit attempt): OneDrive busy, as before
    await devicePlan();
    const w2 = saveWorld({ deferred: true, realHash: true, parts: { maxTries: 1 } });
    w2.commitQueue.push(httpRA(503, { error: "busy", message: "OneDrive is busy just now. Try again in a minute." }, 30));
    await (await LIB.keepSave(F1.id, saveOf(savedProject(1 * MiB + 63, "PDFCACHE1", 91)))).sent;
    await settleDown();
    assert.deepEqual([ROW().local.state, ROW().local.code], ["failed", "busy"]);
  } finally { LIB.useAgainClock(null); }
});

/* ── contract addendum 6 (the last repair): H2 a send that may have landed is settled before it is dropped; R4 the check
   sticky per send; H3 a gateway's body is not the broker's answer ─────────────────────────────────────────────────── */

test("a gateway's 5xx is not the broker's answer, whatever its body's `error` says (contract addendum 6 H3, the re-verifier's zz-g2): call() marks only a body naming one of the broker's codes (CONTRACT); a commit answered 504 {error: 'Gateway Timeout'} or 502 {error: 'upstream_error'} is a lost answer - asked once, the save waits ANSWER_LOST_MS in the lost answer's words, the person's Retry waits too; the broker's own 503 busy, 502 onedrive_failed and 500 server_error are answers", async () => {
  await device();
  for (const [status, body, own] of [[504, { error: "Gateway Timeout", message: "made up" }, false], [502, { error: "upstream_error" }, false], [503, { error: "not-a-broker-code" }, false],
    [504, { code: "IDLE_TIMEOUT", message: "made up" }, false], [503, { error: "busy", message: "OneDrive is busy just now. Try again in a minute." }, true], [502, { error: "onedrive_failed" }, true],
    [500, { error: "server_error" }, true]]) {
    stub(() => http(status, body));
    const e = await refusal(onedrive.planSaveDone("7", F1.id, "tk1", undefined));
    assert.deepEqual([e.status, e.broker === true, lib.answerLostOf(e)], [status, own, !own], status + " " + JSON.stringify(body));
  }
  const timers = new Map();
  let tn = 0;
  LIB.useAgainClock({ set: (fn, ms) => { const id = ++tn; timers.set(id, { fn, ms }); return id; }, clear: (id) => { timers.delete(id); } });
  const settleDown = async () => { for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 5)); };
  try {
    for (const [status, body] of [[504, { error: "Gateway Timeout", message: "made up" }], [502, { error: "upstream_error", message: "made up" }], [504, { code: "IDLE_TIMEOUT", message: "made up" }]]) {
      const tag = status + " " + JSON.stringify(body);
      timers.clear();
      await devicePlan();
      const w = saveWorld({ deferred: true, realHash: true });
      w.commitQueue.push(http(status, body));
      const news = [];
      const first = await (await LIB.keepSave(F1.id, saveOf(savedProject(2 * MiB + 3, "PDFCACHE1", 7)), (state) => news.push(state))).sent;
      await settleDown();
      const l = ROW().local;
      assert.equal(first, null, tag + ": not sent yet");
      assert.deepEqual([w.calls.filter((c) => c === "plan_save_commit").length, l.state, l.code, l.error, Number(l.fails) || 0],
        [1, "checking", "answer_lost", lib.answerLostWords("iPad"), 0], tag + ": asked once, then it waits - never asked again at once");
      assert.ok(Date.parse(l.sends[0].lost) > 0, tag + ": the send's answer marked lost");
      assert.deepEqual(Array.from(timers.values()).map((t) => t.ms), [lib.ANSWER_LOST_MS], tag + ": E7's timer after the broker's longest run");
      assert.ok(!news.includes("failed"), tag + ": " + JSON.stringify(news));
      const e = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
      assert.deepEqual([e && e.code, w.calls.filter((c) => c === "plan_save_commit").length], ["answer_lost", 1], tag + ": the Retry waits too");
      await settleDown();
    }
  } finally { LIB.useAgainClock(null); }
});

test("a send that may have landed is settled before it is dropped (contract addendum 6 H2, the re-verifier's P1): the first commit lands and its answer is lost; after the broker's longest run the commit is asked again and refused - 403 forbidden, the gateway's 401 'Invalid JWT', 400 invalid ticket, 404 not_found: the session is KEPT and the save waits on this iPad in words that say so (never 'not sent', no 'failed' news); every later send settles that session with plan_save_done and its hash BEFORE any new session - while the broker cannot settle it (the same refusal) it still waits; then the words follow the broker's proof (a verified replace, or the unchecked words for a ticket found by its hash), never the office's 'nothing was overwritten'", async () => {
  await device();
  const timers = new Map();
  let tn = 0;
  LIB.useAgainClock({ set: (fn, ms) => { const id = ++tn; timers.set(id, { fn, ms }); return id; }, clear: (id) => { timers.delete(id); } });
  const settleDown = async () => { for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 5)); };
  const toasts = toastsOn();
  try {
    for (const [label, answer, code] of [
      ["403 forbidden", () => http(403, { error: "forbidden", message: "made up" }), "forbidden"],
      ["401 (the gateway's: an expired sign-in)", () => http(401, { code: 401, message: "Invalid JWT" }), "auth"],
      ["400 invalid ticket (a rotated secret)", () => http(400, { error: "invalid", field: "ticket", message: "made up" }), "invalid"],
      ["404 not_found (the broker's gate: the project not this person's to see now)", () => http(404, { error: "not_found", message: "made up" }), "not_found"],
    ]) {
      timers.clear();
      toasts.length = 0;
      await devicePlan();
      const w = saveWorld({ deferred: true, realHash: true, loseCommit: true });
      const p = savedProject(2 * MiB + 3, "PDFCACHE1", 7);
      const ipad = "qx:" + QX.quickXorHash(p.bytes);
      const news = [];
      await (await LIB.keepSave(F1.id, saveOf(p), (state, extra) => news.push([state, extra && extra.name]))).sent;
      await settleDown();
      assert.equal(w.plan.version, ipad, label + ": the first commit landed (its answer lost)");
      // the wait over: E7's timer asks the commit again - refused
      const old = new Date(Date.now() - lib.ANSWER_LOST_MS - 1000).toISOString();
      const st = DEV.idb.dbs.get("dcr2-plan-library").stores.get("plans").data;
      const cur = ROW();
      st.set(KEY, Object.assign({}, cur, { local: Object.assign({}, cur.local, { retryAt: old, sends: cur.local.sends.map((s) => Object.assign({}, s, { asking: old, lost: old })) }) }));
      w.commitQueue.push(answer());
      const [id] = Array.from(timers.keys());
      const t = timers.get(id);
      timers.delete(id);
      t.fn();
      await settleDown();
      const WAITS = lib.unsettledWords("iPad", code);
      const l = ROW().local;
      assert.deepEqual([w.calls, l.state, l.code, l.error, l.sends.map((s) => s.ticket)], [["plan_save_session", "plan_save_commit", "plan_save_commit"], "failed", "unsettled", WAITS, ["tk1"]],
        label + ": kept, it waits - its session still the save's");
      const row = (await LIB.list()).find((x) => x.key === KEY);
      assert.deepEqual([row.save.state, row.save.final, lib.saveText(row.save, "iPad")], ["failed", false, WAITS], label + ": the row");
      assert.match(WAITS, /kept on this iPad and waits/);
      assert.doesNotMatch(WAITS, /not sent|nothing was overwritten|replaced/i);
      assert.ok(!news.some((n) => n[0] === "failed" || n[0] === "copy"), label + ": the app never hears 'failed' or 'copy': " + JSON.stringify(news));
      // the person's Retry while the broker still cannot settle it (the same refusal to plan_save_done): asked of tk1,
      // never a new session; it still waits (a ticket that no longer unseals is looked for by its hash instead - below)
      if (code !== "invalid") {
        w.doneQueue.push(answer());
        const e1 = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
        await settleDown();
        assert.deepEqual([e1 && e1.code, w.calls.slice(3), w.bodies[3].ticket, w.bodies[3].hash, ROW().local.code, ROW().local.sends.map((s) => s.ticket)],
          ["unsettled", ["plan_save_done"], "tk1", QX.quickXorHash(p.bytes), "unsettled", ["tk1"]], label + ": settled first - refused again, it waits");
      } else w.doneQueue.push(answer());
      // then the broker can: tk1 settled first, with its hash - before any new session; the words follow its proof
      const n0 = w.calls.length;
      const out = await LIB.sendSaved(F1.id, { manual: true });
      await settleDown();
      assert.equal(w.calls.indexOf("plan_save_session", 1), -1, label + ": never a second session: " + JSON.stringify(w.calls));
      assert.deepEqual([w.calls[n0], w.bodies[n0].ticket, w.bodies[n0].hash], ["plan_save_done", "tk1", QX.quickXorHash(p.bytes)], label + ": tk1's plan_save_done first");
      assert.deepEqual([out.sent, out.mode, ROW().local, ROW().sent.mode, ROW().version], [true, "replace", null, "replace", ipad], label + ": the replace it was");
      assert.ok(!toasts.some((x) => /nothing was overwritten/.test(x)), label + ": " + JSON.stringify(toasts));
      // (a ticket that no longer unseals: found by its hash alone - E2's unchecked words, never the plain replace words)
      assert.deepEqual(toasts, code === "invalid" ? [lib.uncheckedTold("iPad")] : [], label);
      assert.equal(news[news.length - 1][0], "sent", label);
    }
  } finally { LIB.useAgainClock(null); delete globalThis.DCR2; }
});

test("a later page's settle of a deferred replace the broker refuses to settle now (contract addendum 6 H2): 401 'Invalid JWT', 403, 404 - the session stays in sends, the save waits on this iPad told so (never 'not sent'), nothing else is sent; once the broker answers, it is settled; a copy's session is settled as before", async () => {
  for (const [label, answer, code] of [["401", () => http(401, { code: 401, message: "Invalid JWT" }), "auth"], ["403", () => http(403, { error: "forbidden", message: "made up" }), "forbidden"],
    ["404", () => http(404, { error: "not_found", message: "made up" }), "not_found"]]) {
    const a = await landedElsewhere(70);
    a.w.doneQueue.push(answer());
    const e = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    const l = ROW().local;
    assert.deepEqual([e && e.code, a.w.calls, l.state, l.code, l.error, l.sends.map((s) => s.ticket)],
      ["unsettled", ["plan_save_done"], "failed", "unsettled", lib.unsettledWords("iPad", code), ["tk99"]], label);
    assert.deepEqual([lib.sendFinal(l), lib.dueToSend(ROW(), Date.now() + 7 * 3600 * 1000)], [false, true], label + ": never final");
    const ok1 = await LIB.sendSaved(F1.id, { manual: true });
    assert.deepEqual([ok1.sent, ok1.mode, a.w.calls, ROW().local], [true, "replace", ["plan_save_done", "plan_save_done"], null], label + ": settled, adopted");
  }
  // a copy's session (no deferred commit: it covers nothing) - the session is over on a 404 as before
  const b = await landedElsewhere(71);
  const cur = ROW();
  b.st.set(KEY, Object.assign({}, cur, { local: Object.assign({}, cur.local, { sends: cur.local.sends.map((s) => Object.assign({}, s, { mode: "copy", commit: undefined, name: COPY1 })) }) }));
  b.w.files.push({ id: "01FAKECOPY0042", name: COPY1, folder: F1.folder, size: cur.local.size, modified: AT, version: "qx:" + b.hash, rev: 1 });
  b.w.doneQueue.push(http(404, { error: "not_found", message: "made up" }));
  await LIB.sendSaved(F1.id, { manual: true }).catch(() => null);
  assert.deepEqual(b.w.calls.slice(0, 3), ["plans_list", "plan_save_done", "plan_save_session"], "a copy's 404: over, the save goes on");
});

test("adoptSent never lets go a deferred replace's session that no broker answer settled (contract addendum 6 H2): the session the answer settles, and those the broker settled (plan_changed / not_saved: `settled`), go; another stays - and while this record's own save would go with it, nothing is adopted (the save waits, settled first)", () => {
  const F = "p1-x-2.takeoff", G = "p1-x-3.takeoff";
  const send = (ticket, o) => Object.assign({ file: F, ticket, mode: "replace", name: F1.name, size: 9, at: AT, hash: null, commit: "broker" }, o || {});
  const ans = { saved: true, mode: "copy", id: "01FAKECOPY0009", name: COPY1, size: 9, modified: AT, version: "qx:C" };
  const rec = (sends, file) => ({ key: "u1|" + F1.id, owner: "u1", itemId: F1.id, projectId: "7", number: "A900", name: F1.name, folder: F1.folder, file: "p1-old.takeoff",
    version: "qx:A", local: { file: file || F, base: "qx:A", savedAt: AT, size: 9, state: "waiting", sends } });
  // tk1 open (its commit refused: 401, 403, ...), tk3 the copy this answer settles: not adopted
  assert.deepEqual(lib.adoptSent(rec([send("tk1"), send("tk3", { mode: "copy", commit: undefined })]), F, ans, AT, "changed", "tk3"), { rec: null, copy: null, old: [], open: true });
  // tk1 settled by the broker (plan_changed), or the very session this answer settles: adopted, the sessions go
  const a = lib.adoptSent(rec([send("tk1", { settled: true }), send("tk3", { mode: "copy", commit: undefined })]), F, ans, AT, "changed", "tk3");
  assert.deepEqual([a.open, a.rec.local, a.rec.sent.mode, !!a.copy], [undefined, null, "copy", true]);
  const b = lib.adoptSent(rec([send("tk1")]), F, Object.assign({}, ans, { mode: "replace", id: F1.id, name: F1.name }), AT, "", "tk1");
  assert.deepEqual([b.open, b.rec.local, b.rec.sent.mode], [undefined, null, "replace"]);
  // an earlier save's (F) copy adopted while a later save (G) waits: F's open session stays in sends, the settled one goes
  const c = lib.adoptSent(rec([send("tk1"), send("tk2", { settled: true }), send("tk3", { mode: "copy", commit: undefined }), send("tk4", { file: G })], G), F, ans, AT, "changed", "tk3");
  assert.deepEqual(c.rec.local.sends.map((s) => s.ticket), ["tk1", "tk4"]);
  // a copy session is never "open": it covers nothing
  const d = lib.adoptSent(rec([send("tk2", { mode: "copy", commit: undefined }), send("tk3", { mode: "copy", commit: undefined })]), F, ans, AT, "changed", "tk3");
  assert.equal(d.rec.local, null);
  // the words: kept, it waits - for each cause; never "not sent", never a claim either way
  for (const code of ["auth", "forbidden", "not_found", "invalid", "", undefined]) {
    const words = lib.unsettledWords("iPad", code);
    assert.match(words, /Your save is kept on this iPad and waits: it may already be in OneDrive/);
    assert.doesNotMatch(words, /not sent|nothing was overwritten|replaced|is in OneDrive/i);
    assert.equal(lib.saveText({ state: "failed", code: "unsettled", why: words, final: false }, "iPad"), words);
  }
  assert.match(lib.unsettledWords("iPad", "auth"), /^Your sign-in to the portal has expired - sign in again\./);
  assert.match(lib.unsettledWords("iPad", "forbidden"), /ask the office/);
});

test("once a send was in the broker's check, its later 503s are the check too, marked or not, until another answer (contract addendum 6 H2, R4): the uploader's job stays `checking` and the save in the check's words - never 'not sent', never the 'failed' news; a later page's settle reads the send's own mark the same way; any other answer clears the mark", async () => {
  const settleDown = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 5)); };
  const timers = new Map();
  let tn = 0;
  LIB.useAgainClock({ set: (fn, ms) => { const id = ++tn; timers.set(id, { fn, ms }); return id; }, clear: (id) => { timers.delete(id); } });
  const unmarked = () => httpRA(503, { error: "busy", message: "OneDrive is busy just now. Try again in a minute." }, 30);
  try {
    // in the page: the check's 503, then two 503s the broker did not mark (its first walk throttled: the broker reads G4
    // per request) - the job's tries spent in the check
    await devicePlan();
    const w = saveWorld({ deferred: true, realHash: true, parts: { maxTries: 3, setTimeout: (fn) => setTimeout(fn, 0) } });
    w.commitQueue.push(checkRA("busy", 2), unmarked(), unmarked());
    const news = [];
    await (await LIB.keepSave(F1.id, saveOf(savedProject(1 * MiB + 65, "PDFCACHE1", 92)), (state) => news.push(state))).sent;
    await settleDown();
    const l = ROW().local;
    assert.deepEqual([w.calls, l.state, l.code, l.error, l.fails], [["plan_save_session", "plan_save_commit", "plan_save_commit", "plan_save_commit"], "checking", "checking", lib.checkingWords("iPad"), 0],
      "in the check to the end");
    assert.ok(news.includes("checking") && !news.includes("failed"), JSON.stringify(news));
    assert.equal(l.sends[0].checking, true, "the send's own mark (the broker's checking 503; unmarked 503s keep it)");
    // a later page: the save's send was in the check (its mark); the broker's 503 without why is the check too
    const a = await landedElsewhere(72);
    const cur = ROW();
    a.st.set(KEY, Object.assign({}, cur, { local: Object.assign({}, cur.local, { sends: cur.local.sends.map((s) => Object.assign({}, s, { checking: true })) }) }));
    a.w.doneQueue.push(unmarked());
    const e = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    assert.deepEqual([e && e.code, a.w.calls, ROW().local.state, ROW().local.code, ROW().local.sends[0].checking], ["checking", ["plan_save_done"], "checking", "checking", true]);
    // a send never in the check: the unmarked 503 is OneDrive busy, as before (no failure, nothing marked)
    const b = await landedElsewhere(73);
    b.w.doneQueue.push(unmarked());
    const e2 = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    assert.deepEqual([e2 && e2.code, ROW().local.sends[0].checking], ["busy", undefined]);
    // the broker's check marks it; another answer (here 401: the save waits, unsettled) clears it
    b.w.doneQueue.push(checkRA("busy", 30));
    await LIB.sendSaved(F1.id, { manual: true }).catch(() => null);
    assert.equal(ROW().local.sends[0].checking, true);
    b.w.doneQueue.push(http(401, { code: 401, message: "Invalid JWT" }));
    const e3 = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    assert.deepEqual([e3 && e3.code, ROW().local.sends[0].checking], ["unsettled", undefined]);
    b.w.doneQueue.push(unmarked());
    const e4 = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    assert.equal(e4 && e4.code, "busy", "no longer in the check: busy as before");
    await settleDown();
  } finally { LIB.useAgainClock(null); }
});

test("demo broker as DCR Desktop 2 e1fd4c4 (repair round 5, contract addendum 6 H1): a restore is one POST and an answer that does not say whether it went through is read from the history again - gone through but answered 504 / 503 / nothing: the plain 'changed' (plan_save_done: the plain not_saved) with its line, the office save the plan again, also past the 30 minutes (never not_put_back); not gone through and its answer lost: 503 checking ('the restore's answer was lost'), then at the 30 minutes not_put_back only with this save still the newest; a plain refusal as before", { skip }, async () => {
  let shift = 0;
  FK = await loadFake();
  E = FK.createEngine({ maxFileSize: 500 * 1024 * 1024, clock: () => new Date(Date.now() + shift) });
  E.load(FK.seed({ now: new Date() }));
  const a267 = project("A267");
  const ext = E.exts.find((x) => x.name === "p7-onedrive");
  const files = async () => (await onedrive.plansList([a267.id]))[String(a267.id)].files;
  const fresh = async (name) => {
    const f = (await files()).find((x) => x.name === name);
    const fx = ext.setPlanFixture("A267", new Blob([bytesOf(5000, 11)]), name);
    return Object.assign({}, f, { size: fx.size, version: fx.version, modified: (await files()).find((x) => x.id === f.id).modified, full: fx.full });
  };
  // (the engine's clock: OneDrive's and the broker's together - passTime moves the broker's alone)
  const past = (ms) => { shift += ms; };
  const upload = async (plan, raw) => {
    const s = await onedrive.planSaveSession({ projectId: a267.id, itemId: plan.id, version: plan.version, size: raw.length, name: plan.name });
    for (const [a, z] of [[0, 327679], [327680, raw.length - 1]]) ext.http("PUT", s.uploadUrl, { "Content-Range": "bytes " + a + "-" + z + "/" + raw.length }, new Blob([raw.subarray(a, z + 1)]));
    return s;
  };
  const has = (op, line) => ext.logLines().includes("onedrive " + op + ": " + line);
  const BACK_LOST = "crossed: the office save was put back (the restore's answer was lost; the version history shows it)";
  const LOST = "crossed: the restore's answer was lost: checking again";
  const restores = (plan) => ext.versionsOf(plan.id).filter((v) => v.app === "demo-app-dcr-portal-onedrive").length;
  try {
    as("admin");
    // a proved crossing (OneDrive committed at the last chunk over an office save X), its one restore gone through
    let n = 0;
    const crossed = async (modes) => {
      ext.graphModes(Object.assign({ reset: true, deferCommit: "ignored" }, modes));
      const pl = await fresh("A267 Rev 2.takeoff");
      past(3000);
      ext.duringUpload(pl.full, "office");
      const raw = bytesOf(327680 + 170 + (++n), 97);
      const s = await upload(pl, raw);
      await ext.hashed();
      const ask = (op) => refusal(op === "plan_save_commit"
        ? onedrive.planSaveCommit({ projectId: a267.id, itemId: pl.id, ticket: s.ticket, uploadUrl: s.uploadUrl, hash: QX.quickXorHash(raw), landed: true })
        : onedrive.planSaveDone(a267.id, pl.id, s.ticket, QX.quickXorHash(raw)));
      return { pl, raw, ask };
    };
    for (const op of ["plan_save_commit", "plan_save_done"]) {
      for (const how of [504, 503, "timeout"]) {
        const name = op + ", gone through, answered " + how;
        const c = await crossed({ restoreLost: how });
        ext.logLines(true);
        const r0 = restores(c.pl);
        const e = await c.ask(op);
        assert.deepEqual([e.code, e.status, e.info && e.info.why], op === "plan_save_commit" ? ["plan_changed", 409, "changed"] : ["not_saved", 409, undefined], name + ": " + JSON.stringify(ext.logLines()));
        assert.ok(has(op, BACK_LOST), name + ": " + JSON.stringify(ext.logLines()));
        assert.ok(!ext.logLines().some((l) => /newer save|by hand/.test(l)), name);
        assert.match((await files()).find((x) => x.id === c.pl.id).version, /^qx:demo-office-/, name + ": the office save is the plan again");
        assert.equal(restores(c.pl), r0 + 1, name + ": one restore (the version put back names this app)");
        // Portal 2's words for it: the broker's proof - the copy words (changed), or a plain not_saved (the save goes again)
        assert.equal(op === "plan_save_commit" ? lib.copyWhyOf(e.info.why) : lib.notSavedWhyOf(e.info && e.info.why), op === "plan_save_commit" ? "changed" : "", name);
      }
    }
    // the checker's R2: a later page past the 30 minutes, the restore gone through but answered 504 - the plain not_saved,
    // never not_put_back (the office save is the plan again)
    {
      const c = await crossed({ restoreLost: 504 });
      past(31 * 60 * 1000);
      ext.logLines(true);
      const e = await c.ask("plan_save_done");
      assert.deepEqual([e.code, e.info && e.info.why], ["not_saved", undefined], "R2: " + JSON.stringify(ext.logLines()));
      assert.ok(has("plan_save_done", BACK_LOST) && !ext.logLines().some((l) => /could not be put back|by hand/.test(l)), "R2: " + JSON.stringify(ext.logLines()));
    }
    // not gone through, its answer lost (a 503, a 429, a 500): 503 checking with the lost answer's line; the retry tries once
    // more; at the 30 minutes, this save still the newest: not_put_back
    for (const status of [503, 429, 500]) {
      for (const op of ["plan_save_commit", "plan_save_done"]) {
        const name = op + ", " + status + ", not gone through";
        const c = await crossed({ restoreStatus: status });
        ext.logLines(true);
        const r0 = restores(c.pl);
        const w1 = await c.ask(op);
        assert.deepEqual([w1.code, w1.status, w1.info && w1.info.why, lib.checkWaitOf(w1), lib.answerLostOf(w1)], ["busy", 503, "checking", true, false], name);
        assert.ok(has(op, LOST), name + ": " + JSON.stringify(ext.logLines()));
        assert.equal(restores(c.pl), r0, name + ": nothing put back");
        past(31 * 60 * 1000);
        ext.logLines(true);
        const w2 = await c.ask(op);
        assert.deepEqual([w2.code, w2.info && w2.info.why], [op === "plan_save_commit" ? "plan_changed" : "not_saved", "not_put_back"], name + ": " + JSON.stringify(ext.logLines()));
        assert.ok(has(op, "crossed: the office save could not be put back: put it back by hand from the version history"), name);
      }
    }
    // a plain refusal (423) before the bound: as before - the refusal's own line, asked again
    {
      const c = await crossed({ restoreStatus: 423 });
      ext.logLines(true);
      const w = await c.ask("plan_save_commit");
      assert.deepEqual([w.code, w.info && w.info.why], ["busy", "checking"]);
      assert.ok(has("plan_save_commit", "crossed: the office save could not be put back (423): asked again"), JSON.stringify(ext.logLines()));
    }
  } finally {
    ext.graphModes({ reset: true });
    ext.passTime(0);
    as("admin");
  }
});

test("a save is never adopted while another deferred replace of it is open (contract addendum 6 H2): a copy of the save a later page finds landed waits until the replace's session is settled - that session is asked of the broker in the same pass, never dropped, nothing new sent; once the broker settles it, the copy is adopted", async () => {
  const a = await landedElsewhere(74);
  const cur = ROW();
  const copy = { id: "01FAKECOPY0074", name: COPY1, folder: F1.folder, size: cur.local.size, modified: AT, version: "qx:" + a.hash, rev: 1 };
  a.w.files.push(copy);
  a.st.set(KEY, Object.assign({}, cur, { local: Object.assign({}, cur.local, { sends: [{ file: cur.local.file, ticket: "tk98", mode: "copy", name: COPY1, size: cur.local.size, at: AT,
    hash: a.hash }].concat(cur.local.sends) }) }));
  const copyAns = () => ok({ saved: true, mode: "copy", id: copy.id, name: copy.name, size: copy.size, modified: copy.modified, version: copy.version });
  const done = () => a.w.bodies.filter((b) => b.op === "plan_save_done").map((b) => b.ticket);
  const toasts = toastsOn();
  try {
    // the copy found (tk98), the replace's session (tk99) refused now (403): the copy waits, tk99 waits
    a.w.doneQueue.push(copyAns(), http(403, { error: "forbidden", message: "made up" }));
    const e1 = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    assert.deepEqual([e1 && e1.code, done(), ROW().local.code, ROW().local.sends.map((s) => s.ticket), ROW("u1|" + copy.id)],
      ["unsettled", ["tk98", "tk99"], "unsettled", ["tk98", "tk99"], null], "nothing adopted, nothing dropped, tk99 asked in the same pass");
    assert.equal(a.w.calls.indexOf("plan_save_session"), -1, "nothing new sent");
    // tk99 settled (the broker's plain not_saved: the plan never held it) - the copy still waited in that pass
    a.w.doneQueue.push(copyAns(), http(409, { error: "not_saved", message: "OneDrive did not get the whole file - send it again." }));
    const e2 = await LIB.sendSaved(F1.id, { manual: true }).then(() => null, (x) => x);
    assert.deepEqual([e2 && e2.code, ROW().local.sends.map((s) => s.ticket), ROW("u1|" + copy.id)], ["unsettled", ["tk98"], null]);
    // the next pass adopts it
    a.w.doneQueue.push(copyAns());
    const out = await LIB.sendSaved(F1.id, { manual: true });
    assert.deepEqual([out.sent, out.mode, ROW().local, !!ROW("u1|" + copy.id), a.w.calls.indexOf("plan_save_session")], [true, "copy", null, true, -1]);
    assert.deepEqual(toasts, [lib.copyTold(COPY1, "iPad")], "told on the broker's proof (tk99's plain not_saved)");
  } finally { delete globalThis.DCR2; }
});
