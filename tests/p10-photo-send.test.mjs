// The phone's hand-in (the photographer screen program, P5, the OneDrive edition; DCR Desktop 2
// docs/PHOTO-FILES-ONEDRIVE.md §3.3, §3.5, §3.6, §4.5, cited OD; the build plan's P4): site/js/photo-send.js and
// site/js/photo-hash-worker.js over a stub world - Microsoft's upload sessions (Content-Range, 202 + nextExpectedRanges,
// the last chunk's 201 + the item, GET how far, 404 once gone, 416, 507, a last chunk that never commits) whose items
// carry OneDrive's quickXorHash of the bytes it really got, and the people's RPCs and the photo-files ops as the
// migration and the contract answer them (the file ids by i, send false, found, the verdict comparing the phone's hash
// with OneDrive's, the seal's counts). The pick (cases kinds, free_name), the hashing transport (each chunk hashed once
// across a resume and a 416, a new session from 0), the 507 that stops the job without its tries, finished but not
// committed, Pick the rest again (hashed then skipped, found -> done with no bytes, a different file of that name a new
// row), Hand in what's there (asks, never drops a found row), the mode, the beat, the wake lock, a paused job resumed
// on visibilitychange, the words (never job.error), the upload address in page memory only; the review rounds' fixes
// (round 2: a pick that begins the hand-in and records nothing of its own cancels it again; round 3: Hand in what's there
// only once a file of the hand-in is in OneDrive, a file held one by one queued again when it is picked again, its tries
// from 0, and too_many_tries in the phone's own words; round 5: Cancel it counts this page's own files in OneDrive that
// the cancel did not put back while it holds the hand-in's files, and the cancel's removed_sent for the rows it does
// not hold; round 6: the file whose last chunk was on its way when Cancel it stopped it asked with find before the
// cancel - counted when it is in OneDrive, or when find cannot say). Made-up names, ids and addresses only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as P from "../site/js/photo-send.js";
import { createUploader } from "../site/js/onedrive-upload.js";
import { CHUNK_UNIT } from "../site/js/map/onedrive.js";
import { WORDS } from "../site/js/map/photo-words.js";
import { fill } from "../site/js/map/photo-files.js";
import * as R from "../site/js/repo/photo-files.js";
import { useClient } from "../site/js/repo/_db.js";

await import("../site/js/quickxor.js");
const { quickXorHash } = globalThis.DCR2QuickXor;
const C = JSON.parse(readFileSync(new URL("./vectors/photo_files_cases.json", import.meta.url), "utf8"));
const SRC = readFileSync(new URL("../site/js/photo-send.js", import.meta.url), "utf8");
const WORKER = new URL("../site/js/photo-hash-worker.js", import.meta.url);
const SHOOT = 31;
const KEY = "pk_" + "A".repeat(22);
const CLIENT = "CLIENTKEY_0000000001";

/* ── made-up bytes and files ─────────────────────────────────────────── */

function lcg(n, seed) {
  const out = new Uint8Array(n);
  let x = seed >>> 0;
  for (let k = 0; k < n; k++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; out[k] = (x >>> 16) & 255; }
  return out;
}
/** A picked file whose every read is counted (the one-read rule). */
class PickedFile {
  constructor(name, size, seed) {
    this.name = name;
    this.size = size;
    this.bytes = lcg(size, seed);
    this.lastModified = Date.UTC(2026, 10, 12, 18, 0, 0);
    this.type = "";
    this.reads = 0;
  }
  slice(a, b) {
    const self = this;
    const part = this.bytes.slice(a, b);
    return { size: part.length, arrayBuffer: async () => { self.reads += part.length; return part.buffer.slice(part.byteOffset, part.byteOffset + part.length); } };
  }
}
const qx = (f) => quickXorHash(f.bytes);
const U = CHUNK_UNIT;

/* ── the world: Microsoft's sessions, the database's rows, the function's ops ── */

function err(code, status, extra) { return Object.assign(new Error(code), { code, status, info: null, retryAfter: null }, extra); }
function refuse(hint, detail) { return Object.assign(new Error(hint), { code: "22023", hint, detail: detail || null, retryable: false }); }
const keyOf = (p) => String(p).normalize("NFC").replace(/[A-Z]/g, (c) => c.toLowerCase());

function world(o) {
  const opt = o || {};
  const W = {
    rows: [], uploads: new Map(), sessions: new Map(), items: new Map(), calls: [], reqs: [], beats: [], recorded: [],
    nextRow: opt.firstRow || 100, nextUpload: 1, n: 0, itemN: 0, mode: "on", chunk: opt.chunk || U, hook: null,
    perFile: null, lateHash: false, beginFail: 0,
  };
  W.row = (id) => W.rows.find((r) => r.id === Number(id)) || null;
  W.addRow = (r) => { const row = Object.assign({ md5: null, state: "waiting", counted: false, upload: null, item: null, sessionAt: false, step: "to_send" }, r); W.rows.push(row); return row; };
  W.addItem = (fileId, file) => {
    const id = "01FAKE" + String(++W.itemN).padStart(10, "0");
    W.items.set(id, { id, fileId, size: file.size, hash: qx(file) });
    return id;
  };
  const res = (status, body) => ({ status, header: () => null, text: () => (body === undefined ? "" : JSON.stringify(body)) });
  const offline = () => Object.assign(new Error("No connection"), { code: "offline" });
  W.send = async (req) => {
    const s = W.sessions.get(req.url);
    let r = null;
    if (req.method === "PUT") {
      const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers["Content-Range"]);
      r = { a: Number(m[1]), b: Number(m[2]), size: Number(m[3]) };
      r.last = r.b === r.size - 1;
    }
    W.reqs.push({ method: req.method, url: req.url, range: r, headers: Object.assign({}, req.headers) });
    const step = W.hook ? W.hook(req, s, r) : undefined;
    if (step === "drop") throw offline();
    if (step === "expire" && s) s.dead = true;
    if (typeof step === "number") return res(step, { error: { code: "x" } });
    if (!s || s.dead || s.done) return res(404, { error: { code: "itemNotFound" } });
    if (req.method === "GET") return res(200, { nextExpectedRanges: s.allIn ? [] : [s.offset + "-"] });
    assert.ok(req.body instanceof ArrayBuffer, "the transport sends the buffer it hashed");
    const bytes = new Uint8Array(req.body);
    assert.equal(bytes.length, r.b - r.a + 1, "the chunk is what its range says");
    if (r.a !== s.offset) return res(416, { nextExpectedRanges: [s.offset + "-"] });
    s.got.set(bytes, r.a);
    s.offset = r.b + 1;
    if (s.offset < s.size) {
      if (step === "lose") throw offline();
      return res(202, { nextExpectedRanges: [s.offset + "-"] });
    }
    if (step === "nocommit") { s.allIn = true; return res(202, { nextExpectedRanges: [] }); }
    const id = "01FAKE" + String(++W.itemN).padStart(10, "0");
    s.done = id;
    // OneDrive's own hash of what it got
    W.items.set(id, { id, fileId: s.fileId, size: s.size, hash: quickXorHash(s.got) });
    const row = W.row(s.fileId);
    row.item = id;
    row.step = "committed";
    if (typeof W.onCommit === "function") W.onCommit(row);
    if (step === "lose") throw offline();
    return res(201, { id, name: row.path.split("/").pop(), size: s.size });
  };
  W.repo = {
    rows: async (shootId) => { W.calls.push(["rows", shootId]); return W.rows.map((r) => ({ id: r.id, path: r.path, size: r.size, md5: r.md5, state: r.state, counted: r.counted })); },
    begin: async (shootId, b) => {
      W.calls.push(["begin", shootId, Object.assign({}, b)]);
      if (W.beginFail > 0) { W.beginFail--; throw Object.assign(new Error("no answer"), { code: "NETWORK", retryable: true }); }
      if (W.beginRefuse) throw W.beginRefuse;
      for (const u of W.uploads.values()) {
        if (u.clientKey === b.clientKey) {
          if (u.state === "abandoned") u.state = "open";
          return { upload: { id: u.id, state: u.state, device_id: 7 }, again: true };
        }
      }
      const u = { id: W.nextUpload++, state: "open", clientKey: b.clientKey };
      W.uploads.set(u.id, u);
      return { upload: { id: u.id, state: "open", device_id: 7, source: "phone" }, again: false };
    },
    record: async (uploadId, files) => {
      W.calls.push(["record", files.map((f) => f.path)]);
      W.recorded.push(...files);
      const out = [], refused = [];
      files.forEach((f, i) => {
        const row = W.rows.find((x) => keyOf(x.path) === keyOf(f.path));
        if (W.sameNext && W.sameNext(f)) { out.push({ i, file_id: W.sameNext(f), path: f.path, verdict: "same", send: false }); return; }
        if (row && row.state === "removed") {
          Object.assign(row, { state: "waiting", upload: uploadId, counted: false, md5: null, item: null, sessionAt: false, step: "to_send", size: f.size });
          out.push({ i, file_id: row.id, path: row.path, verdict: "restored", send: true });
          return;
        }
        if (row) { refused.push({ i, path: f.path, code: "name_taken" }); return; }
        const id = W.nextRow;
        W.nextRow += opt.rowStep || 1;
        W.addRow({ id, path: f.path, size: f.size, upload: uploadId });
        out.push({ i, file_id: id, path: f.path, verdict: "added", send: true });
      });
      const byIndex = {};
      for (const e of out) byIndex[e.i] = { file_id: e.file_id, path: e.path, verdict: e.verdict, send: e.send };
      return { added: out.length, refused, files: out, byIndex };
    },
    sessions: async (uploadId, key, files) => {
      W.calls.push(["sessions", files.map((f) => Object.assign({}, f))]);
      assert.equal(files.length, 1, "just in time: one file a call");
      if (W.mode === "off") throw err("uploads_off", 503);
      if (W.full) throw err("onedrive_full", 507);
      const out = files.map((f) => {
        const row = W.row(f.file_id);
        if (!row || row.upload !== uploadId || row.state !== "waiting") return { file_id: f.file_id, code: "not_waiting" };
        if (f.md5 && row.md5 && f.md5 !== row.md5) return { file_id: f.file_id, code: "not_same_file" };
        const item = row.item && W.items.get(row.item);
        if (item && item.size === row.size && (row.sessionAt || (f.md5 && item.hash === f.md5))) return { file_id: f.file_id, code: "found", item_id: row.item };
        if (W.perFile) { const c = W.perFile(row); if (c) return Object.assign({ file_id: f.file_id }, c); }
        const url = "https://up.example/s" + (++W.n);
        W.sessions.set(url, { fileId: row.id, size: row.size, got: new Uint8Array(row.size), offset: 0, done: null, dead: false, allIn: false });
        row.sessionAt = true;
        row.step = "session";
        return { file_id: f.file_id, upload_url: url, path: row.path, expires_at: "2026-11-14T00:00:00Z" };
      });
      return { chunk_multiple: U, chunk_bytes: W.chunk, max_chunk_bytes: 191 * U, files: out };
    },
    // (photo-files' own answer shape, handler.ts: a row to send again is {file_id, code} with no state)
    done: async (uploadId, key, items) => {
      W.calls.push(["done", items.map((x) => Object.assign({}, x))]);
      return { items: items.map((it) => {
        const row = W.row(it.file_id);
        const item = W.items.get(it.item_id);
        // (a test's own: OneDrive's item judged once as broken_upload / not_this_upload / gone, the row back to to_send)
        if (W.doneCode) { const c = W.doneCode; W.doneCode = null; row.item = null; row.step = "to_send"; return { file_id: it.file_id, code: c }; }
        if (!item || item.fileId !== row.id) { row.item = null; row.step = "to_send"; return { file_id: it.file_id, code: item ? "not_this_upload" : "gone" }; }
        if (it.md5) {
          if (row.md5 && row.md5 !== it.md5) return { file_id: it.file_id, code: "not_same_file" };
          row.md5 = it.md5;
        }
        if (W.lateHash) { row.step = "committed"; return { file_id: it.file_id, state: "checking" }; }
        if (item.size === row.size && item.hash === row.md5) { row.state = "confirmed"; row.step = "done"; return { file_id: it.file_id, state: "confirmed" }; }
        row.item = null;
        row.step = "to_send";
        return { file_id: it.file_id, code: "broken_upload" };
      }), folder: { files_state: "waiting" } };
    },
    find: async (uploadId, key, fileId) => {
      W.calls.push(["find", fileId]);
      const row = W.row(fileId);
      return row && row.item && W.items.has(row.item) ? row.item : null;
    },
    beat: async (uploadId, b) => { W.beats.push(Object.assign({ at: Date.now() }, b)); return { ok: true }; },
    seal: async (uploadId, n, bytes) => {
      W.calls.push(["seal", n, bytes]);
      const mine = W.rows.filter((r) => r.upload === uploadId && r.state !== "removed");
      for (const r of mine) if (!r.md5 && !r.counted) r.state = "removed";
      const left = mine.filter((r) => r.state !== "removed");
      const files = left.length, sum = left.reduce((a, r) => a + r.size, 0);
      if (!files) throw refuse("empty");
      if (files !== n || sum !== bytes) throw refuse("count_mismatch", { files, bytes: sum });
      for (const r of left) r.counted = true;
      W.uploads.get(uploadId).state = "sealed";
      return { ok: true, again: false, upload: { id: uploadId, state: "sealed", files, bytes: sum } };
    },
    // (the migration's answer: removed_sent, the removed rows whose bytes MAY be in OneDrive - a session was handed out
    // for them, or an item is known: review round 5 -; put_back_ids - review round 4; a test's own W.cancelAnswer(answer)
    // in its place)
    cancel: async (uploadId) => {
      W.calls.push(["cancel", uploadId]);
      let removed = 0, sent = 0;
      for (const r of W.rows) {
        if (r.upload === uploadId && !r.counted && r.state !== "removed") {
          removed++;
          if (r.sessionAt || r.step !== "to_send" || r.state === "confirmed") sent++;
          r.state = "removed";
        }
      }
      W.uploads.get(uploadId).state = "cancelled";
      const ans = { ok: true, state: "cancelled", again: false, removed, put_back: 0, removed_sent: sent, put_back_ids: [] };
      return W.cancelAnswer ? W.cancelAnswer(ans) : ans;
    },
  };
  W.callsOf = (kind) => W.calls.filter((c) => c[0] === kind);
  return W;
}

