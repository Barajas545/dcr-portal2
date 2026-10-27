/* The project pictures of the Plans Library (the owner, 2026-10-27: "use the project thumbnail related to that
   project"): the picture of each project with a plan saved here, kept on this device so the page shows it with no
   signal too.

   * shown(ids)     {projectId: object URL} of the pictures kept here for these projects (none: absent);
   * refresh(ids)   online: each project's picture now (repo/projects.js pictureIds, then repo/files.js
                    thumbnailUrls: a signed link), its bytes fetched once per picture and kept; a project whose
                    picture was taken off, that is no longer visible, or that is no longer among `ids` (no plan of
                    this person's saved here) loses its kept one. -> as shown(ids);
   * forgetAll()    every kept picture off this device (a person who no longer opens plan files).

   Nothing here is a plan or a price: the same pictures Search and the project page show anyone who sees the project,
   kept in IndexedDB "dcr2-plan-pictures" (key: the project id; {pid, fileId, blob}). Storage that fails (a private
   window) keeps nothing and shows what came online. Nothing here throws. */

import * as projectsRepo from "./repo/projects.js";
import * as filesRepo from "./repo/files.js";

const DB = "dcr2-plan-pictures";
const STORE = "pics";
/** A picture larger than this is not kept (thumb-prep.js makes them at most 800 px: far smaller). */
const MAX_BYTES = 3 * 1024 * 1024;

// project id -> {fileId, url, own}: what this page shows - an object URL it made (own: it lives with the page), or the
// signed link itself when the bytes could not be fetched to keep (shown online, kept next time)
const urls = new Map();
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise(function (res, rej) {
      if (typeof indexedDB === "undefined") { rej(new Error("no IndexedDB")); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () {
        const d = r.result;
        d.onversionchange = function () { d.close(); dbp = null; };
        d.onclose = function () { dbp = null; };
        res(d);
      };
      r.onerror = function () { rej(r.error); };
      r.onblocked = function () { rej(new Error("blocked")); };
    }).catch(function (e) { dbp = null; throw e; });
  }
  return dbp;
}

/** One transaction: fn(store) -> a request whose result is answered once the transaction completes, or nothing. */
function tx(mode, fn) {
  return open().then(function (d) {
    return new Promise(function (res, rej) {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = function () { res(req ? req.result : undefined); };
      t.onerror = t.onabort = function () { rej(t.error || new Error("aborted")); };
    });
  });
}

async function keptAll() {
  try {
    const all = await tx("readonly", function (s) { return s.getAll(); });
    return (all || []).filter(function (v) { return v && v.pid != null && v.fileId && v.blob && typeof v.blob.size === "number"; });
  } catch (e) { return null; }
}

function release(u) {
  if (u && u.own) URL.revokeObjectURL(u.url);
}

function urlFor(pid, fileId, blob) {
  const had = urls.get(pid);
  if (had && had.fileId === fileId && had.own) return had.url;
  release(had);
  const url = URL.createObjectURL(blob);
  urls.set(pid, { fileId, url, own: true });
  return url;
}

function drop(pid) {
  release(urls.get(pid));
  urls.delete(pid);
}

export async function shown(ids) {
  const want = new Set((ids || []).map(String));
  const out = {};
  // what this visit already shows (fetched just now, kept or not) first; then what is kept here
  urls.forEach(function (u, pid) { if (want.has(pid)) out[pid] = u.url; });
  (await keptAll() || []).forEach(function (v) {
    const pid = String(v.pid);
    if (want.has(pid) && !out[pid]) out[pid] = urlFor(pid, String(v.fileId), v.blob);
  });
  return out;
}

export async function refresh(ids) {
  const list = Array.from(new Set((ids || []).map(String)));
  let pics;
  try { pics = await projectsRepo.pictureIds(list); } catch (e) { return shown(list); }     // offline, or no answer
  const byId = {};
  pics.forEach(function (p) { byId[p.id] = p; });
  const kept = await keptAll();
  const keptBy = {};
  (kept || []).forEach(function (v) { keptBy[String(v.pid)] = v; });
  const need = pics.filter(function (p) {
    if (!p.thumbnailFileId) return false;
    const k = keptBy[p.id], u = urls.get(p.id);
    return !(k && String(k.fileId) === p.thumbnailFileId) && !(u && u.fileId === p.thumbnailFileId);
  });
  let signed = {};
  if (need.length) { try { signed = await filesRepo.thumbnailUrls(need); } catch (e) { signed = {}; } }
  for (const p of need) {
    const link = signed[p.id];
    if (!link) continue;
    let blob = null;
    if (/^https:\/\//.test(link)) {                        // Storage's signed link (the demo's data: one is only shown)
      try {
        const r = await fetch(link, { cache: "no-store" });
        blob = r.ok ? await r.blob() : null;
      } catch (e) { blob = null; }
    }
    if (!blob || !/^image\//.test(blob.type) || !blob.size || blob.size > MAX_BYTES) {
      // not kept (the next visit tries again): shown from its link while online
      release(urls.get(p.id));
      urls.set(p.id, { fileId: p.thumbnailFileId, url: link, own: false });
      continue;
    }
    urlFor(p.id, p.thumbnailFileId, blob);
    if (kept) {
      try { await tx("readwrite", function (s) { s.put({ pid: p.id, fileId: p.thumbnailFileId, blob }, p.id); }); } catch (e) { /* shown, not kept */ }
    }
  }
  // what is no longer this list's picture goes
  const gone = new Set();
  Object.keys(keptBy).forEach(function (pid) {
    const p = byId[pid];
    if (list.indexOf(pid) === -1 || !p || !p.thumbnailFileId) gone.add(pid);
  });
  urls.forEach(function (u, pid) {
    const p = byId[pid];
    if (list.indexOf(pid) === -1 || !p || !p.thumbnailFileId) gone.add(pid);
  });
  if (gone.size) {
    try { await tx("readwrite", function (s) { gone.forEach(function (pid) { s.delete(pid); }); }); } catch (e) { /* the next refresh */ }
    gone.forEach(drop);
  }
  return shown(list);
}

export async function forgetAll() {
  urls.forEach(release);
  urls.clear();
  try { await tx("readwrite", function (s) { s.clear(); }); } catch (e) { /* nothing kept */ }
}
