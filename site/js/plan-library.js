/* DCR Portal 2 — the Plans Library: .takeoff plan files kept on THIS device (owner 2026-10-26: the old portal's job,
   brought to Portal 2).

   A person who sees prices (an admin, or Sees prices: plan files carry prices; map/plans.js planFilesFor) saves a
   project's plan files from 📐 so they open in the takeoff app with no internet - a site trailer, a house with no roof
   yet. Each saved copy is exactly one version of one OneDrive file in the owner's takeoff folder; when OneDrive holds a
   newer one, it downloads BY ITSELF while a portal page is open and online (maybeCheck: the Plans Library, Search, a
   project, the home page), and the saved copy keeps opening until the new one is whole. The takeoff app never writes
   into a saved copy: its Save goes to Save As or a download.

   Where things live (per browser profile, this site only):
     · the files - the Origin Private File System, folder "plan-library", one file per saved version
       (map/plan-library.js fileNameFor), written by js/plan-library-worker.js in byte ranges, resumable;
     · what is known about them - IndexedDB "dcr2-plan-library": plans (one record per person per file, key
       "<owner>|<item id>") and meta (when updates were last checked; the copies handed to the takeoff app lately).
   Records belong to the person who saved them (the sign-in's user id, read without the network: sb.js storedUserId). A
   shared tablet shows each person only their own plans.

   Opening hands the copy to the takeoff app in a new tab, window to window (js/plan-handoff.js): the app is another
   site and reads the File by slices as it draws. A copy handed over is kept a day after it is replaced or removed
   (map/plan-library.js HANDED_GRACE_MS), so the app does not lose it under an open plan.

   The bytes come straight from OneDrive (the broker's plan_link: a pre-authenticated link, kept in memory only);
   nothing goes through the broker. Nothing here is a page: the pages draw what list() and onChange() say. */

import * as onedrive from "./repo/onedrive.js";
import { storedUserId } from "./sb.js";
import {
  DIR, MAGIC, FILE_RE, fileNameFor, statusOf, applyCheck, dueForCheck, needsWork, keepSet, pruneHanded, projectBatches, fmtSize,
} from "./map/plan-library.js";
import { planFilesFor } from "./map/plans.js";
import { openInTakeoff } from "./plan-handoff.js";

