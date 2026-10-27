/* The Plans Library's rules (owner 2026-10-26: the old portal's job, brought to Portal 2): a person who sees prices (an
   admin, or Sees prices - plan files carry prices) saves a project's .takeoff files on this device from 📐, opens them
   in the takeoff app with no signal, and a newer version in OneDrive downloads by itself while the portal is open.

   What is decided here, as data (the browser's storage and the downloads are js/plan-library.js; the broker's ops
   plans_list and plan_link are js/repo/onedrive.js):
   * planFileOf(v)              one file of a plans_list / plan_link answer as the pages use it, or null;
   * folderLabel(folder)        where a file sits below its project's folder ("Rev 2/Level 1"; "" at the top);
   * inSubFolder(folder)        a copy saved from a sub-folder (a Backup's) before the owner's rule of 2026-10-27;
   * sortFiles(files)           the menu's order: by folder, then name;
   * fileNameFor(owner, id, v, stamp)  one download's file name on this device (never the same twice; plain characters);
   * statusOf(rec, job)         saved | outdated | downloading | paused | stopped | gone | denied | missing;
   * progressOf(row, done, size), progressHtml(p)  a row's green bar: filling while it saves, full once it is saved;
   * applyCheck(rec, answer)     a record after a plans_list answer for its project ({files} | null: not visible);
   * dueForCheck / needsWork     when to ask for new versions, and which saved plans to download again;
   * dueForWork / withFailure / backoffMs / brokerWide  the automatic downloads' waits after a failure (5 min doubling
                                up to 6 h) and which failures stop them all for a while (OneDrive's, the connection's);
   * readyFresh(at)             "the takeoff app is kept on this device" is still believed (six days);
   * keepSet(records, handed)   the files a sweep keeps: every record's copy and part, and every copy handed to the
                                takeoff app lately (it may still be reading it: HANDED_GRACE_MS);
   * fmtSize, fmtAgo            the words.
   Pure module (node tests import it). */

/** How often the portal asks OneDrive for new versions of the saved plans while one of its pages is open. */
export const CHECK_EVERY_MS = 30 * 60 * 1000;
/** A copy handed to the takeoff app is kept this long after, even once replaced or removed (it reads it by slices). */
export const HANDED_GRACE_MS = 7 * 24 * 3600 * 1000;
/** The first wait before a failed automatic download is tried again; it doubles with each failure, up to the cap. */
export const RETRY_FIRST_MS = 5 * 60 * 1000;
export const RETRY_CAP_MS = 6 * 3600 * 1000;
/** A failure that is OneDrive's or the connection's, not one file's: the automatic downloads stop for a while (js/
    plan-library.js: OneDrive's longer each time; "offline", no answer at all, is handled before: a flat 5 minutes while
    the browser says it is online, nothing while it is offline). */
//  (js/repo/onedrive.js call()'s codes: a 5xx without a broker code is "failed"; the library's own per-file codes are
//  never these: "not_plan", "no_size", "gone", "space", "changed", "removed".)
export const BROKER_WIDE = Object.freeze(["busy", "unavailable", "failed", "server_error", "onedrive_failed", "not_configured",
  "not_authorized", "takeoff_not_configured", "takeoff_root_missing", "projects_root_missing", "not_deployed", "auth", "offline",
  "bad_link", "onedrive_full"]);
/** "The takeoff app opened on this device" is believed this long (Safari clears a site's storage after a week unused). */
export const READY_FRESH_MS = 6 * 24 * 3600 * 1000;
/** Every .takeoff file starts with these bytes: a download that does not is not a plan. */
export const MAGIC = "PDFCACHE1";
/** The saved copies' folder in this site's private file system. */
export const DIR = "plan-library";
export const FILE_RE = /^[A-Za-z0-9_-]+\.takeoff$/;
const ITEM_ID = /^[A-Za-z0-9!_.-]{8,128}$/;
const NAME_RE = /^[^\u0000-\u001f\u007f/\\]{1,250}\.takeoff$/i;

