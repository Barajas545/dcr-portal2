// The P3 review's findings (the photographer screen program; DCR Desktop 2 migration 20261110000100, the contract DCR
// Desktop 2 docs/PHOTO-SCHEDULE.md), each pinned by a test that fails without its fix. The shoot schedule page and the
// Access tab's Photo team are DRIVEN in node over the demo database (tools/fake/p10-photo.js on engine.js: the RPCs, the
// row versions, PT409, the demo's office computer by hand) with the small DOM of tests/console/console-page-dom.mjs:
// * the Photo team: an unsaved line keeps the version it began from - a save of another line that moved the default (or
//   someone's save of that line) makes its old copy refused "changed", never written at the new version;
// * the Move sheet follows the mirror: a watch read redraws it from the new read and previews again; Apply asks the
//   preview once more and shows a different one instead of sending it; after a PT409 the shoot's day and the admin's
//   Firm box are the new read's, and an admin's untouched Firm is left to the database (the job date's current flag);
// * a phone: the new preview is brought into view and its count stands beside Apply;
// * a slow network: "Close (still sending)" while a change is on its way; a lost answer is worded as unknown, and the
//   second press is the same change (again: true) worded from what became of it;
// * the answers: named (the change and its job), told on the next visit when they came while the page was closed, and a
//   refusal marks the row "Not done - see why";
// * a poll or a watch read keeps the keyboard on its row and does not write the status regions again;
// * and the cheap low ones: the gates follow a photo team change, the task link only for who reads the task, a job-date
//   change waiting does not hold the shoots that follow it, "Asked … · answered …", Undo's label and its stale offer, an
//   expired change shown, the job date's own from -> to, the Home badge's count and link, the phone's Back with a sheet,
//   Home's re-render keeping its badges, the toasts above the sheet's footer.
// Made-up people and shoots only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as common2 from "../site/js/common2.js";
import { makeDom } from "./console/console-page-dom.mjs";
import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as repo from "../site/js/repo/photo.js";
import * as V from "../site/js/map/shoots.js";
import * as M from "../site/js/map/photo.js";
import * as A from "../site/js/map/access.js";
import { addDays } from "../site/js/map/pacific.js";

