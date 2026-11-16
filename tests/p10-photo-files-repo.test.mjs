// The photographer screen program, P5, the OneDrive edition: site/js/repo/photo-files.js (DCR Desktop 2
// docs/PHOTO-FILES-ONEDRIVE.md §3.3, §4.5, §4.7, §5.6, §5.7, cited OD) over the demo database (tools/fake/p10-photo-files.js:
// the migrations' names, rules, SQLSTATEs and hints) and over a stub client (the function's ops the demo does not have
// yet, the build plan's P7). It reads NO table (every OneDrive name comes scrubbed from an RPC): photo_drive_status and
// photo_ready_list are its reads, photo_drive_overview an admin's (the share list); photo_marketing_act (every rule: a
// compare-and-set on the state shown, taken / changed / not_yours / too_late / withdrawn / bad_where / bad_link /
// reason_needed, again: true), the phone's hand-in RPCs (begin with p_source 'phone', the files recorded with their ids by
// i, the beat, the seal, the cancel) and the photo-files function (check - its answer a status; sessions, done, find;
// refusals with their HTTP status and Retry-After) its writes. Not available (OD §5.7): a status without mode reads
// null, as a database without P5 does; a NEW-only RPC's 42883 / PGRST202 is notAvailable. An upload address on any host
// but the published OneDrive host is never handed on. The RPCs' arguments are pinned to the migrations' signatures when
// DCR_DESKTOP2_DIR names DCR Desktop 2. The drain's memory: once per (row, ready_at), an UPDATE only when ready_at moved,
// never an old one. Made-up people, shoots and ids only.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { available, loadFake, freshEngine, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as R from "../site/js/repo/photo-files.js";
import * as F from "../site/js/map/photo-files.js";
import { ONEDRIVE_HOST } from "../site/js/repo/onedrive.js";

const skip = !available && "the demo database (tools/fake) is not here";
let FK, E, DEV;
async function setup() {
  FK = await loadFake();
  E = await freshEngine(new Date());
  DEV = E.exts.find((x) => x.name === "p10-photo-files").__dev;
}
const uid = (key) => FK.PEOPLE.find((p) => p.key === key).id;
/** as `key`; every table, rpc and function asked for recorded */
function as(key, o) {
  const opt = o || {};
  const c = clientAs(E, uid(key));
  const asked = [];
  useClient({
    from: (t) => { asked.push("table:" + t); return c.from(t); },
    rpc: async (n, a) => { asked.push("rpc:" + n + ":" + Object.keys(a || {}).join(",")); return c.rpc(n, a); },
    functions: { invoke: async (n, b) => { asked.push("fn:" + n + ":" + (b && b.body && b.body.op)); return opt.invoke ? opt.invoke(n, b) : c.functions.invoke(n, b); } },
  });
  return asked;
}
const shootOf = (code, key) => {
  const plan = E.rows.photo_plans.find((p) => p.project_code === code);
  return E.rows.photo_shoots.find((s) => s.plan_id === plan.id && s.key === key);
};
async function refused(fn, code, hint) {
  try { await fn(); } catch (e) {
    assert.equal(e.code, code, "SQLSTATE " + e.code + " (" + e.message + ")");
    if (hint) assert.equal(e.hint, hint);
    return e;
  }
  assert.fail("expected " + code + " " + (hint || ""));
}

test("the RPCs' arguments are the demo's for every RPC the demo has: sent by name, in order; no table is ever read", { skip }, async () => {
  await setup();
  for (const [fn, args] of Object.entries(FK.p10FilesSigs)) assert.deepEqual(R.RPC_ARGS[fn], args, fn);
  assert.equal(R.RPC_ARGS.photo_upload_use_drive, undefined, "Use what's in Drive is gone (OD §15)");
  const asked = as("field");
  const s = shootOf("A000T9", "lot-before");
  await R.status(s.id);
  await R.readyList("open");
  await R.readyList("done");
  await R.check(s.id);
  assert.deepEqual(asked, ["rpc:photo_drive_status:p_shoot", "rpc:photo_ready_list:p_view", "rpc:photo_ready_list:p_view", "fn:photo-files:check"]);
  assert.ok(!asked.some((a) => a.startsWith("table:")), "no table read");
});

// the migrations' own signatures (DCR Desktop 2): the newest create of each public function wins (20261114000100 over
// 20261111000100), its argument names in order
const D2 = process.env.DCR_DESKTOP2_DIR || "";
const MIGRATIONS = ["20261111000100_photo_files.sql", "20261114000100_photo_files_onedrive.sql"].map((f) => D2 && path.join(D2, "supabase", "migrations", f));
const haveD2 = !!D2 && MIGRATIONS.every((f) => existsSync(f));
function signatures(text) {
  const out = {};
  for (const m of text.matchAll(/create or replace function public\.([a-z_0-9]+)\(([^)]*)\)/g)) {
    out[m[1]] = m[2].split(",").map((a) => a.trim()).filter(Boolean).map((a) => a.split(/\s+/)[0]);
  }
  return out;
}
test("RPC_ARGS are the migrations' signatures, argument by argument (OD §5.6; DCR_DESKTOP2_DIR); the NEW-only RPCs are only in 20261114000100", { skip: !haveD2 && "DCR_DESKTOP2_DIR does not name DCR Desktop 2" }, () => {
  const old = signatures(readFileSync(MIGRATIONS[0], "utf8"));
  const neu = signatures(readFileSync(MIGRATIONS[1], "utf8"));
  const now = Object.assign({}, old, neu);
  for (const [fn, args] of Object.entries(R.RPC_ARGS)) assert.deepEqual(args, now[fn], fn);
  assert.equal(old.photo_upload_beat, undefined, "photo_upload_beat is the OneDrive edition's");
  assert.notDeepEqual(old.photo_upload_begin, neu.photo_upload_begin, "the six-argument begin is the OneDrive edition's");
  for (const fn of R.NEW_ONLY) assert.ok(neu[fn], fn);
});

