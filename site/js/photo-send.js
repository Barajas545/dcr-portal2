/* The phone's hand-in (the photographer screen program, P5, the OneDrive edition - DCR Desktop 2
   docs/PHOTO-FILES-ONEDRIVE.md §3.3, §3.5, §3.6, §4.5, cited OD; the build plan's P4).

   A photographer (or an admin) on a phone picks photos and videos on the shoot sheet; this module plans them, opens the
   hand-in, records them, sends them one at a time STRAIGHT to the Office OneDrive and seals the hand-in:

   1. plan(shootId, files, {rest})   the pick (OD §3.3 step 2): only the media kinds (cases kinds; others are counted
      and left out: copy.not_media), at most PICK_MAX a pick (copy.pick_limit), paths Phone/<name>, a taken name
      " (2)" (cases free_name: every row's path is taken, a left-out or cancelled row's too unless its size and hash
      are the file's). A picked file whose name and size match a row of the shoot is hashed first (one read of that file
      only) and skipped when it is the same (copy.skipped_same) - unless that row is still waiting and not this
      hand-in's: then it is recorded WITH its hash at the row's path and the answer's send decides (recopied, send: true:
      a phone's file a check sent back after its phone's seal, OD §3.5; same, send: false: nothing sent - review round 1).
      Over BIG_BYTES a file: copy.big_phone first. With
      {rest: true} (Pick the rest again / Pick them again, step 9) the shoot's uncounted live rows are this phone's
      stopped hand-in: a file matching one of them is hashed once and sent on THAT row (sessions answers found for a
      row whose last chunk committed - done with that item and the hash, no bytes -, a session otherwise: from byte 0).
   2. start(plan)   photo_upload_begin(p_source 'phone') with this phone's device key and the hand-in's client key (kept
      in local storage inside try / catch: neither is a secret; storage blocked, they live for the page only), then
      photo_upload_files with every planned file's path, size and time and NO hash (step 4; only a file the pick matched
      to a waiting row of another hand-in goes with its hash, step 2): the answer's files[] gives
      each its file_id (by i), and only `send: true` entries are sent. A hand-in this pick began that records nothing of
      its own (every answer send: false, or refused) is cancelled again at once, the pick's own lines left (step 2;
      review round 2). Then the send loop.
   3. The send loop, one file at a time: photo-files sessions for that one file, just in time; `found` -> done with
      that item; an upload address -> createUploader (js/onedrive-upload.js, UNCHANGED) with the photo broker parts
      below and the HASHING TRANSPORT around xhrTransport(): each PUT's chunk is read into an ArrayBuffer, the bytes
      past that address's hashed offset go to the hash worker (js/photo-hash-worker.js, the live js/quickxor.js), and
      the same buffer is sent. The hash state is per upload address (a new session starts at 0); a re-sent range is
      never hashed twice. The transport sees every answer: a 507 stops the job at once (the uploader's own cancel,
      never its tries) - the file goes back to the queue, the beat says onedrive_full and sessions is asked again every
      AGAIN_MS; a PUT answered 409, or every byte in with no item (the address's GET wants nothing more), is "finished
      but not committed" (OD §3.2.5): find first, else a new session from byte 0.
   4. done (photo-files done) with the hash computed while sending (md5): confirmed / checking end the file; gone,
      not_this_upload and broken_upload send it again in a new session; a mismatch is the file's problem line.
   5. Once every file of the hand-in is confirmed or checking: photo_upload_seal with the counts of the rows that have a
      hash (step 8).

   Failures that are pauses (step 6): a job that ends failed while its session still lives (a lost connection or
   OneDrive busy past the uploader's tries, a phone lock) is shown as paused (copy.keep_screen) and started again by
   itself on the next visibilitychange to visible or online event (or after PAUSE_MS while the page is in front), from
   nextExpectedRanges with that address's hash state. No internet / busy answers wait and ask again. sessions answering
   503 uploads_off / uploads_test stops sending AND beating and asks again every AGAIN_MS; not_authorized, root_lost,
   too_wide, root_changed and not_configured are files.stopped_od, asked again every AGAIN_MS.

   Words (step 6): every text comes from the shared cases (map/photo-words.js), mapped from the job's state and code and
   from the function's codes - never createUploader's own `job.error` texts.

   Keeping the screen on (step 7): a Screen Wake Lock while sending, asked again on every visibilitychange to visible
   (refused -> copy.keep_screen); a beforeunload warning; photo_upload_beat every BEAT_MS (sending, waiting_net, busy,
   onedrive_full or onedrive_stopped, with the bytes OneDrive acknowledged, the files done and the rate of the last 5
   minutes), and one soon after each file is in (at most every SOON_MS), so the status's count is never a file behind
   for long (another device's line; this phone's own stopped line after a reload).

   Stopping on purpose (steps 8, 9): Cancel it always, Hand in what's there once at least one file of the hand-in is in
   OneDrive (never "Hand in the 0 files…" - review round 3); the page asks first (pages/shoots.js phoneAsk:
   copy.cancel_ask_phone, copy.hand_in_ask_phone, Keep it focused - review round 1); then handIn() (Hand in what's there)
   and cancel() (Cancel it) first stop the file in flight. A file the page holds one by one (too_many_tries:
   files.too_many_tries_phone, "pick it again tomorrow"; or OneDrive failed 3 times on it) is queued again, its tries
   from 0, when Pick the rest again or a new pick into the same hand-in picks it again (step 9; review round 3).
   Hand in what's there looks (photo-files find) for every row of the hand-in still without a hash: one whose file IS
   in OneDrive is done with its hash when this page still holds the file, and otherwise asked about
   (files.not_checked_phone with Pick them again / Hand in without them: handInWithout()) - never dropped silently;
   then the seal (the rows never sent are removed by it). Cancel it is PF's cancel (copy.cancelled_sent when files of
   the hand-in it did not put back had reached OneDrive: this page's own count while it holds the files - the file whose
   last chunk was on its way asked with find first, review round 6 -, the cancel's removed_sent for the rows it does not
   hold - OD §5.5, §23, review round 5).

   The upload address (OD §3.6) stays in this page's memory only: never in local storage, IndexedDB or a log, never in
   the view, never posted to the worker (it keys the hash by an opaque "h<n>").

   createPhoneSend(deps) -> {plan, start, handIn, handInWithout, cancel, view, viewer, sending, knows, forget, onChange,
   dispose}. deps (all optional; tests give stubs): repo (repo/photo-files.js: begin, record, sessions, done, find,
   beat, seal, cancel, rows), transport (the inner one: xhrTransport()), hasher (createHasher()), storage
   (localStorage), window, document, navigator, random(n) -> Uint8Array, now, setTimeout, clearTimeout, by (the
   signed-in person's first name: {pc} is "{by}'s phone"), codes() (the status's mode_codes), today, createUploader,
   uploader (createUploader overrides), ms {beat, again, pause, waits}.

   The pure parts are exported for the tests and the pages: kindOf, pathKey, freeName (cases kinds, free_name),
   nameMatches, planPick, deviceLabel, newDeviceKey, newClientKey, hashingTransport, createHasher. */

import { createUploader as realCreateUploader, xhrTransport } from "./onedrive-upload.js";
import { CHUNK_UNIT } from "./map/onedrive.js";
import * as filesRepo from "./repo/photo-files.js";
import { WORDS, word, sizeWords, leftWords, safe, momentText, pcName, hintText } from "./map/photo-files.js";
import "./quickxor.js";

/** At most this many files a pick (OD §3.3 step 2). */
export const PICK_MAX = 200;
/** Over this a file, copy.big_phone first ("Big videos go best from DCR Desktop"). */
export const BIG_BYTES = 1024 * 1024 * 1024;
/** big_phone's "good Wi-Fi" (bytes a second): 6.2 GB in about 20 minutes. */
export const GOOD_WIFI_BPS = 6000000;
/** A phone's chunk when the answer names none: 16 x 320 KiB (OD §4.5). */
export const PHONE_CHUNK = 16 * CHUNK_UNIT;
/** The beat (OD §3.2.8). */
export const BEAT_MS = 30000;
/** A file in: a beat soon, at most this often besides BEAT_MS (photo_upload_beat allows 600 an hour). */
export const SOON_MS = 10000;
/** OneDrive full, the mode, the office's stop: sessions asked again this often (OD §3.2.5, §3.3 step 5). */
export const AGAIN_MS = 15 * 60000;
/** A paused job (its session alive) is started again after this while the page is in front, besides the events. */
export const PAUSE_MS = 60000;
/** The phone's own sub-folder of the shoot folder (question M5). */
export const PHONE_DIR = "Phone";
/** A path's limit in characters (app.photo_free_name). */
export const PATH_MAX = 100;
/** What the file input asks for (HEIC named so an iPhone hands over the original, OD §3.3 step 2). */
export const ACCEPT = "image/*,video/*,image/heic,image/heif";
/** The local storage key: this phone's device key and row, and each open hand-in's client key (never an address). */
export const STORE_KEY = "dcr2.photoPhone";

const WAITS = [2000, 5000, 10000, 20000, 30000, 60000];
const READ_SLICE = 8 * 1024 * 1024;
const RATE_SPAN_MS = 5 * 60000;
const QX = /^[A-Za-z0-9+/]{27}=$/;
const RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/;
const DEVICE_KEY = /^pk_[A-Za-z0-9_-]{22}$/;
const CLIENT_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const MEDIA = {
  photo: ["jpg", "jpeg", "heic", "heif", "png", "tif", "tiff", "webp", "hif", "insp"],
  raw: ["dng", "cr2", "cr3", "nef", "arw", "raf", "orf", "rw2", "srw", "pef", "gpr", "nrw"],
  video: ["mp4", "mov", "m4v", "avi", "mts", "m2ts", "mxf", "insv", "360", "crm", "braw"],
};

/* ── pure parts ───────────────────────────────────────────────────────── */

const fold = (s) => String(s === null || s === undefined ? "" : s).replace(/[A-Z]/g, (c) => c.toLowerCase());
/** app.photo_drive_path_key: NFC, then ASCII A-Z folded to a-z only. */
export function pathKey(p) { return fold(String(p === null || p === undefined ? "" : p).normalize("NFC")); }
const lastSeg = (p) => { const s = String(p || ""); return s.slice(s.lastIndexOf("/") + 1); };

/** app.photo_drive_kind: photo, raw, video or other, from the extension after the last dot (cases kinds). */
export function kindOf(name) {
  const l = lastSeg(name);
  if (l.indexOf(".") === -1 || l.endsWith(".")) return "other";
  const e = fold(l.slice(l.lastIndexOf(".") + 1));
  for (const k of ["photo", "raw", "video"]) if (MEDIA[k].indexOf(e) !== -1) return k;
  return "other";
}

