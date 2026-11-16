// The phone's hand-in on the demo database and the shoot sheet (the photographer screen program, P5, the OneDrive
// edition; DCR Desktop 2 docs/PHOTO-FILES-ONEDRIVE.md §3.3, §3.5, §4.5, §5.6, §10.2, §10.6, cited OD; the build plan's
// P5 and P7): site/js/photo-send.js over tools/fake/p10-photo-files.js - the phone's RPCs (photo_upload_begin with
// p_source 'phone', photo_upload_files with NO hash and files[] by i, photo_upload_beat, photo_upload_seal,
// photo_upload_cancel, photo_shoot_files_page) and the photo-files stand-in's sessions / done / find - with every chunk
// PUT to tools/fake/p7-onedrive.js's demo upload address (the same 202 / 201 / 404 / 507 answers; OneDrive's own
// quickXorHash of the bytes that landed), and then the page (site/js/pages/shoots.js with pages/shoots-files.js) DRIVEN
// in node over it: [Add photos and videos] only with can.add_from_phone, the file in flight's progress, [Hand in what's
// there] / [Cancel it] while it sends (no separate Stop), the stopped-on-this-phone choices after a reload (Pick the rest
// again, Hand in what's there, Cancel it; not_checked_phone's Pick them again / Hand in without them), another device's
// stopped phone hand-in, no second hand-in while one sends, queued, and the Ready card's Open in OneDrive once the
// phone's files went to marketing. The OneDrive review's round 1 (OD §19): Cancel it and Hand in what's there ASK first,
// Keep it focused (a stray tap on site never ends the hand-in); the phone's file a check sent back after its seal
// (resend_phone) is picked again and sent by the next hand-in; a gone job folder holds a new shoot (job_moved_out). The
// round 2 (OD §20): a pick of only files still waiting elsewhere cancels the hand-in it began again; the demo's recopied
// keeps what a cancel puts back; a phone's record asked again after a lost answer is the same row. The round 3 (OD
// §21): Hand in what's there only once a file of the hand-in is in OneDrive (this page's, a reloaded phone's own by its
// sent_files) - never "Hand in the 0 files…"; queued never over a lost or paused beat, nor a fresh outbox_away; a done shoot under
// a gone job folder reads job_folder_no_hand_in. The round 4 (OD §22): this phone's own stopped line's twin by {done};
// queued over a stale outbox_away beat, and a stored waiting_turn read queued / sending; the demo's cancel puts a
// recopied row back as it was and answers removed_sent and put_back_ids - the page's Cancel it never asks the office to
// delete a put back file. The round 5 (OD §23): the demo's cancel gives a recopied row back by the ONE put back rule
// (with an item read by id at the check the cancel brings - never confirmed unread, never Ready before that read; an
// item of other bytes let go; missing again; else to send at its earlier step) and its removed_sent counts every removed
// row whose bytes may be in OneDrive - so another device's Cancel it counts a file whose session was handed out; the
// demo's help lost ("Memory card needed"); waiting_turn never moves an open hand-in's running clock. The round 6 (OD
// §24): the put back's rule 0 (a row to be sent again over its item back at that step, with its pending Replace - the
// row's own bytes recorded again with a session made read by id instead) and rule 4 (past sending, its item gone: its
// earlier item back, read by id), a row left out meanwhile stays removed, one kept with OneDrive's copy keeps that
// verdict, photo_shoot_files_removed_shape held; sessions answers a committed row found with its item; an open PC
// hand-in's running clock moves only with its progress. Made-up people, shoots, bytes and addresses only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as common2 from "../site/js/common2.js";
import { makeDom } from "./console/console-page-dom.mjs";
import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as repo from "../site/js/repo/photo.js";
import * as R from "../site/js/repo/photo-files.js";
import * as P from "../site/js/photo-send.js";
import { WORDS } from "../site/js/map/photo-words.js";
import { linkOk, fill } from "../site/js/map/photo-files.js";
import * as F from "../site/js/map/photo-files.js";
import { phoneButtons } from "../site/js/pages/shoots-files.js";

const skip = !available && "the demo database (tools/fake) is not here";
const HTML = readFileSync(new URL("../site/shoots.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const BODY = /<body>([\s\S]*)<\/body>/.exec(HTML)[1].replace(/<script[\s\S]*?<\/script>/g, "");
const U = 327680;

globalThis.Node = globalThis.Node || class { static [Symbol.hasInstance](x) { return !!x && typeof x.nodeType === "number"; } };
const toasts = [];
const DCR2 = Object.assign({}, common2.DCR2, { toast: (t, k) => { toasts.push([String(t), k]); }, confirm: async () => true });
const listeners = new Map();
globalThis.window = { DCR2, __SH_TEST__: true, matchMedia: null, location: { search: "", reload() {} },
  history: { state: null, replaceState() {}, pushState() {}, back() {} },
  addEventListener(t, f) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); },
  removeEventListener(t, f) { if (listeners.has(t)) listeners.get(t).delete(f); } };
globalThis.document = makeDom("<!doctype html><html><head></head><body>" + BODY + "</body></html>");
const page = await import("../site/js/pages/shoots.js");
const S = page._test.state;

const tick = () => new Promise((r) => setTimeout(r, 5));
async function until(fn, ms, what) {
  const end = Date.now() + (ms || 6000);
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error("timed out: " + (typeof what === "function" ? what() : what || fn.toString().slice(0, 120))); await tick(); }
}
const $ = (id) => document.getElementById(id);
const text = (id) => ($(id) ? $(id).textContent : "");
const dev = (E) => E.exts.find((x) => x.name === "p10-photo-files").__dev;
const od = (E) => E.exts.find((x) => x.name === "p7-onedrive");
const lines = () => document.querySelectorAll("#shDScroll .sh-fl").map((n) => n.getAttribute("data-line"));
const acts = () => document.querySelectorAll("#shDScroll .sh-facts-b [data-act]").map((n) => n.getAttribute("data-act"));
const press = (act) => document.querySelector('#shDScroll [data-act="' + act + '"]').click();
/** The phone's ask (OD §3.3 step 8): its words, the button that does it, and Keep it - which has the focus. */
function askNow() {
  const mo = $("shMo");
  if (!mo) return null;
  const keep = document.querySelector('#shMo .sh-mo-ft [data-act="mv-close"]');
  const ask = document.querySelector("#shMo [data-ask]");
  return { code: ask && ask.getAttribute("data-ask"), text: ask ? ask.textContent : "", apply: $("mvApply").textContent, keep: keep.textContent,
    focused: document.activeElement === keep };
}

/* ── made-up files, the transport to the demo's upload address, the phone's parts ── */

function lcg(n, seed) {
  const out = new Uint8Array(n);
  let x = seed >>> 0;
  for (let k = 0; k < n; k++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; out[k] = (x >>> 16) & 255; }
  return out;
}
class PickedFile {
  constructor(name, size, seed) {
    this.name = name; this.size = size; this.bytes = lcg(size, seed); this.lastModified = Date.UTC(2026, 10, 12, 18, 0, 0); this.type = "";
  }
  slice(a, b) { const part = this.bytes.slice(a, b); return { size: part.length, arrayBuffer: async () => part.buffer.slice(part.byteOffset, part.byteOffset + part.length) }; }
}
const qx = (f) => globalThis.DCR2QuickXor.quickXorHash(f.bytes);

/** xhrTransport() as the demo answers it: every request to the OneDrive host goes to tools/fake/p7-onedrive.js's http()
    (a hook may drop one - no connection - or lose its answer: it reached OneDrive, its answer never came back). */
function demoTransport(E, hook) {
  return async (req) => {
    await tick();
    const h = hook && hook.fn ? hook.fn(req) : undefined;
    if (h === "drop") throw Object.assign(new Error("No connection"), { code: "offline" });
    const r = od(E).http(req.method, req.url, req.headers || {}, req.body);
    if (!r || h === "lose") throw Object.assign(new Error("No connection"), { code: "offline" });
    const headers = r.headers || {};
    return { status: r.status, header: (n) => headers[String(n).toLowerCase()] ?? null, text: () => (typeof r.body === "string" ? r.body : "") };
  };
}
function memoryStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => m.delete(k) };
}
const fastParts = (E, storage, hook) => ({ transport: demoTransport(E, hook), hasher: P.createHasher({ worker: null }), storage,
  uploader: { wait: () => 1, maxTries: 3 }, ms: { beat: 40, again: 40, pause: 60, waits: [1] } });

async function engine(o) {
  const E = await freshEngine(new Date());
  E.exts.find((x) => x.name === "p10-photo").__dev.pc.state({ auto: false });
  dev(E).state(Object.assign({ phone: true }, o || {}));
  return E;
}
/** A planned shoot of the demo with no folder yet (none_add_phone; the made-up plan A000T6's). */
function bareShoot(E, n) {
  const list = E.rows.photo_shoots.filter((s) => s.status === "planned" && !E.rows.photo_drive_folders.some((f) => f.shoot_id === s.id));
  assert.ok(list.length > (n || 0), "a shoot without files");
  return list[n || 0];
}
async function open(E, key, search, storage, hook) {
  page._test.reset();
  page._test.phoneDeps(fastParts(E, storage || memoryStorage(), hook));
  document.body.innerHTML = BODY;
  toasts.length = 0;
  repo.useKeyStore(null);
  const p = await person(key);
  useClient(clientAs(E, p.id));
  await page.init({ id: p.id, name: p.name, role: p.role, active: true }, { search: search || "", watch: false });
  return p;
}
const filesRead = (id) => until(() => S.files[id] && S.files[id].st !== undefined && !S.files[id].busy, 6000, "the files of shoot " + id);

/* ── the demo database's phone hand-in, through js/photo-send.js ── */

test("the demo's phone hand-in end to end (OD §3.3, §5.6): begin with p_source 'phone' (the switch, the device row fixed by its key), files with NO hash and their ids by i, sessions on the demo upload address, chunks PUT straight to it, done with the hash computed while sending - OneDrive's own hash of what landed equal - and the seal; the rows, the counts and the status", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  const field = await person("field");
  useClient(clientAs(E, field.id));
  const storage = memoryStorage();
  const ps = P.createPhoneSend(Object.assign(fastParts(E, storage), { by: "Jordan", document: null, window: null, navigator: { userAgent: "Mozilla/5.0 (iPhone)" } }));
  const a = new PickedFile("IMG_0001.HEIC", 3 * U + 17, 1), b = new PickedFile("C0001.MOV", 6 * U + 5, 2), c = new PickedFile("notes.txt", 40, 3);
  const p = await ps.plan(s.id, [a, b, c]);
  assert.equal(p.notMedia, 1, "a text file is left out (copy.not_media)");
  await ps.start(p);
  await until(() => ps.view().phase === "sealed", 8000, "sealed");
  const rows = dev(E).files(s.id);
  assert.deepEqual(rows.map((r) => [r.path, r.size, r.md5, r.state, r.counted]), [
    ["Phone/IMG_0001.HEIC", a.size, qx(a), "confirmed", true], ["Phone/C0001.MOV", b.size, qx(b), "confirmed", true]]);
  const items = dev(E).items(s.id);
  assert.deepEqual(items.map((x) => [x.path, x.size, x.qx]), [["Phone/IMG_0001.HEIC", a.size, qx(a)], ["Phone/C0001.MOV", b.size, qx(b)]],
    "OneDrive's own hash of the bytes that landed");
  const up = dev(E).uploads(s.id)[0];
  assert.deepEqual([up.source, up.state, up.pc_label, up.pc_id, up.files], ["phone", "sealed", "iPhone", dev(E).deviceId(JSON.parse(storage.m.get(P.STORE_KEY)).device_key), 2]);
  const st = await R.status(s.id);
  assert.equal(st.files.state, "confirmed");
  assert.deepEqual([st.files.counted, st.files.confirmed, st.files.to_send, st.files.committed], [2, 2, 0, 0]);
  assert.equal(st.folder.drive_state, "found", "the folders were made by sessions");
  assert.ok(linkOk(st.folder.link), "Open in OneDrive's link is OneDrive's shape");
  assert.equal(st.completion, "not_done", "the files are in OneDrive - mark the shoot done");
  // photo_shoot_files_page: the rows, never an item id
  const page1 = await R.rows(s.id);
  assert.deepEqual(page1.map((r) => [r.path, r.md5, r.counted]), [["Phone/IMG_0001.HEIC", qx(a), true], ["Phone/C0001.MOV", qx(b), true]]);
  assert.ok(!JSON.stringify(page1).includes(items[0].item_id));
  // a second pick of the same files: hashed, then skipped (copy.skipped_same) - nothing sent, no hand-in opened
  const before = E.rows.photo_shoot_uploads.length;
  const again = await ps.plan(s.id, [new PickedFile("IMG_0001.HEIC", 3 * U + 17, 1)]);
  assert.equal(again.skipped, 1);
  await ps.start(again);
  assert.equal(E.rows.photo_shoot_uploads.length, before, "nothing new to send: no hand-in");
  await ps.dispose();
});

test("the demo's refusals as the migration's: phone_off while the phone switch is off, uploads_off / uploads_test before a session (503 for the whole call), not_this_device for another phone's key, the seal's count_mismatch and empty", { skip }, async () => {
  const E = await engine({ phone: false });
  const s = bareShoot(E);
  const field = await person("field");
  useClient(clientAs(E, field.id));
  const key = "pk_" + "Q".repeat(22);
  await assert.rejects(R.begin(s.id, { clientKey: "CLIENTKEY_000000001", deviceKey: key, label: "iPhone" }), (e) => e.hint === "phone_off");
  dev(E).state({ phone: true });
  const b = await R.begin(s.id, { clientKey: "CLIENTKEY_000000001", deviceKey: key, label: "iPhone" });
  assert.equal(b.upload.source, "phone");
  assert.equal(b.upload.device_id, dev(E).deviceId(key));
  const rec = await R.record(b.upload.id, [{ path: "Phone/IMG_0001.JPG", size: 1000 }, { path: "Phone/bad?.JPG", size: 10 }]);
  assert.deepEqual(rec.refused.map((x) => [x.i, x.code]), [[1, "bad_char"]]);
  const id = rec.byIndex[0].file_id;
  assert.deepEqual([rec.byIndex[0].verdict, rec.byIndex[0].send], ["added", true]);
  await assert.rejects(R.sessions(b.upload.id, "pk_" + "Z".repeat(22), [{ file_id: id }]).then((a) => { if (a.files[0].code === "not_this_device") throw Object.assign(new Error("x"), { code: "not_this_device" }); }),
    (e) => e.code === "not_this_device");
  await assert.rejects(R.find(b.upload.id, "pk_" + "Z".repeat(22), id), (e) => e.code === "not_this_device" && e.status === 403);
  dev(E).state({ mode: "off" });
  await assert.rejects(R.sessions(b.upload.id, key, [{ file_id: id }]), (e) => e.code === "uploads_off" && e.status === 503);
  dev(E).state({ mode: "only:A267" });
  await assert.rejects(R.sessions(b.upload.id, key, [{ file_id: id }]), (e) => e.code === "uploads_test" && e.status === 503);
  // done, find, check run in every mode (OD §4.3)
  assert.equal(await R.find(b.upload.id, key, id), null);
  await assert.rejects(R.seal(b.upload.id, 0, 0), (e) => e.hint === "empty", "its one row has no hash: removed by the seal - nothing handed in");
  dev(E).state({ mode: "on" });
  // (an empty hand-in is cancelled instead - js/photo-send.js does; it was still open: a second one is open_elsewhere)
  await assert.rejects(R.begin(s.id, { clientKey: "CLIENTKEY_000000002", deviceKey: key, label: "iPhone" }), (e) => e.hint === "open_elsewhere");
  await R.cancel(b.upload.id);
  const b2 = await R.begin(s.id, { clientKey: "CLIENTKEY_000000002", deviceKey: key, label: "iPhone" });
  const rec2 = await R.record(b2.upload.id, [{ path: "Phone/IMG_0002.JPG", size: 1000, md5: "FAKEqx000000000000000000001=" }]);
  assert.equal(rec2.byIndex[0].send, true);
  // the beat's states as the migration's (OD §3.1, review round 1: outbox_away, a PC's outbox disk away), a made-up one refused
  assert.equal((await R.beat(b2.upload.id, { state: "outbox_away", bytesSent: 0, sentFiles: 0 })).upload.send_state, "outbox_away");
  await assert.rejects(R.beat(b2.upload.id, { state: "away", bytesSent: 0, sentFiles: 0 }), (e) => e.hint === "bad_state");
  await assert.rejects(R.seal(b2.upload.id, 2, 2000), (e) => e.hint === "count_mismatch" && e.detail && e.detail.files === 1);
});

