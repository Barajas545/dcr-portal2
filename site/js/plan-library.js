/* DCR Portal 2 — the Plans Library: .takeoff plan files kept on THIS device (owner 2026-10-26: the old portal's job,
   brought to Portal 2).

   A person who sees prices (an admin, or Sees prices: plan files carry prices; map/plans.js planFilesFor) saves a
   project's plan files from 📐 so they open in the takeoff app with no internet - a site trailer, a house with no roof
   yet. Each saved copy is exactly one version of one OneDrive file in the owner's takeoff folder; when OneDrive holds a
   newer one, it downloads BY ITSELF while a portal page is open and online (maybeCheck: the Plans Library, Search, a
   project; the home page only asks for new versions), and the saved copy keeps opening until the new one is whole and
   checked. The takeoff app never writes into a saved copy: its Save goes to Save As or a download - or, in the portal's
   frame, back here as a NEW file of its own (the save back, below).

   Where things live (per browser profile, this site only):
     · the files - the Origin Private File System, folder "plan-library", one file per download (map/plan-library.js
       fileNameFor: never the same name twice), written by js/plan-library-worker.js in byte ranges, resumable;
     · what is known about them - IndexedDB "dcr2-plan-library": plans (one record per person per file, key
       "<owner>|<item id>") and meta (when updates were last checked, the automatic downloads' hold after a OneDrive-wide
       failure, the copies handed to the takeoff app lately);
     · localStorage "dcr2-plan-owners": only the user ids that have plans saved here (no file, name or link), so a page
       can tell, without opening the library, that a person whose Sees prices was taken away still has plans to remove;
       and "dcr2-plan-owner-mail": {a short hash of the sign-in e-mail: that id}, so a sign-in refused for a turned-off
       account (Desktop 2 blocks it: no profile is ever read) still finds whose plans to remove.
   Records belong to the person who saved them (the sign-in's user id, read without the network: sb.js storedUserId). A
   shared tablet shows each person only their own plans. Someone whose Sees prices is turned off loses theirs from the
   device the next time an online portal page sees it (purgeOwner).

   Opening hands the copy to the takeoff app window to window (js/plan-handoff.js): on a computer in a new tab (the app is
   another site), on a phone or a tablet in the portal's own copy of the app in a frame over the page (js/plan-frame.js;
   owner decision Q4, 2026-11-04 - the home-screen app included, since the frame shares this storage). Either way the
   app reads the File by slices as it draws, and nothing there holds the copy open. So a copy handed to a computer's tab
   is kept a week after it is replaced or removed (map/plan-library.js HANDED_GRACE_MS) and goes at a sweep after that;
   one handed to the frame is held while the frame is open and goes once it closes, when nothing names it any more
   (holdForFrame: the frame is followed exactly, so a plan-sized copy is never left for a week). On a phone or a
   tablet a plan always opens from a copy on the device (openOnDevice): it is saved here first when it is not, or is not
   the version OneDrive holds - and only when there is no room (or no way to keep it) does it open online.

   The automatic downloads are polite: after a failure a record waits 5 min, then 10, 20, … up to 6 h before it is tried
   again by itself (a person's own Save, Resume or Update now never waits; a download that went forward before it
   stopped does not wait longer), the records that failed least go first, and a OneDrive-wide failure (busy, not allowed
   in) stops them all for a while, longer each time. No answer at all while the browser says it is online (a hotspot
   with no internet, a broker the browser cannot read) pauses them 5 minutes; with the browser offline nothing waits
   (coming online tries again). A person's own "Check now" ends the OneDrive-wide waits. Every download is checked
   against OneDrive's version once it is whole: a file saved again in OneDrive during it is downloaded again, never kept
   as a mix of two versions.

   The bytes come straight from OneDrive (the broker's plan_link: a pre-authenticated link, kept in memory only);
   nothing goes through the broker. Nothing here is a page: the pages draw what list() and onChange() say.

   And back (owner decisions Q1-Q3, 2026-11-04; contract C3 "Save-back", behind map/plans.js PLAN_SAVE_BACK): a Save in
   the frame's takeoff app is kept on this device first (keepSave: the worker copies it into a new file, a record's
   `local`), opens from there from then on, and is sent to OneDrive in place of the plan (sendSaved; or, when someone
   saved the plan in the office meanwhile, as a separate file beside it) - see "the save back" below. */

import * as onedrive from "./repo/onedrive.js";
import { storedUserId, storedUserEmail } from "./sb.js";
import {
  DIR, MAGIC, FILE_RE, RETRY_CAP_MS, fileNameFor, statusOf, applyCheck, dueForCheck, needsWork, dueForWork, withFailure, backoffMs,
  brokerWide, holding, keepSet, pruneHanded, projectBatches, fmtSize, hashOf, inSubFolder, deviceOpenStep, afterFetch,
  hasLocal, baseOk, withSave, dueToSend, adoptSent, keptAs, saveStateOf, copyTold, MAX_SENDS, saveBase, recordOfLine, handedTime, hashedBase,
  purgeText, lostSave, onlineNote, hashOk, sendWaitMs, refusedTold, saveBackOffWords,
} from "./map/plan-library.js";
import { planFilesFor, PLAN_SAVE_BACK, saveBackFor, deviceWord, whoWord } from "./map/plans.js";
import { openInTakeoff, iosHomeRefused, usesFrame, READY_KEY, IOS_HOME } from "./plan-handoff.js";
import { say as frameSay, guard as frameGuard, isOpen as frameIsOpen } from "./plan-frame.js";
import { createUploader, xhrTransport } from "./onedrive-upload.js";
import { purgeTakeoffStores, noteTakeoffUser, takeoffUsers, standaloneStores, purgeOutcome } from "./takeoff-stores.js";

const DB_NAME = "dcr2-plan-library";
const DB_VER = 1;
const LOCK = "dcr2-plan-dl:";
// a save being kept (spooled), and one being sent to OneDrive: one window at a time per plan
const SPOOL_LOCK = "dcr2-plan-sp:";
const SEND_LOCK = "dcr2-plan-up:";
// a copy the takeoff app in a frame has open (it reads unviewed sheets from it for as long as it is open): held by the
// window that shows the frame, "<file>|<a word of that opening>", until the frame closes - no window removes it meanwhile
const READ_LOCK = "dcr2-plan-rd:";
const OWNERS_KEY = "dcr2-plan-owners";
const MAIL_KEY = "dcr2-plan-owner-mail";
const SPACE_MARGIN = 64 * 1024 * 1024;         // never fill the last bit of the quota
// After a OneDrive-wide failure the automatic downloads stop, and after a failed version check the checks stop: 5 min,
// doubling while it keeps failing, up to 6 h (map/plan-library.js backoffMs); {until, n} in meta. No answer at all
// while the browser says it is online: a flat FLAT_HOLD_MS.
const FLAT_HOLD_MS = 5 * 60 * 1000;
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
    mendMail(who, has);
  } catch (e) { /* a hint only */ }
}
/** The e-mail hint (MAIL_KEY): `who`'s own written again when `mine` (this sign-in's e-mail), and every entry kept only
    while its id is an owner here OR opened the takeoff app here (js/takeoff-stores.js takeoffUsers: its drafts carry
    prices too - review PRICE-3). A person's hint goes only when they are on neither list (a purge cut short keeps
    them, so their next refused sign-in finds them again), or when a fresh e-mail of theirs replaces it. */
function mendMail(who, mine) {
  try {
    let mail = {};
    try { mail = JSON.parse(localStorage.getItem(MAIL_KEY) || "{}") || {}; } catch (e) { mail = {}; }
    const keep = ownersHere().concat(takeoffUsers());
    const email = mine && who === storedUserId() ? String(storedUserEmail() || "").trim().toLowerCase() : "";
    Object.keys(mail).forEach(function (k) { if (keep.indexOf(mail[k]) === -1 || (email && mail[k] === who)) delete mail[k]; });
    if (email) mail[hashOf(email)] = who;
    if (Object.keys(mail).length) localStorage.setItem(MAIL_KEY, JSON.stringify(mail)); else localStorage.removeItem(MAIL_KEY);
  } catch (e) { /* a hint only */ }
}
/** This person opened the takeoff app in the frame here: on the takeoff app's list, with the e-mail hint a sign-in
    refused for a turned-off account finds them by (sb.js planOwnerFor) - so their drafts go too. */
function noteFrameUser(who) {
  if (!who) return;
  noteTakeoffUser(who);
  mendMail(who, true);
}
/** This person left a trace on this device: plans saved here, or the takeoff app opened in the frame here - the only
    people a purge on lost prices is for (a page that reads a profile online asks this before it purges). */