test("status: the OneDrive edition's answer as each person sees it (mode, me.drive_access, can.*); 42501 for someone not on the team; PT404 no_shoot", { skip }, async () => {
  await setup();
  const s = shootOf("A000T9", "lot-before");
  as("viewer");
  const mk = await R.status(s.id);
  assert.equal(mk.mode, "on", "the OneDrive edition always answers mode");
  assert.equal(mk.files.state, "waiting");
  assert.equal(mk.me.drive_access, "shared");
  assert.equal(mk.can.open_folder, true);
  assert.equal(mk.can.hand_in, false, "marketing hands nothing in");
  assert.equal(mk.can.add_from_phone, false);
  assert.equal(mk.can.check, true, "but may check");
  assert.deepEqual(F.filesLine(mk, { app: "portal2" }, Date.now()), ["waiting"]);
  as("field");
  const ph = await R.status(s.id);
  assert.equal(ph.me.drive_access, "none", "photographers are not on the share (M10)");
  assert.equal(ph.can.open_folder, false);
  assert.equal(ph.can.add_files, true, "the photographer may hand in: the mode is on");
  assert.deepEqual(F.filesLine(ph, { app: "portal2" }, Date.now()), ["waiting", "no_access"]);
  as("lead");
  await refused(() => R.status(s.id), "42501", "forbidden");
  as("field");
  await refused(() => R.status(99999), "PT404", "no_shoot");
});

test("readyList: open (unclaimed first) and done; me and counts; a database without P5 answers null, and so does status", { skip }, async () => {
  await setup();
  as("viewer");
  const open = await R.readyList("open");
  assert.deepEqual(open.items.map((i) => i.state), ["ready", "claimed"]);
  assert.deepEqual(open.me, { drive_access: "shared", admin: false, marketing: true, can_act: true });
  assert.deepEqual(open.counts, { ready: 1, claimed: 1, mine: 0 });
  const done = await R.readyList("done");
  assert.deepEqual(done.items.map((i) => i.state), ["posted", "passed"]);
  assert.equal(done.items[0].can.reopen, true, "posted 2 days ago by me");
  assert.equal(done.items[1].can.reopen, false, "passed 20 days ago");
  as("field");
  assert.equal((await R.readyList("open")).me.can_act, false, "the photographer reads, never acts");
  DEV.state({ p5: false });
  assert.equal(await R.readyList("open"), null);
  assert.equal(await R.status(shootOf("A000T9", "lot-before").id), null);
});

// a stub client: every rpc and function call recorded, answered by `answer(kind, name, args)`
function stub(answer) {
  const calls = [];
  useClient({
    from: (t) => { calls.push(["table", t]); throw new Error("no table is read"); },
    rpc: async (n, a) => { calls.push(["rpc", n, a]); return answer("rpc", n, a); },
    functions: { invoke: async (n, b) => { calls.push(["fn", n, b && b.body]); return answer("fn", n, b && b.body); } },
  });
  return calls;
}
const reply = (status, body, headers) => ({ data: null, error: { name: "FunctionsHttpError", context: new Response(JSON.stringify(body), { status, headers }) } });
const KEY = "pk_" + "A".repeat(22);
const UP = "https://" + ONEDRIVE_HOST + "/personal/x/_api/v2.0/drives/d/items/i/uploadSession?guid=FAKE";

test("not available (OD §5.7): a status without mode (the Google edition after the OneDrive roll back) reads null - the Files section hidden; a NEW-only RPC's 42883 / PGRST202 is notAvailable, never 'no P5'", async () => {
  let st = { shoot_id: 5, root: { state: "found" }, files: { state: "confirmed" } };
  stub(() => ({ data: st, error: null }));
  assert.equal(await R.status(5), null, "no mode: not available");
  st = Object.assign({}, st, { mode: "off" });
  assert.equal((await R.status(5)).mode, "off", "with mode: the answer");
  for (const code of ["42883", "PGRST202"]) {
    stub(() => ({ data: null, error: { code, message: "function public.photo_upload_beat does not exist" } }));
    const e = await R.beat(7, { state: "sending" }).then(() => null, (x) => x);
    assert.equal(e.notAvailable, true, code);
    assert.equal(e.reason, "not_available");
    assert.equal(F.filesText({ code: "not_available" }), F.WORDS.files.not_available);
    const b = await R.begin(5, { clientKey: "ck-1", deviceKey: KEY, label: "iPhone" }).then(() => null, (x) => x);
    assert.equal(b.notAvailable, true, "the six-argument begin: " + code);
  }
  stub(() => ({ data: null, error: { code: "42883", message: "function public.photo_drive_status does not exist" } }));
  assert.equal(await R.status(5), null, "the status itself missing: a database without P5 (null)");
});