/** One .takeoff file as the broker answers it: {id, name, folder, size, modified, version}, or null. */
export function planFileOf(v) {
  if (!v || typeof v !== "object") return null;
  if (typeof v.id !== "string" || !ITEM_ID.test(v.id)) return null;
  if (typeof v.name !== "string" || !NAME_RE.test(v.name)) return null;
  if (typeof v.version !== "string" || !v.version || v.version.length > 200) return null;
  const folder = typeof v.folder === "string" && v.folder.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(v.folder) ? v.folder : "";
  const size = typeof v.size === "number" && Number.isSafeInteger(v.size) && v.size >= 0 ? v.size : null;
  const modified = typeof v.modified === "string" && !isNaN(Date.parse(v.modified)) ? v.modified : null;
  return { id: v.id, name: v.name, folder, size, modified, version: v.version };
}

/** Below the project's own folder: "A068 - 12 Main St/Rev 2/Level 1" -> "Rev 2/Level 1"; the folder itself -> "". */
export function folderLabel(folder) {
  const parts = String(folder || "").split("/").filter(Boolean);
  return parts.slice(1).join("/");
}

/** A plan saved from a sub-folder of its project's folder (a Backup's older copy): its folder has a "/" - a OneDrive
    name never does. Only the files right in a project's folder are its plans (the owner, 2026-10-27: "do not show
    *.takeoff files inside any sub-folder"); one saved before that is not shown, and goes from the device. */
export function inSubFolder(folder) {
  return String(folder || "").indexOf("/") !== -1;
}

const coll = typeof Intl !== "undefined" ? new Intl.Collator("en", { numeric: true, sensitivity: "base" }) : null;
const cmp = (a, b) => (coll ? coll.compare(a, b) : a < b ? -1 : a > b ? 1 : 0);

/** The top folder's files first, then each folder's, by name. */
export function sortFiles(files) {
  return (Array.isArray(files) ? files.slice() : []).sort(function (a, b) {
    const fa = folderLabel(a.folder), fb = folderLabel(b.folder);
    if (!fa !== !fb) return fa ? 1 : -1;
    return cmp(fa, fb) || cmp(a.name, b.name);
  });
}