export function tracesHere(who) {
  return !!who && (ownersHere().indexOf(who) !== -1 || takeoffUsers().indexOf(who) !== -1);
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
/** A library file as the storage answers now (review LW-2): {state: "ok", file}; "missing" - not there (NotFoundError)
    or not the `size` it should be; "unknown" - the storage did not answer (WebKit's passing UnknownError, an
    InvalidStateError after the page slept): nothing may be decided on that, it is asked again later. */
async function fileState(name, size) {
  if (!FILE_RE.test(String(name || ""))) return { state: "missing" };
  let f;
  try { f = await (await (await dir()).getFileHandle(name)).getFile(); } catch (e) {
    return { state: e && e.name === "NotFoundError" ? "missing" : "unknown" };
  }
  if (Number(size) > 0 && f.size !== Number(size)) return { state: "missing", file: f };
  return { state: "ok", file: f };
}
async function fileOk(name, size) {
  return (await fileState(name, size)).state === "ok";
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
/** An old version or a removed copy: gone now - or, handed to a computer's takeoff tab lately, kept a week from now
    (the replace or the remove; up to a week of an old copy per plan opened) and gone at a sweep after that. A takeoff
    tab still open on it longer than the week loses it (its save check then keeps the work as a draft). One a frame's
    takeoff app has open NOW is never removed while it is (framesReading: however long the frame stays open) - and
    needs no week after: its frame's close frees it (holdForFrame; review STORE-1). */
async function retire(name) {
  if (!name) return;
  if ((await framesReading()).has(name)) return;
  if (await handedLately(name)) await markHanded(name);
  else await removeFile(name);
}

const readingHere = new Map();      // file name -> how many frames of this window have it open
/** The library files a takeoff app in a frame has open now: this window's, and other windows' (their Web Locks).
    `but`: a lock word of this window's not to count (one just let go). */
async function framesReading(but) {
  const out = new Set(readingHere.keys());
  const held = await heldLocks(READ_LOCK);
  Object.keys(held || {}).forEach(function (k) { const i = k.lastIndexOf("|"); if (k.slice(i + 1) !== but) out.add(k.slice(0, i)); });
  return out;
}
/** The frame's takeoff app reads `name` until `closed` settles (the frame closed): held so meanwhile (open(); a test's
    too) - here by a count, for other windows by a Web Lock. -> let go of it now (the hand-over did not happen after all).
    Let go, and read by no frame any more: the file goes at once when no record names it - the reader on this route is
    known exactly, so no week's grace (that is for a computer's tab, which cannot be followed; review STORE-1). */
export function holdForFrame(name, closed) {
  if (!FILE_RE.test(String(name || ""))) return function () {};
  readingHere.set(name, (readingHere.get(name) || 0) + 1);
  const word = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  let free = function () {}, after = null;
  const done = new Promise(function (r) { free = r; });
  // -> once what follows the let-go is done (a test waits on it)
  const let_go = function () {
    if (after) return after;
    const n = (readingHere.get(name) || 1) - 1;
    if (n > 0) readingHere.set(name, n); else readingHere.delete(name);
    free();
    after = n <= 0 ? afterFrame(name, word).catch(function () { /* a sweep takes it */ }) : Promise.resolve();
    return after;
  };
  if (closed && typeof closed.then === "function") closed.then(let_go, let_go);
  if (HAS && navigator.locks && navigator.locks.request) {
    navigator.locks.request(READ_LOCK + name + "|" + word, function () { return done; })
      .catch(function () { /* this window's own count still holds it */ });
  }
  return let_go;
}
/** A file a frame had open, once no frame reads it: gone when no record names it, its "handed" note dropped either way
    (a retire or a sweep then needs no week for it). Kept while a save is being kept here (the app's save is slices of
    the file it was handed: the spool may still read it after the frame closed) - a later sweep takes it then. */
async function afterFrame(name, word) {
  if (readingHere.has(name) || spooling) return;
  if ((await framesReading(word)).has(name)) return;
  await mutate("meta", "handed", function (cur) {
    if (!cur || !cur.value || !Object.prototype.hasOwnProperty.call(cur.value, name)) return undefined;
    const v = Object.assign({}, cur.value);
    delete v[name];
    return { key: "handed", value: v };
  });
  if (keepSet(await getAll("plans"), {}, Date.now()).has(name)) return;
  if (readingHere.has(name) || spooling) return;
  await removeFile(name);
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
    } else if (m.t === "send") {
      remoteSend[m.key] = { sent: m.sent, size: m.size, at: Date.now() };
      emit(m);
    } else if (m.t === "pause" && jobs[m.key]) {
      pause(m.key, true);
    }
  };
}

/** fn({t: "changed" | "progress" | "send", key, done?, size?, rate?, sent?}) on every change here or in another window
    ("send": a save on its way to OneDrive, `sent` of `size`); -> unsubscribe. */
export function onChange(fn) {
  listeners.push(fn);
  return function () { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
}

/** The record keys whose lock `prefix` (a download's by default) is held in any window, or null (no Web Locks here). */
async function heldLocks(prefix) {
  const p = prefix || LOCK;
  if (!(HAS && navigator.locks && navigator.locks.query)) return null;
  try {
    const s = await navigator.locks.query();
    const held = {};
    (s.held || []).forEach(function (l) { if (l.name && l.name.indexOf(p) === 0) held[l.name.slice(p.length)] = true; });
    return held;
  } catch (e) { return null; }
}

/* ── reading ───────────────────────────────────────────────────────────── */

/** This person's saved plans, each with {status, job: {done, size, rate} | null}, by project number. */
export async function list() {
  const who = owner();
  if (!who || !supported()) return [];
  const held = await heldLocks();
  const up = await heldLocks(SEND_LOCK);
  const now = Date.now();
  // a copy saved from a project's sub-folder (a Backup's) is no plan of it: never shown (maybeCheck takes it off once a
  // check says OneDrive no longer lists it; one moved up into the project's folder meanwhile shows again)
  const all = (await getAll("plans")).filter((r) => r.owner === who && !inSubFolder(r.folder));
  return all.map(function (r) {
    const here = jobs[r.key];
    const there = remote[r.key] && now - remote[r.key].at < 30000 ? remote[r.key] : null;
    const running = !!(held ? held[r.key] : there);
    const job = here && here.worker ? { done: here.done, size: here.size, rate: here.rate } : running && there ? there : null;
    // the person's own save: being sent here, or in another window (its lock; its last word of progress)
    const mine = sending[r.key] ? { sent: sending[r.key].sent, size: sending[r.key].size } : null;
    const far = !mine && (up ? !!up[r.key] : !!(remoteSend[r.key] && now - remoteSend[r.key].at < 30000));
    const farLive = far && remoteSend[r.key] && now - remoteSend[r.key].at < 30000 ? remoteSend[r.key] : null;
    return Object.assign({}, r, { status: statusOf(r, here && here.worker && !here.finished ? here : null, running), job,
      save: saveStateOf(r, mine || farLive, now, far) });
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
    bytes: mine.reduce((n, r) => n + (r.file ? Number(r.size) || 0 : 0) + (hasLocal(r) ? Number(r.local.size) || 0 : 0), 0) };
}

export async function lastChecked() {
  const who = owner();
  return who ? metaGet("check:" + who, null) : null;
}

/* ── saving and downloading ────────────────────────────────────────────── */

/** Save one plan file of a project on this device: {projectId, number, projectTitle, file: {id, name, folder, size,
    modified, version}}. Resolves when the download ends (or pauses); the rows follow it through onChange. */
export async function save(info) {
  if (iosHomeRefused()) throw err("ios_home", IOS_HOME);         // (the frame, js/plan-frame.js, shares this storage: no refusal)
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
    // saved again: the person's own act - carry on now, from a fresh link (in the folder OneDrive lists it in now)
    const out = Object.assign({}, r, { projectTitle: String(info.projectTitle || r.projectTitle || ""), fails: 0, retryAt: null, failCode: null,
      wide: false, folder: f.folder || r.folder });
    if (out.dl) out.dl = Object.assign({}, out.dl, { userPaused: false, state: out.dl.state === "error" ? "paused" : out.dl.state });
    return out;
  });
  noteOwner(who, true);
  changed(key);
  return download(key, { manual: true });
}

/** Download a saved plan again now (a newer version, a paused or stopped download): the person's own act. */
export async function resume(itemId) {
  if (iosHomeRefused()) throw err("ios_home", IOS_HOME);         // (the frame, js/plan-frame.js, shares this storage: no refusal)
  const key = keyOf(itemId);
  await mutate("plans", key, function (r) {
    if (!r) return undefined;
    const out = Object.assign({}, r, { fails: 0, retryAt: null, failCode: null, wide: false });
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
        out.fails = 0; out.retryAt = null; out.failCode = null; out.wide = false;
      } else if (code !== "offline" && code !== "unsupported") {
        out = withFailure(out, Date.now());
        // a OneDrive-wide failure waits too (and goes behind the others) - "Check now" ends that wait (clearHolds) - but
        // it is no reason of the file's own: the file's last one (say "it keeps changing") stays
        out.wide = brokerWide(code);
        if (!out.wide) out.failCode = code;
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

/** The broker's latest word on a save back of this record's project (plans_list's / plan_link's save_back, contract
    addendum 3 D1) kept on the record as `saveBack` - written only when it changed. */
function noteSaveBack(key, on) {
  return mutate("plans", key, (c) => (c && (c.saveBack === true) !== on ? Object.assign({}, c, { saveBack: on }) : undefined));
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
    // the person's own save waits here (kept, being sent, not sent): nothing is downloaded over it, whatever OneDrive
    // holds - it opens as it is, and the send settles what the plan becomes
    if (hasLocal(r)) return { local: true };
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
    // whether the broker takes a save of this project's plans from this person now (its save_back): the record keeps the
    // latest answer - what the frame offers from (open(); offline, the last one known)
    await noteSaveBack(key, link.saveBack === true);
    // asking for the link took a moment: work on the record as it is now (another window may have removed it)
    r = await get("plans", key);
    if (!r) throw err("removed", "That saved plan was removed.");
    const ver = { version: link.version, size: Number(link.size) || 0, modified: link.modified, name: link.name, folder: link.folder };
    if (r.file && (r.version === ver.version || keptAs(r, ver)) && (await fileOk(r.file, r.size))) {
      // already the version OneDrive holds, and really on the device: nothing to fetch (a save of this device's that
      // OneDrive now reports under its own hash: the version is taken, as the next check would)
      const part = r.dl && r.dl.file && r.dl.file !== r.file ? r.dl.file : "";
      await mutate("plans", key, (c) => (c ? Object.assign({}, c, { latest: Object.assign({ status: "ok", checkedAt: nowIso() }, ver),
        version: keptAs(c, ver) ? ver.version : c.version, expect: keptAs(c, ver) ? null : c.expect || null,
        dl: null, fails: 0, retryAt: null, failCode: null, wide: false }) : undefined));
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
        modified: ver.modified, version: ver.version, savedAt: nowIso(), dl: null, fails: 0, retryAt: null, failCode: null, wide: false,
        expect: null, latest: Object.assign({ status: "ok", checkedAt: nowIso() }, ver) });
    });
    if (!committed) { await removeFile(dl.file); return { removed: true }; }
    metaPut("autoHold:" + r.owner, null).catch(function () {});
    if (old && old !== dl.file) await retire(old);
    changed(key);
    return { saved: true };
  }
  throw err("changed", "The file kept changing in OneDrive while it downloaded. Try again in a minute.");
}

/** The watchdogs over a worker (a download, a save being kept): looked at every `tick` ms; `stall` ms of the page's own
    time in front with no word that counts is the end. (A test shortens them.) */
export const WATCH = { tick: 10000, stall: 90000 };
/**
 * A watchdog: onStall() once WATCH.stall passes with no moved() - never counting time the page was hidden, or asleep
 * (iOS suspends a page in the background, the frame and its workers with it: on its return the overdue timer would
 * otherwise run before the worker can say a word; review SPOOL-1). Asleep: a look far later than its tick (a page back
 * in front runs its overdue timer first). -> {moved(), stop()}.
 */
function watchdog(onStall) {
  const hidden = function () { return typeof document !== "undefined" && !!document && document.visibilityState === "hidden"; };
  let last = Date.now(), look = last, over = false;
  const t = setInterval(function () {
    const now = Date.now();
    if (hidden() || now - look > WATCH.tick * 3) last = now;          // hidden, or the page was asleep: not counted
    look = now;
    if (!over && now - last > WATCH.stall) { over = true; onStall(); }
  }, WATCH.tick);
  return {
    moved: function () { last = Date.now(); },
    stop: function () { over = true; clearInterval(t); },
  };
}