/** Listeners like a page's window / document. */
function target(extra) {
  const l = new Map();
  return Object.assign({
    addEventListener(t, f) { if (!l.has(t)) l.set(t, new Set()); l.get(t).add(f); },
    removeEventListener(t, f) { if (l.has(t)) l.get(t).delete(f); },
    count(t) { return l.has(t) ? l.get(t).size : 0; },
    fire(t, ev) { const e = ev || { type: t, preventDefault() { this.prevented = true; } }; for (const f of Array.from(l.get(t) || [])) f(e); return e; },
  }, extra);
}

function memoryStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  const writes = [];
  return { m, writes, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { writes.push([k, String(v)]); m.set(k, String(v)); }, removeItem: (k) => m.delete(k) };
}

/** One phone page over world W. */
function phone(W, o) {
  const opt = o || {};
  const storage = opt.storage !== undefined ? opt.storage : memoryStorage(opt.seed);
  const doc = target({ visibilityState: "visible" });
  const win = target();
  const locks = { asked: 0, released: 0 };
  const nav = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    wakeLock: opt.noWakeLock ? undefined : { request: async () => { locks.asked++; return { release() { locks.released++; }, addEventListener() {} }; } } };
  const views = [];
  const ps = P.createPhoneSend(Object.assign({
    repo: W.repo, transport: W.send, hasher: opt.hasher || P.createHasher({ worker: null }), storage, window: win, document: doc, navigator: nav,
    by: "Sam", today: "2026-11-13", uploader: { wait: () => 1, maxTries: opt.maxTries || 8 },
    ms: { beat: 5, again: 10, pause: opt.pause || 10000, waits: [1] },
  }, opt.deps || {}));
  ps.onChange((v) => views.push(v));
  return { ps, storage, doc, win, nav, locks, views };
}

async function until(fn, ms) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > (ms || 10000)) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 2));
  }
}
const texts = (v) => v.lines.map((l) => l.text);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** A hasher that counts the bytes fed to each key. */
function spyHasher(base) {
  const h = base || P.createHasher({ worker: null });
  const fed = new Map();
  return { fed, update(k, b) { fed.set(k, (fed.get(k) || 0) + b.byteLength); h.update(k, b); }, digest: (k) => h.digest(k), drop: (k) => h.drop(k) };
}

/* ── the pure parts: the shared cases ─────────────────────────────────── */

test("cases kinds, free_name and paths' keys: kindOf, freeName and pathKey are the SQL's (app.photo_drive_kind, app.photo_free_name, app.photo_drive_path_key)", () => {
  for (const c of C.kinds.cases) assert.equal(P.kindOf(c.in), c.out, c.in);
  for (const k of ["photo", "raw", "video"]) for (const e of C.kinds.lists[k]) assert.equal(P.kindOf("x." + e.toUpperCase()), k, e);
  for (const c of C.free_name) assert.equal(P.freeName(c.in.path, c.in.taken), c.out, c.name);
  for (const c of C.paths) if (c.key) assert.equal(P.pathKey(c.in), c.key, c.in);
  assert.equal(P.freeName("Phone/IMG_0001.HEIC", ["phone/img_0001.heic", "Phone/IMG_0001 (2).HEIC"]), "Phone/IMG_0001 (3).HEIC");
});

test("the device: its label is never a person's name; the device key and the client key are photo_upload_begin's shapes", () => {
  assert.equal(P.deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), "iPhone");
  assert.equal(P.deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), "Android phone");
  assert.equal(P.deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "phone");
  for (let i = 0; i < 20; i++) {
    assert.match(P.newDeviceKey(), /^pk_[A-Za-z0-9_-]{22}$/);
    assert.match(P.newClientKey(), /^[A-Za-z0-9_-]{8,64}$/);
  }
  assert.notEqual(P.newClientKey(), P.newClientKey());
  assert.equal(P.ACCEPT, "image/*,video/*,image/heic,image/heif", "HEIC named (OD §3.3 step 2)");
});

/* ── the pick ─────────────────────────────────────────────────────────── */

test("the pick: only photos and videos (the rest counted, left out), at most 200, Phone/<name>, a taken name (2) - a left-out row's too unless its bytes are the file's", () => {
  const f = (name, size) => ({ name, size, lastModified: Date.UTC(2026, 10, 12) });
  const rows = [
    { id: 1, path: "Phone/IMG_0001.HEIC", size: 50, md5: "FAKEqxa00000000000000000000=", state: "confirmed", counted: true },
    { id: 2, path: "Phone/IMG_0002.HEIC", size: 60, md5: "FAKEqxb00000000000000000000=", state: "removed", counted: true },
    { id: 3, path: "Phone/IMG_0003.HEIC", size: 70, md5: "FAKEqxc00000000000000000000=", state: "removed", counted: true },
  ];
  const files = [f("IMG_0001.HEIC", 51), f("IMG_0002.HEIC", 61), f("IMG_0003.HEIC", 70), f("notes.txt", 5), f("IMG_0004.MOV", 2 * 1024 * 1024 * 1024), f("x.pdf", 9)];
  const hashes = new Map([[2, "FAKEqxc00000000000000000000="]]);
  assert.deepEqual(P.needsHash(files, rows), [2], "only a file whose name and size match a row is read first");
  const p = P.planPick(files, rows, { hashes });
  assert.equal(p.notMedia, 2);
  assert.equal(p.limited, false);
  assert.deepEqual(p.send.map((e) => e.path), ["Phone/IMG_0001 (2).HEIC", "Phone/IMG_0002 (2).HEIC", "Phone/IMG_0003.HEIC", "Phone/IMG_0004.MOV"],
    "a confirmed row's name and a left-out row's name are taken; the left-out row of these very bytes gives its own path back");
  assert.equal(p.renamed, 2);
  assert.ok(p.send.every((e) => e.modified === new Date(Date.UTC(2026, 10, 12)).toISOString()));
  assert.deepEqual(p.big, [{ size: 2 * 1024 * 1024 * 1024 }], "over 1 GB: the line first");
  const many = Array.from({ length: 205 }, (_, i) => f("IMG_" + String(i).padStart(4, "0") + ".JPG", 10));
  const q = P.planPick(many, [], {});
  assert.equal(q.send.length, 200);
  assert.equal(q.limited, true);
  // two picked files of one name: the second is (2)
  const two = P.planPick([f("A.JPG", 1), f("A.JPG", 2)], [], {});
  assert.deepEqual(two.send.map((e) => e.path), ["Phone/A.JPG", "Phone/A (2).JPG"]);
  assert.ok(P.nameMatches("Phone/A (2).JPG", "A.JPG") && P.nameMatches("Phone/a.jpg", "A.JPG") && !P.nameMatches("Phone/AB.JPG", "A.JPG") &&
    !P.nameMatches("Phone/A (1).JPG", "A.JPG"));
});

test("the pick's words: not_media, pick_limit, skipped_same, renamed and big_phone from the cases (6.2 GB: about 20 minutes)", async () => {
  const W = world();
  const { ps } = phone(W);
  const files = [new PickedFile("notes.txt", 10, 1), { name: "C0001.MP4", size: Math.round(6.2 * 1024 * 1024 * 1024), lastModified: 1, slice() { throw new Error("never read"); } }];
  const p = await ps.plan(SHOOT, files);
  assert.deepEqual(p.lines.map((l) => l.code), ["not_media", "big_phone"]);
  assert.equal(p.lines[0].text, WORDS.copy.not_media_one);
  assert.equal(p.lines[1].text, "Big videos go best from DCR Desktop. This 6.2 GB video needs about 20 min on good Wi-Fi with the screen on.");
  await ps.dispose();
});

/* ── the hash worker ──────────────────────────────────────────────────── */

function workerContext() {
  const posted = [];
  const ctx = { ArrayBuffer, Uint8Array, Uint32Array, Object, Math, Error, posted };
  ctx.postMessage = (m) => posted.push(m);
  ctx.self = ctx;
  ctx.importScripts = (name) => vm.runInContext(readFileSync(new URL("../site/js/" + name, import.meta.url), "utf8"), ctx);
  vm.createContext(ctx);
  vm.runInContext(readFileSync(WORKER, "utf8"), ctx);
  return { ctx, posted, send: (m) => ctx.onmessage({ data: m }) };
}
/** js/photo-hash-worker.js behind a Worker's face (messages one turn later, in order). */
class FakeWorker {
  constructor() {
    this.w = workerContext();
    this.seen = [];
    this.w.ctx.postMessage = (m) => setTimeout(() => { if (this.onmessage) this.onmessage({ data: m }); }, 0);
  }
  postMessage(m) { this.seen.push(m); setTimeout(() => this.w.ctx.onmessage({ data: m }), 0); }
}

test("the hash worker: quickXorHash per key over chunks in any slicing (the cases' qx vectors), keys apart, drop, a key that failed never answers a part's hash", () => {
  const w = workerContext();
  const bytesOf = (b) => b.kind === "hex" ? Uint8Array.from((b.hex.match(/../g) || []), (x) => parseInt(x, 16))
    : b.kind === "pattern" ? Uint8Array.from({ length: b.n }, (_, k) => (b.a * k + b.c) & 255) : lcg(b.n, b.seed);
  let id = 0;
  for (const v of C.qx) {
    const data = bytesOf(v.bytes);
    for (const pieces of v.slicings) {
      const key = "h" + (++id);
      let at = 0, k = 0;
      while (at < data.length) {
        const n = pieces[k % pieces.length];
        const part = data.slice(at, at + n);
        w.send({ op: "update", key, bytes: part.buffer });
        at += n; k += 1;
      }
      w.send({ op: "digest", key, id });
      const m = w.posted.pop();
      assert.deepEqual([m.type, m.id, m.hash, m.length], ["digest", id, v.hash, v.size], v.name + " " + JSON.stringify(pieces));
    }
  }
  // two keys apart; drop forgets one
  w.send({ op: "update", key: "h900", bytes: Uint8Array.of(74).buffer });
  w.send({ op: "update", key: "h901", bytes: Uint8Array.of(1, 2, 3).buffer });
  w.send({ op: "digest", key: "h900", id: 1 });
  assert.equal(w.posted.pop().hash, "SgAAAAAAAAAAAAAAAQAAAAAAAAA=");
  w.send({ op: "drop", key: "h900" });
  w.send({ op: "digest", key: "h900", id: 2 });
  assert.equal(w.posted.pop().hash, "AAAAAAAAAAAAAAAAAAAAAAAAAAA=", "a dropped key starts again empty");
  // not bytes: that key fails for good (never a hash of part of the file)
  w.send({ op: "update", key: "h902", bytes: "not bytes" });
  w.send({ op: "update", key: "h902", bytes: Uint8Array.of(1).buffer });
  w.send({ op: "digest", key: "h902", id: 3 });
  const failed = w.posted.pop();
  assert.deepEqual([failed.type, failed.id, failed.key, failed.hash], ["error", 3, "h902", undefined]);
  // a key that is not the page's opaque kind is ignored (an address is never one)
  const before = w.posted.length;
  w.send({ op: "digest", key: "https://up.example/s1", id: 4 });
  assert.equal(w.posted.length, before);
  assert.ok(!/postMessage\([^)]*bytes/.test(readFileSync(WORKER, "utf8")), "the worker posts no bytes back");
});

/* ── a whole hand-in ──────────────────────────────────────────────────── */

test("a hand-in end to end: begin (phone, iPhone, the keys kept), record with NO hash, one sessions call per file, chunks straight to the address with no Authorization, done with the hash computed while sending, the seal with the counts", async () => {
  const W = world();
  W.beginFail = 1;                   // no answer once: asked again (the same client key - never two hand-ins)
  const { ps, storage, win, locks } = phone(W);
  const files = [new PickedFile("IMG_0001.HEIC", Math.round(2.5 * U), 11), new PickedFile("IMG_0002.HEIC", U - 3, 12), new PickedFile("C0001.MOV", 4 * U + 7, 13)];
  const p = await ps.plan(SHOOT, files);
  assert.deepEqual(p.send.map((e) => e.path), ["Phone/IMG_0001.HEIC", "Phone/IMG_0002.HEIC", "Phone/C0001.MOV"]);
  await ps.start(p);
  await until(() => ps.view().phase === "sealed");
  const begins = W.callsOf("begin");
  assert.equal(begins.length, 2);
  assert.equal(begins[0][2].clientKey, begins[1][2].clientKey, "asked again with the same client key");
  assert.equal(begins[0][2].label, "iPhone");
  assert.match(begins[0][2].deviceKey, /^pk_[A-Za-z0-9_-]{22}$/);
  assert.ok(W.recorded.every((f) => !("md5" in f)), "recorded without a hash (OD §3.3 step 4)");
  assert.ok(W.recorded.every((f) => f.modified === new Date(files[0].lastModified).toISOString()));
  const sessions = W.callsOf("sessions");
  assert.equal(sessions.length, 3, "one file a call, just in time");
  const dones = W.callsOf("done").map((c) => c[1][0]);
  assert.deepEqual(dones.map((x) => x.md5), files.map(qx), "md5 with done: the quickXorHash of the bytes sent");
  assert.ok(W.rows.every((r) => r.state === "confirmed" && r.counted));
  // every PUT's Content-Range is the offset read, chunk after chunk; no sign-in header at all
  const puts = W.reqs.filter((r) => r.method === "PUT");
  assert.ok(puts.every((r) => Object.keys(r.headers).every((k) => !/authorization|apikey|cookie/i.test(k))), "no Authorization on a chunk");
  for (const f of files) {
    const mine = puts.filter((r) => r.range.size === f.size);
    assert.deepEqual(mine.map((r) => r.range.a), Array.from({ length: Math.ceil(f.size / U) }, (_, k) => k * U));
  }
  assert.deepEqual(W.callsOf("seal")[0], ["seal", 3, files.reduce((a, f) => a + f.size, 0)]);
  // each file read once: the send is the hash's one read
  assert.deepEqual(files.map((f) => f.reads), files.map((f) => f.size));
  const v = ps.view();
  assert.equal(v.lines.at(-1).code, "confirmed");
  assert.match(v.lines.at(-1).text, /^All 3 files are in OneDrive ✓ \(checked .+\)\.$/);
  assert.deepEqual(v.buttons, []);
  // the beat while it sent, the wake lock asked and let go, beforeunload only while it sent
  assert.ok(W.beats.length >= 1 && W.beats.every((b) => b.state === "sending"), JSON.stringify(W.beats.slice(0, 2)));
  assert.ok(locks.asked >= 1 && locks.released >= 1);
  assert.equal(win.count("beforeunload"), 0, "the warning is gone once it is done");
  // the keys: this phone's device key and row are kept; the closed hand-in's client key is dropped
  const kept = JSON.parse(storage.m.get(P.STORE_KEY));
  assert.match(kept.device_key, /^pk_/);
  assert.equal(kept.device_id, 7);
  assert.deepEqual(kept.hand_ins, {});
  await ps.dispose();
});

