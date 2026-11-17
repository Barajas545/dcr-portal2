// The job's place and the files icon on the shoot schedule (the owner's request of 2026-11-16, step 1 - no database
// change; the contract DCR Desktop 2 docs/PHOTO-SHOOT-EDITS.md §1.4, §1.5, §1.6, cited SE):
// * map/shoots.js: toPlace, placeLine ("0000 Sampleton Avenue · Sampleton, CA 93000"), mapsUrl (Google Maps' search) and
//   THE ICON RULE (filesIcon: a camera and a film with their counts, muted with an up-arrow while files are on their way,
//   the warning colour for a problem, nothing for none; its label word for word - SE §1.6 "The rule, final" and its
//   examples, and DCR Desktop 2's files_mark and list_holds run on the same rows when DCR_DESKTOP2_DIR names it);
// * repo/projects.js places (the place's columns only, 100 ids a read, a deleted job absent even for an admin) and
//   repo/photo-files.js folderStates (photo_drive_folders' rollup by its explicit columns - never a OneDrive name - live
//   shoot folders only, under its RLS: a reader without it reads none; null without the photo files), over the demo
//   database and a stub client; the columns are the migrations' own when DCR_DESKTOP2_DIR names DCR Desktop 2;
// * js/shoot-pictures.js: a picture's bytes fetched once per file id from a fresh signed link and shown as a blob: URL -
//   never the signed link -, a failure asked again (signed again), a broken one let go;
// * the page (site/js/pages/shoots.js) DRIVEN in node over the demo database: the shoot sheet's place block (the 64 px
//   picture, the address as a Maps link in a new tab), By job's header (48 px picture, the address line), the rows and
//   the sheet's files icon, AN EXPIRED PICTURE LINK - the picture still shows, never fetched again -, a picture that
//   fails to draw (the neutral tile, fetched again at the next read), a reader the RLS hides the folders or the projects
//   from (no icon, no place - the schedule as before), a database without the photo files, the icon moving with a
//   photo_drive_folders event, and the address as text through the money masks.
// Made-up people, jobs and places only: every street is a "0000 ..." one, put together at run time.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import * as common2 from "../site/js/common2.js";
import { makeDom, scan, EVIL } from "./console/console-page-dom.mjs";
import { available, freshEngine, person, clientAs, loadFake } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as repo from "../site/js/repo/photo.js";
import * as projectsRepo from "../site/js/repo/projects.js";
import * as R from "../site/js/repo/photo-files.js";
import * as V from "../site/js/map/shoots.js";
import { createPictures, MAX_BYTES, RETRY_MS } from "../site/js/shoot-pictures.js";
import { STREET, find } from "../tools/publish-check.mjs";

