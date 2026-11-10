// The shoot schedule page (site/js/pages/shoots.js) DRIVEN in node over the demo database (tools/fake/p10-photo.js on
// engine.js: the migration's tables, row level security, RPCs, SQLSTATEs and hints, and the demo's office computer -
// switched to by-hand here: pc.run() takes and answers what waits) with a small DOM (tests/console/console-page-dom.mjs:
// the markup the page writes is parsed into a real tree; clicks and changes bubble as in a browser):
// * a photographer: the Agenda, a shoot's sheet, Move… with the three choices ("Only this shoot" preselected), a day from
//   the strip, the preview listing every shoot that moves (from -> to) and what stays, Apply with the rev the screen read,
//   "Waiting for the office computer" with Cancel, the office computer's answer read again: Applied, the history entry;
// * PT409: someone changed the plan meanwhile -> "Someone changed this plan meanwhile - here is the new preview", the new
//   rev, then Apply goes; never a silent overwrite;
// * a Firm job date by a photographer: the sheet says the office approves, Apply reads "Send to the office", the office
//   computer answers "suggested";
// * Mark done (a note), Undo my last change, Cancel while new;
// * marketing reads only (no action button); someone not on the team reads nothing; a database without the schedule;
// * deep links (?shoot=, ?task=, ?plan=, an archived plan's shoot, one that is not there); the office computer off;
// * the Month grid and By job; the mirror's words through the money masks and as text (no element from the data).
// Made-up people and shoots only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as common2 from "../site/js/common2.js";
import { makeDom, scan, EVIL } from "./console/console-page-dom.mjs";
import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as repo from "../site/js/repo/photo.js";
import * as V from "../site/js/map/shoots.js";
import { NOT_READY_TEXT } from "../site/js/map/photo.js";