test("a beat soon after each file is in (SOON_MS, besides the 30 s one): the status's {sent} of {total} is never a file behind for long", async () => {
  const W = world();
  const { ps } = phone(W, { deps: { ms: { beat: 100000, soon: 0, again: 10, pause: 10000, waits: [1] } } });
  const a = new PickedFile("IMG_0001.JPG", U + 1, 131), b = new PickedFile("IMG_0002.JPG", 3 * U + 2, 132);
  await ps.start(await ps.plan(SHOOT, [a, b]));
  await until(() => ps.view().phase === "sealed");
  assert.equal(W.beats[0].sentFiles, 0, "the first beat as it starts");
  assert.ok(W.beats.some((x) => x.sentFiles === 1), "a beat once the first file was in: " + JSON.stringify(W.beats.map((x) => x.sentFiles)));
  assert.ok(W.beats.length <= 3, "never more than one a file");
  assert.equal(P.SOON_MS, 10000);
  await ps.dispose();
});

test("the file ids come from photo_upload_files' files[] (by i): sessions, done and find name them; an entry with send false is never sent", async () => {
  const W = world({ firstRow: 41, rowStep: 936 });
  const a = new PickedFile("IMG_0001.JPG", 1000, 1), b = new PickedFile("IMG_0002.JPG", 2000, 2), c = new PickedFile("IMG_0003.JPG", 3000, 3);
  W.sameNext = (f) => (f.path === "Phone/IMG_0002.JPG" ? 9001 : 0);
  const { ps } = phone(W);
  await ps.start(await ps.plan(SHOOT, [a, b, c]));
  await until(() => ps.view().phase === "sealed");
  assert.deepEqual(W.callsOf("sessions").map((s) => s[1][0].file_id), [41, 977], "the answer's ids, never a guess");
  assert.ok(!W.callsOf("sessions").some((s) => s[1][0].file_id === 9001), "the same as another hand-in's row: not this phone's to send");
  assert.equal(b.reads, 0, "never read");
  assert.deepEqual(W.callsOf("seal")[0].slice(1), [2, 4000]);
  assert.ok(texts(ps.view()).includes(WORDS.copy.skipped_same_one));
  await ps.dispose();
});

test("done's resend codes as photo-files answers them ({file_id, code}, no state): broken_upload, not_this_upload and gone send the file AGAIN in a new session from byte 0 - never held as a failure", async () => {
  for (const code of ["broken_upload", "not_this_upload", "gone"]) {
    const W = world();
    const spy = spyHasher();
    const { ps } = phone(W, { hasher: spy });
    const f = new PickedFile("IMG_0101.JPG", 2 * U + 5, 51);
    W.doneCode = code;
    await ps.start(await ps.plan(SHOOT, [f]));
    await until(() => ps.view().phase === "sealed");
    assert.equal(W.callsOf("sessions").length, 2, code + ": a second session");
    assert.equal(W.callsOf("done").length, 2, code + ": done again with the new item");
    const firsts = W.reqs.filter((r) => r.method === "PUT" && r.range.a === 0);
    assert.equal(firsts.length, 2, code + ": the second session starts at byte 0");
    assert.equal(W.callsOf("done")[1][1][0].md5, qx(f), code + ": the hash of the bytes sent");
    assert.equal(W.row(W.rows[0].id).state, "confirmed", code);
    assert.ok(!texts(ps.view()).includes(WORDS.hint.onedrive_failed), code + ": never the failure line");
    assert.ok(texts(ps.view()).includes(WORDS.copy.sent_again_one), code + ": sent again from the start");
    await ps.dispose();
  }
});

test("done's other per-item codes as photo-files answers them (OD §4.5, §18): not_this_device ({file_id, code}, folder null) is held with its own words - never \"OneDrive failed\", never sent again or sealed; not_waiting is settled as sessions' is", async () => {
  {
    const W = world();
    const { ps } = phone(W);
    const f = new PickedFile("IMG_0102.JPG", U + 9, 52);
    W.repo.done = async (uploadId, key, items) => {
      W.calls.push(["done", items.map((x) => Object.assign({}, x))]);
      return { items: items.map((it) => ({ file_id: it.file_id, code: "not_this_device" })), folder: null };
    };
    await ps.start(await ps.plan(SHOOT, [f]));
    await until(() => ps.view().phase === "stopped");
    const v = ps.view();
    assert.ok(texts(v).includes(WORDS.hint.not_this_device), JSON.stringify(texts(v)));
    assert.ok(!texts(v).includes(WORDS.hint.onedrive_failed), "never the failure line");
    assert.equal(W.callsOf("sessions").length, 1, "never sent again");
    assert.equal(W.callsOf("done").length, 1, "done asked once");
    assert.equal(W.callsOf("seal").length, 0, "never sealed while a file is held");
    await ps.dispose();
  }
  {
    const W = world();
    const { ps } = phone(W);
    const a = new PickedFile("IMG_0103.JPG", U + 1, 53), b = new PickedFile("IMG_0104.JPG", 2 * U + 3, 54);
    const real = W.repo.done;
    W.repo.done = async (uploadId, key, items) => {
      const row = W.row(items[0].file_id);
      if (row && row.path === "Phone/IMG_0104.JPG") {
        W.calls.push(["done", items.map((x) => Object.assign({}, x))]);
        row.state = "removed";            // (left out meanwhile, from another device: no longer this hand-in's to send)
        return { items: items.map((it) => ({ file_id: it.file_id, code: "not_waiting" })), folder: { files_state: "waiting" } };
      }
      return real(uploadId, key, items);
    };
    await ps.start(await ps.plan(SHOOT, [a, b]));
    await until(() => ps.view().phase === "sealed");
    const v = ps.view();
    assert.ok(!texts(v).includes(WORDS.hint.onedrive_failed), "never the failure line: " + JSON.stringify(texts(v)));
    assert.equal(W.callsOf("sessions").length, 2, "each file one session: the settled one never sent again");
    assert.deepEqual(W.callsOf("seal")[0].slice(1), [1, a.size], "the seal counts the file in OneDrive");
    await ps.dispose();
  }
});

test("the hashing transport: each chunk hashed ONCE across a lost connection and a 416 (a re-sent range never twice), the same buffer sent", async () => {
  const W = world();
  const spy = spyHasher();
  const { ps } = phone(W, { hasher: spy });
  const f = new PickedFile("C0001.MOV", 5 * U + 11, 21);
  let n = 0;
  W.hook = (req) => {
    if (req.method !== "PUT") return undefined;
    n++;
    if (n === 2) return "drop";          // the connection drops before Microsoft got chunk 2: sent again
    if (n === 4) return "lose";          // chunk 3 arrives, its answer is lost
    if (n === 6) return 416;             // a range Microsoft did not want: asked how far, then on
    return undefined;
  };
  await ps.start(await ps.plan(SHOOT, [f]));
  await until(() => ps.view().phase === "sealed");
  const puts = W.reqs.filter((r) => r.method === "PUT");
  assert.ok(puts.length > Math.ceil(f.size / U), "ranges were sent again (" + puts.length + ")");
  assert.ok(W.reqs.some((r) => r.method === "GET"), "asked how far");
  assert.deepEqual(Array.from(spy.fed.values()), [f.size], "one address, every byte hashed exactly once");
  assert.equal(W.callsOf("done")[0][1][0].md5, qx(f));
  assert.equal(W.row(W.rows[0].id).state, "confirmed");
  assert.equal(W.callsOf("sessions").length, 1, "the same session all along");
  await ps.dispose();
});

test("while the uploader waits to try a chunk again, the words say why (files.waiting_net with no answer, files.throttled when OneDrive is busy) and the beat too; gone with the next chunk in", async () => {
  for (const [what, code, beatSays] of [["drop", "waiting_net", "waiting_net"], [503, "throttled", "busy"]]) {
    const W = world();
    const { ps, views } = phone(W, { deps: { uploader: { wait: () => 300, maxTries: 8 }, ms: { beat: 15, again: 10, pause: 10000, waits: [1] } } });
    const f = new PickedFile("C0003.MOV", 3 * U + 1, 141);
    let n = 0;
    W.hook = (req) => (req.method === "PUT" && ++n >= 2 && n <= 4 ? what : undefined);
    await ps.start(await ps.plan(SHOOT, [f]));
    await until(() => ps.view().phase === "sealed");
    const said = views.filter((v) => v.lines.some((l) => l.group === "files" && l.code === code));
    assert.ok(said.length >= 1, code + ": said while it waited");
    assert.ok(!ps.view().lines.some((l) => l.code === code), code + ": gone once it went on");
    assert.ok(W.beats.some((b) => b.state === beatSays), code + ": the beat says " + beatSays + " - " + JSON.stringify(W.beats.map((b) => b.state)));
    assert.equal(W.row(W.rows[0].id).state, "confirmed");
    await ps.dispose();
  }
});

test("a lost connection never says OneDrive is busy: once an answer comes again (the GET how far, the chunk sent again with its progress) the wait words go - never files.throttled, never a busy beat (the final screenshots: back in front, the page said OneDrive asked DCR to slow down)", async () => {
  const W = world();
  // a real chunk takes a while: the uploader's progress (its 200 ms emit) is heard while the chunk sent again is on its way
  const inner = W.send;
  let n = 0;
  W.send = async (req) => {
    if (req.method !== "PUT") return inner(req);
    n++;
    if (n === 2) throw Object.assign(new Error("No connection"), { code: "offline" });   // the page hidden, the signal gone
    if (typeof req.onProgress === "function") req.onProgress(1024);                     // the browser's upload progress (XHR)
    if (n === 3) await pause(600);                                                       // back in front: the chunk sent again
    return inner(req);
  };
  const { ps, views } = phone(W, { deps: { uploader: { wait: () => 450, maxTries: 8 }, ms: { beat: 20, again: 10, pause: 10000, waits: [1] } } });
  const f = new PickedFile("C0004.MOV", 4 * U + 3, 151);
  await ps.start(await ps.plan(SHOOT, [f]));
  await until(() => ps.view().phase === "sealed");
  const lineCodes = views.map((v) => v.lines.filter((l) => l.group === "files").map((l) => l.code)).flat();
  assert.ok(n >= 6 && W.reqs.some((r) => r.method === "GET"), "the chunk lost, asked how far, sent again: " + n);
  assert.ok(lineCodes.includes("waiting_net"), "it said it waited for the internet: " + JSON.stringify(Array.from(new Set(lineCodes))));
  assert.ok(!lineCodes.includes("throttled"), "never OneDrive busy over a lost connection: " + JSON.stringify(Array.from(new Set(lineCodes))));
  assert.ok(!views.some((v) => texts(v).includes(WORDS.files.throttled)), "never its words");
  assert.ok(!W.beats.some((b) => b.state === "busy"), "never a busy beat: " + JSON.stringify(W.beats.map((b) => b.state)));
  assert.equal(W.row(W.rows[0].id).state, "confirmed");
  await ps.dispose();
});

test("a 404 on the address (the session ran out): find first, then a NEW session from byte 0 - and its hash from 0 too (copy.sent_again)", async () => {
  const W = world();
  const spy = spyHasher();
  const { ps } = phone(W, { hasher: spy });
  const f = new PickedFile("C0002.MOV", 4 * U, 22);
  let n = 0;
  W.hook = (req) => (req.method === "PUT" && ++n === 3 ? "expire" : undefined);
  await ps.start(await ps.plan(SHOOT, [f]));
  await until(() => ps.view().phase === "sealed");
  assert.equal(W.callsOf("find").length, 1, "looked for it first (a lost last answer is never a second copy)");
  assert.equal(W.callsOf("sessions").length, 2);
  const s2 = Array.from(W.sessions.keys())[1];
  assert.equal(W.reqs.find((r) => r.url === s2).range.a, 0, "the new session starts at byte 0");
  const fed = Array.from(spy.fed.values());
  assert.equal(fed.length, 2, "a hash state per address");
  assert.equal(fed[1], f.size, "the new address hashed from 0, whole");
  assert.equal(W.callsOf("done")[0][1][0].md5, qx(f));
  assert.ok(texts(ps.view()).includes(WORDS.copy.sent_again_one));
  await ps.dispose();
});

test("a 507 at the LAST chunk stops the job at once (never the uploader's tries), says OneDrive is full, beats onedrive_full, asks sessions again and sends it from byte 0", async () => {
  const W = world();
  const { ps } = phone(W);
  const f = new PickedFile("C0003.MOV", 3 * U + 5, 23);
  let hit = null;
  W.hook = (req, s, r) => {
    if (req.method === "PUT" && r.b === r.size - 1 && !hit) { hit = req.url; W.full = true; return 507; }
    return undefined;
  };
  let sawFull = null, beatFull = false;
  ps.onChange((v) => { const l = v.lines.find((x) => x.code === "full"); if (l) sawFull = l.text; });
  await ps.start(await ps.plan(SHOOT, [f]));
  await until(() => sawFull);
  assert.equal(sawFull, "OneDrive is full - 1 file waits safely on Sam's phone. The office makes room; DCR goes on by itself (a big file starts again from the beginning)." +
    " Keep it on the memory card (or the phone) until this shoot says ✓.", "cases v24: the full line keeps the original until ✓");
  await until(() => W.callsOf("sessions").length >= 2);       // asked again while full: 507 again
  assert.equal(W.reqs.filter((r) => r.url === hit).length, Math.ceil(f.size / U), "nothing more on that address after its 507: no GET, no try");
  await until(() => W.beats.some((b) => b.state === "onedrive_full"));
  beatFull = true;
  W.full = false;                                             // the office made room
  await until(() => ps.view().phase === "sealed");
  const urls = Array.from(W.sessions.keys());
  assert.equal(urls.length, 2);
  assert.equal(W.reqs.find((r) => r.url === urls[1]).range.a, 0, "from byte 0 in a new session");
  assert.equal(W.callsOf("done")[0][1][0].md5, qx(f), "its hash from 0 with it");
  assert.ok(beatFull);
  await ps.dispose();
});