test("the phone's hand-in RPCs (OD §3.3, §5.6): begin with p_source 'phone' and a label that is never a name; the files recorded without a hash, their ids by i (send false never sent); the beat; the seal; the cancel - checked before anything is sent", async () => {
  const calls = stub((kind, name, a) => {
    if (name === "photo_upload_begin") return { data: { upload: { id: 31, state: "open", source: "phone", device_id: 9 }, replaced: null, again: false, closed: null }, error: null };
    if (name === "photo_upload_files") {
      return { data: { added: 2, same: 1, refused: [{ i: 3, path: "Phone/x.txt", code: "not_media" }], recorded_files: 2, recorded_bytes: 7000,
        files: [{ i: 0, file_id: 41, path: "Phone/IMG_0001.HEIC", verdict: "added", send: true }, { i: 1, file_id: 42, path: "Phone/IMG_0002 (2).HEIC", verdict: "added", send: true },
          { i: 2, file_id: 17, path: "Phone/IMG_0003.HEIC", verdict: "same", send: false }] }, error: null };
    }
    return { data: { ok: true, name }, error: null };
  });
  const b = await R.begin(12, { clientKey: "ck-1", deviceKey: KEY, label: "Sam's iPhone" });
  assert.equal(b.upload.id, 31);
  assert.deepEqual(calls[0], ["rpc", "photo_upload_begin", { p_shoot: 12, p_client_key: "ck-1", p_device_key: KEY, p_device_label: "phone", p_source: "phone", p_replaces: null }],
    "a label that is not one of the three is 'phone' (never a person's name)");
  assert.deepEqual(Object.keys(calls[0][2]), R.RPC_ARGS.photo_upload_begin, "by name, in order");
  await R.begin(12, { clientKey: "ck-1", deviceKey: KEY, label: "Android phone", replaces: 30 });
  assert.deepEqual([calls[1][2].p_device_label, calls[1][2].p_replaces], ["Android phone", 30]);
  const n = calls.length;
  for (const bad of [{ clientKey: "", deviceKey: KEY }, { clientKey: "ck", deviceKey: "pk_short" }, { clientKey: "ck", deviceKey: KEY.replace("pk_", "xx_") }]) {
    await assert.rejects(R.begin(12, bad), (e) => e.code === "22023", JSON.stringify(bad));
  }
  await assert.rejects(R.begin(0, { clientKey: "ck", deviceKey: KEY }), (e) => e.code === "22023");
  assert.equal(calls.length, n, "nothing sent for a bad call");
  const rec = await R.record(31, [{ path: "Phone/IMG_0001.HEIC", size: 3000, modified: "2026-11-12T19:00:00Z" }, { path: "Phone/IMG_0002.HEIC", size: 4000 },
    { path: "Phone/IMG_0003.HEIC", size: 5000 }, { path: "Phone/x.txt", size: 1 }]);
  assert.deepEqual(calls[n][2].p_files, [{ path: "Phone/IMG_0001.HEIC", size: 3000, modified: "2026-11-12T19:00:00Z" }, { path: "Phone/IMG_0002.HEIC", size: 4000 },
    { path: "Phone/IMG_0003.HEIC", size: 5000 }, { path: "Phone/x.txt", size: 1 }], "no hash on a phone's record (OD §3.3 step 4)");
  assert.deepEqual(rec.byIndex, { 0: { file_id: 41, path: "Phone/IMG_0001.HEIC", verdict: "added", send: true }, 1: { file_id: 42, path: "Phone/IMG_0002 (2).HEIC", verdict: "added", send: true },
    2: { file_id: 17, path: "Phone/IMG_0003.HEIC", verdict: "same", send: false } }, "the ids by i; another hand-in's same row is never sent");
  assert.deepEqual(rec.refused, [{ i: 3, path: "Phone/x.txt", code: "not_media" }]);
  await assert.rejects(R.record(31, []), (e) => e.code === "22023");
  await assert.rejects(R.record(31, [{ path: "", size: 1 }]), (e) => e.code === "22023");
  await assert.rejects(R.record(31, [{ path: "Phone/a.jpg", size: -1 }]), (e) => e.code === "22023");
  const m = calls.length;
  await R.beat(31, { state: "sending", bytesSent: 5242880.7, sentFiles: 1, rateBps: 900000 });
  assert.deepEqual(calls[m], ["rpc", "photo_upload_beat", { p_upload: 31, p_state: "sending", p_bytes_sent: 5242880, p_sent_files: 1, p_rate_bps: 900000 }]);
  await R.beat(31, { state: "onedrive_full", bytesSent: 0, sentFiles: 0 });
  assert.equal(calls[m + 1][2].p_rate_bps, null, "no rate yet: null");
  await assert.rejects(R.beat(31, { state: "uploading" }), (e) => e.hint === "bad_state");
  assert.equal(calls.length, m + 2, "a state the database does not know is never sent");
  await R.seal(31, 2, 7000);
  assert.deepEqual(calls[m + 2], ["rpc", "photo_upload_seal", { p_upload: 31, p_files: 2, p_bytes: 7000 }]);
  await R.cancel(31);
  assert.deepEqual(calls[m + 3], ["rpc", "photo_upload_cancel", { p_upload: 31 }]);
  for (const c of calls) assert.deepEqual(Object.keys(c[2]), R.RPC_ARGS[c[1]], c[1] + ": by name, in order");
  // a refusal of the database: a PhotoError with its hint (PT409 phone_off, uploads_test, ...)
  stub(() => ({ data: null, error: { code: "PT409", hint: "phone_off", message: "Phone uploads are off - use DCR Desktop." } }));
  const e = await R.begin(12, { clientKey: "ck", deviceKey: KEY, label: "iPhone" }).then(() => null, (x) => x);
  assert.deepEqual([e.code, e.hint, e.notAvailable], ["PT409", "phone_off", undefined]);
  assert.equal(F.hintText(e.hint), F.WORDS.hint.phone_off);
});