function runWorker(r, dl, url) {
  return new Promise(function (resolve, reject) {
    const key = r.key;
    const w = new Worker(new URL("./plan-library-worker.js", import.meta.url));
    const j = jobs[key] = Object.assign(jobs[key] || {}, { worker: w, done: dl.done || 0, size: dl.size, rate: 0,
      changed: false, finished: false });
    let lastSave = 0, lastT = Date.now(), lastD = j.done;
    // A worker that goes silent (it posts at least every 10 seconds, waiting on OneDrive too) for WATCH.stall of the
    // page's own time in front (watchdog: never the time the page was hidden or asleep - review SPOOL-1) is ended and
    // the download treated as a pause.
    const dog = watchdog(function () {
      if (j.finished) return;
      end();
      reject(Object.assign(new Error("The download stopped responding."), { status: 0, done: j.done }));
    });
    function end() { j.finished = true; dog.stop(); try { w.terminate(); } catch (x) { /* gone */ } }
    w.onmessage = async function (ev) {
      const m = ev.data || {};
      dog.moved();
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
  stopSend(key);                                           // a save on its way to OneDrive stops (nothing is deleted there)
  if (jobs[key] && jobs[key].promise) {
    try { await jobs[key].promise; } catch (e) { /* it stopped; that is all that was wanted */ }
  }
  await downloadReleased(key, 15000);
  const r = await get("plans", key);
  if (!r) return;
  await del("plans", key);
  delete tells[key];
  if (r.dl && r.dl.file && r.dl.file !== r.file) await removeFile(r.dl.file);
  for (const n of [r.file, hasLocal(r) && r.local.file !== r.file ? r.local.file : ""]) {
    if (!n) continue;
    if (opts && opts.now) await removeFile(n); else await retire(n);
  }
  noteOwner(r.owner, (await getAll("plans")).some((x) => x.owner === r.owner) || (await hasCopies(r.owner)));
  changed(key);
}

/** Everything this person saved on this device goes, at once (Sees prices taken away: plan files carry prices) - and
    what the takeoff app keeps on this site (its stores are the device's, not one person's: they go only for a person
    with a trace here who could have put prices in them - review PRICE-2, contract addendum 3 D8): one who opened the
    takeoff app in the frame here, or one with plans kept here while stores are here that only /takeoff/ opened as a
    page of its own writes (js/takeoff-stores.js standaloneStores). -> {plans: how many plans went, unsent: how many of
    them had a save not yet in OneDrive (that work went too), takeoff: what became of the takeoff app's own stores -
    "removed", "waiting" (the app holds its drafts open: they go once it closes), "failed" (the next online page tries
    again), or false (not purged)} (map/plan-library.js purgeText says so). */
export async function purgeOwner(who) {
  if (!who || !supported()) return { plans: 0, unsent: 0, takeoff: false };
  // read first, before anything here changes the list
  const opened = takeoffUsers().indexOf(who) !== -1;
  const mine = (await getAll("plans")).filter((r) => r.owner === who);
  const owner = mine.length > 0 || ownersHere().indexOf(who) !== -1;
  const app = opened || (owner && (await standaloneStores()));
  const unsent = mine.filter(hasLocal).length;
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
  // and what the takeoff app keeps of plans on this site (its drafts carry prices; contract C3): js/takeoff-stores.js -
  // for a person with a trace here only (above), and said as it went
  let takeoff = false;
  if (app) {
    try { takeoff = purgeOutcome(await purgeTakeoffStores()); } catch (e) { takeoff = "failed"; /* the next online page tries again (the hint stays) */ }
    // not all gone yet: the person stays on the takeoff app's list, so the next online page asks again (an owner whose
    // trace was only the plans just removed would otherwise leave none)
    if (takeoff !== "removed") noteTakeoffUser(who);
  }
  // a file still open in a writer (a download in a tab the browser froze) stays: the next online page tries again (and
  // the e-mail hints of the takeoff app's people go once its list went)
  noteOwner(who, await hasCopies(who));
  return { plans: mine.length, unsent, takeoff };
}

/* ── housekeeping ──────────────────────────────────────────────────────── */

/** Files nobody points at any more: an old version after an update, a part left by a closed window, a copy whose
    record was removed elsewhere - except a copy handed to the takeoff app within the grace. Never while a download, a
    save being kept or one being sent runs (here or in another window): its new file may not be in a record yet. */
export async function sweep() {
  if (!supported()) return;
  if (await busyFiles()) return;
  // the files FIRST, then what keeps them (review LW-3): a download or a spool makes its file under its lock, and its
  // record names the file before that lock goes - so a file in this list either has its writer still running (asked
  // again just below: nothing goes then) or is named by a record read after it
  const d = await dir();
  const names = [];
  for await (const name of d.keys()) names.push(name);
  if (await busyFiles()) return;
  const all = await getAll("plans");
  const handed = await mutate("meta", "handed", (cur) => ({ key: "handed", value: pruneHanded(cur ? cur.value : {}, Date.now()) }));
  const keep = keepSet(all, handed ? handed.value : {}, Date.now());
  // and whatever a frame's takeoff app has open now, however long ago it was handed over
  (await framesReading()).forEach(function (n) { keep.add(n); });
  for (const n of names) if (FILE_RE.test(n) && !keep.has(n)) await removeFile(n);
}
/** A download, a save being kept or one being sent runs - here, or in another window (their Web Locks). */
async function busyFiles() {
  if (Object.keys(jobs).length || spooling || Object.keys(sending).length || Object.keys(sendCalls).length) return true;
  for (const prefix of [LOCK, SPOOL_LOCK, SEND_LOCK]) {
    const held = await heldLocks(prefix);
    if (held && Object.keys(held).length) return true;
  }
  return false;
}

/** A saved copy the browser has lost (storage cleared under it, a broken write): the record says so, and the
    download starts again by itself (needsWork). */
export async function verifyFiles() {
  const who = owner();
  if (!who || !supported()) return;
  // (only a file the storage says is not there, or not its size, counts as lost: a passing error of the storage's
  // decides nothing - review LW-2)
  for (const r of (await getAll("plans")).filter((x) => x.owner === who && x.file)) {
    if (jobs[r.key]) continue;
    if ((await fileState(r.file, r.size)).state === "missing") {
      const cur = await mutate("plans", r.key, (c) => (c && c.file === r.file ? Object.assign({}, c, { file: "", version: "", savedAt: "" }) : undefined));
      if (cur && !cur.file) changed(r.key);
    }
  }
  // a save found lost at an earlier check (map/plan-library.js lostSave: its file still kept from sweeps): asked again
  // now - still not there, it is lost for good (the row's note stays); there after all, the save is the record's again
  for (const r of (await getAll("plans")).filter((x) => x.owner === who && !hasLocal(x) && lostSave(x))) {
    const was = lostSave(r);
    const st = (await fileState(was.file, was.size)).state;
    if (st === "unknown") continue;
    const cur = await mutate("plans", r.key, function (c) {
      const w = c && !hasLocal(c) ? lostSave(c) : null;
      if (!w || w.file !== was.file) return undefined;
      return st === "ok" ? Object.assign({}, c, { local: w, sent: null })
        : Object.assign({}, c, { sent: { mode: "lost", at: c.sent.at } });
    });
    if (cur) changed(r.key);
  }
  // a save kept here that the browser lost: nothing is left to send - the row says so (sent "lost")
  for (const r of (await getAll("plans")).filter((x) => x.owner === who && hasLocal(x))) {
    if (sending[r.key] || spooling) continue;
    if ((await fileState(r.local.file, r.local.size)).state === "missing") await markLost(r.key, r.local.file);
  }
}

/** The save `file` waiting on record `key` is not on the device (the storage said so): the record says it was lost
    (sent "lost") and keeps what the save was (`was`) - its file kept from every sweep until a LATER check says it is
    really gone, or brings it back (verifyFiles; review LW-2). */
async function markLost(key, file) {
  const cur = await mutate("plans", key, (c) => (c && hasLocal(c) && c.local.file === file
    ? Object.assign({}, c, { local: null, sent: { mode: "lost", at: nowIso(), was: c.local } }) : undefined));
  if (cur && !cur.local) changed(key);
}

/* ── new versions ──────────────────────────────────────────────────────── */

/** Ask OneDrive for the version of every saved plan of this person -> {checked, updates, gone, denied, revoked,
    purged?}. A refusal of plans_list itself (Sees prices taken away) removes this person's plans from the device
    (`purged`: purgeOwner's answer, `revoked` its plans). */
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
        sum.purged = await purgeOwner(who);
        sum.revoked = sum.purged.plans;
        return sum;
      }
      throw x;
    }
    for (const r of mine.filter((m) => ids.indexOf(Number(m.projectId)) !== -1)) {
      // only what a check knows (latest, and the waits of a new version): never an older copy of the whole record
      const next = await mutate("plans", r.key, function (c) {
        if (!c) return undefined;
        const a = applyCheck(c, answer[String(c.projectId)] || null, at);
        // and the folder OneDrive lists it in now (a file moved up out of a sub-folder is a plan again: inSubFolder)
        const folder = a.latest && a.latest.status === "ok" && a.latest.folder ? a.latest.folder : c.folder;
        // (and a save of this device's under OneDrive's own hash now: its version, no download - map/plan-library.js keptAs;
        // and whether the broker takes a save of the project's plans now: its save_back)
        return Object.assign({}, c, { latest: a.latest, fails: a.fails !== undefined ? a.fails : c.fails, retryAt: a.retryAt !== undefined ? a.retryAt : c.retryAt,
          folder, version: a.version, expect: a.expect || null, saveBack: a.saveBack === true });
      });
      if (!next || inSubFolder(next.folder)) continue;            // a Backup's copy: not one of the plans shown
      sum.checked++;
      const st = next.latest ? next.latest.status : "";          // null: a first download not finished, nothing known
      if (st === "gone") sum.gone++;
      else if (st === "denied") sum.denied++;
      else if (next.file && next.latest && next.latest.version !== next.version) sum.updates++;
      changed(r.key);
    }
  }
  await dropSubFolderCopies(who);
  await metaPut("check:" + who, at);
  await metaPut("checkHold:" + who, null);                  // a check that worked ends a check hold
  return sum;
}

/** The copies saved from a project's sub-folder (a Backup's older copy) before the owner's rule of 2026-10-27 that a
    check did not find as plans - gone (only the files right in a project's folder are), or denied (the project not
    visible: never found moved up) - go from the device, a copy just handed to the takeoff app after its grace, as any
    Remove. One the check found moved up into the project's folder took that folder and is a plan again. */