const skip = !available && "the demo database (tools/fake) is not here";
const D2 = process.env.DCR_DESKTOP2_DIR || "";
const HTML = readFileSync(new URL("../site/shoots.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const BODY = /<body>([\s\S]*)<\/body>/.exec(HTML)[1].replace(/<script[\s\S]*?<\/script>/g, "");
const read = (rel) => readFileSync(new URL("../site/" + rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* made-up places, put together here (never written as one piece) */
const street = (...words) => ["0000"].concat(words).join(" ");
const T9_STREET = street("Sampleton", "Avenue");
const T8_STREET = street("Madeup", "Garage", "Lane");

/* ── the rules (map/shoots.js) ── */

test("the place: toPlace through the money masks, one line; placeLine 'street · town, ST zip'; no street, nothing; mapsUrl the overview's Google Maps search", () => {
  const p = V.toPlace({ id: 41, address: "  " + street("Sampleton", "Avenue") + "\n", city: "Sampleton", state: "CA", zip: "93000", thumbnail_file_id: 900 });
  assert.deepEqual(p, { id: 41, address: street("Sampleton", "Avenue"), city: "Sampleton", state: "CA", zip: "93000", pictureId: 900 });
  assert.equal(V.placeLine(p), street("Sampleton", "Avenue") + " · Sampleton, CA 93000", "SE §1.5's phone words");
  assert.equal(V.mapsUrl(p), "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(street("Sampleton", "Avenue") + ", Sampleton, CA 93000"));
  assert.equal(V.placeLine(Object.assign({}, p, { zip: "" })), street("Sampleton", "Avenue") + " · Sampleton, CA");
  assert.equal(V.placeLine(Object.assign({}, p, { city: "", state: "", zip: "" })), street("Sampleton", "Avenue"));
  assert.equal(V.placeLine(Object.assign({}, p, { address: "" })), "", "no street address: nothing is said");
  assert.equal(V.mapsUrl(Object.assign({}, p, { address: "" })), "");
  assert.equal(V.placeLine(null), "");
  assert.equal(V.toPlace({ id: "x" }), null);
  assert.equal(V.toPlace({ id: 7, thumbnail_file_id: null }).pictureId, null);
  // free text: the masks, as every mirror text
  const odd = V.toPlace({ id: 8, address: street("Sampleton", "Way") + " $1,200 deposit", city: "Sampleton" });
  assert.ok(!/\$\s?\d|1,200/.test(odd.address), odd.address);
  // only the amount mask (money-mask.js maskAmounts, DCR Agents 2's mask_amounts), never the money-word rule: a street
  // whose name is a money word stays itself, in the line and in the Maps search (step 1's review, round 2)
  for (const w of ["Price", "Budget", "Bid", "Cost", "Balance", "Paid"]) {
    const pr = V.toPlace({ id: 9, address: street(w, "Street"), city: "Sampleton", state: "CA", zip: "93000" });
    assert.equal(pr.address, street(w, "Street"), w);
    assert.equal(V.placeLine(pr), street(w, "Street") + " · Sampleton, CA 93000", w);
    assert.equal(V.mapsUrl(pr), "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(street(w, "Street") + ", Sampleton, CA 93000"), w);
  }
  assert.equal(V.toPlace({ id: 9, address: street("Sampleton", "Way"), city: "Bid " + "1200" }).city, "Bid 1200", "a town's words the same");
  assert.equal(V.PICTURE_TEXT, "The job's picture");
  assert.equal(V.MAPS_TEXT, "Open in Maps");
});

/* SE §1.6 "The rule, final" (DCR Desktop 2 docs/PHOTO-SHOOT-EDITS.md): its examples, the contract's table rows as
   written there - the parity test below holds this copy to the contract line for line, and runs DCR Desktop 2's
   files_mark on them too. Each is read as DCR Desktop 2's tests/test_v230_release.py reads it: the rollup's `column`
   value pairs (on the list: the shoot posted to the Ready list, no hand-in; `culled` n - step 1's review, round 4 -:
   not a column but the shoot's status answer, posted to the list with a second card sealed since), what shows (the
   camera n, the film n, the arrow; warning or muted, else the usual colour) and the words. */
const SE_FINAL = [
  "| `files_state` confirmed, `photos` 3, `videos` 1 | the camera 3, the film 1 | `3 photos · 1 video in OneDrive` |",
  "| `files_state` copying, `photos` 40, `files_waiting` 6 | the camera 40, the arrow, muted | `40 photos in OneDrive - 6 files not in OneDrive yet` |",
  "| `files_state` waiting, `files_waiting` 1 | the arrow, muted | `1 file not in OneDrive yet` |",
  "| `files_state` copying, `photos` 5, `files_waiting` 0 | the camera 5 | `5 photos in OneDrive` |",
  "| `files_state` copying, `photos` 2, `files_counted` 5, `files_confirmed` 2 (an older read) | the camera 2, the arrow, muted | `2 photos in OneDrive - 3 files not in OneDrive yet` |",
  "| `files_state` problem, `photos` 12, `files_problem` 2 | the camera 12, warning | `12 photos in OneDrive - needs a look` |",
  "| `files_state` copying, `photos` 12, `files_problem` 2, `files_waiting` 3 | the camera 12, warning | `12 photos in OneDrive - needs a look` |",
  "| `files_state` problem, `photos` 12, `files_problem` 2, on the list | the camera 12 | `12 photos in OneDrive` |",
  "| `files_state` copying, `photos` 12, `files_problem` 2, `files_waiting` 3, on the list | the camera 12, the arrow, muted | `12 photos in OneDrive - 3 files not in OneDrive yet` |",
  "| `files_state` problem, `photos` 9, `files_problem` 3, `culled` 3 (a second card sealed after the list, then 3 photos of the first culled) | the camera 9 | `9 photos in OneDrive` |",
  "| `files_state` problem, `photos` 9, `files_problem` 3, `files_waiting` 2, `culled` 3 | the camera 9, the arrow, muted | `9 photos in OneDrive - 2 files not in OneDrive yet` |",
  "| `files_state` problem, `photos` 9, `files_problem` 4, `culled` 3 | the camera 9, warning | `9 photos in OneDrive - needs a look` |",
  "| `files_state` confirmed, `videos` 1, `drive_state` trashed, on the list | the film 1, warning | `1 video in OneDrive - needs a look` |",
  "| `files_state` confirmed, `photos` 1, `drive_state` missing | the camera 1, warning | `1 photo in OneDrive - needs a look` |",
  "| `files_state` problem, `files_problem` 4 | nothing | |",
  "| `files_state` none | nothing | |",
];
/** One SE_FINAL line -> {rollup, row (photo_drive_folders' columns), list, culled (null, or the status's files.culled),
    shown: null | {photos, videos, arrow, tone}, words}. */
function seExample(line) {
  const [rollup, shows, words] = line.trim().replace(/^\|+|\|+$/g, "").split("|").map((c) => c.trim());
  const row = { kind: "shoot" };
  for (const m of rollup.matchAll(/`(\w+)` (\w+)/g)) row[m[1]] = /^\d+$/.test(m[2]) ? Number(m[2]) : m[2];
  const culled = row.culled === undefined ? null : row.culled;
  delete row.culled;
  const n = (re) => { const m = re.exec(shows); return m ? Number(m[1]) : 0; };
  const shown = shows === "nothing" ? null : { photos: n(/the camera (\d+)/), videos: n(/the film (\d+)/), arrow: shows.includes("the arrow"),
    tone: shows.includes("warning") ? "problem" : shows.includes("muted") ? "sending" : "ok" };
  return { rollup, row, list: rollup.includes("on the list"), culled, shown, words: words.replace(/^`|`$/g, "") };
}
/** An SE_FINAL example as a case [what, row]: on the list - posted, no hand-in (_held); `culled` - posted, a first card
    sealed before it and a second after (the hold lifted), and the shoot's status answering that many culls (_culled). */
function exampleCase(e) {
  const extra = e.culled !== null ? { _list: [{ state: "posted", ready_at: READY }], _sealed: [{ state: "sealed", sealed_at: LATER(-60) },
    { state: "sealed", sealed_at: LATER(60) }], _culled: e.culled } : e.list ? { _held: true } : {};
  return [e.rollup, Object.assign({}, e.row, extra)];
}
/** Cases [what, row] -> the photo_drive_folders rows (ids 5001…, shoots 1…; files_rev new each call, so a cull count
    one call's status answered is never kept for another's), their shoots' Ready list rows (_list, or _held: posted at
    READY), their folders' hand-ins (_sealed) and what each shoot's photo_drive_status answers for its folder's culls
    (_culled - step 1's review, round 4: status, by shoot id). */
const READY = "2026-11-10T18:00:00.000Z";
let caseRuns = 0;
function caseRows(cases) {
  const rows = [], marketing = [], uploads = [], status = {};
  caseRuns += 1;
  cases.forEach(([, r], i) => {
    const row = { id: 5000 + i + 1, shoot_id: i + 1, kind: "shoot", retired_at: null, files_rev: caseRuns * 1000 + i };
    for (const [k, v] of Object.entries(r)) if (k[0] !== "_") row[k] = v;
    rows.push(row);
    for (const m of r._list || (r._held ? [{ state: "posted", ready_at: READY }] : [])) marketing.push(Object.assign({ shoot_id: row.shoot_id }, m));
    for (const u of r._sealed || []) uploads.push(Object.assign({ folder_id: row.id }, u));
    if (r._culled !== undefined) {
      status[row.shoot_id] = { mode: "on", shoot_id: row.shoot_id, folder: { id: row.id }, files: { missing: r._culled, mismatch: 0, culled: r._culled } };
    }
  });
  return { rows, marketing, uploads, status };
}
/** A stub client over caseRows' answer: its tables as they are (the stub filters nothing: listHolds and listLifted check
    each row themselves, as DCR Desktop 2's do) and photo_drive_status from its status (a shoot without one: none). */
function caseClient(c) {
  return {
    from: (t) => answer({ data: (t === "photo_marketing" ? c.marketing : t === "photo_shoot_uploads" ? c.uploads : c.rows).map((r) => Object.assign({}, r)), error: null }),
    rpc: async (name, args) => ({ data: name === "photo_drive_status" && c.status[args.p_shoot] ? JSON.parse(JSON.stringify(c.status[args.p_shoot])) : null,
      error: null }),
  };
}

test("THE RULE, FINAL (SE §1.6): its examples through folderStates (the column mapping, the Ready list read for a folder with a problem, listHolds) and filesIcon - what shows and the words, an older read and the list included", async () => {
  const ex = SE_FINAL.map(seExample);
  assert.equal(ex.length, 16);
  assert.equal(ex.filter((e) => e.culled !== null).length, 3, "round 4: marketing's culls after a later hand-in");
  const cases = caseRows(ex.map(exampleCase));
  const rows = cases.rows;
  assert.equal(rows[4].files_waiting, undefined, "the older read has no files_waiting");
  useClient(caseClient(cases));
  const read = await R.folderStates(rows.map((r) => r.shoot_id));
  ex.forEach((e, i) => {
    const ic = V.filesIcon(read[i + 1]);
    assert.deepEqual(ic && { photos: ic.photos, videos: ic.videos, arrow: ic.sending, tone: ic.tone }, e.shown, e.rollup);
    assert.equal(ic ? ic.label : "", e.words, e.rollup);
  });
  assert.deepEqual(ex.map((e, i) => read[i + 1].held), ex.map((e) => e.list && (e.row.files_state === "problem" || e.row.files_problem > 0)),
    "held: on the list with a files problem (the list is read only for those)");
  assert.deepEqual(ex.map((e, i) => read[i + 1].culled), ex.map((e) => e.culled || 0), "culled: the status's, for a hold a second card lifted");
});

test("THE ICON RULE (SE §1.6): a camera and a film with their counts; muted with an up-arrow while files wait; the warning colour for a problem; nothing for none; the label word for word", () => {
  const I = V.filesIcon;
  assert.equal(I(null), null);
  assert.equal(I(undefined), null);
  assert.equal(I({ state: "none", counted: 0, confirmed: 0, photos: 0, videos: 0 }), null, "none with no counts: nothing");
  assert.deepEqual(I({ state: "confirmed", counted: 15, confirmed: 15, photos: 12, videos: 3 }),
    { photos: 12, videos: 3, tone: "ok", sending: false, label: "12 photos · 3 videos in OneDrive" });
  assert.equal(I({ state: "confirmed", counted: 2, confirmed: 2, photos: 1, videos: 1 }).label, "1 photo · 1 video in OneDrive", "singular");
  assert.equal(I({ state: "confirmed", counted: 2, confirmed: 2, photos: 0, videos: 2 }).label, "2 videos in OneDrive", "a part with 0 left out");
  assert.equal(I({ state: "confirmed", counted: 5, confirmed: 5, photos: 5, videos: 0 }).label, "5 photos in OneDrive");
  assert.deepEqual(I({ state: "copying", counted: 9, confirmed: 5, photos: 5, videos: 0 }),
    { photos: 5, videos: 0, tone: "sending", sending: true, label: "5 photos in OneDrive - 4 files not in OneDrive yet" });
  assert.deepEqual(I({ state: "waiting", counted: 40, confirmed: 31, photos: 29, videos: 2 }),
    { photos: 29, videos: 2, tone: "sending", sending: true, label: "29 photos · 2 videos in OneDrive - 9 files not in OneDrive yet" });
  assert.deepEqual(I({ state: "waiting", counted: 3, confirmed: 0, photos: 0, videos: 0 }),
    { photos: 0, videos: 0, tone: "sending", sending: true, label: "3 files not in OneDrive yet" }, "none in yet but some on their way: the up-arrow alone");
  assert.equal(I({ state: "copying", counted: 0, confirmed: 0, photos: 0, videos: 0 }), null, "a copy that recorded nothing yet: nothing");
  assert.deepEqual(I({ state: "problem", counted: 64, confirmed: 58, photos: 53, videos: 5 }),
    { photos: 53, videos: 5, tone: "problem", sending: false, label: "53 photos · 5 videos in OneDrive - needs a look" });
  assert.equal(I({ state: "problem", counted: 4, confirmed: 0, photos: 0, videos: 0 }), null, "a problem with nothing in OneDrive: the Files line says it");
  assert.equal(I({ state: "confirmed", counted: 3, confirmed: 3, photos: 0, videos: 0 }), null, "only other files: no photo or video");
  assert.equal(I({ state: "none", counted: 2, confirmed: 2, photos: 2, videos: 0 }).tone, "ok", "none with counts still shows them");
  assert.equal(I({ state: "confirmed", counted: 3, confirmed: 3, photos: 3, videos: 0 }).label.indexOf("not in OneDrive yet"), -1, "all in: no tail");
  assert.equal(I({ state: "confirmed", counted: "x", confirmed: -2, photos: "3", videos: -1 }).label, "3 photos in OneDrive", "bad counts read as 0");
  // a hand-in that stopped on a computer (copying) or stalled for days (waiting) reads the same as one moving: the words
  // say only that files are not in OneDrive yet - never "still sending" beside a Files section that says it stopped
  for (const state of ["copying", "waiting", "confirmed", "none"]) {
    assert.doesNotMatch(I({ state, counted: 9, confirmed: 5, photos: 5, videos: 0 }).label, /sending/, state);
  }
  // the files not in OneDrive yet are the rollup's WAITING rows (files_waiting), never a problem's missing or mismatched
  // ones nor the not-checkable; a problem (files_problem > 0) needs a look even while another copy is open - DCR Desktop
  // 2's files_mark case for case (step 1's review, round 1)
  const R = (o) => Object.assign({ state: "confirmed", counted: 0, confirmed: 0, waiting: 0, problem: 0, photos: 0, videos: 0 }, o);
  assert.deepEqual(I(R({ state: "waiting", photos: 9, counted: 15, confirmed: 9, waiting: 6 })),
    { photos: 9, videos: 0, tone: "sending", sending: true, label: "9 photos in OneDrive - 6 files not in OneDrive yet" });
  assert.equal(I(R({ state: "copying", counted: 1, waiting: 1 })).label, "1 file not in OneDrive yet", "the arrow alone, one file");
  assert.equal(I(R({ state: "waiting", photos: 4, counted: 10, confirmed: 4, waiting: 3 })).label, "4 photos in OneDrive - 3 files not in OneDrive yet",
    "3 not checkable: not on their way");
  assert.equal(I(R({ state: "waiting", counted: 3, confirmed: 0, waiting: 0 })), null, "counted but none waiting and none in: nothing");
  assert.deepEqual(I(R({ state: "copying", photos: 40, counted: 52, confirmed: 40, waiting: 10, problem: 2 })),
    { photos: 40, videos: 0, tone: "problem", sending: false, label: "40 photos in OneDrive - needs a look" }, "a problem first, no arrow");
  assert.equal(I(R({ state: "confirmed", photos: 5, counted: 9, confirmed: 5, waiting: 4 })).label, "5 photos in OneDrive", "nothing on its way: no tail");
  assert.equal(I({ state: "waiting", photos: 9, counted: 15, confirmed: 9 }).label, "9 photos in OneDrive - 6 files not in OneDrive yet",
    "a rollup without the waiting count: the counted files neither confirmed nor a problem");
  assert.equal(I({ state: "waiting", photos: 9, counted: 15, confirmed: 9, problem: 2 }).tone, "problem");
  // step 1's review, round 3 (DCR Desktop 2's files_mark as round 2 made it): the arrow, the muted tone and the tail only
  // while files WAIT. A copy open with nothing counted yet, or one given up days ago (abandoned stays copying until
  // someone acts), has nothing waiting: the usual tone, no arrow, no tail - an arrow there had no words and was not true
  for (const state of ["copying", "waiting"]) {
    assert.deepEqual(I(R({ state, photos: 120, videos: 4, counted: 124, confirmed: 124, waiting: 0 })),
      { photos: 120, videos: 4, tone: "ok", sending: false, label: "120 photos · 4 videos in OneDrive" }, state + ", nothing waiting");
    assert.deepEqual(I(R({ state, photos: 12, counted: 12, confirmed: 12 })), { photos: 12, videos: 0, tone: "ok", sending: false, label: "12 photos in OneDrive" }, state);
    assert.equal(I(R({ state, counted: 0, waiting: 0 })), null, state + ": nothing in, nothing waiting - nothing");
  }
  assert.deepEqual(I(R({ state: "copying", photos: 38, videos: 2, counted: 43, confirmed: 40, waiting: 3 })),
    { photos: 38, videos: 2, tone: "sending", sending: true, label: "38 photos · 2 videos in OneDrive - 3 files not in OneDrive yet" });
  assert.equal(I(R({ state: "waiting", photos: 14, counted: 15, confirmed: 14, waiting: 1 })).label, "14 photos in OneDrive - 1 file not in OneDrive yet");
  assert.equal(I(R({ state: "waiting", counted: 6, waiting: 6 })).label, "6 files not in OneDrive yet", "nothing in yet: the files named");
  // marketing's culls (round 3): a files problem the Ready list holds (held: the shoot on it with no hand-in sealed
  // since - app.photo_help_held_by_list) is marketing's - Editors delete and move the files in OneDrive and the database
  // counts those as missing - so it never "needs a look": the usual tone, no tail
  const culled = R({ state: "problem", photos: 50, videos: 4, counted: 60, confirmed: 54, problem: 6, held: true });
  assert.deepEqual(I(culled), { photos: 50, videos: 4, tone: "ok", sending: false, label: "50 photos · 4 videos in OneDrive" }, "the demo's culled shoot");
  assert.equal(I(Object.assign({}, culled, { held: false })).tone, "problem", "not held (off the list, withdrawn, a card sealed since): the photographer's to look at");
  assert.equal(I(Object.assign({}, culled, { held: "yes" })).tone, "problem", "only a true held");
  assert.deepEqual(I(R({ state: "copying", photos: 50, counted: 70, confirmed: 50, waiting: 14, problem: 6, held: true })),
    { photos: 50, videos: 0, tone: "sending", sending: true, label: "50 photos in OneDrive - 14 files not in OneDrive yet" },
    "a held shoot with files on their way: not in OneDrive yet, never a look for the culls");
  assert.equal(I(R({ state: "problem", counted: 6, problem: 6, held: true })), null, "held, with nothing in OneDrive: nothing");
  // step 1's review, round 4: a second card sealed after the list lifts the hold, yet marketing's culls of the first
  // card's files stay no problem (culled: the status's files.culled, app.photo_culled) - taken out as
  // app.photo_sealed_state does: the problem files less the culls, a problem state with none left waiting when files
  // wait, else confirmed; the second card's own missing files still need a look
  const second = R({ state: "problem", photos: 9, counted: 12, confirmed: 9, problem: 3, culled: 3 });
  assert.deepEqual(I(second), { photos: 9, videos: 0, tone: "ok", sending: false, label: "9 photos in OneDrive" }, "every problem file a cull: calm");
  assert.deepEqual(I(Object.assign({}, second, { culled: 0 })), { photos: 9, videos: 0, tone: "problem", sending: false, label: "9 photos in OneDrive - needs a look" },
    "no culls: the photographer's to look at");
  assert.equal(I(Object.assign({}, second, { problem: 4 })).tone, "problem", "one problem file more than the culls: the second card's own");
  assert.deepEqual(I(Object.assign({}, second, { waiting: 2, counted: 14 })),
    { photos: 9, videos: 0, tone: "sending", sending: true, label: "9 photos in OneDrive - 2 files not in OneDrive yet" },
    "the culls out, the second card's files still on their way: waiting, the arrow");
  assert.deepEqual(I(R({ state: "copying", photos: 9, counted: 14, confirmed: 9, waiting: 2, problem: 3, culled: 3 })),
    { photos: 9, videos: 0, tone: "sending", sending: true, label: "9 photos in OneDrive - 2 files not in OneDrive yet" }, "a copy open, the culls out");
  assert.deepEqual(I(R({ state: "problem", photos: 9, counted: 14, confirmed: 9, waiting: null, problem: 3, culled: 3 })),
    { photos: 9, videos: 0, tone: "sending", sending: true, label: "9 photos in OneDrive - 2 files not in OneDrive yet" },
    "an older read: the waiting files counted before the culls come out (14 - 9 - 3)");
  assert.equal(I(R({ state: "problem", counted: 3, problem: 3, culled: 3 })), null, "only culls, nothing in OneDrive: nothing");
  assert.equal(I(R({ state: "problem", photos: 9, counted: 12, confirmed: 9, problem: 3, culled: 5 })).tone, "ok", "more culls than problem files: none left");
  assert.equal(I(R({ state: "confirmed", photos: 9, counted: 12, confirmed: 9, problem: 3, culled: 3, driveState: "trashed" })).tone, "problem", "gone, whatever the culls");
  for (const odd of ["3", 3.5, -3, null, undefined, "x"]) {
    assert.equal(I(Object.assign({}, second, { culled: odd })).tone, V.wholeCount(odd) >= 3 ? "ok" : "problem", "culled " + String(odd) + ": a whole count");
  }
  // a folder gone (drive_state missing or trashed: moved out of DCR Photo & Video, or deleted in OneDrive) is a problem
  // whatever the list and the rollup - the Files line says so too (DCR Desktop 2's files_mark the same)
  for (const driveState of ["missing", "trashed"]) {
    assert.deepEqual(I(R({ state: "confirmed", photos: 28, videos: 2, counted: 30, confirmed: 30, driveState })),
      { photos: 28, videos: 2, tone: "problem", sending: false, label: "28 photos · 2 videos in OneDrive - needs a look" }, driveState);
    assert.equal(I(R({ state: "problem", photos: 3, counted: 9, confirmed: 3, problem: 6, held: true, driveState })).tone, "problem", driveState + ", held");
    assert.equal(I(R({ state: "waiting", photos: 3, counted: 9, confirmed: 3, waiting: 6, driveState })).sending, false, driveState + ": a problem, no arrow");
  }
  for (const driveState of ["found", "not_seen", "retired", "", undefined]) assert.equal(I(R({ state: "confirmed", photos: 2, counted: 2, confirmed: 2, driveState })).tone, "ok", String(driveState));
  // SE §1.6 "The rule, final", 1 (DCR Desktop 2's photo_view._count): the counts as whole numbers - a fraction cut, a
  // decimal text read as its number, anything else (missing, below 0, not a number) 0
  assert.deepEqual([2.5, "1.9", " 4 ", "1e2", 7, "0x10", [4], {}, null, undefined, NaN, Infinity, -3, 0.5, "", "x", true, false].map(V.wholeCount),
    [2, 1, 4, 100, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
  assert.deepEqual(I(R({ state: "waiting", photos: 2.5, videos: "1", counted: 5, confirmed: 3, waiting: "2" })),
    { photos: 2, videos: 1, tone: "sending", sending: true, label: "2 photos · 1 video in OneDrive - 2 files not in OneDrive yet" });
  assert.deepEqual([V.FILES_ON_THE_WAY, V.FOLDER_GONE], [["copying", "waiting"], ["missing", "trashed"]]);
  // repo/photo-files.js keeps its own copy (folderStates' counts: the admin and Home pages load no schedule rules) -
  // the same function, character for character
  const body = (src) => { const m = /function wholeCount\(v\) \{\n[\s\S]*?\n\}\n/.exec(src); assert.ok(m, "wholeCount"); return m[0]; };
  assert.equal(body(read("js/repo/photo-files.js")), body(read("js/map/shoots.js")));
});

test("the icon's colours (SE §1.6 \"The rule, final\", 7 - DCR Desktop 2's files_color and files_count_color): the glyphs and the up-arrow in the muted text colour whatever the state but a problem (the warning colour), the counts in the text colour whatever the state", () => {
  const css = read("css/shoots.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).map((m) => ({ sels: m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")), body: m[2] }));
  // every colour a rule of the icon paints, by selector (.sh-fi and its parts - never .sh-filters or .sh-files)
  const painted = {};
  for (const r of rules) {
    for (const sel of r.sels.filter((s) => /\.sh-fi(?![a-z])/.test(s))) {
      assert.ok(!/(?:^|;)\s*fill:/.test(r.body), sel + ": no fill of its own");
      const m = /(?:^|;)\s*color:\s*([^;]+)/.exec(r.body);
      if (m) painted[sel] = m[1].trim();
    }
  }
  assert.deepEqual(painted, {
    ".sh-fi": "var(--text)",                               // the counts (text in .sh-fi-n, inheriting): the text colour, every state
    ".sh-fi svg": "var(--text-muted)",                     // the camera and the film: muted (all in OneDrive, or on their way) ...
    ".sh-fi-up": "var(--text-muted)",                      // ... and the up-arrow: it alone says files are not in OneDrive yet
    ".sh-fi.problem svg": "var(--gold)",                   // a problem: the glyphs in the warning colour
    ".sh-fi.problem .sh-fi-up": "var(--gold)",
  }, "no other rule of the icon paints a colour: no tone colours the counts, nothing for ok or sending but the muted glyphs");
  // the glyphs take their colour from the svg (currentColor); the counts are text beside them, never inside the svg
  const page = read("js/pages/shoots.js");
  assert.equal(Array.from(page.matchAll(/fill="currentColor"/g)).length, 2, "the camera and the film");
  assert.match(page, /'<span class="sh-fi-n">' \+ CAMERA \+ esc\(ic\.photos\) \+ "<\/span>"/);
  assert.match(page, /'<span class="sh-fi-n">' \+ FILM \+ esc\(ic\.videos\) \+ "<\/span>"/);
  assert.match(page, /'<span class="sh-fi-up" aria-hidden="true">↑<\/span>'/);
  // the tokens are the page's own: the text and muted colours (AA on every surface of the page), the warning one
  const all = read("css/shoots.css") + read("css/styles.css");
  for (const t of ["--text", "--text-muted", "--gold"]) assert.match(all, new RegExp(t + ":\\s*#[0-9a-f]{6}"), t);
});

/* ── the pictures (js/shoot-pictures.js) ── */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
/** A made-up network: links "https://demo-ref.supabase.co/...?token=tN"; a link issued up to `expiredUpTo` answers 400
    (an hour later), a file id in `failOnce` fails once. */
function network() {
  const net = { calls: [], tokens: 0, signs: 0, expiredUpTo: 0, failOnce: new Set(), made: 0, revoked: [], kind: "image/jpeg", size: JPEG.length, clock: 0 };
  net.link = (key) => "https://" + "demo-ref" + ".supabase.co/storage/v1/object/sign/project-files/" + key + "?token=t" + (++net.tokens);
  net.fetch = async (url) => {
    net.calls.push(url);
    const tok = Number((/token=t(\d+)/.exec(url) || [])[1]);
    if (tok <= net.expiredUpTo) return { ok: false, status: 400, blob: async () => null };
    for (const k of net.failOnce) if (url.includes(k)) { net.failOnce.delete(k); return { ok: false, status: 503, blob: async () => null }; }
    return { ok: true, status: 200, blob: async () => new Blob([net.size === JPEG.length ? JPEG : new Uint8Array(net.size)], { type: net.kind }) };
  };
  net.parts = { fetch: (u, o) => net.fetch(u, o), toUrl: () => "blob:test/" + (++net.made), revoke: (u) => { net.revoked.push(u); }, now: () => net.clock };
  return net;
}

test("pictures: fetched once per file id from a fresh link, shown as a blob: URL (never the link); a failure for now asked again after RETRY_MS, signed again - one refused or no picture never again; a broken one let go; only pictures, at most 3 MiB", async () => {
  const net = network();
  let signs = 0;
  const sign = async (ids) => { signs += 1; return Object.fromEntries(ids.map((id) => [id, net.link("p/1/thumbnail/a" + id + "/x.jpg")])); };
  const pics = createPictures(Object.assign({ sign }, net.parts));
  assert.equal(pics.url(11), null, "nothing yet: the tile");
  assert.equal(await pics.want([11, "11", 12, null, "x", -3]), true);
  assert.deepEqual([pics.url(11), pics.url("12"), signs, net.calls.length], ["blob:test/1", "blob:test/2", 1, 2]);
  assert.equal(await pics.want([11, 12]), false, "nothing new: not signed, not fetched");
  assert.deepEqual([signs, net.calls.length], [1, 2]);
  // the links have run out (an hour later): the pictures still show - they are the page's own bytes
  net.expiredUpTo = net.tokens;
  assert.equal((await net.fetch(net.calls[0])).status, 400, "the first link is dead");
  assert.deepEqual([pics.url(11), pics.url(12)], ["blob:test/1", "blob:test/2"]);
  // one that could not be fetched for now (a server error, no signal): the tile, not asked again at every read (step 1's
  // review, round 3) - only after RETRY_MS, signed again
  net.failOnce.add("/a13/");
  assert.equal(await pics.want([13]), false);
  assert.equal(pics.url(13), null);
  assert.equal(await pics.want([13]), false, "asked again at once: not signed, not fetched");
  assert.equal(signs, 2);
  net.clock += RETRY_MS - 1;
  assert.equal(await pics.want([13]), false, "nor a moment before");
  net.clock += 1;
  assert.equal(await pics.want([13]), true);
  assert.deepEqual([pics.url(13), signs], ["blob:test/3", 3], "signed again, then fetched");
  // a picture that fails to draw: let go (its URL revoked) and fetched again next time
  assert.equal(pics.broken(11), true);
  assert.deepEqual([pics.url(11), net.revoked], [null, ["blob:test/1"]]);
  assert.equal(pics.broken(11), false, "once");
  assert.equal(await pics.want([11]), true);
  assert.equal(pics.url(11), "blob:test/4");
  // not a picture, or too big: never shown - and never asked for again in the page's life (a new picture is a new id)
  net.kind = "text/html";
  assert.equal(await pics.want([14]), false);
  net.kind = "image/png";
  net.size = MAX_BYTES + 1;
  assert.equal(await pics.want([15]), false);
  net.size = JPEG.length;
  const s0 = signs;
  net.clock += RETRY_MS * 10;
  assert.equal(await pics.want([14, 15]), false, "no picture: never again");
  assert.equal(signs, s0);
  assert.equal(await pics.want([115]), true, "a PNG");
  // refused by Storage (403, 404 - gone): never again; a time-out or a rate: for now
  const answers = { 403: { ok: false, status: 403 }, 404: { ok: false, status: 404 }, 408: { ok: false, status: 408 }, 429: { ok: false, status: 429 } };
  for (const [code, again] of [[403, false], [404, false], [408, true], [429, true]]) {
    let fetched = 0;
    const one = createPictures(Object.assign({}, net.parts, { sign: async (ids) => ({ [ids[0]]: net.link("p/1/thumbnail/b/x.jpg") }),
      fetch: async () => { fetched += 1; return answers[code]; } }));
    assert.equal(await one.want([30]), false, String(code));
    net.clock += RETRY_MS;
    await one.want([30]);
    assert.equal(fetched, again ? 2 : 1, code + (again ? ": asked again after RETRY_MS" : ": never again"));
  }
  // no link at all (a file not readable, gone, or on a computer only) or a sign that failed: the tile, asked again after
  // RETRY_MS only
  let asked = 0;
  const none = createPictures(Object.assign({}, net.parts, { sign: async () => { asked += 1; return {}; } }));
  assert.equal(await none.want([16]), false);
  assert.equal(await none.want([16]), false);
  assert.equal(asked, 1, "not signed again at once");
  net.clock += RETRY_MS;
  await none.want([16]);
  assert.equal(asked, 2, "after RETRY_MS");
  let tries = 0;
  const offline = createPictures(Object.assign({}, net.parts, { sign: async () => { tries += 1; throw new Error("offline"); } }));
  assert.equal(await offline.want([16]), false);
  await offline.want([16]);
  assert.equal(tries, 1);
  // the demo's own links are already in memory: shown as they are, never fetched
  const before = net.calls.length;
  const demo = createPictures(Object.assign({ sign: async (ids) => ({ [ids[0]]: "blob:demo/p/1/thumbnail/x/y.jpg", [ids[1]]: "data:image/svg+xml,%3Csvg%3E" }) }, net.parts));
  assert.equal(await demo.want([17, 18]), true);
  assert.deepEqual([demo.url(17), demo.url(18).slice(0, 5), net.calls.length], ["blob:demo/p/1/thumbnail/x/y.jpg", "data:", before]);
  // a link of any other kind is never used
  const odd = createPictures(Object.assign({ sign: async (ids) => ({ [ids[0]]: "http://plain.example/x.jpg", [ids[1]]: "javascript:alert(1)" }) }, net.parts));
  assert.equal(await odd.want([19, 20]), false);
  assert.deepEqual([odd.url(19), odd.url(20), net.calls.length], [null, null, before]);
  // two wants at once: each picture fetched once
  const twice = createPictures(Object.assign({ sign }, net.parts));
  const n0 = net.calls.length;
  await Promise.all([twice.want([21, 22]), twice.want([21, 22])]);
  assert.equal(net.calls.length - n0, 2);
  // a sign or fetch that throws never escapes
  const bad = createPictures({ sign: async () => { throw new Error("offline"); }, fetch: async () => { throw new Error("offline"); }, toUrl: () => "blob:x", revoke() {} });
  assert.equal(await bad.want([23]), false);
  // dispose lets every own URL go
  const n1 = net.revoked.length;
  pics.dispose();
  assert.ok(net.revoked.length - n1 >= 3 && pics.url(12) === null);
});

test("pictures, from the source: an https link is only ever fetched, never kept; what is kept is toUrl's blob: URL or the demo's own blob: / data: link; nothing logged or stored on the device", () => {
  const s = code(read("js/shoot-pictures.js"));
  assert.match(s, /if \(\/\^https:\\\/\\\/\/\.test\(link\)\) \{\s*const b = await bytesOf\(link\);/);
  assert.match(s, /try \{ u = d\.toUrl\(b\.blob\); \} catch \(e\) \{ u = null; \}\s*if \(u\) \{ shown\.set\(k, \{ url: u, own: true \}\); failed\.delete\(k\); got = true; \}/);
  assert.match(s, /\} else if \(\/\^\(blob\|data\):\/\.test\(link\)\) \{\s*shown\.set\(k, \{ url: link, own: false \}\);/);
  assert.equal(Array.from(s.matchAll(/shown\.set\(/g)).length, 2, "the two ways a picture is shown");
  assert.ok(!/localStorage|sessionStorage|indexedDB|caches\.|console\./.test(s), "nothing kept on the device, nothing logged");
  assert.match(s, /filesRepo\.forgetThumbnails\(\);[^\n]*\n\s*return filesRepo\.thumbnailUrls\(/, "a fresh link for every fetch");
  // the page: its only img is the picture (its src the pictures' URL), the neutral tile otherwise; the policy unchanged
  const page = code(read("js/pages/shoots.js"));
  assert.equal(Array.from(page.matchAll(/<img /g)).length, 1, "one img in the page's markup");
  assert.match(page, /const url = place && place\.pictureId && state\.pics \? state\.pics\.url\(place\.pictureId\) : null;\s*if \(url\) \{\s*return '<img class="sh-pic s' \+ size \+ '" src="' \+ esc\(url\) \+ '"/);
  assert.match(page, /root\.addEventListener\("error", onPicError, true\);/, "an img's error heard on its way down");
  assert.match(page, /'<a class="sh-addr" href="' \+ esc\(V\.mapsUrl\(p\)\) \+ '" target="_blank" rel="noopener noreferrer"/, "the address: Maps, a new tab");
  assert.match(page, /import \* as projectsRepo from "\.\.\/repo\/projects\.js";/);
  assert.ok(!/\.from\(/.test(page), "the page reads no table itself");
  const h = read("shoots.html");
  assert.match(h, /img-src 'self' blob: data: https:\/\/nmjoenqkjyhngjvdealh\.supabase\.co https:\/\/\*\.tile\.openstreetmap\.org;/, "blob: pictures were allowed already");
  assert.match(h, /connect-src 'self' https:\/\/nmjoenqkjyhngjvdealh\.supabase\.co wss:/, "the fetch goes to the Supabase host it already names");
});

/* ── the repos ── */

let FK;
const uid = (key) => FK.PEOPLE.find((p) => p.key === key).id;
/** as `key` over `E`; every select recorded {table, columns, filters} */
function as(E, key, o) {
  const opt = o || {};
  const c = clientAs(E, uid(key));
  const asked = [];
  useClient(Object.assign({}, c, {
    from: (t) => {
      if (opt.from && opt.from[t]) return opt.from[t]();
      const q = c.from(t);
      const rec = { table: t, columns: null, filters: [] };
      asked.push(rec);
      const sel = q.select.bind(q);
      q.select = (cols) => { rec.columns = cols; return sel(cols); };
      for (const op of ["eq", "is", "in"]) { const f = q[op].bind(q); q[op] = (col, v) => { rec.filters.push([op, col, Array.isArray(v) ? v.length : v]); return f(col, v); }; }
      return q;
    },
  }));
  return asked;
}
/** a query that answers `res` whatever is asked */
function answer(res) {
  const q = { then: (ok, bad) => Promise.resolve(res).then(ok, bad) };
  for (const m of ["select", "eq", "is", "in", "order", "neq", "limit"]) q[m] = () => q;
  return q;
}
const planOfE = (E, code) => E.rows.photo_plans.find((p) => p.project_code === code);
const shootOfE = (E, code, key) => E.rows.photo_shoots.find((s) => s.plan_id === planOfE(E, code).id && s.key === key);
const folderOfE = (E, s) => E.rows.photo_drive_folders.find((f) => f.kind === "shoot" && f.shoot_id === s.id && !f.retired_at);

test("places: the place's columns only, under the projects RLS (the photographer and marketing read them), 100 ids a read; a deleted job absent even for an admin; nothing asked without an id", { skip }, async () => {
  FK = await loadFake();
  const E = await freshEngine(new Date());
  const ids = E.rows.photo_plans.map((p) => p.project_id);
  assert.ok(ids.every(Boolean), "every demo plan has its made-up job");
  for (const key of ["field", "viewer", "admin"]) {
    const asked = as(E, key);
    const rows = await projectsRepo.places(ids.concat([ids[0], "x", null, -1]));
    assert.deepEqual(asked.map((a) => [a.table, a.columns]), [["projects", "id, address, city, state, zip, thumbnail_file_id, deleted_at"]], key);
    assert.deepEqual(asked[0].filters, [["in", "id", 4]], key + ": the ids once each");
    const t9 = rows.find((r) => r.id === planOfE(E, "A000T9").project_id);
    assert.deepEqual(Object.keys(t9).sort(), ["address", "city", "id", "state", "thumbnail_file_id", "zip"], "nothing else of the project");
    assert.deepEqual([t9.address, t9.city, t9.state, t9.zip], [T9_STREET, "Sandbox", "CA", "93001"], key);
    assert.ok(t9.thumbnail_file_id > 0);
    const t6 = rows.find((r) => r.id === planOfE(E, "A000T6").project_id);
    assert.deepEqual([t6.address, t6.thumbnail_file_id], [null, null], "A000T6: a town, no street, no picture");
  }
  // a deleted job: absent, even for an admin (who reads deleted projects)
  E.rows.projects.find((p) => p.id === planOfE(E, "A000T7").project_id).deleted_at = new Date().toISOString();
  as(E, "admin");
  assert.ok(!(await projectsRepo.places(ids)).some((r) => r.id === planOfE(E, "A000T7").project_id));
  // 100 ids a read; none, no read
  const calls = [];
  useClient({ from: (t) => { calls.push(t); return answer({ data: [], error: null }); } });
  await projectsRepo.places(Array.from({ length: 150 }, (_, i) => i + 1));
  assert.equal(calls.length, 2);
  calls.length = 0;
  assert.deepEqual(await projectsRepo.places([]), []);
  assert.deepEqual(await projectsRepo.places([null, "x"]), []);
  assert.equal(calls.length, 0);
  useClient({ from: () => answer({ data: null, error: { code: "42501", message: "permission denied" } }) });
  await assert.rejects(projectsRepo.places([1]), "a refusal is thrown (the page keeps what it had)");
});

test("folderStates: photo_drive_folders' rollup by its explicit columns (no OneDrive name), live shoot folders only; the demo's counts; a reader without its RLS reads none; null without the photo files; 100 ids a read", { skip }, async () => {
  FK = await loadFake();
  const E = await freshEngine(new Date());
  const ids = E.rows.photo_shoots.map((s) => s.id);
  assert.deepEqual(R.FOLDER_COLUMNS, ["id", "shoot_id", "files_state", "files_counted", "files_confirmed", "files_waiting", "files_problem", "photos", "videos", "files_rev",
    "drive_state"]);
  for (const c of R.FOLDER_COLUMNS) assert.ok(!/name|path|link|drive_id|item/.test(c), c);
  const asked = as(E, "field");
  const st = await R.folderStates(ids.concat([0, -1, "x"]));
  // (step 1's review, round 3) then, for the folders with a problem alone, what app.photo_help_held_by_list reads: their
  // shoots' rows on the Ready list (shoot, state, ready_at - never a name, link or note) and, for the shoots on it, the
  // folders' sealed hand-ins (folder, state, sealed_at); round 4: with the ids, the list row's version and the folder's
  // files_rev - a kept cull count's key
  assert.deepEqual(R.LISTED_COLUMNS, ["id", "shoot_id", "state", "ready_at", "version"]);
  assert.deepEqual(R.LISTED_STATES, ["ready", "claimed", "posted", "passed"], "the database's own: withdrawn is off the list");
  assert.deepEqual(R.SEALED_COLUMNS, ["id", "folder_id", "state", "sealed_at"]);
  const withProblem = Object.keys(st).filter((k) => st[k].problem > 0 || st[k].state === "problem").length;
  assert.equal(withProblem, 2, "the demo's before-framing (A000T9) and the culled progress-1 (A000T8)");
  assert.deepEqual(asked.map((a) => [a.table, a.columns]), [["photo_drive_folders", R.FOLDER_COLUMNS.join(", ")], ["photo_marketing", "id, shoot_id, state, ready_at, version"],
    ["photo_shoot_uploads", "id, folder_id, state, sealed_at"]]);
  assert.deepEqual(asked[0].filters, [["eq", "kind", "shoot"], ["is", "retired_at", null], ["in", "shoot_id", ids.length]]);
  assert.deepEqual(asked[1].filters, [["in", "shoot_id", withProblem], ["in", "state", 4]], "only the shoots whose folder has a problem");
  assert.deepEqual(asked[2].filters, [["in", "folder_id", 1], ["eq", "state", "sealed"]], "only the folders whose shoot is on the list");
  const walk = shootOfE(E, "A000T9", "site-walk"), lot = shootOfE(E, "A000T9", "lot-before"), bf = shootOfE(E, "A000T9", "before-framing");
  const permit = shootOfE(E, "A000T9", "permit-board");
  const f = (s) => folderOfE(E, s);
  assert.deepEqual(st[walk.id], { state: "confirmed", counted: 86, confirmed: 86, waiting: 0, problem: 0, photos: f(walk).photos, videos: f(walk).videos,
    driveState: "found", held: false, culled: 0 }, "on the Ready list, but no problem: not asked");
  assert.equal(f(walk).photos + f(walk).videos, 86);
  assert.deepEqual(st[lot.id], { state: "waiting", counted: 300, confirmed: 262, waiting: 38, problem: 0, photos: f(lot).photos, videos: f(lot).videos,
    driveState: "found", held: false, culled: 0 });
  assert.equal(f(lot).photos + f(lot).videos, 262, "the demo's photos and videos are the confirmed ones, as the rollup's");
  assert.deepEqual([st[bf.id].state, st[bf.id].waiting, st[bf.id].problem, st[bf.id].held], ["problem", 0, 6, false], "the mismatched and missing files: files_problem");
  // marketing's culls: the demo's posted progress-1 of A000T8 lost 6 files in OneDrive after it went to marketing - the
  // database counts them missing (files_problem, files_state problem); held by the list, so the icon never says "needs a look"
  const culled = shootOfE(E, "A000T8", "progress-1");
  assert.deepEqual([st[culled.id].state, st[culled.id].problem, st[culled.id].held], ["problem", 6, true]);
  assert.equal(V.filesIcon(st[culled.id]).tone, "ok");
  assert.equal(V.filesIcon(st[bf.id]).tone, "problem", "off the list: the photographer's to look at");
  // withdrawn: off the list - its files are the photographer's again; ready, claimed and passed hold it as posted does
  const mk = E.rows.photo_marketing.find((m) => m.shoot_id === culled.id);
  mk.state = "withdrawn";
  assert.equal((await R.folderStates([culled.id]))[culled.id].held, false, "withdrawn");
  for (const state of ["ready", "claimed", "passed"]) {
    mk.state = state;
    assert.equal((await R.folderStates([culled.id]))[culled.id].held, true, state);
  }
  mk.state = "posted";
  // a hand-in sealed AFTER the shoot went on the list (a re-edit, a second card) lifts the hold: what goes wrong with that
  // copy is the photographer's (app.photo_help_held_by_list); one sealed at or before ready_at keeps it
  const cf = f(culled);
  const up = E.rows.photo_shoot_uploads.find((u) => u.folder_id === cf.id && u.state === "sealed");
  const was = up.sealed_at;
  up.sealed_at = new Date(Date.parse(mk.ready_at) + 60e3).toISOString();
  assert.equal((await R.folderStates([culled.id]))[culled.id].held, false, "a card sealed since: not held");
  assert.deepEqual([(await R.folderStates([culled.id]))[culled.id].culled, V.filesIcon((await R.folderStates([culled.id]))[culled.id]).tone], [0, "problem"],
    "the culled card's own hand-in sealed after the list: no culls (app.photo_culled_row) - the photographer's to look at");
  up.sealed_at = mk.ready_at;
  assert.equal((await R.folderStates([culled.id]))[culled.id].held, true, "sealed at ready_at: held");
  up.sealed_at = was;
  // step 1's review, round 4: a SECOND card sealed after the list (the phone's own hand-in) lifts the hold, yet the first
  // card's culls stay marketing's - the status's files.culled, as the Files section says (confirmed_culled); the second
  // card's own missing file needs a look
  const card2 = Object.assign({}, up, { id: 9402, files: 1, recorded_files: 1, started_at: new Date(Date.parse(mk.ready_at) + 30e3).toISOString(),
    sealed_at: new Date(Date.parse(mk.ready_at) + 60e3).toISOString() });
  E.rows.photo_shoot_uploads.push(card2);
  let r4 = (await R.folderStates([culled.id]))[culled.id];
  assert.deepEqual([r4.held, r4.problem, r4.culled, V.filesIcon(r4).tone, V.filesIcon(r4).label], [false, 6, 6, "ok", "50 photos · 4 videos in OneDrive"],
    "a second card, then a cull of the first: calm");
  const fileSt = E.exts.find((x) => x.name === "p10-photo-files").__dev.status(culled.id, uid("field"));
  assert.deepEqual([fileSt.files.missing, fileSt.files.culled], [6, 6], "what the Files section reads (confirmed_culled)");
  Object.assign(cf, { counted: 61, missing: 7, files_rev: (cf.files_rev || 0) + 1 });
  r4 = (await R.folderStates([culled.id]))[culled.id];
  assert.deepEqual([r4.problem, r4.culled, V.filesIcon(r4).tone, V.filesIcon(r4).label], [7, 6, "problem", "50 photos · 4 videos in OneDrive - needs a look"],
    "the second card's own missing file: needs a look");
  Object.assign(cf, { counted: 60, missing: 6, files_rev: cf.files_rev + 1 });
  E.rows.photo_shoot_uploads.splice(E.rows.photo_shoot_uploads.indexOf(card2), 1);
  // a folder gone (moved out of DCR Photo & Video, or deleted in OneDrive): its drive_state - a problem whatever the list
  const gone = shootOfE(E, "A000T9", "house-complete");
  assert.deepEqual([st[gone.id].driveState, V.filesIcon(st[gone.id]).tone], ["missing", "problem"]);
  assert.match(V.filesIcon(st[gone.id]).label, / - needs a look$/);
  assert.deepEqual([st[permit.id].state, st[permit.id].counted], ["copying", 0], "a copy running: copying, nothing counted yet");
  const none = E.rows.photo_shoots.find((s) => !E.rows.photo_drive_folders.some((x) => x.shoot_id === s.id));
  assert.equal(st[none.id], undefined, "a shoot with no folder is absent");
  // the demo's recount counts the photos and videos CONFIRMED (as app.photo_folder_rollup): a photo still on its way is
  // counted, never a photo in OneDrive
  const p3 = shootOfE(E, "A000T9", "progress-3");
  const f3 = f(p3);
  E.rows.photo_shoot_files.push(Object.assign({}, FK.p10FilesCols.photo_shoot_files, { id: 9900, folder_id: f3.id, counted: true, source: "phone", path: "IMG_9900.JPG",
    path_key: "img_9900.jpg", kind: "photo", size: 4400000, state: "waiting", upload_step: "to_send" }));
  E.exts.find((x) => x.name === "p10-photo-files").__dev.confirmAll(p3.id);
  const r3 = (await R.folderStates([p3.id]))[p3.id];
  assert.deepEqual([r3.photos + r3.videos, r3.confirmed, r3.counted - r3.confirmed], [f3.photos + f3.videos, f3.confirmed, 10],
    "the new photo is counted and still sending - not in OneDrive");
  // marketing and admins read it too; a retired folder is never read; a job folder has no shoot
  as(E, "viewer");
  assert.ok((await R.folderStates([walk.id]))[walk.id]);
  E.rows.photo_drive_folders.find((x) => x.id === f(walk).id).retired_at = new Date().toISOString();
  as(E, "admin");
  assert.deepEqual(await R.folderStates([walk.id]), {}, "retired: not read");
  // someone not on the photo team: the RLS shows none - the icon is simply absent
  as(E, "lead");
  assert.deepEqual(await R.folderStates(ids), {});
  // the folders readable but not the Ready list or the hand-ins (a database without them, a reader they are refused
  // to): not held
  for (const t of ["photo_marketing", "photo_shoot_uploads"]) {
    for (const code of ["42P01", "42501"]) {
      as(E, "field", { from: { [t]: () => answer({ data: null, error: { code, message: "not here" } }) } });
      const r = (await R.folderStates([culled.id]))[culled.id];
      assert.deepEqual([r.held, r.problem], [false, 6], t + " " + code);
    }
  }
  as(E, "field", { from: { photo_marketing: () => answer({ data: [], error: null }) } });
  assert.equal((await R.folderStates([culled.id]))[culled.id].held, false, "not on the list");
  // a list or hand-in read that fails: the whole read fails (the page keeps the icons it shows - never a culled shoot's
  // "needs a look" for a moment)
  for (const t of ["photo_marketing", "photo_shoot_uploads"]) {
    as(E, "field", { from: { [t]: () => answer({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }) } });
    await assert.rejects(R.folderStates([culled.id]), t);
  }
  // a database without the photo files: null
  E.exts.find((x) => x.name === "p10-photo-files").__dev.state({ p5: false });
  as(E, "field");
  assert.equal(await R.folderStates(ids), null);
  // any other refusal is thrown; 100 ids a read; none, no read
  useClient({ from: () => answer({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }) });
  await assert.rejects(R.folderStates([1]));
  const calls = [];
  useClient({ from: (t) => { calls.push(t); return answer({ data: [{ shoot_id: 3, files_state: "confirmed", files_counted: 2, files_confirmed: 2, files_waiting: 0, files_problem: 0, photos: 2, videos: 0 }], error: null }); } });
  const got = await R.folderStates(Array.from({ length: 250 }, (_, i) => i + 1));
  assert.deepEqual([calls.length, got[3]], [3, { state: "confirmed", counted: 2, confirmed: 2, waiting: 0, problem: 0, photos: 2, videos: 0, driveState: "", held: false, culled: 0 }],
    "no problem: no Ready list read");
  // SE §1.6 "The rule, final", 1 (DCR Desktop 2's files_mark): the counts as whole numbers - a fraction cut, a decimal
  // text read, anything else 0 -; a row without files_waiting (an older read) keeps it unknown (null), so the icon counts
  // the counted files neither confirmed nor a problem
  useClient({ from: () => answer({ data: [{ id: 7, shoot_id: 4, files_state: "copying", files_counted: "5", files_confirmed: 2.9, files_problem: null,
    photos: 2.5, videos: " 1 ", drive_state: null }, { id: 8, shoot_id: 5, files_state: null, files_counted: "0x10", files_confirmed: true, files_waiting: "2e0",
    files_problem: -3, photos: [4], videos: "1_0" }], error: null }) });
  const odd = await R.folderStates([4, 5]);
  assert.deepEqual(odd[4], { state: "copying", counted: 5, confirmed: 2, waiting: null, problem: 0, photos: 2, videos: 1, driveState: "", held: false, culled: 0 });
  assert.deepEqual(odd[5], { state: "none", counted: 0, confirmed: 1, waiting: 2, problem: 0, photos: 0, videos: 0, driveState: "", held: false, culled: 0 });
  assert.deepEqual(V.filesIcon(odd[4]), { photos: 2, videos: 1, tone: "sending", sending: true, label: "2 photos · 1 video in OneDrive - 3 files not in OneDrive yet" },
    "an older read: 5 counted - 2 confirmed - 0 a problem");
  calls.length = 0;
  const probs = Array.from({ length: 150 }, (_, i) => ({ id: 1000 + i + 1, shoot_id: i + 1, files_state: "problem", files_counted: 2, files_confirmed: 1, files_waiting: 0,
    files_problem: 1, photos: 1, videos: 0, drive_state: "found" }));
  const at = "2026-11-10T18:00:00.000Z";
  const listed = Array.from({ length: 120 }, (_, i) => ({ shoot_id: i + 1, state: i === 7 ? "withdrawn" : "posted", ready_at: at }));
  const rpcs = [];
  useClient({ from: (t) => { calls.push(t); return answer(t === "photo_marketing" ? { data: listed, error: null }
    : t === "photo_shoot_uploads" ? { data: [{ folder_id: 1002, state: "sealed", sealed_at: "2026-11-11T18:00:00.000Z" }, { folder_id: 1003, state: "sealed", sealed_at: at }], error: null }
    : { data: probs, error: null }); },
  rpc: async (name, args) => { rpcs.push([name, args.p_shoot]); return { data: { mode: "on", folder: { id: 1000 + args.p_shoot }, files: { culled: 0, missing: 1 } }, error: null }; } });
  const many = await R.folderStates(probs.map((r) => r.shoot_id));
  assert.deepEqual(calls, ["photo_drive_folders", "photo_drive_folders", "photo_marketing", "photo_marketing", "photo_shoot_uploads", "photo_shoot_uploads"],
    "100 ids a read, the list's and the hand-ins' too");
  assert.deepEqual([1, 2, 3, 8, 121].map((sid) => many[sid].held), [true, false, true, false, false],
    "no sealed hand-in: held; one sealed after ready_at: not; one sealed at it: held; a row off the list: not; no row: not");
  assert.deepEqual(rpcs, [["photo_drive_status", 2]], "round 4: the status of the one folder on the list whose hold a hand-in since lifted - its culls");
  assert.deepEqual([many[2].culled, V.filesIcon(many[2]).tone], [0, "problem"], "no culls: its problem the photographer's");
  // listHolds, the database's own rule, alone
  const H = (folders, l, u) => Array.from(R.listHolds(folders, l, u)).sort();
  assert.deepEqual(H([{ id: 1, shoot: 10 }, { id: 2, shoot: 20 }], [{ shoot_id: 10, state: "ready", ready_at: at }, { shoot_id: 20, state: "withdrawn", ready_at: at }], []), [1]);
  const sealedAt = (t) => ({ folder_id: 1, state: "sealed", sealed_at: t });
  assert.deepEqual(H([{ id: 1, shoot: 10 }], [{ shoot_id: 10, state: "claimed", ready_at: at }], [sealedAt("2026-11-09T00:00:00Z"), sealedAt("2026-11-10T19:00:00Z")]),
    [], "the LAST sealed hand-in counts");
  assert.deepEqual(H([{ id: 1, shoot: 10 }], [{ shoot_id: 10, state: "passed", ready_at: at }, { shoot_id: 10, state: "posted", ready_at: "2026-11-12T00:00:00Z" }],
    [sealedAt("2026-11-11T00:00:00Z")]), [1], "a later row on the list holds it");
  assert.deepEqual(H([{ id: 1, shoot: 10 }], [{ shoot_id: 10, state: "ready", ready_at: "not a time" }], []), [], "a row without its time: not held");
  // only a SEALED hand-in counts (DCR Desktop 2's list_holds; the read asks for no other): one open, cancelled or given
  // up since the shoot went on the list, or one without its state, never lifts the hold
  for (const state of ["open", "cancelled", "abandoned", undefined]) {
    assert.deepEqual(H([{ id: 1, shoot: 10 }], [{ shoot_id: 10, state: "posted", ready_at: at }], [{ folder_id: 1, state, sealed_at: "2026-11-11T00:00:00Z" }]), [1], String(state));
  }
  calls.length = 0;
  assert.deepEqual(await R.folderStates([]), {});
  assert.equal(calls.length, 0);
});

test("a second card, then a cull of the first (step 1's review, round 4): a hold a later hand-in lifted keeps marketing's culls out of the problem - the shoot's photo_drive_status' files.culled, asked only for such a folder and once until its files, list rows or hand-ins change; the second card's own problem still needs a look", async () => {
  const at = READY;
  // listLifted, alone: on the list (its states, with a time) and not held
  const L = (folders, l, held) => R.listLifted(folders, l, held).map((f) => f.id).sort();
  const two = [{ id: 1, shoot: 10 }, { id: 2, shoot: 20 }, { id: 3, shoot: 30 }, { id: 4, shoot: 40 }];
  assert.deepEqual(L(two, [{ shoot_id: 10, state: "posted", ready_at: at }, { shoot_id: 20, state: "withdrawn", ready_at: at },
    { shoot_id: 30, state: "ready", ready_at: "not a time" }, { shoot_id: 40, state: "claimed", ready_at: at }], new Set([4])), [1],
  "on the list and not held; withdrawn, without a time or held: not lifted");
  assert.deepEqual(L(two, [], new Set()), [], "off the list: not lifted");
  for (const state of R.LISTED_STATES) assert.deepEqual(L(two.slice(0, 1), [{ shoot_id: 10, state, ready_at: at }], []), [1], state);
  // the case: card 1 sealed before the list, card 2 (the phone's own hand-in) sealed after it, then marketing deleted 3
  // of card 1's photos in OneDrive - the rollup says problem, 3; the database (and the Files section) says culled, 3
  let folder = { id: 6001, shoot_id: 61, files_state: "problem", files_counted: 12, files_confirmed: 9, files_waiting: 0, files_problem: 3, photos: 9,
    videos: 0, files_rev: 7, drive_state: "found" };
  const others = [
    { id: 6002, shoot_id: 62, files_state: "problem", files_counted: 12, files_confirmed: 9, files_waiting: 0, files_problem: 3, photos: 9, drive_state: "found" },
    { id: 6003, shoot_id: 63, files_state: "problem", files_counted: 12, files_confirmed: 9, files_waiting: 0, files_problem: 3, photos: 9, drive_state: "found" },
  ];
  let listed = [{ id: 71, shoot_id: 61, state: "posted", ready_at: at, version: 3 }, { id: 72, shoot_id: 62, state: "posted", ready_at: at, version: 1 }];
  let sealed = [{ id: 81, folder_id: 6001, state: "sealed", sealed_at: LATER(-60) }, { id: 82, folder_id: 6001, state: "sealed", sealed_at: LATER(60) }];
  let files = { culled: 3, missing: 3, mismatch: 0 };
  let statusOf = (sid) => ({ mode: "on", shoot_id: sid, folder: { id: 6000 + sid - 60 }, files });
  const asked = [];
  const client = () => ({
    from: (t) => answer({ data: (t === "photo_marketing" ? listed : t === "photo_shoot_uploads" ? sealed : [folder].concat(others)).map((r) => Object.assign({}, r)), error: null }),
    rpc: async (name, args) => { asked.push([name, args.p_shoot]); const v = statusOf(args.p_shoot); return v instanceof Error ? { data: null, error: v } : { data: v, error: null }; },
  });
  useClient(client());
  let got = await R.folderStates([61, 62, 63]);
  assert.deepEqual([got[61].held, got[61].culled, V.filesIcon(got[61]).tone, V.filesIcon(got[61]).label], [false, 3, "ok", "9 photos in OneDrive"],
    "the second card lifts the hold; the first card's culls are still no problem");
  assert.deepEqual([got[62].held, got[62].culled, V.filesIcon(got[62]).tone], [true, 0, "ok"], "held (no hand-in since): no status asked");
  assert.deepEqual([got[63].held, got[63].culled, V.filesIcon(got[63]).tone], [false, 0, "problem"], "off the list: no status asked, the photographer's");
  assert.deepEqual(asked, [["photo_drive_status", 61]], "the status of the lifted folder's shoot only");
  // read again (a send's rollups, every 2 s): kept, never asked again while its files, list rows and hand-ins stay
  for (let i = 0; i < 3; i++) await R.folderStates([61, 62, 63]);
  assert.equal(asked.length, 1, "kept");
  // the second card's own missing photo: files_problem 4, a file row changed (files_rev) - asked again, needs a look
  folder = Object.assign({}, folder, { files_problem: 4, files_rev: 8 });
  files = { culled: 3, missing: 4, mismatch: 0 };
  got = await R.folderStates([61]);
  assert.deepEqual([asked.length, got[61].culled, V.filesIcon(got[61]).tone, V.filesIcon(got[61]).label], [2, 3, "problem", "9 photos in OneDrive - needs a look"]);
  // each part of the key asks again: the files (files_rev), the list rows, the hand-ins
  const n0 = asked.length;
  folder = Object.assign({}, folder, { files_rev: 9 });
  await R.folderStates([61]);
  listed = listed.map((m) => (m.id === 71 ? Object.assign({}, m, { version: 4 }) : m));
  await R.folderStates([61]);
  sealed = sealed.concat([{ id: 83, folder_id: 6001, state: "sealed", sealed_at: LATER(90) }]);
  await R.folderStates([61]);
  assert.equal(asked.length, n0 + 3, "files_rev, a list row's version, a hand-in sealed: each asked again");
  // a status of another folder (the shoot's folder replaced meanwhile): nothing taken out, nothing kept
  folder = Object.assign({}, folder, { files_problem: 3, files_rev: 10 });
  files = { culled: 3, missing: 3, mismatch: 0 };
  statusOf = (sid) => ({ mode: "on", shoot_id: sid, folder: { id: 9999 }, files });
  got = await R.folderStates([61]);
  assert.deepEqual([got[61].culled, V.filesIcon(got[61]).tone], [0, "problem"]);
  await R.folderStates([61]);
  assert.equal(asked.length, n0 + 5, "not kept: asked again");
  // only a whole count above 0 (DCR Desktop 2's culled: an int)
  statusOf = (sid) => ({ mode: "on", folder: { id: 6001 }, files: { culled: "3", missing: 3 } });
  folder = Object.assign({}, folder, { files_rev: 11 });
  assert.equal((await R.folderStates([61]))[61].culled, 0, "a text: 0");
  // refused (not the reader's 42501, the shoot gone PT404, no photo files or no OneDrive edition): nothing taken out,
  // the read goes on; a failure (a timeout, offline): the whole read fails - the page keeps the icons it shows
  for (const [code, why] of [["42501", "not theirs"], ["PT404", "the shoot gone"], ["42883", "no photo_drive_status"], ["PGRST202", "no such function"]]) {
    folder = Object.assign({}, folder, { files_rev: Number(folder.files_rev) + 1 });
    statusOf = () => Object.assign(new Error("no"), { code, message: "no" });
    got = await R.folderStates([61, 62, 63]);
    assert.deepEqual([got[61].culled, V.filesIcon(got[61]).tone, got[62].held], [0, "problem", true], why);
  }
  folder = Object.assign({}, folder, { files_rev: Number(folder.files_rev) + 1 });
  statusOf = () => ({ folder: { id: 6001 }, files: { culled: 3 } });
  assert.equal((await R.folderStates([61]))[61].culled, 0, "a status without the OneDrive edition (no mode): 0");
  for (const code of ["57014", "08006"]) {
    folder = Object.assign({}, folder, { files_rev: Number(folder.files_rev) + 1 });
    statusOf = () => Object.assign(new Error("no"), { code, message: "canceling statement due to statement timeout" });
    await assert.rejects(R.folderStates([61]), code);
  }
  useClient(Object.assign(client(), { rpc: async () => { throw new TypeError("Failed to fetch"); } }));
  folder = Object.assign({}, folder, { files_rev: Number(folder.files_rev) + 1 });
  await assert.rejects(R.folderStates([61]), "offline");
});

test("the columns read are the migrations' own: projects' place columns and photo_drive_folders' rollup columns (DCR_DESKTOP2_DIR)", { skip: !(D2 && existsSync(path.join(D2, "supabase", "migrations"))) && "DCR_DESKTOP2_DIR does not name DCR Desktop 2" }, () => {
  const dir = path.join(D2, "supabase", "migrations");
  const all = readdirSync(dir).filter((n) => /\.sql$/.test(n)).sort().map((n) => readFileSync(path.join(dir, n), "utf8").replace(/\r\n/g, "\n")).join("\n");
  const columnsOf = (table) => {
    const out = new Set();
    const m = new RegExp("create table public\\." + table + " \\(([\\s\\S]*?)\\n\\);").exec(all);
    assert.ok(m, table + " is made by a migration");
    for (const line of m[1].split("\n")) { const c = /^\s{2}([a-z_][a-z0-9_]*)\s/.exec(line); if (c && c[1] !== "constraint") out.add(c[1]); }
    for (const a of all.matchAll(new RegExp("alter table public\\." + table + "\\b([\\s\\S]*?);", "g"))) {
      for (const c of a[1].matchAll(/add column (?:if not exists )?([a-z_][a-z0-9_]*)/g)) out.add(c[1]);
    }
    return out;
  };
  const projects = columnsOf("projects");
  for (const c of projectsRepo.PLACE_COLUMNS.split(", ")) assert.ok(projects.has(c), "projects." + c);
  const folders = columnsOf("photo_drive_folders");
  for (const c of R.FOLDER_COLUMNS.concat(["kind", "retired_at"])) assert.ok(folders.has(c), "photo_drive_folders." + c);
  assert.match(all, /create policy "photo_drive_folders: admins and the photo team read them" on public\.photo_drive_folders for select to authenticated\s+using \(\(select app\.can_photo_read\(\)\)\);/,
    "read under app.can_photo_read");
  // step 1's review, round 3: the Ready list's rows and the sealed hand-ins (app.photo_help_held_by_list's own reads),
  // under the same RLS, and the list's states the database's own
  const marketing = columnsOf("photo_marketing");
  for (const c of R.LISTED_COLUMNS) assert.ok(marketing.has(c), "photo_marketing." + c);
  const uploads = columnsOf("photo_shoot_uploads");
  for (const c of R.SEALED_COLUMNS.concat(["state"])) assert.ok(uploads.has(c), "photo_shoot_uploads." + c);
  assert.match(all, /create policy "photo_marketing: admins and the photo team read the list" on public\.photo_marketing for select to authenticated\s+using \(\(select app\.can_photo_read\(\)\)\);/);
  assert.match(all, /create policy "photo_shoot_uploads: admins and the photo team read them" on public\.photo_shoot_uploads for select to authenticated\s+using \(\(select app\.can_photo_read\(\)\)\);/);
  const held = /create or replace function app\.photo_help_held_by_list\(f public\.photo_drive_folders\)[\s\S]*?\$\$;/.exec(all);
  assert.ok(held, "the database's own rule");
  assert.match(held[0], new RegExp("m\\.state in \\(" + R.LISTED_STATES.map((x) => "'" + x + "'").join(", ") + "\\)"), "the same states");
  assert.match(held[0], /m\.ready_at >= coalesce\(\(select max\(u\.sealed_at\) from public\.photo_shoot_uploads u where u\.folder_id = f\.id and u\.state = 'sealed'\)/, "the last sealed hand-in");
});

/* DCR Desktop 2's files_mark run on the same rollups (step 1's review, round 3: the phone kept the arrow and the words
   round 2 had replaced on the desk, and each app's tests pinned its own words, so nothing caught the gap). Each case is
   a photo_drive_folders row as both apps read it, with its shoot's Ready for marketing rows (_list) and its folder's
   hand-ins (_sealed) - _held: posted to the list, no hand-in. Portal 2's side goes through folderStates (its column
   mapping, its list read and listHolds) and filesIcon; DCR Desktop 2's through its load_files steps (files_problem picks
   the folders whose list is read, list_holds holds them: ON_THE_LIST) and files_mark, in Python, on the tree
   DCR_DESKTOP2_DIR names. The two give the same photos, videos, arrow, tone and words - and hold the same folders - for
   every case: the ones below (held and folder-gone ones too), odd counts and older reads, and SE §1.6's own examples
   (SE_FINAL, which must be the contract's table line for line). Strict: a DCR Desktop 2 without the round 3 rule
   (ON_THE_LIST, list_holds, files_problem) fails. */
const LATER = (min) => new Date(Date.parse(READY) + min * 60e3).toISOString();
const FILES_CASES = [
  ["all in", { files_state: "confirmed", files_counted: 15, files_confirmed: 15, photos: 12, videos: 3 }],
  ["one photo, one video", { files_state: "confirmed", files_counted: 2, files_confirmed: 2, photos: 1, videos: 1 }],
  ["videos alone", { files_state: "confirmed", files_counted: 3, files_confirmed: 3, videos: 3 }],
  ["one photo", { files_state: "confirmed", files_counted: 1, files_confirmed: 1, photos: 1 }],
  ["copying, 4 waiting", { files_state: "copying", files_counted: 9, files_confirmed: 5, files_waiting: 4, photos: 5 }],
  ["waiting, 9 waiting", { files_state: "waiting", files_counted: 40, files_confirmed: 31, files_waiting: 9, photos: 29, videos: 2 }],
  ["waiting, one file", { files_state: "waiting", files_counted: 15, files_confirmed: 14, files_waiting: 1, photos: 14 }],
  ["nothing in yet, 6 waiting", { files_state: "waiting", files_counted: 6, files_waiting: 6 }],
  ["nothing in yet, 1 waiting", { files_state: "copying", files_counted: 1, files_waiting: 1 }],
  ["abandoned: copying, nothing waiting", { files_state: "copying", files_counted: 124, files_confirmed: 124, files_waiting: 0, photos: 120, videos: 4 }],
  ["waiting, nothing waiting", { files_state: "waiting", files_counted: 12, files_confirmed: 12, files_waiting: 0, photos: 12 }],
  ["a copy that counted nothing yet", { files_state: "copying" }],
  ["3 not checkable", { files_state: "waiting", files_counted: 10, files_confirmed: 4, files_waiting: 3, photos: 4 }],
  ["a problem", { files_state: "problem", files_counted: 64, files_confirmed: 58, files_problem: 6, photos: 53, videos: 5 }],
  ["a problem, nothing in", { files_state: "problem", files_counted: 4, files_problem: 4 }],
  ["a problem while another copy is open", { files_state: "copying", files_counted: 52, files_confirmed: 40, files_waiting: 10, files_problem: 2, photos: 40 }],
  ["a problem count while waiting", { files_state: "waiting", files_counted: 15, files_confirmed: 9, files_waiting: 4, files_problem: 2, photos: 9 }],
  ["none", { files_state: "none" }],
  ["none with counts", { files_state: "none", files_counted: 2, files_confirmed: 2, photos: 2 }],
  ["documents alone", { files_state: "confirmed", files_counted: 3, files_confirmed: 3 }],
  ["confirmed, waiting left over", { files_state: "confirmed", files_counted: 9, files_confirmed: 5, files_waiting: 4, photos: 5 }],
  ["big counts", { files_state: "waiting", files_counted: 1400, files_confirmed: 1320, files_waiting: 80, photos: 1200, videos: 120 }],
  ["bad counts", { files_state: "confirmed", files_counted: "x", files_confirmed: -2, photos: "3", videos: -1 }],
  ["a folder there", { files_state: "confirmed", files_counted: 2, files_confirmed: 2, photos: 2, drive_state: "found" }],
];
// round 3: held on the Ready list (app.photo_help_held_by_list - read only for a folder with a files problem) and a folder
// gone (drive_state missing or trashed)
const PROBLEM = { files_state: "problem", files_counted: 60, files_confirmed: 54, files_problem: 6, photos: 50, videos: 4, drive_state: "found" };
const FILES_CASES_R3 = [
  ["marketing's culls, held", Object.assign({}, PROBLEM, { _held: true })],
  ["a problem, not held", Object.assign({}, PROBLEM)],
  ["held, a second card on its way", { files_state: "copying", files_counted: 70, files_confirmed: 50, files_waiting: 14, files_problem: 6, photos: 50, drive_state: "found",
    _held: true }],
  ["held, nothing in", { files_state: "problem", files_counted: 6, files_problem: 6, drive_state: "found", _held: true }],
  ["held, a problem count while confirmed", { files_state: "confirmed", files_counted: 9, files_confirmed: 7, files_problem: 2, photos: 7, _held: true }],
  ["moved out of DCR Photo & Video", { files_state: "confirmed", files_counted: 30, files_confirmed: 30, photos: 28, videos: 2, drive_state: "missing" }],
  ["deleted in OneDrive", { files_state: "confirmed", files_counted: 30, files_confirmed: 30, photos: 28, videos: 2, drive_state: "trashed" }],
  ["gone and held", { files_state: "problem", files_counted: 9, files_confirmed: 3, files_problem: 6, photos: 3, drive_state: "missing", _held: true }],
  ["gone, on the list, no problem", { files_state: "confirmed", files_counted: 1, files_confirmed: 1, videos: 1, drive_state: "trashed", _held: true }],
  ["gone while files wait", { files_state: "waiting", files_counted: 9, files_confirmed: 3, files_waiting: 6, photos: 3, drive_state: "trashed" }],
  ["gone, nothing in", { files_state: "waiting", files_counted: 4, files_waiting: 4, drive_state: "missing" }],
  ["not seen yet", { files_state: "waiting", files_counted: 4, files_waiting: 4, drive_state: "not_seen" }],
  // the hand-ins (only a SEALED one counts, the last one) and the list's rows (its states, its time)
  ["held, a card sealed before it went on the list", Object.assign({}, PROBLEM, { _list: [{ state: "posted", ready_at: READY }],
    _sealed: [{ state: "sealed", sealed_at: LATER(-60) }] })],
  ["held, a card sealed at ready_at", Object.assign({}, PROBLEM, { _list: [{ state: "posted", ready_at: READY }], _sealed: [{ state: "sealed", sealed_at: READY }] })],
  ["a card sealed after it went on the list: the photographer's", Object.assign({}, PROBLEM, { _list: [{ state: "posted", ready_at: READY }],
    _sealed: [{ state: "sealed", sealed_at: LATER(60) }] })],
  ["the last sealed card counts", Object.assign({}, PROBLEM, { _list: [{ state: "ready", ready_at: READY }],
    _sealed: [{ state: "sealed", sealed_at: LATER(-60) }, { state: "sealed", sealed_at: LATER(60) }] })],
  ["a cancelled card since: still held", Object.assign({}, PROBLEM, { _list: [{ state: "claimed", ready_at: READY }],
    _sealed: [{ state: "cancelled", sealed_at: LATER(60) }, { state: "abandoned", sealed_at: LATER(90) }] })],
  ["withdrawn: off the list", Object.assign({}, PROBLEM, { _list: [{ state: "withdrawn", ready_at: READY }] })],
  ["passed", Object.assign({}, PROBLEM, { _list: [{ state: "passed", ready_at: READY }] })],
  ["claimed, then posted again after a sealed card", Object.assign({}, PROBLEM, { _list: [{ state: "claimed", ready_at: READY }, { state: "posted", ready_at: LATER(120) }],
    _sealed: [{ state: "sealed", sealed_at: LATER(60) }] })],
  ["on the list without its time", Object.assign({}, PROBLEM, { _list: [{ state: "ready", ready_at: "not a time" }] })],
  ["held while a second copy is open", { files_state: "copying", files_counted: 70, files_confirmed: 50, files_waiting: 14, files_problem: 6, photos: 50,
    _list: [{ state: "posted", ready_at: READY }], _sealed: [{ state: "sealed", sealed_at: LATER(-60) }] }],
];
// SE §1.6 "The rule, final", 1: whole numbers (a fraction cut, a decimal text read, anything else 0); an older read
// without files_waiting; an empty or unknown state
const FILES_CASES_ODD = [
  ["fractional counts", { files_state: "confirmed", files_counted: 4, files_confirmed: 4, photos: 2.5, videos: "1.9" }],
  ["padded texts", { files_state: "waiting", files_counted: " 9 ", files_confirmed: "4", files_waiting: " 5 ", photos: " 4 " }],
  ["a hex text, a fraction below one", { files_state: "confirmed", photos: "0x10", videos: 0.5 }],
  ["an exponent", { files_state: "waiting", files_waiting: "2e1", photos: "1e2" }],
  ["an older read, files on their way", { files_state: "copying", files_counted: 5, files_confirmed: 2, photos: 2 }],
  ["an older read with a problem", { files_state: "waiting", files_counted: 15, files_confirmed: 9, files_problem: 2, photos: 9 }],
  ["an older read, all in", { files_state: "copying", files_counted: 5, files_confirmed: 5, photos: 5 }],
  ["an older read, more confirmed than counted", { files_state: "waiting", files_counted: 2, files_confirmed: 5, photos: 5 }],
  ["an older read, nothing in yet", { files_state: "waiting", files_counted: 3, files_waiting: null }],
  ["no state, counts", { files_state: null, files_counted: 2, files_confirmed: 2, photos: 2 }],
  ["an empty state, files waiting", { files_state: "", files_waiting: 3, photos: 1 }],
  ["an unknown state, files waiting", { files_state: "paused", files_waiting: 3, photos: 1 }],
  ["drive_state in capitals", { files_state: "confirmed", photos: 1, drive_state: "MISSING" }],
  ["drive_state null", { files_state: "confirmed", photos: 1, drive_state: null }],
];
// step 1's review, round 4: a second card sealed after the list lifts the hold, yet the first card's culls stay
// marketing's - the shoot's photo_drive_status (files.culled) is read for such a folder alone (_culled: what it answers;
// _statusFolder: a status of another folder, the shoot's folder replaced meanwhile)
const LIFTED = { _list: [{ state: "posted", ready_at: READY }], _sealed: [{ state: "sealed", sealed_at: LATER(-60) }, { state: "sealed", sealed_at: LATER(60) }] };
const FILES_CASES_R4 = [
  ["a second card, then a cull of the first", Object.assign({}, PROBLEM, LIFTED, { _culled: 6 })],
  ["a second card, culls and its own missing file", Object.assign({}, PROBLEM, LIFTED, { files_problem: 7, files_counted: 61, _culled: 6 })],
  ["a second card on its way, the first's culls", Object.assign({}, LIFTED, { files_state: "copying", files_counted: 70, files_confirmed: 50, files_waiting: 14,
    files_problem: 6, photos: 50, _culled: 6 })],
  ["culls out of a problem state, files waiting", Object.assign({}, PROBLEM, LIFTED, { files_counted: 63, files_waiting: 3, _culled: 6 })],
  ["more culls than problem files", Object.assign({}, PROBLEM, LIFTED, { _culled: 9 })],
  ["only culls, nothing in OneDrive", Object.assign({}, LIFTED, { files_state: "problem", files_counted: 6, files_problem: 6, _culled: 6 })],
  ["an older read, the culls out", Object.assign({}, LIFTED, { files_state: "problem", files_counted: 14, files_confirmed: 9, files_problem: 3, photos: 9, _culled: 3 })],
  ["a second card, no culls answered", Object.assign({}, PROBLEM, LIFTED, { _culled: 0 })],
  ["a cull count as a text", Object.assign({}, PROBLEM, LIFTED, { _culled: "6" })],
  ["a status of another folder", Object.assign({}, PROBLEM, LIFTED, { _culled: 6, _statusFolder: 1 })],
  ["gone, the first card's culls", Object.assign({}, PROBLEM, LIFTED, { drive_state: "trashed", _culled: 6 })],
  ["the culled card's own hand-in sealed after the list", Object.assign({}, PROBLEM, { _list: [{ state: "posted", ready_at: READY }],
    _sealed: [{ state: "sealed", sealed_at: LATER(60) }], _culled: 0 })],
  ["held: the status never asked", Object.assign({}, PROBLEM, { _held: true, _culled: 2 })],
  ["off the list: the status never asked", Object.assign({}, PROBLEM, { _sealed: [{ state: "sealed", sealed_at: LATER(60) }], _culled: 6 })],
  ["withdrawn after a second card: the status never asked", Object.assign({}, PROBLEM, { _list: [{ state: "withdrawn", ready_at: READY }], _sealed: LIFTED._sealed,
    _culled: 6 })],
  ["listed without its time: the status never asked", Object.assign({}, PROBLEM, { _list: [{ state: "ready", ready_at: "not a time" }], _sealed: LIFTED._sealed,
    _culled: 6 })],
];
const PY_MARK = [
  "import json, sys",
  "from types import SimpleNamespace",
  "sys.path.insert(0, sys.argv[1])",
  "from dcrdesk.domain import photo_view as P",
  "from dcrdesk.backend.repos.photo_drive import PhotoDriveRepo",
  "data = json.load(sys.stdin)",
  "rows = data['rows']",
  "status = data.get('status') or {}",
  "asked = []",
  "class Db:",
  "    def rpc(self, fn, params, create=False):",
  "        asked.append([fn, params.get('p_shoot')])",
  "        return status.get(str(params.get('p_shoot')))",
  "drive = PhotoDriveRepo(SimpleNamespace(db=Db()))",
  "# DCR Desktop 2's load_files steps (dcrdesk/ui/pages/photo.py _list_holds): the folders with a files problem are the",
  "# ones whose Ready list is read; list_holds holds them; each row says ON_THE_LIST",
  "probs = [r for r in rows if P.files_problem(r) and r.get('id') is not None and r.get('shoot_id') is not None]",
  "held = P.list_holds(probs, data['marketing'], data['uploads']) if probs else set()",
  "# review round 4 (its _culls): the folders on the list whose hold a later hand-in lifted, each its shoot's status' culls",
  "# through its own PhotoDriveRepo.culled (here over the cases' status answers); each row says CULLED",
  "culled = {}",
  "for f in (P.list_lifted(probs, data['marketing'], held) if probs else []):",
  "    n = drive.culled(f.get('shoot_id'), f.get('id'), None)",
  "    if isinstance(n, int) and not isinstance(n, bool) and n > 0:",
  "        culled[f.get('id')] = n",
  "out = []",
  "for row in rows:",
  "    row = dict(row)",
  "    row[P.ON_THE_LIST] = row.get('id') is not None and row.get('id') in held",
  "    row[P.CULLED] = culled.get(row.get('id'), 0)",
  "    m = P.files_mark(row)",
  "    out.append(None if m is None else {'photos': m.photos, 'videos': m.videos, 'arrow': m.arrow, 'tone': m.tone, 'words': m.words})",
  "print(json.dumps({'marks': out, 'held': sorted(held), 'culled': {str(k): v for k, v in culled.items()}, 'asked': asked}))",
].join("\n");
const D2_VIEW = D2 ? path.join(D2, "dcrdesk", "domain", "photo_view.py") : "";
const PYTHON = ["python", "python3"].find((p) => { try { return spawnSync(p, ["-I", "-c", "import sys"], { encoding: "utf8" }).status === 0; } catch (e) { return false; } }) || "";
const D2_SKIP = !(D2_VIEW && existsSync(D2_VIEW)) ? "DCR_DESKTOP2_DIR does not name DCR Desktop 2" : !PYTHON && "no Python here to run DCR Desktop 2's files_mark";
test("THE ICON RULE word for word with DCR Desktop 2's files_mark and list_holds (its photo_view.py, run on the same rollups, list rows and hand-ins; DCR_DESKTOP2_DIR): the photos, the videos, the arrow, the tone, the words and the folders held of every case", {
  skip: D2_SKIP }, async () => {
  const py = (input) => {
    const run = spawnSync(PYTHON, ["-I", "-c", PY_MARK, D2], { input: JSON.stringify(input), encoding: "utf8", env: Object.assign({}, process.env, { PYTHONIOENCODING: "utf-8" }) });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };
  // the steps PY_MARK mirrors are DCR Desktop 2's own (its page's load_files, _list_holds and _culls)
  const pageSrc = readFileSync(path.join(D2, "dcrdesk", "ui", "pages", "photo.py"), "utf8");
  for (const line of ['probs = [r for r in rows if P.files_problem(r) and r.get("id") is not None and r.get("shoot_id") is not None]',
    "held = P.list_holds(probs, listed, sealed)", "culled = _culls(drive, P.list_lifted(probs, listed, held), listed, sealed)",
    "n = drive.culled(sid, fid, key)", "if isinstance(n, int) and not isinstance(n, bool) and n > 0:",
    'P.ON_THE_LIST: r.get("id") is not None and r.get("id") in held', 'P.CULLED: culled.get(r.get("id"), 0)']) assert.ok(pageSrc.includes(line), line);
  const examples = SE_FINAL.map(seExample).map(exampleCase);
  const cases = FILES_CASES.concat(FILES_CASES_R3, FILES_CASES_R4, FILES_CASES_ODD, examples);
  const c = caseRows(cases);
  const rows = c.rows;
  // (_statusFolder: the case's status names another folder)
  cases.forEach(([, r], i) => { if (r._statusFolder) c.status[i + 1].folder.id = r._statusFolder; });
  const theirs = py({ rows, marketing: c.marketing, uploads: c.uploads, status: c.status });
  // Portal 2's side: folderStates over a stub that answers these rows, the list rows, the hand-ins and the statuses as
  // they are (the stub filters nothing: listHolds and listLifted check each row themselves, as list_holds and
  // list_lifted do)
  const asked = [];
  const stub = caseClient(c);
  useClient(Object.assign({}, stub, { rpc: (name, args) => { asked.push([name, args.p_shoot]); return stub.rpc(name, args); } }));
  const read = await R.folderStates(rows.map((r) => r.shoot_id));
  const TONE = { "": "ok", muted: "sending", warning: "problem" };
  cases.forEach(([what], i) => {
    const mine = V.filesIcon(read[i + 1]);
    const t = theirs.marks[i];
    assert.deepEqual(mine && { photos: mine.photos, videos: mine.videos, arrow: mine.sending, tone: mine.tone, words: mine.label },
      t && { photos: t.photos, videos: t.videos, arrow: t.arrow, tone: TONE[t.tone], words: t.words }, what);
  });
  assert.deepEqual(rows.filter((r) => read[r.shoot_id].held).map((r) => r.id), theirs.held, "the same folders held");
  // round 4: the same statuses asked (for the same shoots, in the same order), the same culls taken out
  assert.deepEqual(asked, theirs.asked, "the same statuses asked");
  assert.deepEqual(Object.fromEntries(rows.filter((r) => read[r.shoot_id].culled).map((r) => [String(r.id), read[r.shoot_id].culled])), theirs.culled, "the same culls");
  const marks = theirs.marks.filter(Boolean);
  assert.ok(cases.length >= 92 && marks.length >= 75 && marks.some((t) => t.arrow) && marks.some((t) => t.tone === "warning") && marks.some((t) => t.tone === "") &&
    theirs.held.length >= 13 && theirs.marks.some((t) => t === null) && Object.keys(theirs.culled).length >= 10 && theirs.asked.length >= 14,
  "the cases cover each tone, the held, the culls and nothing");
  // SE §1.6's examples are the contract's table line for line, and both apps show and say what it says
  const se = readFileSync(path.join(D2, "docs", "PHOTO-SHOOT-EDITS.md"), "utf8").replace(/\r\n/g, "\n");
  const start = se.indexOf("**The rule, final**");
  assert.ok(start > 0, "SE §1.6 has the final rule");
  const block = se.slice(start, se.indexOf("**Where it shows.**", start));
  assert.deepEqual(block.split("\n").filter((l) => l.startsWith("| `files_state`")).map((l) => l.trim()), SE_FINAL, "SE_FINAL is SE §1.6's examples, line for line");
  SE_FINAL.map(seExample).forEach((e, k) => {
    const t = theirs.marks[cases.length - SE_FINAL.length + k];
    assert.deepEqual(t && { photos: t.photos, videos: t.videos, arrow: t.arrow, tone: TONE[t.tone] }, e.shown, "DCR Desktop 2 shows: " + e.rollup);
    assert.equal(t ? t.words : "", e.words, "DCR Desktop 2 says: " + e.rollup);
  });
  // the states the final rule names are DCR Desktop 2's (LISTED, FOLDER_GONE, FILES_ON_THE_WAY) and Portal 2's
  const consts = spawnSync(PYTHON, ["-I", "-c", "import json, sys\nsys.path.insert(0, sys.argv[1])\nfrom dcrdesk.domain import photo_view as P\n" +
    "print(json.dumps([list(P.LISTED), list(P.FOLDER_GONE), list(P.FILES_ON_THE_WAY)]))", D2], { encoding: "utf8" });
  assert.equal(consts.status, 0, consts.stderr);
  assert.deepEqual(JSON.parse(consts.stdout), [R.LISTED_STATES.slice(), V.FOLDER_GONE.slice(), V.FILES_ON_THE_WAY.slice()]);
  // a rollup without files_waiting (an older read): both count the counted files neither confirmed nor a problem
  const old = py({ rows: [{ kind: "shoot", files_state: "waiting", files_counted: 15, files_confirmed: 9, photos: 9 }], marketing: [], uploads: [] }).marks[0];
  assert.equal(V.filesIcon({ state: "waiting", counted: 15, confirmed: 9, photos: 9 }).label, old.words);
});

/* ── the page, driven in node over the demo database ── */

const toasts = [];
globalThis.Node = globalThis.Node || class { static [Symbol.hasInstance](x) { return !!x && typeof x.nodeType === "number"; } };
const DCR2 = Object.assign({}, common2.DCR2, { toast: (t, k) => { toasts.push([String(t), k]); }, confirm: async () => true });
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
const imgs = (root) => (root || document.body).descendants().filter((e) => e.localName === "img");

/** The client as `key`, Storage's links as https ones of the made-up network (o.from: tables answered otherwise). */
function wrapClient(c, net, o) {
  const opt = o || {};
  return Object.assign({}, c, {
    from: (t) => (opt.from && opt.from[t] ? opt.from[t]() : c.from(t)),
    storage: { from: (b) => {
      const s = c.storage.from(b);
      return Object.assign({}, s, {
        createSignedUrls: async (paths, secs) => {
          const r = await s.createSignedUrls(paths, secs);
          net.signs += 1;
          return { data: r.data.map((x) => (x.signedUrl ? Object.assign({}, x, { signedUrl: net.link(x.path) }) : x)), error: r.error };
        },
      });
    } },
  });
}
async function engine() {
  FK = await loadFake();
  const E = await freshEngine(new Date());
  E.exts.find((x) => x.name === "p10-photo").__dev.pc.state({ auto: false });
  return E;
}
async function open(E, key, net, o) {
  page._test.reset();
  document.body.innerHTML = BODY;
  toasts.length = 0;
  repo.useKeyStore(null);
  page._test.picDeps(net.parts);
  const p = await person(key);
  useClient(wrapClient(clientAs(E, p.id), net, o));
  await page.init({ id: p.id, name: p.name, role: p.role, active: true }, { search: (o && o.search) || "", watch: false });
  await S.side;                                  // the places and the rollups, asked beside the schedule
  return p;
}
const planBy = (code) => S.plans.find((p) => p.projectCode === code);
const shootBy = (code, key) => S.shoots.find((s) => s.planId === planBy(code).id && s.key === key);
const rowOf = (id) => document.querySelector('#shList [data-shoot="' + id + '"]');
const iconOf = (n) => (n ? n.querySelector(".sh-fi") : null);
function click(sel) { const n = document.querySelector(sel); assert.ok(n, "nothing matches " + sel); n.click(); return n; }
const town = (place) => place.city + ", CA " + place.zip;

test("the shoot sheet's place (SE §1.4): the 64 px picture as a blob: URL - never a signed link -, the address as a Google Maps link in a new tab; By job's header: the 48 px picture and the address line; rows stay 'job · city'", { skip }, async () => {
  const E = await engine();
  const net = network();
  await open(E, "field", net);
  const t9 = planBy("A000T9");
  const place = S.places[t9.projectId];
  assert.equal(place.address, T9_STREET);
  const walk = shootBy("A000T9", "drone-check");
  click('#shList [data-shoot="' + walk.id + '"]');
  const sheet = $("shDScroll");
  await until(() => imgs(sheet).length, 4000, "the picture");
  const img = imgs(sheet)[0];
  assert.match(img.getAttribute("src"), /^blob:test\/\d+$/, "the page's own URL for the bytes");
  assert.deepEqual([img.getAttribute("alt"), img.getAttribute("title"), img.getAttribute("width"), img.getAttribute("height"), img.getAttribute("class")],
    ["The job's picture", "The job's picture", "64", "64", "sh-pic s64"]);
  assert.equal(img.getAttribute("data-pic"), String(place.pictureId));
  const a = sheet.querySelector(".sh-place a.sh-addr");
  assert.equal(a.textContent, T9_STREET + " · " + town(place), "the address line: street · town, CA zip");
  assert.equal(a.getAttribute("href"), "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(T9_STREET + ", " + town(place)));
  assert.deepEqual([a.getAttribute("target"), a.getAttribute("rel"), a.getAttribute("title")], ["_blank", "noopener noreferrer", "Open in Maps"]);
  // the block sits under the job line, which leaves the town out: the address line ends with it (never said twice -
  // step 1's review, round 1; By job's header the same)
  const kids = sheet.children.map((n) => n.getAttribute("class"));
  assert.equal(kids.indexOf("sh-place"), kids.indexOf("sh-dplace") + 1);
  assert.equal(sheet.querySelector(".sh-dplace").textContent, "A000T9 Sample house");
  assert.equal(sheet.textContent.split("Sandbox").length - 1, 1, "the town once in the sheet");
  // every picture the page draws is its own blob: URL; the signed links were fetched, never drawn
  assert.ok(net.calls.length >= 1 && net.calls.every((u) => /^https:\/\/demo-ref\.supabase\.co\//.test(u)));
  for (const i of imgs()) assert.match(i.getAttribute("src"), /^blob:test\/\d+$/);
  assert.ok(!document.body.innerHTML.includes("token=t"), "no signed link anywhere in the page");
  // the list rows stay "job · city" (no address on a phone row)
  const row = rowOf(walk.id);
  assert.equal(row.querySelector(".sh-job").textContent, "A000T9 Sample house · Sandbox");
  // By job: the 48 px picture left of the job and the address line under it (the town not said twice)
  click('#shViews [data-view="job"]');
  const hd = (code) => $("shPlan" + planBy(code).id).querySelector(".sh-plan-hd");
  await until(() => imgs(hd("A000T8")).length, 4000, "A000T8's picture");
  const p9 = imgs(hd("A000T9"))[0];
  assert.deepEqual([p9.getAttribute("class"), p9.getAttribute("width"), p9.getAttribute("src")], ["sh-pic s48", "48", img.getAttribute("src")], "the same picture: fetched once");
  assert.equal(hd("A000T9").querySelector(".sh-plan-addr").textContent, T9_STREET + " · " + town(place));
  assert.equal(hd("A000T9").querySelector(".sh-plan-t").querySelectorAll("span").filter((n) => n.textContent === "Sandbox").length, 0, "the town once");
  const t8 = S.places[planBy("A000T8").projectId];
  assert.equal(hd("A000T8").querySelector(".sh-plan-addr").textContent, T8_STREET + " · " + town(t8));
  // A000T6: no street, no picture - the neutral tile, no address line, its town as before
  const h6 = hd("A000T6");
  assert.equal(imgs(h6).length, 0);
  assert.ok(h6.querySelector("span.sh-pic.s48.none"), "the neutral tile");
  assert.equal(h6.querySelector(".sh-plan-addr"), null);
  assert.ok(h6.querySelector(".sh-plan-t").querySelectorAll("span").some((n) => n.textContent === "Sage Valley"));
  // a shoot of A000T6: no place block at all (nothing to say) - its job line names the town as before
  const d6 = shootBy("A000T6", "delivery");
  click('#shList [data-shoot="' + d6.id + '"]');
  assert.equal($("shDScroll").querySelector(".sh-place"), null);
  assert.ok($("shDScroll").querySelector(".sh-dplace").textContent.includes(" · Sage Valley"), $("shDScroll").querySelector(".sh-dplace").textContent);
  assert.deepEqual(new Set(net.calls.map((u) => u.replace(/\?token=t\d+$/, ""))).size, net.calls.length, "each picture fetched once");
  assert.equal(net.calls.length, 2, "A000T9's and A000T8's");
});

test("AN EXPIRED PICTURE LINK: an hour later the signed links are dead, the page reads again and again - the pictures still show, never fetched again; one that could not be fetched is asked again only after RETRY_MS (step 1's review, round 3), then signed and fetched again", { skip }, async () => {
  const E = await engine();
  const net = network();
  const t8pid = planOfE(E, "A000T8").project_id;
  net.failOnce.add("p/" + t8pid + "/thumbnail/");             // A000T8's first fetch fails (no signal for a moment)
  await open(E, "field", net);
  const walk = shootBy("A000T9", "drone-check");
  click('#shViews [data-view="job"]');                         // By job draws both jobs' pictures
  click('#shList [data-shoot="' + walk.id + '"]');
  await until(() => imgs($("shDScroll")).length, 4000, "the picture");
  const src = imgs($("shDScroll"))[0].getAttribute("src");
  await until(() => net.calls.length === 2, 4000, "both fetches");
  const t8 = S.places[t8pid];
  assert.equal(S.pics.url(t8.pictureId), null, "A000T8's picture: the tile for now");
  const signs = net.signs;
  // an hour later: every link signed so far has run out
  net.expiredUpTo = net.tokens;
  assert.equal((await net.fetch(net.calls[0])).status, 400, "the link the picture came from is dead");
  net.calls.pop();
  // every read of the schedule (each photo_plans / photo_shoots / photo_changes event reads it) never signs or fetches
  // the one that failed again before RETRY_MS (round 3: each read signed and fetched it again)
  for (let i = 0; i < 3; i++) { await page._test.load({ quiet: true }); await S.side; }
  await tick();
  assert.deepEqual([net.signs, net.calls.length, S.pics.url(t8.pictureId)], [signs, 2, null], "not asked again yet");
  net.clock += RETRY_MS;
  await page._test.load({ quiet: true });
  await until(() => S.pics.url(t8.pictureId), 4000, "A000T8's picture, signed and fetched again");
  assert.equal(imgs($("shDScroll"))[0].getAttribute("src"), src, "the picture still shows: the page's own bytes");
  assert.equal(net.signs, signs + 1, "signed again only for the one it did not have");
  assert.equal(net.calls.filter((u) => u.includes("p/" + planOfE(E, "A000T9").project_id + "/thumbnail/")).length, 1, "A000T9's picture fetched once in all");
  assert.equal(net.revoked.length, 0, "nothing let go");
  assert.ok(!document.body.innerHTML.includes("token=t"));
});

test("only the pictures the page draws are fetched (step 1's review, round 3): none for the Agenda or Month, By job's for its jobs only (the archived ones once shown), the open sheet's when it opens", { skip }, async () => {
  const E = await engine();
  const net = network();
  // the archived job gets a picture too (the demo's has none)
  const t7 = E.rows.projects.find((x) => x.id === planOfE(E, "A000T7").project_id);
  const t9pic = E.rows.files.find((x) => x.id === E.rows.projects.find((y) => y.id === planOfE(E, "A000T9").project_id).thumbnail_file_id);
  const key = "p/" + t7.id + "/thumbnail/" + "d10a" + String(t7.id).padStart(28, "0") + "/Project_picture.jpg";
  E.rows.files.push(Object.assign({}, t9pic, { id: 99901, project_id: t7.id, storage_path: key }));
  if (E.objects) E.objects[key] = Object.assign({}, E.objects[t9pic.storage_path]);
  t7.thumbnail_file_id = 99901;
  await open(E, "field", net);
  await tick();
  assert.deepEqual([net.signs, net.calls.length], [0, 0], "the Agenda draws no picture: none fetched");
  click('#shViews [data-view="month"]');
  await tick();
  assert.deepEqual([net.signs, net.calls.length], [0, 0], "nor the Month");
  // the open sheet's picture, when it opens
  click('#shViews [data-view="agenda"]');
  const walk = shootBy("A000T9", "drone-check");
  click('#shList [data-shoot="' + walk.id + '"]');
  await until(() => imgs($("shDScroll")).length, 4000, "the sheet's picture");
  assert.equal(net.calls.length, 1, "its own alone");
  assert.ok(net.calls[0].includes("p/" + planOfE(E, "A000T9").project_id + "/thumbnail/"));
  // By job: the jobs it lists - an archived plan's only once the archived ones are shown
  const arch = S.plans.find((p) => p.status === "archived");
  assert.ok(arch && S.places[arch.projectId] && S.places[arch.projectId].pictureId, "the demo's archived plan has its job's picture");
  click('#shViews [data-view="job"]');
  await until(() => net.calls.length >= 2, 4000, "By job's pictures");
  await tick();
  const fetched = () => net.calls.map((u) => Number((/p\/(\d+)\/thumbnail\//.exec(u) || [])[1]));
  const listed = Array.from(document.querySelectorAll("#shList .sh-plan")).map((x) => S.plans.find((p) => p.id === Number(x.getAttribute("data-plan"))));
  for (const pid of fetched()) assert.ok(listed.some((p) => p && p.projectId === pid), "a fetched picture is a listed job's");
  assert.ok(!fetched().includes(arch.projectId), "an archived job's picture is not fetched while it is hidden");
  $("shArchived").checked = true;
  $("shArchived").dispatchEvent({ type: "change" });
  await until(() => fetched().includes(arch.projectId), 4000, "shown: fetched");
  page._test.stop();
});

test("a picture that fails to draw: the neutral tile at once, its URL let go, fetched again at the next read", { skip }, async () => {
  const E = await engine();
  const net = network();
  await open(E, "field", net);
  const walk = shootBy("A000T9", "drone-check");
  click('#shList [data-shoot="' + walk.id + '"]');
  const img = await until(() => imgs($("shDScroll"))[0], 4000, "the picture");
  const src = img.getAttribute("src");
  const calls = net.calls.length;
  img.dispatchEvent({ type: "error", bubbles: false });
  assert.equal(imgs($("shDScroll")).length, 0, "no img now");
  assert.ok($("shDScroll").querySelector(".sh-place span.sh-pic.s64.none"), "the neutral tile in its place");
  assert.deepEqual(net.revoked, [src]);
  await page._test.load({ quiet: true });
  const again = await until(() => imgs($("shDScroll"))[0], 4000, "fetched again");
  assert.notEqual(again.getAttribute("src"), src);
  assert.equal(net.calls.length, calls + 1);
});

test("the files icon (SE §1.6) on the Agenda's rows and in the sheet: a camera and a film with their counts, muted with an up-arrow while sending, the warning colour for a problem, nothing without files; its label; a photo_drive_folders event moves it", { skip }, async () => {
  const E = await engine();
  const net = network();
  await open(E, "field", net);
  const f = (s) => folderOfE(E, E.rows.photo_shoots.find((x) => x.id === s.id));
  const parts = (p, v) => [p ? p + (p === 1 ? " photo" : " photos") : "", v ? v + (v === 1 ? " video" : " videos") : ""].filter(Boolean).join(" · ");
  const p1 = shootBy("A000T9", "progress-1"), lot = shootBy("A000T9", "lot-before"), bf = shootBy("A000T9", "before-framing");
  const permit = shootBy("A000T9", "permit-board"), p2 = shootBy("A000T9", "progress-2"), walk = shootBy("A000T9", "site-walk");
  const ic = (s) => iconOf(rowOf(s.id));
  // all in OneDrive
  assert.deepEqual([ic(p1).getAttribute("data-files"), ic(p1).getAttribute("role"), ic(p1).getAttribute("aria-label"), ic(p1).getAttribute("title")],
    ["ok", "img", parts(f(p1).photos, f(p1).videos) + " in OneDrive", parts(f(p1).photos, f(p1).videos) + " in OneDrive"]);
  assert.deepEqual(ic(p1).querySelectorAll(".sh-fi-n").map((n) => n.textContent), [String(f(p1).photos), String(f(p1).videos)]);
  assert.equal(ic(p1).querySelectorAll("svg").length, 2, "a camera and a film");
  assert.equal(ic(p1).querySelector(".sh-fi-up"), null);
  // still on their way: muted, the up-arrow, how many
  assert.equal(ic(lot).getAttribute("data-files"), "sending");
  assert.equal(ic(lot).getAttribute("aria-label"), parts(f(lot).photos, f(lot).videos) + " in OneDrive - 38 files not in OneDrive yet");
  assert.ok(ic(lot).querySelector(".sh-fi-up"));
  // a problem: the warning colour, "needs a look"
  assert.equal(ic(bf).getAttribute("data-files"), "problem");
  assert.equal(ic(bf).getAttribute("aria-label"), parts(f(bf).photos, f(bf).videos) + " in OneDrive - needs a look");
  // marketing's culls (step 1's review, round 3): A000T8's posted progress-1 lost 6 files in OneDrive after it went to
  // marketing - the database counts them missing; the shoot is on the Ready list, so the usual tone and no "needs a look"
  const culled = shootBy("A000T8", "progress-1");
  assert.deepEqual([f(culled).missing, f(culled).culled], [6, 6], "the demo's culled shoot");
  assert.deepEqual([ic(culled).getAttribute("data-files"), ic(culled).getAttribute("aria-label")], ["ok", parts(f(culled).photos, f(culled).videos) + " in OneDrive"]);
  // a folder gone - moved out of DCR Photo & Video, or deleted in OneDrive (drive_state): the warning colour, whatever
  // the rollup says (DCR Desktop 2's files_mark the same; its Files section says so too)
  for (const key of ["house-complete", "framing-complete"]) {
    const g = shootBy("A000T9", key);
    assert.ok(["missing", "trashed"].includes(f(g).drive_state), key);
    assert.deepEqual([ic(g).getAttribute("data-files"), ic(g).getAttribute("aria-label")], ["problem", parts(f(g).photos, f(g).videos) + " in OneDrive - needs a look"], key);
  }
  // a copy that recorded nothing yet, one that stopped with nothing: nothing; a shoot with no folder: nothing
  assert.equal(ic(permit), null);
  assert.equal(ic(p2), null);
  const bare = S.shoots.find((s) => !E.rows.photo_drive_folders.some((x) => x.shoot_id === s.id) && rowOf(s.id));
  assert.equal(ic(bare), null);
  // a done shoot in the folded Done & closed group has its icon too
  assert.equal(ic(walk).getAttribute("aria-label"), parts(f(walk).photos, f(walk).videos) + " in OneDrive");
  // the sheet: the same icon in its top row
  click('#shList [data-shoot="' + lot.id + '"]');
  const top = $("shDScroll").querySelector(".sh-dtop .sh-fi");
  assert.equal(top.getAttribute("aria-label"), ic(lot).getAttribute("aria-label"));
  const tops = $("shDScroll").querySelector(".sh-dtop").children;
  assert.deepEqual([tops[0].getAttribute("class").split(" ")[0], tops[1].getAttribute("class").split(" ")[0]], ["sh-chip", "sh-fi"], "beside the status (SE §1.6)");
  // the culled shoot's sheet: the usual tone there too (round 3)
  click('#shList [data-shoot="' + culled.id + '"]');
  assert.deepEqual([$("shDScroll").querySelector(".sh-dtop .sh-fi").getAttribute("data-files"), $("shDScroll").querySelector(".sh-dtop .sh-fi").getAttribute("aria-label")],
    ["ok", ic(culled).getAttribute("aria-label")]);
  // By job's rows too
  click('#shViews [data-view="job"]');
  assert.equal(iconOf(document.querySelector('#shPlan' + planBy("A000T9").id + ' [data-shoot="' + p1.id + '"]')).getAttribute("data-files"), "ok");
  click('#shViews [data-view="agenda"]');
  // the rollup moves (a photo_drive_folders event): read again, drawn
  const row = E.rows.photo_drive_folders.find((x) => x.id === f(p1).id);
  row.photos += 3;
  row.counted += 5;
  row.confirmed += 3;
  row.waiting = 2;
  E.rows.photo_shoot_uploads.filter((u) => u.folder_id === row.id).forEach((u) => { u.state = "sealed"; });
  await page._test.onFilesWatch({ tables: ["photo_drive_folders"], join: false });
  await S.rollRead;
  assert.equal(ic(p1).getAttribute("aria-label"), parts(row.photos, row.videos) + " in OneDrive - 2 files not in OneDrive yet");
  assert.equal(ic(p1).getAttribute("data-files"), "sending");
  // none in OneDrive yet but some on their way: the up-arrow alone. Within 2 s of the last read: read once when they
  // are up, for every event meanwhile (a hand-in confirms file after file - SE §1.6)
  const pf = E.rows.photo_drive_folders.find((x) => x.id === f(permit).id);
  pf.counted = 41;
  pf.waiting = 41;
  const reads = () => S.rollAsk;
  const r0 = reads();
  for (let i = 0; i < 5; i++) await page._test.onFilesWatch({ tables: ["photo_drive_folders"], join: false });
  assert.equal(ic(permit), null, "not read again yet");
  await until(() => ic(permit), 4000, "read again once the 2 s are up");
  assert.equal(reads() - r0, 1, "one read for the five events");
  assert.equal(ic(permit).getAttribute("aria-label"), "41 files not in OneDrive yet");
  assert.equal(ic(permit).querySelectorAll("svg").length, 0);
  assert.ok(ic(permit).querySelector(".sh-fi-up"));
  // another table's event (a hand-in's beat) leaves the rollups alone
  await new Promise((r) => setTimeout(r, 2100));
  row.photos += 1;
  await page._test.onFilesWatch({ tables: ["photo_shoot_uploads"], join: false });
  assert.equal(ic(p1).getAttribute("aria-label"), parts(row.photos - 1, row.videos) + " in OneDrive - 2 files not in OneDrive yet");
  // a schedule read reads them too
  await page._test.load({ quiet: true });
  await S.side;
  assert.equal(ic(p1).getAttribute("aria-label"), parts(row.photos, row.videos) + " in OneDrive - 2 files not in OneDrive yet");
  // a second copy given up (abandoned stays copying until someone acts) with nothing waiting: the usual tone, no arrow,
  // no words for one (step 1's review, round 3: DCR Desktop 2's files_mark)
  const drone = shootBy("A000T9", "drone-check");
  const df = E.rows.photo_drive_folders.find((x) => x.id === f(drone).id);
  const before = ic(drone).getAttribute("aria-label");
  E.rows.photo_shoot_uploads.push(Object.assign({}, E.rows.photo_shoot_uploads.find((u) => u.folder_id === df.id), { id: 99001, state: "abandoned", sealed_at: null }));
  await page._test.load({ quiet: true });
  await S.side;
  assert.equal(S.rolls[drone.id].state, "copying", "the rollup says copying");
  assert.deepEqual([ic(drone).getAttribute("data-files"), ic(drone).getAttribute("aria-label"), !!ic(drone).querySelector(".sh-fi-up")],
    ["ok", before, false]);
  assert.equal(before, parts(df.photos, df.videos) + " in OneDrive");
  // a shoot going off the Ready list (a photo_marketing event, step 1's review round 3): its culls are the photographer's
  // again - the icons read again for it, the warning colour; back on the list, the usual tone
  const mk = E.rows.photo_marketing.find((m) => m.shoot_id === culled.id);
  await new Promise((r) => setTimeout(r, 2100));
  mk.state = "withdrawn";
  await page._test.onFilesWatch({ tables: ["photo_marketing"], join: false });
  await S.rollRead;
  assert.equal(ic(culled).getAttribute("data-files"), "problem", "withdrawn: needs a look");
  await new Promise((r) => setTimeout(r, 2100));
  mk.state = "posted";
  await page._test.onFilesWatch({ tables: ["photo_marketing"], join: false });
  await S.rollRead;
  assert.equal(ic(culled).getAttribute("data-files"), "ok", "back on the list");
  page._test.stop();
});

const partsOf = (p, v) => [p ? p + (p === 1 ? " photo" : " photos") : "", v ? v + (v === 1 ? " video" : " videos") : ""].filter(Boolean).join(" · ");

test("the open shoot sheet's icon follows a rollup read the 2 s wait put off (step 1's review, round 1): the burst's last event lands inside the 2 s and its own redraw of the sheet still has the old rollups - once the read is done the sheet says what the row says", { skip }, async () => {
  const E = await engine();
  const net = network();
  await open(E, "field", net);
  const p1 = shootBy("A000T9", "progress-1");
  const row = folderOfE(E, E.rows.photo_shoots.find((x) => x.id === p1.id));
  const listIcon = () => iconOf(rowOf(p1.id));
  const sheetIcon = () => $("shDScroll").querySelector(".sh-dtop .sh-fi");
  click('#shList [data-shoot="' + p1.id + '"]');
  assert.equal(sheetIcon().getAttribute("aria-label"), listIcon().getAttribute("aria-label"));
  // a hand-in on its way: 4 more files counted, 1 in OneDrive - the first event is read at once
  E.rows.photo_shoot_uploads.filter((u) => u.folder_id === row.id).forEach((u) => { u.state = "sealed"; });
  row.counted += 4;
  row.confirmed += 1;
  row.photos += 1;
  row.waiting = 3;
  await page._test.onFilesWatch({ tables: ["photo_drive_folders"], join: false });
  await S.rollRead;
  const sending = partsOf(row.photos, row.videos) + " in OneDrive - 3 files not in OneDrive yet";
  assert.deepEqual([listIcon().getAttribute("aria-label"), sheetIcon().getAttribute("aria-label"), sheetIcon().getAttribute("data-files")], [sending, sending, "sending"]);
  // the other 3 confirm a moment later, inside the 2 s: read once the 2 s are up, the event's own redraw of the sheet
  // (its Files section) drawn with the rollups it had
  row.confirmed += 3;
  row.photos += 3;
  row.waiting = 0;
  await page._test.onFilesWatch({ tables: ["photo_drive_folders"], join: false });
  assert.equal(sheetIcon().getAttribute("aria-label"), sending, "not read again yet");
  const done = partsOf(row.photos, row.videos) + " in OneDrive";
  await until(() => listIcon().getAttribute("aria-label") === done, 4000, "the row, once the 2 s are up");
  assert.deepEqual([sheetIcon().getAttribute("aria-label"), sheetIcon().getAttribute("title"), sheetIcon().getAttribute("data-files")],
    [done, done, listIcon().getAttribute("data-files")], "the sheet says what the row says");
  assert.equal(sheetIcon().querySelector(".sh-fi-up"), null, "no up-arrow: all in");
  page._test.stop();
});

/** The client with photo_drive_folders' reads held back while h.on (a weak signal on site): each read answers what the
    table held when it was asked, once let go (h.list[i].go()). */
function holding(c) {
  const h = { on: false, list: [] };
  h.client = Object.assign({}, c, { from: (t) => {
    if (t !== "photo_drive_folders" || !h.on) return c.from(t);
    let q = c.from(t);
    const chain = {};
    for (const m of ["select", "eq", "is", "in"]) chain[m] = (...a) => { q = q[m](...a); return chain; };
    chain.then = (ok, bad) => {
      const one = { asked: false };
      const answer = Promise.resolve(q).then((r) => { one.asked = true; return r; });
      const gate = new Promise((r) => { one.go = r; });
      h.list.push(one);
      return gate.then(() => answer).then(ok, bad);
    };
    return chain;
  } });
  return h;
}

test("rollup reads that overlap (a read over 2 s on a weak signal; step 1's review, round 1): the newest question wins whatever order the answers land in - an older answer landing first never drops the newer one, an older one landing last never puts back older counts, and a schedule read already on its way never drops a newer re-read", { skip }, async () => {
  const E = await engine();
  const net = network();
  const who = await open(E, "field", net);
  const h = holding(wrapClient(clientAs(E, who.id), net));
  useClient(h.client);
  const p1 = shootBy("A000T9", "progress-1");
  const row = folderOfE(E, E.rows.photo_shoots.find((x) => x.id === p1.id));
  const label = () => iconOf(rowOf(p1.id)).getAttribute("aria-label");
  const now = () => partsOf(row.photos, row.videos) + " in OneDrive";
  const asked = async (n) => { await until(() => h.list.length === n && h.list[n - 1].asked, 4000, "read " + n + " asked"); return h.list[n - 1]; };
  const more = (k) => { row.photos += k; row.counted += k; row.confirmed += k; return now(); };
  h.on = true;
  // the older read (the 2 s timer's) is asked, the files move on, a newer read (an event's) is asked
  const l1 = more(2);
  const older = page._test.rereadRolls();
  const a = await asked(1);
  const l2 = more(3);
  const newer = page._test.rereadRolls();
  const b = await asked(2);
  // the older answer lands first, then the newer: the newer is taken
  a.go();
  await older;
  assert.equal(label(), l1);
  b.go();
  await newer;
  assert.equal(label(), l2, "the newer answer, although an older one landed first");
  // the newer lands first, the older last: the older is let go
  more(1);
  const older2 = page._test.rereadRolls();
  const c = await asked(3);
  const l4 = more(1);
  const newer2 = page._test.rereadRolls();
  const d = await asked(4);
  d.go();
  await newer2;
  assert.equal(label(), l4);
  c.go();
  await older2;
  assert.equal(label(), l4, "an older answer never puts back older counts");
  // a schedule read on its way, then a newer re-read: both land, the newer counts stay
  const l5 = more(2);
  const loading = page._test.load({ quiet: true });
  const e = await asked(5);
  const l6 = more(2);
  const newer3 = page._test.rereadRolls();
  const f = await asked(6);
  e.go();
  await loading;
  await S.side;
  assert.equal(label(), l5, "the schedule read's");
  f.go();
  await newer3;
  assert.equal(label(), l6, "the re-read asked after it");
  h.on = false;
  page._test.stop();
});

test("not readable: a reader the RLS hides the folders from sees no icon; one the projects read fails for sees no place - the schedule is drawn as before; a read that fails later keeps what the page had; a database without the photo files: no icon", { skip }, async () => {
  const E = await engine();
  const net = network();
  // the folders hidden (RLS: no rows) and the projects refused
  await open(E, "field", net, { from: { photo_drive_folders: () => answer({ data: [], error: null }), projects: () => answer({ data: null, error: { code: "42501", message: "permission denied" } }) } });
  assert.ok(S.loaded && S.plans.length && document.querySelectorAll("#shList .sh-row").length > 5, "the schedule as before");
  assert.equal(document.querySelectorAll(".sh-fi").length, 0, "no icon");
  assert.deepEqual(S.places, {});
  const s = shootBy("A000T9", "drone-check");
  click('#shList [data-shoot="' + s.id + '"]');
  assert.equal($("shDScroll").querySelector(".sh-place"), null, "no place");
  assert.equal(net.calls.length, 0, "no picture asked for");
  // read fine, then a read of them that fails: what the page had stays
  await open(E, "field", net);
  const had = Object.keys(S.places).length;
  assert.equal(had, 4);
  const icons = document.querySelectorAll(".sh-fi").length;
  assert.ok(icons > 3);
  useClient(wrapClient(clientAs(E, (await person("field")).id), net, { from: { projects: () => answer({ data: null, error: { code: "57014", message: "timeout" } }),
    photo_drive_folders: () => answer({ data: null, error: { code: "57014", message: "timeout" } }) } }));
  await page._test.load({ quiet: true });
  await S.side;
  assert.deepEqual([Object.keys(S.places).length, document.querySelectorAll(".sh-fi").length], [had, icons]);
  // a database without the photo files: no icon, the page as P3
  E.exts.find((x) => x.name === "p10-photo-files").__dev.state({ p5: false });
  await open(E, "field", net);
  assert.equal(document.querySelectorAll(".sh-fi").length, 0);
  assert.ok(Object.keys(S.places).length === 4, "the place still shows");
});

/** a query that never answers (a request stalled on a weak signal: supabase-js has no time-out) */
function never() {
  const q = { then: () => new Promise(() => {}) };
  for (const m of ["select", "eq", "is", "in", "order", "neq", "limit"]) q[m] = () => q;
  return q;
}
const within = (p, ms) => Promise.race([p.then(() => "answered"), new Promise((r) => setTimeout(() => r("still waiting"), ms))]);

test("places and rollups that never answer (a request stalled on a weak signal; step 1's review, round 2): the schedule is drawn and the open shoot's Files section too; a photo_drive_folders event's Files and Ready reads and a watch's schedule read go on - none waits on them; once the signal is back the place and the icon show", { skip }, async () => {
  const E = await engine();
  const net = network();
  page._test.reset();
  document.body.innerHTML = BODY;
  toasts.length = 0;
  repo.useKeyStore(null);
  page._test.picDeps(net.parts);
  const p = await person("field");
  const asked = { projects: 0, photo_drive_folders: 0 };
  const hang = (t) => () => { asked[t] += 1; return never(); };
  useClient(wrapClient(clientAs(E, p.id), net, { from: { projects: hang("projects"), photo_drive_folders: hang("photo_drive_folders") } }));
  const id = shootOfE(E, "A000T9", "lot-before").id;
  const me = { id: p.id, name: p.name, role: p.role, active: true };
  assert.equal(await within(page.init(me, { search: "?shoot=" + id, watch: false }), 3000), "answered", "the first draw never waits on them");
  assert.deepEqual([asked.projects >= 1, asked.photo_drive_folders >= 1], [true, true], "both were asked");
  assert.ok(S.loaded && document.querySelectorAll("#shList .sh-row").length > 5, "the schedule is drawn");
  const fl = () => $("shDScroll").querySelector(".sh-files .sh-fl");
  await until(() => fl(), 4000, "the open shoot's Files section");
  assert.equal($("shDScroll").querySelector(".sh-place"), null, "no place yet");
  assert.equal(document.querySelectorAll(".sh-fi").length, 0, "no icon yet");
  // the folder's files all land: its event re-reads the rollups (they hang) - the Files section is read again at once
  const f = folderOfE(E, E.rows.photo_shoots.find((x) => x.id === id));
  f.waiting = 0;
  f.confirmed = f.counted;
  const before = asked.photo_drive_folders;
  assert.equal(await within(page._test.onFilesWatch({ tables: ["photo_drive_folders"], join: false }), 3000), "answered", "the event's reads never wait on the rollup read");
  assert.equal(asked.photo_drive_folders, before + 1, "the rollups were asked again");
  assert.equal(fl().getAttribute("data-line"), "confirmed", "the Files section read again");
  assert.equal(await within(page._test.onFilesWatch({ tables: ["photo_marketing"], join: false }), 3000), "answered", "and the next event goes on");
  // a watch's schedule read: drawn, its places and rollups asked again (they hang too)
  assert.equal(await within(page._test.load({ quiet: true }), 3000), "answered", "a schedule read never waits on them");
  assert.ok(asked.projects >= 2);
  // the signal is back: the next read answers - the place and the icon show
  useClient(wrapClient(clientAs(E, p.id), net));
  await page._test.load({ quiet: true });
  await S.side;
  assert.ok($("shDScroll").querySelector(".sh-place a.sh-addr"), "the place");
  assert.ok($("shDScroll").querySelector(".sh-dtop .sh-fi") && iconOf(rowOf(id)), "the icon, in the sheet and on its row");
  page._test.stop();
});

test("marketing reads the place and the icon too (SE §1.1: everyone who sees the schedule); the address as text through the money masks, no element from the data", { skip }, async () => {
  const E = await engine();
  const net = network();
  const t9 = E.rows.projects.find((p) => p.id === planOfE(E, "A000T9").project_id);
  t9.address = street("Sampleton", "Avenue") + " " + EVIL + " $1,200";
  t9.city = "Sandbox " + EVIL;
  await open(E, "viewer", net, { search: "?view=agenda" });          // (marketing alone opens on Ready for marketing)
  const s = shootBy("A000T9", "progress-1");
  assert.ok(iconOf(rowOf(s.id)), "marketing sees the icon");
  click('#shList [data-shoot="' + s.id + '"]');
  await until(() => imgs($("shDScroll")).length, 4000, "the picture");
  const a = $("shDScroll").querySelector(".sh-addr");
  assert.ok(a.textContent.includes(EVIL), "the markup is shown as text");
  assert.ok(!/\$\s?\d|1,200/.test(a.textContent), "the amount is masked");
  assert.ok(!/\$\s?\d|1,200/.test(decodeURIComponent(a.getAttribute("href"))), "and so is the Maps query");
  const bad = scan(document.body);
  const own = imgs().filter((i) => /^blob:test\//.test(i.getAttribute("src")) && i.getAttribute("alt") === V.PICTURE_TEXT).length;
  assert.deepEqual(bad.filter((x) => x !== "img"), [], "no handler, no javascript: link");
  assert.equal(bad.filter((x) => x === "img").length, own, "the only img is the job's picture");
  click('#shViews [data-view="job"]');
  assert.ok($("shPlan" + planBy("A000T9").id).querySelector(".sh-plan-addr").textContent.includes(EVIL));
  assert.deepEqual(scan(document.body).filter((x) => x !== "img"), []);
});

test("the place's and the icon's files hold no real-looking street: every one built at run time (the widened scan)", () => {
  for (const rel of ["site/js/map/shoots.js", "site/js/pages/shoots.js", "site/js/shoot-pictures.js", "site/js/repo/projects.js", "site/js/repo/photo-files.js",
    "site/css/shoots.css", "site/shoots.html", "site/sw.js", "tools/fake/p10-photo.js", "tools/fake/p10-photo-files.js", "tests/p10-photo-place.test.mjs"]) {
    const src = readFileSync(new URL("../" + rel, import.meta.url), "utf8");
    const hit = src.match(STREET);
    assert.equal(hit, null, rel + ": " + (hit && hit[0]));
    assert.deepEqual(find(src).filter((h) => h.kind === "street"), [], rel);
  }
  assert.ok(!STREET.test(T9_STREET) && !STREET.test(T8_STREET), "the made-up places are plainly made up");
});