test("photo-files sessions / done / find (OD §4.5): the bodies; 1-20 a call; an upload address on another host - or a found item that is no item id - is never handed on; 503 uploads_off / uploads_test for the whole call", async () => {
  let answer = null;
  const calls = stub((kind, name, body) => answer(name, body));
  answer = () => ({ data: { chunk_multiple: 327680, chunk_bytes: 5242880, max_chunk_bytes: 62586880, files: [
    { file_id: 41, upload_url: UP, expires_at: "2026-11-14T00:00:00Z", path: "Phone/IMG_0001.HEIC" },
    { file_id: 42, code: "name_taken", path: "Phone/IMG_0002 (2).HEIC", upload_url: "https://example-my.sharepoint.com/personal/x/uploadSession?guid=1", expires_at: "x" },
    { file_id: 43, code: "found", item_id: "01FAKEITEM0000000000000000000000AB" },
    { file_id: 44, code: "found", item_id: "not an id" },
    { file_id: 45, code: "busy", retry_after: 5 },
    { file_id: 46, upload_url: "http://" + ONEDRIVE_HOST + "/x" }] }, error: null });
  const s = await R.sessions(31, KEY, [{ file_id: 41 }, { file_id: 42, md5: "FAKEhashAAAAAAAAAAAAAAAAAAA=" }, { file_id: 43 }, { file_id: 44 }, { file_id: 45 }, { file_id: 46 }]);
  assert.deepEqual(calls[0], ["fn", "photo-files", { op: "sessions", upload_id: 31, device_key: KEY, files: [{ file_id: 41 }, { file_id: 42, md5: "FAKEhashAAAAAAAAAAAAAAAAAAA=" },
    { file_id: 43 }, { file_id: 44 }, { file_id: 45 }, { file_id: 46 }] }]);
  assert.deepEqual([s.chunk_multiple, s.chunk_bytes, s.max_chunk_bytes], [327680, 5242880, 62586880]);
  assert.deepEqual(s.files.map((f) => [f.file_id, f.code || "", !!f.upload_url]), [[41, "", true], [42, "onedrive_failed", false], [43, "found", false],
    [44, "onedrive_failed", false], [45, "busy", false], [46, "onedrive_failed", false]], "only an address on the published OneDrive host, over https");
  assert.equal(s.files[0].upload_url, UP);
  assert.ok(R.uploadUrlOk(UP));
  for (const bad of ["https://user:pw@" + ONEDRIVE_HOST + "/x", "https://" + ONEDRIVE_HOST + ":8443/x", "https://" + ONEDRIVE_HOST + ".example.test/x", "javascript:alert(1)", null, 7]) {
    assert.equal(R.uploadUrlOk(bad), false, String(bad));
  }
  // 1-20 a call, a device key, file ids: checked before anything is sent
  const n = calls.length;
  await assert.rejects(R.sessions(31, KEY, []), (e) => e.code === "22023");
  await assert.rejects(R.sessions(31, KEY, Array.from({ length: 21 }, (_, i) => ({ file_id: i + 1 }))), (e) => e.code === "22023");
  await assert.rejects(R.sessions(31, "pk_bad", [{ file_id: 1 }]), (e) => e.code === "22023");
  await assert.rejects(R.sessions(31, KEY, [{ file_id: "x" }]), (e) => e.code === "22023");
  assert.equal(calls.length, n);
  // the whole call refused while uploads are off or tested on other jobs (OD §4.3): the device stops sending
  for (const code of ["uploads_off", "uploads_test"]) {
    answer = () => reply(503, { error: code, message: "x" }, { "Retry-After": "900" });
    const e = await R.sessions(31, KEY, [{ file_id: 41 }]).then(() => null, (x) => x);
    assert.ok(e instanceof R.FilesError);
    assert.deepEqual([e.status, e.code, e.retryAfter], [503, code, 900]);
    assert.equal(F.filesText(e, { codes: ["A267"] }), code === "uploads_off" ? F.WORDS.hint.uploads_off : "Photo uploads are being tested on A267 - not on for this job yet.");
  }
  // done: each item read by id (a phone's hash with it); find: the item id or null
  answer = (name, body) => (body.op === "done" ? { data: { items: [{ file_id: 41, state: "confirmed" }, { file_id: 43, state: "checking", retry_after: 30 }],
    folder: { files_state: "waiting" } }, error: null } : { data: { item_id: body.file_id === 41 ? "01FAKEITEM0000000000000000000000AB" : body.file_id === 42 ? null : "<b>" }, error: null });
  const d = await R.done(31, KEY, [{ file_id: 41, item_id: "01FAKEITEM0000000000000000000000AB", md5: "FAKEhashAAAAAAAAAAAAAAAAAAA=" }, { file_id: 43, item_id: "01FAKEITEM0000000000000000000000CD" }]);
  assert.deepEqual(calls[calls.length - 1][2], { op: "done", upload_id: 31, device_key: KEY, items: [{ file_id: 41, item_id: "01FAKEITEM0000000000000000000000AB",
    md5: "FAKEhashAAAAAAAAAAAAAAAAAAA=" }, { file_id: 43, item_id: "01FAKEITEM0000000000000000000000CD" }] });
  assert.deepEqual(d.items.map((x) => x.state), ["confirmed", "checking"]);
  await assert.rejects(R.done(31, KEY, [{ file_id: 41, item_id: "../x" }]), (e) => e.code === "22023", "never an item id of another shape");
  assert.equal(await R.find(31, KEY, 41), "01FAKEITEM0000000000000000000000AB");
  assert.deepEqual(calls[calls.length - 1][2], { op: "find", upload_id: 31, device_key: KEY, file_id: 41 });
  assert.equal(await R.find(31, KEY, 42), null, "nothing there: a new session from byte 0");
  assert.equal(await R.find(31, KEY, 43), null, "an answer of another shape is nothing");
  // OneDrive full (507), its failures (502), the person's rate (429): their codes, statuses and words
  answer = () => reply(507, { error: "onedrive_full", message: "x" });
  const full = await R.done(31, KEY, [{ file_id: 41, item_id: "01FAKEITEM0000000000000000000000AB" }]).then(() => null, (x) => x);
  assert.deepEqual([full.status, full.code, F.filesText(full)], [507, "onedrive_full", F.WORDS.hint.onedrive_full]);
  answer = () => reply(502, { error: "onedrive_failed", message: "x" });
  assert.equal(F.filesText(await R.find(31, KEY, 41).then(() => null, (x) => x)), F.WORDS.hint.onedrive_failed);
  answer = () => reply(413, { error: "too_large", max_bytes: 268435456000 });
  assert.equal(F.filesText(await R.sessions(31, KEY, [{ file_id: 41 }]).then(() => null, (x) => x)), "That file is bigger than OneDrive takes (250 GB).");
});