async function dropSubFolderCopies(who) {
  // (never one with a save of the person's own waiting here: that work goes only with the person's own Remove)
  for (const r of (await getAll("plans")).filter((x) => x.owner === who && inSubFolder(x.folder) && x.latest && x.latest.status !== "ok" && !hasLocal(x))) {
    try { await remove(r.itemId, { owner: who }); } catch (e) { /* the next page */ }
  }
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
  // and each record's own wait after a OneDrive-wide failure (a wait for a reason of the file's own stays)
  for (const r of (await getAll("plans")).filter((x) => x.owner === who && x.wide && Number(x.fails) > 0)) {
    const c2 = await mutate("plans", r.key, (c) => (c && c.wide && Number(c.fails) > 0 ? Object.assign({}, c, { fails: 0, retryAt: null, wide: false }) : undefined));
    if (c2 && !c2.fails) changed(r.key);
  }
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
        if (code === "offline") {
          if (!(HAS && navigator.onLine === false)) await metaPut("autoHold:" + who, { until: Date.now() + FLAT_HOLD_MS, n: 0 });
          return;
        }
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
      // (and one who opened the takeoff app here: its drafts and kept copies carry prices too - js/takeoff-stores.js);
      // said on the page (Search, a project, home: nothing else there says it)
      if (o.fresh && tracesHere(who)) tellPurge(await purgeOwner(who));
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
        const sum = await checkUpdates();
        if (sum && sum.purged) { tellPurge(sum.purged); return; }
      } catch (e) {
        if (e && e.code === "offline") {
          if (!(HAS && navigator.onLine === false)) await metaPut("checkHold:" + who, { until: Date.now() + FLAT_HOLD_MS, n: 0 });
        } else {
          await growHold("checkHold:" + who, e && e.retryAfter);
        }
      }
    }
    await dropSubFolderCopies(who);                          // (a check that did not run now: what an earlier one found)
    // the person's own saves waiting here go first (a page that may reach OneDrive's upload address: never the home
    // page, whose policy does not name it - it asks with download: false)
    if (o.download !== false && saveBackFor(me)) await sendWaiting();
    if (o.download !== false && !iosHomeRefused()) await autoWork();
    await sweep();
  } catch (e) { /* the next page asks again */ }
}

/* ── opening in the takeoff app ────────────────────────────────────────── */

/** "The takeoff app opened on this device" - only once it said it keeps itself for offline use. */
function noteReady() {
  try { localStorage.setItem(READY_KEY, nowIso()); } catch (e) { /* a note only */ }
  emit({ t: "ready" });                                     // other windows hear it through the storage event
}

/** Open a saved copy in the takeoff app (a computer's new tab, a phone's or tablet's frame). Call IN the click.
    onDone({ok, why, error, via}); opts.title: the frame's title (the plan's name); opts.me: the person (in the frame,
    one who may save back - map/plans.js saveBackFor - is offered it, canSave, and keepSave takes the app's Save, only
    while the record's latest plans_list / plan_link answer said the broker takes it: `saveBack`, contract addendum 3
    D1 - offline, the last one known; an older broker never says so, and nothing is offered).
    The person's own save waiting on this device (not in OneDrive yet) is what opens, when there is one. */
export function open(itemId, onDone, opts) {
  const key = keyOf(itemId);
  const o = opts || {};
  const frame = usesFrame();
  const offer = frame && saveBackFor(o.me);
  if (frame) noteFrameUser(owner());
  const which = (c) => (hasLocal(c) ? c.local.file : c.file);
  // the frame's app reads the file it is handed for as long as it is open: held until the frame closes (holdForFrame)
  let closeNow = function () {};
  const closed = new Promise(function (resolve) { closeNow = resolve; });
  // what the frame's app has (map/plan-library.js saveBase): the file handed over, then each save of it kept here
  const line = { file: "", base: "" };
  openInTakeoff(async function () {
    // held (the frame: until it closes) or marked as handed over (a computer's tab: the week's grace) first, then read
    // again: a new version committed in between (here or in another window) would otherwise retire the very file being
    // handed over
    let r = null;
    for (let i = 0; i < 2 && !r; i++) {
      const cur = await get("plans", key);
      if (!cur || !which(cur)) throw err("missing", "This plan has not finished downloading on this device yet.");
      const free = frame ? holdForFrame(which(cur), closed) : null;
      if (!frame) await markHanded(which(cur));
      const again = await get("plans", key);
      if (again && which(again) === which(cur)) r = again;
      else if (free) free();                                 // not this file after all
    }
    if (!r) throw err("missing", "This plan was just updated on this device. Tap Open again.");
    const mine = hasLocal(r);
    const st = await fileState(which(r));
    if (st.state === "unknown") throw err("storage", "This device's storage did not answer just now. Tap Open again.");
    const f = st.file;
    if (!f) throw err("missing", mine ? "The save kept on this device is gone (the browser cleared this site's storage)." : "This saved plan is no longer on this device. Save it again from 📐 while online.");
    const want = mine ? Number(r.local.size) : Number(r.size);
    if (want > 0 && f.size !== want) throw err("missing", "This saved plan did not finish downloading. It carries on while the portal is open and online.");
    line.file = which(r);
    line.base = String((mine ? r.local.base : r.version) || "");
    // the save's own time - also once OneDrive has it (the work's time, not the upload's: the app compares its drafts
    // with it)
    const t = handedTime(r);
    const plan = { kind: "file", file: f, name: r.name, size: f.size, lastModified: isFinite(t) ? t : f.lastModified, number: r.number,
      updateAvailable: !mine && statusOf(r, null, false) === "outdated" };
    // (js/plan-handoff.js offers it to the frame only) - and only while the broker said it takes a save of this
    // project's plans from this person (its switch, ONEDRIVE_PLAN_SAVE: the record's saveBack)
    if (offer && r.saveBack === true) plan.canSave = true;
    // whose work it is (the app keys its drafts by it; review PRICE-4) - the frame's app only
    const who = frame ? await whoWord(owner()) : "";
    if (who) plan.who = who;
    return plan;
  }, null, onDone, noteReady, Object.assign({}, o, { onSave: offer ? function (save, tell) { return keepSave(itemId, save, tell, line); } : null,
    onClose: function () { closeNow(); } }));
}

/** Open a plan in OneDrive in the takeoff app over byte ranges (online; nothing saved). Call IN the click. A fresh link
    is handed only for the version first opened: a file saved again in OneDrive meanwhile is not read on as if it were
    the same (the tab says to open it again). */
export function openOnline(projectId, number, file, onDone, opts) {
  let version = null;
  let stale = false;                        // saved again in OneDrive since it was opened: no fresh link will match
  if (usesFrame()) noteFrameUser(owner());
  openInTakeoff(async function () {
    const l = await onedrive.planLink(projectId, file.id);
    if (!(Number(l.size) > 0)) throw err("no_size", "OneDrive did not say how big this file is.");
    version = l.version;
    const t = Date.parse(l.modified || "");
    const plan = { kind: "link", url: l.url, name: l.name, size: Number(l.size), lastModified: isFinite(t) ? t : 0, number: String(number || "") };
    const who = usesFrame() ? await whoWord(owner()) : "";   // (the frame's app keys its drafts by it: PRICE-4)
    if (who) plan.who = who;
    return plan;
  }, async function () {
    if (stale) return "";
    const l = await onedrive.planLink(projectId, file.id);
    if (version && l.version === version) return l.url;
    stale = true;                           // (a busy or failed ask throws instead: the next sheet may ask again)
    return "";
  }, onDone, noteReady, opts);
}

/**
 * Open a plan on a phone or a tablet (the frame) - always from a copy on THIS device: the plan is saved here first when
 * it is not, or is not the version OneDrive holds (the library's own download: its green bar in the 📐 menu and the
 * Plans Library; a copy already the right version costs one question to the broker), then handed over as a file.
 * map/plan-library.js deviceOpenStep / afterFetch decide:
 *   · offline: the copy saved here opens as it is (a newer version waits for the signal); with none, nothing opens;
 *   · no room for it, or a browser that cannot keep plans: it opens ONLINE (over byte ranges, nothing kept) and the
 *     person is told so;
 *   · OneDrive busy, the file gone from OneDrive, the download stopped - with a copy here: that copy opens, and the
 *     person is told why it is not the newest; refused (Sees prices taken away): nothing opens;
 *   · paused by the person meanwhile, or `o.still()` false (the menu was closed): nothing opens.
 *   · the person's own save waiting here (not in OneDrive yet): that opens, nothing is downloaded over it (and it is
 *     sent, when it can be);
 * o: {projectId, number, projectTitle, itemId, name, file (the plans_list file, when the 📐 menu has it), still(), me
 * (the person: one who may save back is offered it - open())}.
 * onStep(text) says what happens meanwhile; onDone({ok, why, error, via, online, note}) - `note`: what the person is
 * told on the frame's bar too (online: why it opened online).
 */
export async function openOnDevice(o, onDone, onStep) {
  const itemId = String(o.itemId || (o.file && o.file.id) || "");
  const key = keyOf(itemId);
  // a second tap while the same plan is still on its way (its download) is the same opening: it would otherwise open a
  // second frame over the first when both downloads end
  if (itemId && opening[key]) return;
  opening[key] = true;
  try { await openOnDeviceNow(o, itemId, key, onDone, onStep); } finally { delete opening[key]; }
}
const opening = {};          // key -> an openOnDevice waiting for its plan