test("the demo's OneDrive: OneDrive full answers a file's LAST chunk 507 - the phone stops that job at once, says so and sends it again from byte 0 once there is room; a hash OneDrive has not made yet reads checking, and the next check confirms it", { skip }, async () => {
  const E = await engine({ full: true });
  const s = bareShoot(E);
  const field = await person("field");
  useClient(clientAs(E, field.id));
  const puts = [];
  const hook = { fn: (req) => { if (req.method === "PUT") puts.push(req.headers["Content-Range"]); return undefined; } };
  const ps = P.createPhoneSend(Object.assign(fastParts(E, memoryStorage(), hook), { by: "Jordan", document: null, window: null }));
  const f = new PickedFile("C0002.MOV", 3 * U + 9, 7);
  await ps.start(await ps.plan(s.id, [f]));
  await until(() => ps.view().lines.some((l) => l.code === "full"), 6000, "OneDrive full");
  assert.ok(puts.some((r) => r.endsWith("-" + (f.size - 1) + "/" + f.size)), "it reached the last chunk");
  assert.equal(dev(E).items(s.id).length, 0, "nothing committed");
  const firsts = () => puts.filter((r) => r.startsWith("bytes 0-")).length;
  assert.equal(firsts(), 1);
  dev(E).state({ full: false, hashLate: true });
  await until(() => ps.view().phase === "sealed", 8000, "sealed once there is room");
  assert.equal(firsts(), 2, "sent again from byte 0 in a new session");
  const row = dev(E).files(s.id)[0];
  assert.deepEqual([row.state, row.upload_step, row.md5], ["waiting", "committed", qx(f)], "in OneDrive, its hash not there yet: checking");
  assert.equal(ps.view().lines.at(-1).text, WORDS.files.checking_one);
  let st = await R.status(s.id);
  assert.deepEqual([st.files.state, st.files.committed], ["waiting", 1]);
  dev(E).hashNow();
  st = await R.check(s.id);
  assert.equal(st.files.state, "confirmed", "a check reads it by id: OneDrive's hash is the phone's");
  await ps.dispose();
});

test("the demo's sessions: an item of the row's name by DCR of its size that this row had a session for is found {item_id} (its last answer lost) - done with that item, no bytes; another file at the name is taken: the next free name (name_taken)", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  const field = await person("field");
  useClient(clientAs(E, field.id));
  const key = "pk_" + "F".repeat(22);
  const b = await R.begin(s.id, { clientKey: "CLIENTKEY_000000009", deviceKey: key, label: "iPhone" });
  const f = new PickedFile("IMG_0009.JPG", U + 3, 9);
  const rec = await R.record(b.upload.id, [{ path: "Phone/IMG_0009.JPG", size: f.size }]);
  const id = rec.byIndex[0].file_id;
  const a = await R.sessions(b.upload.id, key, [{ file_id: id }]);
  const url = a.files[0].upload_url;
  assert.ok(R.uploadUrlOk(url), "on the one OneDrive host the pages name");
  assert.equal(a.chunk_bytes, 16 * U, "a phone's chunk: 16 x 320 KiB");
  const send = demoTransport(E);
  const r1 = await send({ method: "PUT", url, headers: { "Content-Range": "bytes 0-" + (U - 1) + "/" + f.size }, body: f.bytes.slice(0, U).buffer });
  assert.equal(r1.status, 202);
  const r2 = await send({ method: "PUT", url, headers: { "Content-Range": "bytes " + U + "-" + (f.size - 1) + "/" + f.size }, body: f.bytes.slice(U).buffer });
  assert.equal(r2.status, 201);
  // (the 201's answer lost on the way:) find, or sessions again - found
  const item = await R.find(b.upload.id, key, id);
  assert.equal(item, JSON.parse(r2.text()).id);
  const again = await R.sessions(b.upload.id, key, [{ file_id: id }]);
  assert.deepEqual(again.files[0], { file_id: id, code: "found", item_id: item });
  const d = await R.done(b.upload.id, key, [{ file_id: id, item_id: item, md5: qx(f) }]);
  assert.deepEqual(d.items, [{ file_id: id, state: "confirmed" }]);
  // the done of an item another file made: not this upload, the row back to send ({file_id, code}, as handler.ts)
  const rec2 = await R.record(b.upload.id, [{ path: "Phone/IMG_0010.JPG", size: f.size }]);
  const id2 = rec2.byIndex[0].file_id;
  const d2 = await R.done(b.upload.id, key, [{ file_id: id2, item_id: item, md5: qx(f) }]);
  assert.deepEqual(d2.items, [{ file_id: id2, code: "not_this_upload" }]);
  // a file of another size already at the row's name in OneDrive: taken, the next free name
  E.rows.demo_photo_items.push({ id: 999, item_id: "01FAKEPHOTHER0001", folder_id: E.rows.photo_shoot_files.find((r) => r.id === id2).folder_id,
    path: "Phone/IMG_0010.JPG", size: 5, qx: null, later_qx: null, by_app: false, created_at: new Date().toISOString() });
  const moved = await R.sessions(b.upload.id, key, [{ file_id: id2 }]);
  assert.deepEqual([moved.files[0].code, moved.files[0].path], ["name_taken", "Phone/IMG_0010 (2).JPG"]);
});

/* ── the shoot sheet (P5) ── */

test("[Add photos and videos] only with can.add_from_phone (the phone switch, the mode, the root): picked and sent at once - the sending line with this page's counts, the file in flight's progress, Hand in what's there and Cancel it while it sends (no Stop); then the ✓ line once, and the button back", { skip }, async () => {
  const E = await engine({ phone: false });
  const s = bareShoot(E);
  await open(E, "field", "?shoot=" + s.id);
  await filesRead(s.id);
  assert.deepEqual(lines(), ["none_phone"], "phone uploads off: handed in from DCR Desktop");
  assert.ok(!acts().includes("files-add-phone"));
  dev(E).state({ phone: true });
  await page._test.readFiles(s.id);
  assert.deepEqual(lines(), ["none_add_phone"]);
  assert.deepEqual(acts(), ["files-add-phone"]);
  assert.equal(document.querySelector('#shDScroll [data-act="files-add-phone"]').textContent, WORDS.files_buttons.add_phone);
  // the picker: the page's own input (outside the redrawn sheet), photos and videos, HEIC named
  // the second file's chunks wait (no connection) until the test lets them go: the first file is in, the second in flight
  let held = true, puts = 0;
  const slow = { fn: (req) => (req.method === "PUT" && ++puts >= 3 && held ? "drop" : undefined) };
  // (the module the page made for Add photos and videos is made again with these parts)
  if (S.phone) { await S.phone.dispose(); S.phone = null; }
  page._test.phoneDeps(fastParts(E, memoryStorage(), slow));
  page._test.pickStart(s.id, false);
  const input = $("shPick");
  assert.ok(input && input.getAttribute("type") === "file" && input.getAttribute("accept") === P.ACCEPT && input.hasAttribute("multiple"));
  assert.ok(!$("shDScroll").contains(input), "outside the redrawn sheet");
  const a = new PickedFile("IMG_0101.HEIC", 20 * U + 1, 11), b = new PickedFile("IMG_0102.HEIC", 20 * U + 2, 12);
  const sent = page._test.pickFiles(s.id, [a, b], false);
  await until(() => lines()[0] === "sending_this_phone", 6000, "sending");
  assert.match(text("shDScroll"), /Sending \d of 2 files to OneDrive - keep this screen on and this page open until it's done\./);
  // nothing of it in OneDrive yet: Cancel it alone (OD §3.3 step 8, review round 3)
  if (page._test.phone().sending().sent === 0) assert.deepEqual(acts(), ["files-cancel", "files-check"], "nothing in OneDrive yet: no Hand in what's there");
  await until(() => page._test.phone().sending().sent === 1 && acts().includes("files-hand-in"), 6000, () => "the first file in: " + acts().join(", "));
  assert.deepEqual(acts(), ["files-hand-in", "files-cancel", "files-check"], "a file in OneDrive: Hand in what's there and Cancel it - no separate Stop");
  await until(() => document.querySelector("#shDScroll .sh-fprog"), 6000, "the file in flight");
  const prog = document.querySelector("#shDScroll .sh-fbar");
  assert.equal(document.querySelector("#shDScroll .sh-flines").childNodes.filter((n) => n.nodeType === 1)[1].getAttribute("class"), "sh-fprog",
    "the file in flight right under the line with the counts");
  assert.equal(prog.getAttribute("max"), "100");
  assert.match(document.querySelector("#shDScroll .sh-fprog-n").textContent, /^IMG_010[12]\.HEIC$/);
  held = false;
  await sent;
  await until(() => lines()[0] === "confirmed", 8000, "the ✓ line");
  assert.match(text("shDScroll"), /All 2 files are in OneDrive ✓ \(checked /);
  assert.equal(document.querySelectorAll("#shDScroll .sh-fl").filter((n) => /are in OneDrive ✓/.test(n.textContent)).length, 1, "said once");
  assert.ok(!document.querySelector("#shDScroll .sh-fprog"), "nothing in flight");
  assert.deepEqual(acts(), ["files-add-phone", "files-check"], "more can be added; Check again");
  assert.ok(toasts.every((t) => !/error/i.test(t[0])), JSON.stringify(toasts));
});

test("a big video says first that big videos go best from DCR Desktop (copy.big_phone, 6.2 GB: about 20 minutes); a pick that is not a photo or video says so (copy.not_media) and nothing is opened", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  await open(E, "field", "?shoot=" + s.id);
  await filesRead(s.id);
  const ps = page._test.phone();
  const real = ps.start;
  let started = 0;
  ps.start = async (p) => { started++; return ps.view(); };            // (no 6.2 GB of made-up bytes are sent)
  const big = { name: "C0009.MOV", size: Math.round(6.2 * 1024 ** 3), lastModified: Date.now(), type: "", slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) };
  await page._test.pickFiles(s.id, [big], false);
  assert.equal(started, 1);
  const bl = document.querySelector('#shDScroll [data-line="copy.big_phone"]');
  assert.ok(bl, "the big-video line: " + lines().join(", "));
  assert.equal(bl.textContent, "Big videos go best from DCR Desktop. This 6.2 GB video needs about 20 min on good Wi-Fi with the screen on.");
  ps.start = real;
  await page._test.pickFiles(s.id, [new PickedFile("notes.txt", 30, 1)], false);
  await until(() => document.querySelector('#shDScroll [data-line="copy.not_media_one"], #shDScroll [data-line="copy.not_media"]'), 4000, "not_media");
  assert.equal(E.rows.photo_shoot_uploads.filter((u) => u.shoot_id === s.id).length, 0, "nothing opened");
});

test("a reload while it sends: the stopped-on-this-phone line with Pick the rest again / Hand in what's there / Cancel it; Pick the rest again with the same files - a file whose last chunk landed is found (no bytes), the rest sent - and the seal", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  const storage = memoryStorage();
  let landed = 0, lost = false, on = true;
  const hook = { fn: (req) => {
    if (on && lost) return "drop";
    const m = req.method === "PUT" ? / (\d+)-(\d+)\/(\d+)$/.exec(req.headers["Content-Range"]) : null;
    if (m && Number(m[2]) + 1 === Number(m[3]) && ++landed === 2 && on) { lost = true; return "lose"; }
    return undefined;
  } };
  await open(E, "field", "?shoot=" + s.id, storage, hook);
  await filesRead(s.id);
  const a = new PickedFile("A.HEIC", U + 3, 21), b = new PickedFile("B.MOV", 4 * U + 3, 22), c = new PickedFile("C.JPG", 2 * U + 1, 23);
  // the second file's last chunk lands but its answer is lost, then the connection goes for good: the page is closed
  // then (a reload) - the first file confirmed (its beat said so), the second in OneDrive with no done, the third not sent
  page._test.pickFiles(s.id, [a, b, c], false);
  await until(() => lost && dev(E).items(s.id).length === 2, 8000, "two files in OneDrive");
  await until(() => (E.rows.photo_shoot_uploads.find((u) => u.shoot_id === s.id) || {}).sent_files >= 1, 6000, "a beat after the first file");
  await page._test.phone().dispose();
  on = false;
  // (right after the reload its last beat is still under 2 minutes old: this phone knows nothing of it runs here)
  assert.equal((await R.status(s.id)).uploads[0].running, true);
  await open(E, "field", "?shoot=" + s.id, storage, hook);
  await filesRead(s.id);
  assert.deepEqual(lines(), ["stopped_this_phone", "no_access"], "(the photographer has no access to the folders, M10)");
  assert.equal(text("shDScroll").includes("Your upload from this phone stopped at 1 of 3 files."), true, text("shDScroll"));
  assert.deepEqual(acts(), ["files-pick-rest", "files-hand-in", "files-cancel", "files-check"]);
  const putsBefore = landed;
  await page._test.pickFiles(s.id, [a, b, c], true);
  await until(() => lines()[0] === "confirmed", 8000, "the ✓ line: " + lines().join(", "));
  assert.match(text("shDScroll"), /All 3 files are in OneDrive ✓/);
  assert.equal(landed - putsBefore, 1, "only the file never committed went again; the one whose last chunk landed was found");
  const rows = dev(E).files(s.id);
  assert.deepEqual(rows.map((r) => [r.path, r.md5, r.state]), [["Phone/A.HEIC", qx(a), "confirmed"], ["Phone/B.MOV", qx(b), "confirmed"],
    ["Phone/C.JPG", qx(c), "confirmed"]]);
  assert.equal(E.rows.photo_shoot_uploads.filter((u) => u.shoot_id === s.id).length, 1, "the same hand-in, opened again by its key");
});

test("Hand in what's there after a reload: a file in OneDrive but not checked is asked about (not_checked_phone: Pick them again / Hand in without them), never dropped; Hand in without them seals the rest", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  const storage = memoryStorage();
  let landed = 0, lost = false;
  const hook = { fn: (req) => {
    if (lost) return "drop";
    const m = req.method === "PUT" ? / (\d+)-(\d+)\/(\d+)$/.exec(req.headers["Content-Range"]) : null;
    if (m && Number(m[2]) + 1 === Number(m[3]) && ++landed === 2) { lost = true; return "lose"; }
    return undefined;
  } };
  await open(E, "field", "?shoot=" + s.id, storage, hook);
  await filesRead(s.id);
  const a = new PickedFile("A.HEIC", U + 3, 31), b = new PickedFile("B.MOV", 2 * U + 3, 32), c = new PickedFile("C.JPG", U + 1, 33);
  page._test.pickFiles(s.id, [a, b, c], false);
  await until(() => lost && dev(E).items(s.id).length === 2, 8000, "two files in OneDrive (the second's answer lost)");
  // (the beat after the first file's done: the hand-in's sent_files, which a reloaded page offers Hand in what's there by)
  await until(() => (E.rows.photo_shoot_uploads.find((u) => u.shoot_id === s.id).sent_files || 0) >= 1, 6000, "the beat counts the first file");
  await page._test.phone().dispose();
  Object.assign(E.rows.photo_shoot_uploads.find((u) => u.shoot_id === s.id), { beat_at: new Date(Date.now() - 5 * 60e3).toISOString() });
  await open(E, "field", "?shoot=" + s.id, storage, { fn: () => undefined });
  await filesRead(s.id);
  assert.deepEqual(acts(), ["files-pick-rest", "files-hand-in", "files-cancel", "files-check"]);
  press("files-hand-in");
  // files of it are not sent yet: asked first - the files already in OneDrive are what it hands in (OD §3.3 step 8)
  const sent = (await R.status(s.id)).uploads[0].sent_files;
  const ask = askNow();
  assert.ok(ask, "asked first");
  assert.deepEqual(ask, { code: "hand_in_ask_phone", text: sent === 1 ? WORDS.copy.hand_in_ask_phone_one : WORDS.copy.hand_in_ask_phone.replace("{n}", String(sent)),
    apply: WORDS.files_buttons.hand_in_there, keep: WORDS.copy.cancel_keep, focused: true });
  assert.equal(E.rows.photo_shoot_uploads.find((u) => u.shoot_id === s.id).state, "open", "nothing done before the answer");
  $("mvApply").click();
  await until(() => lines().includes("not_checked_phone_one") || lines().includes("not_checked_phone"), 6000, "asked: " + lines().join(", "));
  assert.equal(document.querySelector('#shDScroll [data-line^="not_checked_phone"]').textContent, WORDS.files.not_checked_phone_one);
  assert.deepEqual(acts(), ["files-pick-rest", "files-hand-in-without", "files-check"]);
  assert.equal(document.querySelector('#shDScroll [data-act="files-pick-rest"]').textContent, WORDS.files_buttons.pick_them_again);
  assert.equal(E.rows.photo_shoot_uploads.find((u) => u.shoot_id === s.id).state, "open", "not sealed: the found file would be dropped");
  document.querySelector('#shDScroll [data-act="files-hand-in-without"]').click();
  await until(() => E.rows.photo_shoot_uploads.find((u) => u.shoot_id === s.id).state === "sealed", 6000, "sealed");
  const rows = dev(E).files(s.id);
  assert.deepEqual(rows.map((r) => [r.path, r.state, r.counted]), [["Phone/A.HEIC", "confirmed", true], ["Phone/B.MOV", "removed", false],
    ["Phone/C.JPG", "removed", false]], "the found file stays in the folder as a file added without DCR");
});

