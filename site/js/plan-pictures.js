/* The project pictures of the Plans Library (the owner, 2026-10-27: "use the project thumbnail related to that
   project"): the picture of each project with a plan saved here, kept on this device so the page shows it with no
   signal too - for each person apart, as the plans are (a shared tablet: one person's visit never takes another's).

   * shown(owner, ids)            {projectId: URL} of the pictures this page shows or this person keeps here for these
                                  projects (none: absent);
   * refresh(owner, ids, owners)  online: each project's picture now (repo/projects.js pictureIds, then repo/files.js
                                  thumbnailUrls: a fresh signed link), its bytes fetched once per picture and kept; one
                                  that could not be fetched keeps the picture kept before (or, with none, shows the link
                                  while online) and is fetched again at the next refresh. A project whose picture was
                                  taken off, that is no longer visible, or that is no longer among `ids` (no plan of this
                                  person's saved here) loses this person's kept one; so do the people no longer among
                                  `owners` (ownersHere: the ids with plans on this device). -> as shown(owner, ids);
   * forgetAll(owner)             this person's kept pictures off this device (they no longer open plan files).

   A picture replaced while the page shows it is let go at the next call, once the page has drawn what replaced it.
   Nothing here is a plan or a price: the same pictures Search and the project page show anyone who sees the project,
   kept in IndexedDB "dcr2-plan-pictures" (key "<owner>|<project id>"; {owner, pid, fileId, blob}). Storage that fails
   (a private window) keeps nothing and shows what came online. Nothing here throws. */

import * as projectsRepo from "./repo/projects.js";
import * as filesRepo from "./repo/files.js";

const DB = "dcr2-plan-pictures";
const STORE = "pics";
/** A picture larger than this is not kept (thumb-prep.js makes them at most 800 px: far smaller). */
const MAX_BYTES = 3 * 1024 * 1024;

// "<owner>|<pid>" -> {fileId, url, own}: what this page shows - an object URL it made (own: it lives with the page), or
// the signed link itself when the bytes could not be fetched to keep (shown online; fetched again at the next refresh)
const urls = new Map();
// object URLs replaced on this page: let go at the next call, once the page has drawn what replaced them
let retired = [];
let dbp = null;

const keyOf = (owner, pid) => String(owner) + "|" + String(pid);
const ownerOf = (key) => key.slice(0, key.indexOf("|"));
const pidOf = (key) => key.slice(key.indexOf("|") + 1);

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

/** Every kept picture (anyone's), or null when storage cannot be read. */
async function keptAll() {
  try {
    const all = await tx("readonly", function (s) { return s.getAll(); });
    return (all || []).filter(function (v) { return v && v.pid != null && v.fileId && v.blob && typeof v.blob.size === "number"; });
  } catch (e) { return null; }
}

function settle() {
  const r = retired;
  retired = [];
  r.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* gone */ } });
}

function release(u) {
  if (u && u.own) retired.push(u.url);
}

function show(key, fileId, blob) {
  const had = urls.get(key);
  if (had && had.own && had.fileId === fileId) return had.url;
  release(had);
  const url = URL.createObjectURL(blob);
  urls.set(key, { fileId, url, own: true });
  return url;
}

/** {pid: URL} for this person and these projects. `current` (refresh: pid -> the picture's file id now) or null (shown:
    not asked). What this page shows stays unless what is kept here is better: the page shows only a link, or an older
    picture than the one kept (another tab kept the new one) - the kept one opens with no signal too. */
async function collect(who, list, current) {
  const kept = {};
  ((await keptAll()) || []).forEach(function (v) { if (v.owner === who) kept[String(v.pid)] = v; });
  const out = {};
  list.forEach(function (pid) {
    const key = keyOf(who, pid), u = urls.get(key), k = kept[pid];
    if (u && u.own && (!k || u.fileId === String(k.fileId) || !current || current[pid] === u.fileId)) out[pid] = u.url;
    else if (k) out[pid] = show(key, String(k.fileId), k.blob);
    else if (u) out[pid] = u.url;
  });
  return out;
}

