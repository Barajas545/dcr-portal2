/**
 * Plan files from a folder on this computer — the Plans Archive.
 *
 * When the plans leave SharePoint they are kept in a synced OneDrive folder:
 * one folder per project, named by the project's number ("A249", or
 * "A249 - 12 Main St - Paso Robles - Smith" the way the office's desktop
 * program names them), with the .takeoff files in it and the older copies in
 * a Backups folder below. This module is everything about that folder that
 * is not a screen: finding the projects in it, listing one project's plan
 * files, remembering the folder on this device, and asking the browser for
 * permission to read and write it.
 *
 * It works through the File System Access API — a directory handle from
 * `showDirectoryPicker()`, kept in IndexedDB so the next visit needs no
 * picker, only the browser's own "allow" — and through nothing else. Every
 * function takes the handle it reads, so the Node tests drive it with
 * made-up handles and no browser.
 *
 * Four rules it keeps:
 *
 *   · **Nothing here writes into the folder.** Listing reads names and file
 *     sizes, never contents. The one write is the project file the user
 *     saves, and that goes through main.js's save, not through here.
 *
 *   · **A project is its number, exactly.** "A249" and "A249 - old name" are
 *     job A249; "A249-B", "A249B" and "A2490" are other jobs. The same rule
 *     the portal's plans menu has always used, so a folder that opened as
 *     A249 there opens as A249 here.
 *
 *   · **A project's takeoff files are the ones right in its folder.** A
 *     .takeoff in a sub-folder is never shown, and the older-copies folders
 *     (Backups, Archive, Old…) are never read at all — the owner, 2026-10-27:
 *     "do not show *.takeoff files inside any sub-folder". The portal's
 *     plans menu and its Plans Library list the same files.
 *
 *   · **Bounded.** A project folder is walked to a fixed depth, folder count
 *     and file count, so a whole synced tree dropped into the archive cannot
 *     turn one click into minutes of disk reads. What was cut is said.
 *
 *   · **A desktop project folder is not all plans.** In a folder laid out the
 *     way DCR Desktop 2 lays one out (Floor Plans, Photos, Documents), PDFs
 *     count as plans only under Floor Plans — a contract or an invoice in
 *     Documents is not a drawing — and Photos is never walked at all.
 */

// ── names ─────────────────────────────────────────────────────────────────

/**
 * A project number as the office keeps it: a capital letter, three or more
 * digits, and an optional suffix for a follow-up job at the same place —
 * "-" and one or two letters (A024-B) or "T" and a digit (A000T1). The same
 * text as DCR Desktop 2's database check.
 */
export const PROJECT_NUMBER = /^[A-Z][0-9]{3,}(?:-[A-Z]{1,2}|T[0-9])?$/;

/** En and em dashes read as plain hyphens: the owner typed some names with one. */
export function normDashes(s) {
  return String(s ?? '').replace(/[–—]/g, '-');
}

/**
 * The project number a folder is named by, or '' when it is not named like a
 * project folder. Only the first word counts, so "A249 - Smith" is A249 and
 * "A249-B - Smith" is A249-B.
 */
export function projectCodeOf(name) {
  const first = normDashes(name).trim().split(/\s+/)[0] || '';
  const code = first.toUpperCase();
  return PROJECT_NUMBER.test(code) ? code : '';
}

/** "A249 - 12 Main St - Paso Robles" → "12 Main St - Paso Robles": the name after the number. */
export function restOfName(name) {
  return String(name || '').trim().replace(/^\S+\s*(?:[-–—]\s*)?/, '').trim();
}

/**
 * A project number someone typed or a link carried, made into the form the
 * folders are matched with — or '' when it is not one. Never a pattern and
 * never a path: it is only ever compared with names the folder listed.
 */
export function parseProjectCode(text) {
  const t = normDashes(text).trim().toUpperCase();
  return t.length <= 16 && PROJECT_NUMBER.test(t) ? t : '';
}

/** "A024-B" → ["A", 24, "-B"], for sorting; null for anything else. */
function codeParts(code) {
  const m = /^([A-Z])([0-9]+)(.*)$/.exec(code || '');
  return m ? [m[1], Number(m[2]), m[3]] : null;
}