const DB_NAME = "dcr2-plan-library";
const DB_VER = 1;
const LOCK = "dcr2-plan-dl:";
const SPACE_MARGIN = 64 * 1024 * 1024;         // never fill the last bit of the quota
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
      resolve(d);
    };
    r.onerror = function () { dbp = null; reject(r.error || err("db", "This browser would not open its storage.")); };
  });
  return dbp;
}
function req(store, mode, fn) {
  return db().then(function (d) {
    return new Promise(function (resolve, reject) {
      const tx = d.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      let out;
      if (r) r.onsuccess = function () { out = r.result; };
      tx.oncomplete = function () { resolve(out); };
      tx.onerror = tx.onabort = function () { reject(tx.error || err("db", "Saving to this device's storage failed.")); };
    });
  });
}
const getAll = (store) => req(store, "readonly", (s) => s.getAll()).then((v) => v || []);
const get = (store, key) => req(store, "readonly", (s) => s.get(key));
const put = (store, value) => req(store, "readwrite", (s) => s.put(value));
const del = (store, key) => req(store, "readwrite", (s) => s.delete(key));

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
  try { await (await dir()).removeEntry(name); } catch (e) { /* already gone */ }
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
async function markHanded(name) {
  const handed = pruneHanded(await metaGet("handed", {}), Date.now());
  handed[name] = nowIso();
  await metaPut("handed", handed);
}
/** An old version or a removed copy: gone now, or - handed to the takeoff app lately - at a sweep after the grace. */
async function retire(name) {
  if (name && !(await handedLately(name))) await removeFile(name);
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

/** This person's saved plans, each with {status, job: {done, size, rate} | null}, newest project first. */
export async function list() {
  const who = owner();
  if (!who || !supported()) return [];
  const held = await heldLocks();
  const all = (await getAll("plans")).filter((r) => r.owner === who);
  return all.map(function (r) {
    const here = jobs[r.key];
    const there = remote[r.key] && Date.now() - remote[r.key].at < 30000 ? remote[r.key] : null;
    const running = !!(held ? held[r.key] : there);
    const job = here ? { done: here.done, size: here.size, rate: here.rate } : running && there ? there : null;
    return Object.assign({}, r, { status: statusOf(r, here && !here.finished ? here : null, running), job });
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
  if (!(await canWrite())) throw err("unsupported", UNSUPPORTED);
  const who = owner();
  if (!who) throw err("signin", "Sign in first.");
  const f = info && info.file;
  if (!f || !f.id) throw err("bad", "No plan file to save.");
  const key = keyOf(f.id, who);
  let r = await get("plans", key);
  if (!r) {
    r = { key, owner: who, itemId: f.id, projectId: String(info.projectId), number: String(info.number || ""),
      projectTitle: String(info.projectTitle || ""), name: f.name, folder: f.folder || "", file: "", size: 0, modified: null,
      version: "", savedAt: "", dl: null, latest: null };
  } else {
    r.projectTitle = String(info.projectTitle || r.projectTitle || "");
    if (r.dl && r.dl.userPaused) r.dl.userPaused = false;     // saved again: carry on
    if (r.dl && r.dl.state === "error") r.dl = null;           // tried again: from a fresh link
  }
  await put("plans", r);
  changed(key);
  return download(key);
}

/** Download a saved plan again now (a newer version, a paused or stopped download). */
export function resume(itemId) { return download(keyOf(itemId)); }

function download(key) {
  if (jobs[key] && jobs[key].promise) return jobs[key].promise;
  const job = jobs[key] = jobs[key] || { done: 0, size: 0, rate: 0 };
  job.cancelRequested = false;
  const p = (async function () {
    try {
      if (HAS && navigator.onLine === false) throw err("offline", "You're offline. Downloads need the internet; your saved copies still open.");
      if (!(await canWrite())) throw err("unsupported", UNSUPPORTED);
      if (navigator.locks && navigator.locks.request) {
        return await navigator.locks.request(LOCK + key, { ifAvailable: true }, function (lock) {
          if (!lock) throw err("busy", "This plan is already downloading in another portal window.");
          return run(key);
        });
      }
      return await run(key);
    } catch (x) {
      await noteFailure(key, x);
      throw x;
    }
  })();
  job.promise = p;
  function cleanup() { if (jobs[key] && jobs[key].promise === p) delete jobs[key]; changed(key); }
  p.then(cleanup, cleanup);
  return p;
}

/* A download that fails before a single byte arrives (offline, no room, no access) must not leave a record that reads as
   saved: it is marked as stopped or paused, with the reason. A copy already on the device keeps opening. */
async function noteFailure(key, x) {
  const code = x && x.code;
  if (code === "busy" || code === "removed") return;
  try {
    const r = await get("plans", key);
    if (!r) return;
    if (code === "forbidden") r.latest = { status: "denied", checkedAt: nowIso() };
    if (!r.dl && !r.file) {
      const retry = code === "offline" || code === "busy_onedrive" || code === "paused";
      r.dl = { file: "", done: 0, size: 0, version: "", state: retry ? "paused" : "error", userPaused: false,
        error: (x && x.message) || "The download did not start." };
    }
    await put("plans", r);
  } catch (e) { /* the message has already reached the person */ }
}

const linkError = (x) => (x && x.code === "busy" ? err("busy_onedrive", x.message || "OneDrive is busy just now.") : x);

async function run(key) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const job = jobs[key] || {};
    let r = await get("plans", key);
    if (!r) throw err("removed", "That saved plan was removed.");
    let link;
    try {
      link = await onedrive.planLink(r.projectId, r.itemId);
    } catch (x) {
      const code = x && x.code;
      if (code === "not_found") {
        const g = await get("plans", key);
        if (!g) throw err("removed", "That saved plan was removed.");
        g.latest = { status: "gone", checkedAt: nowIso() };
        if (g.dl && g.dl.file) await removeFile(g.dl.file);
        g.dl = g.file ? null : { file: "", done: 0, size: 0, version: "", state: "error", error: "This file is no longer in OneDrive." };
        await put("plans", g);
        throw err("gone", "This file is no longer in OneDrive.");
      }
      if (code === "forbidden") throw err("forbidden", x.message || "Your account cannot open this plan file.");
      if (code === "offline") throw err("offline", x.message);
      throw linkError(x);
    }
    // asking for the link took a moment: work on the record as it is now (another window may have removed it)
    r = await get("plans", key);
    if (!r) throw err("removed", "That saved plan was removed.");
    const ver = { version: link.version, size: Number(link.size) || 0, modified: link.modified, name: link.name, folder: link.folder };
    if (r.file && r.version === ver.version && (await fileOk(r.file, r.size))) {
      // already the version OneDrive holds, and really on the device: nothing to fetch
      r.latest = Object.assign({ status: "ok", checkedAt: nowIso() }, ver);
      if (r.dl && r.dl.file && r.dl.file !== r.file) await removeFile(r.dl.file);
      r.dl = null;
      await put("plans", r);
      return { already: true };
    }
    if (!(ver.size > 0)) throw err("failed", "OneDrive did not say how big this file is.");
    let dl = r.dl && r.dl.file && r.dl.version === ver.version && r.dl.file !== r.file ? r.dl : null;
    if (!dl) {
      if (r.dl && r.dl.file && r.dl.file !== r.file) await removeFile(r.dl.file);   // part of an older version
      // never the saved copy's own file: it keeps opening until the new one is whole
      let name = fileNameFor(r.owner, r.itemId, ver.version);
      if (name === r.file) name = name.replace(/\.takeoff$/, "-" + Date.now().toString(36) + ".takeoff");
      dl = Object.assign({ file: name, done: 0, startedAt: nowIso() }, ver);
    }
    let est = null;
    try { est = await navigator.storage.estimate(); } catch (e) { est = null; }
    const need = ver.size - (Number(dl.done) || 0);
    if (est && est.quota && need > est.quota - est.usage - SPACE_MARGIN) {
      throw err("space", "Not enough room on this device: this file needs " + fmtSize(need) + " and about " +
        fmtSize(Math.max(0, est.quota - est.usage - SPACE_MARGIN)) + " is free for the portal. Remove a saved plan or free up space, then try again.");
    }
    try { if (navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* the browser decides */ }
    r = await get("plans", key);
    if (!r) throw err("removed", "That saved plan was removed.");
    if (job.cancelRequested) {
      // Pause pressed before the download really started: nothing is fetched
      r.dl = Object.assign(dl, { state: "paused", error: "", userPaused: true });
      await put("plans", r);
      return { paused: true };
    }
    r.dl = Object.assign(dl, { state: "running", error: "", userPaused: false });
    await put("plans", r);
    changed(key);

    let w;
    try {
      w = await runWorker(r, dl, link.url);
    } catch (x) {
      const cur = await get("plans", key);
      if (!cur) { await removeFile(dl.file); throw err("removed", "That saved plan was removed."); }
      r = cur;
      if (!r.dl) r.dl = dl;
      r.dl.done = x.done != null ? x.done : r.dl.done;
      if (x.status === 404) {
        await removeFile(r.dl.file);
        r.latest = { status: "gone", checkedAt: nowIso() };
        r.dl = r.file ? null : { file: "", done: 0, size: 0, version: "", state: "error", error: "This file is no longer in OneDrive." };
        await put("plans", r);
        throw err("gone", "This file is no longer in OneDrive.");
      }
      if ((x.status === 416 || x.changed) && attempt === 0) {
        // the file changed in OneDrive mid-download: start again, once
        await removeFile(r.dl.file);
        r.dl = null;
        await put("plans", r);
        continue;
      }
      // A dropped connection or a OneDrive hiccup is a pause that carries on by itself; running out of room, or
      // anything else, is a stop with its reason.
      const retryable = x.status !== 507 && ((HAS && navigator.onLine === false) || !x.status || x.status >= 500 ||
        /connection|stalled|stopped responding|link expired/i.test(x.message || ""));
      r.dl.state = retryable ? "paused" : "error";
      r.dl.error = x.message || "The download stopped.";
      await put("plans", r);
      throw err(retryable ? "paused" : "failed", r.dl.error);
    }
    // removed from another window while this one was downloading: what was written here goes too
    const now1 = await get("plans", key);
    if (!now1) { await removeFile(dl.file); return { removed: true }; }
    r = now1;
    if (w.paused) {
      if (r.dl) {
        r.dl.state = "paused"; r.dl.done = w.done; r.dl.error = ""; r.dl.userPaused = true;
        await put("plans", r);
      }
      return { paused: true };
    }
    if (w.magic !== MAGIC) {
      await removeFile(dl.file);
      r.dl = Object.assign({}, dl, { state: "error", done: 0, error: "What downloaded is not a takeoff project file." });
      await put("plans", r);
      throw err("failed", r.dl.error);
    }
    const old = r.file;
    r.file = dl.file;
    r.name = ver.name || r.name;
    r.folder = ver.folder || r.folder;
    r.size = ver.size; r.modified = ver.modified; r.version = ver.version;
    r.savedAt = nowIso();
    r.dl = null;
    r.latest = Object.assign({ status: "ok", checkedAt: nowIso() }, ver);
    await put("plans", r);
    if (old && old !== r.file) await retire(old);
    changed(key);
    return { saved: true };
  }
  throw err("changed", "The file kept changing in OneDrive while it was downloading. Try again in a minute.");
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
          get("plans", key).then(function (cur) {
            if (j.finished) return null;             // run() writes the final record then
            if (cur && cur.dl && cur.dl.file === dl.file) { cur.dl.done = m.done; return put("plans", cur); }
            return null;
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
      reject(Object.assign(new Error("The download stopped (" + ((ev && ev.message) || "the worker failed") + ")."), { done: j.done }));
    };
    w.postMessage({ op: "start", id: key, file: dl.file, url, size: dl.size, from: dl.done || 0 });
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
export async function remove(itemId) {
  const key = keyOf(itemId);
  pause(key, true);
  if (jobs[key] && jobs[key].promise) {
    try { await jobs[key].promise; } catch (e) { /* it stopped; that is all that was wanted */ }
  }
  await downloadReleased(key, 15000);
  const r = await get("plans", key);
  if (!r) return;
  await del("plans", key);
  if (r.dl && r.dl.file && r.dl.file !== r.file) await removeFile(r.dl.file);
  if (r.file) await retire(r.file);
  changed(key);
}

/* ── housekeeping ──────────────────────────────────────────────────────── */

/** Files nobody points at any more: an old version after an update, a part left by a closed window, a copy whose
    record was removed elsewhere - except a copy handed to the takeoff app within the grace. */
export async function sweep() {
  if (!supported()) return;
  const all = await getAll("plans");
  const handed = pruneHanded(await metaGet("handed", {}), Date.now());
  await metaPut("handed", handed);
  const keep = keepSet(all, handed, Date.now());
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
      const cur = await get("plans", r.key);
      if (cur && cur.file === r.file) {
        cur.file = ""; cur.version = ""; cur.savedAt = "";
        await put("plans", cur);
        changed(r.key);
      }
    }
  }
}

/* ── new versions ──────────────────────────────────────────────────────── */

/** Ask OneDrive for the version of every saved plan of this person -> {checked, updates, gone, denied}. */
export async function checkUpdates() {
  const who = owner();
  if (!who) throw err("signin", "Sign in first.");
  if (HAS && navigator.onLine === false) throw err("offline", "You're offline — new versions are checked when you're back online.");
  const mine = (await getAll("plans")).filter((r) => r.owner === who);
  const sum = { checked: 0, updates: 0, gone: 0, denied: 0 };
  const at = nowIso();
  for (const ids of projectBatches(mine, onedrive.LIST_BATCH)) {
    let answer;
    try {
      answer = await onedrive.plansList(ids);
    } catch (x) {
      if (x && x.code === "forbidden") answer = {};           // prices taken away: nothing is visible any more
      else throw x;
    }
    for (const r of mine.filter((m) => ids.indexOf(Number(m.projectId)) !== -1)) {
      const cur = await get("plans", r.key);
      if (!cur) continue;
      const next = applyCheck(cur, answer[String(cur.projectId)] || null, at);
      await put("plans", next);
      sum.checked++;
      if (next.latest.status === "gone") sum.gone++;
      else if (next.latest.status === "denied") sum.denied++;
      else if (next.file && next.latest.version !== next.version) sum.updates++;
      changed(r.key);
    }
  }
  await metaPut("check:" + who, at);
  return sum;
}

let working = null;
/** The saved plans that need it download again, one at a time (a phone is not asked for three big files at once). */
export function autoWork() {
  if (working) return working;
  working = (async function () {
    const who = owner();
    if (!who) return;
    const held = (await heldLocks()) || {};
    const todo = (await getAll("plans")).filter((r) => r.owner === who && needsWork(r) && !jobs[r.key] && !held[r.key]);
    for (const r of todo) {
      if (HAS && navigator.onLine === false) return;
      try { await download(r.key); } catch (x) {
        if (x && (x.code === "offline" || x.code === "unsupported" || x.code === "space")) return;
      }
    }
  })().finally(function () { working = null; });
  return working;
}

/** On a portal page, for a person who sees prices, online, with plans saved: ask for new versions when the last
    check is CHECK_EVERY_MS old, then download what needs it - quietly (a failure waits for the next page). */
export async function maybeCheck(me, opts) {
  try {
    if (!planFilesFor(me) || !supported() || (HAS && navigator.onLine === false)) return;
    const who = owner();
    if (!who || (me && me.id && me.id !== who)) return;
    const mine = (await getAll("plans")).filter((r) => r.owner === who);
    if (!mine.length) return;
    await verifyFiles();
    if ((opts && opts.force) || dueForCheck(await lastChecked(), Date.now())) await checkUpdates();
    await autoWork();
  } catch (e) { /* the next page asks again */ }
}

/* ── opening in the takeoff app ────────────────────────────────────────── */

/** Open a saved copy in the takeoff app (new tab). Call IN the click. onDone({ok, why, error}). */
export function open(itemId, onDone) {
  const key = keyOf(itemId);
  openInTakeoff(async function () {
    const r = await get("plans", key);
    if (!r || !r.file) throw err("missing", "This plan has not finished downloading on this device yet.");
    const f = await fileOf(r.file);
    if (!f) throw err("missing", "This saved plan is no longer on this device. Save it again from 📐 while online.");
    if (Number(r.size) > 0 && f.size !== Number(r.size)) throw err("missing", "This saved plan did not finish downloading. It carries on while the portal is open and online.");
    await markHanded(r.file);
    const t = Date.parse(r.modified || "");
    return { kind: "file", file: f, name: r.name, size: f.size, lastModified: isFinite(t) ? t : 0, number: r.number,
      updateAvailable: statusOf(r, null, false) === "outdated" };
  }, null, onDone);
}

/** Open a plan in OneDrive in the takeoff app over byte ranges (online; nothing saved). Call IN the click. */
export function openOnline(projectId, number, file, onDone) {
  openInTakeoff(async function () {
    const l = await onedrive.planLink(projectId, file.id);
    const t = Date.parse(l.modified || "");
    return { kind: "link", url: l.url, name: l.name, size: Number(l.size) || 0, lastModified: isFinite(t) ? t : 0, number: String(number || "") };
  }, async function () {
    return (await onedrive.planLink(projectId, file.id)).url;
  }, onDone);
}