async function openOnDeviceNow(o, itemId, key, onDone, onStep) {
  const done = typeof onDone === "function" ? onDone : function () {};
  const step = typeof onStep === "function" ? onStep : function () {};
  const still = typeof o.still === "function" ? o.still : function () { return true; };
  const title = o.name || (o.file && o.file.name) || "";
  if (!itemId) { done({ ok: false, why: "failed", error: err("bad", "No plan file to open.") }); return; }
  let r = null;
  try { r = supported() ? await get("plans", key) : null; } catch (e) { r = null; }
  const online = !(HAS && navigator.onLine === false);
  const writable = online && (await canWrite());
  const viaOnline = function (why) {
    const note = onlineNote(why);
    openOnline(o.projectId, o.number, { id: itemId }, function (res) { done(Object.assign({ online: why, note }, res)); }, { title });
    frameSay(note, "warn");
  };
  const fromHere = function (note) {
    open(itemId, function (res) { done(note ? Object.assign({ note }, res) : res); }, { title, me: o.me });
    if (note) frameSay(note, "warn");
  };
  if (r && hasLocal(r)) {
    // the person's latest work, not in OneDrive yet: it opens as it is (with no signal too) - nothing is fetched over it
    fromHere("");
    if (online) sendSaved(itemId).catch(function () { /* the row says why */ });
    return;
  }
  const first = deviceOpenStep({ have: !!(r && r.file), online, writable });
  if (first === "offline") {
    done({ ok: false, why: "failed", error: err("offline", "You're offline, and this plan is not saved on this device yet. Open it once while online.") });
    return;
  }
  if (first === "open") { fromHere(r && statusOf(r, null, false) === "outdated" ? "You're offline: the copy saved on this device opened (a newer version is in OneDrive)." : ""); return; }
  if (first === "online") { viaOnline("unsupported"); return; }
  // "fetch": on this device first (save, update or resume - the person's own act: no wait after earlier failures)
  step(r && r.file ? "Checking for a newer version…" : "Saving it on this device first…");
  let res = null, failed = null;
  try {
    res = r ? await resume(itemId)
      : await save({ projectId: o.projectId, number: o.number, projectTitle: o.projectTitle, file: o.file });
  } catch (x) { failed = x; }
  if (!still()) { done({ ok: false, why: "closed" }); return; }
  if (failed) {
    r = null;
    try { r = await get("plans", key); } catch (e) { r = null; }
    const next = afterFetch(failed.code, !!(r && r.file));
    if (next === "online") { viaOnline(failed.code === "space" ? "space" : "unsupported"); return; }
    if (next === "open") { fromHere("The copy saved on this device opened — the newest version did not download: " + String(failed.message || "it stopped").replace(/[.\s]+$/, "") + "."); return; }
    done({ ok: false, why: "failed", error: failed });
    return;
  }
  if (res && res.paused) { done({ ok: false, why: "paused" }); return; }
  if (res && res.removed) { done({ ok: false, why: "failed", error: err("removed", "That saved plan was removed.") }); return; }
  fromHere("");
}

/* ── the save back (owner decisions Q1-Q3, 2026-11-04; contract C3 "Save-back") ──────────────────────────────────

   A Save in the frame's takeoff app, of a plan handed to it as a file and offered (canSave: map/plans.js saveBackFor,
   PLAN_SAVE_BACK), comes here through the hand-over (js/plan-handoff.js ptt-save -> keepSave):
     1. the saved project - a Blob of the app's, handed over by reference, file-backed slices of the plan plus its
        changes - is copied into a NEW file of the library by the worker (op "spool": 8 MiB slices with the
        synchronous access handle; nothing whole in memory), its size and the takeoff MAGIC checked;
     2. the record gets its `local` (map/plan-library.js withSave): the save opens from now on - with no signal too -
        and nothing downloads over it or retires it (needsWork, run);
     3. the app is told "kept" - only then does it mark the project saved and drop its draft.
   Then it is SENT (sendSaved) by the Files tab's uploader (js/onedrive-upload.js createUploader) over the broker's
   plan_save_session / plan_save_commit / plan_save_done: chunks straight from this device's file to OneDrive's upload
   address (in this page's memory only), the screen held awake (a Wake Lock) and the rows saying "keep this screen
   open". A replace is DEFERRED (contract addendum 2, C1b; review Q3-2, BRK-1): its last chunk commits nothing, and
   the broker's plan_save_commit commits it only onto the version the session was made for - an office save that
   landed while it went up makes the same upload a copy instead (or, when Microsoft will not, plan_changed: it is sent
   again at once as a copy). The session names the plan's file name too, so a plan the office's desktop app saved as a
   new item (the old one moved into Backups) is found by its name - a copy beside it (review Q3-1, BRK-4). The save's
   quickXorHash (local.hash, from the spool worker) goes to the commit and to plan_save_done: with OneDrive's own hash
   it is the broker's proof - a byte-identical re-save is saved, an office save of the same size is not (BRK-2, BRK-5).
   A send that
   does not finish waits (5 min, doubling, up to 6 h) and goes again by itself while a portal page that may reach
   OneDrive is open (maybeCheck: Search, a project, the Plans Library), or at the person's Retry. Once OneDrive has it
   (adoptSent): a REPLACE - the saved bytes are the plan's version now (no download), the old copy retired (a week's
   grace when handed to the app lately); a COPY - someone saved the plan in the office after this device got it (Q3):
   the plan stays as it was, the save becomes a record of its own for the copy, and the person is told (copyTold).
   A session whose end this device never heard (the page closed after the last byte) is settled with its ticket first
   (settle: plan_save_done, with the save's hash; the broker takes the ticket for 30 days - review BRK-3, TICKET-1,
   LW-7 - and past that the save is looked for by its hash alone), so a save that landed is never sent twice, nor made
   into a copy of itself.

   While a save is kept or sent the frame's Close asks first (plan-frame.js guard) and leaving the page asks too. */

const sending = {};        // key -> {job, file, sent, size, told, meta}: a save being sent from THIS window
const remoteSend = {};     // key -> {sent, size, at}: one being sent from another window (its last word)
const parked = {};         // key -> {id, file, meta}: a send that failed with its session alive (resumed in this page)
const tells = {};          // key -> the frame's news (js/plan-handoff.js), while the takeoff app is open on that plan
const waiting = {};        // uploader job id -> resolve(the job, once it ended)
const sendCalls = {};      // key -> a sendSaved running in this window (a second call is the same one)
let spooling = 0;
let upl = null;
/** At most one "keeping" word to the app this often while a save is kept (takeoff-web needs one within 120 s). */
export const BEAT_MS = 2000;
let transportFn = null;

/** A test's stand-in for OneDrive's upload address (the page's: XMLHttpRequest, js/onedrive-upload.js xhrTransport). */
export function useTransport(fn) {
  transportFn = fn || null;
  upl = null;
}

const here = () => (HAS ? window : null);

/** A refusal of the broker's, in the words of a save (the broker's own for the rest). */
function sendError(x) {
  const code = x && x.code;
  if (code === "too_large") {
    const max = x.info && Number(x.info.max_bytes);
    return err("too_large", "This plan is too large to send to OneDrive from here" + (max > 0 ? " (at most " + fmtSize(max) + ")" : "") +
      ". It stays on this device.", { status: x.status });
  }
  if (code === "not_found") {
    // the broker looked by the item and by the plan's name (review Q3-1): neither is one plan of the project's folder now
    return err("not_found", "OneDrive no longer has this plan in its project's folder (not as it was, and not one file of its name), so the save cannot be sent there. It stays on this device: open it and use Save a copy to Files in the takeoff app.", { status: x.status });
  }
  // the takeoff folder's grant still read-only (the owner's step): no use asking again in a minute (the uploader would)
  if (code === "not_authorized") {
    return err("save_not_allowed", "OneDrive does not take plan saves from the portal yet (the owner turns it on). The save stays on this device and is sent later.",
      { status: x.status, retryAfter: x.retryAfter });
  }
  // the broker's switch for the save back does not allow this project (now: it was turned off after the save was kept;
  // contract addendum 3 D1): never final - it waits a long while (map/plan-library.js LONG_WAIT) and goes again
  if (code === "save_back_off") return err("save_back_off", saveBackOffWords(deviceWord(here())), { status: x.status, retryAfter: x.retryAfter });
  // a broker older than this page: it does not have the op yet (D6) - deployed later; never final either
  if (code === "not_deployed") {
    return err("not_deployed", "The portal's OneDrive connection does not take plan saves yet. The save stays on this " + deviceWord(here()) + " and is sent later.",
      { status: x.status });
  }
  return x;
}

/** The copies named `name` with `size` bytes among the project's plans now (a copy session whose last answer was lost). */
async function copiesNamed(projectId, name, size) {
  const got = await onedrive.plansList([projectId]);
  const p = got[String(projectId)];
  const want = String(name || "").normalize("NFC").toLowerCase();
  return (p ? p.files : []).filter((f) => f.size === Number(size) && String(f.name).normalize("NFC").toLowerCase() === want);
}

/** The uploader's broker for a plan's save (js/onedrive-upload.js): the job's meta {key, itemId, base, file, savedAt,
    name, hash, mode?, why?} - name: the plan's file name as the record has it (the broker's way to the plan when an
    office save made it a new item: review Q3-1); hash: the save's quickXorHash; mode "copy" once the broker dropped a
    replace (plan_changed), and why its "why" (contract addendum 3 D5: "refused" - OneDrive would not replace the plan,
    nobody saved anything - or "changed"; the words the person is told follow it). */
const planBroker = {
  session: async function (j) {
    const m = j.meta || {};
    let s;
    try {
      s = await onedrive.planSaveSession({ projectId: j.projectId, itemId: m.itemId, version: m.base, size: j.size, modified: m.savedAt, name: m.name,
        mode: m.mode === "copy" ? "copy" : undefined });
    } catch (x) { throw sendError(x); }
    m.ticket = s.ticket;
    // what this session does, kept with the save - never its upload address - so a send whose end is never heard is
    // settled with it before anything is sent again (and told in the right words: a copy OneDrive's refusal made)
    try {
      await mutate("plans", m.key, function (c) {
        if (!c || !hasLocal(c) || c.local.file !== m.file) return undefined;
        const sends = (Array.isArray(c.local.sends) ? c.local.sends : []).concat([Object.assign({ file: m.file, ticket: s.ticket, mode: s.mode, name: s.name,
          size: j.size, at: nowIso(), hash: hashOk(m.hash) ? m.hash : null }, s.commit === "broker" ? { commit: "broker" } : {},
          s.mode === "copy" && m.why === "refused" ? { why: "refused" } : {})]).slice(-MAX_SENDS);
        return Object.assign({}, c, { local: Object.assign({}, c.local, { sends }) });
      });
    } catch (e) { /* a note only: the send goes on */ }
    return s;
  },
  done: function (j, itemId, ticket) { return onedrive.planSaveDone(j.projectId, itemId, ticket, (j.meta || {}).hash); },
  // every byte of a deferred replace is in OneDrive's session: the broker commits it onto the plan - or, the plan
  // changed (or left its folder) while it went up, as the copy beside it (contract addendum 2, C1b.2) - and checks it
  // by the plan's version history (addendum 3 D2). `landed`: the session's last chunk answered the file itself
  // (OneDrive did not wait: D3) - the broker only checks it. The upload address goes to the broker for this one call,
  // from this page's memory (never stored).
  commit: async function (j) {
    const m = j.meta || {};
    try {
      return await onedrive.planSaveCommit({ projectId: j.projectId, itemId: m.itemId, ticket: j.session.ticket, uploadUrl: j.session.uploadUrl, hash: m.hash,
        landed: j.chunkLanded === true });
    } catch (x) {
      if (x && x.code === "plan_changed") {
        // the broker dropped the session (the plan changed, or OneDrive would not replace it): sent again at once as a
        // separate file, against the same base (the broker's {retry: "copy"}); its why picks the words (an older broker
        // says none: "changed")
        m.mode = "copy";
        m.why = x.info && x.info.why === "refused" ? "refused" : "changed";
        x.restart = true;
      }
      throw x;
    }
  },
  // the session is gone (finished, or run out): does OneDrive hold this save? A replace: the plan itself (plan_save_done
  // is the proof, not_saved when not); a copy: a file of the copy's name and size in the project's folder
  find: function (j) {
    const m = j.meta || {};
    if (j.session && j.session.mode === "copy") return copiesNamed(j.projectId, j.session.name, j.size);
    return Promise.resolve([{ id: m.itemId, name: (j.session && j.session.name) || "", size: j.size }]);
  },
};