export async function shown(owner, ids) {
  settle();
  if (!owner) return {};
  return collect(String(owner), (ids || []).map(String), null);
}

export async function refresh(owner, ids, owners) {
  settle();
  if (!owner) return {};
  const who = String(owner);
  const list = Array.from(new Set((ids || []).map(String)));
  let pics;
  try { pics = await projectsRepo.pictureIds(list); } catch (e) { return collect(who, list, null); }    // offline, no answer
  const byId = {};
  const current = {};
  pics.forEach(function (p) { byId[p.id] = p; if (p.thumbnailFileId) current[p.id] = p.thumbnailFileId; });
  const all = await keptAll();
  const keptBy = {};
  (all || []).forEach(function (v) { if (v.owner === who) keptBy[String(v.pid)] = v; });
  const need = pics.filter(function (p) {
    if (!p.thumbnailFileId) return false;
    const k = keptBy[p.id], u = urls.get(keyOf(who, p.id));
    return !(k && String(k.fileId) === p.thumbnailFileId) && !(u && u.own && u.fileId === p.thumbnailFileId);
  });
  let signed = {};
  if (need.length) {
    filesRepo.forgetThumbnails();                          // fresh links: one that failed or ran out is signed again
    try { signed = await filesRepo.thumbnailUrls(need); } catch (e) { signed = {}; }
  }
  for (const p of need) {
    const key = keyOf(who, p.id);
    const link = signed[p.id];
    let blob = null;
    if (link && /^https:\/\//.test(link)) {                // Storage's signed link (the demo's data: one is only shown)
      try {
        const r = await fetch(link, { cache: "no-store" });
        blob = r.ok ? await r.blob() : null;
      } catch (e) { blob = null; }
    }
    if (blob && /^image\//.test(blob.type) && blob.size && blob.size <= MAX_BYTES) {
      show(key, p.thumbnailFileId, blob);
      if (all) {
        try {
          await tx("readwrite", function (s) { s.put({ owner: who, pid: p.id, fileId: p.thumbnailFileId, blob }, key); });
          keptBy[p.id] = { owner: who, pid: p.id, fileId: p.thumbnailFileId, blob };
        } catch (e) { /* shown, not kept */ }
      }
      continue;
    }
    // not fetched: the picture shown or kept before stays (it shows with no signal too); with none, the link itself while
    // online - fetched again at the next refresh
    const had = urls.get(key);
    if (link && !(had && had.own) && !keptBy[p.id]) urls.set(key, { fileId: p.thumbnailFileId, url: link, own: false });
  }
  // what is no longer this person's picture goes, and the pictures of people with no plan on this device any more
  const gone = new Set();
  const stale = function (pid) { const p = byId[pid]; return list.indexOf(pid) === -1 || !p || !p.thumbnailFileId; };
  Object.keys(keptBy).forEach(function (pid) { if (stale(pid)) gone.add(keyOf(who, pid)); });
  urls.forEach(function (u, key) { if (ownerOf(key) === who && stale(pidOf(key))) gone.add(key); });
  if (Array.isArray(owners)) {
    (all || []).forEach(function (v) {
      if (v.owner !== who && owners.indexOf(v.owner) === -1) gone.add(keyOf(v.owner, v.pid));
    });
  }
  if (gone.size) {
    try { await tx("readwrite", function (s) { gone.forEach(function (k) { s.delete(k); }); }); } catch (e) { /* the next refresh */ }
    gone.forEach(function (k) { release(urls.get(k)); urls.delete(k); });
  }
  return collect(who, list, current);
}

export async function forgetAll(owner) {
  settle();
  if (!owner) return;
  const who = String(owner);
  urls.forEach(function (u, key) { if (ownerOf(key) === who) { if (u.own) URL.revokeObjectURL(u.url); urls.delete(key); } });
  const all = await keptAll();
  const mine = (all || []).filter(function (v) { return v.owner === who; }).map(function (v) { return keyOf(who, v.pid); });
  if (!mine.length) return;
  try { await tx("readwrite", function (s) { mine.forEach(function (k) { s.delete(k); }); }); } catch (e) { /* nothing kept */ }
}