test("finished but not committed (every byte in, no item): find, then a new session from byte 0 - after ONE look, never 8; a PUT answered 409 the same", async () => {
  for (const how of ["nocommit", 409]) {
    const W = world();
    const { ps } = phone(W);
    const f = new PickedFile("IMG_0009.JPG", 2 * U + 9, 24);
    let first = null;
    W.hook = (req, s, r) => {
      if (req.method === "PUT" && r.b === r.size - 1 && !first) { first = req.url; return how; }
      return undefined;
    };
    await ps.start(await ps.plan(SHOOT, [f]));
    await until(() => ps.view().phase === "sealed");
    assert.ok(W.reqs.filter((r) => r.url === first && r.method === "GET").length <= 1, how + ": one look at the address at most");
    assert.equal(W.callsOf("find").length, 1, how + ": find first");
    assert.equal(W.callsOf("sessions").length, 2, how + ": a new session");
    assert.equal(W.callsOf("done")[0][1][0].md5, qx(f));
    assert.ok(texts(ps.view()).includes(WORDS.copy.sent_again_one), how);
    await ps.dispose();
  }
});

test("a failed job whose session still lives is a pause (keep_screen), started again by itself on visibilitychange - from nextExpectedRanges, its hash kept", async () => {
  const W = world();
  const spy = spyHasher();
  const { ps, doc } = phone(W, { hasher: spy, maxTries: 2, pause: 60000 });
  const f = new PickedFile("C0004.MOV", 4 * U + 1, 25);
  let n = 0, drops = 0;
  W.hook = (req) => {
    if (req.method === "PUT") n++;
    if (n >= 2 && drops < 3) { drops++; return "drop"; }      // the phone locks: requests fail past the uploader's tries
    return undefined;
  };
  await ps.start(await ps.plan(SHOOT, [f]));
  await until(() => ps.view().lines.some((l) => l.code === "keep_screen"));
  const v = ps.view();
  assert.equal(v.phase, "sending", "a pause, not an end");
  assert.ok(v.running);
  assert.equal(texts(v).filter((t) => t === WORDS.copy.keep_screen).length, 1);
  assert.deepEqual(v.buttons, ["cancel_copy"], "nothing of it in OneDrive yet: Cancel it alone - Hand in what's there once a file is in (OD §3.3 step 8, " +
    "review round 3); no separate Stop");
  await pause(30);
  assert.notEqual(ps.view().phase, "sealed", "it waits for the page to be in front again");
  doc.visibilityState = "hidden";
  doc.fire("visibilitychange");
  doc.visibilityState = "visible";
  doc.fire("visibilitychange");
  await until(() => ps.view().phase === "sealed");
  assert.equal(W.callsOf("sessions").length, 1, "the same session");
  assert.deepEqual(Array.from(spy.fed.values()), [f.size], "its hash state kept: every byte once");
  assert.equal(W.callsOf("done")[0][1][0].md5, qx(f));
  await ps.dispose();
});

test("uploads off (sessions' 503 for the whole call): no bytes move and no beat, sessions asked again every AGAIN_MS; the mode back on, it goes on", async () => {
  const W = world();
  W.mode = "off";
  const { ps } = phone(W);
  const f = new PickedFile("IMG_0010.JPG", 1000, 26);
  await ps.start(await ps.plan(SHOOT, [f]));
  await until(() => W.callsOf("sessions").length >= 1);
  const b0 = W.beats.length;
  assert.ok(b0 <= 1, "at most the beat of the start, before sessions answered");
  await until(() => W.callsOf("sessions").length >= 4);
  assert.equal(W.reqs.length, 0, "no bytes");
  assert.equal(W.beats.length, b0, "no beat while the mode refuses (beats every 5 ms here, sessions every 10 ms)");
  const v = ps.view();
  assert.ok(v.lines.some((l) => l.code === "uploads_off" && l.text === WORDS.hint.uploads_off), JSON.stringify(v.lines));
  W.mode = "on";
  await until(() => ps.view().phase === "sealed");
  assert.ok(W.beats.length >= 1);
  await ps.dispose();
});

/* ── Pick the rest again, Hand in what's there, Cancel it ─────────────── */

/** A phone hand-in stopped by a reload: upload 5 of this phone (its keys in storage), with rows in every state. */
function stoppedWorld(files) {
  const W = world({ firstRow: 600 });
  W.uploads.set(5, { id: 5, state: "abandoned", clientKey: CLIENT });
  W.nextUpload = 6;
  const { A, B, C: Cf, E } = files;
  W.addRow({ id: 501, path: "Phone/A.HEIC", size: A.size, md5: qx(A), state: "confirmed", upload: 5 });
  const r2 = W.addRow({ id: 502, path: "Phone/B.MOV", size: B.size, upload: 5, sessionAt: true, step: "session" });
  r2.item = W.addItem(502, B);                   // its last chunk committed; its done never ran
  W.addRow({ id: 503, path: "Phone/C.JPG", size: Cf.size, upload: 5, sessionAt: true, step: "session" });   // never committed
  if (E) W.addRow({ id: 504, path: "Phone/E.JPG", size: E.size, md5: qx(E), state: "confirmed", counted: true, upload: 2 });
  return W;
}
const seed = () => ({ [P.STORE_KEY]: JSON.stringify({ device_key: KEY, device_id: 7, hand_ins: { [SHOOT]: CLIENT } }) });

test("Pick the rest again: a re-picked sent row hashed then skipped; a row whose last chunk committed answered found -> done with no bytes; one never committed sent from byte 0; a different file of that name a new row (2)", async () => {
  const A = new PickedFile("A.HEIC", 700, 31), B = new PickedFile("B.MOV", 3 * U + 3, 32), Cf = new PickedFile("C.JPG", 2 * U, 33);
  const D = new PickedFile("D.JPG", 900, 34), A2 = new PickedFile("A.HEIC", 700, 35), E = new PickedFile("E.JPG", 800, 36);
  const W = stoppedWorld({ A, B, C: Cf, E });
  const spy = spyHasher();
  const { ps } = phone(W, { seed: seed(), hasher: spy });
  assert.ok(ps.knows(SHOOT), "this phone holds the hand-in's keys");
  assert.equal(ps.viewer().device_id, 7, "the status's pc_id of this phone's hand-in");
  const p = await ps.plan(SHOOT, [A, B, Cf, D, A2, E], { rest: true });
  assert.deepEqual(p.resume.map((r) => r.fileId), [502, 503]);
  assert.deepEqual(p.send.map((e) => e.path), ["Phone/D.JPG", "Phone/A (2).HEIC"], "a different file of that name is never skipped");
  assert.equal(p.skipped, 2, "A (this hand-in's, confirmed) and E (another hand-in's, the same bytes)");
  await ps.start(p);
  await until(() => ps.view().phase === "sealed");
  const begin = W.callsOf("begin")[0][2];
  assert.equal(begin.clientKey, CLIENT, "opened again with its own client key");
  assert.equal(begin.deviceKey, KEY);
  const sessions = W.callsOf("sessions").map((s) => s[1][0]);
  assert.ok(!sessions.some((s) => s.file_id === 501), "the confirmed row is not asked about");
  assert.deepEqual(sessions.find((s) => s.file_id === 502), { file_id: 502, md5: qx(B) }, "the re-picked file's hash presented");
  const done = W.callsOf("done").map((c) => c[1][0]);
  assert.deepEqual(done.find((x) => x.file_id === 502), { file_id: 502, item_id: W.row(502).item, md5: qx(B) }, "found -> done with that item and the hash");
  const bUrls = Array.from(W.sessions.entries()).filter(([, s]) => s.fileId === 502);
  assert.equal(bUrls.length, 0, "no bytes of B sent");
  const cUrl = Array.from(W.sessions.entries()).find(([, s]) => s.fileId === 503)[0];
  assert.equal(W.reqs.find((r) => r.url === cUrl).range.a, 0, "C from byte 0 in a new session");
  // one read for the match, one for the send - never a second hash of it
  assert.deepEqual([A.reads, B.reads, Cf.reads, E.reads, D.reads, A2.reads], [A.size, B.size, 2 * Cf.size, E.size, D.size, 2 * A2.size]);
  assert.equal(Array.from(spy.fed.values()).reduce((a, x) => a + x, 0), A.size + B.size + Cf.size + E.size + A2.size + D.size,
    "the match's reads hashed, D hashed while sent, C and A (2) not hashed again while sent");
  assert.deepEqual(W.callsOf("seal")[0], ["seal", 5, A.size + B.size + Cf.size + D.size + A2.size]);
  assert.ok(["confirmed", "confirmed", "confirmed", "confirmed", "confirmed"].every((s, i) => W.row([501, 502, 503, 600, 601][i]).state === s));
  const t = texts(ps.view());
  assert.ok(t.includes("2 files were already here and were skipped."));
  assert.ok(t.includes(WORDS.copy.renamed_one));
  await ps.dispose();
});

test("Hand in what's there after a reload: find for every row still without a hash - one IN OneDrive is asked about (not_checked_phone), never dropped; Hand in without them seals the rest", async () => {
  const A = new PickedFile("A.HEIC", 700, 41), B = new PickedFile("B.MOV", 3 * U + 3, 42), Cf = new PickedFile("C.JPG", 2 * U, 43);
  const W = stoppedWorld({ A, B, C: Cf });
  const { ps } = phone(W, { seed: seed() });
  await ps.handIn({ shootId: SHOOT });
  assert.deepEqual(W.callsOf("find").map((c) => c[1]).sort(), [502, 503]);
  assert.equal(W.callsOf("seal").length, 0, "not sealed: the found file would be dropped");
  const v = ps.view();
  assert.equal(v.phase, "asking");
  assert.deepEqual(v.buttons, ["pick_them_again", "hand_in_without"]);
  assert.deepEqual(ps.viewer(), { device_id: 7, running_here: false, phone_found: 1 }, "the chooser's not_checked_phone count");
  await ps.handInWithout();
  assert.deepEqual(W.callsOf("seal")[0], ["seal", 1, A.size]);
  assert.equal(ps.view().phase, "sealed");
  assert.equal(ps.view().lines.at(-1).text.startsWith("The file is in OneDrive ✓ (checked "), true);
  assert.equal(W.row(502).state, "removed", "it stays in the shoot's folder as a file added without DCR");
  assert.ok(!ps.knows(SHOOT), "the closed hand-in's key is let go");
  await ps.dispose();
});

test("Pick them again (after not_checked_phone): the found file hashed, done with no bytes, then the seal counts it", async () => {
  const A = new PickedFile("A.HEIC", 700, 51), B = new PickedFile("B.MOV", 3 * U + 3, 52), Cf = new PickedFile("C.JPG", 2 * U, 53);
  const W = stoppedWorld({ A, B, C: Cf });
  W.row(503).state = "removed";                  // (C left out meanwhile: only B is unchecked)
  const { ps } = phone(W, { seed: seed() });
  await ps.handIn({ shootId: SHOOT });
  assert.equal(ps.view().phase, "asking");
  await ps.start(await ps.plan(SHOOT, [B], { rest: true }));
  await until(() => ps.view().phase === "sealed");
  assert.equal(W.reqs.length, 0, "no bytes sent");
  assert.deepEqual(W.callsOf("seal")[0], ["seal", 2, A.size + B.size]);
  await ps.dispose();
});

test("Hand in what's there while sending: the file in flight stopped first; one whose last chunk landed is done with its hash (this page holds it), the rest never sent are left to the seal", async () => {
  const W = world();
  const f1 = new PickedFile("IMG_0001.JPG", U + 5, 61), f2 = new PickedFile("IMG_0002.JPG", 2 * U + 5, 62), f3 = new PickedFile("IMG_0003.JPG", 3 * U, 63);
  const { ps } = phone(W);
  let acted = null;
  W.hook = (req, s, r) => {
    if (req.method === "PUT" && r.size === f2.size && r.b === r.size - 1 && !acted) {
      W.onCommit = () => { W.onCommit = null; acted = ps.handIn(); };      // pressed as its last chunk lands
      return "lose";
    }
    return undefined;
  };
  await ps.start(await ps.plan(SHOOT, [f1, f2, f3]));
  await until(() => acted);
  await acted;
  assert.equal(ps.view().phase, "sealed");
  const done2 = W.callsOf("done").map((c) => c[1][0]).find((x) => x.md5 === qx(f2));
  assert.ok(done2, "f2 done with the hash of the bytes sent");
  assert.deepEqual(W.callsOf("seal")[0], ["seal", 2, f1.size + f2.size]);
  assert.equal(W.rows.find((r) => r.size === f3.size).state, "removed", "f3 was never sent: removed by the seal");
  assert.equal(f3.reads, 0);
  await ps.dispose();
});

test("Cancel it while sending: the file in flight stopped first, photo_upload_cancel, copy.cancelled_sent counting the files that reached OneDrive; the key let go", async () => {
  const W = world();
  const f1 = new PickedFile("IMG_0001.JPG", 900, 71), f2 = new PickedFile("IMG_0002.JPG", 3 * U, 72);
  const { ps } = phone(W);
  let acted = null;
  W.hook = (req, s, r) => { if (req.method === "PUT" && r.size === f2.size && r.a === U && !acted) acted = ps.cancel(); return undefined; };
  await ps.start(await ps.plan(SHOOT, [f1, f2]));
  await until(() => acted);
  await acted;
  assert.equal(ps.view().phase, "cancelled");
  assert.equal(W.callsOf("cancel").length, 1);
  assert.equal(ps.view().lines.at(-1).text, WORDS.copy.cancelled_sent_one);
  assert.deepEqual(W.callsOf("find"), [], "stopped before its last chunk: nothing of f2 can be in OneDrive - no find asked");
  assert.ok(!ps.knows(SHOOT));
  await ps.dispose();
});

