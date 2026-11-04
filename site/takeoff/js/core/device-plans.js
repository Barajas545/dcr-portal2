/**
 * Plans kept on this device, so they open with no signal — the Plans Library's
 * job, carried on from the OneDrive Plans Archive once the old portal is gone
 * (the owner's Q20: takeoff-web and the Plans Library keep working, from
 * OneDrive).
 *
 * Two sets live in this origin's private file system (OPFS), which this app
 * shares with the old portal (same address, its own folder):
 *
 *   · **the old portal's saved copies** — folder "plans-library", its records
 *     in IndexedDB "dcr-plans-library", and a small read-only index the
 *     portal publishes in localStorage "dcr.plansLibrary.v1". They are
 *     mirrors of SharePoint files from before the plans moved. This app lists
 *     them for the person they belong to and opens them; once the plans come
 *     from the Plans Archive (and the portal's own page is retired) it is also
 *     the place that removes them, when the person says so.
 *
 *   · **this app's own kept copies** — folder "plans-kept", index in
 *     localStorage "ptt.keptPlans.v1": a plan opened from the Plans Archive
 *     folder, or picked in the OneDrive app on a phone, copied here by
 *     File › Keep on This Device. A kept copy is a snapshot: Save never writes
 *     into it (Save goes to Save As or a download, as for the portal's
 *     copies), and keeping the same version twice is one copy.
 *
 * Whose list: the portal's copies carry the portal account that saved them
 * (the `sub` of its sign-in token). After the old portal retires nobody signs
 * in there any more, so the last account seen on this device is remembered
 * (OWNER_KEY) and its copies stay listed — a phone keeps its person's plans.
 * Kept copies belong to the device, like a file in its Downloads.
 *
 * Every function takes its storage as arguments — the OPFS root directory
 * handle, a localStorage-like store, Web Locks — so the Node tests drive it
 * with made-up handles and no browser. Nothing here touches the network.
 */

export const PORTAL_INDEX_KEY = 'dcr.plansLibrary.v1';
export const PORTAL_DIR = 'plans-library';
export const PORTAL_DB = 'dcr-plans-library';
export const PORTAL_TOKEN_KEY = 'dcr_portal_token';
export const OWNER_KEY = 'ptt.plansLibrary.owner';
export const KEPT_INDEX_KEY = 'ptt.keptPlans.v1';
export const KEPT_DIR = 'plans-kept';
export const PORTAL_FILE_RE = /^[A-Za-z0-9_-]+\.takeoff$/;
export const KEPT_FILE_RE = /^k[a-z0-9]+-[a-z0-9]+\.takeoff$/;
/** Held (shared) while a copy is open in a window; such a copy is never removed. The portal's name, kept. */
export const OPEN_LOCK = 'dcr-plans-open:';
/** Never fill the last of the browser's quota: a full origin breaks every other save too. */
export const SPACE_MARGIN = 64 * 1024 * 1024;

const coll = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function readJson(store, key) {
  try { return JSON.parse(store.getItem(key) || 'null'); } catch { return null; }
}

/** The `sub` in a sign-in token's payload, or '' (no token, not one, unreadable). Expiry is not checked. */
export function tokenSub(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))));
    const sub = payload ? payload.sub : null;
    return typeof sub === 'string' || typeof sub === 'number' ? String(sub) : '';
  } catch {
    return '';
  }
}

/**
 * Whose portal copies to list: the signed-in portal account, remembered as it
 * is seen; with no sign-in (a lapsed session, the portal retired), the last
 * one remembered on this device. { owner, remembered }.
 */
export function libraryOwner(store) {
  let token = '';
  try { token = store.getItem(PORTAL_TOKEN_KEY) || ''; } catch { token = ''; }
  const sub = tokenSub(token);
  if (sub) {
    try { if (store.getItem(OWNER_KEY) !== sub) store.setItem(OWNER_KEY, sub); } catch { /* storage full or blocked */ }
    return { owner: sub, remembered: false };
  }
  let last = '';
  try { last = store.getItem(OWNER_KEY) || ''; } catch { last = ''; }
  return { owner: last, remembered: !!last };
}