test("this phone's own stopped hand-in after a reload with nothing in OneDrive (OD §3.3 step 9; review round 3): Pick the rest again and Cancel it - Hand in what's there only once its sent_files > 0, its ask never \"Hand in the 0 files…\"; its line's twin by {done} (OD §10.2, review round 4) by the counts the buttons are offered by", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  const storage = memoryStorage();
  // no connection from the first chunk on: nothing reaches OneDrive
  await open(E, "field", "?shoot=" + s.id, storage, { fn: (req) => (req.method === "PUT" ? "drop" : undefined) });
  await filesRead(s.id);
  page._test.pickFiles(s.id, [new PickedFile("D.HEIC", U + 3, 51), new PickedFile("E.HEIC", U + 4, 52)], false);
  await until(() => lines()[0] === "sending_this_phone", 6000, "sending");
  await page._test.phone().dispose();
  const up = E.rows.photo_shoot_uploads.find((u) => u.shoot_id === s.id);
  Object.assign(up, { beat_at: new Date(Date.now() - 5 * 60e3).toISOString() });
  assert.equal(up.sent_files || 0, 0, "nothing in OneDrive");
  await open(E, "field", "?shoot=" + s.id, storage, { fn: () => undefined });
  await filesRead(s.id);
  // (its twin by {done}, the files already in OneDrive - review round 4: never "stopped at 0 of 2 files")
  const said = () => document.querySelector('#shDScroll [data-line="stopped_this_phone"]').textContent;
  assert.equal(said(), "Your upload from this phone stopped before any file was in.");
  assert.equal(said(), WORDS.files.stopped_this_phone_none);
  assert.deepEqual(acts(), ["files-pick-rest", "files-cancel", "files-check"], "no Hand in what's there at 0");
  page._test.phoneAsk(s.id, "hand_in");
  assert.equal($("shMo"), null, "never asked \"Hand in the 0 files…\"");
  assert.equal(up.state === "open" || up.state === "abandoned", true, "nothing sealed or cancelled");
  // one file counted in OneDrive by its beat: Hand in what's there, asked with that file
  up.sent_files = 1;
  await page._test.readFiles(s.id);
  assert.deepEqual(acts(), ["files-pick-rest", "files-hand-in", "files-cancel", "files-check"]);
  assert.equal(said(), "Your upload from this phone stopped at 1 of 2 files.", "1 in OneDrive: its _one twin, beside Hand in what's there");
  press("files-hand-in");
  assert.equal(askNow().text, WORDS.copy.hand_in_ask_phone_one);
  document.querySelector('#shMo [data-act="mv-close"]').click();
  // the page's own module holding something else of this shoot (a refused pick): the counts are the status's, as the buttons
  const ps = page._test.phone();
  const view = ps.view, sending = ps.sending;
  ps.view = () => Object.assign(view(), { shoot: s.id, phase: "refused", buttons: [] });
  ps.sending = () => ({ sent: 0, total: 2 });
  await page._test.readFiles(s.id);
  assert.ok(acts().includes("files-hand-in"));
  assert.equal(said(), "Your upload from this phone stopped at 1 of 2 files.", "the line's count is the status's too, as the buttons'");
  page._test.phoneAsk(s.id, "hand_in");
  assert.equal(askNow() && askNow().text, WORDS.copy.hand_in_ask_phone_one, "the status's count, as the buttons were offered by it");
  document.querySelector('#shMo [data-act="mv-close"]').click();
  // the page's own stopped hand-in drawing its buttons by its own counts (one file in, the status's beat behind): the
  // line's {done} is the page's - never "before any file was in" beside Hand in what's there; and the other way round
  up.sent_files = 0;
  ps.view = () => Object.assign(view(), { shoot: s.id, phase: "stopped", buttons: ["pick_rest", "hand_in_there", "cancel_copy"] });
  ps.sending = () => ({ sent: 1, total: 2 });
  await page._test.readFiles(s.id);
  assert.deepEqual([said(), acts().includes("files-hand-in")], ["Your upload from this phone stopped at 1 of 2 files.", true]);
  up.sent_files = 1;
  ps.view = () => Object.assign(view(), { shoot: s.id, phase: "stopped", buttons: ["pick_rest", "cancel_copy"] });
  ps.sending = () => ({ sent: 0, total: 2 });
  await page._test.readFiles(s.id);
  assert.deepEqual([said(), acts().includes("files-hand-in")], [WORDS.files.stopped_this_phone_none, false]);
  Object.assign(ps, { view, sending });
});

test("another device: a phone hand-in stopped there shows its line with Hand in what's there / Cancel it for its starter or an admin - Cancel it ends it (copy.cancelled_sent counting what reached OneDrive); while this page sends one shoot no other shoot offers a hand-in", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E, 0), s2 = bareShoot(E, 1);
  let landed = 0;
  const hook = { fn: (req) => {
    if (landed >= 1) return "drop";
    const m = req.method === "PUT" ? / (\d+)-(\d+)\/(\d+)$/.exec(req.headers["Content-Range"]) : null;
    if (m && Number(m[2]) + 1 === Number(m[3])) landed++;
    return undefined;
  } };
  await open(E, "field", "?shoot=" + s.id, memoryStorage(), hook);
  await filesRead(s.id);
  page._test.pickFiles(s.id, [new PickedFile("A.HEIC", U + 3, 41), new PickedFile("B.HEIC", U + 4, 42)], false);
  await until(() => lines()[0] === "sending_this_phone", 6000, "sending");
  // while it sends shoot 1, shoot 2 offers no hand-in (one at a time on this page)
  page._test.openShoot(s2.id);
  await filesRead(s2.id);
  assert.deepEqual(lines(), ["none_add_phone"]);
  assert.ok(!acts().includes("files-add-phone"), "no second hand-in while one sends");
  const buttons = phoneButtons({ can: { add_from_phone: true }, uploads: [] }, { available: true, lines: [{ code: "none_add_phone" }], addPhone: true }, { other: true });
  assert.deepEqual(buttons, []);
  await until(() => dev(E).items(s.id).length === 1, 6000, "one file in OneDrive");
  await page._test.phone().dispose();
  Object.assign(E.rows.photo_shoot_uploads.find((u) => u.shoot_id === s.id), { beat_at: new Date(Date.now() - 5 * 60e3).toISOString(), sent_files: 1 });
  // the admin on another phone
  await open(E, "admin", "?shoot=" + s.id, memoryStorage(), { fn: () => undefined });
  await filesRead(s.id);
  assert.equal(lines()[0], "stopped_upload_phone");
  assert.match(text("shDScroll"), /The upload from Jordan's phone stopped at 1 of 2 files - finish it on that phone, or hand in what's there\./);
  assert.deepEqual(acts(), ["files-hand-in", "files-cancel", "files-check"]);
  press("files-cancel");
  assert.deepEqual(askNow(), { code: "cancel_ask_phone", text: WORDS.copy.cancel_ask_phone, apply: WORDS.files_buttons.cancel_copy, keep: WORDS.copy.cancel_keep,
    focused: true }, "another device's stopped phone hand-in: asked too");
  $("mvApply").click();
  await until(() => E.rows.photo_shoot_uploads.find((u) => u.shoot_id === s.id).state === "cancelled", 6000, "cancelled");
  assert.ok(dev(E).files(s.id).every((r) => r.state === "removed"));
  await until(() => lines()[0] === "none_add_phone", 6000, "nothing handed in: " + lines().join(", "));
  assert.ok(acts().includes("files-add-phone"), "an admin may add from this phone now");
  // by the cancel's own count, never the status's: this device holds none of the hand-in's files, so the answer's
  // removed_sent - A in OneDrive, and B whose session was handed out (its bytes may be there: no done tells DCR when the
  // phone's connection went at its last chunk) - the safe side, the office looks and finds fewer (OD §5.5, §23; review
  // round 5)
  assert.deepEqual(lines().filter((l) => /cancelled_sent/.test(l)), ["copy.cancelled_sent"]);
  assert.ok(text("shDScroll").includes(fill(WORDS.copy.cancelled_sent, { n: 2 })), text("shDScroll"));
});

test("while it sends, Cancel it and Hand in what's there ASK first (OD §3.3 step 8; the OneDrive review's round 1): Keep it has the focus, so Enter or a stray tap beside the button keeps the hand-in going - nothing stopped, nothing cancelled; Cancel it from the question cancels; all in, Hand in what's there acts at once", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  // the connection goes after the first file's first chunk: the page keeps sending (waiting for the internet)
  let down = false;
  const hook = { fn: (req) => { if (req.method === "PUT") down = true; return down ? "drop" : undefined; } };
  await open(E, "field", "?shoot=" + s.id, memoryStorage(), hook);
  await filesRead(s.id);
  page._test.pickFiles(s.id, [new PickedFile("IMG_0501.HEIC", 2 * U + 3, 81), new PickedFile("C0502.MOV", 30 * U + 1, 82), new PickedFile("IMG_0503.HEIC", U + 1, 83)], false);
  await until(() => down && lines()[0] === "sending_this_phone", 8000, "sending: " + lines().join(", "));
  const up = () => E.rows.photo_shoot_uploads.find((u) => u.shoot_id === s.id);
  // nothing of it in OneDrive yet: Cancel it alone - Hand in what's there once a file is in (review round 3)
  assert.deepEqual(acts().slice(0, 2), ["files-cancel", "files-check"]);
  // Cancel it: asked, Keep it focused; kept
  press("files-cancel");
  assert.deepEqual(askNow(), { code: "cancel_ask_phone", text: "Cancel this upload? Nothing of it is handed in. Files that already reached OneDrive stay there.",
    apply: "Cancel it", keep: "Keep it", focused: true });
  assert.match($("shMo").textContent, new RegExp(s.name), "the shoot named");
  assert.ok($("mvApply").getAttribute("class").includes("warn"), "Cancel it is never the primary");
  document.activeElement.click();                          // (Enter on the focused Keep it, or a tap on it)
  assert.equal($("shMo"), null, "kept: the question closed");
  assert.equal(up().state, "open", "nothing cancelled");
  assert.equal(page._test.phone().view().phase, "sending", "still sending");
  assert.equal(document.activeElement, document.querySelector('#shDScroll [data-act="files-cancel"]'), "the focus back on Cancel it");
  // Hand in what's there with nothing in OneDrive: never asked "Hand in the 0 files…" - nothing is done (review round 3)
  page._test.phoneAsk(s.id, "hand_in");
  assert.equal($("shMo"), null, "no question");
  assert.equal(page._test.phone().view().phase, "sending", "nothing stopped");
  // Cancel it from the question: cancelled (its file in flight stopped first); nothing reached OneDrive, so no line of it
  press("files-cancel");
  $("mvApply").click();
  hook.fn = () => undefined;
  await until(() => up().state === "cancelled", 8000, "cancelled");
  await until(() => lines()[0] === "none_add_phone", 6000, "nothing handed in: " + lines().join(", "));
  // a new pick: the connection goes after the first file is in OneDrive (its one chunk, then the next file's first)
  let puts = 0;
  hook.fn = (req) => (req.method === "PUT" && ++puts >= 2 ? "drop" : undefined);
  page._test.pickFiles(s.id, [new PickedFile("IMG_0511.HEIC", 2 * U + 3, 84), new PickedFile("C0512.MOV", 30 * U + 1, 85), new PickedFile("IMG_0513.HEIC", U + 1, 86)], false);
  await until(() => acts().includes("files-hand-in"), 8000, () => "one file in: " + acts().join(", "));
  const up2 = () => E.rows.photo_shoot_uploads.filter((u) => u.shoot_id === s.id).at(-1);
  // Hand in what's there: files not sent yet - asked with the files already in OneDrive ({n}: the one in)
  press("files-hand-in");
  const ask = askNow();
  assert.deepEqual([ask.code, ask.text, ask.apply, ask.keep, ask.focused], ["hand_in_ask_phone",
    "Hand in the 1 file already in OneDrive? The ones not sent yet aren't handed in - pick them again later.", "Hand in what's there", "Keep it", true]);
  document.querySelector('#shMo .sh-x[data-act="mv-close"]').click();
  assert.equal($("shMo"), null);
  assert.equal(page._test.phone().view().phase, "sending", "the × keeps it too");
  assert.equal(up2().state, "open", "neither sealed nor cancelled");
  // answered: the file in flight stopped first, the one in OneDrive handed in, the rest left out
  press("files-hand-in");
  $("mvApply").click();
  await until(() => up2().state === "sealed", 8000, "handed in");
  assert.deepEqual(dev(E).files(s.id).filter((r) => r.last_upload_id === up2().id).map((r) => [r.path, r.state, r.counted]),
    [["Phone/IMG_0511.HEIC", "confirmed", true], ["Phone/C0512.MOV", "removed", false], ["Phone/IMG_0513.HEIC", "removed", false]]);
  hook.fn = () => undefined;
  // all of a hand-in in OneDrive: Hand in what's there asks nothing (nothing is left out) - it hands in
  const ps = page._test.phone();
  let handed = 0;
  const real = ps.handIn;
  ps.handIn = async () => { handed++; return ps.view(); };
  S.files[s.id].st = Object.assign({}, S.files[s.id].st, { uploads: [{ id: 999, state: "open", source: "phone", pc: "iPhone", pc_id: 77, by: "Jordan",
    can_decide: true, running: false, files: 4, recorded_files: 4, sent_files: 4, to_send: 0 }] });
  page._test.phoneAsk(s.id, "hand_in");
  await until(() => handed === 1, 4000, "handed in at once");
  assert.equal($("shMo"), null, "no question: every file of it is in OneDrive");
  ps.handIn = real;
  // the hand-in ended while the question was open (sealed, or cancelled elsewhere): the answer does nothing - never a
  // cancel or a seal of a closed hand-in, never "couldn't do that"
  let cancels = 0;
  const realCancel = ps.cancel;
  ps.cancel = async () => { cancels++; return ps.view(); };
  S.files[s.id].st.uploads[0].sent_files = 1;
  page._test.phoneAsk(s.id, "cancel");
  assert.ok($("shMo"), "asked");
  S.files[s.id].st = Object.assign({}, S.files[s.id].st, { uploads: [] });
  $("mvApply").click();
  await tick();
  assert.deepEqual([$("shMo"), cancels], [null, 0], "closed, nothing done");
  ps.cancel = realCancel;
});

test("a phone's file a check sent back after its phone's seal (OD §3.5; review round 1): the Files line says so on that phone (resend_phone, \"{by}'s phone\") with Add photos and videos; picked again it is recorded with its hash, recopied, sent by the new hand-in and the shoot is all in OneDrive ✓", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  const storage = memoryStorage();
  await open(E, "field", "?shoot=" + s.id, storage);
  await filesRead(s.id);
  const a = new PickedFile("IMG_0601.HEIC", U + 11, 91), b = new PickedFile("IMG_0602.HEIC", U + 12, 92);
  await page._test.pickFiles(s.id, [a, b], false);
  await until(() => lines()[0] === "confirmed", 8000, "the ✓ line: " + lines().join(", "));
  // a later check found OneDrive's copy of a broken (its hash still different 30 minutes on): the row back to send,
  // under the SEALED phone hand-in - nothing sends it
  const row = E.rows.photo_shoot_files.find((r) => r.path === "Phone/IMG_0601.HEIC");
  Object.assign(row, { state: "waiting", upload_step: "to_send", confirmed_at: null, drive_file_id: null, drive_md5: null });
  const f = E.rows.photo_drive_folders.find((x) => x.shoot_id === s.id && x.kind === "shoot");
  Object.assign(f, { confirmed: f.confirmed - 1, waiting: (f.waiting || 0) + 1, files_state: "waiting" });
  await page._test.readFiles(s.id);
  assert.equal(lines()[0], "resend_phone", lines().join(", "));
  assert.equal(document.querySelector('#shDScroll [data-line="resend_phone"]').textContent,
    "1 file from Jordan's phone didn't reach OneDrive whole - pick it again on that phone (Add photos and videos) to send it again, or leave it out.");
  assert.ok(acts().includes("files-add-phone"), "Add photos and videos is there to pick it again");
  // picked again (both: the other one is confirmed - skipped)
  await page._test.pickFiles(s.id, [a, b], false);
  await until(() => E.rows.photo_shoot_uploads.filter((u) => u.shoot_id === s.id && u.state === "sealed").length === 2, 8000, () => "the new hand-in sealed: " +
    JSON.stringify([page._test.phone().view(), E.rows.photo_shoot_uploads.filter((u) => u.shoot_id === s.id).map((u) => [u.id, u.state]), row]));
  const ups = E.rows.photo_shoot_uploads.filter((u) => u.shoot_id === s.id);
  const now = E.rows.photo_shoot_files.find((r) => r.id === row.id);
  assert.equal(now.last_upload_id, ups[1].id, "the row is the new hand-in's (recopied)");
  assert.equal(now.state, "confirmed");
  assert.deepEqual(dev(E).files(s.id).map((r) => [r.path, r.state]), [["Phone/IMG_0601.HEIC", "confirmed"], ["Phone/IMG_0602.HEIC", "confirmed"]],
    "no second row of it, never a ' (2)' copy");
  assert.equal(page._test.phone().view().lines.some((l) => l.code === "skipped_same" && l.text === WORDS.copy.skipped_same_one), true, "the confirmed one skipped");
  await page._test.readFiles(s.id);
  await until(() => lines()[0] === "confirmed", 6000, "all in OneDrive again: " + lines().join(", "));
});