test("Cancel it pressed as a file's last chunk lands, its answer cut off (review round 6; round 5's \"the signal lost at that moment\"): this page asks find for that file BEFORE the cancel and counts it - a one-chunk photo alone (every chunk is its last), and beside a file already in", async () => {
  const run = async (files, target) => {
    const W = world();
    const { ps } = phone(W);
    let acted = null;
    W.hook = (req, s, r) => {
      if (req.method === "PUT" && r.size === target.size && r.last && !acted) {
        W.onCommit = () => { W.onCommit = null; acted = ps.cancel(); };      // pressed as its last chunk lands
        return "lose";
      }
      return undefined;
    };
    await ps.start(await ps.plan(SHOOT, files));
    await until(() => acted);
    await acted;
    const row = W.rows.find((x) => x.size === target.size);
    const kinds = W.calls.map((c) => c[0]);
    const out = { W, row, phase: ps.view().phase, kinds, said: ps.view().lines.filter((l) => /^cancelled_sent/.test(l.code)).map((l) => l.text) };
    await ps.dispose();
    return out;
  };
  const p = new PickedFile("IMG_0101.JPG", 900, 101);
  const one = await run([p], p);
  assert.equal(one.phase, "cancelled");
  assert.equal(one.row.state, "removed", "the cancel removed its row");
  assert.ok(one.row.item && one.W.items.has(one.row.item), "its bytes are in the shoot's Phone/ folder all the same");
  assert.deepEqual(one.W.callsOf("find"), [["find", one.row.id]]);
  assert.ok(one.kinds.indexOf("find") < one.kinds.indexOf("cancel"), "find asked while the hand-in is open (photo-files finds nothing in a cancelled one)");
  assert.deepEqual(one.said, [WORDS.copy.cancelled_sent_one], "never a bare \"Cancelled\" over a photo left in Phone/");
  const f1 = new PickedFile("IMG_0102.JPG", 900, 102), f2 = new PickedFile("IMG_0103.JPG", 2 * U + 9, 103);
  const two = await run([f1, f2], f2);
  assert.deepEqual(two.said, [fill(WORDS.copy.cancelled_sent, { n: 2 })], "both files stay in the shoot's folder - the office is asked about both");
});

test("Cancel it while a file's last chunk goes (review round 6): its answer lost and the connection gone while the page waits to ask again - find tells; cut off before OneDrive has it - no line, never a false \"had already reached OneDrive\"; find refused - counted (the safe side)", async () => {
  const said = (ps) => ps.view().lines.filter((l) => /^cancelled_sent/.test(l.code)).map((l) => l.text);
  // the signal drops at the last chunk's answer; the page waits for the connection (its GET how far gets nothing) and the
  // photographer gives up and presses Cancel it
  {
    const W = world();
    const p = new PickedFile("IMG_0111.JPG", 900, 111);
    const { ps } = phone(W);
    let lost = false, acted = null;
    W.hook = (req, s, r) => {
      if (req.method === "PUT" && r.last && !lost) { lost = true; return "lose"; }
      if (lost && req.method === "GET") { if (!acted) acted = ps.cancel(); return "drop"; }
      return undefined;
    };
    await ps.start(await ps.plan(SHOOT, [p]));
    await until(() => acted);
    await acted;
    assert.equal(ps.view().phase, "cancelled");
    assert.ok(W.rows[0].item, "the photo committed in OneDrive");
    assert.deepEqual(said(ps), [WORDS.copy.cancelled_sent_one]);
    await ps.dispose();
  }
  // Cancel it pressed while the photo's only chunk goes, cut off before OneDrive has it: find answers nothing - "Cancelled."
  {
    const W = world();
    const p = new PickedFile("IMG_0112.JPG", 900, 112);
    const { ps } = phone(W);
    let acted = null;
    W.hook = (req, s, r) => { if (req.method === "PUT" && r.last && !acted) { acted = ps.cancel(); return "drop"; } return undefined; };
    await ps.start(await ps.plan(SHOOT, [p]));
    await until(() => acted);
    await acted;
    assert.equal(ps.view().phase, "cancelled");
    assert.equal(W.items.size, 0, "nothing of it in OneDrive");
    assert.deepEqual(W.callsOf("find").length, 1);
    assert.deepEqual(said(ps), [], "no cancelled_sent line");
    await ps.dispose();
  }
  // the same, find refused (it cannot say): counted - the office looks and finds fewer
  {
    const W = world();
    const p = new PickedFile("IMG_0113.JPG", 900, 113);
    const { ps } = phone(W);
    let acted = null;
    W.repo.find = async (uploadId, key, fileId) => { W.calls.push(["find", fileId]); throw refuse("not_this_device"); };
    W.hook = (req, s, r) => { if (req.method === "PUT" && r.last && !acted) { acted = ps.cancel(); return "drop"; } return undefined; };
    await ps.start(await ps.plan(SHOOT, [p]));
    await until(() => acted);
    await acted;
    assert.equal(ps.view().phase, "cancelled");
    assert.equal(W.callsOf("cancel").length, 1, "the cancel itself still goes");
    assert.deepEqual(said(ps), [WORDS.copy.cancelled_sent_one]);
    await ps.dispose();
  }
});

test("Cancel it, while this page holds the hand-in's files, counts its OWN files in OneDrive the cancel did not put back (OD §5.5, §23; review round 5): never the file in flight whose session the database counts, never a file put back as the shoot's own; an answer without removed_sent (asked again) counts the same", async () => {
  const run = async (answer) => {
    const W = world();
    const f1 = new PickedFile("IMG_0001.JPG", 900, 71), f2 = new PickedFile("IMG_0002.JPG", 3 * U, 72);
    const { ps } = phone(W);
    let acted = null;
    W.cancelAnswer = answer ? (a) => answer(a, W) : null;
    W.hook = (req, s, r) => { if (req.method === "PUT" && r.size === f2.size && r.a === U && !acted) acted = ps.cancel(); return undefined; };
    await ps.start(await ps.plan(SHOOT, [f1, f2]));
    await until(() => acted);
    await acted;
    assert.equal(ps.view().phase, "cancelled");
    const said = ps.view().lines.filter((l) => l.group === "copy" && /^cancelled_sent/.test(l.code)).map((l) => l.text);
    await ps.dispose();
    return { said, W };
  };
  // the database's count (removed_sent 2: f1 in OneDrive, and f2 whose session was handed out though none of its bytes
  // are) - the page holds both files and knows f2 is not in OneDrive: one file
  const plain = await run(null);
  assert.deepEqual(plain.W.callsOf("cancel").length, 1);
  assert.deepEqual(plain.said, [WORDS.copy.cancelled_sent_one], "only f1 reached OneDrive");
  // f1 was put back as the shoot's own file (a row the hand-in recorded over): no line, whatever removed_sent says
  const f1Id = (W) => W.rows.find((r) => r.path === "Phone/IMG_0001.JPG").id;
  assert.deepEqual((await run((a, W) => Object.assign(a, { removed_sent: 1, put_back: 1, put_back_ids: [f1Id(W)] }))).said, [], "never \"ask the office to delete it\"");
  // a put_back_ids that is not a list puts nothing back
  assert.deepEqual((await run((a) => Object.assign(a, { removed_sent: 0, put_back_ids: "x" }))).said, [WORDS.copy.cancelled_sent_one]);
  // more in removed_sent than the page has in OneDrive: the page's own count (it holds every file of the hand-in)
  assert.deepEqual((await run((a) => Object.assign(a, { removed_sent: 2 }))).said, [WORDS.copy.cancelled_sent_one]);
  // asked again (the first answer lost): {again: true} without removed_sent - this page's own files in OneDrive
  assert.deepEqual((await run(() => ({ ok: true, state: "cancelled", removed: 0, put_back: 0, again: true }))).said, [WORDS.copy.cancelled_sent_one]);
  // a removed_sent that is not a count is not one
  assert.deepEqual((await run((a) => Object.assign(a, { removed_sent: "2" }))).said, [WORDS.copy.cancelled_sent_one]);
});

test("Cancel it after a file's last chunk landed but before its done reached DCR (review round 5, the lows of rounds 4's count): that file is in OneDrive - this page counts it, though the cancel's removed_sent leaves it out", async () => {
  const W = world();
  const f1 = new PickedFile("IMG_0001.JPG", 900, 81), f2 = new PickedFile("IMG_0002.JPG", 2 * U + 9, 82);
  const { ps } = phone(W);
  let acted = null;
  const done = W.repo.done;
  // f2's done gets no answer (the signal lost at that moment): the photographer presses Cancel it meanwhile
  W.repo.done = async (uploadId, key, items) => {
    if (W.row(items[0].file_id).size === f2.size) {
      if (!acted) acted = ps.cancel();
      throw Object.assign(new Error("no answer"), { code: "NETWORK", retryable: true });
    }
    return done(uploadId, key, items);
  };
  // the database knows only what its done calls told it (drive_file_id): f1 - the answer before round 5's count
  W.cancelAnswer = (a) => Object.assign(a, { removed_sent: W.rows.filter((r) => r.state === "removed" && r.md5).length });
  await ps.start(await ps.plan(SHOOT, [f1, f2]));
  await until(() => acted);
  await acted;
  assert.equal(ps.view().phase, "cancelled");
  assert.ok(W.row(W.rows.find((r) => r.size === f2.size).id).item, "f2's bytes are in OneDrive (its item)");
  assert.deepEqual(W.callsOf("cancel").length, 1);
  assert.deepEqual(ps.view().lines.filter((l) => /^cancelled_sent/.test(l.code)).map((l) => l.text), [fill(WORDS.copy.cancelled_sent, { n: 2 })],
    "both files stay in the shoot's folder - the office is asked about both");
  await ps.dispose();
});

test("Cancel it after a reload (OD §5.5, §23; review round 5): a page that holds none of the hand-in's files counts the cancel's removed_sent (the safe side) - and after a Pick the rest again of some of them, the rows it does not hold too", async () => {
  const A = new PickedFile("A.HEIC", 700, 91), B = new PickedFile("B.MOV", 3 * U + 3, 92), Cf = new PickedFile("C.JPG", 2 * U, 93);
  const said = (ps) => ps.view().lines.filter((l) => /^cancelled_sent/.test(l.code)).map((l) => l.text);
  // reloaded, then Cancel it: A in OneDrive (its hash), B's last chunk in but its done never ran, C's session handed out -
  // the page knows only A; the database counts the three (sessions handed out): three, never one
  const W = stoppedWorld({ A, B, C: Cf });
  const { ps } = phone(W, { seed: seed() });
  await ps.cancel({ shootId: SHOOT });
  assert.equal(ps.view().phase, "cancelled");
  assert.deepEqual(said(ps), [fill(WORDS.copy.cancelled_sent, { n: 3 })]);
  await ps.dispose();
  // its answer lost (asked again, no removed_sent): the page's own - A
  const W1 = stoppedWorld({ A, B, C: Cf });
  W1.cancelAnswer = () => ({ ok: true, state: "cancelled", removed: 0, put_back: 0, again: true });
  const one = phone(W1, { seed: seed() });
  await one.ps.cancel({ shootId: SHOOT });
  assert.deepEqual(said(one.ps), [WORDS.copy.cancelled_sent_one]);
  await one.ps.dispose();
  // reloaded, C picked again and sent; B never picked again (its fate unknown to the page), then Cancel it: three - B's
  // bytes are in OneDrive though no done told DCR
  const W2 = stoppedWorld({ A, B, C: Cf });
  const two = phone(W2, { seed: seed() });
  await two.ps.start(await two.ps.plan(SHOOT, [Cf], { rest: true }));
  await until(() => two.ps.view().phase === "stopped" && W2.row(503).state === "confirmed");
  await two.ps.cancel({ shootId: SHOOT });
  assert.equal(two.ps.view().phase, "cancelled");
  assert.deepEqual(said(two.ps), [fill(WORDS.copy.cancelled_sent, { n: 3 })], "A, B and C");
  await two.ps.dispose();
  // the same, B picked again too (found -> done) and Cancel it pressed while C's bytes go: the page holds every file of
  // the hand-in again - its own count (A and B), never removed_sent's 3 (C's session counted, none of its bytes in: its
  // last chunk is cut off before OneDrive has it, so find answers nothing - review round 6)
  const W3 = stoppedWorld({ A, B, C: Cf });
  const three = phone(W3, { seed: seed() });
  let acted = null;
  W3.hook = (req, s, r) => {
    if (req.method === "PUT" && r.size === Cf.size && r.a === U && !acted) { acted = three.ps.cancel({ shootId: SHOOT }); return "drop"; }
    return undefined;
  };
  await three.ps.start(await three.ps.plan(SHOOT, [B, Cf], { rest: true }));
  await until(() => acted);
  await acted;
  assert.equal(three.ps.view().phase, "cancelled");
  assert.equal(W3.row(502).state, "removed");
  assert.deepEqual(said(three.ps), [fill(WORDS.copy.cancelled_sent, { n: 2 })], "A and B - never C, whose bytes never got in");
  await three.ps.dispose();
});

test("the seal: a count the database refuses (count_mismatch) is sealed with the database's own count of the rows with a hash; nothing in OneDrive at all -> cancelled (hint.empty), never sealed empty", async () => {
  const W = world();
  const { ps } = phone(W);
  const seal = W.repo.seal;
  let once = true;
  W.repo.seal = async (id, n, b) => {
    // a row of this hand-in whose done's answer the page never heard: its hash is in the database
    if (once) { once = false; W.addRow({ id: 999, path: "Phone/LOST.JPG", size: 10, md5: "FAKEqxd00000000000000000000=", upload: id }); }
    return seal(id, n, b);
  };
  const f1 = new PickedFile("IMG_0001.JPG", 700, 141), f2 = new PickedFile("IMG_0002.JPG", 800, 142);
  await ps.start(await ps.plan(SHOOT, [f1, f2]));
  await until(() => ps.view().phase === "sealed");
  assert.deepEqual(W.callsOf("seal").map((c) => c.slice(1)), [[2, 1500], [3, 1510]]);
  assert.match(ps.view().lines.at(-1).text, /^All 3 files are in OneDrive ✓/);
  await ps.dispose();
  // Hand in what's there before anything reached OneDrive
  const W2 = world();
  const two = phone(W2);
  let acted = null;
  W2.hook = (req) => { if (req.method === "PUT" && !acted) acted = two.ps.handIn(); return 503; };
  await two.ps.start(await two.ps.plan(SHOOT, [new PickedFile("IMG_0003.JPG", 2 * U, 143)]));
  await until(() => acted);
  await acted;
  assert.deepEqual(W2.callsOf("seal").map((c) => c.slice(1)), [[0, 0]], "the database judges: nothing has a hash");
  assert.equal(W2.callsOf("cancel").length, 1);
  assert.equal(two.ps.view().phase, "cancelled");
  assert.equal(two.ps.view().lines.at(-1).text, WORDS.hint.empty);
  await two.ps.dispose();
});

/* ── the rules of the page ────────────────────────────────────────────── */

