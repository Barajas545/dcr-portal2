/* DCR Portal 2 — the Plans Library: .takeoff plan files kept on THIS device (owner 2026-10-26: the old portal's job,
   brought to Portal 2).

   A person who sees prices (an admin, or Sees prices: plan files carry prices; map/plans.js planFilesFor) saves a
   project's plan files from 📐 so they open in the takeoff app with no internet - a site trailer, a house with no roof
   yet. Each saved copy is exactly one version of one OneDrive file in the owner's takeoff folder; when OneDrive holds a
   newer one, it downloads BY ITSELF while a portal page is open and online (maybeCheck: the Plans Library, Search, a
   project; the home page only asks for new versions), and the saved copy keeps opening until the new one is whole and
   checked. The takeoff app never writes into a saved copy: its Save goes to Save As or a download.

   Where things live (per browser profile, this site only):
     · the files - the Origin Private File System, folder "plan-library", one file per download (map/plan-library.js
       fileNameFor: never the same name twice), written by js/plan-library-worker.js in byte ranges, resumable;
     · what is known about them - IndexedDB "dcr2-plan-library": plans (one record per person per file, key
       "<owner>|<item id>") and meta (when updates were last checked, the automatic downloads' hold after a OneDrive-wide
       failure, the copies handed to the takeoff app lately);
     · localStorage "dcr2-plan-owners": only the user ids that have plans saved here (no file, name or link), so a page
       can tell, without opening the library, that a person whose Sees prices was taken away still has plans to remove.
   Records belong to the person who saved them (the sign-in's user id, read without the network: sb.js storedUserId). A
   shared tablet shows each person only their own plans. Someone whose Sees prices is turned off loses theirs from the
   device the next time an online portal page sees it (purgeOwner).

   Opening hands the copy to the takeoff app in a new tab, window to window (js/plan-handoff.js): the app is another
   site and reads the File by slices as it draws, and nothing on its site can hold the copy open. So a copy handed over
   is kept a week after it is replaced or removed (map/plan-library.js HANDED_GRACE_MS) and goes at a sweep after that.

   The automatic downloads are polite: after a failure a record waits 5 min, then 10, 20, … up to 6 h before it is tried
   again by itself (a person's own Save, Resume or Update now never waits), and a OneDrive-wide failure (busy, not
   allowed in, the connection) stops them all for a while. Every download is checked against OneDrive's version once it
   is whole: a file saved again in OneDrive during it is downloaded again, never kept as a mix of two versions.

   The bytes come straight from OneDrive (the broker's plan_link: a pre-authenticated link, kept in memory only);
   nothing goes through the broker. Nothing here is a page: the pages draw what list() and onChange() say. */

import * as onedrive from "./repo/onedrive.js";
import { storedUserId } from "./sb.js";
import {
  DIR, MAGIC, FILE_RE, RETRY_CAP_MS, fileNameFor, statusOf, applyCheck, dueForCheck, needsWork, dueForWork, withFailure, backoffMs,
  brokerWide, holding, keepSet, pruneHanded, projectBatches, fmtSize, hashOf,
} from "./map/plan-library.js";
import { planFilesFor } from "./map/plans.js";
import { openInTakeoff, iosHomeScreen, READY_KEY, IOS_HOME } from "./plan-handoff.js";

const DB_NAME = "dcr2-plan-library";
const DB_VER = 1;
const LOCK = "dcr2-plan-dl:";
const OWNERS_KEY = "dcr2-plan-owners";
const SPACE_MARGIN = 64 * 1024 * 1024;         // never fill the last bit of the quota
// After a OneDrive-wide failure the automatic downloads stop, and after a failed version check the checks stop: 5 min,
// doubling while it keeps failing, up to 6 h (map/plan-library.js backoffMs); {until, n} in meta.
const HAS = typeof window !== "undefined";

export const UNSUPPORTED = "This browser cannot keep plan files on the device. Use Chrome or Edge on a computer or Android phone, or Safari 16.4 or newer on an iPhone or iPad.";

let channel = null;
try { channel = HAS && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("dcr2-plan-library") : null; } catch (e) { channel = null; }
const listeners = [];
const jobs = {};          // key -> {worker, done, size, rate, promise, cancelRequested, finished}
const remote = {};        // key -> {done, size, rate, at}: a download running in another window

function err(code, message, extra) {
  const e = new Error(message);
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}
const nowIso = () => new Date().toISOString();

/* ── who, and whether this browser can ─────────────────────────────────── */

/** The person whose plans these are (no network), or "". */
export function owner() {
  return String(storedUserId() || "");
}
const keyOf = (itemId, who) => (who == null ? owner() : who) + "|" + itemId;

/** The storage this needs is here (whether it can also WRITE is asked by canWrite, in a worker). */
export function supported() {
  return HAS && !!(navigator.storage && navigator.storage.getDirectory) && typeof indexedDB !== "undefined" && typeof Worker !== "undefined";
}

let writeProbe = null;
/** Can this browser write a plan here, for real (a scratch file in a worker; cached once it is sure)? */
export function canWrite() {
  if (!supported()) return Promise.resolve(false);
  if (writeProbe) return writeProbe;
  let sure = false;
  const probe = writeProbe = new Promise(function (resolve) {
    let w;
    let settled = false;
    function finish(ok, definite) {
      if (settled) return;
      settled = true;
      sure = definite;
      try { w && w.terminate(); } catch (e) { /* gone */ }
      resolve(ok);
    }
    try {
      w = new Worker(new URL("./plan-library-worker.js", import.meta.url));
      w.onmessage = function (ev) { finish(!!(ev.data && ev.data.type === "probe" && ev.data.ok), true); };
      w.onerror = function () { finish(false, true); };
      w.postMessage({ op: "probe" });
    } catch (e) { finish(false, true); }
    setTimeout(function () { finish(false, false); }, 8000);
  });
  probe.then(function () { if (!sure && writeProbe === probe) writeProbe = null; });
  return probe;
}