/**
 * Natural order: A000 < A000T1 < A001 < A024 < A024-B < A999 < A1000 — the
 * order DCR Desktop 2 lists projects in. A suffix comes right after its base.
 */
export function compareCodes(a, b) {
  const pa = codeParts(a), pb = codeParts(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  if (pa[0] !== pb[0]) return pa[0] < pb[0] ? -1 : 1;
  if (pa[1] !== pb[1]) return pa[1] - pb[1];
  if (pa[2] === pb[2]) return 0;
  if (!pa[2]) return -1;
  if (!pb[2]) return 1;
  // T1 before -B: both are rare beside each other, and this keeps it stable.
  const rank = s => (s[0] === 'T' ? 0 : 1);
  if (rank(pa[2]) !== rank(pb[2])) return rank(pa[2]) - rank(pb[2]);
  return pa[2] < pb[2] ? -1 : 1;
}

const COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export const byName = (a, b) => COLLATOR.compare(String(a.name), String(b.name));

/** What a file is to this app: a project, a drawing set, or nothing. */
export function fileKind(name) {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.takeoff') || n.endsWith('.pdfcache')) return 'takeoff';
  if (n.endsWith('.pdf')) return 'pdf';
  return null;
}

/**
 * Names that are never plans and never shown: hidden and system files, Office
 * lock files, half-written downloads and copies, the desktop program's own
 * autosaves. A name with a path separator in it cannot come from a real
 * listing and is refused too.
 */
export function isHiddenName(name) {
  const n = String(name || '');
  if (!n || /[\\/]/.test(n)) return true;
  if (n.startsWith('.') || n.startsWith('~$') || n.startsWith('$')) return true;
  const l = n.toLowerCase();
  if (l === 'desktop.ini' || l === 'thumbs.db') return true;
  return /\.(part|tmp|crdownload|autosave)$/.test(l);
}

/** Folders that hold older copies by what they are called, whatever their dates say: never read (walkPlans). */
export function isOlderCopiesFolder(name) {
  return /^(backups?|archived?|archives|old|superseded)$/i.test(String(name || '').trim());
}

/** DCR Desktop 2's folder for plans and drawings in a project folder. */
export const PLANS_DIR = 'Floor Plans';
const PHOTO_DIRS = /^(photos|pictures)$/i;
const DESK_SIBLINGS = /^(photos|pictures|documents|project documents)$/i;

// ── reading a folder ──────────────────────────────────────────────────────

/** Every entry of a directory handle, without letting one bad entry stop the rest. */
export async function entriesOf(dir) {
  const out = [];
  for await (const h of dir.values()) out.push(h);
  return out;
}

/**
 * The projects in a chosen folder: its sub-folders, sorted newest job first,
 * split into those named like a project and the rest. Reads one directory
 * listing — names only — however many projects there are.
 *
 *   { projects: [{ code, name, handle }], others: [{ name, handle }],
 *     files: [{ name, kind, handle }] }   loose plan files at the top
 */
export async function listTopFolders(root) {
  const projects = [], others = [], files = [];
  for (const h of await entriesOf(root)) {
    if (isHiddenName(h.name)) continue;
    if (h.kind === 'directory') {
      const code = projectCodeOf(h.name);
      if (code) projects.push({ code, name: h.name, handle: h });
      else others.push({ name: h.name, handle: h });
    } else if (h.kind === 'file') {
      const kind = fileKind(h.name);
      if (kind) files.push({ name: h.name, kind, handle: h });
    }
  }
  projects.sort((a, b) => compareCodes(b.code, a.code) || byName(a, b));
  others.sort(byName);
  files.sort(byName);
  return { projects, others, files };
}

/** The folders of a listing that are job `code`, exactly (see projectCodeOf). */
export function matchProject(projects, code) {
  const want = parseProjectCode(code);
  if (!want) return [];
  return (projects || []).filter(p => p && p.code === want);
}

/**
 * The OneDrive Plans Archive's marker file. DCR Desktop 2's documents copy
 * (tools/retire/copy_documents.mjs) writes it into the company OneDrive's
 * "DCR - Floor Plans - Archive" on its first plans copy — and never into
 * SharePoint's own folder of the same name, which a computer that syncs the
 * old SharePoint library also has. The browser's folder picker gives no full
 * path, so the two look the same here; a save into the SharePoint one would be
 * written into SharePoint by the sync client. Once plans come from the folder,
 * only a folder that holds this file is the Plans Archive.
 */
export const ARCHIVE_MARKER = '_DCR Plans Archive - OneDrive.txt';

/** Whether a folder is the OneDrive Plans Archive: it holds the marker. One lookup, no listing. */
export async function isOneDriveArchive(handle) {
  if (!handle || typeof handle.getFileHandle !== 'function') return false;
  try {
    const f = await handle.getFileHandle(ARCHIVE_MARKER);
    return !!f && f.kind !== 'directory';
  } catch {
    return false;
  }
}

/**
 * Whether the folder someone just chose looks like the archive, and if not,
 * which folder inside it does. Two levels of names, nothing more, and whether
 * it is the OneDrive one (the marker).
 *
 *   { projects, others, isProjectFolder, marker, suggestion: { name, handle, projects, marker } | null }
 *
 * `isProjectFolder` is a single job's folder chosen by mistake (its own name
 * is a project number). `suggestion` is offered only when the chosen folder
 * holds no project folders itself: the child holding the most.
 */
export async function describeChosenFolder(handle) {
  const top = await listTopFolders(handle);
  const out = {
    projects: top.projects.length,
    others: top.others.length,
    isProjectFolder: !!projectCodeOf(handle.name),
    marker: await isOneDriveArchive(handle),
    suggestion: null,
  };
  if (!out.projects) {
    let best = null;
    for (const o of top.others.slice(0, 40)) {
      let n = 0;
      try { n = (await listTopFolders(o.handle)).projects.length; } catch { n = 0; }
      if (n && (!best || n > best.projects)) best = { name: o.name, handle: o.handle, projects: n };
    }
    if (best) best.marker = await isOneDriveArchive(best.handle);
    out.suggestion = best;
  }
  return out;
}

/**
 * One project folder's plan files, as a tree:
 *
 *   { name, path, handle, files: [file], folders: [node], count, truncated? }
 *   file: { name, kind, size, lastModified, path, handle, dir }
 *
 * `path` is the folder's place inside the project folder ("Floor Plans /
 * Level 2"), for showing; `dir` is the folder handle a file sits in, which
 * Save As starts in. Files are newest first. Folders follow by name. Takeoff
 * files count only right in the project folder — one in a sub-folder never
 * does — and the older-copies folders (Backups…) are not read at all; a
 * sub-folder is walked for its drawings (PDFs). Folders with no plan file
 * anywhere below them are left out.
 *
 * `filesOnly`: the folder's own files and no sub-folder at all (the loose
 * files at the top of the archive, whose sub-folders are the projects).
 *
 * Bounded three ways — depth, folder listings and files — and `truncated`
 * says something was not looked at. A file that vanished between the listing
 * and its size being read (OneDrive moving it, someone deleting it) is
 * skipped, not an error.
 */
export async function walkPlans(dir, {
  maxDepth = 4, maxFiles = 400, maxFolders = 60, name = dir.name, filesOnly = false,
} = {}) {
  const budget = { listings: 0, files: 0 };

  async function walk(handle, nodeName, path, depth, rules) {
    const node = { name: nodeName, path, handle, files: [], folders: [], count: 0 };
    if (budget.listings >= maxFolders || budget.files >= maxFiles) {
      node.truncated = true;
      return node;
    }
    budget.listings += 1;
    let kids;
    try { kids = await entriesOf(handle); } catch { node.truncated = true; return node; }

    // Read the layout at the project folder itself: a desktop project folder
    // keeps its drawings in Floor Plans and much else besides.
    if (depth === 0) {
      const names = kids.filter(k => k.kind === 'directory').map(k => k.name);
      const desk = names.some(n => n.toLowerCase() === PLANS_DIR.toLowerCase())
        && names.some(n => DESK_SIBLINGS.test(n));
      rules = { desk, underPlans: false };
    }

    const subs = [];
    for (const k of kids) {
      if (isHiddenName(k.name)) continue;
      if (k.kind === 'directory') {
        if (filesOnly) continue;
        if (rules.desk && depth === 0 && PHOTO_DIRS.test(k.name)) continue;
        if (isOlderCopiesFolder(k.name)) continue;      // older copies: never shown, so never read
        subs.push(k);
        continue;
      }
      if (k.kind !== 'file') continue;
      const kind = fileKind(k.name);
      if (!kind) continue;
      if (kind === 'takeoff' && depth > 0) continue;   // a takeoff in a sub-folder is no plan of the project
      if (kind === 'pdf' && rules.desk && !rules.underPlans) continue;
      if (budget.files >= maxFiles) { node.truncated = true; continue; }
      budget.files += 1;
      let f;
      try { f = await k.getFile(); } catch { continue; }
      node.files.push({
        name: k.name, kind, size: f.size, lastModified: f.lastModified,
        path, handle: k, dir: handle,
      });
    }
    node.files.sort((a, b) => (b.lastModified - a.lastModified) || byName(a, b));

    if (subs.length && depth >= maxDepth) {
      node.truncated = true;
    } else {
      subs.sort(byName);
      for (const s of subs) {
        const sub = await walk(s, s.name, path ? `${path} / ${s.name}` : s.name, depth + 1, {
          desk: rules.desk,
          underPlans: rules.underPlans
            || (depth === 0 && s.name.toLowerCase() === PLANS_DIR.toLowerCase()),
        });
        if (sub.truncated) node.truncated = true;
        if (sub.count) node.folders.push(sub);
      }
      node.folders.sort(byName);
    }
    node.count = node.files.length + node.folders.reduce((n, f) => n + f.count, 0);
    return node;
  }

  return walk(dir, name, '', 0, { desk: false, underPlans: false });
}

/** Every file in a tree, newest first. */
export function filesOf(tree) {
  const out = [];
  (function go(n) {
    out.push(...n.files);
    n.folders.forEach(go);
  })(tree);
  return out.sort((a, b) => (b.lastModified - a.lastModified) || byName(a, b));
}

// ── what changed under an open project ────────────────────────────────────

/** What a file was when it was opened: enough to tell another save from ours. */
export function fileStamp(file) {
  return { size: Number(file?.size) || 0, lastModified: Number(file?.lastModified) || 0 };
}

/**
 * Has the file on disk changed since `stamp`? Someone else saved it on
 * another computer and OneDrive brought it down, or it was replaced from
 * Explorer. Either way, writing over it would lose that work without a word.
 */
export function changedSince(stamp, file) {
  if (!stamp || !file) return true;
  const now = fileStamp(file);
  return now.size !== stamp.size || now.lastModified !== stamp.lastModified;
}

// ── which way plans come in ───────────────────────────────────────────────

export const PLANS_SOURCES = ['sharepoint', 'folder'];

/**
 * 'folder' or 'sharepoint'. The person's own choice on this device wins; then
 * the company's (js/site-config.js); then the way it has always been.
 */
export function resolvePlansSource(personal, company) {
  if (PLANS_SOURCES.includes(personal)) return personal;
  if (PLANS_SOURCES.includes(company)) return company;
  return 'sharepoint';
}

/**
 * A link into the archive: `#plans` (browse it) or `#plans=A249` (that job's
 * plans), from the portal's search or anyone's bookmark. Null when the hash
 * says nothing of the kind. A number that is not one comes back as
 * `{ code: '', invalid: true }` — the link was meant for the archive, so it
 * still opens it, and says so.
 */
export function parsePlansLink(hash) {
  const m = /(?:^|[#&])plans(?:=([^&]*))?(?:&|$)/.exec(String(hash || ''));
  if (!m) return null;
  let raw;
  try { raw = decodeURIComponent(m[1] || ''); } catch { return { code: '', invalid: true }; }
  if (!raw.trim()) return { code: '' };
  const code = parseProjectCode(raw);
  return code ? { code } : { code: '', invalid: true };
}

// ── permission ────────────────────────────────────────────────────────────

/**
 * 'granted', 'prompt' or 'denied' for this handle. A handle with no
 * permission model at all (a browser's private storage) is simply readable.
 */
export async function permissionOf(handle, mode = 'readwrite') {
  if (!handle || typeof handle.queryPermission !== 'function') return 'granted';
  try { return await handle.queryPermission({ mode }); } catch { return 'prompt'; }
}

/**
 * Ask for permission. Must run inside the user's click — the browser refuses
 * the prompt otherwise — so callers make this their FIRST await.
 */
export async function askPermission(handle, mode = 'readwrite') {
  if (!handle || typeof handle.requestPermission !== 'function') return 'granted';
  try { return await handle.requestPermission({ mode }); } catch { return 'denied'; }
}

/** Whether this browser can choose a folder at all (Chrome and Edge on a computer). */
export function canPickFolders(win = globalThis) {
  return typeof win?.showDirectoryPicker === 'function';
}

// ── remembered on this device ─────────────────────────────────────────────

/**
 * Where the folders and the recent files are kept. IndexedDB, because a
 * file-system handle can be stored there and nowhere else: localStorage only
 * takes text, and a handle cannot be written down as text.
 */
export function idbBackend(name = 'ptt-plans-archive', store = 'kv') {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(name, 1); } catch (err) { reject(err); return; }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
    req.onblocked = () => { dbp = null; reject(new Error('storage blocked')); };
  }));
  const run = (mode, fn) => open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
  return {
    get: key => run('readonly', s => s.get(key)),
    set: (key, value) => run('readwrite', s => s.put(value, key)),
  };
}