test("a gone job folder holds a new shoot of it (OD §2.3, rule 3b; review round 1): the Files line names the job folder alone - no Add photos and videos, no Check again", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  const plan = E.rows.photo_plans.find((p) => p.id === s.plan_id);
  let job = E.rows.photo_drive_folders.find((x) => x.kind === "job" && x.plan_id === s.plan_id && !x.retired_at);
  if (!job) {
    job = { id: 990001, kind: "job", plan_id: s.plan_id, tag: "Q7JOBX", name: (plan.project_label || "Sample job") + " [DCR-Q7JOBX]", drive_name: null, drive_state: "found",
      drive_link: null, retired_at: null, parent_id: null, shoot_id: null, created_at: new Date().toISOString() };
    E.rows.photo_drive_folders.push(job);
  }
  Object.assign(job, { drive_state: "missing", drive_state_at: new Date(Date.now() - 3600e3).toISOString() });
  await open(E, "field", "?shoot=" + s.id);
  await filesRead(s.id);
  assert.deepEqual(lines(), ["job_moved_out"]);
  assert.ok(text("shDScroll").includes("The job folder '" + (job.drive_name || job.name) + "' is no longer inside DCR Photo & Video"), text("shDScroll"));
  assert.deepEqual(acts(), [], "nothing to add, open or check");
  const st = await R.status(s.id);
  assert.deepEqual([st.job.id, st.job.drive_state, st.can.add_from_phone], [job.id, "missing", false]);
  // begin refuses folder_gone with the job in its detail (the photographer's DCR Desktop names the job folder)
  await assert.rejects(R.begin(s.id, { clientKey: "CLIENTKEY_00000000j1", deviceKey: "pk_" + "J".repeat(22), label: "iPhone" }),
    (e) => e.hint === "folder_gone" && e.detail && e.detail.job && e.detail.job.id === job.id);
});

test("queued (OD §3.2.8, derived by the status): a sealed hand-in with files to send whose device sends another one reads 'Waiting on {pc} behind {shoot}'", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E, 0), s2 = bareShoot(E, 1);
  const field = await person("field");
  useClient(clientAs(E, field.id));
  const key = "pk_" + "P".repeat(22);
  const one = await R.begin(s.id, { clientKey: "CLIENTKEY_00000000q1", deviceKey: key, label: "iPhone" });
  const r1 = await R.record(one.upload.id, [{ path: "Phone/A.JPG", size: 100, md5: "FAKEqx000000000000000000001=" }]);
  await R.seal(one.upload.id, 1, 100);
  assert.ok(r1.byIndex[0].send);
  const two = await R.begin(s2.id, { clientKey: "CLIENTKEY_00000000q2", deviceKey: key, label: "iPhone" });
  await R.record(two.upload.id, [{ path: "Phone/B.JPG", size: 100 }]);
  await R.beat(two.upload.id, { state: "sending", bytesSent: 10, sentFiles: 0 });
  // (a PHONE's sealed hand-in with a row to send is one a check sent back - resend_phone, OD §3.5, below - so the
  // queued one here is a computer's: the same device row, labelled as DCR Desktop labels it)
  for (const x of E.rows.photo_shoot_uploads.filter((y) => y.id === one.upload.id || y.id === two.upload.id)) Object.assign(x, { source: "pc", pc_label: "PHOTO-PC" });
  const st = await R.status(s.id);
  const u = st.uploads.find((x) => x.id === one.upload.id);
  assert.deepEqual([u.send_state, u.behind, u.to_send], ["queued", s2.name, 1]);
  await open(E, "field", "?shoot=" + s.id);
  await filesRead(s.id);
  assert.deepEqual(lines().slice(0, 1), ["queued"]);
  assert.equal(document.querySelector('#shDScroll [data-line="queued"]').textContent, "Waiting on PHOTO-PC behind " + s2.name + " - it goes on by itself.");
  // never queued over a hand-in whose own beat says its files are lost or its starter signed out, fresh or not, nor its
  // outbox's disk away under 2 minutes ago: only the card, the disk or a person moves it - its own line says which (OD
  // §3.2.8; review round 3). A stale outbox_away was said in a turn of its own that has not come again while the other
  // one sends: queued (review round 4)
  const mine = E.rows.photo_shoot_uploads.find((y) => y.id === one.upload.id);
  for (const [state, ago, line] of [["lost", 30e3, "lost_here"], ["lost", 600e3, "lost_here"], ["outbox_away", 30e3, "outbox_away"],
    ["paused", 30e3, "paused_signed_out"], ["paused", 600e3, "paused_signed_out"]]) {
    Object.assign(mine, { send_state: state, send_beat_at: new Date(Date.now() - ago).toISOString() });
    const x = (await R.status(s.id)).uploads.find((y) => y.id === one.upload.id);
    assert.deepEqual([x.send_state, x.behind], [state, null], state + ", its beat " + ago / 1000 + " s old");
    await page._test.readFiles(s.id);
    assert.deepEqual(lines().slice(0, 1), [line], state);
  }
  Object.assign(mine, { send_state: "outbox_away", send_beat_at: new Date(Date.now() - 600e3).toISOString() });
  let x = (await R.status(s.id)).uploads.find((y) => y.id === one.upload.id);
  assert.deepEqual([x.send_state, x.behind], ["queued", s2.name], "outbox_away, its beat 600 s old: queued behind the one its PC sends");
  await page._test.readFiles(s.id);
  assert.deepEqual(lines().slice(0, 1), ["queued"], "never \"DCR Desktop isn't open there\" while that PC sends");
  Object.assign(mine, { send_state: "waiting_net", send_beat_at: new Date(Date.now() - 600e3).toISOString() });
  assert.equal((await R.status(s.id)).uploads.find((y) => y.id === one.upload.id).send_state, "queued", "an old beat of another state: queued, as before");
  // waiting_turn (review round 4): the PC's own word for a hand-in behind the one it sends (beaten once after a sign-in or
  // once its lost files are written back) - stored, the beat takes it; read queued while that PC's other hand-in beats
  // sending, else sending (the stale-beat rules then: paused_pc); never stored as queued
  const b = await R.beat(one.upload.id, { state: "waiting_turn", bytesSent: 0, sentFiles: 0 });
  assert.equal(b.upload.send_state, "waiting_turn", "stored as said");
  const row = () => E.rows.photo_shoot_uploads.find((y) => y.id === one.upload.id);
  assert.equal(row().send_state, "waiting_turn");
  x = (await R.status(s.id)).uploads.find((y) => y.id === one.upload.id);
  assert.deepEqual([x.send_state, x.behind], ["queued", s2.name], "waiting_turn behind the one its PC sends: queued");
  await page._test.readFiles(s.id);
  assert.deepEqual(lines().slice(0, 1), ["queued"]);
  const other = E.rows.photo_shoot_uploads.find((y) => y.id === two.upload.id);
  other.send_beat_at = new Date(Date.now() - 600e3).toISOString();
  x = (await R.status(s.id)).uploads.find((y) => y.id === one.upload.id);
  assert.deepEqual([x.send_state, x.behind], ["sending", null], "nothing of its PC sends: sending, never waiting_turn");
  await page._test.readFiles(s.id);
  assert.deepEqual(lines().slice(0, 1), ["sending_starting"], "its beat fresh: sending from that PC (nothing of it sent yet)");
  row().send_beat_at = new Date(Date.now() - 600e3).toISOString();
  await page._test.readFiles(s.id);
  assert.deepEqual(lines().slice(0, 1), ["paused_pc"], "its beat stale: DCR Desktop isn't open there");
  assert.equal(row().send_state, "waiting_turn", "the stored beat is never rewritten by a read");
  other.send_beat_at = new Date().toISOString();
  row().send_state = "waiting_net";
  // a phone's sealed hand-in still holding a row to send: only that phone picking it again sends it (resend_phone first)
  Object.assign(E.rows.photo_shoot_uploads.find((y) => y.id === one.upload.id), { source: "phone", pc_label: "iPhone" });
  await page._test.readFiles(s.id);
  assert.deepEqual(lines().slice(0, 1), ["resend_phone"]);
  assert.equal(document.querySelector('#shDScroll [data-line="resend_phone"]').textContent,
    "1 file from Jordan's phone didn't reach OneDrive whole - pick it again on that phone (Add photos and videos) to send it again, or leave it out.");
});

test("the demo's help lost (app.photo_help_now; OD §6.6, L51, review round 5): a sealed PC hand-in whose fresh beat says its files are lost, with rows to send, the mode on, the root found and the folder there - the chip \"Memory card needed\" beside lost_here; never for a stale beat, a phone, nothing to send, the mode off or the root lost", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  useClient(clientAs(E, (await person("field")).id));
  const key = "pk_" + "L".repeat(22);
  const one = await R.begin(s.id, { clientKey: "CLIENTKEY_00000000l1", deviceKey: key, label: "iPhone" });
  const r1 = await R.record(one.upload.id, [{ path: "Phone/A.JPG", size: 100, md5: "FAKEqx000000000000000000071=" },
    { path: "Phone/B.JPG", size: 101, md5: "FAKEqx000000000000000000072=" }]);
  await R.sessions(one.upload.id, key, [{ file_id: r1.byIndex[0].file_id }]);   // (the folders made in OneDrive)
  await R.seal(one.upload.id, 2, 201);
  // (a computer's sealed hand-in: the same device row, labelled as DCR Desktop labels it)
  const up = () => E.rows.photo_shoot_uploads.find((y) => y.id === one.upload.id);
  Object.assign(up(), { source: "pc", pc_label: "PHOTO-PC" });
  await R.beat(one.upload.id, { state: "lost", bytesSent: 0, sentFiles: 0 });
  const help = async () => (await R.status(s.id)).help;
  assert.deepEqual(await help(), ["lost"]);
  await open(E, "field", "?shoot=" + s.id);
  await filesRead(s.id);
  assert.deepEqual(lines().slice(0, 1), ["lost_here"]);
  assert.deepEqual(document.querySelectorAll("#shDScroll .sh-chip.need").map((x) => x.textContent), ["Memory card needed"]);
  // after the files' own events, as app.photo_help_now answers them
  const f = E.rows.photo_drive_folders.find((x) => x.shoot_id === s.id && x.kind === "shoot");
  f.help = ["stalled"];
  f.stalled_at = new Date().toISOString();
  // (stalled only while a stalled row is left - its rows sealed 14 days ago and more: review round 8)
  assert.deepEqual(await help(), ["lost"], "the stamp with no stalled row left: no stalled");
  const sealedAt = up().sealed_at;
  up().sealed_at = new Date(Date.now() - 15 * 86400e3).toISOString();
  assert.deepEqual(await help(), ["stalled", "lost"]);
  up().sealed_at = sealedAt;
  f.help = [];
  f.stalled_at = null;
  // a beat over 2 minutes old: DCR Desktop may be closed there - no lost (late comes for it)
  up().send_beat_at = new Date(Date.now() - 3 * 60e3).toISOString();
  assert.deepEqual(await help(), []);
  up().send_beat_at = new Date().toISOString();
  assert.deepEqual(await help(), ["lost"]);
  // a phone's sealed hand-in: never (its words name a computer; only that phone picking them again sends them)
  up().source = "phone";
  assert.deepEqual(await help(), []);
  up().source = "pc";
  // the mode not on for the shoot, or the root lost: nobody can act on it
  dev(E).state({ mode: "off" });
  assert.deepEqual(await help(), []);
  dev(E).state({ mode: "on" });
  dev(E).state({ root: "missing" });
  assert.deepEqual(await help(), []);
  dev(E).state({ root: "found" });
  assert.deepEqual(await help(), ["lost"]);
  // nothing left to send (its rows in OneDrive, their hash coming): no lost
  for (const r of E.rows.photo_shoot_files.filter((x) => x.last_upload_id === one.upload.id)) r.upload_step = "committed";
  assert.deepEqual(await help(), []);
});

test("the demo's photo_upload_beat leaves an open hand-in's running clock alone for waiting_turn (OD §3.2.8, §5.6; review round 5): a stopped copy stays stopped - never \"{by} is copying…\" for 2 minutes - while every other beat runs it", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  useClient(clientAs(E, (await person("field")).id));
  const open1 = await R.begin(s.id, { clientKey: "CLIENTKEY_00000000t1", deviceKey: "pk_" + "T".repeat(22), label: "iPhone" });
  await R.record(open1.upload.id, [{ path: "Phone/A.JPG", size: 100 }]);
  const up = () => E.rows.photo_shoot_uploads.find((y) => y.id === open1.upload.id);
  const old = new Date(Date.now() - 5 * 60e3).toISOString();
  up().beat_at = old;
  const running = async () => (await R.status(s.id)).uploads.find((x) => x.id === open1.upload.id).running;
  assert.equal(await running(), false, "stopped: its last beat 5 minutes ago");
  const b = await R.beat(open1.upload.id, { state: "waiting_turn", bytesSent: 0, sentFiles: 0 });
  assert.equal(b.upload.send_state, "waiting_turn", "taken and stored");
  assert.equal(up().beat_at, old, "its running clock not moved");
  assert.equal(await running(), false, "still stopped");
  assert.ok(Date.parse(up().send_beat_at) > Date.now() - 60e3, "the sending clock beats");
  await R.beat(open1.upload.id, { state: "sending", bytesSent: 0, sentFiles: 0 });
  assert.notEqual(up().beat_at, old, "any other beat runs it");
  assert.equal(await running(), true);
});

test("the demo's photo_upload_beat moves an open PC hand-in's running clock only with its progress (OD §3.2.8, §5.6, L44; review round 6): a stopped copy whose files wait on a hold, a lost file or a held one beats on and stays stopped elsewhere - never \"{by} is copying…\"; bytes that grew run it; a phone's beat runs it as before", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  useClient(clientAs(E, (await person("field")).id));
  const open1 = await R.begin(s.id, { clientKey: "CLIENTKEY_00000000t6", deviceKey: "pk_" + "W".repeat(22), label: "iPhone" });
  await R.record(open1.upload.id, [{ path: "Phone/A.JPG", size: 100 }]);
  const up = () => E.rows.photo_shoot_uploads.find((y) => y.id === open1.upload.id);
  const old = new Date(Date.now() - 5 * 60e3).toISOString();
  // (the demo's hand-in made a PC's: DCR Desktop's copy, stopped 5 minutes ago with 500 bytes in)
  Object.assign(up(), { source: "pc", pc_label: "PHOTO-PC", beat_at: old, bytes_sent: 500 });
  const running = async () => (await R.status(s.id)).uploads.find((x) => x.id === open1.upload.id).running;
  assert.equal(await running(), false, "stopped: its last beat 5 minutes ago");
  for (const state of ["onedrive_full", "lost", "sending"]) {
    await R.beat(open1.upload.id, { state, bytesSent: 500, sentFiles: 0 });
    assert.equal(up().beat_at, old, state + " with nothing more sent: its running clock not moved");
    assert.equal(up().send_state, state, "the beat itself is taken");
  }
  assert.equal(await running(), false, "still stopped");
  await R.beat(open1.upload.id, { state: "sending", bytesSent: 900, sentFiles: 1 });
  assert.notEqual(up().beat_at, old, "its bytes grew: it runs");
  assert.equal(await running(), true);
  // a phone's page beats only while it sends: its beat runs the clock as before
  Object.assign(up(), { source: "phone", beat_at: old });
  await R.beat(open1.upload.id, { state: "sending", bytesSent: 900, sentFiles: 1 });
  assert.notEqual(up().beat_at, old);
});