const skip = !available && "the demo database (tools/fake) is not here";
const read = (rel) => readFileSync(new URL("../site/" + rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const HTML = read("shoots.html");
const BODY = /<body>([\s\S]*)<\/body>/.exec(HTML)[1].replace(/<script[\s\S]*?<\/script>/g, "");

/* the browser stand-in (as tests/p10-photo-demo.test.mjs): the page module is imported only once it is there */
const toasts = [];
const pushed = [];
let backs = 0;
globalThis.Node = class { static [Symbol.hasInstance](x) { return !!x && typeof x.nodeType === "number"; } };
const DCR2 = Object.assign({}, common2.DCR2, { toast: (t, k) => { toasts.push([String(t), k]); }, confirm: async () => true });
globalThis.window = { DCR2, __SH_TEST__: true, addEventListener() {}, removeEventListener() {}, matchMedia: null,
  location: { search: "", reload() {} }, history: { state: null, replaceState() {}, pushState(s) { pushed.push(s); }, back() { backs += 1; } } };
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

/** A localStorage stand-in (what this device heard of my changes lives there). */
function freshStore() {
  const box = new Map();
  return { getItem: (k) => (box.has(k) ? box.get(k) : null), setItem: (k, v) => box.set(k, String(v)), removeItem: (k) => box.delete(k), box };
}
async function engine() {
  const E = await freshEngine(new Date());
  pc(E).state({ auto: false });
  return E;
}
async function as(E, key, wrap) {
  const p = await person(key);
  const c = clientAs(E, p.id);
  useClient(wrap ? wrap(c) : c);
  return { id: p.id, name: p.name, role: p.role, active: true };
}
/** Open the page as `key` (o.wrap: the client wrapped; o.keepStore: this device's storage kept from before). */
async function open(E, key, search, o) {
  const opt = o || {};
  page._test.reset();
  document.body.innerHTML = BODY;
  toasts.length = 0;
  pushed.length = 0;
  backs = 0;
  if (!opt.keepStore) window.localStorage = freshStore();
  repo.useKeyStore(null);
  const me = await as(E, key, opt.wrap);
  await page.init(me, { search: search || "", watch: false });
  return me;
}
const planBy = (codeName) => S.plans.find((p) => p.projectCode === codeName);
const shootBy = (codeName, key) => S.shoots.find((s) => s.planId === planBy(codeName).id && s.key === key);
const rowOf = (E, codeName, key) => {
  const p = E.rows.photo_plans.find((x) => x.project_code === codeName);
  return { plan: p, shoot: E.rows.photo_shoots.find((s) => s.plan_id === p.id && s.key === key) };
};
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
function pickDay(skipN) {
  const days = document.querySelectorAll("#mvDay [data-act=pick]").filter((b) => !/\boff\b/.test(b.className) && !/\bcur\b/.test(b.className));
  const b = days[skipN || 0];
  assert.ok(b, "a day to pick");
  b.click();
  return b.getAttribute("data-day");
}
const previewText = () => text("mvPreview");
const ready = () => until(() => S.mv && !S.mv.pending && !S.mv.busy && (S.mv.words || S.mv.pvError) && !$("mvApply").disabled === !!(S.mv.words && S.mv.words.ok), 4000, "the preview");
const later = (d, n) => addDays(d, n);

/* ── CONFIRMED: the Photo team's stale edit ───────────────────────────── */

test("the Photo team: an unsaved line keeps the version it began from - a save of another line that moved the default makes it refused 'changed', not saved at the new version", { skip }, async () => {
  const E = await engine();
  const admin = await as(E, "admin");
  const cam = await person("field");                // the default photographer (made-up)
  const dee = await person("manager");              // a second photographer
  await repo.setTeam(dee.id, { photographer: true, marketing: false, isDefault: false }, null);
  let team = await repo.team();
  const camRow = team.find((r) => r.profileId === cam.id);
  assert.ok(camRow.photographer && camRow.defaultPhotographer);
  const v1 = camRow.version;
  // the admin ticks Marketing on Cam's line and types an e-mail, and does not save it
  let edit = A.photoTick(A.photoStateOf(camRow), "marketing", true, { id: cam.id, team });
  edit = A.photoTick(edit, "googleEmail", "cam.example@example.com", { id: cam.id, team });
  assert.equal(edit.base, v1, "the edit keeps the version it began from");
  // then ticks Default on Dee's line and saves THAT: the database moves the default and Cam's row version goes up
  const deeRow = team.find((r) => r.profileId === dee.id);
  const deePerson = { id: dee.id, name: "Dee Example", active: true, row: deeRow };
  const deePay = A.photoPayload(deePerson, A.photoTick(A.photoStateOf(deeRow), "isDefault", true, { id: dee.id, team }), team);
  await repo.setTeam(dee.id, deePay.next, deePay.version);
  team = await repo.team();
  const cam2 = { id: cam.id, name: "Cam Example", active: true, row: team.find((r) => r.profileId === cam.id) };
  assert.ok(cam2.row.version > v1 && !cam2.row.defaultPhotographer, "Cam's row moved on");
  // Cam's old copy is stale: the card drops it (and says so); a save of it sends the version it began from
  assert.equal(A.photoStale(cam2, edit), true);
  const pay = A.photoPayload(cam2, edit, team);
  assert.equal(pay.version, v1, "the version the edit began from, never the one read since");
  await assert.rejects(repo.setTeam(cam.id, pay.next, pay.version), (e) => e.reason === "changed", "refused - never written over");
  team = await repo.team();
  assert.equal(team.find((r) => r.defaultPhotographer).profileId, dee.id, "the default the admin just saved stays");
  // an edit begun on the fresh row is not stale and is sent at that version
  const fresh = A.photoTick(A.photoStateOf(cam2.row), "marketing", true, { id: cam.id, team });
  assert.equal(A.photoStale(cam2, fresh), false);
  assert.equal(A.photoPayload(cam2, fresh, team).version, cam2.row.version);
  // a line with no row yet: begun at "no row" (null); a row made meanwhile is a stale edit too
  const riley = await person("lead");
  const add = A.photoTick(A.photoStateOf(null), "marketing", true, { id: riley.id, team });
  assert.equal(add.base, null);
  assert.equal(A.photoStale({ id: riley.id, row: null }, add), false);
  assert.equal(A.photoStale({ id: riley.id, row: { version: 1 } }, add), true);
  assert.equal(admin.role, "admin");
  // the card: a re-read drops every stale edit and says so on its line (PHOTO_STALE)
  const ad = code(read("js/pages/admin.js"));
  assert.match(ad, /P\.team = await photo\.team\(\);[\s\S]{0,700}photoStale\(x, P\.edits\[id\]\)[\s\S]{0,120}delete P\.edits\[id\];\s*if \(x\) P\.msgs\[id\] = PHOTO_STALE;/);
});

/* ── CONFIRMED: the Move sheet follows the mirror ─────────────────────── */

/** The office moves one of the shoots a move_later preview lists (not the target) by hand on the PC: its day and its rev
    move on with the plan's rev, the target's rev does not (§9.3) - photo_change_request's own "changed" check never sees it. */
function officeMovesAnother(E, codeName, key) {
  const { plan, shoot } = rowOf(E, codeName, key);
  plan.rev += 1;
  const d = later(shoot.planned_date, 2);
  shoot.planned_date = d;
  shoot.fixed_date = d;
  shoot.rev = plan.rev;
  return d;
}

test("the Move sheet: a watch read while it is open redraws it from the new read and previews again - the list beside Apply is the one that will be sent", { skip }, async () => {
  const E = await engine();
  await open(E, "field");
  const bf = shootBy("A000T9", "before-framing");
  click('#shList [data-shoot="' + bf.id + '"]');
  click('#shDScroll [data-act="move"]');
  radio("mvKind", "move_later");
  pickDay(1);
  await ready();
  const shown = V.previewSig(S.mv.pv);
  const other = S.mv.words.moved.find((m) => m.key !== "before-framing");
  assert.ok(other, "a later shoot moves with it");
  const oldLine = other.name + " " + other.fromText + " → " + other.toText;
  assert.ok(previewText().includes(other.fromText + " → " + other.toText));
  const rev0 = S.mv.baseRev;
  officeMovesAnother(E, "A000T9", other.key);
  await page._test.onWatch({ tables: ["photo_shoots", "photo_plans"], join: false });   // the Realtime watch, by hand
  await ready();
  assert.notEqual(V.previewSig(S.mv.pv), shown, "the preview was asked again");
  assert.ok(!previewText().includes(oldLine), "the old line is gone: " + previewText());
  assert.ok(S.mv.baseRev > rev0, "the new rev the sheet now shows");
  assert.equal(text("mvMsg"), V.CHANGED_TEXT, "said so");
  const before = E.rows.photo_changes.length;
  const sig = V.previewSig(S.mv.pv);
  click("#mvApply");
  await until(() => toasts.some((t) => /^Sent - /.test(t[0])), 4000, "sent");
  const row = E.rows.photo_changes[before];
  assert.equal(V.previewSig(row.preview), sig, "the queued change is exactly the preview shown");
});

test("the Move sheet: Apply asks the preview once more - a different answer is shown, not sent; then Apply sends what is shown", { skip }, async () => {
  const E = await engine();
  await open(E, "field");
  const bf = shootBy("A000T9", "before-framing");
  click('#shList [data-shoot="' + bf.id + '"]');
  click('#shDScroll [data-act="move"]');
  radio("mvKind", "move_later");
  pickDay(1);
  await ready();
  const shown = V.previewSig(S.mv.pv);
  const other = S.mv.words.moved.find((m) => m.key !== "before-framing");
  officeMovesAnother(E, "A000T9", other.key);                          // no watch read reaches the page
  const before = E.rows.photo_changes.length;
  click("#mvApply");
  await until(() => S.mv && S.mv.msg === V.CHANGED_TEXT, 4000, "changed said");
  assert.equal(E.rows.photo_changes.length, before, "nothing was queued: the shoots listed were not the ones that would move");
  await ready();
  assert.notEqual(V.previewSig(S.mv.pv), shown, "the new preview is shown");
  assert.equal(S.mv.baseRev, E.rows.photo_plans.find((p) => p.project_code === "A000T9").rev, "read again: the new rev");
  const sig = V.previewSig(S.mv.pv);
  click("#mvApply");
  await until(() => toasts.some((t) => /^Sent - /.test(t[0])), 4000, "sent");
  assert.equal(V.previewSig(E.rows.photo_changes[before].preview), sig);
  // the moment in between (the database's own preview of the queued change differs): sent, and said plainly
  assert.match(V.sentDiffers({ summary: "3 shoots move, 2 stay" }).text, /^Sent - but the schedule changed as it was sent, so it is not the preview you saw: 3 shoots move, 2 stay\. If that is not what you want, cancel it on the shoot while it waits\.$/);
  assert.equal(V.previewSig({ kind: "move_one", moved: [{ key: "a", from: "2026-11-10", to: "2026-11-11", notes: [], id: 1, name: "x" }] }),
    V.previewSig({ kind: "move_one", moved: [{ key: "a", from: "2026-11-10", to: "2026-11-11", notes: [] }], stays: [] }), "names and ids are not what was shown");
});

test("PT409: the shoot's day line is the new read's ('now Mon …'), not the old one", { skip }, async () => {
  const E = await engine();
  await open(E, "field");
  const dc = shootBy("A000T9", "drone-check");
  const rev0 = planBy("A000T9").rev;
  click('#shList [data-shoot="' + dc.id + '"]');
  click('#shDScroll [data-act="move"]');
  assert.match(text("mvNow"), new RegExp("now " + M.dayText(dc.plannedDate, S.today)));
  pickDay(2);
  await ready();
  const admin = await person("admin");
  useClient(clientAs(E, admin.id));
  const away = later(dc.plannedDate, 9);
  await repo.request(dc.planId, "move_one", { shoot: "drone-check", to: away }, rev0, { key: "office-move-002" });
  pc(E).run();
  const me = await person("field");
  useClient(clientAs(E, me.id));
  click("#mvApply");
  await until(() => S.mv && S.mv.msg === V.CHANGED_TEXT, 4000, "changed said");
  await ready();
  assert.match(text("mvNow"), new RegExp("now " + M.dayText(away, S.today)), "the day it has now: " + text("mvNow"));
  assert.ok(!text("mvNow").includes(M.dayText(dc.plannedDate, S.today)), "never the old day beside 'changed'");
});

test("an admin's Firm box after a PT409: the office's Firm tick is the new read's, and the resent job-date change keeps the date Firm", { skip }, async () => {
  const E = await engine();
  await open(E, "admin");
  const dl = shootBy("A000T9", "delivery");                            // follows Delivery, an estimate
  click('#shList [data-shoot="' + dl.id + '"]');
  click('#shDScroll [data-act="move"]');
  radio("mvKind", "milestone");
  assert.equal(S.mv.milestone, "delivery");
  assert.ok($("mvFirm") && !$("mvFirm").checked, "an estimate: not Firm");
  const day = pickDay(3);
  await ready();
  // the job date's own move is the preview's first line
  assert.match(previewText(), new RegExp("Delivery " + M.dayText(planBy("A000T9").milestones.delivery.date, S.today) + " → " + M.dayText(day, S.today)));
  // meanwhile the office ticks Firm on Delivery in DCR Agents 2 (the mirror: milestones_rev and rev move on)
  const { plan } = rowOf(E, "A000T9", "delivery");
  plan.milestones = Object.assign({}, plan.milestones, { delivery: Object.assign({}, plan.milestones.delivery, { source: "admin", confirmed: true, firm: true }) });
  plan.rev += 1;
  plan.milestones_rev = plan.rev;
  const before = E.rows.photo_changes.length;
  click("#mvApply");
  await until(() => S.mv && S.mv.msg === V.CHANGED_TEXT, 4000, "changed said");
  assert.equal(E.rows.photo_changes.length, before, "PT409: nothing queued");
  await ready();
  assert.ok($("mvFirm").checked, "the Firm box is the new read's (the admin never touched it)");
  click("#mvApply");
  await until(() => toasts.some((t) => /^Sent - /.test(t[0])), 4000, "sent");
  const row = E.rows.photo_changes[before];
  assert.equal(row.kind, "milestone");
  assert.equal(row.args.firm, true, "the office's Firm stays Firm - never sent back as an estimate");
  // an admin who ticks the box himself: his choice is sent
  await open(E, "admin");
  click('#shList [data-shoot="' + shootBy("A000T9", "framing-complete").id + '"]');
  click('#shDScroll [data-act="move"]');
  radio("mvKind", "milestone");
  pickDay(4);
  await ready();
  assert.equal(page._test.argsNow(false).args.firm, undefined, "untouched: left to the database (the current flag)");
  $("mvFirm").checked = true;
  $("mvFirm").dispatchEvent({ type: "change" });
  await ready();
  assert.equal(page._test.argsNow(false).args.firm, true, "ticked by him: sent");
});

/* ── CONFIRMED: a phone's Move sheet brings the preview into view ─────── */

test("a phone: a new preview is brought into view, and its count stands beside Apply (a tap brings the list up)", { skip }, async () => {
  const E = await engine();
  await open(E, "field");
  const bf = shootBy("A000T9", "before-framing");
  click('#shList [data-shoot="' + bf.id + '"]');
  click('#shDScroll [data-act="move"]');
  const seen = [];
  $("mvPreview").scrollIntoView = (o) => seen.push(o);
  assert.equal($("mvSum").hidden, true, "no count before a preview");
  radio("mvKind", "move_later");
  pickDay(1);
  await ready();
  assert.deepEqual(seen, [{ block: "nearest" }], "the list came into view as it arrived");
  assert.equal($("mvSum").hidden, false);
  assert.equal(text("mvSum"), S.mv.words.summary + " · see the list");
  click("#mvSum");
  assert.equal(seen.length, 2, "a tap on the count brings the list up again");
  // the footer's order: the message, the count, then Cancel and Apply
  const foot = document.querySelector("#shMo .sh-mo-ft").children.map((n) => n.getAttribute("id") || n.getAttribute("data-act"));
  assert.deepEqual(foot, ["mvMsg", "mvSum", "mv-close", "mvApply"]);
  // a toast still showing as a sheet opens is taken off (it would sit over the list) and said again when it closes
  click('#shMo .sh-mo-ft [data-act="mv-close"]');
  const host = document.createElement("div");
  host.setAttribute("id", "dcr2Toasts");
  host.innerHTML = '<div class="dcr2-toast ok">Applied - an earlier change</div>';
  document.body.appendChild(host);
  toasts.length = 0;
  click('#shDScroll [data-act="move"]');
  assert.equal(host.children.length, 0, "taken off while the sheet is open");
  assert.equal(toasts.length, 0);
  click('#shMo .sh-mo-ft [data-act="mv-close"]');
  assert.deepEqual(toasts, [["Applied - an earlier change", "ok"]], "said again as the sheet closes");
  const css = read("css/shoots.css");
  assert.match(css, /\.mv-sum \{ flex:1 1 100%; min-height:40px;/);
  assert.match(css, /html\.sh-sheet \.dcr2-toasts \{ bottom:calc\(var\(--sh-foot, calc\(84px \+ env\(safe-area-inset-bottom\)\)\) \+ 8px\); \}/, "toasts above the footer, however tall");
});

/* ── CONFIRMED: a slow network ────────────────────────────────────────── */

test("a slow network: 'Close (still sending)' while a change is on its way; a lost answer is unknown, and the second press is the same change worded from what became of it", { skip }, async () => {
  const E = await engine();
  let hold = null;                 // the request waits on it (a slow connection)
  let drop = 1;                    // the first request's answer is lost (a gateway's 504) after it reached the database
  const wrap = (c) => ({ from: (t) => c.from(t), rpc: async (n, a) => {
    if (n === "photo_change_request" && hold) await hold;
    const r = await c.rpc(n, a);
    if (n === "photo_change_request" && drop > 0) { drop -= 1; return { data: null, error: { message: "Gateway Timeout", status: 504 }, status: 504 }; }
    return r;
  } });
  const slow = () => { let go = null; hold = new Promise((r) => { go = r; }); return () => { hold = null; go(); }; };
  await open(E, "field", "", { wrap });
  const dc = shootBy("A000T9", "drone-check");
  click('#shList [data-shoot="' + dc.id + '"]');
  click('#shDScroll [data-act="move"]');
  pickDay(1);
  await ready();
  let letGo = slow();
  click("#mvApply");
  await until(() => S.mv && S.mv.busy && $("mvApply").textContent === "Sending…", 4000, "sending");
  const cancel = document.querySelector('#shMo .sh-mo-ft [data-act="mv-close"]');
  assert.equal(cancel.textContent, V.CLOSE_SENDING, "Cancel says it does not stop the change");
  assert.equal(document.querySelector("#shMo .sh-x").getAttribute("aria-label"), "Close - the change is still being sent");
  const before = E.rows.photo_changes.length;
  letGo();
  // the answer was lost (a gateway's 504) though the change reached the database
  await until(() => S.mv && S.mv.msg === V.NO_ANSWER_TEXT, 4000, "unknown said");
  assert.equal(E.rows.photo_changes.length, before + 1, "it did reach the database");
  assert.equal(document.querySelector('#shMo .sh-mo-ft [data-act="mv-close"]').textContent, "Cancel", "back to Cancel");
  // the second press: the same key - the row it has (again: true), worded from its status
  click("#mvApply");
  await until(() => toasts.some((t) => t[0] === "That change was sent already - it waits for the office computer."), 4000, toasts);
  assert.equal(E.rows.photo_changes.length, before + 1, "never sent twice");
  // closing while it is on its way: the sheet goes, the change still goes, and its answer is said
  await open(E, "field", "", { wrap });
  click('#shList [data-shoot="' + shootBy("A000T9", "house-complete").id + '"]');
  click('#shDScroll [data-act="move"]');
  pickDay(2);
  await ready();
  letGo = slow();
  click("#mvApply");
  await until(() => S.mv && S.mv.busy && $("mvApply").textContent === "Sending…", 4000, "sending");
  click('#shMo .sh-mo-ft [data-act="mv-close"]');
  assert.equal(S.mv, null, "closed");
  const n0 = E.rows.photo_changes.length;
  letGo();
  await until(() => toasts.some((t) => /^Sent - /.test(t[0])), 4000, "the answer said after the sheet closed");
  assert.equal(E.rows.photo_changes.length, n0 + 1, "closing did not stop it - as the button said");
  // closed while on its way AND its answer lost: there is no Apply to press any more - never "Press Apply again"
  await open(E, "field", "", { wrap });
  click('#shList [data-shoot="' + shootBy("A000T9", "progress-2").id + '"]');
  click('#shDScroll [data-act="move"]');
  pickDay(3);
  await ready();
  letGo = slow();
  drop = 1;
  click("#mvApply");
  await until(() => S.mv && S.mv.busy && $("mvApply").textContent === "Sending…", 4000, "sending");
  click('#shMo .sh-mo-ft [data-act="mv-close"]');
  const n1 = E.rows.photo_changes.length;
  letGo();
  await until(() => toasts.some((t) => t[0] === V.NO_ANSWER_CLOSED_TEXT), 4000, toasts);
  assert.ok(!toasts.some((t) => t[0] === V.NO_ANSWER_TEXT), "no Apply to press: not told to press it");
  assert.equal(E.rows.photo_changes.length, n1 + 1, "it did reach the database - 'may have been sent'");
  // the words of an again: true answer, whatever became of the change (§17: the row's status, result and error)
  const pcOn = { online: true, paused: false };
  assert.equal(V.sentText({ again: true, status: "new", state: "new" }, pcOn).text, "That change was sent already - it waits for the office computer.");
  assert.equal(V.sentText({ again: true, status: "taken", state: "taken" }, pcOn).text, "That change was sent already - the office computer is applying it.");
  assert.deepEqual(V.sentText({ again: true, status: "applied", state: "applied", result: { outcome: "applied", words: "1 shoot moved" } }, pcOn),
    { text: "That change was sent already. Applied - 1 shoot moved", kind: "ok" });
  assert.deepEqual(V.sentText({ again: true, status: "refused", state: "refused", error: { code: "past" } }, pcOn),
    { text: "That change was sent already. Not done: That day has passed.", kind: "error" });
  assert.equal(V.sentText({ again: true, status: "cancelled", state: "cancelled" }, pcOn).text, "That change was sent already and then cancelled - nothing changed.");
  assert.match(V.sentText({ again: true, status: "new", state: "expired" }, pcOn).text, /^That change was sent already\. Expired - /);
  assert.equal(V.NO_ANSWER_TEXT, "No answer - it may not have been sent. Press Apply again: it will not be sent twice.");
});

/* ── CONFIRMED: the answers, named and never left unsaid ──────────────── */

test("the office computer's answer names the change and its job; a refusal that came while the page was closed is told on the next visit, and its row says Not done", { skip }, async () => {
  const E = await engine();
  await open(E, "field");
  const dc = shootBy("A000T9", "drone-check");
  click('#shList [data-shoot="' + dc.id + '"]');
  click('#shDScroll [data-act="move"]');
  const day = pickDay(1);
  await ready();
  click("#mvApply");
  await until(() => toasts.some((t) => /^Sent - /.test(t[0])), 4000, "sent");
  const store = window.localStorage;
  // the page is closed; the office moves the shoot on the PC meanwhile, so the office computer refuses the change
  const { shoot } = rowOf(E, "A000T9", "drone-check");
  shoot.planned_date = later(shoot.planned_date, 1);
  pc(E).run();
  const id = E.rows.photo_changes[E.rows.photo_changes.length - 1].id;
  assert.equal(E.rows.photo_changes.find((c) => c.id === id).status, "refused");
  // the next visit (the same device): told, named
  await open(E, "field", "", { keepStore: true });
  assert.ok(window.localStorage === store, "the same device's storage");
  const want = "Not done - Move Drone airspace check to " + M.dayText(day, S.today) + " - only this shoot (A000T9 Sample house): The shoot changed meanwhile - look again.";
  assert.ok(toasts.some((t) => t[0] === want && t[1] === "error"), JSON.stringify(toasts));
  // the row: Not done - see why
  const row = document.querySelector('#shList [data-shoot="' + dc.id + '"]');
  assert.match(row.textContent, /Not done - see why/);
  // and only once
  toasts.length = 0;
  await page._test.load({ quiet: true });
  assert.equal(toasts.length, 0, "said once");
  // the words (pure): named with the plan, the old words without it
  const plan = M.toPlan({ id: 1, rev: 1, status: "active", project_label: "A000T9 Sample house" });
  const c = M.toChange({ id: 7, plan_id: 1, kind: "move_one", args: { shoot: "delivery", to: "2026-11-17" }, target_key: "delivery", status: "applied",
    requested_by: "u", requested_at: "2026-11-08T17:00:00Z", done_at: "2026-11-08T17:02:00Z", result: { outcome: "applied", words: "1 shoot moved" } }, new Date("2026-11-09T18:00:00Z"));
  const shoots = [M.toShoot({ id: 5, plan_id: 1, key: "delivery", name: "Delivery day" })];
  assert.deepEqual(V.finishedText(c, { plan, shoots, today: "2026-11-09" }),
    { text: "Applied - Move Delivery day to Tue Nov 17 - only this shoot (A000T9 Sample house) (1 shoot moved)", kind: "ok" });
  assert.deepEqual(V.finishedText(c), { text: "Applied - 1 shoot moved", kind: "ok" }, "no plan: the short words");
});

/* ── CONFIRMED: the list keeps the keyboard; the status regions are not written again ─ */

test("a poll or a watch read keeps the keyboard on its row, and the status regions are not written again when nothing changed", { skip }, async () => {
  const E = await engine();
  pc(E).state({ offline: true, offlineMinutes: 125 });
  await open(E, "field");
  const dc = shootBy("A000T9", "drone-check");
  const row = document.querySelector('#shList [data-shoot="' + dc.id + '"]');
  row.focus();
  const count = $("shCount").firstChild;
  const pcText = $("shPc").firstChild;
  assert.ok(count && pcText, "both say something");
  await page._test.load({ quiet: true });
  assert.ok(document.activeElement === row, "the same row, still focused");
  assert.ok($("shList").contains(row), "still in the list");
  assert.ok($("shCount").firstChild === count, "the count was not written again");
  assert.ok($("shPc").firstChild === pcText, "the office computer's line was not written again");
  // a read that changes the list: the keyboard stays on the same shoot's row
  const { shoot } = rowOf(E, "A000T9", "site-walk");
  shoot.name = "Site walk again";
  await page._test.load({ quiet: true });
  assert.match(text("shList"), /Site walk again/);
  assert.ok($("shList").contains(document.activeElement), "the focus is in the list");
  assert.equal(document.activeElement.getAttribute("data-shoot"), String(dc.id), "on the same shoot");
  // Month: a day button keeps it too
  click('#shViews [data-view="month"]');
  const dayBtn = document.querySelector('#shList [data-act="day"][data-day="' + S.today + '"]');
  dayBtn.focus();
  shoot.name = "Site walk once more";
  await page._test.load({ quiet: true });
  assert.equal(document.activeElement.getAttribute("data-day"), S.today);
  assert.ok($("shList").contains(document.activeElement));
});

/* ── low: the gates follow a photo team change ────────────────────────── */

test("a photo team change heard by the watch reads photo_my_access again: Move… comes and goes without a reload; someone taken off is told so", { skip }, async () => {
  const E = await engine();
  const viewer = await person("viewer");
  await open(E, "viewer");
  const fc = shootBy("A000T8", "framing-complete");
  click('#shList [data-shoot="' + fc.id + '"]');
  assert.ok(!$("shDScroll").querySelector('[data-act="move"]'), "marketing reads only");
  const admin = await person("admin");
  useClient(clientAs(E, admin.id));
  const row = (await repo.team()).find((r) => r.profileId === viewer.id);
  await repo.setTeam(viewer.id, { photographer: true, marketing: true, isDefault: false, googleEmail: row.googleEmail }, row.version);
  useClient(clientAs(E, viewer.id));
  await page._test.onWatch({ tables: ["photo_team"], join: false });
  assert.ok(S.access.canEdit, "the new gates");
  assert.ok($("shDScroll").querySelector('[data-act="move"]'), "Move… without a reload");
  assert.equal(text("shLead"), V.EDIT_TEXT);
  // taken off the team: told so, nothing more read
  useClient(clientAs(E, admin.id));
  const row2 = (await repo.team()).find((r) => r.profileId === viewer.id);
  await repo.setTeam(viewer.id, { photographer: false, marketing: false }, row2.version);
  useClient(clientAs(E, viewer.id));
  await page._test.onWatch({ tables: ["photo_team"], join: false });
  assert.match(text("shList"), /Not for your account/);
  assert.equal(S.plans.length, 0);
});

/* ── low: the task link, the pending gate, the change's dates, Undo, expired, the job date's line ─ */

test("the task link only for who reads the task; a job-date change waiting does not hold the shoots that follow it", { skip }, async () => {
  const E = await engine();
  await open(E, "field");
  const lot = shootBy("A000T9", "lot-before");
  assert.ok(lot.taskId, "the seed's heads-up task");
  assert.match(page._test.detailHtml(lot.id), /Open its task in My Tasks/, "the plan's photographer: its task is his");
  const plan = planBy("A000T9");
  const owner = plan.photographerProfileId;
  plan.photographerProfileId = "someone-else";
  assert.doesNotMatch(page._test.detailHtml(lot.id), /its task in My Tasks/, "a field photographer who is not the plan's: the task is not his to read");
  S.me = Object.assign({}, S.me, { role: "lead" });
  assert.match(page._test.detailHtml(lot.id), /Open its task in My Tasks/, "the office roles read every task");
  plan.photographerProfileId = owner;
  // a job-date change of Framing start waiting: Before framing keeps Move… and Mark done… (a chip says it waits)
  const bf = shootBy("A000T9", "before-framing");
  const ms = M.toChange({ id: 99, plan_id: plan.id, kind: "milestone", args: { milestone: "framing_start", date: S.today }, target_key: null, status: "new",
    requested_by: "u-x", requested_at: new Date().toISOString() });
  assert.ok(M.pendingFor([ms], bf), "the chip");
  assert.equal(M.pendingTarget([ms], bf), null, "the gate");
  const act = M.shootActions(bf, plan, S.access, { pending: M.pendingTarget([ms], bf) });
  assert.ok(act.move.ok && act.done.ok);
  S.changes = [ms];
  const html = page._test.detailHtml(bf.id);
  assert.match(html, /data-act="move"/);
  assert.match(html, /data-act="done"/);
  assert.match(html, /Change waiting for the office computer|Waiting for the office/);
  const mv = M.toChange({ id: 98, plan_id: plan.id, kind: "move_one", args: { shoot: "before-framing", to: S.today }, target_key: "before-framing", status: "new",
    requested_by: "u-x", requested_at: new Date().toISOString() });
  assert.equal(M.pendingTarget([mv], bf), mv, "a change of the shoot itself holds it");
  assert.equal(M.pendingMilestone([ms], plan.id, "framing_start"), ms);
});

test("a change's dates, Undo's label and its stale offer, an untaken change that expired, Home's badge and link, ?mine=1", () => {
  const now = new Date("2026-11-09T18:00:00Z");
  const asked = M.toChange({ id: 1, plan_id: 1, kind: "move_one", args: { shoot: "delivery", to: "2026-11-17" }, target_key: "delivery", status: "applied", requested_by: "u-pat",
    requested_at: "2026-11-06T17:00:00Z", done_at: "2026-11-09T16:00:00Z", result: { outcome: "applied", moved: [{ key: "delivery", from: "2026-11-16", to: "2026-11-17" }] } }, now);
  const l = V.changeLine(asked, { today: "2026-11-09" });
  assert.deepEqual([l.asked, l.answered, l.when], ["Fri Nov 6", "Mon Nov 9", "Fri Nov 6"], "asked the day it was asked; answered the day it was answered");
  const same = V.changeLine(Object.assign({}, asked, { doneAt: "2026-11-06T18:00:00Z" }), { today: "2026-11-09" });
  assert.equal(same.answered, "", "the same day: said once");
  // Undo: someone else's for an admin; not once the shoot moved again
  const plan = M.toPlan({ id: 1, status: "active", milestones: {} });
  const s = M.toShoot({ id: 5, plan_id: 1, key: "delivery", anchor: "delivery", planned_date: "2026-11-17", status: "planned" });
  const ADMIN = { admin: true, canEdit: true, canRead: true, ready: true };
  assert.equal(V.undoFor([asked], s, "u-ad", ADMIN, now, { shoots: [s], plan }).id, 1);
  assert.equal(V.undoLabel(asked, "u-ad"), "Undo this change…", "an admin's Undo of someone else's change");
  assert.equal(V.undoLabel(asked, "u-pat"), "Undo my last change…");
  const movedAgain = M.toShoot({ id: 5, plan_id: 1, key: "delivery", anchor: "delivery", planned_date: "2026-11-19", status: "planned" });
  assert.equal(V.undoFor([asked], movedAgain, "u-pat", ADMIN, now, { shoots: [movedAgain], plan }), null, "moved again since: not offered (it would be refused)");
  assert.equal(M.refusalText("changed", { where: "undo" }), "The shoot was moved again since - move it instead.");
  const msChange = M.toChange({ id: 2, plan_id: 1, kind: "milestone", args: { milestone: "delivery", date: "2026-11-20" }, status: "applied", requested_by: "u-pat",
    requested_at: "2026-11-08T17:00:00Z", done_at: "2026-11-08T17:02:00Z", result: { outcome: "applied", moved: [], milestone_after: { key: "delivery", date: "2026-11-20" } } }, now);
  const planNow = M.toPlan({ id: 1, status: "active", milestones: { delivery: { date: "2026-11-22", source: "admin", confirmed: true } } });
  assert.equal(V.undoStillFits(msChange, [s], planNow), false, "the job date moved since");
  assert.equal(V.undoStillFits(msChange, [s], M.toPlan({ id: 1, milestones: { delivery: { date: "2026-11-20" } } })), true);
  // a change nobody took for 7 days (the office computer off): "Expired" for the 7 days after, though no done_at
  const old = M.toChange({ id: 3, plan_id: 1, kind: "move_one", args: { shoot: "delivery", to: "2026-11-20" }, target_key: "delivery", status: "new",
    requested_by: "u-pat", requested_at: "2026-10-31T17:00:00Z" }, now);
  assert.equal(old.state, "expired");
  assert.deepEqual(V.recentMine([old], s, "u-pat", now).map((c) => c.id), [3], "shown: it expired on Nov 7");
  assert.equal(M.changeStatusText(old).text, "Expired - the office computer did not take it within 7 days");
  assert.deepEqual(V.recentMine([old], s, "u-pat", new Date("2026-11-15T18:00:00Z")).length, 0, "and gone 7 days after it expired");
  // a refusal of mine is the row's chip until a newer change of mine about it finishes
  const refused = M.toChange({ id: 4, plan_id: 1, kind: "move_one", args: { shoot: "delivery", to: "2026-11-20" }, target_key: "delivery", status: "refused",
    requested_by: "u-pat", requested_at: "2026-11-09T10:00:00Z", done_at: "2026-11-09T10:05:00Z", error: { code: "past" } }, now);
  const earlier = Object.assign({}, asked, { id: 6, doneAt: "2026-11-09T09:00:00Z" });
  assert.equal(V.lastRefused([refused, earlier], s, "u-pat", now).id, 4, "the newest finished change of mine about it was refused");
  assert.equal(V.lastRefused([refused], s, "u-sam", now), null, "someone else's");
  assert.equal(V.lastRefused([refused, asked], s, "u-pat", now), null, "a newer change of mine finished since (applied at 16:00)");
  assert.deepEqual(M.shootChips(s, plan, "2026-11-09", { refused }).map((c) => c.text).slice(-1), ["Not done - see why"]);
  // the job date's own line
  const p = M.toPlan({ id: 1, milestones: { framing_start: { date: "2026-11-19", source: "admin", confirmed: true } } });
  assert.equal(V.milestoneMove(p, "framing_start", "2026-11-23", "2026-11-09"), "Framing start: Thu Nov 19 → Mon Nov 23");
  assert.equal(V.milestoneMove(p, "house_complete", "2026-12-01", "2026-11-09"), "House complete: no date yet → Tue Dec 1");
  // Home's badge: the page's plans (every one but the archived), and "Only my jobs" when it counted only mine
  const plans = [M.toPlan({ id: 1, status: "review", photographer_profile_id: "u-pat" }), M.toPlan({ id: 2, status: "active" }), M.toPlan({ id: 3, status: "archived" })];
  const shoots = [M.toShoot({ id: 1, plan_id: 1, planned_date: "2026-11-02", status: "planned" }), M.toShoot({ id: 2, plan_id: 2, planned_date: "2026-11-01", status: "planned" }),
    M.toShoot({ id: 3, plan_id: 3, planned_date: "2026-10-01", status: "planned" })];
  assert.deepEqual(V.homeBadge(plans, shoots, "2026-11-09"), { cls: "warn", text: "2 late", title: "2 shoots past their day and grace on every job", mine: false },
    "a plan in review counts, as on the page; an archived one does not");
  assert.deepEqual(V.homeBadge(plans, shoots, "2026-11-09", { mine: "u-pat" }), { cls: "warn", text: "1 late", title: "1 shoot past its day and grace on your jobs", mine: true });
  assert.equal(V.parseLink("?mine=1").mine, true);
  assert.equal(V.parseLink("?mine=yes").mine, false);
  const dash = code(read("js/shell/dashboard.js"));
  assert.match(dash, /go\.setAttribute\("href", b && b\.mine \? "shoots\.html\?mine=1" : "shoots\.html"\)/);
});

test("?mine=1 opens with Only my jobs ticked (the photographer's own); the words say job", { skip }, async () => {
  const E = await engine();
  await open(E, "field", "?mine=1");
  assert.equal(S.mine, true);
  assert.ok($("shMine").checked);
  await open(E, "admin", "?mine=1");
  assert.equal(S.mine, false, "an admin with no plan of his own: every job");
  assert.equal(V.CHANGED_TEXT, "Someone changed this job's shoots meanwhile - here is the new preview.");
  assert.equal(M.refusalText("plan_not_active"), "Only the shoots of an active or paused job can change.");
  assert.equal(M.refusalText("no_plan"), "That job is not on the shoot schedule any more.");
  assert.match(read("js/pages/my-tasks.js"), /📷 Open in shoot schedule/);
});

/* ── low: the phone's Back with a sheet open ──────────────────────────── */

test("a phone's Back with a sheet open closes the sheet only; the sheet's own close takes its history entry off", { skip }, async () => {
  const E = await engine();
  await open(E, "field");
  const dc = shootBy("A000T9", "drone-check");
  click('#shList [data-shoot="' + dc.id + '"]');
  assert.ok(S.open && S.sel === dc.id);
  pushed.length = 0;
  click('#shDScroll [data-act="move"]');
  assert.deepEqual(pushed, [{ sh: dc.id, sheet: 1 }], "the sheet's own entry");
  page._test.onPop();                                                 // the phone's Back
  assert.equal(S.mv, null, "the sheet closed");
  assert.ok(S.open && S.sel === dc.id, "the shoot stays open");
  assert.equal(backs, 0, "nothing more taken off");
  click('#shDScroll [data-act="move"]');
  click('#shMo .sh-mo-ft [data-act="mv-close"]');
  assert.equal(backs, 1, "Cancel takes the sheet's entry off");
  page._test.onPop();                                                 // that entry going
  assert.ok(S.open && S.sel === dc.id, "not taken as a Back: the shoot stays");
});

/* ── low: Home's re-render keeps its badges ───────────────────────────── */

test("Home: a card arriving draws the cards again with every badge and the DCR Agents 2 dot they had", () => {
  const dash = code(read("js/shell/dashboard.js"));
  assert.match(dash, /function rerender\(p, homeOpts\) \{\s*render\(p, homeOpts\);\s*myTasksBadge\(\);\s*myAssistantBadge\(\);\s*listBadges\(\);\s*accountingBadge\(p\);\s*if \(painted\.agents\) agentsConsoleDot\(painted\.agents\);\s*if \(painted\.shoots\) shootsBadge\(\);\s*\}/);
  assert.match(dash, /function agentsConsoleDot\(line\) \{\s*if \(line\) painted\.agents = line;/, "the dot's line is kept");
  assert.match(dash, /homeOpts\.sales = true;\s*rerender\(p, homeOpts\);/, "Sales estimates");
  assert.match(dash, /homeOpts\.photoEdit = a\.canEdit;\s*rerender\(p, homeOpts\);/, "the Shoot schedule");
  assert.match(dash, /homeOpts\.hasCrew = true; rerender\(p, homeOpts\);/, "a lead's Batch Entry");
  const renders = dash.match(/\brender\(p, homeOpts\);/g) || [];
  assert.equal(renders.length, 2, "the first draw and rerender's - every other draw goes through rerender");
});