function uploader() {
  if (upl) return upl;
  upl = createUploader({ send: transportFn || xhrTransport(), broker: planBroker });
  upl.onChange(onUploads);
  return upl;
}

/** The uploader's word: a job that ended answers its waiter; a save's progress goes to the rows, the frame and the
    other windows. */
function onUploads(items) {
  items.forEach(function (j) {
    const w = waiting[j.id];
    if (w && (j.state === "done" || j.state === "failed" || j.state === "cancelled")) { delete waiting[j.id]; w(j); }
  });
  Object.keys(sending).forEach(function (key) {
    const s = sending[key];
    const j = items.find((x) => x.id === s.job);
    if (!j || ["starting", "sending", "finishing"].indexOf(j.state) === -1 || j.sent === s.sent) return;
    s.sent = j.sent;
    s.size = j.size;
    const m = { t: "send", key, sent: s.sent, size: s.size };
    emit(m);
    if (channel) try { channel.postMessage(m); } catch (e) { /* closed */ }
    const pct = s.size ? Math.min(99, Math.floor((s.sent / s.size) * 100)) : 0;
    if (pct >= (s.told || 0) + 5) { s.told = pct; news(key, "sending", { pct }); }
    if (frameIsOpen()) frameSay("Sending your save to OneDrive: " + pct + "% — keep this screen open.");
  });
}

/** The job, once it ended (done, failed or cancelled). */
function ended(id) {
  return new Promise(function (resolve) { waiting[id] = resolve; });
}

/** The frame's news about this plan's save (the takeoff app shows it while it is open; it depends on none of it). */
function news(key, state, extra) {
  const t = tells[key];
  if (typeof t !== "function") return;
  try { t(state, extra || {}); } catch (e) { /* the frame went */ }
  if (state === "sent" || state === "copy") delete tells[key];
}

function toastOf(text, kind) {
  const t = HAS && window.DCR2 && window.DCR2.toast;
  if (typeof t === "function") { try { t(text, { kind: kind || "info", ms: 12000 }); } catch (e) { /* words only */ } }
}

/** A purge on lost prices said on the page (map/plan-library.js purgeText: the plans, the saves not yet in OneDrive,
    the takeoff app's own stores - review LW-4): on the frame's bar while it is open, else a toast. */
function tellPurge(p) {
  const text = purgeText(p, deviceWord(here()));
  if (!text) return;
  if (frameIsOpen()) frameSay(text, "warn"); else toastOf(text, "warn");
}

/* The screen kept awake while a save is sent (a phone that sleeps stops the page, and with it the upload). */
let wakeWant = 0, wake = null, wakeAsking = false;
function awake(on) {
  wakeWant = Math.max(0, wakeWant + (on ? 1 : -1));
  if (!wakeWant) {
    if (wake) { try { wake.release(); } catch (e) { /* gone */ } wake = null; }
    return;
  }
  holdAwake();
}
function holdAwake() {
  if (wake || wakeAsking || !wakeWant || !(HAS && navigator.wakeLock && typeof navigator.wakeLock.request === "function")) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  wakeAsking = true;
  Promise.resolve().then(function () { return navigator.wakeLock.request("screen"); }).then(function (s) {
    wakeAsking = false;
    if (!wakeWant || wake) { try { s.release(); } catch (e) { /* */ } return; }
    wake = s;
    if (typeof s.addEventListener === "function") s.addEventListener("release", function () { if (wake === s) wake = null; });
  }, function () { wakeAsking = false; /* the browser said no (low power, a hidden page): the rows still say keep this screen open */ });
}
if (HAS && typeof document !== "undefined" && typeof document.addEventListener === "function") {
  // a lock is let go when the page is hidden: asked again when it is back in front
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") holdAwake(); });
}
if (HAS && typeof window.addEventListener === "function") {
  // leaving the page stops a save being kept or sent: the browser asks first, where it can
  window.addEventListener("beforeunload", function (e) {
    if (!spooling && !Object.keys(sending).length) return;
    e.preventDefault();
    e.returnValue = "";
  });
}
// the frame's Close asks first while a save is kept (closing the app can stop it) or sent (that goes on in this page)
frameGuard(function () {
  const d = deviceWord(here());
  if (spooling) return "Your save is being kept on this " + d + ".";
  const keys = Object.keys(sending);
  if (!keys.length) return "";
  const s = sending[keys[0]];
  const pct = s.size ? Math.min(99, Math.floor((s.sent / s.size) * 100)) : 0;
  return { title: "Still sending to OneDrive", okText: "Close the takeoff app", danger: false,
    text: "Your save is on this " + d + " and is being sent to OneDrive (" + pct + "%). It carries on after the takeoff app closes: keep the portal open on this screen until it says Sent." };
});

/** Copy the app's Blob into the library file `name` (the worker's op "spool") -> {size, magic, hash} | {error, cut?}.
    `hash`: OneDrive's quickXorHash of the bytes copied (js/quickxor.js, computed from the worker's own slices), or null.
    onProgress(done): the worker's own progress - only when its bytes moved (review LW-6: the app's "keeping" is real
    progress, never a beat of a stuck read). `cut`: the worker was ended (its watchdog, its failure) without tidying its
    file - keepSave removes it. */
function runSpool(key, name, blob, size, onProgress) {
  return new Promise(function (resolve) {
    let w;
    try { w = new Worker(new URL("./plan-library-worker.js", import.meta.url)); } catch (e) { resolve({ error: err("unsupported", UNSUPPORTED) }); return; }
    let over = false, done = 0;
    // no bytes moved for WATCH.stall (the page's own time in front: watchdog) - a read that never settles, a worker
    // that died - is the end: the save is not kept, and the app may save again
    const dog = watchdog(function () { end({ error: err("stalled", "Keeping the save on this device stopped responding. Save again."), cut: true }); });
    function end(v) {
      if (over) return;
      over = true;
      dog.stop();
      try { w.terminate(); } catch (e) { /* gone */ }
      resolve(v);
    }
    w.onmessage = function (ev) {
      const m = ev.data || {};
      if (m.type === "progress") {
        const d = Number(m.done) || 0;
        if (d <= done) return;                               // a word without progress counts for nothing
        done = d;
        dog.moved();
        if (!over && typeof onProgress === "function") { try { onProgress(d); } catch (e) { /* words only */ } }
      }
      else if (m.type === "spooled") end({ size: m.size, magic: m.magic, hash: hashOk(m.hash) ? m.hash : null });
      else if (m.type === "error") end({ error: err("spool", m.message || "The save could not be kept on this device.", { status: m.status }) });
      else if (m.type === "cancelled") end({ error: err("spool", "Keeping the save stopped. Save again.") });
    };
    w.onerror = function (ev) { end({ error: err("spool", "Keeping the save stopped (" + ((ev && ev.message) || "the worker failed") + ")."), cut: true }); };
    w.postMessage({ op: "spool", id: key, file: name, blob, size });
  });
}

/** OneDrive's quickXorHash of the library file `name` (`size` bytes), read again in 8 MiB slices by the worker (its op
    "hash": a second pass over a kept save whose spool could not hash it - contract addendum 3 D4) -> the hash, or null
    (the worker could not: no js/quickxor.js, the file not there or not its size, the worker stalled). */
function runHash(key, name, size) {
  return new Promise(function (resolve) {
    let w;
    try { w = new Worker(new URL("./plan-library-worker.js", import.meta.url)); } catch (e) { resolve(null); return; }
    let over = false, done = -1;
    const dog = watchdog(function () { end(null); });
    function end(v) {
      if (over) return;
      over = true;
      dog.stop();
      try { w.terminate(); } catch (e) { /* gone */ }
      resolve(v);
    }
    w.onmessage = function (ev) {
      const m = ev.data || {};
      if (m.type === "progress") { const d = Number(m.done) || 0; if (d > done) { done = d; dog.moved(); } }
      else if (m.type === "hashed") end(hashOk(m.hash) ? m.hash : null);
      else if (m.type === "error" || m.type === "cancelled") end(null);
    };
    w.onerror = function () { end(null); };
    w.postMessage({ op: "hash", id: key, file: name, size });
  });
}

/** A kept save without its hash (its spool could not load js/quickxor.js) is hashed again now, in a second worker pass,
    before it is sent or settled (contract addendum 3 D4): the save's `local.hash`, and the sessions of that very file
    that carry none, from then on. A pass that could not: nothing changes (tried again at the next send). */
async function hashKept(key) {
  const r = await get("plans", key);
  if (!r || !hasLocal(r) || hashOk(r.local.hash)) return;
  const file = r.local.file;
  const h = await runHash(key, file, Number(r.local.size) || 0);
  if (!hashOk(h)) return;
  await mutate("plans", key, function (c) {
    if (!c || !hasLocal(c) || c.local.file !== file || hashOk(c.local.hash)) return undefined;
    const sends = Array.isArray(c.local.sends) ? c.local.sends.map((s) => (s && s.file === file && !hashOk(s.hash) ? Object.assign({}, s, { hash: h }) : s)) : c.local.sends;
    return Object.assign({}, c, { local: Object.assign({}, c.local, { hash: h, sends }) });
  });
}

/** A spool's file its ended worker could not remove (review SPOOL-1): removed here, tried for a moment while the
    browser lets go of the ended worker's access handle; still there after that, a sweep takes it (no record names it). */
async function dropPart(name) {
  for (let i = 0; i < 8; i++) {
    await removeFile(name);
    if ((await fileState(name)).state === "missing") return;
    await new Promise(function (r) { setTimeout(r, 250); });
  }
}

/** A send of this plan's save `file` (or of any, without one) stops here: an earlier save a later one replaced, a
    removed plan. Nothing is deleted in OneDrive (an unfinished upload session changes nothing there). */