test("the upload address stays in page memory only: never in local storage, IndexedDB, a console line, the view or the worker", async () => {
  const W = world();
  const logs = [];
  const saved = {};
  for (const k of ["log", "info", "warn", "error", "debug"]) { saved[k] = console[k]; console[k] = (...a) => { logs.push(a.map(String).join(" ")); }; }
  const opened = [];
  const hadIdb = Object.prototype.hasOwnProperty.call(globalThis, "indexedDB");
  const oldIdb = globalThis.indexedDB;
  globalThis.indexedDB = { open: (...a) => { opened.push(a); return {}; } };
  let fw = null;
  try {
    const hasher = P.createHasher({ worker: () => (fw = new FakeWorker()) });
    const { ps, storage, views } = phone(W, { hasher });
    let n = 0;
    W.hook = (req) => (req.method === "PUT" && ++n === 2 ? "expire" : undefined);
    await ps.start(await ps.plan(SHOOT, [new PickedFile("IMG_0001.JPG", 2 * U + 1, 81), new PickedFile("IMG_0002.JPG", 10, 82)]));
    await until(() => ps.view().phase === "sealed");
    const addrs = Array.from(W.sessions.keys());
    assert.ok(addrs.length >= 3);
    const stored = storage.writes.map((w) => w.join("=")).join("\n");
    for (const a of addrs) {
      assert.ok(!stored.includes(a), "never in local storage");
      assert.ok(!logs.some((l) => l.includes(a)), "never logged");
      assert.ok(!views.some((v) => JSON.stringify(v).includes(a)), "never in the view");
      assert.ok(!fw.seen.some((m) => JSON.stringify(Object.assign({}, m, { bytes: undefined })).includes(a)), "never posted to the worker");
    }
    assert.ok(!/up\.example|https:/.test(stored));
    assert.deepEqual(Object.keys(JSON.parse(storage.m.get(P.STORE_KEY))).sort(), ["device_id", "device_key", "hand_ins"]);
    assert.ok(fw.seen.every((m) => /^[hw]\d+$/.test(m.key)), "the worker knows each address by an opaque key");
    assert.deepEqual(opened, [], "no IndexedDB");
    assert.deepEqual(logs, [], "nothing logged at all");
    assert.equal(W.callsOf("done")[0][1][0].md5, quickXorHash(lcg(2 * U + 1, 81)), "the worker's hash");
    await ps.dispose();
  } finally {
    for (const k of Object.keys(saved)) console[k] = saved[k];
    if (hadIdb) globalThis.indexedDB = oldIdb; else delete globalThis.indexedDB;
  }
  assert.ok(!/console\.|indexedDB|sessionStorage/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")), "the module has no console, IndexedDB or session storage");
});

test("words: every line is a word of the cases, mapped from the job's state and code - never createUploader's job.error", async () => {
  const errors = new Set();
  const wrap = (parts) => {
    const up = createUploader(parts);
    up.onChange((items) => { for (const j of items) if (j.error) errors.add(j.error); });
    return up;
  };
  const all = [];
  const scenarios = [
    (W) => { let n = 0; W.hook = (req) => (++n >= 2 && n <= 6 ? "drop" : undefined); },
    (W) => { let hit = false; W.hook = (req, s, r) => (req.method === "PUT" && r.b === r.size - 1 && !hit ? (hit = true, 409) : undefined); },
    (W) => { let hit = false; W.hook = (req, s, r) => (req.method === "PUT" && r.b === r.size - 1 && !hit ? (hit = true, W.full = true, 507) : undefined); setTimeout(() => { W.full = false; }, 60); },
    (W) => { let n = 0; W.hook = (req) => (req.method === "PUT" && ++n === 2 ? "expire" : undefined); },
    (W) => { let n = 0; W.hook = (req) => (req.method === "PUT" && ++n <= 3 ? 503 : undefined); },
  ];
  for (const set of scenarios) {
    const W = world();
    set(W);
    const { ps, views, doc } = phone(W, { maxTries: 2, pause: 20, deps: { createUploader: wrap } });
    await ps.start(await ps.plan(SHOOT, [new PickedFile("IMG_0001.JPG", 2 * U + 3, 91), new PickedFile("bad.txt", 3, 92)]));
    setTimeout(() => doc.fire("visibilitychange"), 30);
    await until(() => ps.view().phase === "sealed", 15000);
    all.push(...views, ps.view());
    await ps.dispose();
  }
  assert.ok(errors.size >= 2, "the uploader did set its own texts: " + Array.from(errors).join(" | "));
  for (const v of all) {
    for (const l of v.lines) {
      const g = WORDS[l.group] || {};
      assert.ok(typeof g[l.code] === "string" || typeof g[l.code + "_one"] === "string", l.group + "." + l.code);
      for (const e of errors) assert.ok(!l.text.includes(e), "job.error on screen: " + e);
      assert.ok(!/\{[a-z_]+\}/.test(l.text), "unfilled: " + l.text);
    }
  }
  assert.ok(all.some((v) => v.lines.some((l) => l.code === "not_media")));
});

test("the screen: a Wake Lock while sending (refused: keep_screen), asked again on visible; beforeunload warns only while it sends", async () => {
  const W = world();
  const { ps, win, doc } = phone(W, { noWakeLock: true });
  let release = null;
  const held = new Promise((r) => { release = r; });
  const orig = W.repo.sessions;
  W.repo.sessions = async (...a) => { await held; return orig(...a); };
  await ps.start(await ps.plan(SHOOT, [new PickedFile("IMG_0001.JPG", 500, 95)]));
  await until(() => win.count("beforeunload") === 1);
  assert.ok(texts(ps.view()).includes(WORDS.copy.keep_screen), "no Wake Lock here: the line");
  const ev = win.fire("beforeunload");
  assert.equal(ev.prevented, true);
  assert.equal(ev.returnValue, "");
  assert.equal(doc.count("visibilitychange"), 1);
  release();
  await until(() => ps.view().phase === "sealed");
  assert.equal(win.count("beforeunload"), 0);
  assert.equal(doc.count("visibilitychange"), 0);
  await ps.dispose();
  // a Wake Lock the phone let go of (the screen was hidden) is asked for again on visible
  const W2 = world();
  const fired = [];
  const lockOf = () => ({ l: [], release() {}, addEventListener(t, f) { if (t === "release") this.l.push(f); } });
  let asked = 0, last = null;
  const nav2 = { userAgent: "Android", wakeLock: { request: async () => { asked++; last = lockOf(); fired.push(last); return last; } } };
  let release2 = null;
  const held2 = new Promise((r) => { release2 = r; });
  const orig2 = W2.repo.sessions;
  W2.repo.sessions = async (...a) => { await held2; return orig2(...a); };
  const two = phone(W2, { deps: { navigator: nav2 } });
  await two.ps.start(await two.ps.plan(SHOOT, [new PickedFile("IMG_0002.JPG", 500, 96)]));
  await until(() => asked === 1);
  assert.equal(W2.callsOf("begin")[0][2].label, "Android phone");
  last.l.forEach((f) => f());                  // hidden: the system let it go
  two.doc.fire("visibilitychange");            // in front again
  await until(() => asked === 2);
  assert.ok(!texts(two.ps.view()).includes(WORDS.copy.keep_screen), "a lock held: no line");
  release2();
  await until(() => two.ps.view().phase === "sealed");
  await two.ps.dispose();
});

test("storage blocked: the keys live for the page (the hand-in works); after a reload this phone cannot pick the rest again - Hand in what's there seals with no find", async () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const W = world();
  const { ps } = phone(W, { storage: blocked });
  await ps.start(await ps.plan(SHOOT, [new PickedFile("IMG_0001.JPG", 600, 101)]));
  await until(() => ps.view().phase === "sealed");
  await ps.dispose();
  const A = new PickedFile("A.HEIC", 700, 102), B = new PickedFile("B.MOV", 3 * U + 3, 103), Cf = new PickedFile("C.JPG", 2 * U, 104);
  const W2 = stoppedWorld({ A, B, C: Cf });
  const again = phone(W2, { storage: blocked });
  assert.equal(again.ps.knows(SHOOT), false);
  await again.ps.handIn({ shootId: SHOOT, uploadId: 5 });
  assert.equal(W2.callsOf("find").length, 0, "no device key: nothing to look with");
  assert.deepEqual(W2.callsOf("seal")[0], ["seal", 1, A.size]);
  await again.ps.dispose();
});

test("Hand in what's there on ANOTHER phone (its own device key, OD §3.3 step 9): PF's seal alone - no find (photo-files answers anyone but the hand-in's device not_this_device); the hand-in's own phone does find", async () => {
  const A = new PickedFile("A.HEIC", 700, 111), B = new PickedFile("B.MOV", 3 * U + 3, 112), Cf = new PickedFile("C.JPG", 2 * U, 113);
  const W = stoppedWorld({ A, B, C: Cf });
  W.repo.find = async (uploadId, key, fileId) => { W.calls.push(["find", fileId, key]); throw err("not_this_device", 403); };
  const other = phone(W, { seed: { [P.STORE_KEY]: JSON.stringify({ device_key: "pk_" + "B".repeat(22), device_id: 8, hand_ins: {} }) } });
  assert.equal(other.ps.knows(SHOOT), false);
  await other.ps.handIn({ shootId: SHOOT, uploadId: 5, deviceId: 7 });
  assert.equal(W.callsOf("find").length, 0, "never asked from another device");
  assert.deepEqual(W.callsOf("seal")[0], ["seal", 1, A.size], "the rows with a hash count; the rest are removed by the seal");
  assert.equal(other.ps.view().phase, "sealed");
  assert.ok(!texts(other.ps.view()).includes(WORDS.hint.not_this_device));
  await other.ps.dispose();
  // the hand-in's own phone, its keys lost (storage cleared) but its device row the status's pc_id: it may look
  const W2 = stoppedWorld({ A, B, C: Cf });
  const own = phone(W2, { seed: { [P.STORE_KEY]: JSON.stringify({ device_key: KEY, device_id: 7, hand_ins: {} }) } });
  await own.ps.handIn({ shootId: SHOOT, uploadId: 5, deviceId: 7 });
  assert.deepEqual(W2.callsOf("find").map((c) => c[1]).sort(), [502, 503]);
  assert.equal(own.ps.view().phase, "asking");
  await own.ps.dispose();
});

test("a press on ANOTHER shoot's stopped hand-in never ends the one this page holds: Hand in what's there / Cancel it act on the shoot they name", async () => {
  const W = world();
  const { ps } = phone(W);
  const f = new PickedFile("IMG_0001.JPG", 2 * U, 121);
  W.hook = (req) => (req.method === "PUT" ? "drop" : undefined);         // shoot 31's hand-in stops (no connection, for good)
  await ps.start(await ps.plan(SHOOT, [f]));
  await until(() => W.callsOf("sessions").length >= 1);
  const held = W.uploads.get(1);
  W.uploads.set(9, { id: 9, state: "abandoned", clientKey: "OTHERKEY_000000001" });
  W.addRow({ id: 901, path: "Phone/X.JPG", size: 10, md5: "FAKEqx000000000000000000009=", state: "confirmed", upload: 9 });
  await ps.cancel({ shootId: 77, uploadId: 9, deviceId: 7 });
  assert.deepEqual(W.callsOf("cancel").map((c) => c[1]), [9], "shoot 77's hand-in cancelled - not the one this page holds");
  assert.equal(held.state, "open", "shoot 31's own hand-in is left as it is");
  await ps.dispose();
});

test("a refusal of begin in words (open_elsewhere with who, where and since; phone_off; not available), nothing sent", async () => {
  const cases = [
    [Object.assign(new Error("x"), { code: "PT409", hint: "open_elsewhere", detail: { by: "Ana", pc: "iPhone", source: "phone", started_at: "2026-11-13T18:05:00Z" } }),
      "Ana is copying into this shoot on Ana's phone (since Fri Nov 13, 10:05 am) - wait until that copy is handed in."],
    [Object.assign(new Error("x"), { code: "PT409", hint: "phone_off" }), WORDS.hint.phone_off],
    [Object.assign(new Error("x"), { code: "42883", notAvailable: true }), WORDS.files.not_available],
  ];
  for (const [e, want] of cases) {
    const W = world();
    W.beginRefuse = e;
    const { ps } = phone(W);
    await ps.start(await ps.plan(SHOOT, [new PickedFile("IMG_0001.JPG", 600, 111)]));
    const v = ps.view();
    assert.equal(v.phase, "refused");
    assert.equal(v.lines.at(-1).text, want);
    assert.equal(W.callsOf("record").length, 0);
    await ps.dispose();
  }
});

test("hashingTransport: a gap before a chunk is read from the file first (never a byte skipped); an address it does not track passes as it is", async () => {
  const h = spyHasher();
  const file = new PickedFile("x.mov", 30, 121);
  const st = { key: "h1", hashed: 0, size: 30, pre: null };
  st.gap = async (upto) => { const b = await file.slice(st.hashed, upto).arrayBuffer(); h.update(st.key, b); st.hashed = upto; };
  const sent = [];
  const inner = async (req) => { sent.push(req); return { status: 202, header: () => null, text: () => "{}" }; };
  const t = P.hashingTransport(inner, { stateOf: (u) => (u === "https://up.example/s1" ? st : null), hasher: h });
  await t({ method: "PUT", url: "https://up.example/s1", headers: { "Content-Range": "bytes 10-19/30" }, body: file.slice(10, 20) });
  await t({ method: "PUT", url: "https://up.example/s1", headers: { "Content-Range": "bytes 0-19/30" }, body: file.slice(0, 20) });
  await t({ method: "PUT", url: "https://up.example/s1", headers: { "Content-Range": "bytes 20-29/30" }, body: file.slice(20, 30) });
  assert.equal(h.fed.get("h1"), 30);
  assert.equal(await h.digest("h1"), qx(file));
  assert.ok(sent.every((r) => r.body instanceof ArrayBuffer));
  const blob = file.slice(0, 5);
  await t({ method: "PUT", url: "https://elsewhere.example/x", headers: { "Content-Range": "bytes 0-4/30" }, body: blob });
  assert.equal(sent.at(-1).body, blob, "untracked: untouched");
});

test("createHasher: a worker that fails is let go - the file is hashed here instead, the same hash", async () => {
  class BadWorker { postMessage() { setTimeout(() => this.onerror && this.onerror(new Error("boom")), 0); } }
  const W = world();
  const { ps } = phone(W, { hasher: P.createHasher({ worker: () => new BadWorker() }) });
  const f = new PickedFile("IMG_0001.JPG", 2 * U + 2, 131);
  await ps.start(await ps.plan(SHOOT, [f]));
  await until(() => ps.view().phase === "sealed");
  assert.equal(W.callsOf("done")[0][1][0].md5, qx(f));
  await ps.dispose();
});