const chars = (s) => Array.from(s).length;
const leftChars = (s, n) => Array.from(s).slice(0, Math.max(0, n)).join("");

/** app.photo_free_name (cases free_name): unchanged when no taken path has its path key, else " (2)", " (3)" ... before
    the last dot of the file name; at the 100-character limit the NAME is cut, never the folder. */
export function freeName(path, taken) {
  const keys = new Set((taken || []).filter((t) => t !== null && t !== undefined).map(pathKey));
  if (path === null || path === undefined || !keys.has(pathKey(path))) return path;
  const p = String(path);
  const slash = p.lastIndexOf("/");
  const prefix = slash >= 0 ? p.slice(0, slash + 1) : "";
  const name = p.slice(prefix.length);
  let stem = name, ext = "";
  if (name.slice(1).indexOf(".") !== -1) { const dot = name.lastIndexOf("."); stem = name.slice(0, dot); ext = name.slice(dot); }
  for (let n = 2; n <= 10000; n++) {
    const tail = " (" + n + ")";
    const over = chars(prefix) + chars(stem) + chars(tail) + chars(ext) - PATH_MAX;
    const cand = prefix + (over > 0 ? leftChars(stem, chars(stem) - over) : stem) + tail + ext;
    if (!keys.has(pathKey(cand))) return cand;
  }
  return null;
}

/** Whether a row's path names this picked file: its last part is the file's name, or that name with " (n)" before the
    extension (the row was saved as … (2)). */
export function nameMatches(rowPath, fileName) {
  const seg = pathKey(lastSeg(rowPath));
  const name = pathKey(fileName);
  if (!name) return false;
  if (seg === name) return true;
  const dot = name.slice(1).indexOf(".") !== -1 ? name.lastIndexOf(".") : name.length;
  const stem = name.slice(0, dot), ext = name.slice(dot);
  if (!seg.startsWith(stem + " (") || !seg.endsWith(")" + ext)) return false;
  return /^[2-9][0-9]{0,4}$|^1[0-9]{1,4}$/.test(seg.slice(stem.length + 2, seg.length - ext.length - 1));
}

/** The files of a pick that must be hashed before it is planned: those whose name and size match a row (one read each). */
export function needsHash(files, rows) {
  const out = [];
  let media = 0;
  (files || []).forEach((f, i) => {
    if (!f || typeof f.name !== "string" || kindOf(f.name) === "other" || ++media > PICK_MAX) return;
    const size = Number(f.size);
    if ((rows || []).some((r) => r && r.path && Number(r.size) === size && nameMatches(r.path, f.name))) out.push(i);
  });
  return out;
}

/** The pick as a plan (OD §3.3 steps 2 and 9), pure. files: the picked File objects (name, size, lastModified); rows:
    the shoot's rows (photo_shoot_files_page: {id, path, size, md5, state, counted}); o: {mine: Set of this hand-in's
    row ids (Pick the rest again), hashes: Map index -> quickXorHash (needsHash's files)}.
    -> {send: [{file, i, path, size, modified, hash?, withHash?}] (to record; withHash: recorded with its hash),
       resume: [{file, i, fileId, path, size, hash}] (rows
       of this hand-in to send again), skipped, renamed, notMedia, limited, big: [{size}]} */
export function planPick(files, rows, o) {
  const opt = o || {};
  const mine = opt.mine instanceof Set ? opt.mine : new Set();
  const hashes = opt.hashes instanceof Map ? opt.hashes : new Map();
  const all = (rows || []).filter((r) => r && typeof r.path === "string");
  const out = { send: [], resume: [], skipped: 0, renamed: 0, notMedia: 0, limited: false, big: [] };
  const media = [];
  (files || []).forEach((f, i) => {
    if (!f || typeof f.name !== "string") return;
    if (kindOf(f.name) === "other") { out.notMedia++; return; }
    media.push({ f, i });
  });
  if (media.length > PICK_MAX) { out.limited = true; media.length = PICK_MAX; }
  // every row's path is taken (a left-out or cancelled row's too: its old file may still be in OneDrive), and each path
  // this pick gives
  const taken = all.map((r) => r.path);
  const resumed = new Set();
  for (const { f, i } of media) {
    const size = Number(f.size) || 0;
    const modified = f.lastModified ? new Date(f.lastModified).toISOString() : null;
    const cands = all.filter((r) => Number(r.size) === size && nameMatches(r.path, f.name));
    const h = hashes.get(i) || null;
    if (cands.length && h) {
      const same = cands.find((r) => r.md5 && r.md5 === h);
      if (same && mine.has(same.id) && same.state !== "removed") {
        // this hand-in's row with this hash: confirmed -> nothing to do; else sessions decides (found -> done, no bytes)
        if (same.state === "confirmed" || resumed.has(same.id)) { out.skipped++; continue; }
        resumed.add(same.id);
        out.resume.push({ file: f, i, fileId: Number(same.id), path: same.path, size, hash: h });
        continue;
      }
      if (same && same.state === "removed") {
        // a left-out or cancelled row of these very bytes: its path is the file's own (recorded again: restored)
        out.send.push({ file: f, i, path: same.path, size, modified, hash: h });
        taken.push(same.path);
        continue;
      }
      if (same && same.state === "waiting" && !mine.has(same.id)) {
        // a row of these very bytes still waiting that is not this hand-in's (OD §3.3 step 2, §3.5; review round 1):
        // recorded WITH its hash at its own path, and the answer's send decides - recopied (a phone's file a check sent
        // back after its phone's seal: nothing else sends it) or same (its own device sends it: nothing sent here)
        out.send.push({ file: f, i, path: same.path, size, modified, hash: h, withHash: true });
        taken.push(same.path);
        continue;
      }
      if (same) { out.skipped++; continue; }
      // this hand-in's row of that name and size without a hash yet: its last chunk may have committed (found) or not
      const bare = cands.find((r) => !r.md5 && mine.has(r.id) && r.state === "waiting" && !resumed.has(r.id));
      if (bare) {
        resumed.add(bare.id);
        out.resume.push({ file: f, i, fileId: Number(bare.id), path: bare.path, size, hash: h });
        continue;
      }
      // a different file of that name: a new row
    }
    const want = PHONE_DIR + "/" + f.name;
    const path = freeName(want, taken);
    if (path !== want) out.renamed++;
    taken.push(path);
    const e = { file: f, i, path, size, modified };
    if (h) e.hash = h;
    out.send.push(e);
  }
  for (const e of out.send.concat(out.resume)) if (e.size > BIG_BYTES) out.big.push({ size: e.size });
  return out;
}

/** A phone's device label (OD §3.3 step 3): never a person's name. */
export function deviceLabel(ua) {
  const s = String(ua || "");
  if (/iPhone/.test(s)) return "iPhone";
  if (/Android/.test(s)) return "Android phone";
  return "phone";
}

const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function b64u(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    s += B64U[a >>> 2] + B64U[((a & 3) << 4) | (b >>> 4)];
    if (i + 1 < bytes.length) s += B64U[((b & 15) << 2) | (c >>> 6)];
    if (i + 2 < bytes.length) s += B64U[c & 63];
  }
  return s;
}
const defaultRandom = (n) => { const a = new Uint8Array(n); globalThis.crypto.getRandomValues(a); return a; };
/** A device key of photo_upload_begin: pk_ and 22 base64url characters (128 random bits). */
export function newDeviceKey(random) { return "pk_" + b64u((random || defaultRandom)(16)).slice(0, 22); }
/** A hand-in's client key: 22 base64url characters. */
export function newClientKey(random) { return b64u((random || defaultRandom)(16)).slice(0, 22); }

/* ── the hash ─────────────────────────────────────────────────────────── */

/** The quickXorHash states, one per key (OD §3.3 step 5): update(key, ArrayBuffer) in order, digest(key) ->
    Promise<base64 | null>, drop(key). In a worker (js/photo-hash-worker.js) when o.worker gives one (default: the
    browser's Worker), else here with js/quickxor.js - the same result. null: the hash could not be made (the caller
    hashes the file again itself). o: {worker: () => Worker-like | null}. */
export function createHasher(o) {
  const opt = o || {};
  const make = typeof opt.worker === "function" ? opt.worker : opt.worker === null ? null : defaultWorker;
  const local = new Map();
  const lost = new Set();
  const waits = new Map();
  let w = null, broken = !make, seq = 0;
  function failAll() {
    broken = true;
    for (const [, res] of waits) res(null);
    waits.clear();
  }
  function worker() {
    if (broken) return null;
    if (w) return w;
    try { w = make(); } catch (e) { w = null; }
    if (!w) { broken = true; return null; }
    w.onmessage = (ev) => {
      const m = (ev && ev.data) || {};
      const res = waits.get(m.id);
      if (!res) return;
      waits.delete(m.id);
      res(m.type === "digest" && QX.test(String(m.hash || "")) ? String(m.hash) : null);
    };
    w.onerror = () => { for (const k of inWorker) lost.add(k); failAll(); };
    return w;
  }
  const inWorker = new Set();
  const Q = () => globalThis.DCR2QuickXor;
  return {
    update(key, buf) {
      if (lost.has(key)) return;
      const x = worker();
      if (x) {
        inWorker.add(key);
        try { x.postMessage({ op: "update", key, bytes: buf }, [buf]); } catch (e) { lost.add(key); }
        return;
      }
      if (inWorker.has(key)) { lost.add(key); return; }
      if (!Q()) { lost.add(key); return; }
      let h = local.get(key);
      if (!h) { h = new (Q().QuickXorHash)(); local.set(key, h); }
      h.update(new Uint8Array(buf));
    },
    digest(key) {
      if (lost.has(key)) return Promise.resolve(null);
      if (inWorker.has(key)) {
        const x = worker();
        if (!x) return Promise.resolve(null);
        const id = ++seq;
        return new Promise((res) => {
          waits.set(id, res);
          try { x.postMessage({ op: "digest", key, id }); } catch (e) { waits.delete(id); res(null); }
        });
      }
      if (!Q()) return Promise.resolve(null);
      return Promise.resolve((local.get(key) || new (Q().QuickXorHash)()).base64());
    },
    drop(key) {
      local.delete(key);
      lost.delete(key);
      if (inWorker.has(key)) {
        inWorker.delete(key);
        if (w && !broken) { try { w.postMessage({ op: "drop", key }); } catch (e) { /* the worker is gone */ } }
      }
    },
  };
}