function stopSend(key, file) {
  const s = sending[key];
  if (s && (!file || s.file === file) && upl) upl.cancel(s.job);
  const p = parked[key];
  if (p && (!file || p.file === file)) {
    if (upl) upl.remove(p.id);
    delete parked[key];
  }
}

/** Record `c` holds a save of ANOTHER opening of the plan (a second window or tab, an older opening): the save waiting
    there is not the file this opening's app has (`line`: the file it was handed, then each of its saves kept here).
    Its work is not in this one's, so it is never superseded (review LW-1): only an opening's own save moves on.
    (A Web Lock per plan for a frame's life - a second opening offered no save at all - was weighed and left: a
    suspended tab's lock would take the save from the opening the person is using, and a refusal at the Save costs
    nothing while the first opening has not saved.) */
function otherOpening(c, line) {
  return !!(line && line.file && hasLocal(c) && c.local.file !== line.file);
}
/** Why a Save of another opening was refused, for the takeoff app (contract addendum 3 D7): one plain clause - the app
    puts it in its own words, "Not saved: the portal did not take this save (<why>). Your changes are still in this
    window - use Save a copy to Files to keep them." - so it never gives that advice itself, and never says that opening
    the plan again brings these changes back (it hands the other opening's save then: only the app's own offer of an
    earlier version's draft may). Every refused why here is such a clause (refused()). */
function otherSaveWhy() {
  return "this plan has a save from another window or tab on this " + deviceWord(here()) + " that is not in OneDrive yet";
}
/** A refusal's answer to the app: {state: "refused", why} with `why` one plain clause (otherSaveWhy). */
function refused(why) {
  return { state: "refused", why: String(why || "").replace(/[.\s]+$/, "") };
}

/**
 * The app's Save of the plan `itemId` (js/plan-handoff.js saveOf: {req, name, size, file}) kept on this device ->
 * {state: "kept" | "refused" | "no-room" | "failed", why, sent} - the hand-over's answer to the app (`sent`: the send
 * that follows at once, never rejecting: a test's to wait on). `tell(state, extra)`: the frame's news while it is open.
 * `line` {file, base} (open()'s, one per opening): what the frame's app has - so the Saves of one opening go on the
 * record that holds its work (the plan's; once a save of it became a separate file, that copy's), against the version
 * the work was done on (map/plan-library.js saveBase); it moves on to each save kept.
 */