test("the demo's sessions answers a row at committed found with its item (handler.ts committedFor; OD §3.2.4 step 5, §3.5, review round 6): no session, no new name - done reads it again", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  useClient(clientAs(E, (await person("field")).id));
  const key = "pk_" + "X".repeat(22);
  const b = await R.begin(s.id, { clientKey: "CLIENTKEY_00000000c6", deviceKey: key, label: "iPhone" });
  const r = await R.record(b.upload.id, [{ path: "Phone/IMG_0661.HEIC", size: 1000, md5: "FAKEqx000000000000000000661=" }]);
  const id = r.byIndex[0].file_id;
  await R.sessions(b.upload.id, key, [{ file_id: id }]);       // (the folders made in OneDrive)
  const row = () => E.rows.photo_shoot_files.find((x) => x.id === id);
  const f = E.rows.photo_drive_folders.find((x) => x.shoot_id === s.id && x.kind === "shoot");
  // its bytes in OneDrive (its item known, OneDrive's hash late), and no session of this row's to say the item at its
  // name is its own: before, a session was asked anyway - the name taken, the file sent again as "IMG_0661 (2).HEIC"
  E.rows.demo_photo_items.push({ id: 9601, item_id: "01FAKEPHCOMMIT0661", folder_id: f.id, path: "Phone/IMG_0661.HEIC", size: 1000, qx: null,
    later_qx: null, by_app: true, created_at: new Date().toISOString() });
  Object.assign(row(), { upload_step: "committed", drive_file_id: "01FAKEPHCOMMIT0661", drive_size: 1000, session_at: null });
  const a = await R.sessions(b.upload.id, key, [{ file_id: id }]);
  assert.deepEqual(a.files, [{ file_id: id, code: "found", item_id: "01FAKEPHCOMMIT0661" }]);
  assert.deepEqual([row().path, row().upload_step, row().drive_file_id, row().session_at], ["Phone/IMG_0661.HEIC", "committed", "01FAKEPHCOMMIT0661", null]);
});

test("the demo holds photo_shoot_files_removed_shape (the migration's check; review round 6): a row is removed exactly when it has a reason - any write that breaks it is refused 23514", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  useClient(clientAs(E, (await person("field")).id));
  const key = "pk_" + "Y".repeat(22);
  const b = await R.begin(s.id, { clientKey: "CLIENTKEY_00000000s6", deviceKey: key, label: "iPhone" });
  const r = await R.record(b.upload.id, [{ path: "Phone/IMG_0671.HEIC", size: 1000, md5: "FAKEqx000000000000000000671=" }]);
  const row = E.rows.photo_shoot_files.find((x) => x.id === r.byIndex[0].file_id);
  // a recopied row (prev_* kept) left removed with no reason: the cancel's put back keeps it removed - a write the
  // database refuses, so the demo refuses it too, and the cancel with it
  Object.assign(row, { counted: true, prev_size: 1000, prev_md5: row.md5, prev_upload_id: null, prev_drive: { state: "waiting", upload_step: "to_send" },
    state: "removed", removed_reason: null });
  await assert.rejects(R.cancel(b.upload.id), (e) => e && String(e.code) === "23514");
  assert.equal(E.rows.photo_shoot_uploads.find((u) => u.id === b.upload.id).state, "open", "nothing cancelled");
  // its reason there: the same cancel goes, the row still left out
  Object.assign(row, { removed_reason: "left_out" });
  const c = await R.cancel(b.upload.id);
  assert.equal(c.state, "cancelled");
  assert.deepEqual([E.rows.photo_shoot_files.find((x) => x.id === row.id).state, E.rows.photo_shoot_files.find((x) => x.id === row.id).removed_reason], ["removed", "left_out"]);
});

test("the demo's app.photo_row_stalled (OD §6.6, §25; review round 7): the status's uploads[].stalled counts a sealed PC hand-in's rows still to send 14 days after the latest of its seal, the row's own put back and the mode's last change - never a row in OneDrive, a fresher hand-in's, a phone's; the file list's rows carry upload_id, upload_step and stalled; the phone's stalled line counts them alone", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  const me = await person("field");
  useClient(clientAs(E, me.id));
  const key = "pk_" + "T".repeat(22);
  const DAY = 86400e3;
  const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
  /** a hand-in of `n` files sealed, then made a PC's (the demo's phone RPCs make it; a PC's sender sends its rows) */
  async function sealed(tag, n, pc, sealedAt) {
    const b = await R.begin(s.id, { clientKey: "CLIENTKEY_STALL_" + tag, deviceKey: key, label: "iPhone" });
    const list = Array.from({ length: n }, (_, i) => ({ path: "IMG_" + tag + i + ".JPG", size: 1000 + i, md5: "FAKEqx" + String(7000 + i).padStart(20, "0") + tag + "=" }));
    const r = await R.record(b.upload.id, list);
    await R.seal(b.upload.id, n, list.reduce((t, f) => t + f.size, 0));
    Object.assign(E.rows.photo_shoot_uploads.find((u) => u.id === b.upload.id), { source: "pc", pc_label: pc, sealed_at: sealedAt });
    return { id: b.upload.id, rows: list.map((_, i) => E.rows.photo_shoot_files.find((y) => y.id === r.byIndex[i].file_id)) };
  }
  const A = await sealed("A", 3, "PHOTO-PC", ago(20));               // 20 days ago: its rows still to send are stalled
  const B = await sealed("B", 2, "OFFICE-PC", ago(0.01));            // just now, still sending: never stalled
  Object.assign(A.rows[2], { upload_step: "committed", drive_file_id: "01FAKEPHSTALL0003" });   // in OneDrive, checking: never stalled
  const f = E.rows.photo_drive_folders.find((x) => x.shoot_id === s.id && x.kind === "shoot");
  f.stalled_at = new Date().toISOString();                            // (the tick's stamp while a stalled row is left)
  const stalledOf = async () => Object.fromEntries((await R.status(s.id)).uploads.map((u) => [u.id, u.stalled]));
  assert.deepEqual(await stalledOf(), { [A.id]: 2, [B.id]: 0 });
  // the phone's stalled line: those 2 files on PHOTO-PC - never B's still sending, never the one in OneDrive
  const st = await R.status(s.id);
  assert.equal(st.files.to_send, 4, "the rows still to send: A's 2 and B's 2");
  assert.deepEqual(F.filesView(st, { now: Date.now(), viewer: { device_id: null } }).lines[0].text,
    "Checks stopped after 14 days - 2 files never reached OneDrive. Open DCR Desktop on PHOTO-PC and let it send them. If PHOTO-PC lost them, copy the card again there, or leave them out.");
  // the file list: each row's hand-in, sending step and stalled (the migration's re-made photo_shoot_files_page)
  const page1 = (await clientAs(E, me.id).rpc("photo_shoot_files_page", { p_shoot: s.id, p_filter: null, p_after: null, p_limit: 500 })).data;
  assert.deepEqual(page1.files.map((x) => [x.upload_id, x.upload_step, x.stalled]),
    [[A.id, "to_send", true], [A.id, "to_send", true], [A.id, "committed", false], [B.id, "to_send", false], [B.id, "to_send", false]]);
  // a row's own put back a day ago: 14 days from it - not stalled
  A.rows[0].back_at = ago(1);
  assert.deepEqual(await stalledOf(), { [A.id]: 1, [B.id]: 0 }, "back_at counts as the seal");
  A.rows[0].back_at = ago(15);
  assert.deepEqual(await stalledOf(), { [A.id]: 2, [B.id]: 0 });
  // the uploads mode changed since: 14 days from that change
  dev(E).state({ mode: "off" });
  dev(E).state({ mode: "on" });
  assert.deepEqual(await stalledOf(), { [A.id]: 0, [B.id]: 0 }, "the mode's change counts as the seal");
  dev(E).state({ mode_at: ago(15) });
  assert.deepEqual(await stalledOf(), { [A.id]: 2, [B.id]: 0 });
  // a phone's hand-in is never stalled (its rows sent back ask for that phone: resend_phone)
  E.rows.photo_shoot_uploads.find((u) => u.id === A.id).source = "phone";
  assert.deepEqual(await stalledOf(), { [A.id]: 0, [B.id]: 0 });
});

test("the demo's seeded shoot whose checks stopped after 14 days (A000T9 progress-3) holds its 9 files never sent as rows of its PC hand-in sealed 15 days ago: its uploads[].stalled, the file list's stalled and the phone's stalled line count them (OD §25)", { skip }, async () => {
  const E = await engine();
  const plan = E.rows.photo_plans.find((p) => p.project_code === "A000T9");
  const s = E.rows.photo_shoots.find((x) => x.plan_id === plan.id && x.key === "progress-3");
  const me = await person("field");
  useClient(clientAs(E, me.id));
  const st = await R.status(s.id);
  assert.deepEqual([st.files.stalled, st.files.waiting, st.files.to_send, st.files.counted], [true, 9, 9, 40]);
  assert.deepEqual(st.uploads.map((u) => [u.state, u.source, u.pc, u.to_send, u.stalled]), [["sealed", "pc", "PHOTO-PC", 9, 9]]);
  assert.deepEqual(F.filesView(st, { now: Date.now(), viewer: { device_id: null } }).lines[0].text,
    "Checks stopped after 14 days - 9 files never reached OneDrive. Open DCR Desktop on PHOTO-PC and let it send them. If PHOTO-PC lost them, copy the card again there, or leave them out.");
  const page1 = (await clientAs(E, me.id).rpc("photo_shoot_files_page", { p_shoot: s.id, p_filter: null, p_after: null, p_limit: 500 })).data;
  assert.equal(page1.files.filter((x) => x.stalled === true && x.upload_step === "to_send").length, 9);
  // a recount (a check) keeps the folder's counts: its seeded ones plus its rows'
  await R.check(s.id);
  const again = await R.status(s.id);
  assert.deepEqual([again.files.counted, again.files.confirmed, again.files.waiting, again.files.to_send], [40, 31, 9, 9]);
});

test("the demo's round 8 (OD §3.2.8, §6.6, §10.6, §26): each hand-in's send_files / send_bytes are its rows not left out or removed - the phone's sending line's totals and time left, a file left out during the send out of them at once; files.stalled and the help stalled hold only while a stalled row is left - never \"0 files never reached OneDrive\" once they are sent", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  const me = await person("field");
  useClient(clientAs(E, me.id));
  const key = "pk_" + "W".repeat(22);
  const b = await R.begin(s.id, { clientKey: "CLIENTKEY_ROUND8_0001", deviceKey: key, label: "iPhone" });
  const list = [{ path: "IMG_8001.JPG", size: 4000000, md5: "FAKEqx000000000000000008001=" },
    { path: "IMG_8002.JPG", size: 5000000, md5: "FAKEqx000000000000000008002=" },
    { path: "MVI_8003.MP4", size: 900000000, md5: "FAKEqx000000000000000008003=" }];
  const r = await R.record(b.upload.id, list);
  await R.seal(b.upload.id, 3, 909000000);
  const up = () => E.rows.photo_shoot_uploads.find((u) => u.id === b.upload.id);
  Object.assign(up(), { source: "pc", pc_label: "PHOTO-PC" });
  const rowOf = (i) => E.rows.photo_shoot_files.find((y) => y.id === r.byIndex[i].file_id);
  const mine = async () => (await R.status(s.id)).uploads.find((u) => u.id === b.upload.id);
  let u = await mine();
  assert.deepEqual([u.files, u.bytes, u.send_files, u.send_bytes], [3, 909000000, 3, 909000000], "nothing left out: the seal's figures");
  // the two photos sent, then the video left out during the send (DCR Desktop's Leave it out)
  Object.assign(rowOf(0), { upload_step: "committed", drive_file_id: "01FAKEPHROUND80001" });
  Object.assign(rowOf(1), { upload_step: "committed", drive_file_id: "01FAKEPHROUND80002" });
  await R.beat(b.upload.id, { state: "sending", bytesSent: 9000000, sentFiles: 2, rateBps: 2500000 });
  const line = async () => F.filesView(await R.status(s.id), { now: Date.now(), viewer: { device_id: null } }).lines[0];
  assert.deepEqual([(await line()).code, (await line()).text], ["sending", "Sending to OneDrive from PHOTO-PC: 2 of 3 files (8.6 MB of 867 MB) - about 10 min left."]);
  Object.assign(rowOf(2), { state: "removed", removed_reason: "left_out", removed_by: me.id });
  u = await mine();
  assert.deepEqual([u.files, u.bytes, u.send_files, u.send_bytes], [3, 909000000, 2, 9000000], "the left-out video out of the totals; files / bytes keep the seal's");
  // (a row of it still to send, so its line still tells its send: a third photo put back to send under it)
  E.rows.photo_shoot_files.push(Object.assign({}, rowOf(0), { id: 999801, path: "IMG_8004.JPG", path_key: "img_8004.jpg", size: 1000000,
    md5: "FAKEqx000000000000000008004=", upload_step: "to_send", drive_file_id: null }));
  assert.deepEqual([(await line()).code, (await line()).text], ["sending", "Sending to OneDrive from PHOTO-PC: 2 of 3 files (8.6 MB of 9.5 MB) - about 5 min left."],
    "never the seal's 867 MB and about 10 min left for a video that will not be sent");
  E.rows.photo_shoot_files.pop();
  // files.stalled and the help stalled: the stamp AND a stalled row left
  const f = E.rows.photo_drive_folders.find((x) => x.shoot_id === s.id && x.kind === "shoot");
  Object.assign(rowOf(2), { state: "waiting", removed_reason: null, removed_by: null });
  Object.assign(f, { stalled_at: new Date().toISOString(), help: ["stalled"] });
  up().sealed_at = new Date(Date.now() - 15 * 86400e3).toISOString();
  up().send_beat_at = new Date(Date.now() - 600e3).toISOString();
  // (and no progress for 15 days: stalled counts from the hand-in's own last progress too - review round 9)
  up().progress_at = new Date(Date.now() - 15 * 86400e3).toISOString();
  let st = await R.status(s.id);
  assert.deepEqual([st.files.stalled, st.help, st.uploads[0].stalled], [true, ["stalled"], 1]);
  assert.equal(F.filesView(st, { now: Date.now(), viewer: { device_id: null } }).lines[0].text,
    "Checks stopped after 14 days - 1 file never reached OneDrive. Open DCR Desktop on PHOTO-PC and let it send it. If PHOTO-PC lost it, copy the card again there, or leave it out.");
  // the video sent (in OneDrive, checking) before the next tick: the stamp is still there, but no stalled row is left
  Object.assign(rowOf(2), { upload_step: "committed", drive_file_id: "01FAKEPHROUND80003" });
  st = await R.status(s.id);
  assert.ok(f.stalled_at, "the stamp is the tick's to clear");
  assert.deepEqual([st.files.stalled, st.help], [false, []], "never \"0 files never reached OneDrive\" between their send and the next tick");
  assert.ok(F.filesView(st, { now: Date.now(), viewer: { device_id: null } }).lines.every((l) => l.code !== "stalled"));
});

