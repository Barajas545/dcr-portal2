/**
 * A safety net for work that has not been saved yet.
 *
 * On a phone the tab does not close, it is DISCARDED. iOS reclaims a
 * backgrounded Safari tab under memory pressure and reloads it from scratch
 * when you come back — no `beforeunload`, no prompt, no warning. An hour of
 * takeoff measured on a job site goes with it.
 *
 * So every time the page is hidden, the project's measurements, annotations
 * and metadata are written to IndexedDB. Not the sheets: those are pixels,
 * they are already in the file on disk, and they are what make a project
 * gigabytes. What is written is only the work — a few megabytes at most, and
 * a few kilobytes on a typical job.
 *
 * A draft is keyed to the file it came from (name and byte length), so
 * reopening that file is what offers it back. It is never restored silently.
 */

const DB_NAME = 'ptt-drafts';
const STORE = 'drafts';
const VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('draft store blocked'));
  });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/**
 * The key for a project file. Name plus size, because a phone has no path
 * and two jobs can share a name across folders but rarely a byte length too.
 */
export function draftKey(fileName, fileSize) {
  return `${fileName || 'untitled'}|${fileSize || 0}`;
}

/**
 * Write the work — never the pixels.
 *
 * `payload` is whatever the project's own save builder produced: metadata,
 * measurements and annotations. It is stored as a live object, not JSON: the
 * structured clone is faster and never materialises a 50 MB string on a page
 * that is being hidden and may have milliseconds left.
 */
export async function putDraft(key, payload, info = {}) {
  if (!key || !payload) return false;
  try {
    await tx('readwrite', st => st.put({
      key, payload, savedAt: Date.now(), ...info,
    }, key));
    return true;
  } catch {
    return false;             // a full or blocked store must never throw here
  }
}

export async function getDraft(key) {
  if (!key) return null;
  try {
    return (await tx('readonly', st => st.get(key))) || null;
  } catch {
    return null;
  }
}

export async function dropDraft(key) {
  if (!key) return;
  try {
    await tx('readwrite', st => st.delete(key));
  } catch { /* nothing to do about it */ }
}

/** Every draft, newest first — for a "what was I working on?" list. */
export async function listDrafts() {
  try {
    const all = await tx('readonly', st => st.getAll());
    return (all || []).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  } catch {
    return [];
  }
}