function defaultWorker() {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./photo-hash-worker.js", import.meta.url));
}

/** The hashing transport (OD §3.3 step 5) around `inner` (xhrTransport()). o: {stateOf(url) -> {key, hashed, size, gap}
    | null (an address this page did not open: passed on as it is), hasher, seen(req, res, state), failed(req, err,
    state), last(state)}. A PUT to a known address reads its chunk into an ArrayBuffer, feeds the bytes past the state's
    `hashed` offset to the hasher (a gap before the chunk is read from the file first: never a byte skipped), and sends
    that same buffer; a PUT of the file's final range goes to last() first (OneDrive commits the item at it, whether or
    not its answer comes back); every answer goes to seen() before the uploader reads it. */
export function hashingTransport(inner, o) {
  const opt = o || {};
  return async function send(req) {
    const st = req && opt.stateOf ? opt.stateOf(req.url) : null;
    let out = req;
    if (st && req.method === "PUT" && req.body && typeof req.body.arrayBuffer === "function") {
      const m = RANGE.exec(String((req.headers || {})["Content-Range"] || ""));
      const buf = await req.body.arrayBuffer();
      if (m && !st.pre) {
        const a = Number(m[1]);
        if (a > st.hashed && typeof st.gap === "function") await st.gap(a);
        if (a <= st.hashed) {
          const from = st.hashed - a;
          if (from < buf.byteLength) {
            st.hashed = a + buf.byteLength;
            opt.hasher.update(st.key, buf.slice(from));
          }
        }
      }
      if (m && opt.last && Number(m[2]) + 1 === Number(m[3])) { try { opt.last(st); } catch (e) { /* never fails the request */ } }
      out = Object.assign({}, req, { body: buf });
    }
    let res;
    try {
      res = await inner(out);
    } catch (err) {
      // no answer (no connection, timed out): the page's words say so while the uploader waits to try again
      if (opt.failed) { try { opt.failed(req, err, st); } catch (e) { /* */ } }
      throw err;
    }
    if (opt.seen) { try { opt.seen(req, res, st); } catch (e) { /* the transport never fails a request over its own look */ } }
    return res;
  };
}

/* ── words ────────────────────────────────────────────────────────────── */

const TONE = {
  waiting_net: "wait", throttled: "wait", full: "warn", stopped_od: "problem", keep_screen: "warn", uploads_off: "warn",
  uploads_test: "warn", phone_off: "warn", not_media: "", pick_limit: "warn", skipped_same: "", renamed: "", big_phone: "warn",
  name_taken_sent: "", sent_again: "", too_many_tries: "warn", not_intact: "problem", replace_unavailable: "problem",
  problem_mismatch: "problem", confirmed: "ok", checking: "wait", cancelled_sent: "warn", read_failed: "problem",
  no_answer: "problem",
  // (a file held one by one in the phone's own words - review round 3 - is a warn line, as every other held file's)
  too_many_tries_phone: "warn",
};
// record's refusals (photo_upload_files refused[].code) in the copy words, {name} or {path}
const REFUSED_NAME = ["bad_char", "trailing", "reserved_name", "reserved_prefix", "money", "empty_file"];
const REFUSED_PATH = ["too_long", "too_deep"];
const REFUSED_SILENT = ["junk", "empty", "dot_segment"];
// the function's whole-call codes that stop the office's side: asked again every AGAIN_MS
const STOP_OD = ["not_authorized", "root_lost", "too_wide", "root_changed", "not_configured", "not_deployed"];
const MODE = ["uploads_off", "uploads_test"];
// per-file codes of sessions that leave the file where it is (its line says why)
const HELD = ["too_many_tries", "not_same_file", "not_this_device", "too_large", "path_too_long"];
// the held files a new pick of the same file sends again, its tries from 0 (OD §3.3 step 9; review round 3)
const RETRY_HELD = ["too_many_tries", "onedrive_failed"];
// per-file codes that make the row a mismatch (nothing to send)
const MISMATCH = ["changed", "replace_unavailable"];
// done's item codes of a row never confirmed that is to send again (OD §4.5): photo-files answers them as {file_id, code}
// with no state (handler.ts), the row back at to_send - its device sends it again in a new session from byte 0
const RESEND = ["broken_upload", "not_this_upload", "gone"];
// codes that stop the whole hand-in (they are about every file: the folder, the hand-in, who may)
const HAND_IN_STOPS = ["folder_gone", "folder_name_taken", "bad_path", "upload_closed", "no_upload", "not_yours", "forbidden", "unauthorized",
  "no_shoot", "invalid", "bad_files", "server_error", "method_not_allowed", "phone_off", "not_connected", "open_elsewhere",
  "stopped_elsewhere", "too_many", "bad_key", "bad_source", "sealed", "empty", "not_available"];

const codeOf = (e) => String((e && (e.hint || e.code)) || "");
const isNoAnswer = (e) => !!e && (e.retryable === true || e.code === "offline" || e.code === "NETWORK");

/* ── the hand-in ──────────────────────────────────────────────────────── */

const STOPPED = { stopped: true };
// (opened's answer for a hand-in it began with a fresh client key: truthy, like an open one)
const BEGUN = "begun";

function safeStorage() {
  try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch (e) { return null; }
}