test("the demo's round 9 (OD §4.5, §5.6, §6.6, §27): a row is stalled 14 days after its hand-in's own last progress too - a PC switched on again and sending it reads the sending line, never \"Checks stopped after 14 days\"; the help late and stalled only while the shoot's sealed files wait (a problem speaks for the shoot); the beat names the shoot the hand-in is in; done keeps DCR's own item on a row of its hand-in left out meanwhile, still not_waiting", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  const me = await person("field");
  useClient(clientAs(E, me.id));
  const key = "pk_" + "N".repeat(22);
  const DAY = 86400e3;
  const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
  // (every row read again each time: the demo's writes put a new row in its place)
  const upOf = (id) => E.rows.photo_shoot_uploads.find((u) => u.id === id);
  const fold = () => E.rows.photo_drive_folders.find((x) => x.shoot_id === s.id && x.kind === "shoot");
  const view = async () => F.filesView(await R.status(s.id), { now: Date.now(), viewer: { device_id: null } });
  const facts = async (id) => { const st = await R.status(s.id); return [st.uploads.find((u) => u.id === id).stalled, st.files.stalled, st.help]; };
  /** a hand-in of `n` files sealed `days` ago, then made a PC's (the demo's phone RPCs make it) -> its id */
  async function sealed(tag, n, days) {
    const b = await R.begin(s.id, { clientKey: "CLIENTKEY_ROUND9_" + tag, deviceKey: key, label: "iPhone" });
    const list = Array.from({ length: n }, (_, i) => ({ path: "IMG_9" + tag + i + ".JPG", size: 1000 + i, md5: "FAKEqx" + String(9000 + i).padStart(20, "0") + tag + "=" }));
    await R.record(b.upload.id, list);
    await R.seal(b.upload.id, n, list.reduce((t, f) => t + f.size, 0));
    Object.assign(upOf(b.upload.id), { source: "pc", pc_label: "PHOTO-PC", sealed_at: ago(days) });
    return b.upload.id;
  }
  // 1. a hand-in sealed 20 days ago, nothing moved since: its 2 rows are stalled, the stamp is there (B: a fresher
  // hand-in of the same computer, sealed just now - a seal lets the stamps go, so it comes first)
  const A = await sealed("A", 2, 20);
  const B = await sealed("B", 1, 0.01);
  assert.equal(upOf(B).pc_id, upOf(A).pc_id, "(the same computer)");
  Object.assign(fold(), { stalled_at: new Date().toISOString(), help: ["stalled"] });
  assert.deepEqual(await facts(A), [2, true, ["stalled"]]);
  assert.equal((await view()).lines[0].code, "stalled");
  // another hand-in of the same computer moving is not this hand-in's progress (its own, never its computer's)
  upOf(B).progress_at = new Date().toISOString();
  assert.deepEqual(await facts(A), [2, true, ["stalled"]], "its computer moving another hand-in: still stalled");
  // its PC switched on again and sending it: progress - never stalled while it moves
  const b1 = await R.beat(A, { state: "sending", bytesSent: 400, sentFiles: 0, rateBps: 1000 });
  assert.ok(Date.parse(upOf(A).progress_at) > Date.now() - 60e3, "the beat's bytes grew: its progress");
  assert.deepEqual(await facts(A), [0, false, []], "its PC sends again: no stalled row, no files.stalled, no help stalled");
  assert.ok(fold().stalled_at, "(the stamp is the tick's to clear)");
  assert.ok((await view()).lines.every((l) => l.code !== "stalled"), "never \"Checks stopped after 14 days\" over the files being sent");
  // 14 days after that progress: stalled again
  upOf(A).progress_at = ago(15);
  assert.deepEqual(await facts(A), [2, true, ["stalled"]], "14 days after its last progress: stalled again");
  // the beat names the shoot the hand-in is in now (a plan mirrored again moves it; the phone reads none of it)
  assert.deepEqual([b1.ok, b1.upload.id, b1.upload.shoot_id], [true, A, s.id]);
  // 2. late and stalled only while the shoot's sealed files wait: a problem speaks for the shoot until it is sorted out
  Object.assign(fold(), { late_at: new Date().toISOString(), help: ["late", "problem", "stalled"] });
  assert.deepEqual((await R.status(s.id)).help, ["late", "stalled"], "waiting, no problem: late and stalled");
  fold().mismatch = 1;
  let st = await R.status(s.id);
  assert.deepEqual(st.help, ["problem"], "a problem: neither late nor stalled beside it");
  assert.deepEqual([st.files.late, st.files.stalled], [true, true], "(the status's files keep their stamps' facts)");
  fold().mismatch = 0;
  assert.deepEqual((await R.status(s.id)).help, ["late", "stalled"], "sorted out: they speak again");
  // nothing waiting any more (every sealed file in OneDrive): neither
  const waiting0 = fold().waiting;
  fold().waiting = 0;
  assert.deepEqual((await R.status(s.id)).help, [], "nothing waits: no late, no stalled");
  fold().waiting = waiting0;
  Object.assign(fold(), { late_at: null, stalled_at: null, help: [] });
  // 3. done on a row of its hand-in left out meanwhile (its last chunk landed, its batched done waited); a row of another
  // hand-in, D, is never this done's
  const D = await sealed("D", 1, 0.01);
  const dId = E.rows.photo_shoot_files.find((x) => x.last_upload_id === D).id;
  const C = await R.begin(s.id, { clientKey: "CLIENTKEY_ROUND9_C", deviceKey: key, label: "iPhone" });
  const files = [["Phone/IMG_9C0.JPG", 2001], ["Phone/IMG_9C1.JPG", 2002], ["Phone/IMG_9C2.JPG", 2001], ["Phone/IMG_9C3.JPG", 2004]];
  const rc = await R.record(C.upload.id, files.map(([path, size], i) => ({ path, size, md5: "FAKEqx" + String(9100 + i).padStart(21, "0") + "=" })));
  const ids = files.map((_, i) => rc.byIndex[i].file_id);
  await R.sessions(C.upload.id, key, ids.map((id) => ({ file_id: id })));
  const row = (id) => E.rows.photo_shoot_files.find((x) => x.id === id);
  const ITEM = (i) => "01FAKEPHROUND9C" + i + "00";
  const item = (i, o) => Object.assign({ id: 9900 + i, item_id: ITEM(i), folder_id: fold().id, path: files[i][0], size: files[i][1], qx: null,
    later_qx: null, by_app: true, created_at: new Date().toISOString() }, o || {});
  // F (0): DCR's own item; G (1): an item not made by DCR; H (2): F's item (the same size) - another row's; K (3): left
  // out by a cancel, not by a person
  E.rows.demo_photo_items.push(item(0), item(1, { by_app: false }), item(3));
  for (const i of [0, 1, 2]) Object.assign(row(ids[i]), { state: "removed", removed_reason: "left_out", removed_by: me.id });
  Object.assign(row(ids[3]), { state: "removed", removed_reason: "cancelled", removed_by: me.id });
  Object.assign(row(dId), { state: "removed", removed_reason: "left_out", removed_by: me.id, size: 2004 });
  const d = await R.done(C.upload.id, key, [{ file_id: ids[0], item_id: ITEM(0) }, { file_id: ids[1], item_id: ITEM(1) },
    { file_id: ids[2], item_id: ITEM(0) }, { file_id: ids[3], item_id: ITEM(3) }, { file_id: dId, item_id: ITEM(3) }]);
  assert.deepEqual(d.items, ids.concat([dId]).map((id) => ({ file_id: id, code: "not_waiting" })), "still not_waiting, every one");
  assert.deepEqual(ids.concat([dId]).map((id) => [row(id).state, row(id).removed_reason, row(id).drive_file_id, row(id).upload_step]), [
    ["removed", "left_out", ITEM(0), "committed"], ["removed", "left_out", null, "session"], ["removed", "left_out", null, "session"],
    ["removed", "cancelled", null, "session"], ["removed", "left_out", null, "to_send"]],
    "only DCR's own item of the row's size, no other row's, kept on this hand-in's row a person left out");
});

test("the demo's round 10 (OD §3.2.5, §3.2.8, §6.6, §28): photo_upload_beat takes disk_full - the PC's disk full while it sends - and the phone's Files line says so while the beat is fresh, even once late is stamped (paused_pc or late once it is old); a hand-in queued behind a send of its own computer (its own last beat waiting_turn, another hand-in of that computer beating sending under 2 minutes old) is never stalled - no stalled row, files.stalled, help stalled, file-list stalled or stalled line; stalled again once that send's beat is old, and a hand-in with no such beat keeps the ask", { skip }, async () => {
  const E = await engine();
  const me = await person("field");
  useClient(clientAs(E, me.id));
  const key = "pk_" + "X".repeat(22);
  const DAY = 86400e3;
  const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
  const upOf = (id) => E.rows.photo_shoot_uploads.find((u) => u.id === id);
  /** a hand-in of `n` files into shoot `s` sealed `days` ago, then made a PC's (the demo's phone RPCs make it) -> its id */
  async function sealed(s, tag, n, days) {
    const b = await R.begin(s.id, { clientKey: "CLIENTKEY_ROUND10_" + tag, deviceKey: key, label: "iPhone" });
    const list = Array.from({ length: n }, (_, i) => ({ path: "IMG_10" + tag + i + ".JPG", size: 1000 + i, md5: "FAKEqx" + String(10000 + i).padStart(20, "0") + tag + "=" }));
    await R.record(b.upload.id, list);
    await R.seal(b.upload.id, n, list.reduce((t, f) => t + f.size, 0));
    Object.assign(upOf(b.upload.id), { source: "pc", pc_label: "PHOTO-PC", sealed_at: ago(days) });
    return b.upload.id;
  }
  // 1. this computer's disk full while it sends: a beat state of its own, its words while the beat is fresh
  const s1 = bareShoot(E);
  const fold1 = () => E.rows.photo_drive_folders.find((x) => x.shoot_id === s1.id && x.kind === "shoot");
  const view1 = async () => F.filesView(await R.status(s1.id), { now: Date.now(), viewer: { device_id: null } }).lines[0];
  const K = await sealed(s1, "K", 3, 0.01);
  const bk = await R.beat(K, { state: "disk_full", bytesSent: 0, sentFiles: 0 });
  assert.deepEqual([bk.ok, bk.upload.send_state, (await R.status(s1.id)).uploads.find((u) => u.id === K).send_state], [true, "disk_full", "disk_full"]);
  assert.deepEqual(await view1(), { code: "disk_full", tone: "warn",
    text: "PHOTO-PC is out of disk space - free some space there and DCR goes on by itself. Nothing is lost." });
  fold1().late_at = new Date().toISOString();                           // (the tick stamped late before the disk filled)
  assert.equal((await view1()).code, "disk_full", "a fresh disk_full beat: never \"is PHOTO-PC on and online\"");
  upOf(K).send_beat_at = new Date(Date.now() - 300e3).toISOString();
  assert.equal((await view1()).code, "late", "its beat 5 minutes old, late stamped: late (DCR Desktop may be closed there)");
  fold1().late_at = null;
  assert.equal((await view1()).code, "paused_pc", "its beat 5 minutes old: DCR Desktop is not open there");
  // 2. a hand-in queued behind a send of its own computer: A sealed 20 days ago, B of the same computer sending now
  const s2 = bareShoot(E);
  const fold2 = () => E.rows.photo_drive_folders.find((x) => x.shoot_id === s2.id && x.kind === "shoot");
  const A = await sealed(s2, "A", 2, 20);
  const B = await sealed(s2, "B", 1, 0.01);
  assert.equal(upOf(B).pc_id, upOf(A).pc_id, "(the same computer)");
  Object.assign(fold2(), { stalled_at: new Date().toISOString(), help: ["stalled"] });
  const facts = async () => {
    const st = await R.status(s2.id);
    const page2 = (await clientAs(E, me.id).rpc("photo_shoot_files_page", { p_shoot: s2.id, p_filter: null, p_after: null, p_limit: 500 })).data;
    return [st.uploads.find((u) => u.id === A).stalled, st.files.stalled, st.help, page2.files.filter((x) => x.stalled === true).length,
      F.filesView(st, { now: Date.now(), viewer: { device_id: null } }).lines.some((l) => l.code === "stalled")];
  };
  assert.deepEqual(await facts(), [2, true, ["stalled"], 2, true], "nothing sends: A's 2 rows stalled");
  await R.beat(A, { state: "waiting_turn", bytesSent: 0, sentFiles: 0 });
  await R.beat(B, { state: "sending", bytesSent: 0, sentFiles: 0, rateBps: 1000 });
  assert.equal(upOf(A).progress_at || null, null, "(a waiting_turn beat is no progress)");
  assert.deepEqual(await facts(), [0, false, [], 0, false], "queued behind B on its own computer: never stalled");
  assert.ok(fold2().stalled_at, "(the stamp is the tick's to clear)");
  // the send ahead stopped (its beat over 2 minutes old): stalled again
  upOf(B).send_beat_at = new Date(Date.now() - 180e3).toISOString();
  assert.deepEqual(await facts(), [2, true, ["stalled"], 2, true], "the send ahead stopped: stalled again");
  // a hand-in with no waiting_turn beat - its computer never sends it now (its person signed out there) - keeps the ask
  upOf(B).send_beat_at = new Date().toISOString();
  await R.beat(A, { state: "paused", bytesSent: 0, sentFiles: 0 });
  assert.deepEqual(await facts(), [2, true, ["stalled"], 2, true], "no waiting_turn beat of its own: still stalled");
  // another computer sending is not its own computer's send
  await R.beat(A, { state: "waiting_turn", bytesSent: 0, sentFiles: 0 });
  upOf(B).pc_id = upOf(A).pc_id + 1000;
  assert.deepEqual(await facts(), [2, true, ["stalled"], 2, true], "another computer's send: still stalled");
});

test("the phone's files go to marketing: Mark done at the site, the phone hands the files in, the ready check fires once - the Ready card's Open in OneDrive is the folder's link (link_ok), for the marketing member the office shared it with", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  s.status = "done";
  s.done_at = new Date(Date.now() - 3600e3).toISOString();
  const field = await person("field");
  useClient(clientAs(E, field.id));
  const ps = P.createPhoneSend(Object.assign(fastParts(E, memoryStorage()), { by: "Jordan", document: null, window: null }));
  await ps.start(await ps.plan(s.id, [new PickedFile("IMG_0201.JPG", U + 5, 51)]));
  await until(() => ps.view().phase === "sealed", 6000, "sealed");
  await ps.dispose();
  const m = E.rows.photo_marketing.find((x) => x.shoot_id === s.id);
  assert.ok(m && m.state === "ready", "on the Ready list once");
  await open(E, "viewer", "?ready=" + m.id);
  await until(() => document.querySelector('#shDScroll [data-act="r-open"]'), 6000, "the card");
  const href = document.querySelector('#shDScroll [data-act="r-open"]').getAttribute("href");
  assert.ok(linkOk(href), href);
  assert.equal(href, E.rows.photo_drive_folders.find((f) => f.id === m.folder_id).drive_link);
  assert.equal(document.querySelector('#shDScroll [data-act="r-open"]').textContent, WORDS.ready.btn_open);
});

/* ── the OneDrive review's round 2 (DCR Desktop 2 docs/PHOTO-FILES-ONEDRIVE.md §20) ── */

test("the phone's video still checking in OneDrive, picked again on the shoot sheet (OD §3.3 step 2; review round 2): the hand-in the pick began is cancelled again - no empty hand-in left open, only \"1 file was already here and was skipped.\" (no big-video line), Add photos and videos again; once OneDrive's hash comes the done shoot goes to marketing", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  s.status = "done";
  s.done_at = new Date(Date.now() - 3600e3).toISOString();
  dev(E).state({ hashLate: true });
  await open(E, "field", "?shoot=" + s.id);
  await filesRead(s.id);
  const vid = new PickedFile("C0001.MOV", 3 * U + 11, 141);
  await page._test.pickFiles(s.id, [vid], false);
  const ps = page._test.phone();
  await until(() => ps.view().phase === "sealed", 8000, () => "sealed: " + JSON.stringify(ps.view()));
  assert.equal(ps.view().lines.at(-1).text, WORDS.files.checking_one, "\"checking the last one\"");
  // unsure, the photographer picks the video again (as if it were a big one: the page's big-video line first)
  const realPlan = ps.plan;
  ps.plan = async (...a) => {
    const p = await realPlan(...a);
    const big = { group: "copy", code: "big_phone", text: WORDS.copy.big_phone.replace("{size}", "6.2 GB").replace("{left}", "20 min"), tone: "" };
    return Object.assign(p, { big: [{ size: 6657199308 }], lines: p.lines.concat([big]) });
  };
  try {
    await page._test.pickFiles(s.id, [vid], false);
  } finally { ps.plan = realPlan; }
  assert.deepEqual(dev(E).uploads(s.id).map((u) => [u.source, u.state]), [["phone", "sealed"], ["phone", "cancelled"]],
    "the hand-in the pick began is cancelled again - never left open with nothing in it");
  assert.equal(ps.view().phase, "cancelled");
  await page._test.readFiles(s.id);
  const said = text("shDScroll");
  assert.ok(said.includes(WORDS.copy.skipped_same_one), said);
  assert.ok(!said.includes("Big videos go best from DCR Desktop"), "nothing goes: no big-video line - " + said);
  assert.ok(acts().includes("files-add-phone"), acts().join(", "));
  for (const a of ["files-hand-in", "files-cancel", "files-pick-rest"]) assert.ok(!acts().includes(a), a + " is not offered: " + acts().join(", "));
  const st = await R.status(s.id);
  assert.deepEqual(st.uploads.filter((u) => u.state === "open" || u.state === "abandoned"), [], "no open hand-in holds the shoot's Ready");
  // OneDrive's hash comes; a check confirms the video and the done shoot goes on the Ready list
  assert.equal(dev(E).hashNow(), 1);
  const after = await R.check(s.id);
  assert.equal(after.files.state, "confirmed");
  const m = E.rows.photo_marketing.find((x) => x.shoot_id === s.id);
  assert.ok(m && m.state === "ready", "on the Ready list: " + JSON.stringify(after.completion));
});