/** The owner's finished portal copies, sorted for the list; [] when none. */
export function portalCopies(store, owner) {
  if (!owner) return [];
  const index = readJson(store, PORTAL_INDEX_KEY);
  if (!index || index.v !== 1 || !Array.isArray(index.entries)) return [];
  const code = e => String(e.projectCode ?? '').trim();
  return index.entries
    .filter(e => e && typeof e === 'object'
      && e.status === 'ready'
      && e.owner != null && String(e.owner) === String(owner)
      && typeof e.file === 'string' && PORTAL_FILE_RE.test(e.file))
    .sort((a, b) => coll.compare(code(a), code(b)) || coll.compare(String(a.name ?? ''), String(b.name ?? '')));
}

function keptIndex(store) {
  const index = readJson(store, KEPT_INDEX_KEY);
  const entries = index && index.v === 1 && Array.isArray(index.entries) ? index.entries : [];
  return entries.filter(e => e && typeof e === 'object' && typeof e.file === 'string' && KEPT_FILE_RE.test(e.file)
    && typeof e.id === 'string');
}

function writeKeptIndex(store, entries) {
  store.setItem(KEPT_INDEX_KEY, JSON.stringify({ v: 1, entries }));
}

/** This device's kept copies, sorted by project number, then name. */
export function keptCopies(store) {
  const code = e => String(e.code ?? '').trim();
  return keptIndex(store)
    .sort((a, b) => coll.compare(code(a), code(b)) || coll.compare(String(a.name ?? ''), String(b.name ?? '')));
}