test("overview (an admin's photo_drive_overview): the share list for the Access tab; null without the OneDrive edition; 42501 for anyone else", async () => {
  stub(() => ({ data: { mode: "on", company_domains: ["example.com"], share_list: [{ profile_id: "00000000-0000-4000-8000-000000000161", first_name: "Sam",
    account: "sam@example.com", wanted: true, not_company: false, marked: null, marked_at: null, marked_by: null, todo: "give" }], share_todo: true, devices: [] }, error: null }));
  const o = await R.overview();
  assert.deepEqual(Object.keys(o), ["company_domains", "share_list", "share_todo"], "only what the Access tab reads");
  assert.deepEqual([o.company_domains, o.share_list.length, o.share_todo], [["example.com"], 1, true]);
  stub(() => ({ data: { root: null, health: null }, error: null }));
  assert.equal(await R.overview(), null, "no mode, no share list: the Google edition's overview");
  stub(() => ({ data: { company_domains: [], share_list: [], share_todo: false }, error: null }));
  assert.equal(await R.overview(), null, "no mode: not the OneDrive edition's (OD §5.7)");
  stub(() => ({ data: null, error: { code: "42883", message: "function public.photo_drive_overview() does not exist" } }));
  assert.equal(await R.overview(), null);
  stub(() => ({ data: null, error: { code: "42501", hint: "forbidden", message: "Only an admin sees the OneDrive setup." } }));
  await assert.rejects(R.overview(), (e) => e.code === "42501");
});