test("the demo's recopied keeps what a cancel puts back (the migration's photo_upload_files and app.photo_upload_end; review round 2): a phone's file sent back after its seal, picked again, then Cancel it - the row is back under the sealed phone hand-in and the Files line says resend_phone again", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  const hook = { fn: null };
  await open(E, "field", "?shoot=" + s.id, memoryStorage(), hook);
  await filesRead(s.id);
  const a = new PickedFile("IMG_0611.HEIC", 2 * U + 11, 151);
  await page._test.pickFiles(s.id, [a], false);
  await until(() => lines()[0] === "confirmed", 8000, () => "the ✓ line: " + lines().join(", "));
  const first = dev(E).uploads(s.id)[0];
  const row = E.rows.photo_shoot_files.find((r) => r.path === "Phone/IMG_0611.HEIC");
  Object.assign(row, { state: "waiting", upload_step: "to_send", confirmed_at: null, drive_file_id: null, drive_md5: null });
  // (its item went: nothing of it in OneDrive any more)
  const items = E.rows.demo_photo_items;
  items.splice(items.findIndex((x) => x.path === row.path && x.folder_id === row.folder_id), 1);
  const f = E.rows.photo_drive_folders.find((x) => x.shoot_id === s.id && x.kind === "shoot");
  Object.assign(f, { confirmed: f.confirmed - 1, waiting: (f.waiting || 0) + 1, files_state: "waiting" });
  await page._test.readFiles(s.id);
  assert.equal(lines()[0], "resend_phone");
  // picked again; its bytes never get through (no connection), and the photographer cancels it
  hook.fn = (req) => (req.method === "PUT" ? "drop" : undefined);
  await page._test.pickFiles(s.id, [a], false);
  const ps = page._test.phone();
  const took = () => E.rows.photo_shoot_files.find((r) => r.id === row.id);
  await until(() => took().last_upload_id !== first.id, 6000, "recopied");
  assert.deepEqual([took().prev_size, took().prev_md5, took().prev_upload_id], [a.size, qx(a), first.id], "what a cancel puts back, kept");
  await ps.cancel();
  hook.fn = null;
  // the file is the shoot's own, put back - never one to "ask the office to delete" (the cancel's removed_sent, 0;
  // review round 4)
  assert.deepEqual(ps.view().lines.filter((l) => /^cancelled_sent/.test(l.code)).map((l) => l.text), [], "no cancelled_sent over a put back file");
  const back = took();
  assert.deepEqual([back.last_upload_id, back.state, back.counted, back.size, back.md5, back.prev_md5], [first.id, "waiting", true, a.size, qx(a), null],
    "back under its phone's sealed hand-in, as it was");
  assert.deepEqual(dev(E).uploads(s.id).map((u) => u.state), ["sealed", "cancelled"]);
  await page._test.readFiles(s.id);
  assert.equal(lines()[0], "resend_phone", "only that phone picking it again sends it: " + lines().join(", "));
  assert.ok(acts().includes("files-add-phone"));
  // and a recopied row that is handed in loses what a cancel would put back
  await page._test.pickFiles(s.id, [a], false);
  await until(() => dev(E).uploads(s.id).filter((u) => u.state === "sealed").length === 2, 8000, "handed in again");
  assert.deepEqual([took().state, took().prev_md5, took().prev_upload_id], ["confirmed", null, null]);
  // OneDrive kept a broken copy (the row still has its item): the recopied row holds a pending Replace of it, as the
  // migration's recopied does
  const E2 = await engine();
  const s2 = bareShoot(E2);
  useClient(clientAs(E2, (await person("field")).id));
  const key = "pk_" + "Q".repeat(22);
  const one = await R.begin(s2.id, { clientKey: "CLIENTKEY_00000000p1", deviceKey: key, label: "iPhone" });
  const r1 = await R.record(one.upload.id, [{ path: "Phone/IMG_0612.HEIC", size: 1000, md5: "FAKEqx000000000000000000612=" }]);
  await R.seal(one.upload.id, 1, 1000);
  const kept = E2.rows.photo_shoot_files.find((r) => r.id === r1.byIndex[0].file_id);
  Object.assign(kept, { state: "waiting", upload_step: "to_send", drive_file_id: "01FAKEPHBROKEN0612" });
  const two = await R.begin(s2.id, { clientKey: "CLIENTKEY_00000000p2", deviceKey: key, label: "iPhone" });
  const r2 = await R.record(two.upload.id, [{ path: "Phone/IMG_0612.HEIC", size: 1000, md5: "FAKEqx000000000000000000612=" }]);
  assert.deepEqual([r2.byIndex[0].verdict, r2.byIndex[0].send], ["recopied", true]);
  const now2 = E2.rows.photo_shoot_files.find((r) => r.id === kept.id);
  assert.deepEqual([now2.last_upload_id, now2.replace_upload_id, now2.prev_upload_id], [two.upload.id, two.upload.id, one.upload.id]);
  await R.cancel(two.upload.id);
  assert.equal(E2.rows.photo_shoot_files.find((r) => r.id === kept.id).last_upload_id, one.upload.id, "put back by the cancel");
});

test("the page's Cancel it after a file it recorded over the shoot's own reached OneDrive (OD §5.5, review round 4): that file is put back as the shoot's - never \"ask the office to delete it\"; a removed file in OneDrive is counted", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  const hook = { fn: null };
  await open(E, "field", "?shoot=" + s.id, memoryStorage(), hook);
  await filesRead(s.id);
  const a = new PickedFile("IMG_0621.HEIC", 2 * U + 11, 161);
  await page._test.pickFiles(s.id, [a], false);
  await until(() => lines()[0] === "confirmed", 8000, () => "the ✓ line: " + lines().join(", "));
  const first = dev(E).uploads(s.id)[0];
  const row = E.rows.photo_shoot_files.find((r) => r.path === "Phone/IMG_0621.HEIC");
  Object.assign(row, { state: "waiting", upload_step: "to_send", confirmed_at: null, drive_file_id: null, drive_md5: null });
  const items = E.rows.demo_photo_items;
  items.splice(items.findIndex((x) => x.path === row.path && x.folder_id === row.folder_id), 1);
  const f = E.rows.photo_drive_folders.find((x) => x.shoot_id === s.id && x.kind === "shoot");
  Object.assign(f, { confirmed: f.confirmed - 1, waiting: (f.waiting || 0) + 1, files_state: "waiting" });
  await page._test.readFiles(s.id);
  assert.equal(lines()[0], "resend_phone");
  // picked again beside a new video: the photo reaches OneDrive under this hand-in; the video's bytes never get through
  const b = new PickedFile("C0621.MOV", 3 * U + 5, 162);
  const range = (req) => (req.method === "PUT" ? / (\d+)-(\d+)\/(\d+)$/.exec((req.headers || {})["Content-Range"] || "") : null);
  hook.fn = (req) => { const m = range(req); return m && Number(m[3]) === b.size ? "drop" : undefined; };
  await page._test.pickFiles(s.id, [a, b], false);
  const ps = page._test.phone();
  const took = () => E.rows.photo_shoot_files.find((r) => r.id === row.id);
  await until(() => took().last_upload_id !== first.id && took().state === "confirmed", 8000, () => "the photo in: " + JSON.stringify(took()));
  await ps.cancel();
  hook.fn = null;
  assert.deepEqual(dev(E).uploads(s.id).map((u) => u.state), ["sealed", "cancelled"]);
  assert.equal(took().last_upload_id, first.id, "the photo put back as the shoot's own file");
  assert.deepEqual(ps.view().lines.filter((l) => /^cancelled_sent/.test(l.code)).map((l) => l.text), [],
    "never \"1 file had already reached OneDrive - … ask the office to delete it\" for the shoot's own photo");
  // a NEW file of the cancelled hand-in that reached OneDrive is counted (the cancel's removed_sent)
  hook.fn = (req) => { const m = range(req); return m && Number(m[3]) === b.size ? "drop" : undefined; };
  const c = new PickedFile("IMG_0622.HEIC", U + 7, 163);
  await page._test.pickFiles(s.id, [c, b], false);
  await until(() => { const r = E.rows.photo_shoot_files.find((x) => x.path === "Phone/IMG_0622.HEIC"); return r && r.drive_file_id; }, 8000, "the new photo in");
  await page._test.phone().cancel();
  hook.fn = null;
  assert.deepEqual(page._test.phone().view().lines.filter((l) => /^cancelled_sent/.test(l.code)).map((l) => l.text), [WORDS.copy.cancelled_sent_one]);
});

