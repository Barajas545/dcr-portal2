/* The takeoff app's own storage on THIS site (owner decision Q4, 2026-11-04: on a phone or a tablet the portal shows its
   own copy of takeoff-web, site/takeoff/, in a frame - js/plan-frame.js - so that copy keeps its things on the portal's
   site, beside the Plans Library).

   Plan files carry prices, and so does what the takeoff app keeps of them (its drafts carry every item's unit_cost).
   So when the portal takes plans away from a person whose Sees prices was turned off (js/plan-library.js purgeOwner:
   contract C3, "the purge on lost prices"), the takeoff app's own copies on this site go too:
     · IndexedDB "ptt-drafts"          the unsaved work it keeps for a project (takeoff-web js/core/drafts.js);
     · the private file system's folder "plans-kept"   its File › Keep on This Device copies (js/core/device-plans.js
                                       KEPT_DIR), with their index in localStorage "ptt.keptPlans.v1";
     · localStorage "ptt.recent.v1"    the names of the plans opened lately (js/main.js RECENT_KEY);
     · IndexedDB "ptt-plans-archive"   its Plans Archive's folder handles and the archive files opened lately (names,
                                       paths: js/core/plans-folder.js idbBackend) - never written inside the frame, but
                                       /takeoff/ opened as a tab of its own on a computer's Chrome or Edge writes it here.
   (takeoff-web's own list of them: its iPad review notes for the portal, 2026-11-04.)
   These are the DEVICE's, not one person's (the app has no sign-in): on a shared tablet they go for everyone - the
   only way the prices in them leave with the person who lost them. Its settings and its own price catalog
   ("ptt.catalog.user.v1") are left as they are (no plan's detail; the owner decides).

   Whose: localStorage USERS_KEY holds only the user ids that opened the takeoff app in the frame here (no file, name
   or link), so a page that reads a person's profile online can tell, without opening anything, that the takeoff app's
   stores may hold what that person may no longer see (js/plan-library.js maybeCheck, js/pages/plan-buttons.js
   keepPlansFresh, js/sb.js forgetSavedPlans).

   Every function takes its storage as arguments (the OPFS root, an IndexedDB factory, a localStorage-like store) with
   the browser's as the default, so the node tests drive it with made-up ones. */

export const DRAFTS_DB = "ptt-drafts";
export const DRAFTS_STORE = "drafts";
export const ARCHIVE_DB = "ptt-plans-archive";
export const ARCHIVE_STORE = "kv";
export const KEPT_DIR = "plans-kept";
export const TAKEOFF_KEYS = Object.freeze(["ptt.keptPlans.v1", "ptt.recent.v1"]);
export const USERS_KEY = "dcr2-takeoff-users";
/** How long the purge waits for the drafts' database to go (the takeoff app may hold it open in a frame: then its
    records are cleared now, and the database itself goes once the app closes). */
export const DRAFTS_WAIT_MS = 5000;

function local() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; }
}

/** The user ids that opened the takeoff app in the frame on this device. */
export function takeoffUsers(store) {
  const s = store || local();
  try {
    const v = JSON.parse((s && s.getItem(USERS_KEY)) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : [];
  } catch (e) { return []; }
}

/** This person opened the takeoff app in the frame here (a hint only: ids, never more). */
export function noteTakeoffUser(id, store) {
  const s = store || local();
  if (!s || !id) return;
  try {
    const set = takeoffUsers(s).filter((x) => x !== id);
    set.push(String(id));
    s.setItem(USERS_KEY, JSON.stringify(set.slice(-20)));
  } catch (e) { /* a hint only */ }
}

/** A database's records cleared through a connection of our own (no version change: the app's own stays open). */
function clearStore(idb, name, store) {
  return new Promise(function (resolve, reject) {
    let r;
    try { r = idb.open(name); } catch (e) { reject(e); return; }
    r.onsuccess = function () {
      const d = r.result;
      try {
        if (!d.objectStoreNames.contains(store)) { d.close(); resolve(); return; }
        const tx = d.transaction(store, "readwrite");
        tx.objectStore(store).clear();
        tx.oncomplete = function () { try { d.close(); } catch (e) { /* */ } resolve(); };
        tx.onerror = tx.onabort = function () { try { d.close(); } catch (e) { /* */ } reject(tx.error); };
      } catch (e) { try { d.close(); } catch (x) { /* */ } reject(e); }
    };
    r.onerror = function () { reject(r.error); };
  });
}

/** The drafts' database deleted (-> "deleted"), or - held open by the app in a frame - its records cleared now and the
    database deleted once the app lets go ("cleared"); "waiting" / "failed" when neither could be done in time. */
export function dropDrafts(idb, wait) {
  return dropDb(idb, DRAFTS_DB, DRAFTS_STORE, wait);
}

/** The takeoff app's database `name` deleted, as dropDrafts (its one store `store` cleared when the app holds it). */
function dropDb(idb, name, store, wait) {
  const f = idb || (typeof indexedDB !== "undefined" ? indexedDB : null);
  if (!f || typeof f.deleteDatabase !== "function") return Promise.resolve("none");
  return new Promise(function (resolve) {
    let done = false;
    const finish = function (how) { if (!done) { done = true; clearTimeout(t); resolve(how); } };
    const t = setTimeout(function () { finish("waiting"); }, wait === undefined ? DRAFTS_WAIT_MS : wait);
    let r;
    try { r = f.deleteDatabase(name); } catch (e) { finish("failed"); return; }
    r.onsuccess = function () { finish("deleted"); };
    r.onerror = function () { finish("failed"); };
    // the request stays queued: it deletes the database once the app's connection closes
    r.onblocked = function () { clearStore(f, name, store).then(function () { finish("cleared"); }, function () { finish("waiting"); }); };
  });
}

/**
 * Everything the takeoff app keeps of plans on this site goes (see the header). env: {root: the OPFS root (or a
 * promise of it), idb, store, wait} - the browser's by default. -> {kept, drafts, archive, keys}. Never throws; USERS_KEY is
 * emptied once all of it went (a part that could not go keeps the hint, so the next online page tries again).
 */
export async function purgeTakeoffStores(env) {
  const e = env || {};
  const store = e.store || local();
  const out = { kept: "none", drafts: "none", archive: "none", keys: 0 };
  try {
    const root = e.root ? await e.root : (typeof navigator !== "undefined" && navigator.storage && navigator.storage.getDirectory
      ? await navigator.storage.getDirectory() : null);
    if (root) {
      try {
        await root.removeEntry(KEPT_DIR, { recursive: true });
        out.kept = "removed";
      } catch (x) {
        out.kept = x && x.name === "NotFoundError" ? "none" : "failed";
      }
    }
  } catch (x) { out.kept = "failed"; }
  out.drafts = await dropDrafts(e.idb, e.wait);
  out.archive = await dropDb(e.idb, ARCHIVE_DB, ARCHIVE_STORE, e.wait);
  const gone = (how) => how === "deleted" || how === "none" || how === "cleared";
  if (store) {
    TAKEOFF_KEYS.forEach(function (k) {
      try { if (store.getItem(k) !== null) { store.removeItem(k); out.keys++; } } catch (x) { /* */ }
    });
    if (out.kept !== "failed" && gone(out.drafts) && gone(out.archive)) {
      try { store.removeItem(USERS_KEY); } catch (x) { /* */ }
    }
  }
  return out;
}