test("act: claim, the PT409 taken {by, at} and a confirmed take over, release, posted (where, https link, note), reopen, pass (a reason), again", { skip }, async () => {
  await setup();
  as("viewer");
  const [ready, claimed] = (await R.readyList("open")).items;
  const t = await refused(() => R.act(claimed.id, "claim", "claimed"), "PT409", "taken");
  assert.equal(t.detail.by, "Avery");
  assert.ok(F.actText(t, "claim", "claimed", { today: "2026-11-11" }).startsWith("Avery is already on it (since "));
  const taken = await R.act(claimed.id, "claim", "claimed", { takeOver: true });
  assert.equal(taken.state, "claimed");
  assert.equal(taken.claimed_by_name, "Taylor");
  const c = await refused(() => R.act(ready.id, "claim", "claimed"), "PT409", "changed");
  assert.equal(c.detail.state, "ready");
  const me = await R.act(ready.id, "claim", "ready");
  assert.equal(me.state, "claimed");
  assert.equal((await R.act(ready.id, "claim", "ready")).again, true, "the same act again answers again");
  await refused(() => R.act(ready.id, "posted", "claimed", { where: ["myspace"] }), "22023", "bad_where");
  await refused(() => R.act(ready.id, "posted", "claimed", { link: "http://example.com/post" }), "22023", "bad_link");
  const posted = await R.act(ready.id, "posted", "claimed", { where: ["website", "instagram"], link: "https://www.example.com/p/1", note: "  the  carousel " });
  assert.equal(posted.state, "posted");
  const row = E.rows.photo_marketing.find((m) => m.id === ready.id);
  assert.deepEqual([row.posted_where, row.posted_link, row.posted_note], [["instagram", "website"], "https://www.example.com/p/1", "the carousel"]);
  const back = await R.act(ready.id, "reopen", "posted");
  assert.equal(back.state, "claimed", "posted -> claimed (by me)");
  await refused(() => R.act(ready.id, "pass", "claimed", { note: "  " }), "22023", "reason_needed");
  assert.equal((await R.act(ready.id, "pass", "claimed", { note: "Same angles as last week" })).state, "passed");
  as("admin");
  assert.equal((await R.act(ready.id, "reopen", "passed")).state, "ready", "an admin reopens anyone's");
  as("field");
  await refused(() => R.act(ready.id, "claim", "ready"), "42501", "forbidden");
  as("viewer");
  await refused(() => R.act(9999, "claim", "ready"), "PT404", "no_item");
});

test("act: Back on the list of a passed card sent again (its answer lost on the way) is again; another person's send from that screen state, or a resend after someone else's change, is changed (P5b review round 11, §11.2, §44)", { skip }, async () => {
  await setup();
  as("viewer");
  const [ready] = (await R.readyList("open")).items;
  assert.equal((await R.act(ready.id, "pass", "ready", { note: "Same angles as last week" })).state, "passed");
  const back = await R.act(ready.id, "reopen", "passed");
  assert.deepEqual([back.state, back.again], ["ready", false], "Back on the list");
  const again = await R.act(ready.id, "reopen", "passed");
  assert.deepEqual([again.state, again.again], ["ready", true], "sent again: the database's again, never changed");
  const row = E.rows.photo_marketing.find((m) => m.id === ready.id);
  assert.deepEqual([row.state, row.claimed_by, row.passed_by, row.pass_reason], ["ready", null, null, null], "nothing more changed");
  as("admin");
  const c = await refused(() => R.act(ready.id, "reopen", "passed"), "PT409", "changed");
  assert.equal(c.detail.state, "ready", "another person's send from that screen state: changed");
  // the viewer's resend after someone else changed the row meanwhile (on it, then not): changed too
  await R.act(ready.id, "claim", "ready");
  await R.act(ready.id, "release", "claimed");
  as("viewer");
  await refused(() => R.act(ready.id, "reopen", "passed"), "PT409", "changed");
});

test("act: Posted… / Not for posting… sent again by their sender (the sheet stayed open, its answer lost) keep what the resend carries - the ticks, a corrected link, the note, the reason - checked as a first send; a field sent empty keeps the row's (P5b review round 12, §45, photo_marketing_act's again)", { skip }, async () => {
  await setup();
  as("viewer");
  const [ready] = (await R.readyList("open")).items;
  const row = () => E.rows.photo_marketing.find((m) => m.id === ready.id);
  const posted = await R.act(ready.id, "posted", "ready", { where: ["instagram"], link: "https://www.example.com/p/typo1", note: "Reel posted" });
  assert.deepEqual([posted.state, posted.again], ["posted", false]);
  const v = row().version;
  // the resend is checked as a first send is: nothing kept from a bad one
  await refused(() => R.act(ready.id, "posted", "ready", { link: "http://www.example.com/p/right1" }), "22023", "bad_link");
  await refused(() => R.act(ready.id, "posted", "ready", { where: ["myspace"] }), "22023", "bad_where");
  assert.deepEqual([row().posted_link, row().version], ["https://www.example.com/p/typo1", v], "a refused resend changes nothing");
  const again = await R.act(ready.id, "posted", "ready", { where: ["facebook", "instagram"], link: "https://www.example.com/p/right1", note: "  Reel  and post " });
  assert.deepEqual([again.again, again.state], [true, "posted"], "sent again: again");
  assert.deepEqual([row().posted_where, row().posted_link, row().posted_note], [["facebook", "instagram"], "https://www.example.com/p/right1", "Reel and post"],
    "what the resend carries is what the card keeps");
  const done = (await R.readyList("done")).items.find((x) => x.id === ready.id);
  assert.deepEqual([done.posted.where, done.posted.link, done.posted.note], [["facebook", "instagram"], "https://www.example.com/p/right1", "Reel and post"],
    "the Done tab's card says the corrected post");
  const v2 = row().version;
  assert.equal((await R.act(ready.id, "posted", "posted")).again, true, "sent again with nothing: again");
  assert.equal((await R.act(ready.id, "posted", "ready", { note: "Reel and post" })).again, true, "sent again the same: again");
  assert.deepEqual([row().posted_where, row().posted_link, row().posted_note, row().version], [["facebook", "instagram"], "https://www.example.com/p/right1", "Reel and post", v2],
    "a field sent empty keeps the row's; the same sent again writes nothing");
  // Not for posting… sent again with its reason corrected
  assert.equal((await R.act(ready.id, "reopen", "posted")).state, "claimed");
  assert.equal((await R.act(ready.id, "pass", "claimed", { note: "Too dark" })).state, "passed");
  const p2 = await R.act(ready.id, "pass", "claimed", { note: "Too dark - reshoot" });
  assert.deepEqual([p2.again, p2.state], [true, "passed"]);
  assert.equal(row().pass_reason, "Too dark - reshoot", "the corrected reason kept");
  assert.equal((await R.act(ready.id, "pass", "claimed", { note: " " })).again, true, "an empty reason sent again: again, never reason_needed");
  assert.equal(row().pass_reason, "Too dark - reshoot", "an empty reason keeps the row's");
  // someone else's resend from that screen state is no again of theirs
  as("admin");
  await refused(() => R.act(ready.id, "pass", "claimed", { note: "Not ours" }), "PT409", "changed");
  assert.equal(row().pass_reason, "Too dark - reshoot");
});