test("the demo's cancel gives a recopied row back by OD §5.3's ONE put back rule (the migration's app.photo_upload_end; OD §23 - §25, review rounds 5 - 7): to its earlier hand-in with its earlier size and hash, never with a verdict no read has made since - to be sent again over its item, at that step with its pending Replace, also after a session of the row's own bytes unless they are known in its item; with an item, waiting / committed and read by id at the check the cancel brings (never confirmed unread, never Ready before that read); an item of other bytes let go and counted; missing again as it was; past sending with its item gone, its earlier item back; else to send at its earlier step; a row left out or kept with OneDrive's copy meanwhile stays so; every row put back stamped back_at; removed_sent counts every removed row whose bytes may be in OneDrive", { skip }, async () => {
  const QA = "FAKEqx000000000000000000631=", QB = "FAKEqx000000000000000000632=";
  const T0 = "2026-11-10T10:00:00.000Z", T1 = "2026-11-11T09:00:00.000Z";
  let n = 0;
  /** A sealed phone hand-in's row (Phone/IMG_0631.HEIC, 1000 bytes, hash QA) put in its state `before`, picked again by a
      second hand-in (recopied, beside new files), what that hand-in got done (`during`), then Cancel it. */
  async function world(o) {
    const E = await engine();
    const s = bareShoot(E);
    if (o.done) Object.assign(s, { status: "done", done_at: new Date(Date.now() - 3600e3).toISOString() });
    useClient(clientAs(E, (await person("field")).id));
    const key = "pk_" + "V".repeat(22);
    const tag = String(++n).padStart(2, "0");
    const one = await R.begin(s.id, { clientKey: "CLIENTKEY_0000000" + tag + "v1", deviceKey: key, label: "iPhone" });
    const r1 = await R.record(one.upload.id, [{ path: "Phone/IMG_0631.HEIC", size: 1000, md5: QA }]);
    const id = r1.byIndex[0].file_id;
    await R.sessions(one.upload.id, key, [{ file_id: id }]);       // (the folders made in OneDrive)
    await R.seal(one.upload.id, 1, 1000);
    const row = () => E.rows.photo_shoot_files.find((r) => r.id === id);
    const f = E.rows.photo_drive_folders.find((x) => x.shoot_id === s.id && x.kind === "shoot");
    const item = (itemId, qxv, size) => E.rows.demo_photo_items.push({ id: 9000 + E.rows.demo_photo_items.length, item_id: itemId, folder_id: f.id,
      path: "Phone/IMG_0631.HEIC", size: size || 1000, qx: qxv, later_qx: null, by_app: true, created_at: new Date().toISOString() });
    Object.assign(row(), { state: "waiting", upload_step: "to_send", session_at: null, sessions: 0, resends: 0, drive_file_id: null, drive_md5: null,
      drive_size: null, confirmed_at: null, verified_at: null, missing_since: null }, (typeof o.before === "function" ? o.before(one) : o.before) || {});
    if (o.item) item(o.item[0], o.item[1]);
    const two = await R.begin(s.id, { clientKey: "CLIENTKEY_0000000" + tag + "v2", deviceKey: key, label: "iPhone" });
    const r2 = await R.record(two.upload.id, [{ path: "Phone/IMG_0631.HEIC", size: 1000, md5: QA },
      { path: "Phone/IMG_0633.HEIC", size: 900, md5: "FAKEqx000000000000000000633=" },
      { path: "Phone/IMG_0634.HEIC", size: 901, md5: "FAKEqx000000000000000000634=" },
      { path: "Phone/IMG_0635.HEIC", size: 902, md5: "FAKEqx000000000000000000635=" }]);
    assert.deepEqual(r2.byIndex[0].verdict, "recopied");
    // the new files: one never sent, one whose session was handed out (none of its bytes known), one in OneDrive (done)
    const newRow = (i) => E.rows.photo_shoot_files.find((r) => r.id === r2.byIndex[i].file_id);
    Object.assign(newRow(2), { session_at: T1, upload_step: "session" });
    Object.assign(newRow(3), { drive_file_id: "01FAKEPHNEW0635", upload_step: "committed" });
    if (o.during) await o.during({ row, item, two, key, id });
    const c = await R.cancel(two.upload.id);
    return { E, s, f, c, id, one, row, key };
  }
  const was = (r) => ({ up: r.last_upload_id, state: r.state, step: r.upload_step, session_at: r.session_at, resends: r.resends, item: r.drive_file_id,
    replace: r.replace_upload_id, confirmed_at: r.confirmed_at, size: r.size, md5: r.md5, prev: r.prev_drive });
  const lineOf = async (sid) => F.filesLine(await R.status(sid), { app: "portal2", device_id: null, running_here: false }, Date.now())[0];

  // 4. no item, to send (a phone's file a check sent back): to send again under its earlier hand-in - its phone picks it
  // again (resend_phone) - its tries from 0, its earlier resends; a session the cancelled hand-in made for it forgotten
  {
    const w = await world({ before: { resends: 2 }, during: async ({ two, key, id }) => { await R.sessions(two.upload.id, key, [{ file_id: id }]); } });
    assert.deepEqual([w.c.removed, w.c.put_back, w.c.removed_sent, w.c.put_back_ids], [3, 1, 2, [w.id]],
      "removed_sent: the new file whose session was handed out and the one in OneDrive - never the one never sent, never the put back row");
    assert.deepEqual(was(w.row()), { up: w.one.upload.id, state: "waiting", step: "to_send", session_at: null, resends: 2, item: null, replace: null,
      confirmed_at: null, size: 1000, md5: QA, prev: null });
    assert.equal(w.row().sessions, 0);
    assert.ok(Date.parse(w.E.rows.photo_drive_folders.find((x) => x.id === w.f.id).next_check_at) <= Date.now(), "the folder checked now");
    assert.equal(await lineOf(w.s.id), "resend_phone");
  }
  // 4. no item, in a session: back in ITS session (its session_at), so a found item of its size is its own
  {
    const w = await world({ before: { upload_step: "session", session_at: T0, sessions: 1 } });
    assert.deepEqual([w.row().upload_step, w.row().session_at, w.row().sessions, w.row().last_upload_id], ["session", T0, 0, w.one.upload.id]);
    assert.deepEqual(w.c.put_back_ids, [w.id]);
  }
  // 0. to be sent again over its item (OD §24, review round 6): a broken copy waiting for its one resend (the
  // migration's broken_upload verdict: its item kept, a pending Replace of it by its own hand-in) - back at that step with
  // that item, its resends and its pending Replace, so its phone sends it as the Replace it was (resend_phone); never
  // committed on the broken copy (round 5's: "OneDrive got a different copy twice" for a file sent once)
  const BROKEN = "01FAKEPHBROKEN0631", BAD = "FAKEqx00000000000000000bad1=";
  {
    const w = await world({ done: true, before: (one) => ({ resends: 1, drive_file_id: BROKEN, drive_md5: BAD, drive_size: 1000, replace_upload_id: one.upload.id }) });
    assert.deepEqual(was(w.row()), { up: w.one.upload.id, state: "waiting", step: "to_send", session_at: null, resends: 1, item: BROKEN, replace: w.one.upload.id,
      confirmed_at: null, size: 1000, md5: QA, prev: null });
    assert.deepEqual([w.row().drive_md5, w.row().drive_size], [BAD, 1000], "its item's facts as they were");
    assert.deepEqual(w.c.put_back_ids, [w.id]);
    const st = await R.status(w.s.id);
    assert.deepEqual([st.files.to_send, st.files.committed], [1, 0]);
    assert.equal(await lineOf(w.s.id), "resend_phone");
    await R.check(w.s.id);
    assert.deepEqual([w.row().state, w.row().upload_step, w.row().drive_file_id], ["waiting", "to_send", BROKEN], "a check leaves a row to send alone");
    assert.ok(!w.E.rows.photo_marketing.some((m) => m.shoot_id === w.s.id), "never Ready");
  }
  // 0. the same in its session (a resend under way when the second hand-in took it): back in that session, its session_at
  {
    const w = await world({ before: { upload_step: "session", session_at: T0, resends: 1, drive_file_id: BROKEN, drive_md5: BAD } });
    assert.deepEqual(was(w.row()), { up: w.one.upload.id, state: "waiting", step: "session", session_at: T0, resends: 1, item: BROKEN, replace: null,
      confirmed_at: null, size: 1000, md5: QA, prev: null });
  }
  // 0. the same broken copy, and the cancelled hand-in made a session for the row's own bytes (OD §25, review round 7: a
  // cancel mid-upload - the item may still hold the broken copy): still a resend given back, never a spent one - back at
  // to_send with its item, its resends and its pending Replace, sent by its phone (resend_phone); never committed on the
  // broken copy (round 6's: read by id, "OneDrive got a different copy twice" for a file sent once)
  {
    const w = await world({ done: true, before: (one) => ({ resends: 1, drive_file_id: BROKEN, drive_md5: BAD, drive_size: 1000, replace_upload_id: one.upload.id }),
      during: async ({ row }) => { Object.assign(row(), { session_at: T1, upload_step: "session" }); } });
    assert.deepEqual(was(w.row()), { up: w.one.upload.id, state: "waiting", step: "to_send", session_at: null, resends: 1, item: BROKEN, replace: w.one.upload.id,
      confirmed_at: null, size: 1000, md5: QA, prev: null });
    assert.deepEqual([w.row().drive_md5, w.row().drive_size], [BAD, 1000], "its item's facts as they were");
    assert.deepEqual(w.c.put_back_ids, [w.id]);
    const st = await R.status(w.s.id);
    assert.deepEqual([st.files.to_send, st.files.committed], [1, 0], "to send by its phone, as the Replace it was");
    assert.equal(await lineOf(w.s.id), "resend_phone");
    await R.check(w.s.id);
    assert.deepEqual([w.row().state, w.row().upload_step, w.row().drive_file_id, w.row().resends], ["waiting", "to_send", BROKEN, 1],
      "a check leaves a row to send alone: its one resend still there, never spent");
    assert.ok(!w.E.rows.photo_marketing.some((m) => m.shoot_id === w.s.id), "never Ready");
  }
  // 1. the row's own bytes KNOWN in its item (OD §25): the cancelled hand-in's row committed (its last chunk landed, the
  // item read) - waiting / committed with its item, read by id at the check the cancel brings - gone, so sent again
  {
    const w = await world({ done: true, before: (one) => ({ resends: 1, drive_file_id: BROKEN, drive_md5: BAD, drive_size: 1000, replace_upload_id: one.upload.id }),
      during: async ({ row }) => { Object.assign(row(), { session_at: T1, upload_step: "committed" }); } });
    assert.deepEqual(was(w.row()), { up: w.one.upload.id, state: "waiting", step: "committed", session_at: T1, resends: 1, item: BROKEN, replace: null,
      confirmed_at: null, size: 1000, md5: QA, prev: null });
    const st = await R.status(w.s.id);
    assert.deepEqual([st.files.to_send, st.files.committed], [0, 1], "nothing to send under the sealed phone hand-in until the read");
    assert.equal(await lineOf(w.s.id), "checking");
    await R.check(w.s.id);
    assert.deepEqual([w.row().state, w.row().upload_step, w.row().drive_file_id, w.row().resends], ["waiting", "to_send", null, 2], "its item gone: sent again");
    assert.equal(await lineOf(w.s.id), "resend_phone");
    assert.ok(!w.E.rows.photo_marketing.some((m) => m.shoot_id === w.s.id), "never Ready");
  }
  // 1. the same with a read since showing another version of its item (its cTag changed under the cancelled hand-in):
  // the row's own bytes known there - read by id, never sent over
  {
    const w = await world({ done: true, before: (one) => ({ resends: 1, drive_file_id: BROKEN, drive_ctag: "FAKEctag1", drive_md5: BAD, drive_size: 1000,
      replace_upload_id: one.upload.id }), during: async ({ row }) => { Object.assign(row(), { session_at: T1, upload_step: "session", drive_ctag: "FAKEctag2" }); } });
    assert.deepEqual([w.row().state, w.row().upload_step, w.row().replace_upload_id, w.row().drive_file_id], ["waiting", "committed", null, BROKEN]);
    // its cTag as it was, and no session: a resend given back (rule 0), its earlier cTag with it
    const w2 = await world({ done: true, before: (one) => ({ resends: 1, drive_file_id: BROKEN, drive_ctag: "FAKEctag1", drive_md5: BAD, drive_size: 1000,
      replace_upload_id: one.upload.id }), during: async ({ row }) => { Object.assign(row(), { session_at: T1, upload_step: "session" }); } });
    assert.deepEqual([w2.row().upload_step, w2.row().replace_upload_id, w2.row().drive_ctag], ["to_send", w2.one.upload.id, "FAKEctag1"]);
    // other bytes recorded over the same item and a read since (its cTag changed): never the row's own bytes - rule 0, its
    // earlier size, hash and cTag back
    const w3 = await world({ done: true, before: (one) => ({ resends: 1, drive_file_id: BROKEN, drive_ctag: "FAKEctag1", drive_md5: BAD, drive_size: 1000,
      replace_upload_id: one.upload.id }), during: async ({ row }) => { Object.assign(row(), { size: 1001, md5: QB, drive_ctag: "FAKEctag2" }); } });
    assert.deepEqual([w3.row().upload_step, w3.row().drive_file_id, w3.row().drive_ctag, w3.row().size, w3.row().md5], ["to_send", BROKEN, "FAKEctag1", 1000, QA]);
  }
  // every row a cancel puts back is stamped back_at (OD §5.3, §25: late and stalled count from it as from the seal) - the
  // removed rows and rows it never held are not
  {
    const t0 = Date.now();
    const w = await world({ before: { resends: 2 } });
    assert.ok(Date.parse(w.row().back_at) >= t0, "the row put back: back_at " + w.row().back_at);
    const others = w.E.rows.photo_shoot_files.filter((r) => r.folder_id === w.f.id && r.id !== w.id);
    assert.ok(others.length === 3 && others.every((r) => r.state === "removed" && r.back_at === null), "the cancelled hand-in's own files: removed, no back_at");
    const kept = await world({ during: async ({ row }) => {
      Object.assign(row(), { state: "confirmed", size: 1001, md5: QB, drive_file_id: "01FAKEPHKEPT00631", drive_md5: QB, drive_size: 1001, confirmed_at: T1,
        resolved_at: new Date(Date.parse(row().recorded_at) + 1000).toISOString() });
    } });
    assert.ok(Date.parse(kept.row().back_at) >= t0, "kept with OneDrive's copy and given back: back_at too");
  }
  // 4. past sending and its item gone during the cancelled hand-in (the migration's: a confirmed file whose Replace read
  // it gone, recorded again by Copy the rest; the demo's recopied never meets one): its EARLIER item back, committed and
  // read by id - confirmed, then Ready; never to send under a hand-in that sent it long ago (review round 6)
  {
    const OK = "01FAKEPHOK00000631";
    const w = await world({ done: true, item: [OK, QA], during: async ({ row }) => {
      row().prev_drive = Object.assign({}, row().prev_drive, { state: "confirmed", upload_step: "done", drive_file_id: OK, drive_ctag: "FAKEctagOK", drive_md5: QA,
        drive_size: 1000, confirmed_at: T0, verified_at: T0 });
    } });
    assert.deepEqual(was(w.row()), { up: w.one.upload.id, state: "waiting", step: "committed", session_at: null, resends: 0, item: OK, replace: null,
      confirmed_at: null, size: 1000, md5: QA, prev: null });
    assert.equal(w.row().drive_ctag, "FAKEctagOK", "the earlier item's cTag back with it");
    assert.deepEqual(w.c.put_back_ids, [w.id]);
    assert.ok(!w.E.rows.photo_marketing.some((m) => m.shoot_id === w.s.id), "never Ready before that read");
    await R.check(w.s.id);
    assert.equal(w.row().state, "confirmed");
    assert.equal(w.E.rows.photo_marketing.find((m) => m.shoot_id === w.s.id).state, "ready");
  }
  // what a person did meanwhile stays (review round 6): a row left out while the cancelled hand-in held it stays left out
  // - its reason, its earlier size, hash and hand-in, so a later Put it back works (the migration's
  // photo_shoot_files_removed_shape refused the cancel for good before; the demo holds that check too) ...
  {
    const w = await world({ during: async ({ row }) => { Object.assign(row(), { state: "removed", removed_reason: "left_out" }); } });
    assert.deepEqual(was(w.row()), { up: w.one.upload.id, state: "removed", step: "to_send", session_at: null, resends: 0, item: null, replace: null,
      confirmed_at: null, size: 1000, md5: QA, prev: null });
    assert.equal(w.row().removed_reason, "left_out");
    assert.equal(w.c.removed, 3, "the cancel went through");
  }
  // ... and one settled with Keep OneDrive's copy keeps that verdict (OneDrive's size and hash, confirmed), back under
  // its earlier hand-in - never let go as "the cancelled card's file", never sent again
  {
    const KEPT = "01FAKEPHKEPT00631";
    const w = await world({ during: async ({ row }) => {
      Object.assign(row(), { state: "confirmed", size: 1001, md5: QB, drive_file_id: KEPT, drive_md5: QB, drive_size: 1001, confirmed_at: T1,
        resolved_at: new Date(Date.parse(row().recorded_at) + 1000).toISOString() });
    } });
    assert.deepEqual(was(w.row()), { up: w.one.upload.id, state: "confirmed", step: "to_send", session_at: null, resends: 0, item: KEPT, replace: null,
      confirmed_at: T1, size: 1001, md5: QB, prev: null });
    assert.deepEqual([w.c.removed_sent, w.c.put_back_ids], [2, [w.id]], "the kept file is the shoot's own: never one to delete");
  }
  // 1. its earlier item holding the row's bytes, and a session the cancelled hand-in made for them (they may be there):
  // committed, then confirmed by the check's read - and only then Ready
  {
    const w = await world({ done: true, item: ["01FAKEPHOK00000631", QA], before: { drive_file_id: "01FAKEPHOK00000631", drive_md5: QA, drive_size: 1000 },
      during: async ({ row }) => { Object.assign(row(), { session_at: T1, upload_step: "session" }); } });
    assert.deepEqual([w.row().state, w.row().upload_step, w.row().confirmed_at], ["waiting", "committed", null], "never confirmed unread");
    assert.ok(!w.E.rows.photo_marketing.some((m) => m.shoot_id === w.s.id), "never Ready before that read");
    await R.check(w.s.id);
    assert.equal(w.row().state, "confirmed");
    assert.equal(w.E.rows.photo_marketing.find((m) => m.shoot_id === w.s.id).state, "ready", "Ready after the read");
  }
  // 1. an item the cancelled hand-in made with the row's own bytes (sent and confirmed under it): the shoot's own file -
  // in put_back_ids, never one to delete - waiting / committed until the check reads it; then confirmed and Ready
  {
    const w = await world({ done: true, during: async ({ row, item }) => {
      item("01FAKEPHAGAIN00631", QA);
      Object.assign(row(), { state: "confirmed", upload_step: "done", drive_file_id: "01FAKEPHAGAIN00631", drive_md5: QA, drive_size: 1000, confirmed_at: T1, verified_at: T1 });
    } });
    assert.deepEqual([w.c.removed_sent, w.c.put_back_ids], [2, [w.id]]);
    assert.deepEqual([w.row().last_upload_id, w.row().state, w.row().upload_step, w.row().drive_file_id, w.row().confirmed_at, w.row().verified_at],
      [w.one.upload.id, "waiting", "committed", "01FAKEPHAGAIN00631", null, null]);
    assert.ok(!w.E.rows.photo_marketing.some((m) => m.shoot_id === w.s.id), "never Ready before that read");
    await R.check(w.s.id);
    assert.equal(w.row().state, "confirmed");
    assert.equal(w.E.rows.photo_marketing.find((m) => m.shoot_id === w.s.id).state, "ready");
  }
  // 2. an item the cancelled hand-in made with OTHER bytes (a Replace's new upload - the migration's; the demo's
  // recopied never makes one): the cancelled card's file is let go - counted in removed_sent, never in put_back_ids - and
  // the row goes on as 4, to send under its earlier hand-in with its own size and hash
  {
    const w = await world({ during: async ({ row }) => { Object.assign(row(), { size: 1001, md5: QB, drive_file_id: "01FAKEPHOTHER0631", drive_ctag: "FAKEctagOTHER",
      drive_md5: QB, drive_size: 1001 }); } });
    assert.deepEqual([w.c.put_back, w.c.removed_sent, w.c.put_back_ids], [1, 3, []], "the let-go item counted, the row not the shoot's own in OneDrive");
    assert.equal(w.row().drive_ctag, null, "the let-go item's cTag goes with it");
    assert.deepEqual(was(w.row()), { up: w.one.upload.id, state: "waiting", step: "to_send", session_at: null, resends: 0, item: null, replace: null,
      confirmed_at: null, size: 1000, md5: QA, prev: null });
  }
  // 3. no item, and it was missing (the migration's Copy them again over a missing row; the demo's recopied never meets
  // one): missing again, with its item and its dates - nothing in OneDrive changed for it
  {
    const w = await world({ during: async ({ row }) => {
      row().prev_drive = Object.assign({}, row().prev_drive, { state: "missing", upload_step: "done", drive_file_id: "01FAKEPHGONE00631", drive_ctag: "FAKEctagGONE",
        drive_md5: QA, drive_size: 1000, confirmed_at: T0, verified_at: T0, missing_since: T1 });
    } });
    assert.deepEqual([w.row().state, w.row().upload_step, w.row().drive_file_id, w.row().drive_ctag, w.row().confirmed_at, w.row().missing_since, w.row().session_at,
      w.row().last_upload_id], ["missing", "done", "01FAKEPHGONE00631", "FAKEctagGONE", T0, T1, null, w.one.upload.id]);
    assert.deepEqual(w.c.put_back_ids, [w.id]);
  }
  // a cancel asked again answers as the migration's photo_upload_cancel: again, no removed_sent
  {
    const w = await world({});
    const gone = w.E.rows.photo_shoot_uploads.find((u) => u.shoot_id === w.s.id && u.state === "cancelled");
    assert.deepEqual(await R.cancel(gone.id), { ok: true, state: "cancelled", removed: 0, put_back: 0, again: true });
  }
});

test("the demo answers a phone's record asked again after its answer was lost with the same row (OD §3.5; review round 2): same, send: true, its file_id - never name_taken and \" (2)\"; the page sends that row and hands in one file", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  const field = await person("field");
  useClient(clientAs(E, field.id));
  const key = "pk_" + "R".repeat(22);
  const b = await R.begin(s.id, { clientKey: "CLIENTKEY_00000000r1", deviceKey: key, label: "iPhone" });
  const first = await R.record(b.upload.id, [{ path: "Phone/IMG_0021.JPG", size: 1000 }]);
  const again = await R.record(b.upload.id, [{ path: "Phone/IMG_0021.JPG", size: 1000 }]);
  assert.deepEqual(again.byIndex[0], { file_id: first.byIndex[0].file_id, path: "Phone/IMG_0021.JPG", verdict: "same", send: true });
  assert.deepEqual(again.refused, []);
  await R.sessions(b.upload.id, key, [{ file_id: first.byIndex[0].file_id }]);
  assert.equal((await R.record(b.upload.id, [{ path: "Phone/IMG_0021.JPG", size: 1000 }])).byIndex[0].send, true, "a session made: still not sent");
  // another size under that name stays a taken name
  const other = await R.record(b.upload.id, [{ path: "Phone/IMG_0021.JPG", size: 1001 }]);
  assert.deepEqual(other.refused.map((r) => r.code), ["name_taken"]);
  // the page: photo_upload_files' answer lost once (it reached the database), ask() asks again
  const E2 = await engine();
  const s2 = bareShoot(E2);
  const c = clientAs(E2, (await person("field")).id);
  const rpc = c.rpc;
  let lost = 0;
  c.rpc = async (name, args) => {
    const r = await rpc(name, args);
    if (name === "photo_upload_files" && lost++ === 0) throw new TypeError("Failed to fetch");
    return r;
  };
  useClient(c);
  const ps = P.createPhoneSend(Object.assign(fastParts(E2, memoryStorage()), { by: "Jordan", document: null, window: null }));
  const f = new PickedFile("IMG_0022.JPG", U + 22, 152);
  await ps.start(await ps.plan(s2.id, [f]));
  await until(() => ps.view().phase === "sealed", 8000, () => "sealed: " + JSON.stringify(ps.view()));
  assert.equal(lost, 2, "asked twice");
  assert.deepEqual(dev(E2).files(s2.id).map((r) => [r.path, r.state]), [["Phone/IMG_0022.JPG", "confirmed"]], "one row, never a ' (2)' copy");
  assert.equal(dev(E2).uploads(s2.id)[0].files, 1);
  await ps.dispose();
});

test("a done shoot with no folder row under a gone job folder (OD §2.3, the ready rule; review rounds 2 and 3): its completion line is job_folder_no_hand_in - hand its files in once its job folder is back, never \"hand the files in\" now nor \"once this shoot's folder is back\"; uploads off, no line", { skip }, async () => {
  const E = await engine();
  const s = bareShoot(E);
  Object.assign(s, { status: "done", done_at: new Date(Date.now() - 3 * 86400e3).toISOString() });
  const plan = E.rows.photo_plans.find((p) => p.id === s.plan_id);
  let job = E.rows.photo_drive_folders.find((x) => x.kind === "job" && x.plan_id === s.plan_id && !x.retired_at);
  if (!job) {
    job = { id: 990002, kind: "job", plan_id: s.plan_id, tag: "Q7JOBY", name: (plan.project_label || "Sample job") + " [DCR-Q7JOBY]", drive_name: null, drive_state: "found",
      drive_link: null, retired_at: null, parent_id: null, shoot_id: null, created_at: new Date().toISOString() };
    E.rows.photo_drive_folders.push(job);
  }
  const field = await person("field");
  useClient(clientAs(E, field.id));
  let st = await R.status(s.id);
  assert.deepEqual([st.folder, st.ready_why, st.completion], [null, "no_hand_in", "no_hand_in"], "its job folder there: hand the files in");
  Object.assign(job, { drive_state: "missing", drive_state_at: new Date(Date.now() - 3600e3).toISOString() });
  st = await R.status(s.id);
  assert.deepEqual([st.folder, st.ready_why, st.completion], [null, "folder_problem", "job_folder_no_hand_in"]);
  await open(E, "field", "?shoot=" + s.id);
  await filesRead(s.id);
  assert.deepEqual(lines(), ["job_moved_out"]);
  const done = document.querySelector("#shDScroll [data-completion]");
  assert.equal(done.getAttribute("data-completion"), "job_folder_no_hand_in");
  assert.equal(done.textContent, WORDS.completion.job_folder_no_hand_in);
  assert.ok(!text("shDScroll").includes(WORDS.completion.folder_problem), "never \"once this shoot's folder is back\": it never had one");
  // uploads off for the shoot: nothing can be handed in - no line (the Files line says why)
  dev(E).state({ mode: "off" });
  st = await R.status(s.id);
  assert.equal(st.completion, null);
  dev(E).state({ mode: "on" });
});