test("repo rows: photo_shoot_files_page read whole, 500 at a time, by name and in order (RPC_ARGS); no table read", async () => {
  const asked = [];
  const pages = [
    { files: [{ id: 1, path: "Phone/A.JPG", size: "10", md5: null, state: "waiting", counted: false, kind: "photo" }, { id: 2, path: "B.JPG", size: 20, md5: "FAKEqxa00000000000000000000=", state: "confirmed", counted: true }], next: 2 },
    { files: [{ id: 3, path: "C.JPG", size: 30, md5: "", state: "removed", counted: true }], next: null },
  ];
  useClient({
    from: (t) => { asked.push("table:" + t); throw new Error("no table"); },
    rpc: async (name, args) => { asked.push([name, Object.keys(args), args.p_after, args.p_limit]); return { data: pages.shift(), error: null }; },
  });
  try {
    const rows = await R.rows(SHOOT);
    assert.deepEqual(rows, [
      { id: 1, path: "Phone/A.JPG", size: 10, md5: null, state: "waiting", counted: false },
      { id: 2, path: "B.JPG", size: 20, md5: "FAKEqxa00000000000000000000=", state: "confirmed", counted: true },
      { id: 3, path: "C.JPG", size: 30, md5: null, state: "removed", counted: true }]);
    assert.deepEqual(asked, [["photo_shoot_files_page", R.RPC_ARGS.photo_shoot_files_page, null, 500], ["photo_shoot_files_page", R.RPC_ARGS.photo_shoot_files_page, 2, 500]]);
  } finally { useClient(null); }
});

test("the module: no OneDrive host or Microsoft address of its own, the address checked by the repo (uploadUrlOk) before it reaches the page", () => {
  assert.ok(!/sharepoint|graph\.microsoft|login\.microsoftonline/i.test(SRC));
  assert.ok(/uploadUrlOk/.test(readFileSync(new URL("../site/js/repo/photo-files.js", import.meta.url), "utf8")));
  assert.ok(/createUploader as realCreateUploader, xhrTransport \} from "\.\/onedrive-upload\.js"/.test(SRC), "the uploader as it is");
});

/* ── the OneDrive review's round 1 (DCR Desktop 2 docs/PHOTO-FILES-ONEDRIVE.md §19) ── */

/** A world whose photo_upload_files judges a file recorded WITH its hash as the migration does (OD §3.5, §5.5): the same
    bytes as a row still waiting to be sent whose last hand-in is a SEALED PHONE hand-in -> recopied (send: true, the row
    under this hand-in); the same bytes as any other row -> same (send: false); no hash at a taken path -> name_taken. */
function resendWorld() {
  const W = world({ firstRow: 300 });
  const plain = W.repo.record;
  W.repo.record = async (uploadId, files) => {
    const sames = [];
    const rest = [];
    files.forEach((f, i) => {
      const row = W.rows.find((x) => keyOf(x.path) === keyOf(f.path));
      if (row && f.md5 && row.md5 === f.md5 && row.size === f.size && row.state !== "removed") sames.push({ i, f, row });
      else rest.push({ i, f });
    });
    if (!sames.length) return plain(uploadId, files);
    W.calls.push(["record", files.map((f) => f.path)]);
    W.recorded.push(...files);
    const a = rest.length ? await plain(uploadId, rest.map((x) => x.f)) : { refused: [], files: [], byIndex: {} };
    const byIndex = {};
    rest.forEach((x, k) => { if (a.byIndex[k]) byIndex[x.i] = a.byIndex[k]; });
    const refused = (a.refused || []).map((r) => Object.assign({}, r, { i: rest[r.i].i }));
    for (const { i, f, row } of sames) {
      const last = W.uploads.get(row.upload);
      const recopy = row.state === "waiting" && (row.step === "to_send" || row.step === "session") && row.upload !== uploadId &&
        !!last && last.state === "sealed" && last.source === "phone";
      if (recopy) Object.assign(row, { upload: uploadId, sessionAt: false, step: "to_send", item: null });
      byIndex[i] = { file_id: row.id, path: row.path, verdict: recopy ? "recopied" : "same", send: recopy };
    }
    return { refused, files: Object.values(byIndex), byIndex };
  };
  return W;
}

test("a phone's file a check sent back after its phone's seal (OD §3.3 step 2, §3.5; review round 1): picked again, it is hashed, recorded WITH its hash at its own path - recopied - and sent by this hand-in, never a ' (2)' copy; the same bytes as a row another device still sends are recorded with the hash too and skipped (same, send: false)", async () => {
  const W = resendWorld();
  const a = new PickedFile("IMG_0301.HEIC", 2 * U + 7, 61), b = new PickedFile("IMG_0302.HEIC", U + 9, 62), c = new PickedFile("C0303.MOV", 3 * U + 1, 63);
  // the earlier phone hand-in (sealed): a's row sent back to be sent (OneDrive kept a broken copy), b's confirmed
  W.uploads.set(90, { id: 90, state: "sealed", source: "phone", clientKey: "OLDKEY_00000000090" });
  // a PC's sealed hand-in whose row still waits for its own sender
  W.uploads.set(91, { id: 91, state: "sealed", source: "pc", clientKey: "OLDKEY_00000000091" });
  W.addRow({ id: 201, path: "Phone/IMG_0301.HEIC", size: a.size, md5: qx(a), counted: true, upload: 90, step: "to_send" });
  W.addRow({ id: 202, path: "Phone/IMG_0302.HEIC", size: b.size, md5: qx(b), counted: true, upload: 90, state: "confirmed", step: "done" });
  W.addRow({ id: 203, path: "Phone/C0303.MOV", size: c.size, md5: qx(c), counted: true, upload: 91, step: "to_send" });
  W.nextUpload = 92;
  const { ps } = phone(W);
  const p = await ps.plan(SHOOT, [a, b, c]);
  assert.deepEqual(p.send.map((e) => [e.path, e.withHash === true, e.hash]), [["Phone/IMG_0301.HEIC", true, qx(a)], ["Phone/C0303.MOV", true, qx(c)]],
    "the waiting rows' files recorded at their own paths, with their hashes");
  assert.equal(p.skipped, 1, "the confirmed one skipped at the pick");
  await ps.start(p);
  await until(() => ps.view().phase === "sealed");
  const rec = W.recorded.filter((f) => f.md5);
  assert.deepEqual(rec.map((f) => [f.path, f.md5]), [["Phone/IMG_0301.HEIC", qx(a)], ["Phone/C0303.MOV", qx(c)]], "photo_upload_files got the hashes");
  assert.ok(!W.recorded.some((f) => / \(2\)/.test(f.path)), "never a copy under another name");
  assert.deepEqual(W.callsOf("sessions").map((s) => s[1][0].file_id), [201], "only the phone's file sent back is sent - the PC's is its own sender's");
  assert.equal(W.callsOf("sessions")[0][1][0].md5, qx(a), "its session names the hash it was recorded with");
  assert.equal(W.row(201).state, "confirmed");
  assert.equal(W.row(201).upload, 92, "the row is this hand-in's now");
  assert.equal(W.row(203).upload, 91, "the PC's row is left to the PC");
  assert.deepEqual(W.callsOf("seal")[0].slice(1), [1, a.size]);
  assert.equal(a.reads, 2 * a.size, "one read to hash it at the pick, one to send it - never hashed a second time");
  assert.ok(texts(ps.view()).includes(WORDS.copy.skipped_same.replace("{n}", "2")), texts(ps.view()).join(" | "));
  await ps.dispose();
});