/** The user ids with plans saved on this device (localStorage OWNERS_KEY: ids only). */
export function ownersHere() {
  try {
    const v = JSON.parse(localStorage.getItem(OWNERS_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : [];
  } catch (e) { return []; }
}
function noteOwner(who, has) {
  try {
    const set = ownersHere().filter((x) => x !== who);
    if (has) set.push(who);
    if (set.length) localStorage.setItem(OWNERS_KEY, JSON.stringify(set)); else localStorage.removeItem(OWNERS_KEY);
  } catch (e) { /* a hint only */ }
}

/* ── the records ───────────────────────────────────────────────────────── */

let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise(function (resolve, reject) {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = function () {
      const d = r.result;
      if (!d.objectStoreNames.contains("plans")) d.createObjectStore("plans", { keyPath: "key" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "key" });
    };
    r.onsuccess = function () {
      const d = r.result;
      d.onversionchange = function () { try { d.close(); } catch (e) { /* closed */ } dbp = null; };
      // Safari closes the connection under a page that slept in the background: the next ask opens a new one
      d.onclose = function () { dbp = null; };
      resolve(d);
    };
    r.onerror = function () { dbp = null; reject(r.error || err("db", "This browser would not open its storage.")); };
  });
  return dbp;
}
/** One transaction on `store`; a connection that was closed under the page is opened again, once. */
function req(store, mode, fn, again) {
  return db().then(function (d) {
    return new Promise(function (resolve, reject) {
      let tx;
      try { tx = d.transaction(store, mode); } catch (e) {
        if (!again && e && e.name === "InvalidStateError") { dbp = null; resolve(req(store, mode, fn, true)); return; }
        reject(e);
        return;
      }
      let out;
      fn(tx.objectStore(store), function (v) { out = v; });
      tx.oncomplete = function () { resolve(out); };
      tx.onerror = tx.onabort = function () { reject(tx.error || err("db", "Saving to this device's storage failed.")); };
    });
  });
}
const getAll = (store) => req(store, "readonly", (s, set) => { s.getAll().onsuccess = (e) => set(e.target.result || []); }).then((v) => v || []);
const get = (store, key) => req(store, "readonly", (s, set) => { s.get(key).onsuccess = (e) => set(e.target.result); });
const put = (store, value) => req(store, "readwrite", (s) => { s.put(value); });
const del = (store, key) => req(store, "readwrite", (s) => { s.delete(key); });
/** Read, change and write ONE record in one transaction (no other window's write lands in between): fn(current) ->
    the new record, or undefined to leave it as it is. -> the record as written (or as it was). */
function mutate(store, key, fn) {
  return req(store, "readwrite", function (s, set) {
    s.get(key).onsuccess = function (e) {
      const cur = e.target.result;
      const next = fn(cur);
      if (next !== undefined && next !== null) { s.put(next); set(next); } else set(cur);
    };
  });
}

async function metaGet(key, fallback) {
  try { const m = await get("meta", key); return m ? m.value : fallback; } catch (e) { return fallback; }
}
function metaPut(key, value) { return put("meta", { key, value }); }

/* ── the files ─────────────────────────────────────────────────────────── */

function dir() {
  return navigator.storage.getDirectory().then((root) => root.getDirectoryHandle(DIR, { create: true }));
}
async function removeFile(name) {
  if (!FILE_RE.test(String(name || ""))) return;
  try { await (await dir()).removeEntry(name); } catch (e) { /* already gone, or open in a writer: a sweep takes it */ }
}
async function fileOf(name) {
  if (!FILE_RE.test(String(name || ""))) return null;
  try { return await (await (await dir()).getFileHandle(name)).getFile(); } catch (e) { return null; }
}
async function fileOk(name, size) {
  const f = await fileOf(name);
  return !!f && (!(Number(size) > 0) || f.size === Number(size));
}
/** A file handed to the takeoff app lately stays on the device through the grace (it reads it by slices). */
async function handedLately(name) {
  const handed = await metaGet("handed", {});
  return Object.prototype.hasOwnProperty.call(pruneHanded(handed, Date.now()), name);
}
function markHanded(name) {
  return mutate("meta", "handed", function (cur) {
    const handed = pruneHanded(cur ? cur.value : {}, Date.now());
    handed[name] = nowIso();
    return { key: "handed", value: handed };
  });
}
/** An old version or a removed copy: gone now - or, handed to the takeoff app lately, kept a week from now (the replace
    or the remove; up to a week of an old copy per plan opened) and gone at a sweep after that. A takeoff tab still open
    on it longer than that loses it (its save check then keeps the work as a draft). */
async function retire(name) {
  if (!name) return;
  if (await handedLately(name)) await markHanded(name);
  else await removeFile(name);
}

/** This person still has a file of theirs here (a copy kept for the takeoff app after a Remove counts). */
async function hasCopies(who) {
  const mark = "p" + hashOf(who) + "-";
  try { for await (const n of (await dir()).keys()) if (n.indexOf(mark) === 0) return true; } catch (e) { /* none readable */ }
  return false;
}

/* ── telling the pages ─────────────────────────────────────────────────── */

function emit(msg) {
  listeners.slice().forEach(function (fn) { try { fn(msg); } catch (e) { /* a listener's own problem */ } });
}
function changed(key) {
  emit({ t: "changed", key });
  if (channel) try { channel.postMessage({ t: "changed", key }); } catch (e) { /* closed */ }
}
function progress(key) {
  const j = jobs[key];
  if (!j) return;
  const m = { t: "progress", key, done: j.done, size: j.size, rate: j.rate };
  emit(m);
  if (channel) try { channel.postMessage(m); } catch (e) { /* closed */ }
}
if (channel) {
  channel.onmessage = function (ev) {
    const m = ev.data || {};
    if (m.t === "progress") {
      remote[m.key] = { done: m.done, size: m.size, rate: m.rate, at: Date.now() };
      emit(m);
    } else if (m.t === "changed") {
      delete remote[m.key];
      emit(m);
    } else if (m.t === "pause" && jobs[m.key]) {
      pause(m.key, true);
    }
  };
}

/** fn({t: "changed" | "progress", key, done?, size?, rate?}) on every change here or in another window; -> unsubscribe. */
export function onChange(fn) {
  listeners.push(fn);
  return function () { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
}

async function heldLocks() {
  if (!(HAS && navigator.locks && navigator.locks.query)) return null;
  try {
    const s = await navigator.locks.query();
    const held = {};
    (s.held || []).forEach(function (l) { if (l.name && l.name.indexOf(LOCK) === 0) held[l.name.slice(LOCK.length)] = true; });
    return held;
  } catch (e) { return null; }
}

/* ── reading ───────────────────────────────────────────────────────────── */

/** This person's saved plans, each with {status, job: {done, size, rate} | null}, by project number. */
export async function list() {
  const who = owner();
  if (!who || !supported()) return [];
  const held = await heldLocks();
  const all = (await getAll("plans")).filter((r) => r.owner === who);
  return all.map(function (r) {
    const here = jobs[r.key];
    const there = remote[r.key] && Date.now() - remote[r.key].at < 30000 ? remote[r.key] : null;
    const running = !!(held ? held[r.key] : there);
    const job = here && here.worker ? { done: here.done, size: here.size, rate: here.rate } : running && there ? there : null;
    return Object.assign({}, r, { status: statusOf(r, here && here.worker && !here.finished ? here : null, running), job });
  }).sort(function (a, b) {
    return String(a.number || "").localeCompare(String(b.number || ""), "en", { numeric: true }) ||
      String(a.folder || "").localeCompare(String(b.folder || "")) || String(a.name).localeCompare(String(b.name));
  });
}

/** This person's saved plans of one project, by item id. */
export async function savedFor(projectId) {
  const out = {};
  (await list()).forEach(function (r) { if (String(r.projectId) === String(projectId)) out[r.itemId] = r; });
  return out;
}

/** Room: {usage, quota} of this site's storage (or null), and how much the saved plans take. */
export async function usage() {
  let est = null;
  try { est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (e) { est = null; }
  const mine = await list();
  return { usage: est ? est.usage : null, quota: est ? est.quota : null, plans: mine.length,
    bytes: mine.reduce((n, r) => n + (r.file ? Number(r.size) || 0 : 0), 0) };
}

export async function lastChecked() {
  const who = owner();
  return who ? metaGet("check:" + who, null) : null;
}

/* ── saving and downloading ────────────────────────────────────────────── */

/** Save one plan file of a project on this device: {projectId, number, projectTitle, file: {id, name, folder, size,
    modified, version}}. Resolves when the download ends (or pauses); the rows follow it through onChange. */
export async function save(info) {
  if (iosHomeScreen()) throw err("ios_home", IOS_HOME);
  if (!(await canWrite())) throw err("unsupported", UNSUPPORTED);
  const who = owner();
  if (!who) throw err("signin", "Sign in first.");
  const f = info && info.file;
  if (!f || !f.id) throw err("bad", "No plan file to save.");
  const key = keyOf(f.id, who);
  await mutate("plans", key, function (r) {
    if (!r) {
      return { key, owner: who, itemId: f.id, projectId: String(info.projectId), number: String(info.number || ""),
        projectTitle: String(info.projectTitle || ""), name: f.name, folder: f.folder || "", file: "", size: 0, modified: null,
        version: "", savedAt: "", dl: null, latest: null, fails: 0, retryAt: null, failCode: null };
    }
    // saved again: the person's own act - carry on now, from a fresh link
    const out = Object.assign({}, r, { projectTitle: String(info.projectTitle || r.projectTitle || ""), fails: 0, retryAt: null, failCode: null });
    if (out.dl) out.dl = Object.assign({}, out.dl, { userPaused: false, state: out.dl.state === "error" ? "paused" : out.dl.state });
    return out;
  });
  noteOwner(who, true);
  changed(key);
  return download(key, { manual: true });
}

/** Download a saved plan again now (a newer version, a paused or stopped download): the person's own act. */
export async function resume(itemId) {
  if (iosHomeScreen()) throw err("ios_home", IOS_HOME);
  const key = keyOf(itemId);
  await mutate("plans", key, function (r) {
    if (!r) return undefined;
    const out = Object.assign({}, r, { fails: 0, retryAt: null, failCode: null });
    if (out.dl) out.dl = Object.assign({}, out.dl, { userPaused: false, state: out.dl.state === "error" ? "paused" : out.dl.state });
    return out;
  });
  return download(key, { manual: true });
}

function download(key, opts) {
  if (jobs[key] && jobs[key].promise) return jobs[key].promise;
  const job = jobs[key] = jobs[key] || { done: 0, size: 0, rate: 0 };
  job.cancelRequested = false;
  const auto = !(opts && opts.manual);
  const p = (async function () {
    try {
      if (HAS && navigator.onLine === false) throw err("offline", "You're offline. Downloads need the internet; your saved copies still open.");
      if (!(await canWrite())) throw err("unsupported", UNSUPPORTED);
      if (navigator.locks && navigator.locks.request) {
        return await navigator.locks.request(LOCK + key, { ifAvailable: true }, function (lock) {
          if (!lock) throw err("busy_here", "This plan is already downloading in another portal window.");
          return run(key, auto);
        });
      }
      return await run(key, auto);
    } catch (x) {
      await noteFailure(key, x, auto);
      throw x;
    }
  })();
  job.promise = p;
  function cleanup() { if (jobs[key] && jobs[key].promise === p) delete jobs[key]; changed(key); }
  p.then(cleanup, cleanup);
  return p;
}

/* A failed download: an automatic one waits longer each time before it is tried again by itself (withFailure), and a
   record with nothing on the device yet says why. A copy already on the device keeps opening. */
async function noteFailure(key, x, auto) {
  const code = x && x.code;
  if (code === "busy_here" || code === "removed" || code === "skipped") return;
  try {
    await mutate("plans", key, function (r) {
      if (!r) return undefined;
      let out = Object.assign({}, r);
      if (code === "forbidden") out.latest = { status: "denied", checkedAt: nowIso() };
      if (x && x.moved) {
        // the download went forward before it stopped (a weak signal): not a failure to wait longer after
        out.fails = 0; out.retryAt = null; out.failCode = null;
      } else if (code !== "offline" && code !== "unsupported") {
        out = withFailure(out, Date.now());
        // a OneDrive-wide failure waits too (and goes behind the others), but is no reason of the file's own
        out.failCode = brokerWide(code) ? null : code;
      }
      if (!out.dl && !out.file && code !== "gone") {
        const final = code === "not_plan" || code === "no_size";
        out.dl = { file: "", done: 0, size: 0, version: "", state: final ? "error" : "paused", userPaused: false,
          error: (x && x.message) || "The download did not start." };
      }
      return out;
    });
  } catch (e) { /* the message has already reached the person */ }
}

let persistAsked = false;
/** Ask once a visit, never waiting on it (Firefox asks the person, who may never answer). */
function askPersist() {
  if (persistAsked || !(navigator.storage && navigator.storage.persist)) return;
  persistAsked = true;
  Promise.resolve(navigator.storage.persisted ? navigator.storage.persisted() : false)
    .then(function (yes) { return yes ? true : navigator.storage.persist(); })
    .catch(function () { /* the browser decides */ });
}

async function roomFor(bytes) {
  let est = null;
  try { est = await navigator.storage.estimate(); } catch (e) { est = null; }
  if (est && est.quota && bytes > est.quota - est.usage - SPACE_MARGIN) {
    throw err("space", "Not enough room on this device: this file needs " + fmtSize(bytes) + " and about " +
      fmtSize(Math.max(0, est.quota - est.usage - SPACE_MARGIN)) + " is free for the portal. Remove a saved plan or free up space, then try again.");
  }
}

/** A link for this record's file, the version OneDrive holds now; the broker's "gone" and "not yours" in its words. */
async function linkFor(r) {
  try {
    return await onedrive.planLink(r.projectId, r.itemId);
  } catch (x) {
    const code = x && x.code;
    if (code === "not_found") throw err("gone", "This file is no longer in OneDrive.");
    if (code === "forbidden") throw err("forbidden", x.message || "Your account cannot open this plan file.");
    throw x;
  }
}

/** The file is no longer in OneDrive: so marked; a part already downloaded stays (paused) in case it comes back. */
function markGone(key) {
  return mutate("plans", key, function (r) {
    if (!r) return undefined;
    const out = Object.assign({}, r, { latest: { status: "gone", checkedAt: nowIso() } });
    if (out.dl) out.dl = Object.assign({}, out.dl, { state: "paused", error: "" });
    return out;
  });
}

async function run(key, auto) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const job = jobs[key] || {};
    let r = await get("plans", key);
    if (!r) throw err("removed", "That saved plan was removed.");
    // an automatic download looks again under the lock: a person may have paused it, or it may be waiting
    if (auto && !dueForWork(r, Date.now())) return { skipped: true };
    // a device already full needs no walk of OneDrive to say so (with a part on the device the check below is the
    // right one: it runs after an outdated part is removed, and counts what a reused part already holds)
    const known = Number(r.latest && r.latest.status === "ok" && r.latest.size) || 0;
    if (known > 0 && !(r.dl && r.dl.file)) await roomFor(known);
    let link;
    try {
      link = await linkFor(r);
    } catch (x) {
      if (x && x.code === "gone") await markGone(key);
      throw x;
    }
    // asking for the link took a moment: work on the record as it is now (another window may have removed it)
    r = await get("plans", key);
    if (!r) throw err("removed", "That saved plan was removed.");
    const ver = { version: link.version, size: Number(link.size) || 0, modified: link.modified, name: link.name, folder: link.folder };
    if (r.file && r.version === ver.version && (await fileOk(r.file, r.size))) {
      // already the version OneDrive holds, and really on the device: nothing to fetch
      const part = r.dl && r.dl.file && r.dl.file !== r.file ? r.dl.file : "";
      await mutate("plans", key, (c) => (c ? Object.assign({}, c, { latest: Object.assign({ status: "ok", checkedAt: nowIso() }, ver),
        dl: null, fails: 0, retryAt: null, failCode: null }) : undefined));
      if (part) await removeFile(part);
      return { already: true };
    }
    if (!(ver.size > 0)) throw err("no_size", "OneDrive did not say how big this file is.");
    let dl = r.dl && r.dl.file && r.dl.version === ver.version && r.dl.file !== r.file ? Object.assign({}, r.dl) : null;
    if (!dl) {
      if (r.dl && r.dl.file && r.dl.file !== r.file) await removeFile(r.dl.file);   // part of an older version
      // a name never used before: never the saved copy's own file (it keeps opening until the new one is whole), never
      // a copy kept for the takeoff app after a Remove
      dl = Object.assign({ file: fileNameFor(r.owner, r.itemId, ver.version, Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
        done: 0, fresh: true, startedAt: nowIso() }, ver);
    }
    await roomFor(ver.size - (Number(dl.done) || 0));
    askPersist();
    if (job.cancelRequested) {
      // Pause pressed before the download really started: nothing is fetched
      await mutate("plans", key, (c) => (c ? Object.assign({}, c, { dl: Object.assign({}, dl, { state: "paused", error: "", userPaused: true }) }) : undefined));
      return { paused: true };
    }
    const from = Number(dl.done) || 0;
    dl = Object.assign(dl, { state: "running", error: "", userPaused: false });
    if (!(await mutate("plans", key, (c) => (c ? Object.assign({}, c, { dl }) : undefined)))) throw err("removed", "That saved plan was removed.");
    changed(key);

    let w;
    try {
      w = await runWorker(r, dl, link.url);
    } catch (x) {
      if (x.status === 404) {
        await markGone(key);
        throw err("gone", "This file is no longer in OneDrive.");
      }
      const changing = x.status === 416 || !!x.changed;
      // the file changed in OneDrive mid-download: the person's own Save or Update starts again once at once; an
      // automatic one waits (as after the check once it is whole)
      const restart = changing && attempt === 0 && !auto;
      if (restart) {
        await removeFile(dl.file);
        await mutate("plans", key, (c) => (c ? Object.assign({}, c, { dl: null }) : undefined));
        continue;
      }
      // A dropped connection, a OneDrive hiccup, or the file changing again is a pause that carries on by itself (after
      // its wait); running out of room or anything else is a stop with its reason.
      const retryable = x.status !== 507 && ((HAS && navigator.onLine === false) || !x.status || x.status >= 500 ||
        x.status === 416 || x.changed || /connection|stalled|stopped responding|link expired/i.test(x.message || ""));
      const message = x.status === 416 || x.changed ? "The file kept changing in OneDrive while it downloaded — it tries again later."
        : x.message || "The download stopped.";
      const cur = await mutate("plans", key, function (c) {
        if (!c) return undefined;
        const d2 = Object.assign({}, c.dl || dl, { state: retryable ? "paused" : "error", error: message });
        if (typeof x.done === "number") d2.done = x.done;
        return Object.assign({}, c, { dl: d2 });
      });
      if (!cur) { await removeFile(dl.file); throw err("removed", "That saved plan was removed."); }
      throw err(changing ? "changed" : retryable ? "paused" : "stopped", message,
        { moved: !changing && typeof x.done === "number" && x.done > from });
    }
    // removed from another window while this one was downloading: what was written here goes too
    if (!(await get("plans", key))) { await removeFile(dl.file); return { removed: true }; }
    if (w.paused) {
      await mutate("plans", key, (c) => (c && c.dl ? Object.assign({}, c, { dl: Object.assign({}, c.dl, { state: "paused", done: w.done, error: "", userPaused: true }) }) : undefined));
      return { paused: true };
    }
    if (w.magic !== MAGIC) {
      await removeFile(dl.file);
      await mutate("plans", key, (c) => (c ? Object.assign({}, c, { dl: Object.assign({}, dl, { state: "error", done: 0, error: "What downloaded is not a takeoff project file." }) }) : undefined));
      throw err("not_plan", "What downloaded is not a takeoff project file.");
    }
    // Whole: still the version OneDrive holds? The link serves the file as it is NOW, so a save in OneDrive during a
    // long download would leave a mix of two versions. Not sure (no connection): it stays a finished part, checked on
    // the next try (no bytes fetched again).
    let after;
    try {
      after = await onedrive.planLink(r.projectId, r.itemId);
    } catch (x) {
      if (x && x.code === "not_found") {
        await markGone(key);
        throw err("gone", "This file is no longer in OneDrive.");
      }
      await mutate("plans", key, (c) => (c && c.dl ? Object.assign({}, c, { dl: Object.assign({}, c.dl, { state: "paused", done: w.size,
        error: "Downloaded — checked against OneDrive when the portal is next online." }) }) : undefined));
      throw err("paused", "Downloaded; it is checked against OneDrive when the portal is next online.", { moved: true });
    }
    if (after.version !== ver.version || Number(after.size) !== w.size) {
      await removeFile(dl.file);
      await mutate("plans", key, (c) => (c ? Object.assign({}, c, { dl: null }) : undefined));
      // the person's own Save or Update tries once more at once; an automatic one waits (a file saved again and again in
      // OneDrive would otherwise be downloaded and thrown away all day)
      if (attempt === 0 && !auto) continue;
      await mutate("plans", key, (c) => (c ? Object.assign({}, c, { dl: { file: "", done: 0, size: 0, version: "", state: "paused", userPaused: false,
        error: "The file kept changing in OneDrive while it downloaded — it tries again later." } }) : undefined));
      throw err("changed", "The file kept changing in OneDrive while it downloaded. It tries again later.");
    }
    let old = "";
    const committed = await mutate("plans", key, function (c) {
      if (!c) return undefined;
      old = c.file;
      return Object.assign({}, c, { file: dl.file, name: ver.name || c.name, folder: ver.folder || c.folder, size: ver.size,
        modified: ver.modified, version: ver.version, savedAt: nowIso(), dl: null, fails: 0, retryAt: null, failCode: null,
        latest: Object.assign({ status: "ok", checkedAt: nowIso() }, ver) });
    });
    if (!committed) { await removeFile(dl.file); return { removed: true }; }
    metaPut("autoHold:" + r.owner, null).catch(function () {});
    if (old && old !== dl.file) await retire(old);
    changed(key);
    return { saved: true };
  }
  throw err("changed", "The file kept changing in OneDrive while it downloaded. Try again in a minute.");
}

function runWorker(r, dl, url) {
  return new Promise(function (resolve, reject) {
    const key = r.key;
    const w = new Worker(new URL("./plan-library-worker.js", import.meta.url));
    const j = jobs[key] = Object.assign(jobs[key] || {}, { worker: w, done: dl.done || 0, size: dl.size, rate: 0,
      changed: false, finished: false });
    let lastSave = 0, lastT = Date.now(), lastD = j.done, lastMsg = Date.now();
    // A worker that goes silent (it posts at least every 10 seconds) is ended and the download treated as a pause.
    const dog = setInterval(function () {
      if (j.finished || Date.now() - lastMsg < 90000) return;
      end();
      reject(Object.assign(new Error("The download stopped responding."), { status: 0, done: j.done }));
    }, 10000);
    function end() { j.finished = true; clearInterval(dog); try { w.terminate(); } catch (x) { /* gone */ } }
    w.onmessage = async function (ev) {
      const m = ev.data || {};
      lastMsg = Date.now();
      if (j.finished) return;
      if (m.type === "progress") {
        const now = Date.now();
        if (now - lastT >= 1000) { j.rate = Math.max(0, (m.done - lastD) / ((now - lastT) / 1000)); lastT = now; lastD = m.done; }
        j.done = m.done;
        if (now - lastSave > 2000) {
          lastSave = now;
          // only this download's own count, in one transaction (never an older copy of the whole record)
          mutate("plans", key, function (c) {
            if (j.finished || !c || !c.dl || c.dl.file !== dl.file) return undefined;
            return Object.assign({}, c, { dl: Object.assign({}, c.dl, { done: m.done }) });
          }).catch(function () {});
        }
        progress(key);
      } else if (m.type === "need-url") {
        try {
          const l = await onedrive.planLink(r.projectId, r.itemId);
          if (l.version !== dl.version) { j.changed = true; w.postMessage({ op: "url", url: "" }); }
          else w.postMessage({ op: "url", url: l.url });
        } catch (x) { w.postMessage({ op: "url", url: "" }); }
      } else if (m.type === "done") {
        end(); j.done = m.size; resolve({ done: true, size: m.size, magic: m.magic });
      } else if (m.type === "cancelled") {
        end(); j.done = m.done; resolve({ paused: true, done: m.done });
      } else if (m.type === "error") {
        end();
        reject(Object.assign(new Error(m.message), { status: m.status, done: m.done, changed: j.changed }));
      }
    };
    w.onerror = function (ev) {
      if (j.finished) return;
      end();
      reject(Object.assign(new Error("The download stopped (" + ((ev && ev.message) || "the worker failed") + ")."), { done: null }));
    };
    // `fresh`: a part named just now (start from the first byte); otherwise the part's own length says where to go on
    w.postMessage({ op: "start", id: key, file: dl.file, url, size: dl.size, fresh: !!dl.fresh && !(dl.done > 0) });
    // a Pause that came while the download was starting (here, or from another window) is passed on now
    if (j.cancelRequested) w.postMessage({ op: "cancel", id: key });
  });
}

/** Pause a download (here, or in the window that runs it): what is written stays, Resume carries on from there. */
export function pause(itemIdOrKey, isKey) {
  const key = isKey ? itemIdOrKey : keyOf(itemIdOrKey);
  const j = jobs[key];
  if (j) {
    j.cancelRequested = true;
    if (j.worker && !j.finished) j.worker.postMessage({ op: "cancel", id: key });
    return true;
  }
  if (channel) try { channel.postMessage({ t: "pause", key }); } catch (e) { /* closed */ }
  return false;
}

function downloadReleased(key, ms) {
  if (!(navigator.locks && navigator.locks.request)) return Promise.resolve();
  return new Promise(function (resolve) {
    const t = setTimeout(resolve, ms);
    navigator.locks.request(LOCK + key, function () { clearTimeout(t); resolve(); }).catch(function () { clearTimeout(t); resolve(); });
  });
}

/** Remove a saved plan from this device (its copy goes now, or after the grace when it was handed to the app lately). */
export async function remove(itemId, opts) {
  const key = keyOf(itemId, opts && opts.owner);
  pause(key, true);
  if (jobs[key] && jobs[key].promise) {
    try { await jobs[key].promise; } catch (e) { /* it stopped; that is all that was wanted */ }
  }
  await downloadReleased(key, 15000);
  const r = await get("plans", key);
  if (!r) return;
  await del("plans", key);
  if (r.dl && r.dl.file && r.dl.file !== r.file) await removeFile(r.dl.file);
  if (r.file) {
    if (opts && opts.now) await removeFile(r.file); else await retire(r.file);
  }
  noteOwner(r.owner, (await getAll("plans")).some((x) => x.owner === r.owner) || (await hasCopies(r.owner)));
  changed(key);
}

/** Everything this person saved on this device goes, at once (Sees prices taken away: plan files carry prices). */
export async function purgeOwner(who) {
  if (!who || !supported()) return 0;
  const mine = (await getAll("plans")).filter((r) => r.owner === who);
  for (const r of mine) await remove(r.itemId, { owner: who, now: true });
  // and the older copies of theirs still kept for the takeoff app (no record points at them): every name is theirs by
  // its first part (map/plan-library.js fileNameFor)
  const mark = "p" + hashOf(who) + "-";
  const d = await dir();
  const names = [];
  for await (const name of d.keys()) names.push(name);
  for (const n of names) if (n.indexOf(mark) === 0) await removeFile(n);
  await mutate("meta", "handed", function (cur) {
    const handed = Object.assign({}, cur ? cur.value : {});
    Object.keys(handed).forEach(function (n) { if (n.indexOf(mark) === 0) delete handed[n]; });
    return { key: "handed", value: handed };
  });
  // a file still open in a writer (a download in a tab the browser froze) stays: the next online page tries again
  noteOwner(who, await hasCopies(who));
  return mine.length;
}

/* ── housekeeping ──────────────────────────────────────────────────────── */

/** Files nobody points at any more: an old version after an update, a part left by a closed window, a copy whose
    record was removed elsewhere - except a copy handed to the takeoff app within the grace. Never while a download runs
    (here or in another window): its new part may not be in a record yet. */
export async function sweep() {
  if (!supported()) return;
  const held = await heldLocks();
  if ((held && Object.keys(held).length) || Object.keys(jobs).length) return;
  const all = await getAll("plans");
  const handed = await mutate("meta", "handed", (cur) => ({ key: "handed", value: pruneHanded(cur ? cur.value : {}, Date.now()) }));
  const keep = keepSet(all, handed ? handed.value : {}, Date.now());
  const d = await dir();
  const names = [];
  for await (const name of d.keys()) names.push(name);
  for (const n of names) if (FILE_RE.test(n) && !keep.has(n)) await removeFile(n);
}

/** A saved copy the browser has lost (storage cleared under it, a broken write): the record says so, and the
    download starts again by itself (needsWork). */
export async function verifyFiles() {
  const who = owner();
  if (!who || !supported()) return;
  for (const r of (await getAll("plans")).filter((x) => x.owner === who && x.file)) {
    if (jobs[r.key]) continue;
    if (!(await fileOk(r.file, r.size))) {
      const cur = await mutate("plans", r.key, (c) => (c && c.file === r.file ? Object.assign({}, c, { file: "", version: "", savedAt: "" }) : undefined));
      if (cur && !cur.file) changed(r.key);
    }
  }
}

/* ── new versions ──────────────────────────────────────────────────────── */

/** Ask OneDrive for the version of every saved plan of this person -> {checked, updates, gone, denied, revoked}. A
    refusal of plans_list itself (Sees prices taken away) removes this person's plans from the device. */
export async function checkUpdates() {
  const who = owner();
  if (!who) throw err("signin", "Sign in first.");
  if (HAS && navigator.onLine === false) throw err("offline", "You're offline — new versions are checked when you're back online.");
  const mine = (await getAll("plans")).filter((r) => r.owner === who);
  const sum = { checked: 0, updates: 0, gone: 0, denied: 0, revoked: 0 };
  const at = nowIso();
  for (const ids of projectBatches(mine, onedrive.LIST_BATCH)) {
    let answer;
    try {
      answer = await onedrive.plansList(ids);
    } catch (x) {
      if (x && x.code === "forbidden" && x.info && x.info.error === "forbidden") {
        sum.revoked = await purgeOwner(who);
        return sum;
      }
      throw x;
    }
    for (const r of mine.filter((m) => ids.indexOf(Number(m.projectId)) !== -1)) {
      // only what a check knows (latest, and the waits of a new version): never an older copy of the whole record
      const next = await mutate("plans", r.key, function (c) {
        if (!c) return undefined;
        const a = applyCheck(c, answer[String(c.projectId)] || null, at);
        return Object.assign({}, c, { latest: a.latest, fails: a.fails !== undefined ? a.fails : c.fails, retryAt: a.retryAt !== undefined ? a.retryAt : c.retryAt });
      });
      if (!next) continue;
      sum.checked++;
      const st = next.latest ? next.latest.status : "";          // null: a first download not finished, nothing known
      if (st === "gone") sum.gone++;
      else if (st === "denied") sum.denied++;
      else if (next.file && next.latest && next.latest.version !== next.version) sum.updates++;
      changed(r.key);
    }
  }
  await metaPut("check:" + who, at);
  await metaPut("checkHold:" + who, null);                  // a check that worked ends a check hold
  return sum;
}

/** A hold after a failure: 5 min, doubling while it keeps failing (a hold that ran out within the hour), up to 6 h. */
async function growHold(name, retryAfterS) {
  const prev = await metaGet(name, null);
  const now = Date.now();
  const n = prev && prev.n && now - (Number(prev.until) || 0) < 3600 * 1000 ? prev.n + 1 : 1;
  await metaPut(name, { until: now + Math.max(backoffMs(n), (Number(retryAfterS) || 0) * 1000), n });
}

/** The person's own "Check now" worked: the automatic downloads go on at once too. */
export async function clearHolds() {
  const who = owner();
  if (!who) return;
  await metaPut("autoHold:" + who, null);
  await metaPut("checkHold:" + who, null);
}

let working = null;
/** The saved plans that need it download again, one at a time (a phone is not asked for three big files at once); a
    OneDrive-wide failure stops them all for a while (meta "autoHold:<owner>"). */
export function autoWork() {
  if (working) return working;
  working = (async function () {
    const who = owner();
    if (!who) return;
    const hold = await metaGet("autoHold:" + who, null);
    if (hold && holding(hold.until, Date.now(), RETRY_CAP_MS)) return;
    const held = (await heldLocks()) || {};
    const todo = (await getAll("plans")).filter((r) => r.owner === who && dueForWork(r, Date.now()) && !jobs[r.key] && !held[r.key])
      .sort((a, b) => (Number(a.fails) || 0) - (Number(b.fails) || 0));     // the ones that failed least go first
    for (const r of todo) {
      if (HAS && navigator.onLine === false) return;
      const cur = await get("plans", r.key);                   // as it is now: paused or removed in another window?
      if (!cur || !dueForWork(cur, Date.now())) continue;
      try { await download(r.key); } catch (x) {
        const code = x && x.code;
        if (code === "offline") return;
        if (brokerWide(code)) {
          await growHold("autoHold:" + who, x && x.retryAfter);
          return;
        }
        // no room, no storage, or the connection dropped (most likely for the next file too): the next page goes on
        if (code === "unsupported" || code === "space" || code === "paused") return;
      }
    }
  })().finally(function () { working = null; });
  return working;
}

/** On a portal page, for a person who sees prices, online, with plans saved: ask for new versions when the last check
    is CHECK_EVERY_MS old, then (opts.download !== false) download what needs it - quietly (a failure waits for the next
    page). For a person who no longer sees prices, on a page that read their profile online (opts.fresh), the plans
    they saved here go. */
export async function maybeCheck(me, opts) {
  const o = opts || {};
  try {
    if (!supported() || (HAS && navigator.onLine === false)) return;
    const who = owner();
    if (!who || (me && me.id && me.id !== who)) return;
    if (!planFilesFor(me)) {
      if (o.fresh && ownersHere().indexOf(who) !== -1) await purgeOwner(who);
      return;
    }
    const mine = (await getAll("plans")).filter((r) => r.owner === who);
    if (!mine.length) {
      // copies kept for the takeoff app after a Remove go at a sweep once their week is over
      await sweep();
      noteOwner(who, await hasCopies(who));
      return;
    }
    noteOwner(who, true);                                    // the hint mends itself
    await verifyFiles();
    const ch = await metaGet("checkHold:" + who, null);
    if (o.force || (dueForCheck(await lastChecked(), Date.now()) && !(ch && holding(ch.until, Date.now(), RETRY_CAP_MS)))) {
      try {
        await checkUpdates();
      } catch (e) {
        if (!(e && e.code === "offline")) await growHold("checkHold:" + who, e && e.retryAfter);
      }
    }
    if (o.download !== false && !iosHomeScreen()) await autoWork();
    await sweep();
  } catch (e) { /* the next page asks again */ }
}

/* ── opening in the takeoff app ────────────────────────────────────────── */

/** "The takeoff app opened on this device" - only once it said it keeps itself for offline use. */
function noteReady() {
  try { localStorage.setItem(READY_KEY, nowIso()); } catch (e) { /* a note only */ }
  emit({ t: "ready" });                                     // other windows hear it through the storage event
}

/** Open a saved copy in the takeoff app (new tab). Call IN the click. onDone({ok, why, error}). */
export function open(itemId, onDone) {
  const key = keyOf(itemId);
  openInTakeoff(async function () {
    // marked as handed over first, then read again: a new version committed in between (here or in another window)
    // would otherwise retire the very file being handed over
    let r = null;
    for (let i = 0; i < 2 && !r; i++) {
      const cur = await get("plans", key);
      if (!cur || !cur.file) throw err("missing", "This plan has not finished downloading on this device yet.");
      await markHanded(cur.file);
      const again = await get("plans", key);
      if (again && again.file === cur.file) r = again;
    }
    if (!r) throw err("missing", "This plan was just updated on this device. Tap Open again.");
    const f = await fileOf(r.file);
    if (!f) throw err("missing", "This saved plan is no longer on this device. Save it again from 📐 while online.");
    if (Number(r.size) > 0 && f.size !== Number(r.size)) throw err("missing", "This saved plan did not finish downloading. It carries on while the portal is open and online.");
    const t = Date.parse(r.modified || "");
    return { kind: "file", file: f, name: r.name, size: f.size, lastModified: isFinite(t) ? t : f.lastModified, number: r.number,
      updateAvailable: statusOf(r, null, false) === "outdated" };
  }, null, onDone, noteReady);
}

/** Open a plan in OneDrive in the takeoff app over byte ranges (online; nothing saved). Call IN the click. A fresh link
    is handed only for the version first opened: a file saved again in OneDrive meanwhile is not read on as if it were
    the same (the tab says to open it again). */
export function openOnline(projectId, number, file, onDone) {
  let version = null;
  let stale = false;                        // saved again in OneDrive since it was opened: no fresh link will match
  openInTakeoff(async function () {
    const l = await onedrive.planLink(projectId, file.id);
    if (!(Number(l.size) > 0)) throw err("no_size", "OneDrive did not say how big this file is.");
    version = l.version;
    const t = Date.parse(l.modified || "");
    return { kind: "link", url: l.url, name: l.name, size: Number(l.size), lastModified: isFinite(t) ? t : 0, number: String(number || "") };
  }, async function () {
    if (stale) return "";
    const l = await onedrive.planLink(projectId, file.id);
    if (version && l.version === version) return l.url;
    stale = true;                           // (a busy or failed ask throws instead: the next sheet may ask again)
    return "";
  }, onDone, noteReady);
}