/** The same, in memory: the tests, and a browser whose storage is blocked. */
export function memoryBackend() {
  const m = new Map();
  return {
    get: async key => m.get(key),
    set: async (key, value) => { m.set(key, value); },
  };
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function sameEntry(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (typeof a.isSameEntry !== 'function') return false;
  try { return await a.isSameEntry(b); } catch { return false; }
}

/**
 * The folders chosen on this device (at most `max`, the first is the Plans
 * Archive) and the plan files most recently opened from them. Forgetting a
 * folder or a recent file changes this list only — never the folder itself.
 */
export class PlansFolders {
  constructor({ backend = null, max = 3, maxRecent = 10 } = {}) {
    this.backend = backend || memoryBackend();
    this.max = max;
    this.maxRecent = maxRecent;
  }

  async _get(key) {
    try { return (await this.backend.get(key)) || []; } catch { return []; }
  }

  async _set(key, value) {
    try { await this.backend.set(key, value); return true; } catch { return false; }
  }

  /** [{ id, name, handle, addedAt }], oldest first. */
  async list() {
    return (await this._get('folders')).filter(r => r && r.handle);
  }

  /**
   * Remember a folder. The same folder twice is the one record, refreshed;
   * a folder past `max` is refused with a reason rather than dropping one.
   */
  async add(handle) {
    if (!handle || handle.kind !== 'directory') throw new Error('That is not a folder.');
    const all = await this.list();
    for (const r of all) {
      if (await sameEntry(r.handle, handle)) return { record: r, existed: true };
    }
    if (all.length >= this.max) {
      throw new Error(`Up to ${this.max} folders can be listed here. Remove one first.`);
    }
    const record = { id: newId(), name: handle.name, handle, addedAt: Date.now() };
    if (!(await this._set('folders', [...all, record]))) {
      throw new Error('This browser would not keep the folder (its storage is blocked).');
    }
    return { record, existed: false };
  }

  async remove(id) {
    const all = await this.list();
    await this._set('folders', all.filter(r => r.id !== id));
    // A recent file from a folder that is no longer listed would reopen a
    // folder the user just said to stop using.
    const recent = await this.recent();
    await this._set('recent', recent.filter(r => r.folderId !== id));
  }

  /** [{ id, folderId, folderName, code, name, path, handle, dir, size, lastModified, openedAt }], newest first. */
  async recent() {
    return (await this._get('recent')).filter(r => r && r.handle);
  }

  async noteRecent(entry) {
    if (!entry || !entry.handle) return;
    const all = await this.recent();
    const keep = [];
    for (const r of all) if (!(await sameEntry(r.handle, entry.handle))) keep.push(r);
    const rec = {
      id: newId(), folderId: entry.folderId || '', folderName: entry.folderName || '',
      code: entry.code || '', project: entry.project || '', name: entry.name || entry.handle.name,
      path: entry.path || '', handle: entry.handle, dir: entry.dir || null,
      size: Number(entry.size) || 0, lastModified: Number(entry.lastModified) || 0,
      openedAt: Date.now(),
    };
    await this._set('recent', [rec, ...keep].slice(0, this.maxRecent));
  }

  async dropRecent(id) {
    await this._set('recent', (await this.recent()).filter(r => r.id !== id));
  }
}