test("act: not_yours (release of another's, reopen of another's), too_late after 14 days, withdrawn refuses everything", { skip }, async () => {
  await setup();
  const [, claimed] = (as("viewer"), await R.readyList("open")).items;
  const e1 = await refused(() => R.act(claimed.id, "release", "claimed"), "42501", "not_yours");
  assert.equal(F.actText(e1, "release", "claimed"), F.WORDS.ready.not_yours);
  const passedOld = (await R.readyList("done")).items.find((i) => i.state === "passed");
  const e2 = await refused(() => R.act(passedOld.id, "reopen", "passed"), "22023", "too_late");
  assert.equal(F.actText(e2, "reopen", "passed"), F.WORDS.ready.too_late_passed);
  as("admin");
  const posted = (await R.readyList("done")).items.find((i) => i.state === "posted");
  assert.equal((await R.act(posted.id, "reopen", "posted")).state, "claimed");
  as("viewer");
  const e3 = await refused(() => R.act(posted.id, "release", "claimed"), "42501", "not_yours");
  assert.ok(e3);
  const row = E.rows.photo_marketing.find((m) => m.id === claimed.id);
  row.state = "withdrawn";
  await refused(() => R.act(claimed.id, "claim", "withdrawn"), "22023", "withdrawn");
});

test("check: its answer is a status (complete, cached, became_ready); 20 s per shoot, then the cache; the refusals' status, code and Retry-After (photo-files, OD §4.7)", { skip }, async () => {
  await setup();
  as("field");
  const s = shootOf("A000T9", "lot-before");
  const a = await R.check(s.id);
  assert.equal(a.shoot_id, s.id);
  assert.equal(a.files.state, "confirmed", "the demo's check: the files on their way arrived");
  assert.deepEqual([a.complete, a.cached, a.became_ready], [true, false, false]);
  assert.equal((await R.check(s.id)).cached, true, "the same shoot within 20 s: the last answer");
  const noFolder = shootOf("A000T6", "delivery");
  const e = await R.check(noFolder.id).then(() => null, (x) => x);
  assert.ok(e instanceof R.FilesError);
  assert.deepEqual([e.status, e.code], [404, "no_folder"]);
  assert.equal(F.filesText(e), F.WORDS.hint.no_folder);
  DEV.state({ root: "trashed" });
  const nc = await R.check(s.id).then(() => null, (x) => x);
  assert.deepEqual([nc.status, nc.code], [409, "root_lost"]);
  assert.equal(F.filesText(nc), null, "the page reads the status again: root_lost");
  assert.deepEqual(F.filesLine(await R.status(s.id), { app: "portal2" }), ["root_lost"]);
  // no root row yet: 409 not_connected, a code of photo-files' own (handler.ts, OD §4.7) - read again, its line says it
  DEV.state({ root: "none" });
  const nr = await R.check(s.id).then(() => null, (x) => x);
  assert.deepEqual([nr.status, nr.code], [409, "not_connected"]);
  assert.equal(F.filesText(nr), null, "the page reads the status again: not_connected");
  assert.deepEqual(F.filesLine(await R.status(s.id), { app: "portal2" }), ["not_connected"]);
  DEV.state({ root: "found", p5: false });
  const nd = await R.check(s.id).then(() => null, (x) => x);
  assert.deepEqual([nd.status, nd.code], [404, "not_deployed"], "a 404 with no photo-files code: the function is not deployed");
  assert.equal(F.filesText(nd), F.WORDS.hint.not_configured);
  // the gateway's answers as supabase-js gives them: Retry-After read from the header photo-files exposes; offline
  as("field", { invoke: async () => reply(429, { error: "rate", message: "Too many tries - wait a minute." }, { "Retry-After": "42" }) });
  const rl = await R.check(s.id).then(() => null, (x) => x);
  assert.deepEqual([rl.status, rl.code, rl.retryAfter], [429, "rate", 42]);
  as("field", { invoke: async () => reply(503, { error: "busy", message: "x" }, { "Retry-After": "99999" }) });
  const bz = await R.check(s.id).then(() => null, (x) => x);
  assert.deepEqual([bz.status, bz.code, bz.retryAfter], [503, "busy", 900], "at most 15 minutes");
  as("field", { invoke: async () => reply(502, { message: "Bad gateway" }) });
  const gw = await R.check(s.id).then(() => null, (x) => x);
  assert.deepEqual([gw.status, gw.code], [502, "failed"], "a gateway's body names no photo-files code");
  assert.equal(F.filesText(gw), F.WORDS.hint.onedrive_failed);
  as("field", { invoke: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal((await R.check(s.id).then(() => null, (x) => x)).code, "offline");
  as("field", { invoke: async () => ({ data: null, error: { name: "FunctionsFetchError", context: new TypeError("x") } }) });
  const off = await R.check(s.id).then(() => null, (x) => x);
  assert.equal(off.code, "offline");
  assert.equal(F.filesText(off), F.WORDS.files.read_failed);
});

test("check: 30 per 10 minutes per person (429 rate) - the page never checks by itself", { skip }, async () => {
  await setup();
  as("viewer");
  const s = shootOf("A000T9", "progress-1");
  for (let i = 0; i < 30; i++) await R.check(s.id);
  const e = await R.check(s.id).then(() => null, (x) => x);
  assert.deepEqual([e.status, e.code], [429, "rate"]);
});

test("drain: fire and forget - never thrown, never awaited for words; nothing of Use what's in Drive or the share sync is left (OD §15, §8.1)", { skip }, async () => {
  await setup();
  as("field", { invoke: async () => { throw new Error("offline"); } });
  assert.equal(await R.drain(), false);
  as("viewer");
  assert.equal(await R.drain(), true, "the demo's push function drains");
  assert.equal(R.useDrive, undefined);
  assert.equal(R.shareSync, undefined);
  assert.equal(R.GdriveError, undefined);
});

test("the drain's memory (§10.7): an INSERT drains once; an UPDATE only when ready_at moved and is under 10 minutes old; never twice for (id, ready_at)", () => {
  let now = Date.parse("2026-11-12T21:00:00Z");
  const drains = [];
  const d = new R.Drainer({ now: () => now, drain: () => drains.push(1) });
  const at = (min) => new Date(now - min * 60000).toISOString();
  const fresh = at(1);
  assert.equal(d.event({ type: "INSERT", new: { id: 4, ready_at: fresh } }), true);
  assert.equal(d.event({ type: "INSERT", new: { id: 4, ready_at: fresh } }), false, "once per (id, ready_at)");
  assert.equal(d.event({ type: "UPDATE", new: { id: 4, ready_at: fresh }, old: { id: 4 } }), false, "a told-trigger update: the same ready_at");
  d.saw(5, at(30));
  assert.equal(d.event({ type: "UPDATE", new: { id: 5, ready_at: at(30) }, old: { id: 5 } }), false, "seen before and old");
  const moved = at(2);
  assert.equal(d.event({ type: "UPDATE", new: { id: 5, ready_at: moved }, old: { id: 5 } }), true, "ready_at moved (made again, D3): drained");
  assert.equal(d.event({ type: "UPDATE", new: { id: 6, ready_at: at(11) }, old: { id: 6 } }), false, "over 10 minutes old");
  assert.equal(d.event({ type: "DELETE", old: { id: 5 } }), false);
  assert.equal(d.event({ type: "SUBSCRIBED" }), false);
  assert.equal(d.event({ type: "INSERT", new: { id: 7 } }), false, "no ready_at: nothing to drain");
  assert.equal(drains.length, 2);
});

test("watchFiles: the three tables on the usual private channels, one read after the joins, a photo_marketing event fed to the drain, never two reads at a time, nothing after stop()", async () => {
  const subs = [];
  const live = { watch: (table, filter, cb, opts) => { const s = { table, filter, cb, opts, off: false }; subs.push(s); return () => { s.off = true; }; } };
  const reads = [];
  const fed = [];
  let release = null;
  const stop = await R.watchFiles(async (what) => { reads.push(what); if (reads.length === 2) await new Promise((r) => { release = r; }); },
    { live, wait: 5, drainer: { event: (e) => fed.push(e.type) } });
  assert.deepEqual(subs.map((s) => [s.table, s.filter, s.opts.lost]), [["photo_marketing", "", true], ["photo_drive_folders", "", true], ["photo_shoot_uploads", "", true]]);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  for (const s of subs) s.cb({ type: "SUBSCRIBED", table: s.table });
  await tick();
  assert.equal(reads.length, 1, "one read for the three joins");
  assert.equal(reads[0].join, true);
  subs[0].cb({ type: "INSERT", table: "photo_marketing", new: { id: 4, ready_at: new Date().toISOString() } });
  await tick();
  assert.equal(reads.length, 2);
  subs[1].cb({ type: "UPDATE", table: "photo_drive_folders", new: {}, old: {} });
  await tick();
  assert.equal(reads.length, 2, "never two at a time");
  release();
  await tick();
  await tick();
  assert.equal(reads.length, 3);
  assert.deepEqual(reads[2].tables, ["photo_drive_folders"]);
  assert.deepEqual(fed, ["SUBSCRIBED", "INSERT"], "only photo_marketing's events reach the drain");
  stop();
  assert.ok(subs.every((s) => s.off));
});