export async function keepSave(itemId, save, tell, line) {
  let key = keyOf(itemId);
  const s = save || {};
  spooling++;
  try {
    if (!PLAN_SAVE_BACK) return refused("saving plans back from here is switched off for now");
    let r = await get("plans", key);
    const ours = line && line.file ? recordOfLine(await getAll("plans"), owner(), line.file) : null;
    if (ours) { r = ours; key = ours.key; }
    if (!r || !(r.file || hasLocal(r))) return refused("this plan is no longer saved on this device");
    // another opening's save waits there (a second window or tab on this plan): never superseded - this one is refused,
    // so its app keeps its draft (review LW-1)
    if (otherOpening(r, line)) return refused(otherSaveWhy());
    const size = Number(s.size);
    if (!s.file || typeof s.file.slice !== "function" || !(size > 0) || s.file.size !== size) return refused("the save did not arrive whole");
    if (!(await canWrite())) return { state: "failed", why: UNSUPPORTED };
    try { await roomFor(size); } catch (x) { return { state: "no-room", why: x.message }; }
    // a name never used before: never the plan's own copy (the app reads it still), never an earlier save
    const name = fileNameFor(r.owner, r.itemId, "save:" + (r.version || ""), Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    // the app's heartbeat ("keeping", contract C2 + takeoff-web's integration): from the worker's own progress only -
    // never a timer of this page's - so a worker that stalls goes silent, and the watchdog here (90 s) and the app's
    // wait (120 s from the last word) both still end it; at most one every BEAT_MS
    let beatAt = -Infinity;
    const beat = function (done) {
      const now = Date.now();
      if (typeof tell !== "function" || now - beatAt < BEAT_MS) return;
      beatAt = now;
      tell("keeping", { pct: Math.max(0, Math.min(100, Math.floor((done * 100) / size))) });
    };
    // the copy AND its record under the spool's lock: until a record names the new file, the lock (and `spooling`) is
    // what keeps every window's sweep off it (review LW-3)
    let old = "", kept = false, base = "", other = false;
    const spool = async function () {
      const w = await runSpool(key, name, s.file, size, beat);
      if (w.error || w.magic !== MAGIC || w.size !== size) return w;
      // the record as it is now (another window may have removed it, or kept another opening's save, meanwhile)
      await mutate("plans", key, function (c) {
        if (!c) return undefined;
        if (otherOpening(c, line)) { other = true; return undefined; }
        const a = withSave(c, name, w.size, nowIso(), saveBase(c, line), w.hash);
        old = a.old;
        base = a.rec.local.base;
        kept = true;
        return a.rec;
      });
      return w;
    };
    const w = HAS && navigator.locks && navigator.locks.request ? await navigator.locks.request(SPOOL_LOCK + key, spool) : await spool();
    if (w.error) {
      // a worker ended by the watchdog or by its own failure did not remove what it wrote: done here (SPOOL-1) - else
      // a re-Save at once would find that part using the room it needs
      if (w.cut) await dropPart(name);
      if (w.error.status === 507) return { state: "no-room", why: w.error.message };
      return w.error.status === 415 ? refused(w.error.message) : { state: "failed", why: w.error.message };
    }
    if (w.magic !== MAGIC) { await removeFile(name); return refused("what the takeoff app saved is not a takeoff project file"); }
    if (w.size !== size) { await removeFile(name); return { state: "failed", why: "The save was not kept whole on this device. Save again." }; }
    if (other) { await removeFile(name); return refused(otherSaveWhy()); }
    if (!kept) { await removeFile(name); return refused("this plan was removed from this device meanwhile"); }
    // the app's work is this save now (the next Save of this opening builds on it)
    if (line) { line.file = name; line.base = String(base || ""); }
    noteOwner(r.owner, true);
    // the send's news goes to this conversation from now on (the app shows it while it is open)
    if (typeof tell === "function") tells[key] = tell;
    if (old) {
      // the earlier save this one replaces: its send here stops (a session it opened stays with the save, to be
      // settled), its file goes - kept the week's grace when it was handed to the app
      stopSend(key, old);
      await retire(old);
    }
    changed(key);
    // sent at once when it can be - after the send of the save it replaces has stopped (never awaited here: the app is
    // told "kept" now)
    const sent = Promise.resolve(sendCalls[key]).catch(function () { return null; })
      .then(function () { return sendSaved(r.itemId); }).catch(function () { return null; });
    return { state: "kept", sent };
  } catch (x) {
    return { state: "failed", why: (x && x.message) || "The save could not be kept on this device." };
  } finally {
    spooling--;
  }
}

/** A save that OneDrive did not take: the record says why, and when it goes again by itself. */
async function failSend(key, file, x) {
  try {
    await mutate("plans", key, function (c) {
      if (!c || !hasLocal(c) || c.local.file !== file) return undefined;
      const fails = (Number(c.local.fails) || 0) + 1;
      // how often OneDrive said it did not get this save whole: past NOT_SAVED_MAX it waits for the person (BRK-5)
      const notSaved = (Number(c.local.notSaved) || 0) + (x && x.code === "not_saved" ? 1 : 0);
      // (the broker's switch off, or a broker not deployed yet: a long wait, never final - addendum 3 D1, D6)
      return Object.assign({}, c, { local: Object.assign({}, c.local, { state: "failed", error: String((x && x.message) || "The save was not sent."),
        code: String((x && x.code) || ""), fails, notSaved, retryAt: new Date(Date.now() + sendWaitMs(x && x.code, fails)).toISOString() }) });
    });
  } catch (e) { /* the message has reached the page */ }
  changed(key);
  news(key, "failed", { why: x && x.message });
  if (!frameIsOpen()) return;
  if (x && x.code === "save_back_off") frameSay(x.message, "warn");
  else frameSay("Your save is kept on this " + deviceWord(here()) + " but was not sent to OneDrive: " + String((x && x.message) || "").replace(/[.\s]+$/, "") + ".", "warn");
}

/**
 * OneDrive has save `file` of this plan (plan_save_done's answer `ans`; `size`: what was sent) - the records as
 * map/plan-library.js adoptSent makes them, the old files retired, the person told. `why`: "refused" when the copy
 * exists because OneDrive would not replace the plan (plan_changed {why: "refused"}, contract addendum 3 D5) - told
 * without blaming the office (refusedTold), and the takeoff app is told "sent" then, never its "copy" news (takeoff-web's
 * words for a copy say someone in the office saved the plan; "sent" ends its "sending" line - the frame's bar says
 * where the work went). -> {sent, mode, name}.
 */
async function commitSent(key, file, ans, size, why) {
  if (!ans || ans.saved !== true || Number(ans.size) !== Number(size)) {
    throw err("not_saved", "OneDrive did not get the whole file - it is sent again.");
  }
  // a download of this plan still running (one started before the save: none starts while a save waits) ends first,
  // as for a Remove - its own check against OneDrive then throws away what it fetched (the version moved)
  await downloadReleased(key, 15000);
  let a = null;
  await mutate("plans", key, function (c) {
    a = adoptSent(c, file, ans, nowIso());
    return a.rec || undefined;
  });
  if (!a) a = { rec: null, copy: null, old: [file] };
  if (a.copy) {
    const copy = a.copy;
    await mutate("plans", copy.key, function (cur) {
      if (cur && cur.file && cur.file !== copy.file) a.old.push(cur.file);
      if (cur && cur.dl && cur.dl.file) a.old.push(cur.dl.file);
      return copy;
    });
    noteOwner(copy.owner, true);
    changed(copy.key);
  }
  for (const n of a.old) await retire(n);
  changed(key);
  if (a.rec && ans.mode === "copy" && a.copy) {
    const noBlame = why === "refused";
    const told = noBlame ? refusedTold(ans.name) : copyTold(ans.name, deviceWord(here()));
    if (noBlame) news(key, "sent"); else news(key, "copy", { name: ans.name });
    if (frameIsOpen()) frameSay(told, "warn"); else toastOf(told, "info");
  } else if (a.rec && ans.mode === "replace") {
    news(key, "sent");
    if (frameIsOpen()) frameSay("Your save is in OneDrive: it replaced the plan there.");
  }
  return { sent: true, mode: ans.mode, name: ans.name };
}

/** Did OneDrive get the save of an earlier session (`s`: one of local.sends)? -> plan_save_done's answer, or null.
    The save's hash goes with it: the broker's proof, and its way to the copy a deferred replace's commit made. */
async function landedSave(r, s) {
  if (s.mode === "copy") {
    for (const f of (await copiesNamed(r.projectId, s.name, s.size)).slice(0, 3)) {
      try { return await onedrive.planSaveDone(r.projectId, f.id, s.ticket, s.hash); } catch (x) { if (!(x && x.code === "not_saved")) throw x; }
    }
    return null;
  }
  return onedrive.planSaveDone(r.projectId, r.itemId, s.ticket, s.hash);
}

/** The save of an earlier session whose ticket the broker no longer takes (past its 30 days: review LW-7, TICKET-1),
    found by its quickXorHash alone in plans_list - the plan itself holding exactly those bytes (a replace), or a file of
    the session's name (a copy), or a copy a deferred replace's commit made beside the plan ("<stem> - iPad ...") ->
    plan_save_done's answer, or null (never by a size or a time: an office save could have those). */
async function landedByHash(r, s) {
  if (!hashOk(s.hash)) return null;
  const got = await onedrive.plansList([Number(r.projectId)]);
  const p = got[String(r.projectId)];
  const same = (a, b) => String(a || "").normalize("NFC").toLowerCase() === String(b || "").normalize("NFC").toLowerCase();
  const stem = String(r.name || "").normalize("NFC").replace(/\.takeoff$/i, "").toLowerCase();
  const mine = (p ? p.files : []).filter((x) => x.version === "qx:" + s.hash && Number(x.size) === Number(s.size));
  const hit = s.mode === "copy" ? mine.find((x) => same(x.name, s.name)) : mine.find((x) => x.id === r.itemId);
  const made = !hit && s.mode !== "copy" && s.commit === "broker"
    ? mine.find((x) => x.folder === r.folder && x.id !== r.itemId && x.name.normalize("NFC").toLowerCase().indexOf(stem + " - ipad ") === 0) : null;
  const f = hit || made;
  return f ? { saved: true, mode: hit ? s.mode : "copy", id: f.id, name: f.name, size: f.size, modified: f.modified, version: f.version } : null;
}

/** The sessions this device opened for the plan's saves whose end it never heard (local.sends), settled before anything
    is sent again: one OneDrive has is adopted (the current save's: done, nothing more to send), the others go.
    `skip`: a session still alive in this page (resumed instead). -> {sent...} when the current save was one of them.
    A session of the current save carries the save's hash (hashed again by now when the spool could not: hashKept
    writes it on the save and on its sessions); one the broker settles only with a hash (409 not_saved {need: "hash"}: a deferred
    replace past 48 hours, contract addendum 3 D4) and that this device cannot hash is never settled without it, nor
    sent again - the save waits ("need_hash") and is tried again later. */
async function settle(key, skip) {
  const r = await get("plans", key);
  if (!r || !hasLocal(r)) return null;
  for (const s of (Array.isArray(r.local.sends) ? r.local.sends : []).slice()) {
    if (!s || !s.ticket || s.ticket === skip) continue;
    const own = s.file === r.local.file;
    let ans = null;
    try {
      ans = await landedSave(r, s);
    } catch (x) {
      const code = x && x.code;
      if (code === "not_saved" && x.info && x.info.need === "hash" && own) {
        const y = err("need_hash", "This save can be checked only with its hash, which this " + deviceWord(here()) + " could not work out just now. It stays here and is tried again later.");
        await failSend(key, r.local.file, y);
        throw y;
      }
      // a ticket past the broker's 30 days: looked for by the save's hash alone (else the session is over)
      if (code === "invalid" && x.field === "ticket") ans = await landedByHash(r, s);
      // not there (not_saved), a ticket run out or a plan no longer there: the session is over; OneDrive or the
      // connection: asked again next time
      else if (code !== "not_saved" && code !== "invalid" && code !== "not_found") throw x;
    }
    if (ans && Number(ans.size) === Number(s.size)) {
      const out = await commitSent(key, s.file, ans, s.size, s.why);
      if (s.file === r.local.file) return out;
      continue;
    }
    await mutate("plans", key, function (c) {
      if (!c || !hasLocal(c) || !Array.isArray(c.local.sends)) return undefined;
      return Object.assign({}, c, { local: Object.assign({}, c.local, { sends: c.local.sends.filter((x) => x && x.ticket !== s.ticket) }) });
    });
  }
  return null;
}

/** A save built on bytes OneDrive gave as "sm:" (its hash was not ready when the save before it landed) goes against
    OneDrive's hash of those bytes once it has one - asked once, here, before the session (a failure leaves the base as
    it is). The broker also takes an "sm:" base of the plan's own size and time since contract addendum 2 (review
    BRK-7); this keeps the base in OneDrive's own form all the same. */
async function hashBase(key) {
  const r = await get("plans", key);
  if (!r || !hasLocal(r) || String(r.local.base || "").indexOf("sm:") !== 0) return;
  let f = null;
  try {
    const got = await onedrive.plansList([Number(r.projectId)]);
    const p = got[String(r.projectId)];
    f = p ? p.files.find((x) => x.id === r.itemId) || null : null;
  } catch (e) { return; }
  const v = hashedBase(r.local.base, f);
  if (!v) return;
  await mutate("plans", key, (c) => (c && hasLocal(c) && c.local.file === r.local.file && c.local.base === r.local.base
    ? Object.assign({}, c, { local: Object.assign({}, c.local, { base: v }) }) : undefined));
}

/** Under this plan's send lock: the save hashed again when the spool could not (hashKept), settle, then send the save as
    it is now. */
async function sendNow(key) {
  let r = await get("plans", key);
  if (!r || !hasLocal(r)) return { none: true };
  await hashKept(key);
  const park = parked[key] && parked[key].file === r.local.file ? parked[key] : null;
  const done = await settle(key, park && park.meta ? park.meta.ticket : null);
  if (done && done.sent) return done;
  if (!park) await hashBase(key);
  r = await get("plans", key);
  if (!r || !hasLocal(r)) return { none: true };
  const file = r.local.file;
  // a session resumed in this page carries the save's hash from now on (hashed again by hashKept)
  if (park && park.meta && !hashOk(park.meta.hash) && hashOk(r.local.hash)) park.meta.hash = r.local.hash;
  if (!baseOk(r.local.base)) {
    const x = err("bad_base", "This save cannot be matched to a version of the plan in OneDrive. It stays on this device: use Save a copy to Files in the takeoff app.");
    await failSend(key, file, x);
    throw x;
  }
  const fs = await fileState(file, r.local.size);
  if (fs.state === "unknown") {
    // the storage did not answer: the save stays as it is, and goes again after its wait (review LW-2)
    const x = err("storage", "This device's storage did not answer just now. The save stays on this device and is sent again in a few minutes.");
    await failSend(key, file, x);
    throw x;
  }
  if (fs.state === "missing") {
    await markLost(key, file);
    throw err("lost", "The save kept on this device is gone (the browser cleared this site's storage).");
  }
  const f = fs.file;
  await mutate("plans", key, (c) => (c && hasLocal(c) && c.local.file === file
    ? Object.assign({}, c, { local: Object.assign({}, c.local, { state: "sending", error: "", code: "" }) }) : undefined));
  const up = uploader();
  let id = "", meta = null;
  if (park && up.retry(park.id)) { id = park.id; meta = park.meta; }
  else {
    if (park) up.remove(park.id);
    meta = { key, itemId: r.itemId, base: r.local.base, file, savedAt: r.local.savedAt, ticket: "", name: r.name, hash: hashOk(r.local.hash) ? r.local.hash : null };
    id = up.add({ projectId: r.projectId, file: f, name: r.name, label: r.number || "", meta }).id;
  }
  delete parked[key];
  sending[key] = { job: id, file, sent: 0, size: f.size, told: 0, meta };
  awake(true);
  changed(key);
  let end;
  try { end = await ended(id); } finally { delete sending[key]; awake(false); }
  if (end.state === "done") {
    up.remove(id);
    try {
      return await commitSent(key, file, end.result, f.size, meta && meta.why);
    } catch (x) {
      await failSend(key, file, x);
      throw x;
    }
  }
  if (end.state === "cancelled") { up.remove(id); changed(key); return { cancelled: true }; }
  // not sent: its session kept for a resume in this page when it lives (a connection that did not come back)
  if (end.canRetry && end.code !== "not_saved") parked[key] = { id, file, meta }; else up.remove(id);
  const x = err(end.code || "not_sent", end.error || "The save was not sent to OneDrive.");
  await failSend(key, file, x);
  throw x;
}

/**
 * Send this person's save of the plan `itemId` to OneDrive now (see above). opts.manual: the person's own Retry (no
 * wait after earlier failures). Resolves {sent, mode, name} | {none} | {skipped} | {cancelled}; throws {code, message}
 * when it was not sent ("offline", "off", "busy_here", the broker's codes) - the row says why.
 */
export function sendSaved(itemId, opts) {
  const key = keyOf(itemId);
  if (sendCalls[key]) return sendCalls[key];
  const manual = !!(opts && opts.manual);
  const p = (async function () {
    if (!PLAN_SAVE_BACK) throw err("off", "Sending saves to OneDrive is switched off for now: the save stays on this device.");
    if (HAS && navigator.onLine === false) throw err("offline", "You're offline: the save stays on this device and is sent when you're back online.");
    const r = await get("plans", key);
    if (!r || !hasLocal(r)) return { none: true };
    if (!manual && !dueToSend(r, Date.now())) return { skipped: true };
    if (HAS && navigator.locks && navigator.locks.request) {
      return navigator.locks.request(SEND_LOCK + key, { ifAvailable: true }, function (lock) {
        if (!lock) throw err("busy_here", "This save is being sent from another portal window.");
        return sendNow(key);
      });
    }
    return sendNow(key);
  })();
  sendCalls[key] = p;
  const clear = function () { if (sendCalls[key] === p) delete sendCalls[key]; };
  p.then(clear, clear);
  return p;
}

/** This person's saves waiting here, sent one at a time (maybeCheck); a failure of OneDrive's or the connection's
    stops the rest (they would fail too). -> how many were sent. */
export async function sendWaiting() {
  if (!PLAN_SAVE_BACK || !supported() || (HAS && navigator.onLine === false)) return 0;
  const who = owner();
  if (!who) return 0;
  let n = 0;
  for (const r of (await getAll("plans")).filter((x) => x.owner === who && dueToSend(x, Date.now()))) {
    try {
      const out = await sendSaved(r.itemId);
      if (out && out.sent) n++;
    } catch (x) {
      const code = x && x.code;
      if (code === "offline" || code === "off" || code === "save_not_allowed" || brokerWide(code)) break;
    }
  }
  return n;
}