const skip = !available && "the demo database (tools/fake) is not here";
const AMOUNT = /\$\s?\d/;
const HTML = readFileSync(new URL("../site/shoots.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const BODY = /<body>([\s\S]*)<\/body>/.exec(HTML)[1].replace(/<script[\s\S]*?<\/script>/g, "");

/* the browser stand-in: the page module is imported only once it is there */
const toasts = [];
let confirmAnswer = true;
globalThis.Node = class { static [Symbol.hasInstance](x) { return !!x && typeof x.nodeType === "number"; } };
const DCR2 = Object.assign({}, common2.DCR2, { toast: (t, k) => { toasts.push([String(t), k]); }, confirm: async () => confirmAnswer });
globalThis.window = { DCR2, __SH_TEST__: true, addEventListener() {}, removeEventListener() {}, matchMedia: null,
  location: { search: "", reload() {} }, history: { state: null, replaceState() {}, pushState() {}, back() {} } };
globalThis.document = makeDom("<!doctype html><html><head></head><body>" + BODY + "</body></html>");
const page = await import("../site/js/pages/shoots.js");
const S = page._test.state;

const tick = () => new Promise((r) => setTimeout(r, 5));
async function until(fn, ms, what) {
  const end = Date.now() + (ms || 4000);
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error("timed out: " + (what || fn.toString().slice(0, 120))); await tick(); }
}
const $ = (id) => document.getElementById(id);
const text = (id) => ($(id) ? $(id).textContent : "");
const ext = (E) => E.exts.find((x) => x.name === "p10-photo");
const pc = (E) => ext(E).__dev.pc;

async function engine() {
  const E = await freshEngine(new Date());
  pc(E).state({ auto: false });           // the office computer answers only when a test says so
  return E;
}
async function as(E, key, wrap) {
  const p = await person(key);
  const c = clientAs(E, p.id);
  useClient(wrap ? wrap(c) : c);
  return { id: p.id, name: p.name, role: p.role, active: true };
}
async function open(E, key, search, wrap) {
  page._test.reset();
  document.body.innerHTML = BODY;
  toasts.length = 0;
  confirmAnswer = true;
  repo.useKeyStore(null);
  const me = await as(E, key, wrap);
  await page.init(me, { search: search || "", watch: false });
  return me;
}
const planBy = (code) => S.plans.find((p) => p.projectCode === code);
const shootBy = (code, key) => S.shoots.find((s) => s.planId === planBy(code).id && s.key === key);
function click(sel, root) {
  const n = (root || document).querySelector(sel);
  assert.ok(n, "nothing matches " + sel);
  n.click();
  return n;
}
function radio(name, value) {
  const r = document.querySelectorAll('input[name="' + name + '"]').find((x) => x.getAttribute("value") === value);
  assert.ok(r, name + "=" + value);
  r.checked = true;
  r.dispatchEvent({ type: "change" });
  return r;
}
/** A day in the Move sheet's strip that is a shoot day, not the shoot's own day, `skip` days on. */
function pickDay(skipN) {
  const days = document.querySelectorAll("#mvDay [data-act=pick]").filter((b) => !/\boff\b/.test(b.className) && !/\bcur\b/.test(b.className));
  const b = days[skipN || 0];
  assert.ok(b, "a day to pick");
  b.click();
  return b.getAttribute("data-day");
}
const previewText = () => text("mvPreview");
const ready = () => until(() => S.mv && !S.mv.pending && (S.mv.words || S.mv.pvError) && !$("mvApply").disabled === !!(S.mv.words && S.mv.words.ok), 4000, "the preview");

test("a photographer: the Agenda, a shoot, Move… (three choices, Only this shoot preselected), the preview of every shoot, Apply with the screen's rev, waiting, then Applied", { skip }, async () => {
  const E = await engine();
  const me = await open(E, "field");
  assert.equal(text("shLead"), V.EDIT_TEXT);
  assert.match(text("shWho"), /photographer \(the default photographer\)/);
  assert.equal($("shPc").hidden, true, "the office computer is on: no line");
  const groups = document.querySelectorAll("#shList .sh-grp > h3, #shList .sh-grp > summary").map((n) => n.firstChild.textContent.trim());
  assert.deepEqual(groups.slice(0, 2), ["Late", "Today"]);
  assert.ok(groups.includes("Done & closed"), "folded at the end");
  assert.ok(document.querySelector("details.sh-grp.closed") && !document.querySelector("details.sh-grp.closed").open, "Done & closed is folded");
  const plan = planBy("A000T9");
  const bf = shootBy("A000T9", "before-framing");
  click('#shList [data-shoot="' + bf.id + '"]');
  assert.equal(S.sel, bf.id);
  assert.match(text("shDScroll"), /Before framing/);
  assert.match(text("shDScroll"), /2 days before Framing start \([A-Z][a-z]{2} [A-Z][a-z]{2} \d+(, \d{4})? · Firm\)/, "the job date's day, its name said once");
  assert.ok($("shDScroll").querySelector('[data-act="move"]') && $("shDScroll").querySelector('[data-act="done"]'), "Move… and Mark done…");
  click('#shDScroll [data-act="move"]');
  const kinds = document.querySelectorAll('input[name="mvKind"]');
  assert.deepEqual(kinds.map((r) => [r.getAttribute("value"), r.checked]), [["move_one", true], ["move_later", false], ["milestone", false]], "Only this shoot preselected");
  assert.deepEqual(document.querySelectorAll("#mvChoices .mv-choice b").map((b) => b.textContent), ["Only this shoot", "This shoot and the later ones", "The job date moved"]);
  assert.ok($("mvApply").disabled, "nothing to apply before a day is picked");
  assert.match(previewText(), /Pick the new day/);
  radio("mvKind", "move_later");
  const day = pickDay(1);
  await ready();
  const w = S.mv.words;
  assert.ok(w.ok && w.moved.length > 1, "the later ones move too");
  for (const m of w.moved) assert.ok(previewText().includes(m.name) && previewText().includes(m.fromText + " → " + m.toText), m.name);
  assert.match(previewText(), /Will move \(\d+\)/);
  assert.match(previewText(), /Stays \(\d+\)/);
  assert.match(previewText(), /Drone airspace check Set to its own day - stays/);
  assert.match(previewText(), /Framing progress visits will be re-planned|Will move/);
  assert.equal($("mvApply").textContent, "Apply");
  const before = E.rows.photo_changes.length;
  click("#mvApply");
  await until(() => toasts.some((t) => /^Sent - /.test(t[0])), 4000, "sent");
  const row = E.rows.photo_changes[before];
  assert.deepEqual([row.kind, row.args.shoot, row.args.to, row.base_rev, row.status, row.requested_by], ["move_later", "before-framing", day, plan.rev, "new", me.id]);
  assert.equal(S.mv, null, "the sheet closed");
  assert.match(text("shDScroll"), /Your change: Move Before framing to .* - and the later ones/);
  assert.match(text("shDScroll"), /Waiting for the office computer/);
  assert.ok($("shDScroll").querySelector('[data-act="cancel-change"]'), "Cancel while it is new");
  assert.ok(!$("shDScroll").querySelector('[data-act="move"]'), "no second move of it while one waits");
  // the office computer takes and applies it; the page reads again (the watch, here by hand)
  assert.ok(pc(E).run() >= 1);
  await page._test.load({ quiet: true });
  const moved = S.shoots.find((s) => s.id === bf.id);
  assert.equal(moved.plannedDate, day);
  assert.ok(toasts.some((t) => /^Applied - \d+ shoots? moved/.test(t[0])), JSON.stringify(toasts));
  assert.match(text("shDScroll"), /Your recent changes/);
  assert.match(text("shDScroll"), /Applied/);
  assert.match(text("shDScroll"), /by Jordan on the shoot schedule/);
  assert.ok($("shDScroll").querySelector('[data-act="undo"]'), "Undo my last change…");
  assert.deepEqual(scan(document.body), []);
});

test("PT409: someone changed the plan meanwhile - the page says so, shows the new preview and sends the new rev; never a silent overwrite", { skip }, async () => {
  const E = await engine();
  await open(E, "field");
  const dc = shootBy("A000T9", "drone-check");
  const rev0 = planBy("A000T9").rev;
  click('#shList [data-shoot="' + dc.id + '"]');
  click('#shDScroll [data-act="move"]');
  pickDay(2);
  await ready();
  const first = S.mv.words.moved[0].fromText;
  // meanwhile the office moves the same shoot (another account), and the office computer applies it
  const admin = await person("admin");
  useClient(clientAs(E, admin.id));
  const away = new Date(Date.parse(dc.plannedDate + "T12:00:00Z") + 9 * 86400000).toISOString().slice(0, 10);
  await repo.request(dc.planId, "move_one", { shoot: "drone-check", to: away }, rev0, { key: "office-move-001" });
  pc(E).run();
  const me = await person("field");
  useClient(clientAs(E, me.id));
  const before = E.rows.photo_changes.length;
  click("#mvApply");
  await until(() => S.mv && S.mv.msg === V.CHANGED_TEXT, 4000, "changed said");
  assert.equal(text("mvMsg"), "Someone changed this plan meanwhile - here is the new preview.");
  assert.equal(E.rows.photo_changes.length, before, "nothing was queued");
  await ready();
  assert.ok(S.mv.baseRev > rev0, "the new rev the screen read");
  assert.notEqual(S.mv.words.moved[0].fromText, first, "the new preview starts from the shoot's new day");
  click("#mvApply");
  await until(() => toasts.some((t) => /^Sent - /.test(t[0])), 4000, "sent");
  assert.equal(E.rows.photo_changes[before].base_rev, S.plans.find((p) => p.id === dc.planId).rev);
});

test("a Firm job date by a photographer: the sheet says the office approves first, Apply reads Send to the office, the answer is suggested", { skip }, async () => {
  const E = await engine();
  await open(E, "field");
  const bf = shootBy("A000T9", "before-framing");
  click('#shList [data-shoot="' + bf.id + '"]');
  click('#shDScroll [data-act="move"]');
  radio("mvKind", "milestone");
  const ms = document.querySelectorAll('input[name="mvMs"]');
  assert.deepEqual(ms.map((r) => [r.getAttribute("value"), r.checked]), [["framing_start", true], ["delivery", false], ["framing_complete", false], ["house_complete", false]],
    "which job date: the one the shoot follows first");
  assert.equal(text("mvNote"), "This job date (Framing start) is Firm - your change goes to the office to approve");
  assert.match(text("mvDayLab"), /New day for Framing start/);
  pickDay(2);
  await ready();
  assert.match(previewText(), /This job date \(Framing start\) is Firm - your change goes to the office to approve/);
  assert.equal($("mvApply").textContent, "Send to the office");
  assert.ok(!$("mvFirmRow").textContent, "no Firm tick for a photographer");
  click("#mvApply");
  await until(() => toasts.some((t) => /office to approve/.test(t[0])), 4000, "sent to the office");
  pc(E).run();
  await page._test.load({ quiet: true });
  assert.match(text("shDScroll"), /Sent to the office to approve/);
  assert.ok(toasts.some((t) => /^Sent to the office to approve/.test(t[0])));
  // an admin gets the Firm tick (its current flag) and a plain Apply
  await open(E, "admin");
  click('#shList [data-shoot="' + bf.id + '"]');
  click('#shDScroll [data-act="move"]');
  radio("mvKind", "milestone");
  assert.equal(text("mvNote"), "", "an admin's change applies");
  assert.ok($("mvFirm") && $("mvFirm").checked, "Firm, as it is now");
});

test("Mark done with a note; Undo my last change (the A000T8 move); Cancel a change while it is new", { skip }, async () => {
  const E = await engine();
  const me = await open(E, "field");
  const dc = shootBy("A000T9", "drone-check");
  click('#shList [data-shoot="' + dc.id + '"]');
  click('#shDScroll [data-act="done"]');
  assert.match(text("mvTitle"), /Mark Drone airspace check done/);
  assert.match(text("shSheet"), /is still ahead - mark it done only if it was shot/);
  $("dnNote").value = "All shots taken";
  click("#mvApply");
  await until(() => toasts.some((t) => /^Sent - /.test(t[0])), 4000, "done sent");
  const done = E.rows.photo_changes[E.rows.photo_changes.length - 1];
  assert.deepEqual([done.kind, done.args], ["done", { shoot: "drone-check", note: "All shots taken" }]);
  pc(E).run();
  await page._test.load({ quiet: true });
  assert.equal(S.shoots.find((s) => s.id === dc.id).status, "done");
  assert.ok(!$("shDScroll").querySelector('[data-act="move"]'), "a done shoot is not moved");
  // Undo: Jordan's applied move of A000T8's framing complete (two days ago)
  const fc = shootBy("A000T8", "framing-complete");
  click('#shList [data-shoot="' + fc.id + '"]');
  const undoBtn = click('#shDScroll [data-act="undo"]');
  assert.equal(undoBtn.getAttribute("data-change"), "1");
  await ready();
  assert.match(text("mvTitle"), /Undo this change\?/);
  assert.match(previewText(), /Goes back \(1\)/);
  assert.equal($("mvApply").textContent, "Undo");
  click("#mvApply");
  await until(() => toasts.some((t) => /^Sent - /.test(t[0])) && !S.mv, 4000, "undo sent");
  const undo = E.rows.photo_changes[E.rows.photo_changes.length - 1];
  assert.deepEqual([undo.kind, undo.args], ["undo", { change: 1 }]);
  pc(E).run();
  await page._test.load({ quiet: true });
  assert.equal(E.rows.photo_changes.find((c) => c.id === 1).undone_by, undo.id);
  assert.ok(!$("shDScroll").querySelector('[data-act="undo"]'), "undone once");
  // Cancel while new
  const hc = shootBy("A000T8", "house-complete");
  click('#shList [data-shoot="' + hc.id + '"]');
  click('#shDScroll [data-act="move"]');
  pickDay(3);
  await ready();
  click("#mvApply");
  await until(() => $("shDScroll").querySelector('[data-act="cancel-change"]'), 4000, "the Cancel button");
  const id = Number($("shDScroll").querySelector('[data-act="cancel-change"]').getAttribute("data-change"));
  confirmAnswer = false;
  click('#shDScroll [data-act="cancel-change"]');
  await tick();
  assert.equal(E.rows.photo_changes.find((c) => c.id === id).status, "new", "kept when the person says Keep it");
  confirmAnswer = true;
  click('#shDScroll [data-act="cancel-change"]');
  await until(() => E.rows.photo_changes.find((c) => c.id === id).status === "cancelled", 4000, "cancelled");
  await until(() => toasts.some((t) => t[0] === "Cancelled - nothing changed."), 4000);
  assert.equal(E.rows.photo_changes.find((c) => c.id === id).requested_by, me.id);
});

test("marketing reads only (no action button); someone not on the team reads nothing; a database without the schedule says so", { skip }, async () => {
  const E = await engine();
  await open(E, "viewer");
  assert.equal(text("shLead"), V.READ_ONLY_TEXT);
  assert.match(text("shWho"), /marketing - read only/);
  const fc = shootBy("A000T8", "framing-complete");
  click('#shList [data-shoot="' + fc.id + '"]');
  assert.match(text("shDScroll"), /Framing complete/);
  assert.equal($("shDScroll").querySelectorAll("[data-act=move], [data-act=done], [data-act=undo], [data-act=cancel-change]").length, 0, "no action button");
  assert.equal(document.querySelectorAll("#shRoot [data-act=move]").length, 0);
  // someone not on the team: told so, nothing of the mirror read
  const asked = [];
  await open(E, "manager", "", (c) => ({ from: (t) => { asked.push(t); return c.from(t); }, rpc: (n, a) => { asked.push("rpc:" + n); return c.rpc(n, a); } }));
  assert.equal(text("shLead"), "", "the box says it - once, not in the header too");
  assert.match(text("shList"), /Not for your account/);
  assert.equal(text("shRoot").split(V.NO_ACCESS_TEXT).length - 1, 1, "said once");
  assert.deepEqual(asked, ["rpc:photo_my_access"], "only the gate was asked");
  assert.equal($("shBar").hidden, true);
  // a database without the migration (42883 / PGRST202): plain words, nothing more asked
  const asked2 = [];
  await open(E, "field", "", (c) => ({ from: (t) => { asked2.push(t); return c.from(t); }, rpc: (n, a) => {
    asked2.push("rpc:" + n);
    return n === "photo_my_access" ? Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function", status: 404 } }) : c.rpc(n, a);
  } }));
  assert.equal(text("shLead"), "", "the box says it - once, not in the header too");
  assert.match(text("shList"), /Not in the database yet/);
  assert.equal(text("shRoot").split(NOT_READY_TEXT).length - 1, 1, "said once");
  assert.deepEqual(asked2, ["rpc:photo_my_access"]);
});

test("deep links: ?shoot= (DCR Agents 2's reminders), ?task= (a My Tasks task's shoot), ?plan=, an archived plan's shoot, one that is not there", { skip }, async () => {
  const E = await engine();
  const t9 = E.rows.photo_plans.find((p) => p.project_code === "A000T9");
  const dl = E.rows.photo_shoots.find((s) => s.plan_id === t9.id && s.key === "delivery");
  await open(E, "field", "?shoot=" + dl.id);
  assert.equal(S.sel, dl.id);
  assert.ok(S.open, "opened");
  assert.match(text("shDScroll"), /Delivery day/);
  assert.match(text("shDScroll"), /Moved - not told yet/);
  // a My Tasks task: the heads-up's task of the lot shoot
  const task = E.rows.tasks.find((t) => t.agent_kind === "photo" && t.status === "open" && E.rows.photo_shoots.some((s) => s.task_id === t.id));
  assert.ok(task, "the seed links a photo task to a shoot");
  const lot = E.rows.photo_shoots.find((s) => s.task_id === task.id);
  await open(E, "field", "?task=" + task.id);
  assert.equal(S.sel, lot.id);
  assert.deepEqual(await repo.shootForTask(task.id), { id: lot.id, planId: lot.plan_id });
  assert.equal(await repo.shootForTask(999999), null);
  await open(E, "field", "?task=999999");
  assert.equal(S.msg, V.TASK_GONE_TEXT);
  assert.match(text("shList"), /This task's shoot is not on the shoot schedule/);
  // a plan: By job with that plan only
  const t8 = E.rows.photo_plans.find((p) => p.project_code === "A000T8");
  await open(E, "field", "?plan=" + t8.id);
  assert.equal(S.view, "job");
  assert.equal(S.planFocus, t8.id);
  assert.deepEqual(document.querySelectorAll("#shList .sh-plan").map((n) => n.getAttribute("data-plan")), [String(t8.id)]);
  assert.match(text("shList"), /← All jobs/);
  assert.match(text("shList"), /Framing complete .* · Firm/);
  click('#shList [data-act="all-jobs"]');
  assert.ok(document.querySelectorAll("#shList .sh-plan").length >= 3, "every live job again");
  // an archived plan's shoot: shown, and the archived plans with it
  const t7 = E.rows.photo_plans.find((p) => p.project_code === "A000T7");
  const old = E.rows.photo_shoots.find((s) => s.plan_id === t7.id);
  await open(E, "field", "?shoot=" + old.id);
  assert.equal(S.sel, old.id);
  assert.equal(S.archived, true);
  assert.match(text("shDScroll"), /Archived/);
  await open(E, "field", "?shoot=987654");
  assert.equal(S.msg, V.GONE_TEXT);
  assert.equal(S.sel, null);
});

test("the office computer off: the header says so in plain words, and a change sent says it waits", { skip }, async () => {
  const E = await engine();
  pc(E).state({ offline: true, offlineMinutes: 125 });
  await open(E, "field");
  assert.equal($("shPc").hidden, false);
  assert.equal(text("shPc"), "The office computer is off - changes wait until it is back on (last seen 2 h ago)");
  const dc = shootBy("A000T9", "drone-check");
  click('#shList [data-shoot="' + dc.id + '"]');
  click('#shDScroll [data-act="move"]');
  pickDay(0);
  await ready();
  click("#mvApply");
  await until(() => toasts.some((t) => t[0] === "Sent - it waits until the office computer is back on."), 4000, "waits");
  assert.match(text("shDScroll"), /The office computer is off - changes wait until it is back on/);
  pc(E).state({ offline: false, paused: true });
  await page._test.load({ quiet: true });
  assert.equal(text("shPc"), "DCR Agents 2 is paused on the office computer - changes wait until it runs again");
});

test("the Month grid (Sunday first, a day's shoots) and By job (each plan's job dates, Firm)", { skip }, async () => {
  const E = await engine();
  await open(E, "admin");
  click('#shViews [data-view="month"]');
  assert.equal(S.view, "month");
  assert.deepEqual(document.querySelectorAll("#shList .sh-wd").map((n) => n.textContent), ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  assert.ok($("shLayout").classList.contains("month"), "the Month view takes the wide side");
  const today = S.today;
  click('#shList [data-act="day"][data-day="' + today + '"]');
  assert.match(text("shDayList"), /Lot before work/);
  const next = click('#shList [data-act="month-next"]');
  assert.ok(next);
  assert.notEqual(S.month, today.slice(0, 7));
  click('#shList [data-act="month-today"]');
  assert.equal(S.month, today.slice(0, 7));
  const ev = document.querySelector("#shList .sh-ev");
  ev.click();
  assert.equal(S.sel, Number(ev.getAttribute("data-shoot")));
  click('#shViews [data-view="job"]');
  const heads = document.querySelectorAll("#shList .sh-plan-hd .sh-plan-t b").map((n) => n.textContent);
  assert.deepEqual(heads.slice().sort(), ["A000T6 Sample porch", "A000T8 Made-up garage", "A000T9 Sample house"]);
  assert.match(text("shList"), /Framing start .* · Firm/);
  assert.match(text("shList"), /In review/, "a plan in review says so");
  $("shArchived").checked = true;
  $("shArchived").dispatchEvent({ type: "change" });
  assert.ok(text("shList").includes("A000T7 Old sample deck"), "archived plans when asked");
});

test("the mirror's words through the money masks and as text: no amount, no element from the data", { skip }, async () => {
  const E = await engine();
  const t9 = E.rows.photo_plans.find((p) => p.project_code === "A000T9");
  t9.project_label = "A000T9 " + EVIL;
  const dc = E.rows.photo_shoots.find((s) => s.plan_id === t9.id && s.key === "drone-check");
  dc.name = "Drone " + EVIL + " $1,200";
  dc.history = [{ at: new Date().toISOString(), from: dc.planned_date, to: dc.planned_date, reason: "Paid $3,400 deposit <a href=//evil.example>x</a>", source: "admin", by: "Avery" }];
  dc.brief = { purpose: "Show the $2,500 deck " + EVIL, shots: [{ title: "Wide " + EVIL, description: "4,800 dollars", kind: "photo", priority: "must" }] };
  await open(E, "field");
  click('#shList [data-shoot="' + dc.id + '"]');
  assert.ok(text("shDScroll").includes(EVIL), "the markup is shown as text");
  assert.deepEqual(scan(document.body), [], "no element from the data");
  const all = document.body.textContent;
  assert.ok(!AMOUNT.test(all), "no amount: " + (all.match(/.{0,30}\$\s?\d.{0,10}/) || [""])[0]);
  assert.ok(!/1,200|3,400|2,500/.test(all), "the amounts are masked");
  click('#shDScroll [data-act="move"]');
  assert.ok(text("mvTitle").includes(EVIL) && !AMOUNT.test(text("mvTitle")));
  assert.deepEqual(scan(document.body), []);
});