test("the seal's last line (review round 1): a hand-in with a file OneDrive has differently (not_intact) never says \"All N files are in OneDrive ✓\" - its problem line instead; checking only when the rest are OneDrive still hashing; ✓ only when every counted file is confirmed", async () => {
  const run = async (judge) => {
    const W = world();
    const plain = W.repo.done;
    W.repo.done = async (uploadId, key, items) => {
      const a = await plain(uploadId, key, items);
      return { items: a.items.map((x) => { const j = judge(W.row(x.file_id)); return j ? Object.assign({ file_id: x.file_id }, j) : x; }), folder: a.folder };
    };
    const { ps } = phone(W);
    const fs = [new PickedFile("IMG_0401.JPG", U + 1, 71), new PickedFile("IMG_0402.JPG", U + 2, 72), new PickedFile("IMG_0403.JPG", U + 3, 73)];
    await ps.start(await ps.plan(SHOOT, fs));
    await until(() => ps.view().phase === "sealed");
    const v = ps.view();
    await ps.dispose();
    return { W, v, last: v.lines[v.lines.length - 1] };
  };
  const intact = (r) => (r.path === "Phone/IMG_0402.JPG" ? { state: "mismatch", code: "not_intact" } : null);
  let { W, v, last } = await run(intact);
  assert.deepEqual(W.callsOf("seal")[0].slice(1, 2), [3], "sealed: the different file has a hash and counts");
  assert.ok(!texts(v).some((t) => /are in OneDrive ✓/.test(t)), "no false ✓: " + texts(v).join(" | "));
  assert.ok(texts(v).includes(WORDS.copy.not_intact.replace("{name}", "IMG_0402.JPG")), "the file's own line");
  assert.deepEqual([last.code, last.text, last.tone], ["problem_mismatch", WORDS.files.problem_mismatch_one, "problem"]);
  ({ v, last } = await run((r) => (r.path === "Phone/IMG_0403.JPG" ? { state: "checking" } : null)));
  assert.deepEqual([last.code, last.text], ["checking", WORDS.files.checking_one], "the rest confirmed, one still hashed by OneDrive");
  ({ v, last } = await run(() => null));
  assert.equal(last.code, "confirmed");
  assert.match(last.text, /^All 3 files are in OneDrive ✓ \(checked /);
});

test("a second pick on the same shoot after this page sealed (or cancelled) its hand-in begins a NEW one - never photo_upload_files on the closed one (upload_closed)", async () => {
  const W = world();
  const { ps } = phone(W);
  await ps.start(await ps.plan(SHOOT, [new PickedFile("IMG_0701.JPG", U + 1, 101)]));
  await until(() => ps.view().phase === "sealed");
  await ps.start(await ps.plan(SHOOT, [new PickedFile("IMG_0702.JPG", U + 2, 102)]));
  await until(() => ps.view().phase === "sealed" && W.callsOf("seal").length === 2);
  assert.equal(W.callsOf("begin").length, 2, "a new hand-in");
  assert.notEqual(W.callsOf("begin")[0][2].clientKey, W.callsOf("begin")[1][2].clientKey, "with a new client key");
  assert.deepEqual([...W.uploads.values()].map((u) => u.state), ["sealed", "sealed"]);
  assert.ok(!texts(ps.view()).includes(WORDS.hint.upload_closed), texts(ps.view()).join(" | "));
  // cancelled: the next pick begins a new one too
  W.hook = (req) => (req.method === "PUT" ? "drop" : undefined);
  await ps.start(await ps.plan(SHOOT, [new PickedFile("IMG_0703.JPG", 3 * U, 103)]));
  await until(() => ps.view().phase === "sending");
  await ps.cancel();
  assert.equal(ps.view().phase, "cancelled");
  W.hook = null;
  await ps.start(await ps.plan(SHOOT, [new PickedFile("IMG_0704.JPG", U + 4, 104)]));
  await until(() => ps.view().phase === "sealed" && W.callsOf("seal").length === 3);
  assert.equal(W.callsOf("begin").length, 4);
  assert.deepEqual([...W.uploads.values()].map((u) => u.state), ["sealed", "sealed", "cancelled", "sealed"]);
  await ps.dispose();
});

test("a phone's file sent back and picked again whose Replace OneDrive refuses (sessions: replace_unavailable, OD §3.5): its own line, and the seal's last line is the problem - never \"All 1 file is in OneDrive ✓\" over the row it counts", async () => {
  const W = resendWorld();
  const a = new PickedFile("IMG_0801.HEIC", U + 21, 111);
  W.uploads.set(90, { id: 90, state: "sealed", source: "phone", clientKey: "OLDKEY_00000000090" });
  W.addRow({ id: 211, path: "Phone/IMG_0801.HEIC", size: a.size, md5: qx(a), counted: true, upload: 90, step: "to_send" });
  W.nextUpload = 92;
  // (the migration: a pending Replace of the row's item OneDrive refuses - the row a mismatch, its hash kept)
  W.perFile = (row) => (row.id === 211 ? (Object.assign(row, { state: "mismatch" }), { code: "replace_unavailable" }) : null);
  W.repo.seal = async (uploadId, n, bytes) => {
    // the database counts every row of the hand-in with a hash - the mismatch too
    const mine = W.rows.filter((r) => r.upload === uploadId && r.md5);
    if (n !== mine.length) throw refuse("count_mismatch", { files: mine.length, bytes: mine.reduce((x, r) => x + r.size, 0) });
    W.calls.push(["seal", n, bytes]);
    W.uploads.get(uploadId).state = "sealed";
    return { ok: true, again: false, upload: { id: uploadId, state: "sealed", files: n, bytes } };
  };
  const { ps } = phone(W);
  await ps.start(await ps.plan(SHOOT, [a]));
  await until(() => ps.view().phase === "sealed");
  const v = ps.view();
  assert.ok(texts(v).includes(WORDS.copy.replace_unavailable.replace("{name}", "IMG_0801.HEIC")), texts(v).join(" | "));
  assert.ok(!texts(v).some((t) => /are in OneDrive ✓|is in OneDrive ✓/.test(t)), "no false ✓: " + texts(v).join(" | "));
  assert.equal(v.lines[v.lines.length - 1].code, "problem_mismatch");
  await ps.dispose();
});

/* ── the OneDrive review's round 2 (DCR Desktop 2 docs/PHOTO-FILES-ONEDRIVE.md §20) ── */

/** A world with this shoot's earlier hand-ins: a phone's sealed one whose video's OneDrive hash is late (its row
    waiting at committed: "checking the last one…") and a PC's sealed one whose photo its sender still sends. */
function waitingWorld() {
  const W = resendWorld();
  const vid = new PickedFile("C0001.MOV", 3 * U + 11, 121), pcs = new PickedFile("IMG_0001.JPG", U + 31, 122);
  W.uploads.set(90, { id: 90, state: "sealed", source: "phone", clientKey: "OLDKEY_00000000090" });
  W.uploads.set(91, { id: 91, state: "sealed", source: "pc", clientKey: "OLDKEY_00000000091" });
  W.addRow({ id: 221, path: "Phone/C0001.MOV", size: vid.size, md5: qx(vid), counted: true, upload: 90, step: "committed", item: "01FAKE0000000221" });
  W.addRow({ id: 222, path: "DCIM/IMG_0001.JPG", size: pcs.size, md5: qx(pcs), counted: true, upload: 91, step: "to_send" });
  W.nextUpload = 92;
  return { W, vid, pcs };
}

test("a pick that begins the hand-in and records nothing of its own (OD §3.3 step 2; review round 2): the phone's video still checking in OneDrive, or a photo a PC still sends, picked again - each answered same, send: false - cancels that hand-in again at once, its stored key dropped; only the pick's own line is left, nothing to hand in or cancel, nothing sent", async () => {
  for (const pick of [["vid"], ["pcs"], ["vid", "pcs"]]) {
    const { W, vid, pcs } = waitingWorld();
    const files = pick.map((k) => ({ vid, pcs })[k]);
    const { ps, storage } = phone(W);
    const p = await ps.plan(SHOOT, files);
    assert.deepEqual(p.send.map((e) => e.withHash === true), files.map(() => true), pick.join("+") + ": recorded with its hash (round 1's pick)");
    const v = await ps.start(p);
    assert.equal(v.phase, "cancelled", pick.join("+"));
    assert.deepEqual(W.callsOf("begin").length, 1, "the pick began one hand-in");
    assert.deepEqual(W.callsOf("cancel"), [["cancel", 92]], pick.join("+") + ": and cancelled it again");
    assert.equal(W.uploads.get(92).state, "cancelled");
    assert.deepEqual([...W.uploads.values()].filter((u) => u.state === "open"), [], "no empty hand-in left open to hold the shoot's Ready");
    assert.deepEqual(JSON.parse(storage.m.get(P.STORE_KEY)).hand_ins, {}, "its stored key dropped");
    assert.deepEqual(W.callsOf("sessions"), [], "nothing sent");
    assert.deepEqual(W.callsOf("seal"), [], "never a seal of 0 (refused empty)");
    assert.deepEqual(v.lines.map((l) => [l.group, l.code]), [["copy", "skipped_same"]], texts(v).join(" | "));
    assert.equal(v.lines[0].text, files.length === 1 ? WORDS.copy.skipped_same_one : WORDS.copy.skipped_same.replace("{n}", String(files.length)));
    assert.deepEqual(v.buttons, [], "no Pick the rest again, Hand in what's there or Cancel it");
    assert.equal(ps.sending(), null);
    assert.equal(ps.active(), false);
    assert.equal(W.row(221).upload, 90, "the video's row stays its phone's");
    assert.equal(W.row(222).upload, 91, "the PC's row stays the PC's");
    // the next pick begins a new hand-in (never photo_upload_files on the cancelled one)
    const n = new PickedFile("IMG_0009.JPG", U + 9, 129);
    await ps.start(await ps.plan(SHOOT, [n]));
    await until(() => ps.view().phase === "sealed");
    assert.equal(W.callsOf("begin").length, 2);
    assert.deepEqual(W.callsOf("seal")[0].slice(1), [1, n.size]);
    await ps.dispose();
  }
});

test("a pick that records something of its own keeps its hand-in (review round 2): the checking video beside a new photo - the photo sent and handed in, never cancelled; Pick the rest again of this phone's stopped hand-in, though it records nothing, never cancels a hand-in it did not begin", async () => {
  const { W, vid } = waitingWorld();
  const { ps } = phone(W);
  const n = new PickedFile("IMG_0010.JPG", U + 10, 130);
  await ps.start(await ps.plan(SHOOT, [vid, n]));
  await until(() => ps.view().phase === "sealed");
  assert.deepEqual(W.callsOf("cancel"), []);
  assert.deepEqual(W.callsOf("seal")[0].slice(1), [1, n.size], "the new photo handed in");
  assert.ok(texts(ps.view()).includes(WORDS.copy.skipped_same_one), "the video skipped: " + texts(ps.view()).join(" | "));
  await ps.dispose();
  // this phone's own stopped hand-in (its keys stored), nothing recorded in it yet: Pick the rest again of only a photo a PC
  // still sends records nothing of its own either - but that pick did not begin the hand-in, so it is never cancelled by
  // it (its starter's choices stay: Hand in what's there, Cancel it)
  const W2 = resendWorld();
  const a = new PickedFile("IMG_0011.JPG", U + 11, 131);
  W2.uploads.set(1, { id: 1, state: "open", source: "phone", clientKey: CLIENT });
  W2.uploads.set(91, { id: 91, state: "sealed", source: "pc", clientKey: "OLDKEY_00000000091" });
  W2.nextUpload = 2;
  W2.addRow({ id: 150, path: "DCIM/IMG_0011.JPG", size: a.size, md5: qx(a), counted: true, upload: 91, step: "to_send" });
  const { ps: ps2 } = phone(W2, { seed: seed() });
  const p2 = await ps2.plan(SHOOT, [a], { rest: true });
  assert.deepEqual(p2.send.map((e) => e.withHash === true), [true]);
  await ps2.start(p2);
  await until(() => ps2.view().phase === "stopped");
  assert.deepEqual(W2.callsOf("cancel"), [], "a hand-in the pick did not begin is never cancelled by it");
  assert.equal(W2.uploads.get(1).state, "open");
  assert.ok(ps2.view().buttons.includes("cancel_copy"), ps2.view().buttons.join(", "));
  await ps2.dispose();
});

test("the cancel of a pick's empty hand-in refused (review round 2): it stays as the database has it - stopped, the refusal's line, Cancel it offered (never a silent open hand-in)", async () => {
  const { W, vid } = waitingWorld();
  W.repo.cancel = async (uploadId) => { W.calls.push(["cancel", uploadId]); throw refuse("not_yours"); };
  const { ps } = phone(W);
  const v = await ps.start(await ps.plan(SHOOT, [vid]));
  assert.equal(v.phase, "stopped");
  assert.deepEqual(W.callsOf("cancel"), [["cancel", 92]]);
  assert.ok(v.buttons.includes("cancel_copy"), v.buttons.join(", "));
  assert.equal(v.lines.at(-1).code, "not_yours", texts(v).join(" | "));
  await ps.dispose();
});

/* ── review round 3 (OD §3.3 steps 8 and 9, §21) ─────────────────────── */

test("Hand in what's there only once a file of the hand-in is in OneDrive (OD §3.3 step 8; review round 3): never while nothing is - it asked \"Hand in the 0 files…\" and the empty seal cancelled the hand-in; Cancel it always", async () => {
  const W = world();
  const { ps } = phone(W);
  const a = new PickedFile("IMG_0301.JPG", U + 1, 301), b = new PickedFile("IMG_0302.JPG", 2 * U + 1, 302);
  // the first chunk of the second file waits until the test lets it go: the first file is in, the second in flight
  let gate = null;
  let seenFirst = false;
  const firstIn = [];
  W.repo.sessions = ((orig) => async (...x) => {
    if (W.callsOf("sessions").length === 0) {
      // before anything is in OneDrive: sending, Cancel it alone
      seenFirst = true;
      firstIn.push(ps.view().buttons.slice());
    }
    if (W.callsOf("sessions").length === 1) await new Promise((r) => { gate = r; });
    return orig(...x);
  })(W.repo.sessions);
  try {
    await ps.start(await ps.plan(SHOOT, [a, b]));
    await until(() => gate !== null);
    assert.ok(seenFirst);
    assert.deepEqual(firstIn[0], ["cancel_copy"], "sending, nothing in OneDrive yet");
    const v = ps.view();
    assert.equal(v.phase, "sending");
    assert.deepEqual(ps.sending(), { sent: 1, total: 2 });
    assert.deepEqual(v.buttons, ["hand_in_there", "cancel_copy"], "one file in: Hand in what's there");
    gate();
    await until(() => ps.view().phase === "sealed");
  } finally {
    if (gate) gate();
    await ps.dispose();
  }
  // stopped with nothing in OneDrive (its one file held): Pick the rest again and Cancel it - never Hand in what's there
  const W2 = world();
  W2.perFile = () => ({ code: "too_many_tries" });
  const two = phone(W2);
  try {
    await two.ps.start(await two.ps.plan(SHOOT, [new PickedFile("IMG_0303.JPG", U + 3, 303)]));
    await until(() => two.ps.view().phase === "stopped");
    assert.deepEqual(two.ps.view().buttons, ["pick_rest", "cancel_copy"], "stopped at 0: no Hand in what's there");
  } finally { await two.ps.dispose(); }
});

test("a file held one by one on this page is queued again when it is picked again (OD §3.3 step 9; review round 3): too_many_tries reads \"pick it again tomorrow\" (never the PC's \"DCR tries again tomorrow by itself\"); Pick the rest again - or a new pick into the same hand-in - sends it, its tries from 0", async () => {
  for (const how of ["rest", "pick"]) {
    const W = world();
    const a = new PickedFile("IMG_0311.JPG", U + 1, 311), b = new PickedFile("IMG_0312.HEIC", U + 2, 312);
    let refuse = true;
    W.perFile = (row) => (refuse && row.path === "Phone/IMG_0312.HEIC" ? { code: "too_many_tries" } : null);
    const { ps } = phone(W);
    await ps.start(await ps.plan(SHOOT, [a, b]));
    await until(() => ps.view().phase === "stopped");
    let v = ps.view();
    assert.ok(texts(v).includes("IMG_0312.HEIC won't start sending - pick it again tomorrow."), JSON.stringify(texts(v)));
    assert.ok(!texts(v).includes(WORDS.files.too_many_tries.replace("{name}", "IMG_0312.HEIC")), "never the PC's words: nothing on a phone tries by itself");
    assert.deepEqual(v.buttons, ["pick_rest", "hand_in_there", "cancel_copy"], "one file in OneDrive: Hand in what's there too");
    assert.equal(W.callsOf("seal").length, 0);
    // the next day: picked again - THAT entry back in the queue (never a second one), sent, the hand-in sealed whole
    refuse = false;
    const before = W.callsOf("sessions").length;
    const p = await ps.plan(SHOOT, [b], how === "rest" ? { rest: true } : undefined);
    assert.deepEqual(p.resume.map((r) => r.path), ["Phone/IMG_0312.HEIC"], how + ": the held file stays in the plan");
    assert.deepEqual(p.send, [], "never recorded again");
    await ps.start(p);
    await until(() => ps.view().phase === "sealed");
    v = ps.view();
    assert.equal(W.callsOf("sessions").length, before + 1, how + ": sent again");
    assert.deepEqual(W.callsOf("record").length, 1, "one record: the same row");
    assert.deepEqual(W.callsOf("seal")[0].slice(1), [2, a.size + b.size], how + ": both handed in");
    assert.ok(!texts(v).some((t) => /won't start sending/.test(t)), "the held line gone");
    await ps.dispose();
  }
});

test("a file held one by one is a warn line whatever held it - too_many_tries in the phone's own words too, as the PC's twin and too_large, path_too_long and OneDrive failed 3 times (the final screenshots: its line drew untoned)", async () => {
  const holds = [["too_many_tries", "too_many_tries_phone"], ["too_large", "too_large"], ["path_too_long", "path_too_long"], ["something_else", "onedrive_failed"]];
  for (const [answer, code] of holds) {
    const W = world();
    const a = new PickedFile("IMG_0341.JPG", U + 1, 341), b = new PickedFile("IMG_0342.HEIC", U + 2, 342);
    W.perFile = (row) => (row.path === "Phone/IMG_0342.HEIC" ? { code: answer, max_bytes: 268435456000 } : null);
    const { ps } = phone(W);
    try {
      await ps.start(await ps.plan(SHOOT, [a, b]));
      await until(() => ps.view().phase === "stopped");
      const held = ps.view().lines.filter((l) => l.code === code);
      assert.equal(held.length, 1, answer + ": " + JSON.stringify(ps.view().lines));
      assert.equal(held[0].tone, "warn", answer + ": " + JSON.stringify(held[0]));
    } finally { await ps.dispose(); }
  }
});

test("a file OneDrive failed 3 times on, picked again, goes again with its tries from 0 (review round 3): two more failures then sent - never held again at the first", async () => {
  const W = world();
  const f = new PickedFile("C0321.MOV", 2 * U + 5, 321);
  let fails = 3;
  W.perFile = () => (fails-- > 0 ? { code: "something_else" } : null);
  const { ps } = phone(W);
  await ps.start(await ps.plan(SHOOT, [f]));
  await until(() => ps.view().phase === "stopped");
  assert.ok(texts(ps.view()).includes(WORDS.hint.onedrive_failed), JSON.stringify(texts(ps.view())));
  assert.equal(W.callsOf("sessions").length, 3, "tried 3 times");
  fails = 2;
  await ps.start(await ps.plan(SHOOT, [f], { rest: true }));
  await until(() => ps.view().phase === "sealed");
  assert.equal(W.callsOf("sessions").length, 6, "2 failures and the send: its tries counted from 0 again");
  assert.deepEqual(W.callsOf("seal")[0].slice(1), [1, f.size]);
  await ps.dispose();
});

test("a file held for what a new try cannot change (too_large, path_too_long, not_same_file, not_this_device) stays held when picked again (review round 3)", async () => {
  for (const code of ["too_large", "path_too_long", "not_same_file", "not_this_device"]) {
    const W = world();
    const a = new PickedFile("IMG_0331.JPG", U + 1, 331), b = new PickedFile("IMG_0332.JPG", U + 2, 332);
    W.perFile = (row) => (row.path === "Phone/IMG_0332.JPG" ? { code, max_bytes: 268435456000 } : null);
    const { ps } = phone(W);
    await ps.start(await ps.plan(SHOOT, [a, b]));
    await until(() => ps.view().phase === "stopped");
    const n = W.callsOf("sessions").length;
    const p = await ps.plan(SHOOT, [b], { rest: true });
    assert.deepEqual(p.resume, [], code + ": the page's own entry, never a second one");
    await ps.start(p);
    await until(() => ps.view().phase === "stopped");
    assert.equal(W.callsOf("sessions").length, n, code + ": not sent again");
    assert.equal(W.callsOf("seal").length, 0, code);
    await ps.dispose();
  }
});