export function createPhoneSend(deps) {
  const d = Object.assign({
    repo: filesRepo, transport: null, hasher: null, storage: undefined,
    window: typeof window !== "undefined" ? window : null,
    document: typeof document !== "undefined" ? document : null,
    navigator: typeof navigator !== "undefined" ? navigator : null,
    random: defaultRandom, now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t),
    by: "", codes: () => [], today: "", createUploader: realCreateUploader, uploader: {}, ms: {},
  }, deps);
  if (d.storage === undefined) d.storage = safeStorage();
  const MS = Object.assign({ beat: BEAT_MS, soon: SOON_MS, again: AGAIN_MS, pause: PAUSE_MS, waits: WAITS }, d.ms);
  const repo = d.repo;
  const hasher = d.hasher || createHasher();
  const inner = d.transport || xhrTransport();

  // ── memory (the page's only: the upload addresses live in `addrs` and the uploader) ──
  const memo = { device_key: null, device_id: null, hand_ins: {} };
  loadStore();
  const S = {
    shootId: null, upload: null, clientKey: null,
    entries: [],          // this hand-in's files this page holds (each with its File)
    prior: [],            // this hand-in's rows read at a Pick the rest again that no file of this page stands for
    queue: [],
    current: null,
    phase: "idle",        // idle | starting | sending | stopped | finding | asking | sealing | sealed | cancelled | refused
    cond: null,           // waiting_net | throttled | full | stopped_od | mode | paused | null
    jobWait: null,        // the uploader waiting to try a chunk again: waiting_net (no answer) | throttled (busy) | null
    mode: null,           // uploads_off | uploads_test while sessions refuses
    stop: null,           // {code, values}: why the hand-in stopped (a hand-in-wide code)
    notes: { skipped: 0, renamed: 0, notMedia: 0, limited: false, sentAgain: 0, big: [], refused: [], moved: [] },
    end: null,            // {code, values} of the last act: confirmed / checking / cancelled_sent
    phoneFound: 0, askRows: [],
    lock: null, lockRefused: false,
    stopping: false, loop: null,
    rate: [],             // [t, acknowledged bytes]
  };
  const addrs = new Map();         // upload address -> {key, hashed, size, entry, pre, gap}
  let hseq = 0;
  const sleepers = new Set();
  const listeners = new Set();
  let beatTimer = null, pauseTimer = null, soonTimer = null, lastBeat = 0, aids = false, resumers = [];

  function loadStore() {
    let v = null;
    try { v = d.storage ? JSON.parse(d.storage.getItem(STORE_KEY) || "null") : null; } catch (e) { v = null; }
    if (v && typeof v === "object") {
      if (DEVICE_KEY.test(String(v.device_key || ""))) memo.device_key = v.device_key;
      if (Number.isSafeInteger(Number(v.device_id)) && Number(v.device_id) > 0) memo.device_id = Number(v.device_id);
      if (v.hand_ins && typeof v.hand_ins === "object") {
        for (const [k, c] of Object.entries(v.hand_ins)) if (/^\d{1,15}$/.test(k) && CLIENT_KEY.test(String(c || ""))) memo.hand_ins[k] = c;
      }
    }
  }
  function saveStore() {
    try { if (d.storage) d.storage.setItem(STORE_KEY, JSON.stringify(memo)); } catch (e) { /* the keys live for this page only */ }
  }
  function deviceKey() {
    if (!memo.device_key) { memo.device_key = newDeviceKey(d.random); saveStore(); }
    return memo.device_key;
  }

  // ── events out ──
  function emit() { const v = view(); listeners.forEach((cb) => { try { cb(v); } catch (e) { /* a listener never stalls a send */ } }); }

  // ── timers ──
  /** Wait `ms`; `soft` waits (a connection's backoff) end early on online / visible; every wait ends on a stop. */
  function sleep(ms, soft) {
    return new Promise((resolve) => {
      let t = null;
      const w = { soft: !!soft, done: () => { if (t !== null) d.clearTimeout(t); t = null; sleepers.delete(w); resolve(); } };
      t = d.setTimeout(w.done, Math.max(0, ms));
      sleepers.add(w);
    });
  }
  function wake(all) { for (const w of Array.from(sleepers)) if (all || w.soft) w.done(); }
  const backoff = (n) => MS.waits[Math.min(MS.waits.length - 1, Math.max(0, n - 1))];

  // ── the uploader with the photo broker parts ──
  const up = d.createUploader(Object.assign({
    send: hashingTransport(inner, { stateOf: (url) => addrs.get(url) || null, hasher, seen,
      failed: (req, err, st) => { if (st && st.entry) st.entry.wait = "waiting_net"; },
      // (the file's last chunk on its way: from now on it may be in OneDrive with no answer to say so - Cancel it asks
      // find for it; review round 6)
      last: (st) => { if (st && st.entry) st.entry.tail = true; } }),
    broker: { session: brokerSession, done: brokerDone, find: brokerFind },
    setTimeout: d.setTimeout, clearTimeout: d.clearTimeout, now: d.now,
  }, d.uploader));
  const ended = new Map(), waiters = new Map();
  let jobSent = 0;
  up.onChange((items, evt) => {
    const cur = S.current;
    if (cur && cur.jobId) {
      const j = (items || []).find((x) => x.id === cur.jobId);
      if (j) {
        jobSent = j.sent || 0;
        sample();
        // the uploader waiting to try a chunk again (its own tries): no connection, or OneDrive busy - its words while it
        // waits (files.waiting_net / files.throttled: the last answer's kind, seen), gone with the next chunk in or once an
        // answer shows the connection works again (the GET how far after a lost chunk: never "OneDrive asked DCR to slow
        // down" over a lost connection - the final screenshots)
        S.jobWait = j.state === "sending" && (j.tries || 0) > 0 ? cur.wait || null : null;
      }
    }
    if (evt && evt.job && (evt.type === "done" || evt.type === "failed" || evt.type === "cancelled")) {
      const w = waiters.get(evt.job.id);
      if (w) { waiters.delete(evt.job.id); w(evt.job); } else ended.set(evt.job.id, evt.job);
    }
    emit();
  });
  function jobEnd(id) {
    if (ended.has(id)) { const j = ended.get(id); ended.delete(id); return Promise.resolve(j); }
    return new Promise((resolve) => waiters.set(id, resolve));
  }

  function register(e, url) {
    if (e.addr && e.addr !== url) dropAddr(e.addr);
    const st = { key: "h" + (++hseq), hashed: 0, size: e.size, entry: e, pre: null };
    // a file hashed at its pick (Pick the rest again): never hashed a second time
    if (e.hash) { st.hashed = e.size; st.pre = e.hash; }
    st.gap = (upto) => feedFile(st, upto);
    addrs.set(url, st);
    e.addr = url;
  }
  function dropAddr(url) {
    const st = addrs.get(url);
    if (st) { hasher.drop(st.key); addrs.delete(url); }
  }
  async function feedFile(st, upto) {
    while (st.hashed < upto) {
      const end = Math.min(upto, st.hashed + READ_SLICE);
      const buf = await st.entry.file.slice(st.hashed, end).arrayBuffer();
      hasher.update(st.key, buf);
      st.hashed = end;
    }
  }
  /** The file's quickXorHash: the one its pick made, else its address's (the rest of the file read first when the
      chunks did not reach its end), else one read of the whole file. */
  async function hashOf(e) {
    if (e.hash) return e.hash;
    const st = e.addr ? addrs.get(e.addr) : null;
    if (st) {
      await feedFile(st, e.size);
      const h = await hasher.digest(st.key);
      if (h) { e.hash = h; return h; }
    }
    const h2 = await wholeHash(e.file);
    if (h2) e.hash = h2;
    return h2;
  }
  async function wholeHash(file) {
    const st = { key: "w" + (++hseq), hashed: 0, size: Number(file.size) || 0, entry: { file } };
    try {
      await feedFile(st, st.size);
      let h = await hasher.digest(st.key);
      if (!h && globalThis.DCR2QuickXor) {
        // the worker could not: here, once more
        const q = new globalThis.DCR2QuickXor.QuickXorHash();
        for (let at = 0; at < st.size; at += READ_SLICE) q.update(new Uint8Array(await file.slice(at, Math.min(st.size, at + READ_SLICE)).arrayBuffer()));
        h = q.base64();
      }
      return h;
    } finally { hasher.drop(st.key); }
  }

  /** The transport's look at every answer (OD §3.3 step 5): a 507 stops the job at once; a PUT's 409, or every byte in
      with no item, is "finished but not committed". */
  function seen(req, res, st) {
    if (!st || !res) return;
    const e = st.entry;
    const s = Number(res.status);
    // an answer came: the connection works - OneDrive busy (429, 5xx) is its own wait, any other answer none
    if (e) e.wait = s === 429 || (s >= 500 && s !== 507) ? "throttled" : null;
    if (!e || !e.jobId || e.stop) return;
    if (req.method === "PUT" && s === 507) { e.stop = "full"; up.cancel(e.jobId); return; }
    if (req.method === "PUT" && s === 409) { e.stop = "uncommitted"; up.cancel(e.jobId); return; }
    if (req.method === "GET" && s >= 200 && s < 300 && st.hashed >= st.size) {
      let body = null;
      try { body = JSON.parse(res.text() || "null"); } catch (x) { body = null; }
      const next = body && Array.isArray(body.nextExpectedRanges) ? body.nextExpectedRanges : [];
      if (!next.length) { e.stop = "uncommitted"; up.cancel(e.jobId); }
    }
  }

  function filesErr(code, retryAfter) {
    const err = new Error(code);
    err.code = code;
    if (retryAfter) err.retryAfter = retryAfter;
    return err;
  }

  async function brokerSession(j) {
    const e = j.meta.entry;
    let f = e.first;
    e.first = null;
    if (!f) {
      // a new session after a gone one (the uploader's own restart): sessions again, for this one file
      const a = (await repo.sessions(S.upload.id, deviceKey(), [sessionItem(e)])) || {};
      f = pickFile(a, e);
      if (!f.upload_url) {
        e.answer = f;
        if (f.code === "found") e.found = f.item_id;
        throw filesErr(f.code || "onedrive_failed", f.retry_after);
      }
      S.notes.sentAgain++;
    }
    register(e, f.upload_url);
    if (f.code === "name_taken" && f.path) moved(e, f.path);
    if (f.path) e.path = f.path;
    return { uploadUrl: f.upload_url, ticket: null, name: e.path, chunkBytes: f.chunk_bytes || PHONE_CHUNK,
      maxChunkBytes: f.max_chunk_bytes || null, expiresAt: f.expires_at || null };
  }
  async function brokerDone(j, itemId) {
    // the bytes committed: the item goes to photo-files done from the send loop (with the hash), never from here
    j.meta.entry.itemId = itemId;
    return { itemId };
  }
  async function brokerFind(j) {
    const e = j.meta.entry;
    const id = await repo.find(S.upload.id, deviceKey(), e.fileId);
    return id ? [{ id, name: j.name, size: j.size }] : [];
  }
  function sessionItem(e) { const o = { file_id: e.fileId }; if (e.hash) o.md5 = e.hash; return o; }
  function pickFile(a, e) {
    const list = Array.isArray(a && a.files) ? a.files : [];
    const f = list.find((x) => x && Number(x.file_id) === e.fileId) || { code: "onedrive_failed" };
    return Object.assign({ chunk_bytes: a && a.chunk_bytes, max_chunk_bytes: a && a.max_chunk_bytes }, f);
  }
  function moved(e, to) {
    if (e.path && to && pathKey(e.path) !== pathKey(to)) S.notes.moved.push({ name: lastSeg(e.path), to: lastSeg(to) });
  }

  // ── asking the database and the function, with the waits of a phone's connection ──
  function setCond(c) {
    if (S.cond === c) return;
    // (the rate counts sending time only: a wait's end starts its samples again)
    if (S.cond && !c) S.rate = [];
    S.cond = c;
    emit();
  }
  async function ask(fn) {
    let n = 0;
    for (;;) {
      if (S.stopping) throw STOPPED;
      try {
        const r = await fn();
        if (S.cond === "waiting_net" || S.cond === "throttled") setCond(null);
        return r;
      } catch (e) {
        if (e === STOPPED) throw e;
        const code = codeOf(e);
        if (isNoAnswer(e)) { n++; setCond("waiting_net"); await sleep(backoff(n), true); continue; }
        if (code === "busy" || code === "rate" || code === "failed" || code === "onedrive_failed" || code === "later") {
          n++;
          setCond("throttled");
          const ra = Number(e && e.retryAfter);
          await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 900) * 1000 : backoff(n), false);
          continue;
        }
        throw e;
      }
    }
  }

  // ── the aids while sending: the beat, the wake lock, beforeunload, visibility and online ──
  function onUnload(ev) { if (!active()) return; try { ev.preventDefault(); } catch (x) { /* */ } ev.returnValue = ""; return ""; }
  function onVisible() {
    if (!d.document || d.document.visibilityState !== "visible") return;
    if (active()) lockScreen();
    wake(false);
    resumeNow();
  }
  function onOnline() { wake(false); try { up.wake(); } catch (x) { /* */ } resumeNow(); }
  function startAids() {
    if (aids) return;
    aids = true;
    if (d.window && d.window.addEventListener) { d.window.addEventListener("beforeunload", onUnload); d.window.addEventListener("online", onOnline); }
    if (d.document && d.document.addEventListener) d.document.addEventListener("visibilitychange", onVisible);
    lockScreen();
    beat();
    scheduleBeat(MS.beat);
  }
  function stopAids() {
    if (!aids) return;
    aids = false;
    if (d.window && d.window.removeEventListener) { d.window.removeEventListener("beforeunload", onUnload); d.window.removeEventListener("online", onOnline); }
    if (d.document && d.document.removeEventListener) d.document.removeEventListener("visibilitychange", onVisible);
    if (beatTimer !== null) { d.clearTimeout(beatTimer); beatTimer = null; }
    if (soonTimer !== null) { d.clearTimeout(soonTimer); soonTimer = null; }
    unlockScreen();
  }
  async function lockScreen() {
    const wl = d.navigator && d.navigator.wakeLock;
    if (S.lock) return;
    if (!wl || typeof wl.request !== "function") { if (!S.lockRefused) { S.lockRefused = true; emit(); } return; }
    try {
      const lock = await wl.request("screen");
      if (!active()) { try { lock.release(); } catch (x) { /* */ } return; }
      S.lock = lock;
      S.lockRefused = false;
      if (lock && typeof lock.addEventListener === "function") lock.addEventListener("release", () => { if (S.lock === lock) S.lock = null; });
    } catch (x) { S.lockRefused = true; }
    emit();
  }
  function unlockScreen() {
    if (S.lock) { try { S.lock.release(); } catch (x) { /* */ } }
    S.lock = null;
  }
  function scheduleBeat(ms) {
    if (beatTimer !== null) d.clearTimeout(beatTimer);
    beatTimer = d.setTimeout(() => { beatTimer = null; beat(); if (aids) scheduleBeat(MS.beat); }, ms);
  }
  function beatState() {
    const c = S.cond || S.jobWait;
    if (c === "full") return "onedrive_full";
    if (c === "stopped_od") return "onedrive_stopped";
    if (c === "throttled") return "busy";
    if (c === "waiting_net" || c === "paused") return "waiting_net";
    return "sending";
  }
  function beat() {
    if (!S.upload || S.mode || !active()) return;
    lastBeat = d.now();
    const p = Promise.resolve().then(() => repo.beat(S.upload.id, { state: beatState(), bytesSent: ackBytes(), sentFiles: doneCount(), rateBps: rateBps() }));
    p.catch(() => { /* a lost beat is the next one's */ });
  }
  /** A file in: the beat soon (at most every SOON_MS besides the 30 s one), so the status's {sent} of {total} - another
      device's line, this phone's own after a reload - is never a file behind for long. */
  function beatSoon() {
    if (soonTimer !== null || !aids) return;
    const wait = lastBeat + MS.soon - d.now();
    if (wait <= 0) { beat(); return; }
    soonTimer = d.setTimeout(() => { soonTimer = null; if (aids) beat(); }, wait);
  }
  function ackBytes() {
    let n = 0;
    for (const e of S.entries) if (e.state === "confirmed" || e.state === "checking") n += e.size;
    for (const r of S.prior) if (r.md5) n += Number(r.size) || 0;
    if (S.current && S.current.state === "sending") n += jobSent;
    return n;
  }
  function doneCount() {
    let n = 0;
    for (const e of S.entries) if (e.state === "confirmed" || e.state === "checking") n++;
    for (const r of S.prior) if (r.md5) n++;
    return n;
  }
  function sample() {
    if (S.cond) return;
    const t = d.now();
    S.rate.push([t, ackBytes()]);
    while (S.rate.length > 2 && t - S.rate[1][0] >= RATE_SPAN_MS) S.rate.shift();
  }
  function rateBps() {
    if (S.rate.length < 2) return null;
    const a = S.rate[0], b = S.rate[S.rate.length - 1];
    const dt = (b[0] - a[0]) / 1000;
    return dt >= 60 && b[1] > a[1] ? Math.round((b[1] - a[1]) / dt) : null;
  }
  function active() { return S.phase === "starting" || S.phase === "sending"; }

  /** A paused job (its session alive) waits for this: visible, online, PAUSE_MS while in front, or a stop. */
  function resumeSignal() {
    return new Promise((resolve) => {
      resumers.push(resolve);
      if (pauseTimer !== null) d.clearTimeout(pauseTimer);
      pauseTimer = d.setTimeout(() => {
        pauseTimer = null;
        if (!d.document || d.document.visibilityState !== "hidden") resumeNow();
      }, MS.pause);
    });
  }
  function resumeNow() {
    if (pauseTimer !== null) { d.clearTimeout(pauseTimer); pauseTimer = null; }
    const r = resumers;
    resumers = [];
    r.forEach((f) => f());
  }

  // ── the send loop ──
  async function sendLoop() {
    S.phase = "sending";
    startAids();
    emit();
    while (!S.stopping && S.queue.length) {
      const e = S.queue[0];
      S.current = e;
      let r;
      try { r = await sendOne(e); } catch (err) { r = err === STOPPED ? "stop" : handInStop(err); }
      if (r === "stop") break;
      if (r === "again") continue;
      S.queue.shift();
    }
    S.current = null;
    jobSent = 0;
    if (S.stopping) return;
    if (S.phase === "sending") {
      // every file of this hand-in confirmed or checking: the seal; any other row left: the stopped choices
      if (allIn()) { await sealNow(); return; }
      S.phase = "stopped";
    }
    stopAids();
    emit();
  }

  /** Every row of this hand-in confirmed or checking (or settled otherwise: a mismatch, no longer waiting), and at least
      one of them: the seal may come. */
  function allIn() {
    const ok = (e) => ["confirmed", "checking", "mismatch", "settled"].indexOf(e.state) !== -1;
    const rows = S.entries.filter((e) => e.state !== "skipped" && e.state !== "refused");
    if (!rows.every(ok) || !S.prior.every((r) => !!r.md5)) return false;
    return rows.length > 0 || S.prior.length > 0;
  }

  async function sendOne(e) {
    if (e.itemId) return doneFor(e);
    let a;
    try {
      a = await ask(() => repo.sessions(S.upload.id, deviceKey(), [sessionItem(e)]));
    } catch (err) {
      if (err === STOPPED) throw err;
      return callStop(err);
    }
    if (S.mode) { S.mode = null; emit(); }
    const f = pickFile(a, e);
    if (f.upload_url) return runJob(e, f);
    return perFile(e, f);
  }

  /** A whole-call refusal of sessions or done (OD §4.3, §4.7): waits that ask again, or the hand-in's stop. */
  async function callStop(err) {
    const code = codeOf(err);
    if (MODE.indexOf(code) !== -1) {
      // the mode: no bytes move, no beat; sessions asked again every AGAIN_MS
      S.mode = code;
      setCond("mode");
      await sleep(MS.again, false);
      if (S.stopping) return "stop";
      setCond(null);
      return "again";
    }
    if (code === "onedrive_full") return fullWait();
    if (STOP_OD.indexOf(code) !== -1) {
      setCond("stopped_od");
      await sleep(MS.again, false);
      if (S.stopping) return "stop";
      setCond(null);
      return "again";
    }
    return handInStop(err);
  }
  async function fullWait() {
    setCond("full");
    beat();
    await sleep(MS.again, false);
    if (S.stopping) return "stop";
    setCond(null);
    return "again";
  }
  function handInStop(err) {
    let code = codeOf(err) || "other";
    const v = {};
    const det = (err && (err.detail || err.info)) || {};
    if (code === "uploads_test") v.codes = codesText();
    if (det && det.name) v.name = safe(det.name);
    // a word that names something the answer did not: the plain "couldn't do that"
    if (typeof WORDS.hint[code] === "string" && /\{name\}/.test(WORDS.hint[code]) && !v.name) code = "other";
    S.stop = { code: err && err.notAvailable ? "not_available" : code, values: v };
    S.phase = "stopped";
    setCond(null);
    return "stop";
  }
  function codesText() {
    let c = [];
    try { c = d.codes() || []; } catch (e) { c = []; }
    return c.map(safe).filter(Boolean).join(", ");
  }

  async function perFile(e, f) {
    const code = String(f.code || "");
    if (code === "found" && f.item_id) { e.itemId = String(f.item_id); return doneFor(e); }
    if (HELD.indexOf(code) !== -1) { e.state = "held"; e.code = code; e.info = f; emit(); return "next"; }
    if (MISMATCH.indexOf(code) !== -1) { e.state = "mismatch"; e.code = code; emit(); return "next"; }
    if (code === "not_waiting") { e.state = "settled"; emit(); return "next"; }
    if (code === "gone") return "again";
    if (code === "onedrive_full") return fullWait();
    if (code === "busy" || code === "later") {
      setCond("throttled");
      const ra = Number(f.retry_after);
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 900) * 1000 : backoff(1), false);
      if (S.stopping) return "stop";
      setCond(null);
      return "again";
    }
    if (HAND_IN_STOPS.indexOf(code) !== -1) return handInStop({ code, detail: { name: stopName(code, f, e) } });
    e.attempts = (e.attempts || 0) + 1;
    if (e.attempts < 3) return "again";
    e.state = "held";
    e.code = "onedrive_failed";
    emit();
    return "next";
  }
  /** {name} of a hand-in-wide refusal: the answer's own name; a file named like the phone's sub-folder (bad_path). */
  function stopName(code, f, e) {
    if (f && typeof f.name === "string" && f.name) return f.name;
    if (code === "bad_path") return PHONE_DIR;
    return code === "folder_name_taken" ? "" : (e && e.name) || "";
  }

  async function runJob(e, first) {
    e.first = first;
    e.stop = null;
    e.state = "sending";
    const job = up.add({ file: e.file, name: e.path, label: e.name, meta: { entry: e } });
    e.jobId = job.id;
    jobSent = 0;
    try {
      for (;;) {
        const j = await jobEnd(job.id);
        if (j.state === "done") return await doneFor(e);
        if (j.state === "cancelled") return await afterStop(e);
        // failed, its session alive: a pause, started again on visible / online
        if (j.session && !j.settle && !S.stopping && !e.stop) {
          setCond("paused");
          await resumeSignal();
          if (S.stopping) return "stop";
          setCond(null);
          up.retry(job.id);
          continue;
        }
        return await afterFail(e, j.code || "");
      }
    } finally {
      e.jobId = null;
      S.jobWait = null;
      up.remove(job.id);
      ended.delete(job.id);
    }
  }

  async function afterStop(e) {
    const why = e.stop;
    e.stop = null;
    if (S.stopping) return "stop";
    if (why === "full") {
      // OneDrive full at a chunk: that session is dropped, the file sent again from byte 0 once there is room
      if (e.addr) dropAddr(e.addr);
      e.addr = null;
      e.state = "queued";
      return fullWait();
    }
    if (why === "uncommitted") {
      let id = null;
      try { id = await ask(() => repo.find(S.upload.id, deviceKey(), e.fileId)); } catch (err) {
        if (err === STOPPED) throw err;
        return callStop(err);
      }
      if (id) { e.itemId = id; return doneFor(e); }
      if (e.addr) dropAddr(e.addr);
      e.addr = null;
      e.state = "queued";
      S.notes.sentAgain++;
      return "again";
    }
    return "stop";
  }

  async function afterFail(e, code) {
    if (e.addr) dropAddr(e.addr);
    e.addr = null;
    if (S.stopping) return "stop";
    e.state = "queued";
    const f = e.answer;
    e.answer = null;
    if (code === "found" && e.found) { e.itemId = String(e.found); e.found = null; return doneFor(e); }
    if (f && f.code === code) return perFile(e, f);
    if (MODE.indexOf(code) !== -1 || code === "onedrive_full" || STOP_OD.indexOf(code) !== -1) return callStop({ code });
    if (code === "offline" || code === "busy" || code === "rate" || code === "failed" || code === "unavailable") {
      setCond(code === "offline" ? "waiting_net" : "throttled");
      await sleep(backoff(3), code === "offline");
      if (S.stopping) return "stop";
      setCond(null);
      return "again";
    }
    if (HAND_IN_STOPS.indexOf(code) !== -1) return handInStop({ code, detail: { name: stopName(code, null, e) } });
    // a refused chunk or a session OneDrive kept closing: sessions again (the name rules), at most 3 times a file
    e.attempts = (e.attempts || 0) + 1;
    if (e.attempts < 3) return "again";
    e.state = "held";
    e.code = "onedrive_failed";
    emit();
    return "next";
  }

  /** photo-files done for the file's item, with the hash computed while it was sent (OD §3.3 step 5, §4.5). */
  async function doneFor(e) {
    e.state = "finishing";
    emit();
    const hash = await hashOf(e);
    let a;
    try {
      a = await ask(() => repo.done(S.upload.id, deviceKey(), [Object.assign({ file_id: e.fileId, item_id: e.itemId }, hash ? { md5: hash } : {})]));
    } catch (err) {
      if (err === STOPPED) throw err;
      return callStop(err);
    }
    const list = Array.isArray(a && a.items) ? a.items : [];
    const it = list.find((x) => x && Number(x.file_id) === e.fileId) || list[0] || {};
    const state = String(it.state || ""), code = String(it.code || "");
    if (state === "confirmed" || state === "checking") {
      e.state = state;
      e.rowHash = true;
      finishEntry(e);
      return "next";
    }
    if (state === "waiting" || (!state && RESEND.indexOf(code) !== -1)) {
      // gone, not_this_upload, broken_upload: the row is to send again (a new session from byte 0)
      e.rowHash = !!hash;
      e.itemId = null;
      if (e.addr) dropAddr(e.addr);
      e.addr = null;
      e.resends = (e.resends || 0) + 1;
      if (e.resends > 3) { e.state = "held"; e.code = "onedrive_failed"; emit(); return "next"; }
      e.state = "queued";
      S.notes.sentAgain++;
      return "again";
    }
    if (state === "mismatch" || state === "missing") {
      e.state = "mismatch";
      e.code = code === "not_intact" ? "not_intact" : "mismatch";
      e.rowHash = true;
      finishEntry(e);
      return "next";
    }
    if (code === "not_same_file") { e.state = "held"; e.code = code; e.itemId = null; finishEntry(e); return "next"; }
    // (as sessions answers them, OD §4.5, §18: another device's hand-in - {file_id, code} with folder null - is held with
    // its own words, never "OneDrive failed"; a row no longer this hand-in's to send is settled)
    if (code === "not_this_device") { e.state = "held"; e.code = code; e.info = it; emit(); return "next"; }
    if (code === "not_waiting") { e.state = "settled"; emit(); return "next"; }
    if (code === "onedrive_full") return fullWait();
    if (code === "busy") {
      setCond("throttled");
      const ra = Number(it.retry_after);
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 900) * 1000 : backoff(2), false);
      if (S.stopping) return "stop";
      setCond(null);
      return "again";
    }
    e.state = "held";
    e.code = "onedrive_failed";
    emit();
    return "next";
  }
  function finishEntry(e) {
    if (e.addr) dropAddr(e.addr);
    e.addr = null;
    sample();
    beatSoon();
    emit();
  }

  /** Stop the file in flight and the loop (Hand in what's there, Cancel it). */
  async function stopSending() {
    if (!S.loop) return;
    S.stopping = true;
    const cur = S.current;
    if (cur && cur.jobId) up.cancel(cur.jobId);
    wake(true);
    resumeNow();
    try { await S.loop; } catch (e) { /* the loop ends */ }
    S.loop = null;
    S.stopping = false;
    if (cur && cur.state === "sending") cur.state = "queued";
  }

  /* ── the acts ───────────────────────────────────────────────────────── */

  async function plan(shootId, files, o) {
    const opt = o || {};
    const id = Number(shootId);
    const picked = Array.from(files || []);
    let rows = [];
    // (one try: the pick is the person's own act - a failed read says so, never waits unseen)
    try { rows = (await repo.rows(id)) || []; } catch (err) {
      const r = refusal(err);
      return { shootId: id, error: r, send: [], resume: [], lines: [stopLine(r)] };
    }
    const sameHandIn = S.upload && S.shootId === id && S.phase !== "sealed" && S.phase !== "cancelled";
    const rest = !!opt.rest || sameHandIn;
    const mine = new Set(rest ? rows.filter((r) => r && !r.counted && r.state !== "removed").map((r) => r.id) : []);
    const hashes = new Map();
    for (const i of needsHash(picked, rows)) hashes.set(i, await wholeHash(picked[i]));
    const p = planPick(picked, rows, { mine, hashes });
    // this page's own entries of the hand-in are never a second entry - but one it holds one by one (too_many_tries, or
    // OneDrive failed 3 times on it), picked again, stays in the plan: start() queues THAT entry again, its tries from 0
    // (OD §3.3 step 9; review round 3 - before, Pick the rest again did nothing for it)
    const own = new Map(S.entries.filter((e) => e.fileId).map((e) => [e.fileId, e]));
    p.resume = p.resume.filter((r) => !own.has(r.fileId) || pickedAgain(own.get(r.fileId)));
    return Object.assign(p, { shootId: id, rest, rows, mine: Array.from(mine), lines: planLines(p) });
  }
  function planLines(p) {
    const out = [];
    if (p.notMedia) out.push(line("copy", "not_media", { n: p.notMedia }));
    if (p.limited) out.push(line("copy", "pick_limit", {}));
    if (p.skipped) out.push(line("copy", "skipped_same", { n: p.skipped }));
    if (p.renamed) out.push(line("copy", "renamed", { n: p.renamed }));
    for (const b of p.big) out.push(line("copy", "big_phone", { size: sizeWords(b.size), left: leftWords(b.size / GOOD_WIFI_BPS) }));
    return out.filter((l) => l.text);
  }

  async function start(p) {
    if (!p || p.error) return view();
    if (active() || S.loop) return view();
    const shootId = Number(p.shootId);
    S.notes = { skipped: p.skipped || 0, renamed: p.renamed || 0, notMedia: p.notMedia || 0, limited: !!p.limited, sentAgain: 0,
      big: p.big || [], refused: [], moved: [] };
    // nothing to send from a new pick: only the pick's own lines (no hand-in is opened)
    if (!(p.send || []).length && !(p.resume || []).length && !p.rest) { emit(); return view(); }
    S.end = null;
    S.stop = null;
    S.phoneFound = 0;
    S.askRows = [];
    // a hand-in this page sealed or cancelled is never the next pick's (its rows are closed - photo_upload_files would
    // refuse upload_closed): the pick begins a new one (a phone's file sent back after that seal is picked again so)
    if (S.phase === "sealed" || S.phase === "cancelled") S.upload = null;
    S.phase = "starting";
    emit();
    let begun = false;
    try {
      const open = await opened(shootId, !!p.rest);
      if (!open) { emit(); return view(); }
      begun = open === BEGUN;
      if (p.rest) mergePrior(p);
      // a file this page held one by one, picked again: that entry queued again (below), its tries from 0
      const own = new Map(S.entries.filter((e) => e.fileId).map((e) => [e.fileId, e]));
      for (const r of p.resume || []) if (own.has(r.fileId) && pickedAgain(own.get(r.fileId))) queueAgain(own.get(r.fileId), r);
      // this page's own files of the hand-in that were not sent yet go again (a stop in between)
      for (const e of S.entries) if (e.state === "queued" && S.queue.indexOf(e) === -1) S.queue.push(e);
      for (const r of p.resume || []) {
        if (own.has(r.fileId)) continue;
        const e = entry(r.file, r.path, r.size, r.hash);
        e.fileId = r.fileId;
        S.entries.push(e);
        S.queue.push(e);
      }
      await recordAll(p.send || []);
    } catch (err) {
      if (err === STOPPED) return view();
      S.phase = "refused";
      S.stop = refusal(err);
      emit();
      return view();
    }
    // a pick that began the hand-in and records nothing of its own (every file answered send: false - its copy still
    // checking in OneDrive, or a PC still sending it - or refused) cancels that hand-in again and ends with only the
    // pick's own lines, as a pick of only skipped files never opens one: an empty open hand-in would hold the shoot's
    // Ready, and its Hand in what's there is refused (OD §3.3 step 2; review round 2)
    if (begun && !S.entries.length && !S.queue.length && !S.prior.length) return withdraw();
    const run = sendLoop().catch(() => {
      // (a fault of this module's own: the hand-in stops where it is, its choices offered)
      S.phase = "stopped";
      S.stop = { code: "other", values: {} };
      stopAids();
      emit();
    });
    S.loop = run;
    run.then(() => { if (S.loop === run) S.loop = null; });
    return view();
  }
  /** The hand-in a pick began with nothing of its own: cancelled again (photo_upload_cancel; closeHandIn drops its stored
      key), no end line - the pick's own lines stay. A refused cancel leaves it stopped, its choices offered. */
  async function withdraw() {
    try {
      await ask(() => repo.cancel(S.upload.id));
    } catch (err) {
      if (err === STOPPED) return view();
      S.phase = "stopped";
      S.stop = refusal(err);
      emit();
      return view();
    }
    closeHandIn("cancelled");
    S.end = null;
    emit();
    return view();
  }
  /** Pick the rest again: this hand-in's rows (the fresh read) that no file of this page stands for. */
  function mergePrior(p) {
    const handled = new Set(S.entries.map((e) => e.fileId).concat((p.resume || []).map((r) => r.fileId)));
    const mine = new Set(p.mine || []);
    const byId = new Map();
    for (const r of S.prior) byId.set(r.id, r);
    for (const r of p.rows || []) if (r && mine.has(r.id)) byId.set(r.id, r);
    S.prior = Array.from(byId.values()).filter((r) => !handled.has(r.id));
  }
  function entry(file, path, size, hash) {
    return { file, name: file.name, path, size: Number(size) || 0, fileId: null, hash: hash || null, state: "queued", code: "",
      itemId: null, addr: null, jobId: null, first: null, stop: null, attempts: 0, resends: 0, rowHash: false, withHash: false };
  }
  /** An entry this page holds one by one that a new pick of the same file sends again (OD §3.3 step 9; review round 3):
      too_many_tries (Microsoft refused its start today) or onedrive_failed (OneDrive failed 3 times on it) - never one
      held for what a new try cannot change (not_same_file, not_this_device, too_large, path_too_long). */
  function pickedAgain(e) {
    return !!e && e.state === "held" && RETRY_HELD.indexOf(e.code) !== -1;
  }
  /** That entry back in the queue with the file just picked, its tries from 0 (sessions decides again: found -> done
      with that item, else a session from byte 0). */
  function queueAgain(e, r) {
    if (e.addr) dropAddr(e.addr);
    Object.assign(e, { file: r.file, size: Number(r.size) || e.size, hash: r.hash || e.hash, state: "queued", code: "", info: null, itemId: null,
      addr: null, first: null, stop: null, answer: null, found: null, wait: null, attempts: 0, resends: 0 });
  }

  /** photo_upload_begin (or the hand-in this page already has): BEGUN when this call began a new one (a fresh client
      key), true when it is open otherwise (this page's, or this phone's opened again with its stored key), false when
      not. */
  async function opened(shootId, rest) {
    if (S.upload && S.shootId === shootId && S.phase !== "sealed" && S.phase !== "cancelled") return true;
    S.entries = [];
    S.prior = [];
    S.queue = [];
    const key = String(shootId);
    let client = rest ? memo.hand_ins[key] : null;
    let fresh = false;
    if (!rest || !client) {
      if (rest && !client) { S.phase = "refused"; S.stop = { code: "no_key", values: {} }; return false; }
      client = newClientKey(d.random);
      fresh = true;
    }
    for (let round = 0; round < 2; round++) {
      let a;
      try {
        a = await ask(() => repo.begin(shootId, { clientKey: client, deviceKey: deviceKey(), label: deviceLabel(d.navigator && d.navigator.userAgent), replaces: null }));
      } catch (err) {
        if (err === STOPPED) throw err;
        S.phase = "refused";
        S.stop = refusal(err);
        return false;
      }
      const u = (a && a.upload) || {};
      if (u.state === "open" && Number(u.id) > 0) {
        S.upload = { id: Number(u.id), device_id: Number(u.device_id) || null };
        S.shootId = shootId;
        S.clientKey = client;
        memo.hand_ins[key] = client;
        if (S.upload.device_id) memo.device_id = S.upload.device_id;
        saveStore();
        return fresh ? BEGUN : true;
      }
      // an old key's hand-in is closed: a fresh pick starts a new one; Pick the rest again has nothing to finish
      delete memo.hand_ins[key];
      saveStore();
      if (rest) { S.phase = "refused"; S.stop = { code: "upload_closed", values: {} }; return false; }
      client = newClientKey(d.random);
      fresh = true;
    }
    S.phase = "refused";
    S.stop = { code: "other", values: {} };
    return false;
  }

  /** photo_upload_files: path, size and time, NO hash (OD §3.3 step 4) - but a file the pick matched to a waiting row of
      another hand-in, with its hash (step 2: the answer's send decides); each file's id from the answer's files[] by i. */
  async function recordAll(list) {
    let todo = list.map((x) => ({ x, path: x.path }));
    const taken = (S.entries.map((e) => e.path)).concat(todo.map((t) => t.path));
    for (let round = 0; round < 3 && todo.length; round++) {
      const items = todo.map((t) => {
        const o = { path: t.path, size: t.x.size };
        if (t.x.modified) o.modified = t.x.modified;
        if (t.x.withHash && t.x.hash) o.md5 = t.x.hash;
        return o;
      });
      const a = await ask(() => repo.record(S.upload.id, items));
      const by = (a && a.byIndex) || {};
      const refused = Array.isArray(a && a.refused) ? a.refused : [];
      const again = [];
      todo.forEach((t, i) => {
        const got = by[i];
        if (got && got.file_id) {
          if (!got.send) { S.notes.skipped++; return; }
          const e = entry(t.x.file, got.path || t.path, t.x.size, t.x.hash);
          e.fileId = Number(got.file_id);
          e.withHash = !!(t.x.withHash && t.x.hash);         // (its row holds the hash already: it counts at the seal)
          S.entries.push(e);
          S.queue.push(e);
          return;
        }
        const r = refused.find((x) => x && Number(x.i) === i);
        const code = r ? String(r.code || "") : "other";
        if (code === "name_taken") {
          // a row took that name meanwhile: the next free one
          taken.push(t.path);
          const next = freeName(t.path, taken);
          if (next && next !== t.path) { taken.push(next); again.push({ x: t.x, path: next }); return; }
        }
        if (REFUSED_SILENT.indexOf(code) !== -1) return;
        S.notes.refused.push({ code, name: lastSeg(t.path), path: t.path });
      });
      todo = again;
    }
    for (const t of todo) S.notes.refused.push({ code: "name_taken", name: lastSeg(t.path), path: t.path });
  }

  /** Hand in what's there (OD §3.3 steps 8, 9). o (after a reload, when this page holds no hand-in): {shootId}. */
  async function handIn(o) {
    await stopSending();
    if (!(await ensureOpen(o))) { emit(); return view(); }
    S.phase = "finding";
    emit();
    try {
      // every row of the hand-in still without a hash: is its file in OneDrive?
      const found = [];
      const bare = S.entries.filter((e) => e.fileId && !e.rowHash && ["skipped", "refused", "settled"].indexOf(e.state) === -1);
      for (const e of bare) {
        const id = await ask(() => repo.find(S.upload.id, deviceKey(), e.fileId));
        if (!id) continue;
        // this page still holds the file: done with its hash (one read of the rest, at most)
        e.itemId = id;
        const r = await doneFor(e);
        if (r === "stop") return view();
      }
      for (const row of S.prior.filter((r) => !r.md5)) {
        // (only the hand-in's own device may ask - photo-files answers anyone else not_this_device: another phone's
        // Hand in what's there is PF's, the seal alone)
        if (!memo.device_key || !here()) break;
        const id = await ask(() => repo.find(S.upload.id, deviceKey(), Number(row.id)));
        if (id) found.push(row);
      }
      if (found.length) {
        S.phase = "asking";
        S.phoneFound = found.length;
        S.askRows = found;
        emit();
        return view();
      }
    } catch (err) {
      if (err === STOPPED) return view();
      S.phase = "stopped";
      S.stop = refusal(err);
      emit();
      return view();
    }
    await sealNow();
    return view();
  }

  /** Hand in without them (after not_checked_phone): the seal; the found rows stay in the folder as files added without
      DCR. */
  async function handInWithout() {
    if (S.phase !== "asking") return view();
    S.phoneFound = 0;
    S.askRows = [];
    await sealNow();
    return view();
  }

  /** After a reload: the stopped hand-in of this phone, opened again with its client key; without the keys (storage was
      blocked) the hand-in's id from the status is used for the seal and the cancel only. */
  async function ensureOpen(o) {
    const opt = o || {};
    // the hand-in this page holds - only for its own shoot: a press on another shoot's stopped hand-in never ends this one
    if (S.upload && S.phase !== "sealed" && S.phase !== "cancelled" && (!opt.shootId || Number(opt.shootId) === S.shootId)) return true;
    const shootId = Number(opt.shootId);
    if (!shootId) return false;
    let rows = [];
    try { rows = (await ask(() => repo.rows(shootId))) || []; } catch (err) {
      if (err === STOPPED) return false;
      S.phase = "refused"; S.stop = refusal(err); return false;
    }
    if (memo.hand_ins[String(shootId)] && memo.device_key) {
      try { if (!(await opened(shootId, true))) return false; } catch (err) { return false; }
    } else if (Number(opt.uploadId) > 0) {
      S.upload = { id: Number(opt.uploadId), device_id: Number(opt.deviceId) > 0 ? Number(opt.deviceId) : null };
      S.shootId = shootId;
      S.entries = [];
      S.queue = [];
    } else {
      S.phase = "refused"; S.stop = { code: "no_key", values: {} }; return false;
    }
    S.prior = rows.filter((r) => r && !r.counted && r.state !== "removed");
    return true;
  }

  /** This phone is the hand-in's own device (its device row, from begin's answer or the status's pc_id). */
  function here() {
    return !!(S.upload && memo.device_id && S.upload.device_id && Number(S.upload.device_id) === Number(memo.device_id));
  }

  async function sealNow() {
    S.phase = "sealing";
    emit();
    let n = 0, bytes = 0;
    for (const e of S.entries) if (e.rowHash) { n++; bytes += e.size; }
    for (const r of S.prior) if (r.md5) { n++; bytes += Number(r.size) || 0; }
    try {
      let a;
      try {
        a = await ask(() => repo.seal(S.upload.id, n, bytes));
      } catch (err) {
        const det = err && err.detail;
        if (codeOf(err) === "empty") {
          // nothing of it reached OneDrive (the database says so too): nothing to hand in - cancelled instead
          await ask(() => repo.cancel(S.upload.id));
          closeHandIn("cancelled");
          S.end = { group: "hint", code: "empty", values: {} };
          stopAids();
          emit();
          return;
        }
        if (codeOf(err) !== "count_mismatch" || !det || !Number.isSafeInteger(Number(det.files))) throw err;
        // the database's own count of the rows with a hash (a done whose answer was lost, a row left out meanwhile)
        a = await ask(() => repo.seal(S.upload.id, Number(det.files), Number(det.bytes) || 0));
      }
      const files = Number(a && a.upload && a.upload.files) || n;
      closeHandIn("sealed");
      S.end = endOfSeal(files);
    } catch (err) {
      if (err === STOPPED) return;
      S.phase = "stopped";
      S.stop = refusal(err);
    }
    stopAids();
    emit();
  }

  /** The sealed hand-in's last line, from what its counted rows are (each with a hash: this page's entries done or
      recorded with one, a mismatch, and the rows of a Pick the rest again none stands for): files.confirmed only when
      every one is confirmed - a row OneDrive has
      differently (a mismatch: its own line says which) is files.problem_mismatch, never "All 16 files are in OneDrive ✓"
      (review round 1); OneDrive still hashing the rest, files.checking; anything else (a row sent back, settled
      elsewhere) no line of its own - the status read after the seal says it. */
  function endOfSeal(files) {
    const kinds = S.entries.filter((e) => e.rowHash || e.withHash || e.state === "mismatch").map((e) => (["confirmed", "checking", "mismatch"].indexOf(e.state) !== -1 ? e.state : "other"))
      .concat(S.prior.filter((r) => r.md5).map((r) => (r.state === "confirmed" ? "confirmed" : r.state === "waiting" ? "checking"
        : r.state === "mismatch" || r.state === "missing" ? "mismatch" : "other")));
    const n = (k) => kinds.filter((x) => x === k).length;
    if (n("mismatch")) return { group: "files", code: "problem_mismatch", values: { n: n("mismatch") } };
    if (n("other")) return null;
    if (n("checking")) return { group: "files", code: "checking", values: { n: n("checking") } };
    return { group: "files", code: "confirmed", values: { counted: files, time: momentText(new Date(d.now()).toISOString(), d.today) } };
  }

  /** Cancel it (PF's cancel). o: as handIn's. copy.cancelled_sent counts the files of the hand-in that are in OneDrive
      and that the cancel did not put back (OD §5.5, §23; review round 5): while this page holds the hand-in's files, its
      OWN entries in OneDrive - their last chunk in (itemId) or their done answered (rowHash), and the rows read at a Pick
      the rest again with a hash - whose file id is not in the answer's put_back_ids (a file the hand-in recorded over
      the shoot's own is put back as the shoot's, never one to "ask the office to delete"). A file whose last chunk landed
      but whose done never reached DCR is the page's to count: the answer's removed_sent leaves it out when that done was
      lost, and counts a file whose session was handed out though none of its bytes went. The file whose last chunk was
      on its way when Cancel it stopped it - or whose answer the connection lost - may be in OneDrive with no answer to
      say so (a one-chunk photo: every chunk is its last): before the cancel, this page asks find for it, as Hand in
      what's there does, and counts it when it is there, or when find cannot say (the safe side; review round 6). Only
      for rows this page does not hold - after a reload, the hand-in's rows still without a hash read at a Pick the rest
      again - the answer's removed_sent decides when it is more (counting too many is the safe side: the office looks and
      finds fewer); an answer without it (a cancel asked again, already cancelled) counts this page's own. */
  async function cancel(o) {
    await stopSending();
    if (!(await ensureOpen(o))) { emit(); return view(); }
    for (const e of S.entries) {
      if (!e.tail || !e.fileId || e.rowHash || e.itemId || ["skipped", "refused", "settled"].indexOf(e.state) !== -1) continue;
      let id = null;
      try { id = await ask(() => repo.find(S.upload.id, deviceKey(), e.fileId)); } catch (err) {
        if (err === STOPPED) return view();
        e.maybe = true;
        continue;
      }
      if (id) e.itemId = String(id);
    }
    let ans;
    try {
      ans = await ask(() => repo.cancel(S.upload.id));
    } catch (err) {
      if (err === STOPPED) return view();
      S.phase = "stopped";
      S.stop = refusal(err);
      emit();
      return view();
    }
    const back = new Set((ans && Array.isArray(ans.put_back_ids) ? ans.put_back_ids : []).map(Number));
    const own = S.entries.filter((e) => (e.rowHash || e.itemId || e.maybe) && !back.has(Number(e.fileId))).length +
      S.prior.filter((r) => r.md5 && !back.has(Number(r.id))).length;
    // (the page holds the hand-in's files: an entry of its own, and no row of the hand-in whose fate it does not know)
    const holds = S.entries.some((e) => e.fileId) && !S.prior.some((r) => !r.md5 && !back.has(Number(r.id)));
    const told = ans && Number.isSafeInteger(ans.removed_sent) && ans.removed_sent >= 0 ? ans.removed_sent : null;
    const sent = told === null || holds ? own : Math.max(own, told);
    closeHandIn("cancelled");
    S.end = sent ? { group: "copy", code: "cancelled_sent", values: { n: sent } } : null;
    stopAids();
    emit();
    return view();
  }

  function closeHandIn(phase) {
    S.phase = phase;
    if (S.shootId !== null) { delete memo.hand_ins[String(S.shootId)]; saveStore(); }
    for (const e of S.entries) if (e.addr) dropAddr(e.addr);
    S.queue = [];
    S.cond = null;
    S.mode = null;
  }

  /** A refusal of begin / record / seal / cancel / rows as {code, values} (its words: view). */
  function refusal(err) {
    if (isNoAnswer(err)) return { code: "no_answer", values: {} };
    if (err && err.notAvailable) return { code: "not_available", values: {} };
    const code = codeOf(err) || "other";
    const det = (err && err.detail) || {};
    const v = {};
    if (code === "uploads_test") v.codes = codesText();
    if (code === "open_elsewhere" || code === "stopped_elsewhere") {
      v.by = safe(det.by) || WORDS.completion.someone;
      v.pc = det.source === "phone" ? pcName({ source: "phone", by: det.by }) : safe(det.pc) || WORDS.files.pc_unknown;
      v.when = momentText(det.started_at || det.since, d.today);
    }
    return { code, values: v };
  }

  /* ── what the page draws ────────────────────────────────────────────── */

  function line(group, code, values) {
    return { group, code, text: word(group, code, values || {}), tone: TONE[code] || "" };
  }
  function phonePc() { return pcName({ source: "phone", by: typeof d.by === "function" ? d.by() : d.by }); }
  function stopLine(s) {
    if (s.code === "no_answer") return line("hint", "no_answer", {});
    if (s.code === "not_available") return line("files", "not_available", {});
    if (s.code === "no_key") return line("hint", "other", {});
    if (typeof WORDS.hint[s.code] === "string") return { group: "hint", code: s.code, text: hintText(s.code, s.values), tone: "warn" };
    return line("hint", "other", {});
  }

  /** {phase, shoot (the shoot of the hand-in this page holds, or null), running, sending: {sent, total}, file: {name, sent,
      size, pct} | null, lines: [{group, code, text, tone}], buttons: [files_buttons codes]} - every text a word of the
      cases. */
  function view() {
    const lines = [];
    const n = S.notes;
    const sendingNow = active();
    if (n.notMedia) lines.push(line("copy", "not_media", { n: n.notMedia }));
    if (n.limited) lines.push(line("copy", "pick_limit", {}));
    if (n.skipped) lines.push(line("copy", "skipped_same", { n: n.skipped }));
    if (n.renamed) lines.push(line("copy", "renamed", { n: n.renamed }));
    for (const m of n.moved) lines.push(line("copy", "name_taken_sent", { name: safe(m.name), new: safe(m.to) }));
    for (const r of n.refused) {
      if (REFUSED_NAME.indexOf(r.code) !== -1) lines.push(line("copy", r.code, { name: safe(r.name) }));
      else if (REFUSED_PATH.indexOf(r.code) !== -1) lines.push(line("copy", r.code, { path: safe(r.path) }));
      else if (r.code === "too_many_files") lines.push(line("copy", "too_many_files", {}));
      else if (r.code === "bad_size") lines.push({ group: "hint", code: "too_large", text: hintText("too_large", { max: sizeWords(268435456000) }), tone: "warn" });
      else if (r.code === "name_taken") lines.push({ group: "hint", code: "name_taken", text: hintText("name_taken"), tone: "warn" });
      else lines.push(line("hint", "other", {}));
    }
    if (sendingNow || ["stopped", "finding", "sealing"].indexOf(S.phase) !== -1) {
      const pc = phonePc();
      const cond = S.cond || (sendingNow ? S.jobWait : null);
      if (cond === "waiting_net") lines.push(line("files", "waiting_net", { pc }));
      else if (cond === "throttled") lines.push(line("files", "throttled", {}));
      else if (cond === "full") lines.push(line("files", "full", { n: toSend(), pc }));
      else if (cond === "stopped_od") lines.push(line("files", "stopped_od", {}));
      else if (cond === "mode" && S.mode) lines.push({ group: "hint", code: S.mode, text: hintText(S.mode, { codes: codesText() }), tone: "warn" });
      if (sendingNow && (S.cond === "paused" || S.lockRefused)) lines.push(line("copy", "keep_screen", {}));
    }
    for (const e of S.entries) {
      if (e.state === "held") {
        // (the phone's own words: nothing on a phone tries again by itself - pick it again tomorrow; review round 3)
        if (e.code === "too_many_tries") lines.push(line("files", "too_many_tries_phone", { name: safe(e.name) }));
        else if (e.code === "too_large") lines.push({ group: "hint", code: "too_large", text: hintText("too_large", { max: sizeWords(e.info && e.info.max_bytes) }), tone: "warn" });
        else if (e.code === "path_too_long") lines.push({ group: "hint", code: e.code, text: hintText(e.code, { name: safe(e.name) }), tone: "warn" });
        else if (typeof WORDS.hint[e.code] === "string" && !/\{[a-z_]+\}/.test(WORDS.hint[e.code])) lines.push({ group: "hint", code: e.code, text: WORDS.hint[e.code], tone: "warn" });
        else lines.push({ group: "hint", code: "onedrive_failed", text: WORDS.hint.onedrive_failed, tone: "warn" });
      } else if (e.state === "mismatch") {
        if (e.code === "not_intact") lines.push(line("copy", "not_intact", { name: safe(e.name) }));
        else if (e.code === "replace_unavailable") lines.push(line("copy", "replace_unavailable", { name: safe(e.name) }));
        else if (e.code === "changed") lines.push({ group: "hint", code: "changed", text: WORDS.hint.changed, tone: "problem" });
        else lines.push(line("files", "problem_mismatch", { n: 1 }));
      }
    }
    if (n.sentAgain) lines.push(line("copy", "sent_again", { n: n.sentAgain }));
    if (S.stop) lines.push(stopLine(S.stop));
    if (S.end) {
      const l = S.end.group === "hint" ? { group: "hint", code: S.end.code, text: hintText(S.end.code), tone: "warn" } : line(S.end.group, S.end.code, S.end.values);
      lines.push(l);
    }
    // Hand in what's there only once at least one file of the hand-in is in OneDrive (sent with its hash, or found by
    // find: the files its ask names) - never at 0, where it asked "Hand in the 0 files…" and the empty seal cancelled the
    // hand-in, the file in flight thrown away (OD §3.3 step 8; review round 3); Cancel it always
    const there = doneCount() > 0 ? ["hand_in_there"] : [];
    const buttons = [];
    if (sendingNow) buttons.push(...there, "cancel_copy");
    else if (S.phase === "asking") buttons.push("pick_them_again", "hand_in_without");
    else if (S.phase === "stopped" && S.upload) buttons.push(...(S.clientKey ? ["pick_rest"] : []), ...there, "cancel_copy");
    const cur = S.current && S.current.state === "sending" ? S.current : null;
    return {
      phase: S.phase, shoot: S.shootId, running: sendingNow, sending: sending(), lines: lines.filter((l) => l.text),
      file: cur ? { name: safe(cur.name), sent: jobSent, size: cur.size, pct: cur.size ? Math.min(100, Math.round((jobSent / cur.size) * 100)) : 0 } : null,
      buttons,
    };
  }
  function toSend() {
    let n = 0;
    for (const e of S.entries) if (["queued", "sending", "finishing"].indexOf(e.state) !== -1) n++;
    return n;
  }

  /** This page's own counts for the Files line's sending_this_phone (map/photo-files.js lineValues o.sending). */
  function sending() {
    if (!S.upload || S.phase === "sealed" || S.phase === "cancelled" || S.phase === "idle") return null;
    const total = S.entries.filter((e) => e.fileId && e.state !== "skipped").length + S.prior.length;
    return { sent: doneCount(), total };
  }

  return {
    plan, start, handIn, handInWithout, cancel, view, sending,
    /** The viewer of map/photo-files.js filesView (OD §10.6): this phone's device row, whether it sends now, and the
        files Hand in what's there found in OneDrive unchecked. */
    viewer: () => ({ device_id: memo.device_id, running_here: active(), phone_found: S.phase === "asking" ? S.phoneFound : 0 }),
    /** Whether this phone holds the keys of that shoot's open hand-in (Pick the rest again can open it again). */
    knows: (shootId) => !!(memo.device_key && memo.hand_ins[String(Number(shootId))]),
    /** Forget a shoot's hand-in key (the status shows it closed). */
    forget: (shootId) => { delete memo.hand_ins[String(Number(shootId))]; saveStore(); },
    onChange: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    /** Whether a file is being sent (the page warns before it is left; it is also this module's beforeunload). */
    active,
    dispose: async () => { await stopSending(); stopAids(); listeners.clear(); },
  };
}
