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
    assert.deepEqual(got[String(a001.id)], { number: "A001", files: [], complete: true, saveBack: false }, key + ": the demo broker (as an older broker) says no save_back");
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
            return await onedrive.planSaveCommit({ projectId: job.projectId, itemId: job.meta.itemId, ticket: job.session.ticket, uploadUrl: job.session.uploadUrl, hash: job.meta.hash });
          } catch (x) { if (x && x.code === "plan_changed") { job.meta.mode = "copy"; x.restart = true; } throw x; }
        },
        find: async () => [],
      },
      setTimeout: (fn) => setTimeout(fn, 0), wait: () => 1,
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
  assert.match(job.result.version, /^sm:\d+:/, "no hash yet: the sm: form");
  await ext.hashed();
  const after = (await onedrive.plansList([a267.id]))[String(a267.id)].files.find((f) => f.id === plan.id);
  assert.equal(after.version, "qx:" + hash, "then OneDrive's quickXorHash of the bytes - the device's own");
  // a device whose base is that answer's sm: form (OneDrive has hashed the bytes since): the same bytes - a replace (BRK-7)
  const sm = await onedrive.planSaveSession({ projectId: a267.id, itemId: plan.id, version: job.result.version, size: 5, name: plan.name });
  assert.deepEqual([sm.mode, sm.commit], ["replace", "broker"], "sm:<size>:<time> of the plan now is its version");
  assert.deepEqual([after.size, after.modified], [bytes.size, job.result.modified], "the same bytes...");
  assert.ok(/^qx:/.test(after.version) && lib.keptAs({ file: "p1-a-1.takeoff", version: job.result.version, size: bytes.size,
    expect: lib.expectOf(job.result) }, after), "...under OneDrive's hash: taken without a download");
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
    w.refuse's error; w.needHash - plan_save_done without a hash: 409 not_saved {need: "hash"}. */
function saveWorld(o) {
  const w = Object.assign({ calls: [], bodies: [], sessions: new Map(), n: 0, refuse: null, hash: false, loseFinal: false, puts: 0, bytes: 0,
    deferred: false, realHash: false, commitRefuse: false, loseCommit: false, expired: false, during: null, landAtChunk: false, refusedAll: false,
    commitWhy: null, refuseField: null, needHash: false }, o || {});
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
      return saved(f.id === s.item ? "replace" : "copy", f);
    }
    if (b.op === "plan_save_done") {
      if (w.expired) return http(400, { error: "invalid", field: "ticket", message: "This save's ticket is not valid or has run out: save the plan again." });
      if (w.needHash && !b.hash) return http(409, { error: "not_saved", need: "hash", message: "This save can be checked now only with the file's hash - send it again with the hash." });
      const s = Array.from(w.sessions.values()).find((x) => x.ticket === b.ticket);
      const f = s && s.done ? w.files.find((x) => x.id === s.done) : null;
      if (!f || f.id !== b.item_id) return http(409, { error: "not_saved", message: "OneDrive did not get the whole file - send it again." });
      // the hashes decide when both are there (only real ones: w.realHash - a made-up "qx:SAVED" is no hash of anything)
      if (b.hash && w.realHash && f.version.indexOf("qx:") === 0 && f.version !== "qx:" + b.hash) return http(409, { error: "not_saved", message: "OneDrive did not get the whole file - send it again." });
      return ok(Object.assign({ saved: true, mode: s.mode === "replace" && f.id === s.item ? "replace" : "copy" }, file(f)));
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
  });
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
  assert.deepEqual(news.find((n) => n[0] === "copy"), ["copy", { name: "A900 Bid - iPad 2026-11-04 1030.takeoff" }]);
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
  assert.deepEqual(news.find((n) => n[0] === "copy"), ["copy", { name: "A900 Bid - iPad 2026-11-04 1030.takeoff" }]);
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

test("a commit whose answer was lost: in the page the commit is asked again (nothing sent again); across pages the save is settled with plan_save_done and its hash (review BRK-3, TICKET-1, LW-7) - and past the broker's 30 days it is found by its hash alone, never sent again as a copy of itself", async () => {
  await devicePlan();
  const w = saveWorld({ deferred: true, realHash: true, loseCommit: true });
  const p = savedProject(2 * MiB + 3, "PDFCACHE1", 7);
  const sent = await (await LIB.keepSave(F1.id, saveOf(p))).sent;
  assert.deepEqual([sent && sent.mode, w.calls, w.bytes], ["replace", ["plan_save_session", "plan_save_commit", "plan_save_commit"], p.blob.size]);
  assert.equal(ROW().local, null);
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
  assert.deepEqual([lib.LONG_WAIT_MS, lib.LONG_WAIT.slice().sort()], [30 * 60 * 1000, ["not_deployed", "save_back_off"]]);
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

test("why OneDrive made a copy (addendum 3 D5): plan_changed {why: \"refused\"} - OneDrive would not replace the plan - is told without blaming the office (and the takeoff app hears no 'copy' news, whose words say the office saved), here and when settled in a later page; no why (an older broker) or \"changed\" - the copy words", async () => {
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
    // an older broker (no why), or "changed": the copy words
    for (const why of [null, "changed"]) {
      toasts.length = 0;
      await devicePlan();
      const w2 = saveWorld({ deferred: true, realHash: true, commitRefuse: true, commitWhy: why });
      w2.during = () => officeSave(w2);
      const n2 = [];
      await (await LIB.keepSave(F1.id, saveOf(savedProject(1 * MiB + 29, "PDFCACHE1", 36)), (state, extra) => n2.push([state, extra]))).sent;
      assert.deepEqual(toasts, [lib.copyTold("A900 Bid - iPad 2026-11-04 1030.takeoff", "iPad")], String(why));
      assert.ok(n2.some((n) => n[0] === "copy"), String(why));
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
  assert.deepEqual(b.w2.calls, ["plan_save_done"], "asked once, without a hash - never a new session");
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