/** A short, stable number for a text (FNV-1a), in base 36. */
export function hashOf(text) {
  let h = 0x811c9dc5;
  const s = String(text == null ? "" : text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const plain = (v, max) => String(v == null ? "" : v).replace(/[^A-Za-z0-9]/g, "").slice(0, max) || "x";

/** The file name of one download of this person's file and version: plain characters only, and never the same twice
    (`stamp`: when it starts) - a copy kept for the takeoff app after a Remove is never written over by a new download. */
export function fileNameFor(owner, itemId, version, stamp) {
  return "p" + hashOf(owner) + "-" + plain(itemId, 60) + "-" + hashOf(version) + "-" + plain(stamp, 24) + ".takeoff";
}

/** The wait before automatic attempt number `fails + 1`: 5 min, 10, 20, … up to 6 h. */
export function backoffMs(fails) {
  const n = Math.max(1, Number(fails) || 1);
  return Math.min(RETRY_CAP_MS, RETRY_FIRST_MS * Math.pow(2, Math.min(20, n - 1)));
}

/** The version OneDrive holds now differs from the one saved. */
export function outdated(rec) {
  return !!(rec && rec.file && rec.latest && rec.latest.status === "ok" && rec.latest.version && rec.latest.version !== rec.version);
}

/**
 * What a saved plan's row says. `job`: a download running in this window ({done, size}) or null.
 *   downloading  a download running now (here, or in another window: rec.dl.state "running" with its lock held);
 *   paused       a download stopped part way (a closed window, a dropped connection, or Pause) - it carries on;
 *   stopped      a download that failed for good (no room, not a plan file): rec.dl.error says why;
 *   gone         the file is no longer in OneDrive (the saved copy still opens);
 *   denied       this person may no longer open it (prices taken away, the project hidden): it still opens here,
 *                and is not updated;
 *   outdated     a newer version is in OneDrive (it downloads by itself);
 *   saved        the version OneDrive holds;
 *   missing      nothing on this device yet (the first download never finished).
 */
export function statusOf(rec, job, running) {
  if (!rec) return "missing";
  if (job || (running && rec.dl && rec.dl.state === "running")) return "downloading";
  if (rec.latest && rec.latest.status === "gone") return "gone";
  if (rec.latest && rec.latest.status === "denied") return "denied";
  if (rec.dl && rec.dl.state === "error") return "stopped";
  if (rec.dl && (rec.dl.state === "paused" || rec.dl.state === "running")) return "paused";
  if (!rec.file) return "missing";
  return outdated(rec) ? "outdated" : "saved";
}

/** The words of a status, for a row (`hasCopy`: a saved copy is on the device, so it still opens). */
export function statusText(status, hasCopy) {
  const opens = hasCopy ? " — this copy still opens" : "";
  return {
    downloading: "Downloading…",
    paused: "Download paused — it carries on when the portal is open and online",
    stopped: "Download stopped",
    gone: "No longer in OneDrive" + opens,
    denied: "No longer open to your account" + opens,
    outdated: "A newer version is downloading",
    saved: "Saved on this device",
    missing: "Not downloaded yet",
  }[status] || "";
}

/**
 * A row's progress bar (the owner, 2026-10-27: a green bar while a plan saves, full once the file is complete):
 * {pct, kind} or null (no bar). kind "run": downloading (`done` / `size`: its bytes now); "held": paused or stopped part
 * way (the record's own bytes; css: grey); "done": saved - a whole copy of the version OneDrive holds. Only "done" is
 * full: a download whose last byte came is at 99 until it is checked against OneDrive and saved.
 */
export function progressOf(row, done, size) {
  if (!row) return null;
  const pct = (d, s) => (s > 0 ? Math.max(0, Math.min(99, Math.floor((d / s) * 100))) : 0);
  if (row.status === "downloading") return { pct: pct(Number(done) || 0, Number(size) || 0), kind: "run" };
  if (row.status === "saved") return { pct: 100, kind: "done" };
  const dl = row.dl;
  if ((row.status === "paused" || row.status === "stopped") && dl && Number(dl.size) > 0 && Number(dl.done) > 0) {
    return { pct: pct(Number(dl.done), Number(dl.size)), kind: "held" };
  }
  return null;
}

/** The bar as HTML (css/styles.css .plan-prog), hidden when progressOf says none: the 📐 menu's rows and the Plans
    Library's. A page then moves it in place as the bytes come (the row is not drawn again). */
export function progressHtml(p) {
  const pct = p ? p.pct : 0;
  return '<div class="plan-prog' + (p ? " " + p.kind : "") + '" role="progressbar" aria-label="Saved on this device" ' +
    'aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"' + (p ? "" : " hidden") + '><i style="width:' + pct + '%"></i></div>';
}

/**
 * A record after its project's plans_list answer. `answer`: {files: [...]} (the project visible) or null (not in the
 * answer: the project is no longer visible to this person). The record's own copy is never touched here.
 */
export function applyCheck(rec, answer, nowIso) {
  const out = Object.assign({}, rec);
  if (!answer) {
    out.latest = { status: "denied", checkedAt: nowIso };
    return out;
  }
  const f = (answer.files || []).map(planFileOf).filter(Boolean).find((x) => x.id === rec.itemId);
  if (!f) {
    // a walk that did not finish (complete false) may simply not have reached it: nothing is known, nothing changes
    if (answer.complete === false) return out;
    out.latest = { status: "gone", checkedAt: nowIso };
    return out;
  }
  // a version other than the one last seen is a new download: its own tries, not the old one's waits - unless the last
  // try failed because the file kept changing (a file saved more often than it downloads would start over each time)
  const before = rec.latest && rec.latest.status === "ok" ? rec.latest.version : null;
  if (before !== f.version && rec.failCode !== "changed") { out.fails = 0; out.retryAt = null; }
  out.latest = { status: "ok", checkedAt: nowIso, version: f.version, size: f.size, modified: f.modified, name: f.name, folder: f.folder };
  return out;
}

/** Time to ask OneDrive again (`lastAt` an ISO time or null). */
export function dueForCheck(lastAt, now) {
  const t = Date.parse(lastAt || "");
  return !isFinite(t) || now - t >= CHECK_EVERY_MS || t > now + 60 * 1000;
}

/** A saved plan the portal downloads by itself: a newer version, a download a closed window or a dropped connection
    stopped, a first download that never finished - never one paused by the person, stopped for good, gone or denied. */
export function needsWork(rec) {
  if (!rec) return false;
  if (rec.latest && (rec.latest.status === "gone" || rec.latest.status === "denied")) return false;
  if (rec.dl) return rec.dl.state !== "error" && !rec.dl.userPaused;
  return !rec.file || outdated(rec);
}

/** needsWork, and its wait after a failed attempt is over (`retryAt`: when it may be tried again by itself). A person's
    own Save, Resume or Update now never waits. */
export function dueForWork(rec, now) {
  if (!needsWork(rec)) return false;
  const t = Date.parse(rec.retryAt || "");
  // a wait further ahead than any wait is set (a clock that was wrong when it was written) is over
  return !isFinite(t) || t <= now || t > now + RETRY_CAP_MS + 60 * 1000;
}

/** A hold (an ms time) still holds: not yet over, and no further ahead than `max` (a clock that was wrong). */
export function holding(until, now, max) {
  const t = Number(until) || 0;
  return t > now && t - now <= max + 60 * 1000;
}

/** The record after a failed automatic attempt: one more failure, and when to try again. */
export function withFailure(rec, now) {
  const fails = (Number(rec && rec.fails) || 0) + 1;
  return Object.assign({}, rec, { fails, retryAt: new Date(now + backoffMs(fails)).toISOString() });
}

/** A code of a failure that is OneDrive's or the connection's (stop every automatic download for a while). */
export function brokerWide(code) {
  return BROKER_WIDE.indexOf(String(code || "")) !== -1;
}

/** "The takeoff app opened on this device" (`at`, an ISO time) is still believed. */
export function readyFresh(at, now) {
  const t = Date.parse(at || "");
  return isFinite(t) && now - t < READY_FRESH_MS && t <= now + 60 * 1000;
}

/**
 * The files a sweep keeps: every record's saved copy and download part (anyone's on this device: a shared tablet), and
 * every copy handed to the takeoff app within HANDED_GRACE_MS. `handed`: {file name: ISO time}.
 */
export function keepSet(records, handed, now) {
  const keep = new Set();
  (records || []).forEach(function (r) {
    if (r && r.file) keep.add(r.file);
    if (r && r.dl && r.dl.file) keep.add(r.dl.file);
  });
  Object.keys(handed || {}).forEach(function (name) {
    const t = Date.parse(handed[name] || "");
    if (isFinite(t) && now - t < HANDED_GRACE_MS) keep.add(name);
  });
  return keep;
}

/** The handed-copies map without the entries older than the grace. */
export function pruneHanded(handed, now) {
  const out = {};
  Object.keys(handed || {}).forEach(function (name) {
    const t = Date.parse(handed[name] || "");
    if (isFinite(t) && now - t < HANDED_GRACE_MS && FILE_RE.test(name)) out[name] = handed[name];
  });
  return out;
}

/** The project ids of these records, in groups of at most `n` (plans_list's limit). */
export function projectBatches(records, n) {
  const ids = [];
  (records || []).forEach(function (r) {
    const id = Number(r && r.projectId);
    if (Number.isSafeInteger(id) && id > 0 && ids.indexOf(id) === -1) ids.push(id);
  });
  const out = [];
  for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n));
  return out;
}

export function fmtSize(n) {
  n = Number(n) || 0;
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + " GB";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}

export function fmtAgo(iso, now) {
  const t = Date.parse(iso || "");
  if (!isFinite(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " d ago";
}