const newId = () => `k${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Is this copy open in a window right now (its lock held)? false when the browser cannot say. */
export async function copyInUse(locks, file) {
  if (!locks || typeof locks.query !== 'function') return false;
  try {
    const s = await locks.query();
    return [...(s.held || []), ...(s.pending || [])].some(l => l && l.name === OPEN_LOCK + file);
  } catch {
    return false;
  }
}

async function* chunksOf(file) {
  if (typeof file.stream === 'function') {
    const reader = file.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  }
  yield new Uint8Array(await file.arrayBuffer());
}

/**
 * Keep a plan on this device: its bytes into "plans-kept", then a line in the
 * index. The copy is checked by its size before the line is written, and a
 * copy that cannot be finished is removed again (only ever this app's own
 * file). The same version kept twice (name, size, date and project the same)
 * is the one copy. { entry, existed }.
 *
 *   meta: { name, code, project, path, from }   what the list shows
 *   estimate: () => { quota, usage }           navigator.storage.estimate, optional
 */
export async function keepFile({ root, store, file, meta = {}, estimate = null, now = () => Date.now(), makeId = newId }) {
  if (!file || !(Number(file.size) > 0)) throw new Error('There is nothing to keep: the plan file is empty.');
  const name = String(meta.name || file.name || 'Plan.takeoff');
  const lastModified = Number(file.lastModified) || 0;
  const code = String(meta.code || '').trim();
  const all = keptIndex(store);
  const same = all.find(e => e.name === name && Number(e.size) === Number(file.size)
    && Number(e.lastModified) === lastModified && String(e.code || '') === code);
  if (same) {
    let there = false;
    try { there = (await (await (await root.getDirectoryHandle(KEPT_DIR)).getFileHandle(same.file)).getFile()).size === Number(same.size); } catch { there = false; }
    if (there) return { entry: same, existed: true };
  }
  if (estimate) {
    let est = null;
    try { est = await estimate(); } catch { est = null; }
    if (est && Number(est.quota) > 0 && Number(est.quota) - Number(est.usage || 0) - SPACE_MARGIN < Number(file.size)) {
      throw new Error('This device does not have room for this plan. Remove a kept plan first.');
    }
  }
  const id = makeId();
  const fname = `${id}.takeoff`;
  const dir = await root.getDirectoryHandle(KEPT_DIR, { create: true });
  const fh = await dir.getFileHandle(fname, { create: true });
  let ok = false;
  try {
    const w = await fh.createWritable();
    try {
      for await (const chunk of chunksOf(file)) await w.write(chunk);
      await w.close();
    } catch (err) {
      try { await w.abort(); } catch { /* already closed */ }
      throw err;
    }
    const got = await fh.getFile();
    if (got.size !== Number(file.size)) throw new Error('The copy did not come out whole. Nothing was kept.');
    const entry = {
      id, file: fname, name, size: Number(file.size), lastModified, code,
      project: String(meta.project || ''), path: String(meta.path || ''), from: String(meta.from || ''),
      keptAt: now(),
    };
    writeKeptIndex(store, [...keptIndex(store), entry]);
    ok = true;
    return { entry, existed: false };
  } finally {
    if (!ok) { try { await dir.removeEntry(fname); } catch { /* not made */ } }
  }
}

/** The kept copy's File, or null when it is not on this device. */
export async function keptFile(root, entry) {
  if (!entry || !KEPT_FILE_RE.test(String(entry.file || ''))) return null;
  try {
    return await (await (await root.getDirectoryHandle(KEPT_DIR)).getFileHandle(entry.file)).getFile();
  } catch (err) {
    if (err && err.name === 'NotFoundError') return null;
    throw err;
  }
}

/**
 * Remove a kept copy (the person's own click). Refused while it is open in a
 * window. The plan itself stays in the Plans Archive. { removed }.
 */
export async function removeKept({ root, store, id, locks = null }) {
  const entry = keptIndex(store).find(e => e.id === id);
  if (!entry) return { removed: false };
  if (await copyInUse(locks, entry.file)) {
    throw new Error('This plan is open in Professional Takeoff Tools. Close it there first.');
  }
  try { await (await root.getDirectoryHandle(KEPT_DIR)).removeEntry(entry.file); } catch (err) {
    if (!err || err.name !== 'NotFoundError') throw err;
  }
  writeKeptIndex(store, keptIndex(store).filter(e => e.id !== id));
  return { removed: true };
}

/**
 * Remove one of the old portal's saved copies (the person's own click, once
 * the plans come from the Plans Archive and the portal's Plans Library page no
 * longer does it). The file, its line in the portal's index and — through
 * dropRecords(file), the portal's IndexedDB records — its record, so the
 * portal's page, while it is still there, does not bring the line back.
 * Refused while the copy is open in a window. { removed }.
 */
export async function removePortalCopy({ root, store, entry, locks = null, dropRecords = null }) {
  const file = String(entry && entry.file || '');
  if (!PORTAL_FILE_RE.test(file)) return { removed: false };
  if (await copyInUse(locks, file)) {
    throw new Error('This plan is open in Professional Takeoff Tools. Close it there first.');
  }
  try { await (await root.getDirectoryHandle(PORTAL_DIR)).removeEntry(file); } catch (err) {
    if (!err || err.name !== 'NotFoundError') throw err;
  }
  if (dropRecords) { try { await dropRecords(file); } catch { /* the portal's own sweep tidies a record later */ } }
  const index = readJson(store, PORTAL_INDEX_KEY);
  if (index && index.v === 1 && Array.isArray(index.entries)) {
    try {
      store.setItem(PORTAL_INDEX_KEY, JSON.stringify({ ...index, entries: index.entries.filter(e => !e || e.file !== file) }));
    } catch { /* storage blocked: the list follows once the portal rewrites it */ }
  }
  return { removed: true };
}

/** For the list: "1.2 GB", "340 KB". */
export function sizeText(bytes) {
  const n = Number(bytes);
  if (!(n > 0)) return '';
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
