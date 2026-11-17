// The photo files on the phone (the photographer screen program, P5, the OneDrive edition; DCR Desktop 2
// docs/PHOTO-FILES-ONEDRIVE.md §8.4, §10, cited OD, and docs/PHOTO-FILES.md §13 for the rules OD §15 keeps): the shoot
// schedule page (site/js/pages/shoots.js with pages/shoots-files.js) DRIVEN in node over the demo database
// (tools/fake/p10-photo-files.js on p10-photo.js and engine.js) with the small DOM of the P3 tests:
// * the demo's own ports of the ready rule, the completion code and files_state answer the shared cases (so the demo
//   cannot drift from app.photo_ready_rule / app.photo_completion_code / app.photo_files_state); a shoot marked done
//   before its folder is in OneDrive says what it needs (no_hand_in, done_copying, done_waiting), and only a job
//   folder that is gone or another account's is a folder problem then (§10.1 rule 3, v15 §38) - a gone one's line and
//   help chip naming the JOB folder (job_folder_problem, folder_gone_job: review round 3);
// * marketing opens on Ready for marketing: the cards in the database's order, the Ready tab's number Home's badge's
//   (ready plus claimed by me, never a card someone else is on), I'm on it, Posted… (where, an https link, a
//   note; a bad link said in the sheet), Not for posting… (a reason), Take it over… (asked first), Not posted yet, a
//   refusal in words, the Done tab; ?ready=<id> (the push notice's link) opens that card, a card no longer there says so;
//   with no signal the Ready view says its read failed, with Try again that opens the card then (never "isn't on the
//   list any more" for a list not read), and marketing still opens on it; a card the viewer's account cannot open yet
//   says why in Open in OneDrive's place (the access line: waiting, not a company account, the photographer's none);
//   who was told and how is an admin's line on a card, never on the card of the member it names (round 7), and the
//   demo answers it to admins only (round 9); Not for posting… of someone else's card is an admin's (not_yours); a
//   card claimed by someone taken off marketing or turned off goes back to ready (round 9); a sheet's act that fails
//   with no signal, a busy server or a rate keeps the sheet open with the words in it and what was typed, and the
//   Ready view's failed read says ready.read_failed (round 10); Back on the list whose answer was lost on the way,
//   pressed again, is the database's again - never "Someone changed this meanwhile" (round 11, §44); an act with no
//   answer says hint.no_answer; while one is on its way its sheet's Cancel / Keep it and × say "Close (still sending)",
//   as Move… and Mark done… do, and a sheet closed then says its refusal as a toast; Posted… / Not for posting… sent
//   again after an answer lost on the way keep what was corrected in the sheet (round 12, §45);
// * a shoot's Files section: the line the chooser gives with its fillers, [Open in OneDrive] only with can.open_folder
//   (else the access line), [Check again] (its answer drawn as the status; 409 root_lost read again), the help chips,
//   the completion line and who was told - an admin's line there too, never for the marketing member it names, who
//   opens the shoot from their card (round 8); a gone shoot folder's line alone (moved_out);
//   marketing's culls after Ready a calm line of their own, never a problem line or a help notice (round 9, v19);
// * Mark done… brings a skipped shoot with files back (bring_back_sheet): DCR Agents 2 2.3.0 applies it and the shoot
//   goes on the Ready list once; 2.2.0 refuses it (closed_old_pc) and Mark done… stays offered;
// * a database without P5: no Files section, no fourth view - P3 as it was.
// Made-up people and shoots only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as common2 from "../site/js/common2.js";
import { makeDom } from "./console/console-page-dom.mjs";
import { available, loadFake, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as repo from "../site/js/repo/photo.js";
import * as repoFiles from "../site/js/repo/photo-files.js";
import { WORDS } from "../site/js/map/photo-words.js";
import { actText, dayText, homeBadge } from "../site/js/map/photo-files.js";
import { CLOSE_SENDING } from "../site/js/map/shoots.js";

const skip = !available && "the demo database (tools/fake) is not here";
const CASES = JSON.parse(readFileSync(new URL("./vectors/photo_files_cases.json", import.meta.url), "utf8"));
const HTML = readFileSync(new URL("../site/shoots.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const BODY = /<body>([\s\S]*)<\/body>/.exec(HTML)[1].replace(/<script[\s\S]*?<\/script>/g, "");

const toasts = [];
const asked = [];
let confirmAnswer = true;
globalThis.Node = class { static [Symbol.hasInstance](x) { return !!x && typeof x.nodeType === "number"; } };
const DCR2 = Object.assign({}, common2.DCR2, { toast: (t, k) => { toasts.push([String(t), k]); }, confirm: async (m, o) => { asked.push([String(m), o || {}]); return confirmAnswer; } });
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
const files = (E) => E.exts.find((x) => x.name === "p10-photo-files").__dev;
const pc = (E) => E.exts.find((x) => x.name === "p10-photo").__dev.pc;

async function engine() {
  const E = await freshEngine(new Date());
  pc(E).state({ auto: false });
  return E;
}
async function open(E, key, search, wrap) {
  page._test.reset();
  document.body.innerHTML = BODY;
  toasts.length = 0;
  asked.length = 0;
  confirmAnswer = true;
  repo.useKeyStore(null);
  const p = await person(key);
  useClient(wrap ? wrap(clientAs(E, p.id)) : clientAs(E, p.id));
  const me = { id: p.id, name: p.name, role: p.role, active: true };
  await page.init(me, { search: search || "", watch: false });
  await S.side;                                  // the places and the rollups, asked beside the first schedule read
  return me;
}
function click(sel, root) {
  const n = (root || document).querySelector(sel);
  assert.ok(n, "nothing matches " + sel);
  n.click();
  return n;
}
const shootOf = (E, code, key) => {
  const plan = E.rows.photo_plans.find((p) => p.project_code === code);
  return E.rows.photo_shoots.find((s) => s.plan_id === plan.id && s.key === key);
};
const lines = () => document.querySelectorAll("#shDScroll .sh-fl").map((n) => n.getAttribute("data-line"));
const tabCount = () => { const n = document.querySelector('#shList [data-act="ready-tab"][data-tab="open"] .sh-n'); return n ? n.textContent : ""; };
const filesRead = (id) => until(() => S.files[id] && S.files[id].st !== undefined && !S.files[id].busy, 4000, "the files of shoot " + id);

test("the demo's own rules answer the shared cases: ready (app.photo_ready_rule), completion (app.photo_completion_code), files_state (app.photo_files_state)", { skip }, async () => {
  const FK = await loadFake();
  const R = FK.p10FilesRules;
  for (const c of CASES.ready) assert.deepEqual(R.readyRule(c.in), c.out, c.name);
  for (const c of CASES.completion) assert.equal(R.completionCode(c.in), c.out, c.name);
  for (const c of CASES.files_state) assert.equal(R.filesState(c.in), c.out, c.name);
});

test("marketing opens on Ready for marketing: the cards in order, I'm on it, Posted… (where, link, note), the Done tab, Not posted yet", { skip }, async () => {
  const E = await engine();
  await open(E, "viewer");
  assert.equal(S.view, "ready", "the first view for someone only on marketing (§13.5)");
  const btn = document.querySelector('#shViews [data-view="ready"]');
  assert.equal(btn.hidden, false);
  assert.equal(btn.getAttribute("aria-pressed"), "true");
  const rows = document.querySelectorAll("#shList .sh-rrow");
  assert.deepEqual(rows.map((r) => r.querySelector(".sh-name").textContent), ["Site walk", "Delivery day"], "unclaimed first");
  assert.match(rows[0].textContent, /^Ready/);
  assert.match(rows[1].textContent, /Avery is on it/);
  // the Ready tab's number is Home's badge (ready plus claimed by me, ready.home_badge) - never the card Avery is on (R5)
  assert.equal(tabCount(), "1", "one ready, none mine - Avery's card is not counted");
  assert.equal(homeBadge(S.rd.lists.open.counts).text, "1 ready for marketing", "Home says the same number");
  const id = Number(rows[0].getAttribute("data-ready"));
  rows[0].click();
  assert.equal(S.rd.sel, id);
  const card = text("shDScroll");
  assert.match(card, /Site walk/);
  assert.match(card, /A000T9 Sample house · shot .* · \d+ photos and \d+ videos · .* · by Jordan/);
  // (a boolean: a DOM node in a failing assert's message is inspected whole)
  assert.equal(!!document.querySelector("#shDScroll .sh-ftold"), false, "Taylor was told themselves: no told line on their own card (round 7)");
  assert.doesNotMatch(card, /Told Taylor/);
  const drive = document.querySelector('#shDScroll [data-act="r-open"]');
  assert.ok(drive && /^https:\/\/example-my\.sharepoint\.com\/personal\/office_example_com\/Documents\/DCR%20Photo%20%26%20Video\/1FAKE/.test(drive.getAttribute("href")) &&
    drive.getAttribute("rel") === "noopener noreferrer");
  assert.equal(drive.textContent, WORDS.ready.btn_open, "Open in OneDrive");
  assert.equal(document.querySelector('#shDScroll [data-act="r-shoot"]').getAttribute("href"), "shoots.html?shoot=" + E.rows.photo_marketing.find((m) => m.id === id).shoot_id);
  click('#shDScroll [data-act="r-claim"]');
  await until(() => /You're on it/.test(text("shDScroll")), 4000, "claimed");
  assert.equal(E.rows.photo_marketing.find((m) => m.id === id).state, "claimed");
  assert.ok(document.querySelector('#shDScroll [data-act="r-release"]'), "Not me any more");
  assert.equal(tabCount(), "1", "the card I'm on still counts (claimed by me), Avery's still not");
  // Posted…: a link that is not https is said in the sheet, nothing sent
  click('#shDScroll [data-act="r-posted"]');
  assert.ok($("shMo"), "the sheet");
  assert.equal(document.querySelectorAll('#shMo input[name="rsWhere"]').length, 6);
  assert.match(text("shMo"), /Where did it go\? \(optional\)/);
  document.querySelectorAll('#shMo input[name="rsWhere"]').find((x) => x.getAttribute("value") === "instagram").checked = true;
  $("rsLink").value = "http://example.com/post";
  click("#mvApply");
  await tick();
  assert.equal(text("mvMsg"), WORDS.hint.bad_link);
  assert.equal(E.rows.photo_marketing.find((m) => m.id === id).state, "claimed", "nothing sent");
  $("rsLink").value = "https://www.example.com/p/77";
  $("rsNote").value = "Carousel of the lot";
  click("#mvApply");
  await until(() => !$("shMo"), 4000, "the sheet closed");
  const row = E.rows.photo_marketing.find((m) => m.id === id);
  assert.deepEqual([row.state, row.posted_where, row.posted_link, row.posted_note], ["posted", ["instagram"], "https://www.example.com/p/77", "Carousel of the lot"]);
  // the Done tab: the posted card with Not posted yet
  click('#shList [data-act="ready-tab"][data-tab="done"]');
  await until(() => document.querySelectorAll("#shList .sh-rrow").length === 3, 4000, "the Done tab");
  assert.equal(tabCount(), "", "nothing ready and none mine: no number on the Ready tab, as Home shows no badge");
  assert.equal(homeBadge(S.rd.lists.open.counts), null);
  click('#shList [data-ready="' + id + '"]');
  await until(() => /Posted .* by Taylor/.test(text("shDScroll")), 4000);
  assert.match(text("shDScroll"), /Instagram/);
  assert.ok(document.querySelector('#shDScroll a[href="https://www.example.com/p/77"]'));
  // Not posted yet clears where it was posted, its link and the note: asked first (v14, §37)
  click('#shDScroll [data-act="r-reopen"]');
  assert.equal(document.querySelector('#shMo [data-ask="reopen_ask"]').textContent, WORDS.ready.reopen_ask);
  click("#mvApply");
  await until(() => E.rows.photo_marketing.find((m) => m.id === id).state === "claimed", 4000, "reopened");
});

test("Not posted yet / Back on the list ask first, Keep it focused so Enter keeps it (v14, §13.5, §37): kept, nothing sent; a post with nothing written reopens at once; Back on the list always asks", { skip }, async () => {
  const E = await engine();
  await open(E, "viewer");
  const posted = E.rows.photo_marketing.find((m) => m.state === "posted");
  assert.ok(posted.posted_where.length && posted.posted_link && posted.posted_note, "the demo's posted card has where, a link and a note");
  click('#shList [data-act="ready-tab"][data-tab="done"]');
  await until(() => document.querySelector('#shList [data-ready="' + posted.id + '"]'), 4000, "the Done tab");
  click('#shList [data-ready="' + posted.id + '"]');
  click('#shDScroll [data-act="r-reopen"]');
  assert.ok($("shMo"), "asked in a sheet");
  assert.equal(document.querySelector('#shMo [data-ask="reopen_ask"]').textContent, WORDS.ready.reopen_ask);
  assert.equal(text("mvTitle"), WORDS.ready.btn_reopen);
  assert.equal($("mvApply").textContent, WORDS.ready.btn_reopen);
  assert.ok($("mvApply").className.includes("warn"), "a reopen is never the primary");
  const keep = document.querySelector('#shMo .sh-mo-ft [data-act="mv-close"]');
  assert.equal(keep.textContent, WORDS.copy.cancel_keep);
  assert.ok(document.activeElement === keep, "Keep it has the focus: Enter keeps it (focus on " + (document.activeElement && (document.activeElement.id || document.activeElement.textContent)) + ")");
  click('#shMo .sh-mo-ft [data-act="mv-close"]');
  assert.equal($("shMo"), null);
  await tick();
  const kept = E.rows.photo_marketing.find((m) => m.id === posted.id);
  assert.deepEqual([kept.state, kept.posted_link, kept.posted_note], ["posted", posted.posted_link, posted.posted_note], "Keep it: nothing sent");
  // a post with nothing written: nothing to clear, so no question
  kept.posted_where = []; kept.posted_link = null; kept.posted_note = null;
  await page._test.loadReady({ quiet: true, both: true });
  page._test.openCard(posted.id);
  click('#shDScroll [data-act="r-reopen"]');
  assert.equal($("shMo"), null, "nothing written: no question");
  await until(() => E.rows.photo_marketing.find((m) => m.id === posted.id).state === "claimed", 4000, "reopened at once");
  // Not for posting… then Back on the list: always asked (why it isn't for posting is cleared)
  page._test.openCard(posted.id);
  click('#shDScroll [data-act="r-pass"]');
  $("rsNote").value = "Same angles as the last post";
  click("#mvApply");
  await until(() => E.rows.photo_marketing.find((m) => m.id === posted.id).state === "passed", 4000, "passed");
  click('#shList [data-act="ready-tab"][data-tab="done"]');
  await until(() => document.querySelector('#shList [data-ready="' + posted.id + '"]'), 4000, "the Done tab again");
  click('#shList [data-ready="' + posted.id + '"]');
  click('#shDScroll [data-act="r-reopen"]');
  assert.equal(document.querySelector('#shMo [data-ask="reopen_passed_ask"]').textContent, WORDS.ready.reopen_passed_ask);
  assert.equal($("mvApply").textContent, WORDS.ready.btn_reopen_passed);
  click('#shMo .sh-mo-ft [data-act="mv-close"]');
  await tick();
  assert.equal(E.rows.photo_marketing.find((m) => m.id === posted.id).state, "passed", "Keep it: still not for posting");
  click('#shDScroll [data-act="r-reopen"]');
  click("#mvApply");
  await until(() => E.rows.photo_marketing.find((m) => m.id === posted.id).state === "ready", 4000, "back on the list");
  assert.equal($("shMo"), null, "the sheet closed");
});

test("a Mark done waiting for the office computer (v14, §13.1, §37): the completion line says done_sent - never 'mark it done' beside it - and Mark done… is not offered; applied, the line moves on", { skip }, async () => {
  const E = await engine();
  // a skipped shoot with its files confirmed: closed_files, Mark done… offered
  const s = shootOf(E, "A000T8", "progress-2");
  await open(E, "field", "?shoot=" + s.id);
  await filesRead(s.id);
  assert.equal(document.querySelector("#shDScroll [data-completion]").getAttribute("data-completion"), "closed_files");
  click('#shDScroll [data-act="done"]');
  click("#mvApply");
  await until(() => !$("shMo"), 4000, "sent");
  await page._test.load({ quiet: true });
  await page._test.readFiles(s.id);
  assert.equal(S.files[s.id].st.completion, "closed_files", "the database still says closed_files (the change not applied yet)");
  const line = document.querySelector("#shDScroll [data-completion]");
  assert.equal(line.getAttribute("data-completion"), "done_sent");
  assert.equal(line.textContent, WORDS.completion.done_sent);
  assert.ok(!text("shDScroll").includes("mark it done to bring it back"), "never the closed_files words beside it");
  assert.ok(S.files[s.id].st.help.includes("closed_files") && !text("shDScroll").includes(WORDS.help.closed_files), "nor its help chip");
  assert.ok(!document.querySelector('#shDScroll [data-act="done"]'), "no second Mark done…");
  pc(E).run();
  await page._test.load({ quiet: true });
  await page._test.readFiles(s.id);
  assert.equal(E.rows.photo_shoots.find((x) => x.id === s.id).status, "done");
  assert.equal(document.querySelector("#shDScroll [data-completion]").getAttribute("data-completion"), "ready", "applied: on the Ready list");
  // an open shoot whose files are in Google Drive (not_done) the same
  const p1 = shootOf(E, "A000T9", "progress-1");
  page._test.openShoot(p1.id);
  await filesRead(p1.id);
  assert.equal(document.querySelector("#shDScroll [data-completion]").getAttribute("data-completion"), "not_done");
  click('#shDScroll [data-act="done"]');
  click("#mvApply");
  await until(() => !$("shMo"), 4000, "sent");
  await page._test.load({ quiet: true });
  await page._test.readFiles(p1.id);
  assert.equal(document.querySelector("#shDScroll [data-completion]").getAttribute("data-completion"), "done_sent");
  assert.ok(!document.querySelector('#shDScroll [data-act="done"]'), "no second Mark done…");
});

test("the demo's completion and help (v14, §37; OD §6.6): a skipped shoot whose files are still on their way has no closed_files line, help or Mark done…; a done shoot with nothing handed in reads no_hand_in whatever OneDrive holds - never while its folder is gone, or while uploads are not on for it", { skip }, async () => {
  const E = await engine();
  const s = shootOf(E, "A000T8", "progress-2");
  const f = E.rows.photo_drive_folders.find((x) => x.shoot_id === s.id);
  Object.assign(f, { confirmed: f.counted - 5, waiting: 5, media_confirmed: f.counted - 5 });     // a late hand-in, still uploading
  await open(E, "field", "?shoot=" + s.id);
  await filesRead(s.id);
  const st = S.files[s.id].st;
  assert.equal(st.files.state, "waiting");
  assert.equal(st.completion, null, "never 'its files are in OneDrive' before they are");
  assert.ok(!st.help.includes("closed_files"), "no Bring the shoot back? notice while they upload");
  assert.ok(!document.querySelector("#shDScroll [data-completion]"), "no completion line: the Files line speaks");
  assert.ok(!document.querySelector('#shDScroll [data-act="done"]'), "Mark done… once the files are confirmed");
  assert.equal(lines()[0], "waiting");
  files(E).confirmAll(s.id);
  await page._test.readFiles(s.id);
  assert.equal(S.files[s.id].st.completion, "closed_files", "confirmed: the line");
  assert.ok(S.files[s.id].st.help.includes("closed_files"), "and the help");
  // a done shoot, nothing handed in, files added in OneDrive without DCR, its folder moved out of DCR Photo & Video
  const d = shootOf(E, "A000T9", "house-complete");
  const df = E.rows.photo_drive_folders.find((x) => x.shoot_id === d.id);
  E.rows.photo_shoot_uploads.filter((u) => u.folder_id === df.id).forEach((u) => { u.state = "cancelled"; });
  Object.assign(df, { drive_only: 3 });
  E.rows.photo_shoots.find((x) => x.id === d.id).status = "done";
  const field = (await person("field")).id;
  const st2 = files(E).status(d.id, field);
  assert.equal(st2.ready_why, "folder_problem", "the folder is gone");
  assert.equal(st2.completion, "folder_problem");
  Object.assign(df, { drive_state: "found", last_code: null });
  const st3 = files(E).status(d.id, field);
  assert.equal(st3.ready_why, "no_hand_in");
  assert.equal(st3.completion, "no_hand_in", "files added in OneDrive are information only: hand the files in (no Use what's in Drive)");
  // uploads off, or tested on another job: nothing can be handed in - no line, the Files line says so (OD §6.6)
  for (const mode of ["off", "only:A000T8"]) {
    files(E).state({ mode });
    const st4 = files(E).status(d.id, field);
    assert.equal(st4.completion, null, mode + ": no no_hand_in line");
    assert.equal(st4.mode, mode === "off" ? "off" : "test");
  }
  files(E).state({ mode: "only:A000T9" });
  assert.equal(files(E).status(d.id, field).completion, "no_hand_in", "tested on this very job: on");
  files(E).state({ mode: "on" });
});

test("a shoot marked done before its folder is in Google Drive (§10.1 rule 3, v15 §38): Mark done at the site reads no_hand_in - never folder_problem - then done_copying and done_waiting through the first copy; under a job folder that is gone, job_folder_problem (review round 3), or another account's, folder_problem", { skip }, async () => {
  const FK = await loadFake();
  const E = await engine();
  // the usual order: Mark done at the site, the copy at home - this shoot has no folder yet
  const s = shootOf(E, "A000T9", "progress-1");
  for (const t of ["photo_shoot_uploads", "photo_drive_folders"]) {
    for (let i = E.rows[t].length - 1; i >= 0; i -= 1) if (E.rows[t][i].shoot_id === s.id) E.rows[t].splice(i, 1);
  }
  const job = E.rows.photo_drive_folders.find((x) => x.kind === "job" && x.plan_id === s.plan_id);
  assert.ok(job && job.drive_state === "found" && job.owner_ok === true, "the plan's job folder (the demo's seed)");
  const me = await open(E, "field", "?shoot=" + s.id);
  await filesRead(s.id);
  click('#shDScroll [data-act="done"]');
  click("#mvApply");
  await until(() => !$("shMo"), 4000, "sent");
  pc(E).run();
  await page._test.load({ quiet: true });
  await page._test.readFiles(s.id);
  assert.equal(E.rows.photo_shoots.find((x) => x.id === s.id).status, "done");
  assert.equal(S.files[s.id].st.ready_why, "no_hand_in", "no folder row: its owner is not known - the rule goes on");
  const line = document.querySelector("#shDScroll [data-completion]");
  assert.equal(line.getAttribute("data-completion"), "no_hand_in");
  assert.equal(line.textContent, WORDS.completion.no_hand_in);
  assert.ok(!text("shDScroll").includes(WORDS.completion.folder_problem), "never 'once this shoot's folder is back in DCR Photo & Video'");
  const at = (why, completion, what) => {
    const st = files(E).status(s.id, me.id);
    assert.deepEqual([st.ready_why, st.completion], [why, completion], what);
  };
  // the photographer's PC claims the folder (not in Drive yet, its owner not known), then copies into it
  const f = Object.assign({}, FK.p10FilesCols.photo_drive_folders, { id: 9001, kind: "shoot", parent_id: job.id, shoot_id: s.id, plan_id: s.plan_id,
    tag: "K7ZZM9", name: s.name, drive_state: "not_seen", owner_ok: null, files_rev: 1 });
  E.rows.photo_drive_folders.push(f);
  at("no_hand_in", "no_hand_in", "a row not in Drive yet: still a hand-in it needs");
  const u = Object.assign({}, FK.p10FilesCols.photo_shoot_uploads, { id: 9001, folder_id: f.id, shoot_id: s.id, state: "open", pc_label: "PHOTO-PC", pc_id: 3,
    started_by: me.id, recorded_files: 12, started_at: new Date().toISOString(), beat_at: new Date().toISOString() });
  E.rows.photo_shoot_uploads.push(u);
  at("copying", "done_copying", "the first copy open");
  Object.assign(u, { state: "sealed", sealed_by: me.id, files: 12, bytes: 52800000, sealed_at: new Date().toISOString() });
  Object.assign(f, { counted: 12, waiting: 12, photos: 12, bytes: 52800000 });
  at("files_waiting", "done_waiting", "handed in, Google Drive for desktop still uploading");
  // under a job folder that is gone: that folder's state - a folder problem, its line naming the JOB folder (files handed
  // in wait for it - never "once this shoot's folder is back", OD §6.6, review round 3)
  job.drive_state = "trashed";
  at("folder_problem", "job_folder_problem", "the job folder in Google Drive's trash");
  job.drive_state = "missing";
  at("folder_problem", "job_folder_problem", "the job folder moved out");
  // its help: a job folder's folder_gone is "Job folder gone" (folder_gone_job) - the chip drawn so
  f.help = ["folder_gone"];
  assert.deepEqual(files(E).status(s.id, me.id).help, ["folder_gone_job"]);
  await page._test.readFiles(s.id);
  assert.deepEqual(document.querySelectorAll("#shDScroll .sh-chip.need").map((n) => n.textContent), [WORDS.help.folder_gone_job]);
  assert.equal(document.querySelector("#shDScroll [data-completion]").textContent, WORDS.completion.job_folder_problem);
  job.drive_state = "found";
  f.drive_state = "trashed";
  assert.deepEqual(files(E).status(s.id, me.id).help, ["folder_gone"], "the shoot's own folder gone: Shoot folder gone, as before");
  f.drive_state = "not_seen";
  f.help = [];
  // known to be another account's (the row or its job folder): a folder problem
  job.owner_ok = false;
  at("folder_problem", "folder_problem", "the job folder of another account");
  job.owner_ok = true;
  f.owner_ok = false;
  at("folder_problem", "folder_problem", "the folder of another account");
  f.owner_ok = null;
  at("files_waiting", "done_waiting", "back to not known");
  // found: its owner must be known to be the company account's, and its job folder's too
  f.drive_state = "found";
  at("folder_problem", "folder_problem", "a folder Drive found whose owner is not known yet");
  f.owner_ok = true;
  job.owner_ok = null;
  at("folder_problem", "folder_problem", "found, its job folder's owner not known");
  job.owner_ok = true;
  at("files_waiting", "done_waiting", "found, both the company account's");
  f.drive_link = "https://drive.google.com/drive/folders/1FAKEshoot0000000009001";
  assert.equal(files(E).confirmAll(s.id), "ready", "the files arrive: on the Ready list once");
  at(null, "ready", "sent to marketing");
});

test("Take it over… is asked first (who, since when); Not for posting… needs a reason; a refusal is said in words and the list read again", { skip }, async () => {
  const E = await engine();
  await open(E, "viewer");
  const claimed = E.rows.photo_marketing.find((m) => m.state === "claimed");
  click('#shList [data-ready="' + claimed.id + '"]');
  assert.ok(!document.querySelector('#shDScroll [data-act="r-posted"]'), "claimed by someone else: only Take it over…");
  click('#shDScroll [data-act="r-take-over"]');
  assert.ok($("shMo"), "asked in a sheet");
  assert.match(document.querySelector('#shMo [data-ask="take_over"]').textContent, /^Avery has been on it since .+\. Take it over\?$/);
  click('#shMo [data-act="mv-close"]');
  assert.equal($("shMo"), null);
  assert.equal(E.rows.photo_marketing.find((m) => m.id === claimed.id).claimed_by, (await person("admin")).id, "Cancel: nothing sent");
  click('#shDScroll [data-act="r-take-over"]');
  assert.equal($("mvApply").textContent, "Take it over");
  click("#mvApply");
  await until(() => /You're on it/.test(text("shDScroll")), 4000, "taken over");
  assert.equal($("shMo"), null, "the sheet closed");
  const row = E.rows.photo_marketing.find((m) => m.id === claimed.id);
  assert.equal(row.taken_from, (await person("admin")).id, "taken_from keeps who had it");
  // Not for posting…: the reason is required
  click('#shDScroll [data-act="r-pass"]');
  click("#mvApply");
  await tick();
  assert.equal(text("mvMsg"), WORDS.hint.reason_needed);
  $("rsNote").value = "Too dark - reshoot";
  click("#mvApply");
  await until(() => E.rows.photo_marketing.find((m) => m.id === claimed.id).state === "passed", 4000, "passed");
  // someone else moved the other card meanwhile: "Someone changed this meanwhile", read again
  const other = E.rows.photo_marketing.find((m) => m.state === "ready");
  click('#shList [data-act="ready-tab"][data-tab="open"]');
  await until(() => document.querySelector('#shList [data-ready="' + other.id + '"]'));
  click('#shList [data-ready="' + other.id + '"]');
  other.state = "claimed"; other.claimed_by = (await person("admin")).id; other.claimed_at = new Date().toISOString();
  click('#shDScroll [data-act="r-claim"]');
  await until(() => toasts.some((t) => t[0] === WORDS.hint.changed), 4000, "changed");
  await until(() => /Avery is on it/.test(text("shDScroll")), 4000, "read again");
});

test("?ready=<id> (the push notice's link) opens that card; one no longer on the list says so; the photographer sees the state and no act", { skip }, async () => {
  const E = await engine();
  const posted = E.rows.photo_marketing.find((m) => m.state === "posted");
  await open(E, "viewer", "?ready=" + posted.id);
  assert.equal(S.view, "ready");
  assert.equal(S.rd.tab, "done", "the card's own tab");
  assert.equal(S.rd.sel, posted.id);
  assert.match(text("shDScroll"), /Posted .* by Taylor/);
  await open(E, "viewer", "?ready=999");
  assert.equal(S.view, "ready");
  assert.match(text("shList"), new RegExp(WORDS.hint.no_item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await open(E, "field", "?ready=" + E.rows.photo_marketing.find((m) => m.state === "claimed").id);
  assert.match(text("shDScroll"), /Avery is on it/);
  assert.equal(document.querySelectorAll("#shDScroll [data-act^='r-']").filter((b) => b.getAttribute("data-act") !== "r-shoot" && b.getAttribute("data-act") !== "r-open").length, 0,
    "the photographer: no act");
  await open(E, "field");
  assert.equal(S.view, "agenda", "a photographer opens on the Agenda");
  assert.equal(document.querySelector('#shViews [data-view="ready"]').hidden, false, "and may look at the Ready list");
});

test("who was told and how is an admin's line on a Ready card (P5b review round 7, as DCR Desktop 2's ReadyCard): never on the card of the marketing member it names, nor the photographer's", { skip }, async () => {
  const E = await engine();
  const ready = E.rows.photo_marketing.find((m) => m.state === "ready");
  assert.ok(Array.isArray(ready.told) && ready.told.length, "the demo's card has who was told");
  await open(E, "admin", "?ready=" + ready.id);
  assert.equal(S.rd.sel, ready.id);
  const told = document.querySelector("#shDScroll .sh-ftold");
  assert.ok(told, "the admin's card: " + text("shDScroll"));
  assert.match(told.textContent, /^Told Taylor \(phone, e-mail\)\.$/);
  for (const key of ["viewer", "field"]) {
    await open(E, key, "?ready=" + ready.id);
    assert.equal(S.rd.sel, ready.id, key);
    assert.equal(!!document.querySelector("#shDScroll .sh-ftold"), false, key + ": " + text("shDScroll"));
    assert.doesNotMatch(text("shDScroll"), /Told /, key);
  }
});

test("who was told and how is an admin's line in the shoot's Files section too (P5b review round 8, §41, as DCR Desktop 2's FilesSection): Taylor taps Open the shoot on their card and reads no line naming them; the photographer neither", { skip }, async () => {
  const E = await engine();
  const ready = E.rows.photo_marketing.find((m) => m.state === "ready");
  assert.ok(Array.isArray(ready.told) && ready.told.some((t) => t.name === "Taylor"), "the demo's card told Taylor");
  // the marketing walk: the card, then its Open the shoot (the shoot sheet's Files section)
  await open(E, "viewer", "?ready=" + ready.id);
  assert.equal(S.rd.sel, ready.id);
  assert.equal(document.querySelector('#shDScroll [data-act="r-shoot"]').getAttribute("href"), "shoots.html?shoot=" + ready.shoot_id);
  await open(E, "viewer", "?shoot=" + ready.shoot_id);
  await filesRead(ready.shoot_id);
  assert.equal(S.files[ready.shoot_id].st.completion, "ready");
  assert.deepEqual(S.files[ready.shoot_id].st.marketing.told, [], "the status answers who was told to admins only (v19, §42: [] for everyone else)");
  assert.match(text("shDScroll"), /Sent to marketing /, "the completion line stays");
  assert.equal(!!document.querySelector("#shDScroll .sh-ftold"), false, "Taylor's Files section: " + text("shDScroll"));
  assert.doesNotMatch(text("shDScroll"), /Told /);
  await open(E, "field", "?shoot=" + ready.shoot_id);
  await filesRead(ready.shoot_id);
  assert.match(text("shDScroll"), /Sent to marketing /);
  assert.equal(!!document.querySelector("#shDScroll .sh-ftold"), false, "the photographer (not an admin): " + text("shDScroll"));
  assert.deepEqual(S.files[ready.shoot_id].st.marketing.told, [], "nor does the photographer's status answer it");
  // an admin: did the notices go out?
  await open(E, "admin", "?shoot=" + ready.shoot_id);
  await filesRead(ready.shoot_id);
  const told = document.querySelector("#shDScroll .sh-ftold");
  assert.ok(told, "the admin's Files section: " + text("shDScroll"));
  assert.match(told.textContent, /^Told Taylor \(phone, e-mail\)\.$/);
});

test("who was told and how is answered to admins only (P5b review round 9, §42, as photo_drive_status and photo_ready_list now): the demo's status and Ready list give [] to marketing and the photographer", { skip }, async () => {
  const E = await engine();
  const ready = E.rows.photo_marketing.find((m) => m.state === "ready");
  assert.ok(ready.told.length, "the row keeps who was told");
  for (const key of ["viewer", "field", "admin"]) {
    const p = await person(key);
    const st = files(E).status(ready.shoot_id, p.id);
    useClient(clientAs(E, p.id));
    const list = await repoFiles.readyList("open");
    const item = list.items.find((i) => i.id === ready.id);
    const want = key === "admin" ? [{ name: "Taylor", email: "sent", push: "phone" }] : [];
    assert.deepEqual(st.marketing.told, want, key + ": photo_drive_status");
    assert.deepEqual(item.told, want, key + ": photo_ready_list");
  }
});

test("marketing's culls after Ready (P5b review round 9, §42, §13.1 rules 7 and 9): files marketing deleted in OneDrive after the shoot went to them read a calm line - never 'missing in OneDrive' in red - for marketing and the photographer; off the list they are the photographer's again", { skip }, async () => {
  const E = await engine();
  const s = shootOf(E, "A000T8", "progress-1");
  const m = E.rows.photo_marketing.find((x) => x.shoot_id === s.id);
  assert.equal(m.state, "posted", "the demo's posted shoot");
  const calm = "All the files left in the folder are in OneDrive ✓ (checked ";
  for (const key of ["viewer", "field"]) {
    await open(E, key, "?shoot=" + s.id);
    await filesRead(s.id);
    const st = S.files[s.id].st;
    assert.deepEqual([st.files.missing, st.files.culled], [6, 6], key + ": the status answers the culls");
    assert.equal(lines()[0], "confirmed_culled", key + ": " + text("shDScroll"));
    const line = document.querySelector('#shDScroll .sh-fl[data-line="confirmed_culled"]');
    assert.ok(line.textContent.startsWith(calm) && line.textContent.endsWith("). 6 were deleted or moved out of it after the shoot went to marketing."), line.textContent);
    assert.match(line.getAttribute("class"), /\bok\b/, "the confirmed line's tone");
    assert.ok(!lines().some((c) => /^problem_/.test(c)), key + ": no problem line");
  }
  // a file of a second card lost too: problem_missing counts it alone, then the culls' calm line
  const f = E.rows.photo_drive_folders.find((x) => x.kind === "shoot" && x.shoot_id === s.id);
  Object.assign(f, { counted: 61, missing: 7 });
  await open(E, "field", "?shoot=" + s.id);
  await filesRead(s.id);
  assert.deepEqual(lines().slice(0, 2), ["problem_missing", "culled"]);
  assert.equal(document.querySelector('#shDScroll .sh-fl[data-line="problem_missing"]').textContent, "1 file is missing in OneDrive (deleted, or moved out of the shoot's folder).");
  assert.equal(document.querySelector('#shDScroll .sh-fl[data-line="culled"]').textContent,
    "6 files were deleted in OneDrive or moved out of the folder after the shoot went to marketing.");
  // the help notice: a hand-in sealed after ready lifts the hold - for the photographer's own file, never for the culls
  const field = await person("field");
  f.help = ["problem"];
  E.rows.photo_shoot_uploads.push(Object.assign({}, E.rows.photo_shoot_uploads.find((u) => u.folder_id === f.id), { id: 9401, files: 1, recorded_files: 1,
    started_at: new Date().toISOString(), sealed_at: new Date().toISOString() }));
  assert.deepEqual(files(E).status(s.id, field.id).help, ["problem"], "the photographer's own missing file");
  Object.assign(f, { counted: 60, missing: 6 });
  assert.deepEqual(files(E).status(s.id, field.id).help, [], "only marketing's culls: no help notice about them");
  // withdrawn from the list (the shoot not done any more): the files are the photographer's again
  m.state = "withdrawn";
  const off = files(E).status(s.id, field.id);
  assert.equal(off.files.culled, 0, "0 off the Ready list");
  assert.deepEqual(off.help, ["problem"]);
});

// photo_marketing_act as a phone with weak signal sees it: mode "down" rejects as fetch does offline, "busy" is a
// gateway's 503, "rate" the database's PT429, "lost" lets it through but loses its answer on the way (rejects as
// "down" once the database has done it), "hold" keeps it on its way until net.held.go() (sent, answered) or
// net.held.fail() (no answer, nothing done); "" lets it through
function actSignal() {
  const net = { mode: "", calls: 0, held: null };
  net.wrap = (base) => Object.assign({}, base, {
    rpc: (name, args) => {
      if (name === "photo_marketing_act" && net.mode) {
        net.calls += 1;
        if (net.mode === "hold") {
          return new Promise((res, rej) => {
            net.held = { go: () => { net.held = null; res(base.rpc(name, args)); }, fail: () => { net.held = null; rej(new TypeError("Failed to fetch")); } };
          });
        }
        if (net.mode === "lost") return Promise.resolve(base.rpc(name, args)).then(() => { throw new TypeError("Failed to fetch"); });
        if (net.mode === "down") return Promise.reject(new TypeError("Failed to fetch"));
        if (net.mode === "busy") return Promise.resolve({ data: null, error: { status: 503, message: "Service Unavailable" } });
        if (net.mode === "rate") return Promise.resolve({ data: null, error: { code: "PT429", hint: "rate", message: "Too many tries - wait a minute." } });
      }
      return base.rpc(name, args);
    },
  });
  return net;
}

test("Posted… / Not for posting… / Take it over… that fail with no signal, a busy server or a rate keep their sheet open, the words in it and what was typed - pressed again, the same is sent; a refusal that ends the act (changed) closes it with a toast (P5b review round 10)", { skip }, async () => {
  const E = await engine();
  const net = actSignal();
  await open(E, "viewer", "", net.wrap);
  const ready = E.rows.photo_marketing.find((m) => m.state === "ready");
  click('#shList [data-ready="' + ready.id + '"]');
  click('#shDScroll [data-act="r-posted"]');
  const where = (v) => document.querySelectorAll('#shMo input[name="rsWhere"]').find((x) => x.getAttribute("value") === v);
  where("instagram").checked = true;
  where("website").checked = true;
  $("rsLink").value = "https://www.example.com/p/88";
  $("rsNote").value = "Reel of the framing";
  // (the act answered and the page done with it: its sheet no longer sending, or closed)
  const answered = (n, what) => until(() => net.calls > n && !S.rd.busy && !(S.mv && S.mv.busy), 4000, what);
  for (const [mode, said] of [["down", WORDS.hint.no_answer], ["busy", WORDS.hint.no_answer], ["rate", WORDS.hint.rate]]) {
    net.mode = mode;
    const n = net.calls;
    click("#mvApply");
    await answered(n, mode + ": answered");
    assert.ok($("shMo"), mode + ": the sheet stays open");
    assert.equal(text("mvMsg"), said, mode + ": said in the sheet");
    assert.deepEqual([where("instagram").checked, where("website").checked, $("rsLink").value, $("rsNote").value],
      [true, true, "https://www.example.com/p/88", "Reel of the framing"], mode + ": the ticks, the link and the note kept");
    assert.equal($("mvApply").disabled, false, mode + ": Posted can be pressed again");
    assert.equal($("mvApply").textContent, WORDS.ready.btn_posted.replace(/…$/, ""));
    assert.deepEqual(toasts, [], mode + ": no toast over the sheet");
    assert.equal(document.querySelector('#shDScroll [data-act="r-posted"]').disabled, false, mode + ": the card's buttons free again behind it");
    assert.equal(E.rows.photo_marketing.find((m) => m.id === ready.id).state, "ready", mode + ": nothing changed");
  }
  net.mode = "";
  click("#mvApply");
  await until(() => !$("shMo"), 4000, "sent once the signal is back: the sheet closed");
  const posted = E.rows.photo_marketing.find((m) => m.id === ready.id);
  assert.deepEqual([posted.state, posted.posted_where, posted.posted_link, posted.posted_note],
    ["posted", ["instagram", "website"], "https://www.example.com/p/88", "Reel of the framing"], "what was typed, sent as it was");
  // Not posted yet (its question first): pressed again in the same sheet once the signal is back
  click('#shList [data-act="ready-tab"][data-tab="done"]');
  await until(() => document.querySelector('#shList [data-ready="' + ready.id + '"]'), 4000, "the Done tab");
  click('#shList [data-ready="' + ready.id + '"]');
  click('#shDScroll [data-act="r-reopen"]');
  assert.ok(document.querySelector('#shMo [data-ask="reopen_ask"]'), "asked first");
  net.mode = "down";
  let n = net.calls;
  click("#mvApply");
  await answered(n, "reopen: answered");
  assert.ok($("shMo"), "reopen: the sheet stays open");
  assert.equal(text("mvMsg"), WORDS.hint.no_answer);
  assert.equal($("mvApply").textContent, WORDS.ready.btn_reopen);
  assert.equal(E.rows.photo_marketing.find((m) => m.id === ready.id).state, "posted", "not reopened");
  net.mode = "";
  click("#mvApply");
  await until(() => !$("shMo") && E.rows.photo_marketing.find((m) => m.id === ready.id).state === "claimed", 4000, "reopened");
  click('#shList [data-act="ready-tab"][data-tab="open"]');
  // Take it over…: nothing typed, but Take it over is pressed again in the same sheet
  const claimed = E.rows.photo_marketing.find((m) => m.state === "claimed" && m.id !== ready.id);
  const admin = await person("admin");
  await until(() => document.querySelector('#shList [data-ready="' + claimed.id + '"]'), 4000, "the Open tab");
  click('#shList [data-ready="' + claimed.id + '"]');
  click('#shDScroll [data-act="r-take-over"]');
  net.mode = "down";
  n = net.calls;
  click("#mvApply");
  await answered(n, "take over: answered");
  assert.ok($("shMo"), "take over: the sheet stays open");
  assert.equal(text("mvMsg"), WORDS.hint.no_answer);
  assert.equal($("mvApply").textContent, "Take it over");
  assert.equal(E.rows.photo_marketing.find((m) => m.id === claimed.id).claimed_by, admin.id, "not taken");
  net.mode = "";
  click("#mvApply");
  await until(() => !$("shMo") && /You're on it/.test(text("shDScroll")), 4000, "taken over");
  // Not for posting…: the reason kept through no signal
  click('#shDScroll [data-act="r-pass"]');
  $("rsNote").value = "Too dark - reshoot";
  net.mode = "down";
  n = net.calls;
  click("#mvApply");
  await answered(n, "pass: answered");
  assert.ok($("shMo"), "pass: the sheet stays open");
  assert.equal($("rsNote").value, "Too dark - reshoot", "the reason kept");
  assert.equal(text("mvMsg"), WORDS.hint.no_answer);
  // someone released it meanwhile: a refusal that ends the act - a toast, the sheet closed, the list read again
  net.mode = "";
  const row = E.rows.photo_marketing.find((m) => m.id === claimed.id);
  Object.assign(row, { state: "ready", claimed_by: null, claimed_at: null });
  toasts.length = 0;
  click("#mvApply");
  await until(() => !$("shMo") && toasts.some((t) => t[0] === WORDS.hint.changed), 4000, "changed: closed");
  assert.equal(row.state, "ready", "nothing sent over the change");
  await until(() => /^Ready/.test(text("shDScroll")) || document.querySelector('#shDScroll [data-act="r-claim"]'), 4000, "the card read again");
});

test("Back on the list whose answer was lost on the way: the sheet stays open, and pressed again it is the database's again - the sheet closes with no 'Someone changed this meanwhile', the card back on the list (P5b review round 11, §11.2, §44)", { skip }, async () => {
  const E = await engine();
  const net = actSignal();
  const viewer = await person("viewer");
  const card = E.rows.photo_marketing.find((m) => m.state === "ready");
  useClient(clientAs(E, viewer.id));
  await repoFiles.act(card.id, "pass", "ready", { note: "Same angles as last week" });
  await open(E, "viewer", "", net.wrap);
  click('#shList [data-act="ready-tab"][data-tab="done"]');
  await until(() => document.querySelector('#shList [data-ready="' + card.id + '"]'), 4000, "the Done tab");
  click('#shList [data-ready="' + card.id + '"]');
  click('#shDScroll [data-act="r-reopen"]');
  assert.ok(document.querySelector('#shMo [data-ask="reopen_passed_ask"]'), "asked first");
  assert.equal($("mvApply").textContent, WORDS.ready.btn_reopen_passed);
  const answered = (n, what) => until(() => net.calls > n && !S.rd.busy && !(S.mv && S.mv.busy), 4000, what);
  net.mode = "lost";
  const n = net.calls;
  click("#mvApply");
  await answered(n, "lost: answered");
  assert.ok($("shMo"), "no answer: the sheet stays open");
  assert.equal(text("mvMsg"), WORDS.hint.no_answer);
  assert.equal(E.rows.photo_marketing.find((m) => m.id === card.id).state, "ready", "the database did it - its answer was lost");
  net.mode = "";
  toasts.length = 0;
  click("#mvApply");
  await until(() => !$("shMo") && !S.rd.busy, 4000, "sent again: the sheet closed");
  assert.ok(!toasts.some((t) => t[0] === WORDS.hint.changed), "never 'Someone changed this meanwhile': " + JSON.stringify(toasts));
  assert.deepEqual(toasts, [], "no toast at all");
  const row = E.rows.photo_marketing.find((m) => m.id === card.id);
  assert.deepEqual([row.state, row.claimed_by, row.pass_reason], ["ready", null, null], "back on the list, nobody on it");
  click('#shList [data-act="ready-tab"][data-tab="open"]');
  await until(() => document.querySelector('#shList [data-ready="' + card.id + '"]'), 4000, "the card on the Open tab");
  assert.match(document.querySelector('#shList [data-ready="' + card.id + '"]').textContent, /^Ready/, "Ready again");
});

test("a Ready sheet whose act is on its way says so: Sending…, and Cancel / Keep it and the × read 'Close (still sending)', as Move… and Mark done… do - closed then, a refusal is a toast and an answer the card moving; answered with the sheet open, its own words come back (P5b review round 12, §45)", { skip }, async () => {
  const E = await engine();
  const net = actSignal();
  await open(E, "viewer", "", net.wrap);
  const ready = E.rows.photo_marketing.find((m) => m.state === "ready");
  const foot = () => document.querySelector('#shMo .sh-mo-ft [data-act="mv-close"]');
  const x = () => document.querySelector('#shMo .sh-x[data-act="mv-close"]');
  const settled = (what) => until(() => !net.held && !S.rd.busy && !(S.mv && S.mv.busy), 4000, what);
  click('#shList [data-ready="' + ready.id + '"]');
  click('#shDScroll [data-act="r-posted"]');
  assert.deepEqual([foot().textContent, x().getAttribute("aria-label")], ["Cancel", "Close"], "before: Cancel");
  document.querySelectorAll('#shMo input[name="rsWhere"]').find((n) => n.getAttribute("value") === "instagram").checked = true;
  net.mode = "hold";
  click("#mvApply");
  await until(() => net.held, 4000, "on its way");
  assert.deepEqual([$("mvApply").textContent, $("mvApply").disabled], ["Sending…", true]);
  assert.equal(foot().textContent, CLOSE_SENDING, "closing does not stop it - the button says so, never 'Cancel'");
  assert.equal(x().getAttribute("aria-label"), "Close - it is still being sent");
  // closed while it is on its way, then no answer: said in a toast (the sheet is gone), nothing done
  toasts.length = 0;
  click('#shMo .sh-mo-ft [data-act="mv-close"]');
  assert.ok(!$("shMo"), "closed");
  net.held.fail();
  await settled("no answer, after the sheet closed");
  assert.deepEqual(toasts, [[WORDS.hint.no_answer, "error"]], "its refusal is a toast");
  assert.equal(E.rows.photo_marketing.find((m) => m.id === ready.id).state, "ready", "nothing done");
  // closed with Escape while on its way, then it goes through: the card moves (Posted, on the Done tab) and no toast
  click('#shDScroll [data-act="r-posted"]');
  document.querySelectorAll('#shMo input[name="rsWhere"]').find((n) => n.getAttribute("value") === "website").checked = true;
  net.mode = "hold";
  click("#mvApply");
  await until(() => net.held, 4000, "on its way again");
  assert.equal(foot().textContent, CLOSE_SENDING);
  toasts.length = 0;
  document._dispatch(document.body, { type: "keydown", key: "Escape" });
  assert.ok(!$("shMo"), "Escape closed it");
  net.held.go();
  net.mode = "";
  await settled("answered, after the sheet closed");
  await until(() => !document.querySelector('#shList [data-ready="' + ready.id + '"]'), 4000, "the card off the Open tab");
  assert.equal(E.rows.photo_marketing.find((m) => m.id === ready.id).state, "posted", "posted, as it was sent");
  assert.deepEqual(toasts, [], "nothing more to say: the card moved");
  // Not posted yet: Keep it reads 'Close (still sending)' while on its way, and Keep it again once answered in the sheet
  click('#shList [data-act="ready-tab"][data-tab="done"]');
  await until(() => document.querySelector('#shList [data-ready="' + ready.id + '"]'), 4000, "the Done tab");
  click('#shList [data-ready="' + ready.id + '"]');
  click('#shDScroll [data-act="r-reopen"]');
  assert.ok(document.querySelector('#shMo [data-ask="reopen_ask"]'), "asked first (where it was posted is cleared)");
  assert.equal(foot().textContent, WORDS.copy.cancel_keep);
  net.mode = "hold";
  click("#mvApply");
  await until(() => net.held, 4000, "reopen on its way");
  assert.equal(foot().textContent, CLOSE_SENDING, "Keep it says it does not stop it");
  net.held.fail();
  await settled("reopen: no answer, the sheet open");
  assert.ok($("shMo"), "the sheet stays open");
  assert.equal(text("mvMsg"), WORDS.hint.no_answer);
  assert.deepEqual([foot().textContent, x().getAttribute("aria-label"), $("mvApply").textContent], [WORDS.copy.cancel_keep, "Close", WORDS.ready.btn_reopen],
    "answered: its own words back");
  assert.equal(E.rows.photo_marketing.find((m) => m.id === ready.id).state, "posted", "not reopened");
});

test("Posted… / Not for posting… whose answer was lost on the way, corrected in the sheet and pressed again: the card keeps the correction - the database's again keeps what the resend carries (P5b review round 12, §45)", { skip }, async () => {
  const E = await engine();
  const net = actSignal();
  await open(E, "viewer", "", net.wrap);
  const ready = E.rows.photo_marketing.find((m) => m.state === "ready");
  const answered = (n, what) => until(() => net.calls > n && !S.rd.busy && !(S.mv && S.mv.busy), 4000, what);
  const row = () => E.rows.photo_marketing.find((m) => m.id === ready.id);
  click('#shList [data-ready="' + ready.id + '"]');
  click('#shDScroll [data-act="r-posted"]');
  const where = (v) => document.querySelectorAll('#shMo input[name="rsWhere"]').find((n) => n.getAttribute("value") === v);
  where("instagram").checked = true;
  $("rsLink").value = "https://www.example.com/p/typo1";
  $("rsNote").value = "Reel";
  net.mode = "lost";
  let n = net.calls;
  click("#mvApply");
  await answered(n, "posted: its answer lost");
  assert.ok($("shMo"), "the sheet stays open");
  assert.equal(text("mvMsg"), WORDS.hint.no_answer);
  assert.deepEqual([row().state, row().posted_link], ["posted", "https://www.example.com/p/typo1"], "the database did it - its answer was lost");
  // the link's typo seen and corrected, a tick and the note added, pressed again
  where("facebook").checked = true;
  $("rsLink").value = "https://www.example.com/p/right1";
  $("rsNote").value = "Reel and post";
  net.mode = "";
  toasts.length = 0;
  click("#mvApply");
  await until(() => !$("shMo") && !S.rd.busy, 4000, "sent again: the sheet closed");
  assert.deepEqual(toasts, [], "no toast");
  assert.deepEqual([row().state, row().posted_where, row().posted_link, row().posted_note],
    ["posted", ["facebook", "instagram"], "https://www.example.com/p/right1", "Reel and post"], "the card keeps what was corrected");
  // Not for posting… (the card back to the viewer with Not posted yet): its reason corrected after a lost answer
  click('#shList [data-act="ready-tab"][data-tab="done"]');
  await until(() => document.querySelector('#shList [data-ready="' + ready.id + '"]'), 4000, "the Done tab");
  click('#shList [data-ready="' + ready.id + '"]');
  click('#shDScroll [data-act="r-reopen"]');
  click("#mvApply");
  await until(() => !$("shMo") && row().state === "claimed" && !S.rd.busy, 4000, "not posted yet: on it");
  click('#shList [data-act="ready-tab"][data-tab="open"]');
  await until(() => document.querySelector('#shList [data-ready="' + ready.id + '"]'), 4000, "the Open tab");
  click('#shList [data-ready="' + ready.id + '"]');
  click('#shDScroll [data-act="r-pass"]');
  $("rsNote").value = "Too drak";
  net.mode = "lost";
  n = net.calls;
  click("#mvApply");
  await answered(n, "pass: its answer lost");
  assert.ok($("shMo"), "the sheet stays open");
  assert.equal(text("mvMsg"), WORDS.hint.no_answer);
  assert.deepEqual([row().state, row().pass_reason], ["passed", "Too drak"], "the database did it - its answer was lost");
  $("rsNote").value = "Too dark - reshoot";
  net.mode = "";
  toasts.length = 0;
  click("#mvApply");
  await until(() => !$("shMo") && !S.rd.busy, 4000, "pass sent again: closed");
  assert.deepEqual(toasts, [], "no toast");
  assert.deepEqual([row().state, row().pass_reason], ["passed", "Too dark - reshoot"], "the corrected reason kept");
});

test("Not for posting… of a card someone else is on is an admin's (P5b review round 9, §11.2, as Posted…): marketing is refused not_yours, said in words; an admin may", { skip }, async () => {
  const E = await engine();
  const claimed = E.rows.photo_marketing.find((m) => m.state === "claimed");
  const admin = await person("admin");
  assert.equal(claimed.claimed_by, admin.id, "the demo's card the admin is on");
  const viewer = await person("viewer");
  useClient(clientAs(E, viewer.id));
  const e = await repoFiles.act(claimed.id, "pass", "claimed", { note: "Too dark" }).then(() => null, (x) => x);
  assert.ok(e, "refused");
  assert.deepEqual([e.code, e.hint], ["42501", "not_yours"]);
  assert.equal(actText(e, "pass", "claimed"), WORDS.ready.not_yours);
  assert.equal(E.rows.photo_marketing.find((m) => m.id === claimed.id).state, "claimed", "nothing changed");
  // the card never offers it to them: Take it over… only
  await open(E, "viewer", "?ready=" + claimed.id);
  assert.equal(document.querySelector('#shDScroll [data-act="r-pass"]'), null);
  // an admin may pass a card someone else is on: Taylor's
  const ready = E.rows.photo_marketing.find((m) => m.state === "ready");
  useClient(clientAs(E, viewer.id));
  await repoFiles.act(ready.id, "claim", "ready");
  useClient(clientAs(E, admin.id));
  assert.equal((await repoFiles.act(ready.id, "pass", "claimed", { note: "Same angles as before" })).state, "passed");
});

test("a card claimed by someone taken off marketing or turned off goes back to ready (P5b review round 9, §11.1): taken_from keeps them, the others' Home number counts it again; an admin keeps theirs", { skip }, async () => {
  const E = await engine();
  const admin = await person("admin");
  const viewer = await person("viewer");
  const ready = E.rows.photo_marketing.find((m) => m.state === "ready");
  useClient(clientAs(E, viewer.id));
  await repoFiles.act(ready.id, "claim", "ready");
  assert.equal(E.rows.photo_marketing.find((m) => m.id === ready.id).claimed_by, viewer.id);
  // the Access tab: Taylor taken off marketing
  useClient(clientAs(E, admin.id));
  const team = E.rows.photo_team.find((t) => t.profile_id === viewer.id);
  await repo.setTeam(viewer.id, { photographer: false, marketing: false }, team.version);
  let row = E.rows.photo_marketing.find((m) => m.id === ready.id);
  assert.deepEqual([row.state, row.claimed_by, row.taken_from], ["ready", null, viewer.id], "back to ready, taken_from kept");
  const counts = (await repoFiles.readyList("open")).counts;
  assert.deepEqual([counts.ready, counts.claimed], [1, 1], "ready again for everyone; only the admin's own card is still claimed");
  assert.equal(E.rows.photo_marketing.find((m) => m.state === "claimed").claimed_by, admin.id, "an admin can still act on theirs");
  // an admin on marketing too, then taken off it: still an admin, so the card they are on stays theirs
  await repo.setTeam(admin.id, { photographer: false, marketing: true, googleEmail: "office.admin.demo@example.com" }, null);
  await repo.setTeam(admin.id, { photographer: false, marketing: false }, E.rows.photo_team.find((t) => t.profile_id === admin.id).version);
  assert.equal((E.rows.photo_marketing.find((m) => m.claimed_by === admin.id) || {}).state, "claimed", "an admin keeps the card they are on");
  // back on marketing, on it again, then turned off: the same
  await repo.setTeam(viewer.id, { photographer: false, marketing: true, googleEmail: "taylor.viewer.demo@example.com" }, null);
  useClient(clientAs(E, viewer.id));
  await repoFiles.act(ready.id, "claim", "ready");
  const turnOff = await clientAs(E, admin.id).rpc("admin_set_profile", { p_id: viewer.id, p_active: false });
  assert.equal(turnOff.error, null, JSON.stringify(turnOff.error));
  row = E.rows.photo_marketing.find((m) => m.id === ready.id);
  assert.deepEqual([row.state, row.claimed_by, row.taken_from], ["ready", null, viewer.id], "turned off: back to ready");
  // a withdrawn card that would come back claimed by them comes back ready
  const again = await clientAs(E, admin.id).rpc("admin_set_profile", { p_id: viewer.id, p_active: true });
  assert.equal(again.error, null);
  useClient(clientAs(E, viewer.id));
  await repoFiles.act(ready.id, "claim", "ready");
  row = E.rows.photo_marketing.find((m) => m.id === ready.id);
  Object.assign(row, { state: "withdrawn", withdrawn_from: "claimed", withdrawn_at: new Date().toISOString() });
  useClient(clientAs(E, admin.id));
  await repo.setTeam(viewer.id, { photographer: false, marketing: false }, E.rows.photo_team.find((t) => t.profile_id === viewer.id).version);
  row = E.rows.photo_marketing.find((m) => m.id === ready.id);
  assert.deepEqual([row.state, row.withdrawn_from, row.claimed_by, row.taken_from], ["withdrawn", "ready", null, viewer.id]);
});

test("the push notice tapped by a member the office hasn't given access yet (OD §8.4, cases access_line): the card says so in Open in OneDrive's place; the list's rows don't; an account outside the company says to ask the office; the photographer reads no_access; shared: Open in OneDrive and the open tip", { skip }, async () => {
  const E = await engine();
  const viewer = await person("viewer");
  const ready = E.rows.photo_marketing.find((m) => m.state === "ready");
  files(E).state({ shares: { [viewer.id]: "waiting" } });                     // wanted, not marked shared yet
  await open(E, "viewer", "?ready=" + ready.id);
  assert.equal(S.rd.sel, ready.id);
  assert.equal(document.querySelector('#shDScroll [data-act="r-open"]'), null, "no Open in OneDrive yet");
  const box = document.querySelector('#shDScroll [data-warning="access_waiting"]');
  assert.ok(box, "the access line in the button's place: " + text("shDScroll"));
  assert.equal(box.textContent, WORDS.ready.access_waiting);
  assert.match(box.getAttribute("class"), /\bwait\b/);
  assert.ok(!/few minutes/.test(text("shDScroll")), "DCR never claims access it cannot see: the office's word, never 'in a few minutes'");
  assert.ok(document.querySelector('#shDScroll [data-act="r-claim"]'), "the acts stay");
  assert.ok(document.querySelector('#shList [data-ready="' + ready.id + '"]'), "the list is drawn");
  assert.ok(!text("shList").includes(WORDS.ready.access_waiting), "the rows keep their warning for the shoot's own state");
  // the shoot's Files section (the card's See the shoot link): the same reason in Open in OneDrive's place
  await open(E, "viewer", "?shoot=" + ready.shoot_id);
  await filesRead(ready.shoot_id);
  assert.ok(lines().indexOf("access_waiting") !== -1, "the Files line: " + lines().join());
  assert.ok(!document.querySelector('#shDScroll [data-act="open-folder"]'));
  assert.equal(document.querySelector('#shDScroll .sh-fl[data-line="access_waiting"]').textContent, WORDS.files.access_waiting);
  // an account outside the company's domains: ask the office to fix it on the Photo team (warn)
  files(E).state({ shares: { [viewer.id]: "not_company" } });
  await open(E, "viewer", "?ready=" + ready.id);
  const nc = document.querySelector('#shDScroll [data-warning="access_not_company"]');
  assert.ok(nc && nc.textContent === WORDS.ready.access_not_company, text("shDScroll"));
  assert.match(nc.getAttribute("class"), /\bwarn\b/);
  // the photographer (not on the share, M10): the state, no act, and why there's no link
  await open(E, "field", "?ready=" + ready.id);
  assert.equal(document.querySelector('#shDScroll [data-warning="no_access"]').textContent, WORDS.ready.no_access);
  assert.equal(document.querySelector('#shDScroll [data-act="r-open"]'), null);
  assert.equal(!!document.querySelector("#shDScroll .sh-rtip"), false, "no Open in OneDrive: no tip about opening it");
  // shared: Open in OneDrive with its tip under the buttons (ready.open_tip: never sync the whole folder, OD §8.4 -
  // review round 1: worked out, never drawn), no access line
  files(E).state({ shares: { [viewer.id]: "shared" } });
  await open(E, "viewer", "?ready=" + ready.id);
  assert.ok(document.querySelector('#shDScroll [data-act="r-open"]'));
  const tip = document.querySelector('#shDScroll .sh-rtip[data-tip="open_tip"]');
  assert.ok(tip, "the open tip: " + text("shDScroll"));
  assert.equal(tip.textContent, WORDS.ready.open_tip);
  const kids = tip.parentNode.children;
  assert.equal(kids[kids.indexOf(tip) - 1].getAttribute("class"), "sh-acts", "right under the buttons");
  assert.deepEqual(document.querySelectorAll("#shDScroll [data-warning]").map((n) => n.getAttribute("data-warning"))
    .filter((c) => ["no_access", "access_waiting", "access_not_company"].indexOf(c) !== -1), []);
});

// photo_ready_list with no signal: the n-th call on (from: 1 = every call) rejects as fetch does offline; up = signal back
function weakSignal(from) {
  const net = { calls: 0, down: true };
  net.wrap = (base) => Object.assign({}, base, {
    rpc: (name, args) => {
      if (name === "photo_ready_list" && net.down && ++net.calls >= from) return Promise.reject(new TypeError("Failed to fetch"));
      return base.rpc(name, args);
    },
  });
  return net;
}
const NO_ITEM = new RegExp(WORDS.hint.no_item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
function addresses() {
  const said = [];
  const was = window.history.replaceState;
  window.history.replaceState = (s, t, url) => { said.push(String(url)); };
  return { said, done: () => { window.history.replaceState = was; } };
}

test("?ready=<id> with no signal (the push notice tapped on a weak phone): the Ready view says the read failed, Try again opens that card - never 'isn't on the list any more'", { skip }, async () => {
  const E = await engine();
  const posted = E.rows.photo_marketing.find((m) => m.state === "posted");
  const net = weakSignal(1);
  const url = addresses();
  try {
    await open(E, "viewer", "?ready=" + posted.id, net.wrap);
    assert.equal(S.rd.readable, false, "the list was never read");
    assert.equal(S.view, "ready", "the Ready view, not the Agenda");
    assert.doesNotMatch(document.body.textContent, NO_ITEM, "a list not read is not said to have lost the card");
    assert.ok(text("shList").includes(WORDS.ready.read_failed), "the list's own words (ready.read_failed, round 10), never the shoot schedule's: " + text("shList"));
    assert.ok(document.querySelector('#shList [data-act="ready-reload"]'), "Try again");
    const btn = document.querySelector('#shViews [data-view="ready"]');
    assert.equal(btn.hidden, false, "the view's own button, pressed");
    assert.equal(btn.getAttribute("aria-pressed"), "true");
    assert.equal(url.said[url.said.length - 1], "shoots.html?ready=" + posted.id, "the address keeps the card (a reload opens it)");
    click('#shList [data-act="ready-reload"]');
    await until(() => text("shList").includes(WORDS.ready.read_failed) && document.querySelector('#shList [data-act="ready-reload"]'), 4000, "still no signal");
    net.down = false;
    click('#shList [data-act="ready-reload"]');
    await until(() => S.rd.sel === posted.id, 4000, "the card opened once read");
    assert.equal(S.rd.tab, "done", "on its own tab (both lists read)");
    assert.equal(S.rd.want, null);
    assert.match(text("shDScroll"), /Posted .* by Taylor/);
    assert.doesNotMatch(document.body.textContent, NO_ITEM);
    assert.equal(url.said[url.said.length - 1], "shoots.html?ready=" + posted.id);
  } finally { url.done(); }
});

test("?ready=<id>: the first read answered, the second (both lists) lost - a card read before opens, a Done card waits for Try again; one the list does not have still says no_item", { skip }, async () => {
  const E = await engine();
  const posted = E.rows.photo_marketing.find((m) => m.state === "posted");
  const claimed = E.rows.photo_marketing.find((m) => m.state === "claimed");
  let net = weakSignal(2);
  await open(E, "viewer", "?ready=" + claimed.id, net.wrap);
  assert.equal(S.rd.sel, claimed.id, "in the open list read first: opened");
  assert.match(text("shDScroll"), /Avery is on it/);
  assert.equal(S.rd.err, "");
  net = weakSignal(2);
  await open(E, "viewer", "?ready=" + posted.id, net.wrap);
  assert.equal(S.view, "ready");
  assert.equal(S.rd.sel, null);
  assert.doesNotMatch(document.body.textContent, NO_ITEM, "the Done list was never read");
  assert.ok(text("shList").includes(WORDS.ready.read_failed), text("shList"));
  net.down = false;
  click('#shList [data-act="ready-reload"]');
  await until(() => S.rd.sel === posted.id, 4000, "opened once read");
  assert.equal(S.rd.tab, "done");
  await open(E, "viewer", "?ready=999");
  assert.match(text("shList"), NO_ITEM, "read, and not in it: no_item");
  assert.ok(!document.querySelector('#shList [data-act="ready-reload"]'));
});

test("marketing with no signal opens on Ready for marketing (its words, Try again), not the Agenda; Try again reads the list", { skip }, async () => {
  const E = await engine();
  const net = weakSignal(1);
  await open(E, "viewer", "", net.wrap);
  assert.equal(S.view, "ready", "the first view for someone only on marketing, its read failed or not");
  assert.ok(text("shList").includes(WORDS.ready.read_failed), text("shList"));
  net.down = false;
  click('#shList [data-act="ready-reload"]');
  await until(() => document.querySelectorAll("#shList .sh-rrow").length === 2, 4000, "the list read");
  assert.equal(S.rd.sel, null, "no card opened: no link named one");
});

test("a shoot's Files section (marketing): the waiting line, Open in OneDrive, Check again drawn from its answer, the completion line", { skip }, async () => {
  const E = await engine();
  const s = shootOf(E, "A000T9", "lot-before");
  await open(E, "viewer", "?shoot=" + s.id);
  await filesRead(s.id);
  assert.deepEqual(lines(), ["waiting"]);
  assert.match(text("shDScroll"), /38 files are waiting to go to OneDrive from PHOTO-PC\./);
  const folder = document.querySelector('#shDScroll [data-act="open-folder"]');
  assert.ok(folder && folder.getAttribute("target") === "_blank" && folder.getAttribute("rel") === "noopener noreferrer");
  assert.equal(folder.textContent, WORDS.files_buttons.open_onedrive);
  assert.equal(document.querySelectorAll("#shDScroll [data-act=done], #shDScroll [data-act=move]").length, 0, "marketing: no schedule act");
  click('#shDScroll [data-act="files-check"]');
  await until(() => lines()[0] === "confirmed", 4000, "checked");
  assert.match(text("shDScroll"), /All 300 files are in OneDrive ✓ \(checked /);
  assert.equal(text("shDScroll").includes(WORDS.completion.not_done), true, "the files are in OneDrive, the shoot not done");
  assert.equal(files(E).log().checks, 1, "one check, asked by a press - never by itself");
});

test("the photographer: no access to the folders (the line in place of the button), the help chip, a stopped copy, files added in OneDrive without DCR (information only: no Use what's in Drive)", { skip }, async () => {
  const E = await engine();
  const late = shootOf(E, "A000T9", "delivery");
  await open(E, "field", "?shoot=" + late.id);
  await filesRead(late.id);
  assert.deepEqual(lines(), ["late", "no_access"]);
  assert.ok(!document.querySelector('#shDScroll [data-act="open-folder"]'), "the link would land on Microsoft's You need access page");
  assert.deepEqual(document.querySelectorAll("#shDScroll .sh-chip.need").map((n) => n.textContent), [WORDS.help.late]);
  const stopped = shootOf(E, "A000T9", "progress-2");
  click("#shBack");
  page._test.openShoot(stopped.id);
  await filesRead(stopped.id);
  assert.deepEqual(lines().slice(0, 2), ["stopped", "stopped_phone"], "its starter: finish it in DCR Desktop");
  const added = shootOf(E, "A000T8", "house-complete");
  page._test.openShoot(added.id);
  await filesRead(added.id);
  assert.deepEqual(lines(), ["confirmed", "drive_only", "no_access"]);
  assert.equal(document.querySelector('#shDScroll [data-line="drive_only"]').textContent, "3 files were added in OneDrive without DCR.");
  assert.ok(!document.querySelector('#shDScroll [data-act="files-use-drive"]'), "no Use what's in Drive (OD §15)");
  assert.equal(files(E).log().checks, 0, "never a check by itself");
});

test("Check again: 409 root_lost reads the status again (its root_lost line, never a second sentence); a 503 is said in words", { skip }, async () => {
  const E = await engine();
  const s = shootOf(E, "A000T9", "progress-1");
  await open(E, "viewer", "?shoot=" + s.id);
  await filesRead(s.id);
  files(E).state({ root: "missing" });
  click('#shDScroll [data-act="files-check"]');
  await until(() => lines()[0] === "root_lost", 4000, "root_lost");
  assert.ok(!toasts.some((t) => t[0] === WORDS.hint.root_lost || t[0] === WORDS.hint.not_connected), JSON.stringify(toasts));
  assert.ok(!document.querySelector('#shDScroll [data-act="files-check"]'), "no check while the root is lost (can.check)");
  files(E).state({ root: "found", down: "not_authorized" });
  await page._test.readFiles(s.id);
  click('#shDScroll [data-act="files-check"]');
  await until(() => toasts.some((t) => t[0] === WORDS.hint.not_authorized), 4000, "not_authorized");
});

test("a gone shoot folder on the phone (OD §10.6 rules 1-3): moved_out alone in DCR Desktop's words - in the recycle bin or moved out alike - with Check again on it and nothing to open; a check that finds it back brings its lines back", { skip }, async () => {
  const E = await engine();
  const trashed = shootOf(E, "A000T9", "framing-complete");
  const moved = shootOf(E, "A000T8", "framing-complete");
  for (const s of [trashed, moved]) E.rows.photo_drive_folders.find((f) => f.shoot_id === s.id).drive_only = 2;
  await open(E, "field", "?shoot=" + trashed.id);
  for (const s of [trashed, moved]) {
    if (s !== trashed) page._test.openShoot(s.id);
    await filesRead(s.id);
    assert.deepEqual(lines(), ["moved_out"], "the line alone");
    assert.equal(document.querySelector('#shDScroll [data-line="moved_out"]').textContent, CASES.words.files.moved_out, "DCR Desktop 2's words");
    assert.ok(!document.querySelector('#shDScroll [data-act="open-folder"]'), "no folder to open");
    assert.ok(document.querySelector('#shDScroll [data-act="files-check"]'), "Check again on its line");
  }
  assert.equal(files(E).log().checks, 0, "never a check by itself");
  // put back by the office (OneDrive's recycle bin): the shoot's own lines come back once read
  const f = E.rows.photo_drive_folders.find((x) => x.shoot_id === moved.id);
  Object.assign(f, { drive_state: "found", last_code: null });
  click('#shDScroll [data-act="files-check"]');
  await until(() => lines()[0] !== "moved_out" && !S.files[moved.id].busy, 4000, "found again");
  assert.equal(lines()[0], "confirmed");
  assert.ok(lines().includes("drive_only"));
  assert.equal(files(E).log().checks, 1, "one check, by a press");
});

test("Mark done… brings a skipped shoot with files back: 2.3.0 applies it (on the Ready list once, its completer not told); 2.2.0 refuses it (closed_old_pc) and it stays offered", { skip }, async () => {
  const E = await engine();
  const s = shootOf(E, "A000T8", "progress-2");
  pc(E).state({ pcVersion: "2.2.0" });
  await open(E, "field", "?shoot=" + s.id);
  await filesRead(s.id);
  assert.match(text("shDScroll"), /This shoot was marked skipped, but its files are in OneDrive/);
  assert.ok(document.querySelector('#shDScroll [data-act="done"]'), "Mark done… for a skipped shoot with files");
  assert.ok(!document.querySelector('#shDScroll [data-act="move"]'), "Move… stays refused");
  click('#shDScroll [data-act="done"]');
  assert.match(text("shMo"), /This marks the skipped shoot done and sends its files to marketing\. Its task on My Tasks stays closed\./);
  click("#mvApply");
  await until(() => !$("shMo"), 4000, "sent");
  assert.ok(S.doneAt[s.id], "its files are read every 20 s for 3 minutes");
  pc(E).run();
  assert.equal(E.rows.photo_shoots.find((x) => x.id === s.id).status, "skipped", "the old office computer refused it");
  await page._test.load({ quiet: true });
  await page._test.readFiles(s.id);
  assert.equal(S.files[s.id].st.completion, "closed_old_pc");
  assert.match(text("shDScroll"), /DCR Agents 2 on the office computer can't bring this shoot back yet/);
  assert.ok(document.querySelector('#shDScroll [data-act="done"]'), "offered again: 2.3.0 applies it later");
  // the office computer updated
  pc(E).state({ pcVersion: "2.3.0" });
  click('#shDScroll [data-act="done"]');
  click("#mvApply");
  await until(() => !$("shMo"), 4000, "sent again");
  pc(E).run();
  assert.equal(E.rows.photo_shoots.find((x) => x.id === s.id).status, "done", "brought back");
  const m = E.rows.photo_marketing.filter((x) => x.shoot_id === s.id);
  assert.equal(m.length, 1, "on the Ready list once");
  assert.equal(m[0].state, "ready");
  assert.ok(m[0].told.every((t) => t.profile_id !== (S.me && S.me.id)), "the completer is not told");
  await page._test.readFiles(s.id);
  assert.equal(S.files[s.id].st.completion, "ready");
  assert.match(text("shDScroll"), /Sent to marketing /);
});

test("an open shoot's Mark done… sheet says when marketing hears of it (phone_done_hint)", { skip }, async () => {
  const E = await engine();
  const s = shootOf(E, "A000T9", "progress-1");
  await open(E, "field", "?shoot=" + s.id);
  await filesRead(s.id);
  click('#shDScroll [data-act="done"]');
  assert.ok(text("shMo").includes(WORDS.completion.phone_done_hint));
  click('#shMo [data-act="mv-close"]');
});

test("a shoot marked done before its planned day goes on the Ready list shot on its done day (app.photo_shoot_day) - its card never says a day still ahead", { skip }, async () => {
  const E = await engine();
  const s = shootOf(E, "A000T9", "progress-1");
  const laDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
  assert.ok(s.planned_date > laDay(new Date()), "the made-up shoot's planned day is still ahead");
  await open(E, "field", "?shoot=" + s.id);
  await filesRead(s.id);
  click('#shDScroll [data-act="done"]');
  click("#mvApply");
  await until(() => !$("shMo"), 4000, "sent");
  pc(E).run();
  const done = E.rows.photo_shoots.find((x) => x.id === s.id);
  assert.equal(done.status, "done");
  const m = E.rows.photo_marketing.find((x) => x.shoot_id === s.id);
  assert.ok(m && m.state === "ready", "on the Ready list");
  assert.equal(m.shoot_day, laDay(new Date(done.done_at)), "the done day (company day), as the migration's app.photo_shoot_day");
  await open(E, "viewer", "?ready=" + m.id);
  const today = laDay(new Date());
  const line = document.querySelector("#shDScroll .sh-rline").textContent;
  assert.ok(line.includes("shot " + dayText(m.shoot_day, today)), line);
  assert.ok(!line.includes(dayText(s.planned_date, today)), "never the planned day ahead: " + line);
});

test("a database without P5: no Files section, no fourth view, the Agenda for marketing too - P3 as it was", { skip }, async () => {
  const E = await engine();
  files(E).state({ p5: false });
  await open(E, "viewer");
  assert.equal(S.view, "agenda");
  assert.equal(document.querySelector('#shViews [data-view="ready"]').hidden, true);
  const s = shootOf(E, "A000T9", "lot-before");
  page._test.openShoot(s.id);
  await tick();
  assert.equal(S.p5, false, "photo_ready_list answered 42883: no P5");
  assert.ok(!document.querySelector("#shDScroll .sh-files"), "no Files section");
  assert.match(text("shDScroll"), /Lot before work/);
  await open(E, "viewer", "?ready=1");
  assert.equal(S.view, "agenda");
});

test("a Realtime event is only a trigger: the page reads again and never draws its payload", { skip }, async () => {
  const E = await engine();
  const s = shootOf(E, "A000T9", "lot-before");
  await open(E, "viewer", "?shoot=" + s.id);
  await filesRead(s.id);
  const f = E.rows.photo_drive_folders.find((x) => x.shoot_id === s.id);
  f.waiting = 0; f.confirmed = f.counted; f.drive_name = "Secret $99,000 name";
  await page._test.onFilesWatch({ tables: ["photo_drive_folders"], join: false });
  await until(() => lines()[0] === "confirmed", 4000, "read again");
  assert.ok(!/99,000|Secret/.test(document.body.textContent), "no Drive name from a table");
});

test("Check again waits what photo-files' Retry-After asks after a 429 rate (the header photo-files exposes to this site)", { skip }, async () => {
  const E = await engine();
  const s = shootOf(E, "A000T9", "progress-1");
  const me = await open(E, "viewer", "?shoot=" + s.id);
  await filesRead(s.id);
  const base = clientAs(E, me.id);
  useClient(Object.assign({}, base, { functions: { invoke: async () => ({ data: null, error: { name: "FunctionsHttpError",
    context: new Response(JSON.stringify({ error: "rate", message: "Too many tries - wait a minute." }), { status: 429, headers: { "Retry-After": "1" } }) } }) } }));
  click('#shDScroll [data-act="files-check"]');
  await until(() => toasts.some((t) => t[0] === WORDS.hint.rate), 4000, "rate");
  await until(() => document.querySelector('#shDScroll [data-act="files-check"]').disabled, 2000, "held");
  await until(() => !document.querySelector('#shDScroll [data-act="files-check"]').disabled, 4000, "free again after its second");
});
