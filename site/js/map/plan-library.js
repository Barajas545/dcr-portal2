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
   * deviceOpenStep / afterFetch  how a phone or a tablet opens a plan: from a copy on the device, saved first;
   * onlineNote(why)            what the person is told when it opened online instead (no room, a browser that cannot);
   * progressOf(row, done, size), progressHtml(p)  a row's green bar: filling while it saves, full once it is saved;
   * applyCheck(rec, answer)     a record after a plans_list answer for its project ({files} | null: not visible);
   * dueForCheck / needsWork     when to ask for new versions, and which saved plans to download again;
   * dueForWork / withFailure / backoffMs / brokerWide  the automatic downloads' waits after a failure (5 min doubling
                                up to 6 h) and which failures stop them all for a while (OneDrive's, the connection's);
   * readyFresh(at)             "the takeoff app is kept on this device" is still believed (six days);
   * keepSet(records, handed)   the files a sweep keeps: every record's copy and part, and every copy handed to the
                                takeoff app lately (it may still be reading it: HANDED_GRACE_MS);
   * fmtSize, fmtAgo            the words.

   The save back (owner decisions Q1-Q3, 2026-11-04; contract C3 "Save-back"; js/plan-library.js keepSave / sendSaved):
   a Save in the frame's takeoff app is kept on this device first - a record's `local` - and then sent to OneDrive in
   place of the plan (or, when someone saved the plan in the office meanwhile, as a separate file beside it):
   * hasLocal(rec)              a save of the person's own is waiting on this device (never downloaded over, never
                                retired: needsWork skips it, open() hands it);
   * withSave(rec, file, size)  the record once a save is kept (its `base`: the version the work was done on);
   * hashOk(h)                  a quickXorHash in the broker's form (a save's `local.hash`);
   * dueToSend(rec, now)        it is sent by itself now (not a failure that waits for the person - sendFinal -, its wait
                                over);
   * adoptSent(rec, file, ans)  the records once OneDrive has it (plan_save_done's answer): replace - the saved bytes
                                ARE the plan's current version (no download), the old copy retired; copy - the plan stays
                                as it was, the save becomes a record of its own for the copy, and the person is told;
   * keptAs(rec, f)             a version OneDrive reports now is the bytes adopted after a save (its hash given after
                                the save's "sm:" answer): taken without a download;
   * saveBase(rec, line)        the version a Save in the frame was done on (its record's, a save's waiting here, or -
                                the record moved on while the app was open - the one the app was handed: Q3);
   * handedTime(rec)            the time a copy is handed to the takeoff app as (a save's own time, not OneDrive's);
   * hashedBase(base, f)        OneDrive's hash of the bytes a save's "sm:" base names (sent against it);
   * saveStateOf / saveText / copyTold / sendBar  what the rows say: Saved on this iPad, Sending 45%, Sent, Saved as a
                                separate file, Not sent - tap to retry;
   * purgeText(p, device)       what a purge on lost prices took (the plans, the saves not yet sent, the takeoff app's:
                                removed, waiting for the app to close, or failed - TAKEOFF_PURGE);
   * sendWaitMs(code, fails)    how long a failed send waits (LONG_WAIT: the broker's switch off, a broker not deployed);
   * refusedTold / saveBackOffWords  the words of a copy OneDrive would not replace, and of a save the switch holds;
   * uncheckedReplace / uncheckedWords  a deferred replace a later page found landed that the broker did not check by
                                the plan's version history (never adopted: it waits), and its words;
   * needHashWords / unprovedTold / uncheckedTold  the words of a save that waits for its hash (contract addendum 4 E1),
                                of a copy the broker could not prove went over nothing (E1's "unproved"), and of a
                                replace adopted that nobody could check against office saves (E2);
   * checkAgainMs(retryAfter)   when a check the broker answered 503 with a Retry-After is asked again (E7);
   * checkWaitOf / checkingWords  a 503 of the broker's version check itself (its body's why "checking", DCR Desktop 2's
                                repair round 3; since its repair round 4 every 503 after the bytes may be on the plan) -
                                the save is being checked against office saves, never "not sent" - and its words;
   * copyWhyOf / notSavedWhyOf / strongerWhy  the why of a deferred replace's plan_changed or not_saved as the words
                                follow it (contract addendum 5 G1: a why this page does not know, or none on
                                plan_changed, is "unproved" - never the plain copy words); notPutBackTold its G3 words;
   * BROKER_RUN_MAX_MS / ANSWER_LOST_MS / answerLostOf / askWait / answerLostWords  one commit or settle at a time per
                                send, and the wait after one whose answer never came (G2).
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

/**
 * How a phone or a tablet opens a plan (owner decision Q4, 2026-11-04: always from a copy on the device, in the frame;
 * js/plan-library.js openOnDevice). s: {have: a copy is saved here, online, writable: this browser keeps plans}.
 *   "fetch"    online, and plans can be kept here: save it, update it or carry its download on first, then open it;
 *   "open"     offline with a copy here: open that copy as it is;
 *   "online"   online, but this browser cannot keep plans: open it over byte ranges (nothing kept), and say so;
 *   "offline"  offline with nothing here: nothing can open.
 */
export function deviceOpenStep(s) {
  if (!s || !s.online) return s && s.have ? "open" : "offline";
  return s.writable ? "fetch" : "online";
}

/** After a "fetch" that failed (its error's code), with or without a copy here: "online" when there was no room or no
    way to keep it (the newest version, nothing kept - an older copy here would only be a plan OneDrive has moved past);
    "fail" when this person may not open it (refused: prices taken away; removed meanwhile); otherwise the copy here
    ("open": OneDrive busy, the file no longer in OneDrive, a download that stopped), or "fail" without one. */
export function afterFetch(code, have) {
  if (code === "space" || code === "unsupported") return "online";
  if (code === "forbidden" || code === "removed" || code === "signin") return "fail";
  return have ? "open" : "fail";
}

/** What a phone or a tablet is told when a plan opened ONLINE instead (afterFetch / deviceOpenStep "online"): `why`
    "space" (no room to keep it) or "unsupported" (a browser that cannot keep plans). With no room it also says that a
    Save may not work from there for a big plan (review MEM-1: the takeoff app's Save of a plan opened online reads the
    whole plan into memory; kept on the device first, the portal keeps it by slices instead). */
export function onlineNote(why) {
  return why === "space"
    ? "Not enough room on this device for this plan, so it opened online: it needs the internet while it is open, and nothing is kept here. " +
      "Saving may not work from there for a big plan - free some room, then open it again from the Plans Library so this device keeps it before you save."
    : "This browser cannot keep plans on the device, so it opened online: it needs the internet while it is open.";
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
 * A record after its project's plans_list answer. `answer`: {files: [...], saveBack} (the project visible) or null (not
 * in the answer: the project is no longer visible to this person). The record's own copy is never touched here.
 * `saveBack` (the broker's save_back, contract addendum 3 D1) is kept as the record's: the frame offers a save of the
 * plan only while it is true - never from an answer without it (an older broker), never for a project not visible.
 */
export function applyCheck(rec, answer, nowIso) {
  const out = Object.assign({}, rec);
  out.saveBack = !!answer && answer.saveBack === true;
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
  // the bytes this device sent and kept (a save adopted with OneDrive's "sm:" version), now under OneDrive's own hash:
  // the same file - its version is taken, nothing is downloaded again
  if (keptAs(rec, f)) { out.version = f.version; out.expect = null; }
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
  // the person's own save waiting here (kept, being sent, not sent): never downloaded over, whatever OneDrive holds
  if (hasLocal(rec)) return false;
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
    if (hasLocal(r)) keep.add(r.local.file);
    // a save found lost only once: kept until a later check says it is really gone (js/plan-library.js verifyFiles)
    const lost = lostSave(r);
    if (lost) keep.add(lost.file);
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

/* ── the save back (owner decisions Q1-Q3, 2026-11-04; contract C3 "Save-back") ─────────────────────────────────────

   A record's `local` is the person's own save of the plan, kept on this device until OneDrive has it:
     {file      the spooled copy's name in DIR (a NEW name: never the record's own copy, never a download's part);
      base      the version of the plan the work was done on (the record's version when the first save of it came; a
                later save before it is sent keeps it): the broker replaces the plan only while OneDrive still holds
                that version, else the save becomes a separate file beside it (Q3);
      savedAt, size;
      hash      OneDrive's quickXorHash of the save's bytes (js/quickxor.js: the spool worker computes it from the slices it
                writes; null when it could not), sent to plan_save_commit / plan_save_done - with OneDrive's own hash of
                the item, the broker's proof that it holds exactly these bytes (contract addendum 2, C3b);
      state     "waiting" | "sending" | "checking" | "failed" (a "sending" no window is running is waiting again;
                "checking": the broker's version check waits on OneDrive - checkWaitOf - and asks again by itself);
      error, code, fails, retryAt   the last failed send and when it is tried again by itself;
      notSaved  how often OneDrive said it did not get this save whole (409 not_saved): past NOT_SAVED_MAX it waits;
      sends     [{file, ticket, mode, name, size, at, hash, commit, why?, asking?, lost?}]: sessions this device opened
                whose end it never heard (the page closed after the last byte, say) - settled with plan_save_done before
                anything is sent again, so a save that landed is never sent twice (nor made into a copy of itself). The
                ticket is the broker's sealed word for plan_save_done, never an upload address: those stay in the
                page's memory. `why` (a copy): "refused", "unproved" or "not_put_back" - the words it is told in.
                `asking` (an ISO time): a plan_save_commit / plan_save_done for this session went to the broker then
                and no answer came back yet (another window's request, or one whose page closed or slept); `lost`: one
                whose answer this page saw lost - the next ask waits ANSWER_LOST_MS (askWait: contract addendum 5 G2);
      why?      "unproved": a settle or commit the broker could not prove (contract addendum 4 E1, addendum 5 G1), or
                "not_put_back": this save went over an office save that OneDrive would not put back (G3) - the save
                goes again as a copy, told in those words (kept by a later save of the same opening).}
   and `sent` {mode: "replace" | "copy" | "lost", name, at, was?, why?} the last one's outcome, shown a while
   (SENT_NOTE_MS); `was` (lost only): the save as it was, until a later check confirms its file is gone (lostSave);
   `why` "unproved" or "not_put_back" (a copy): the row never says "nothing was overwritten". */

/** How long "Sent" / "Saved as a separate file" stays on a row after the send. */
export const SENT_NOTE_MS = 3 * 24 * 3600 * 1000;
/** A send that failed for one of these waits for the person (Retry): the plan is no longer in its project's folder,
    it is too large for the broker, the kept copy is gone, the save cannot be matched to a version, or the broker
    refused what it was sent (400 invalid: a name, a ticket or an address it does not take - asking again by itself
    would only be refused again; review BRK-6). */
export const SEND_FINAL = Object.freeze(["not_found", "too_large", "lost", "bad_base", "invalid"]);
/** OneDrive said this often that it did not get a save whole (not_saved): the save waits for the person - never the
    whole plan sent again and again by itself, every backoff, with the screen held awake (review BRK-5). */
export const NOT_SAVED_MAX = 2;
/** A send that failed for one of these goes again by itself only after a long wait (at least LONG_WAIT_MS), never
    final: the broker's switch turned off (save_back_off, contract addendum 3 D1 - it is turned on again by hand), a
    broker older than this page (not_deployed: its 400 invalid for the field "op", D6 - deployed later) and a deferred
    replace a later page found in OneDrive that the broker did not check (unchecked: uncheckedReplace - a broker older
    than its repair round 2, checked once that one is deployed), and a save that waits for its hash (need_hash: the
    spool and the second worker pass could not work it out - contract addendum 4 E1: a replace is never sent, committed
    or settled without it; the local copy is never dropped). */
export const LONG_WAIT = Object.freeze(["save_back_off", "not_deployed", "unchecked", "need_hash"]);
export const LONG_WAIT_MS = 30 * 60 * 1000;
/** A check the broker answered 503 with a Retry-After (its version check waiting on OneDrive's hash, a restore that did
    not go through) is asked again on a timer while the page is open (contract addendum 4 E7): at the Retry-After, at
    least this, at most LONG_WAIT_MS. */
export const CHECK_AGAIN_MIN_MS = 30 * 1000;
/** The timer's wait for a Retry-After of `retryAfter` seconds (E7). */
export function checkAgainMs(retryAfter) {
  const s = Number(retryAfter);
  return Math.min(LONG_WAIT_MS, Math.max(CHECK_AGAIN_MIN_MS, Number.isFinite(s) && s > 0 ? s * 1000 : 0));
}

/** A refusal of the broker's version check itself (DCR Desktop 2's repair round 3): its 503 - busy, or not allowed in
    when Microsoft refused the restore - whose body says why "checking" (OneDrive has no hash of the plan yet, or the
    office's save is not put back yet; Retry-After 30). Since the broker's repair round 4 (contract addendum 5 G4) EVERY
    503 it answers once the bytes may be on the plan says so, whatever its code (the check's walk, its listing, OneDrive
    out of reach there; Retry-After Graph's, else 30 - E7's 30 s floor applies). The save is being checked against office
    saves: never "not sent", never counted as a failure - asked again (E7's timer). Any other 503 (OneDrive busy before
    anything was committed) carries no such why and stays as it was. */
export function checkWaitOf(x) {
  return !!(x && Number(x.status) === 503 && x.info && x.info.why === "checking");
}

/* ── one commit or settle at a time per send (contract addendum 5 G2) ──────────────────────────────────────────────
   A plan_save_commit or plan_save_done whose answer never came back (no connection, a timeout, the page hidden or
   closed mid-request) may still be running in the broker: a second one for the same send would race it (the final
   check's overlapping commits). The next ask for that send waits until the broker's longest run is over. */
/** The longest an Edge Function request can still be running: Supabase's Edge Functions limits page
    (https://supabase.com/docs/guides/functions/limits, read 2026-11-05) - "Maximum Duration (Wall clock limit)": Free
    plan 150 s, Paid plans 400 s ("the duration an Edge Function worker will stay active"; its "Request idle timeout",
    150 s, is the 504 a caller gets while the worker may run on). The largest of any plan. */
export const BROKER_RUN_MAX_MS = 400 * 1000;
/** How long the next ask for a send waits after one whose answer never came: BROKER_RUN_MAX_MS and 20 s for the
    request's way there. */
export const ANSWER_LOST_MS = BROKER_RUN_MAX_MS + 20 * 1000;

/** A broker call's failure (js/repo/onedrive.js call()'s error) that is NOT the broker's own answer, so the request may
    still be running there: no answer at all ("offline": no connection, a timeout, a page that slept), or a 5xx whose body
    carries none of the broker's codes (the gateway's: its 504 at the idle timeout while the function runs on, a 502, a
    5xx that could not be read - and one whose JSON has an `error` word that is not one of the broker's codes, such as
    {error: "Gateway Timeout"}: contract addendum 6 H3). Only call()'s `broker` mark says the body named one of the
    broker's codes (js/repo/onedrive.js CONTRACT): the broker's own 503 busy or 502 onedrive_failed is an answer. */
export function answerLostOf(x) {
  if (!x) return false;
  if (x.code === "offline") return true;
  return Number(x.status) >= 500 && x.broker !== true;
}

/** How long (ms) the next plan_save_commit / plan_save_done of send `s` (one of local.sends) still waits: until
    ANSWER_LOST_MS after its last ask that no answer cleared (`asking`) or whose answer was lost (`lost`); 0 - it may go.
    A mark further ahead than a minute (a clock that was wrong when it was written) holds nothing. */
export function askWait(s, now) {
  const times = [s && s.asking, s && s.lost].map((x) => Date.parse(x || "")).filter((t) => Number.isFinite(t));
  if (!times.length) return 0;
  const t = Math.max.apply(null, times);
  if (t > now + 60 * 1000) return 0;
  return Math.max(0, t + ANSWER_LOST_MS - now);
}

/** The words of a save whose commit or settle waits on askWait (the row's, the frame bar's): neither "not sent" nor
    "in OneDrive" - the answer is not known yet. */
export function answerLostWords(device) {
  const d = device || "device";
  return "OneDrive's answer about this save has not reached this " + d + " yet - the portal asks again in a few minutes. " +
    "Keep the portal open; there is nothing to do. It stays on this " + d + " meanwhile.";
}

/* ── the why of a deferred replace's end, as the words follow it (contract addendum 5 G1, G3) ── */
/** The whys this page has words for. */
export const COPY_WHYS = Object.freeze(["changed", "refused", "unproved", "not_put_back"]);
/** plan_changed's `why` (the save goes again as a copy): "changed" and "refused" (the broker proved the plan never held
    this save: copyTold / refusedTold), "unproved", "not_put_back" - anything else, or none (a broker that gave none),
    "unproved": never the plain copy words on a why nobody proved. */
export function copyWhyOf(why) {
  return COPY_WHYS.indexOf(why) !== -1 ? why : "unproved";
}
/** not_saved's `why` on a deferred replace's ticket (its `need` is another matter: need_hash): none - the broker's
    plain not_saved, given only on its proof that the plan never held this save or after it put the office save back
    (DCR Desktop 2's repair round 4, neverHeld) - ""; "not_put_back"; any other why (its "unproved", or one this page
    does not know) "unproved". */
export function notSavedWhyOf(why) {
  if (why === undefined || why === null || why === "") return "";
  return why === "not_put_back" ? "not_put_back" : "unproved";
}
/** The mark a save keeps (local.why) of two: "not_put_back" (this save went over an office save, said until the copy
    lands) over "unproved" over none. */
export function strongerWhy(a, b) {
  if (a === "not_put_back" || b === "not_put_back") return "not_put_back";
  return a === "unproved" || b === "unproved" ? "unproved" : "";
}

/** The words of a save in the broker's version check (checkWaitOf): the row's, the frame bar's. They never say the save
    is in OneDrive (during OneDrive's hash wait only a version of its size is known to be there), never "not sent",
    "retry", "replaced" or "overwritten". */
export function checkingWords(device) {
  return "Your save is being checked against office saves in OneDrive - keep the portal open; there is nothing to do. It stays on this " +
    (device || "device") + " meanwhile.";
}

/** The wait before a failed send (`code`, its `fails`-th failure) goes again by itself: backoffMs, and at least
    LONG_WAIT_MS for a LONG_WAIT code. */
export function sendWaitMs(code, fails) {
  const ms = backoffMs(fails);
  return LONG_WAIT.indexOf(String(code || "")) !== -1 ? Math.max(ms, LONG_WAIT_MS) : ms;
}
/** At most this many unsettled sessions are kept with a save (each is settled, then dropped, before the next send). */
export const MAX_SENDS = 4;

/** A save's failed send waits for the person (a `local`): SEND_FINAL, or not_saved NOT_SAVED_MAX times. */
export function sendFinal(l) {
  const code = String((l && l.code) || "");
  return SEND_FINAL.indexOf(code) !== -1 || (code === "not_saved" && Number(l.notSaved) >= NOT_SAVED_MAX);
}

/** The person's own save waiting on this device. */
export function hasLocal(rec) {
  return !!(rec && rec.local && typeof rec.local.file === "string" && FILE_RE.test(rec.local.file));
}

/** The save a record's `sent: {mode: "lost", was}` names: one the storage said was not there at ONE check (review
    LW-2) - its file is kept from sweeps until a later check says it is really gone (the note then loses `was`), or
    finds it after all (the save is the record's again). -> that `local`, or null. */
export function lostSave(rec) {
  const s = rec && rec.sent;
  return s && s.mode === "lost" && s.was && hasLocal({ local: s.was }) ? s.was : null;
}

/** A quickXorHash as Graph reports one (base64, 28 characters): the only form the broker takes. */
export function hashOk(h) {
  return typeof h === "string" && /^[A-Za-z0-9+/]{27}=$/.test(h);
}

/** A version string as the broker gives one (plans_list's): the base a save is sent against. */
export function baseOk(v) {
  return typeof v === "string" && v.length > 0 && v.length <= 200;
}

/**
 * The record once a save is kept here (`file`: its spooled copy, `size` its bytes, `hash` their quickXorHash) ->
 * {rec, old}: `old` is an earlier save it replaces (its file goes; a session opened for it stays in `sends` to be
 * settled). `base` stays the first save's: everything after it was done on that version too - and so does an
 * "unproved" mark (`why`: the broker could not prove whether an earlier save of it went over an office save - contract
 * addendum 4 E1 - so this one goes as a copy too, told in those words).
 */
export function withSave(rec, file, size, nowIso, base, hash) {
  const prev = hasLocal(rec) ? rec.local : null;
  const sends = prev && Array.isArray(prev.sends) ? prev.sends.slice(-MAX_SENDS) : [];
  // (and "not_put_back": the earlier save went over an office save OneDrive would not put back - contract addendum 5 G3)
  const why = prev ? strongerWhy(prev.why, "") : "";
  return {
    rec: Object.assign({}, rec, { sent: null, local: Object.assign({ file, base: prev ? prev.base : base || rec.version, savedAt: nowIso, size: Number(size) || 0,
      hash: hashOk(hash) ? hash : null, state: "waiting", error: "", code: "", fails: 0, retryAt: null, sends }, why ? { why } : {}) }),
    old: prev && prev.file !== file ? prev.file : "",
  };
}

/**
 * The version the takeoff app's work was done on, for a Save of it kept on record `rec` (withSave's base when no save
 * waits there). `line` {file, base}: what the frame's app has - the file it was handed, then each of its saves kept
 * here - and the version that file was. While the record still holds that file, the record's version (a save sent and
 * adopted moved both on together); once it holds another (a newer version downloaded while the app was open), the
 * version the app's work really started from: never the newer one, so a save of older work becomes a separate file
 * instead of replacing someone else's newer save (the owner's Q3). -> a version, or "" (the record's own).
 */
export function saveBase(rec, line) {
  if (!rec || hasLocal(rec) || !line || !line.file || !line.base) return "";
  return rec.file === line.file ? "" : String(line.base);
}

/** OneDrive's hash form of a base it gave as "sm:<size>:<time>" (the bytes a save builds on, taken before OneDrive
    had their hash): `f` (a plans_list file now) has a "qx:" version, that size and that time - the same bytes, so a save
    is sent against f.version (the broker compares versions exactly: against "sm:" it would make a copy of the
    person's own save). -> f.version, or "". */
export function hashedBase(base, f) {
  const m = /^sm:([0-9]{1,16}):(.+)$/.exec(String(base || ""));
  if (!m || !f || typeof f.version !== "string" || f.version.indexOf("qx:") !== 0) return "";
  return Number(f.size) === Number(m[1]) && sameTime(f.modified, m[2]) ? f.version : "";
}

/** The record a frame's Save goes on (`file`: line.file): the one whose waiting save, else whose copy, is that file. */
export function recordOfLine(records, who, file) {
  const mine = (records || []).filter((r) => r && r.owner === who);
  return mine.find((r) => hasLocal(r) && r.local.file === file) || mine.find((r) => r.file === file) || null;
}

/** The time (ms, NaN when none) a copy is handed to the takeoff app as - its File's lastModified, which the app
    compares its drafts with: a save waiting here, or one OneDrive took and this record adopted, is the time the save
    was KEPT (the work's own time; OneDrive's upload time is later); any other copy is OneDrive's time of its version. */
export function handedTime(rec) {
  if (!rec) return NaN;
  if (hasLocal(rec)) return Date.parse(rec.local.savedAt || "");
  if (rec.adopted && rec.adopted.file === rec.file && rec.file) return Date.parse(rec.adopted.keptAt || "");
  return Date.parse(rec.modified || "");
}

/** Sent by itself now: a save waiting here, not a failure that waits for the person, its wait over (a wait further
    ahead than any is set - a clock that was wrong - is over). A person's own Retry never waits. */
export function dueToSend(rec, now) {
  if (!hasLocal(rec)) return false;
  const l = rec.local;
  if (l.state === "failed" && sendFinal(l)) return false;
  const t = Date.parse(l.retryAt || "");
  return !isFinite(t) || t <= now || t > now + RETRY_CAP_MS + 60 * 1000;
}

/** {size, modified} of bytes adopted with the "sm:" form of a version (OneDrive had no hash of them yet), or null. */
export function expectOf(ans) {
  return ans && typeof ans.version === "string" && ans.version.indexOf("sm:") === 0 ? { size: Number(ans.size), modified: ans.modified || null } : null;
}

function sameTime(a, b) {
  const x = Date.parse(a || ""), y = Date.parse(b || "");
  return isFinite(x) && isFinite(y) && x === y;
}

/** A version OneDrive reports now (`f`: a plans_list / plan_link file) is the very bytes this record adopted after its
    save was sent: another version string (OneDrive's hash, given after the "sm:" form the save's answer carried), the
    same size, the same time. */
export function keptAs(rec, f) {
  return !!(rec && rec.expect && rec.file && f && typeof f.version === "string" && f.version && f.version !== rec.version &&
    Number(f.size) === Number(rec.expect.size) && Number(rec.size) === Number(f.size) && sameTime(f.modified, rec.expect.modified));
}

/**
 * The records once OneDrive has a save (`file`: the spooled copy that was sent; `ans`: plan_save_done's answer
 * {mode, id, name, size, modified, version}) -> {rec, copy, old}:
 *   replace, this record's waiting save: its bytes ARE the plan's current version - the record's copy from now on
 *     (nothing downloaded), the old copy retired (`old`: kept a week when it was handed to the takeoff app lately);
 *   replace, a save replaced since (a later Save came while this one was on its way): OneDrive's version moved to the
 *     one sent, so the later save's base does too (it builds on it); the sent copy goes;
 *   copy (someone saved the plan in the office after this device got it - Q3): the plan's record stays as it is (and
 *     downloads OneDrive's version by itself once nothing waits here), the saved bytes become a record of their own for
 *     the copy (`copy`: it opens on this device with no download), and `sent` says so;
 *   no record (removed meanwhile): nothing kept, the sent copy goes.
 * `why` "unproved" (a copy sent because the broker could not prove whether the plan holds an earlier send of it over an
 * office save - contract addendum 4 E1) or "not_put_back" (an earlier send went over an office save that OneDrive would
 * not put back - addendum 5 G3): `sent` keeps it, so the row never says "nothing was overwritten".
 */
export function adoptSent(rec, file, ans, nowIso, why) {
  if (!rec) return { rec: null, copy: null, old: [file] };
  const mine = hasLocal(rec) && rec.local.file === file;
  const replace = ans.mode === "replace" && ans.id === rec.itemId;
  const ver = { version: ans.version, size: Number(ans.size), modified: ans.modified || null, name: ans.name || rec.name, folder: rec.folder };
  // the sessions of this file are settled; another one's (an earlier save it replaced) stay to be
  const rest = (l) => (Array.isArray(l.sends) ? l.sends.filter((s) => s && s.file !== file) : []);
  if (replace) {
    if (!mine) {
      const local = hasLocal(rec) ? Object.assign({}, rec.local, { base: ans.version, sends: rest(rec.local) }) : rec.local || null;
      return { rec: Object.assign({}, rec, { local, latest: Object.assign({ status: "ok", checkedAt: nowIso }, ver) }), copy: null,
        old: file !== rec.file ? [file] : [] };
    }
    const old = [];
    if (rec.file && rec.file !== file) old.push(rec.file);
    if (rec.dl && rec.dl.file && rec.dl.file !== file) old.push(rec.dl.file);
    return {
      rec: Object.assign({}, rec, { file, name: ver.name, size: ver.size, modified: ver.modified, version: ver.version, savedAt: nowIso, dl: null,
        fails: 0, retryAt: null, failCode: null, wide: false, expect: expectOf(ans), local: null, adopted: { file, keptAt: rec.local.savedAt || nowIso },
        latest: Object.assign({ status: "ok", checkedAt: nowIso }, ver), sent: { mode: "replace", name: ver.name, at: nowIso } }),
      copy: null, old,
    };
  }
  const sent = Object.assign({ mode: "copy", name: String(ans.name || ""), id: String(ans.id || ""), at: nowIso }, why === "unproved" || why === "not_put_back" ? { why } : {});
  const local = mine ? null : hasLocal(rec) ? Object.assign({}, rec.local, { sends: rest(rec.local) }) : rec.local || null;
  const copy = mine ? { key: rec.owner + "|" + ans.id, owner: rec.owner, itemId: ans.id, projectId: rec.projectId, number: rec.number,
    projectTitle: rec.projectTitle, name: ver.name, folder: rec.folder, file, size: ver.size, modified: ver.modified, version: ver.version,
    savedAt: nowIso, dl: null, latest: Object.assign({ status: "ok", checkedAt: nowIso }, ver), fails: 0, retryAt: null, failCode: null,
    expect: expectOf(ans), local: null, sent: null, from: rec.itemId, adopted: { file, keptAt: rec.local.savedAt || nowIso },
    saveBack: rec.saveBack === true } : null;
  return { rec: Object.assign({}, rec, { local, sent }), copy, old: mine ? [] : [file] };
}

/** plan_save_done's answer `ans` found the send `s` (one of local.sends) of a DEFERRED replace (commit "broker") landed
    as the plan, but the broker did not check it by the plan's version history: the answer carries no `verified`. A
    later page settles such a send through plan_save_done (its own page never heard the commit's answer, or OneDrive
    committed it at the last chunk while the office saved; the upload address is never kept): only a broker that ran
    the check there - and put a crossed office save back - may say the save replaced the plan (the checkers' repair
    round 2, S1). Such an answer is never adopted: the save waits, its session kept, and the broker is asked again. */
export function uncheckedReplace(s, ans) {
  return !!(s && s.commit === "broker" && s.mode !== "copy" && ans && ans.mode === "replace" && typeof ans.verified !== "boolean");
}

/** The words of a save uncheckedReplace holds back: the row's and the frame bar's. */
export function uncheckedWords(device) {
  return "This save reached OneDrive, but the portal's OneDrive connection could not check yet that it did not cover an office save. It stays on this " +
    (device || "device") + " and is checked again later.";
}

/** The words of a save that waits for its hash (contract addendum 4 E1: a replace is never sent, committed or settled
    without the save's quickXorHash - this device could not work it out yet): the row's and the frame bar's. */
export function needHashWords(device) {
  return "This save is getting ready to send - it waits on this " + (device || "device") + ".";
}

/** What the person is told when the save became a separate file because the broker could not prove whether an earlier
    send of it went over an office save (plan_changed / not_saved `why: "unproved"`, contract addendum 4 E1: OneDrive
    gave no hash): never "nothing was overwritten" - the plan may hold this device's bytes over an office save. */
export function unprovedTold(name, device) {
  const d = device || "device";
  return "Your work was saved as '" + String(name || "") + "' next to the plan. OneDrive could not show whether your " + d +
    "'s version went over an office save - if someone saved this plan in the office while your " + d +
    " was sending, ask them to check the plan's version history in OneDrive.";
}

/** What the person is told when the save became a separate file because an earlier send of it went over an office save
    and OneDrive would not put the office save back (plan_changed / not_saved `why: "not_put_back"`, contract addendum 5
    G3): said once the copy lands - the office save is still under this device's bytes in the plan's history. */
export function notPutBackTold(name, device) {
  const d = device || "device";
  return "Your work was saved as '" + String(name || "") + "' next to the plan. Your " + d + "'s version went over an office save and OneDrive " +
    "would not put the office save back - ask the office to restore it from the plan's version history in OneDrive.";
}

/** What the person is told when a replace is adopted that nobody could check against office saves (contract addendum 4
    E2): the broker answered `verified: false` (no version history to read), or the save was found in OneDrive by its
    hash alone (its ticket no longer unseals: a rotated secret, or past the broker's 30 days). It did replace the plan -
    that much is true - but never "nothing was overwritten". */
export function uncheckedTold(device) {
  return "Your save is in OneDrive: it replaced the plan there. It could not be checked against office saves this time - if someone saved this plan " +
    "in the office while your " + (device || "device") + " was sending, ask them to check the plan's version history in OneDrive.";
}

/** A send in progress: 0-99 (100 only once OneDrive said it has it). */
function pctOf(sent, size) {
  return Number(size) > 0 ? Math.max(0, Math.min(99, Math.floor((Number(sent) / Number(size)) * 100))) : 0;
}

/**
 * What a row says of the record's save: {state, pct?, why?, name?} or null (nothing to say).
 *   kept     saved on this device, not in OneDrive yet (waiting; or a send that a closed page left half way);
 *   sending  being sent here (`live`: {sent, size}) or in another window (`elsewhere`: pct null);
 *   checking the broker's version check waits on OneDrive (`live.checking` while it is asked here; local.state
 *            "checking" between the asks): never "not sent"; `code` "answer_lost": the broker's answer to its commit or
 *            settle has not come back, and the next ask waits (contract addendum 5 G2: answerLostWords);
 *   failed   not sent: `why`; `final` when it waits for the person;
 *   sent / copy / lost   the last one's outcome, for SENT_NOTE_MS.
 */
export function saveStateOf(rec, live, now, elsewhere) {
  if (!rec) return null;
  if (hasLocal(rec)) {
    const l = rec.local;
    if (live) return live.checking ? { state: "checking" } : { state: "sending", pct: pctOf(live.sent, live.size) };
    if (elsewhere) return { state: "sending", pct: null };
    if (l.state === "checking") return Object.assign({ state: "checking" }, l.code === "answer_lost" ? { code: "answer_lost" } : {});
    if (l.state === "failed") return { state: "failed", why: String(l.error || ""), final: sendFinal(l), code: String(l.code || "") };
    return { state: "kept" };
  }
  const s = rec.sent;
  const t = Date.parse((s && s.at) || "");
  if (!s || !isFinite(t) || now - t >= SENT_NOTE_MS || t > now + 60 * 1000) return null;
  if (s.mode === "copy") return Object.assign({ state: "copy", name: String(s.name || "") }, s.why === "unproved" || s.why === "not_put_back" ? { why: s.why } : {});
  if (s.mode === "lost") return { state: "lost" };
  return { state: "sent" };
}

/** saveStateOf's words for a row (`device`: map/plans.js deviceWord - "iPad", "iPhone" or "device"). */
export function saveText(st, device) {
  const d = device || "device";
  if (!st) return "";
  if (st.state === "kept") return "Saved on this " + d + " — not in OneDrive yet: it is sent while the portal is open and online";
  if (st.state === "sending") return typeof st.pct === "number" ? "Sending " + st.pct + "% — keep this screen open" : "Sending to OneDrive…";
  // the broker's version check waits on OneDrive (checkWaitOf): nothing to do - never "Not sent"; its answer not back yet
  // (contract addendum 5 G2): the wait before it is asked again
  if (st.state === "checking") return st.code === "answer_lost" ? answerLostWords(d) : checkingWords(d);
  // the broker's switch is off for this project (contract addendum 3 D1): nothing to retry - it waits, and goes once it
  // is turned on
  if (st.state === "failed" && st.code === "save_back_off") return saveBackOffWords(d);
  // a save in OneDrive the broker did not check (uncheckedReplace): never "Not sent"
  if (st.state === "failed" && st.code === "unchecked") return uncheckedWords(d);
  // a save waiting for its hash (contract addendum 4 E1): nothing to retry - it goes once this device has worked it out
  if (st.state === "failed" && st.code === "need_hash") return needHashWords(d);
  if (st.state === "failed") return "Not sent — tap to retry" + (st.why ? " (" + String(st.why).replace(/[.\s]+$/, "") + ")" : "");
  if (st.state === "sent") return "Sent to OneDrive";
  // a copy the broker could not prove went over nothing (E1's "unproved"): never "nothing was overwritten"
  if (st.state === "copy" && st.why === "unproved") {
    return "Saved as a separate file" + (st.name ? ": " + st.name : "") + " — OneDrive could not show whether your " + d +
      "'s version went over an office save: check the plan's version history in OneDrive";
  }
  // this device's earlier send went over an office save OneDrive would not put back (contract addendum 5 G3)
  if (st.state === "copy" && st.why === "not_put_back") {
    return "Saved as a separate file" + (st.name ? ": " + st.name : "") + " — your " + d +
      "'s version went over an office save and OneDrive would not put it back: ask the office to restore it from the plan's version history in OneDrive";
  }
  if (st.state === "copy") return "Saved as a separate file" + (st.name ? ": " + st.name : "") + " — nothing was overwritten";
  if (st.state === "lost") return "The save kept on this " + d + " was lost: the browser cleared this site's storage";
  return "";
}

/** What the person is told when the save became a separate file (contract C3, the owner's Q3). */
export function copyTold(name, device) {
  return "Someone saved this plan in the office after your " + (device || "device") + " got it. Your work was saved as '" + String(name || "") +
    "' next to it - nothing was overwritten.";
}

/** What the person is told when the save became a separate file because OneDrive would not replace the plan (the
    broker's plan_changed {why: "refused"}, contract addendum 3 D5): nobody saved anything in the office - no blame. */
export function refusedTold(name) {
  return "OneDrive would not replace the plan, so your work was saved as '" + String(name || "") + "' next to it - nothing was overwritten.";
}

/** The words of a save waiting because the broker's switch for the save back is off for its project (503
    save_back_off, contract addendum 3 D1): the row, the frame's bar. */
export function saveBackOffWords(device) {
  return "Saving back to OneDrive is turned off for now - this save waits on this " + (device || "device") + ".";
}

/** How the takeoff app's own stores went in a purge (js/plan-library.js purgeOwner's `takeoff`; contract addendum 3
    D8): removed; waiting - the app holds its drafts open (a frame), the delete runs once it closes; failed - the next
    online page tries again. */
export const TAKEOFF_PURGE = Object.freeze({
  removed: "was removed",
  waiting: "is removed once the takeoff app closes",
  failed: "could not be removed now - the next online page tries again",
});

/**
 * What the person is told when a purge on lost prices took their things from this device (js/plan-library.js
 * purgeOwner's {plans, unsent, takeoff}; review LW-4): the plans, the saves of theirs not yet in OneDrive that went with
 * them (that work is gone), and what became of what the takeoff app kept here (`takeoff`: "removed" | "waiting" |
 * "failed" - TAKEOFF_PURGE - or false: not purged). "" when nothing went. `device`: map/plans.js deviceWord.
 */
export function purgeText(p, device) {
  const d = device || "device";
  const n = (p && Number(p.plans)) || 0;
  const u = (p && Number(p.unsent)) || 0;
  const app = p && Object.prototype.hasOwnProperty.call(TAKEOFF_PURGE, p.takeoff) ? p.takeoff : "";
  if (!n && !app) return "";
  const kept = "what the takeoff app kept on this " + d + " (unsaved work, kept plans) ";
  const out = ["Your account no longer sees prices, so " + (n
    ? "the " + n + " plan" + (n === 1 ? "" : "s") + " you had saved on this " + d + (n === 1 ? " was" : " were") + " removed from it."
    : kept + TAKEOFF_PURGE[app] + ".")];
  if (u) out.push((u === 1 ? "1 save of yours that was not in OneDrive yet was" : u + " saves of yours that were not in OneDrive yet were") + " deleted with " + (n === 1 ? "it" : "them") + ".");
  if (n && app) out.push("W" + kept.slice(1) + TAKEOFF_PURGE[app] + (app === "removed" ? " too" : "") + ".");
  return out.join(" ");
}

/** A row's bar for its save: filling while it is sent, full once OneDrive has it; none otherwise (progressHtml's). */
export function sendBar(st) {
  if (!st) return null;
  if (st.state === "sending") return { pct: typeof st.pct === "number" ? st.pct : 0, kind: "run" };
  if (st.state === "sent" || st.state === "copy") return { pct: 100, kind: "done" };
  return null;
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
