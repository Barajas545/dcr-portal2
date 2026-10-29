/* The project pages' door to the upload queue (upload-queue2.js, PORTAL-CORE): custody in IndexedDB
   'dcr2Uploads' first, then a resumable (TUS) upload to project-files at Desktop 2's object path,
   then the files row (source portal2) — resumable after the app is killed.

   The queue names each file itself ("IMG 2026-10-19 14.30.12-2.jpg", unique: iPhones call every
   capture image.jpg, and the same name in the same place would become a new VERSION of one photo)
   and puts it in its place by kind:
     photo / video -> photos/<the day>        journal -> journal/<the entry's day> (+ its entry)
     voice / note  -> documents/Site Notes   receipt -> receipts (+ its cost; f/…: a money editor's)
     bill          -> receipts (+ its bill)  payment -> receipts (+ the payment's bill and the payment)
   A money file (receipt, bill, payment) is never a version of another: the database names a clash "x (2)" and the
   "done" event's row carries the name it gave.
   A journal picture taken before its entry exists (offline) is queued with pendingEntry = a local
   key and released by bindEntry(key, entryId) once the entry is saved.

   Pure helpers are exported for the node tests; the rest loads the queue lazily. */

import { stamp } from "../map/pacific.js";

export function isVideoFile(f) {
  return String((f && f.type) || "").indexOf("video/") === 0 || /\.(mov|mp4|m4v|avi|3gp|webm)$/i.test((f && f.name) || "");
}

/** A note's own name: "Note 2026-10-19 14.30.12 - Gate code.txt" (the title made file-safe). */
export function noteName(prefix, when, title, ext) {
  const t = String(title || "").replace(/[\\/:*?"<>|\u0000-\u001f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 60);
  return prefix + " " + stamp(when || new Date()) + (t ? " - " + t : "") + (ext || ".txt");
}

/** The queue's items -> [{id, name, state, pct, error, projectId, journalEntryId}]. */
export function progressItems(x) {
  const list = Array.isArray(x) ? x : (x && Array.isArray(x.items) ? x.items : []);
  return list.map(function (it) {
    return {
      id: it.id, name: it.name || "", state: String(it.state || "waiting"),
      pct: Math.max(0, Math.min(100, Math.round(Number(it.pct) || 0))), error: it.error ? String(it.error) : "",
      projectId: it.projectId == null ? null : String(it.projectId),
      journalEntryId: it.journalEntryId == null ? null : it.journalEntryId,
      pendingEntry: it.pendingEntry || null, size: it.size || 0, kind: it.kind || "",
      costId: it.costId == null ? null : it.costId,
      billId: it.billId == null ? null : it.billId,
      paymentId: it.paymentId == null ? null : it.paymentId,
      tag: it.tag ? String(it.tag) : "",
    };
  });
}

/** One project's queue at a glance: {total, failed, held, uploading, waiting}. */
export function summaryOf(items, projectId) {
  const mine = (items || []).filter(function (i) { return projectId == null || String(i.projectId) === String(projectId); });
  const n = function (s) { return mine.filter(function (i) { return i.state === s; }).length; };
  return { total: mine.length, failed: n("failed"), held: n("held"), uploading: n("uploading"), waiting: n("waiting") };
}

/** "47%", "waiting…", "held on this device", "failed — retry" for one queue item. */
export function itemLabel(it, online) {
  if (!it) return "saved";
  if (it.state === "failed") return (it.error || "failed") + " — retry";
  if (it.state === "held") return "waits for its entry";
  if (online === false) return "held on this device";
  if (it.state === "uploading") return (it.pct || 0) + "%";
  return "waiting…";
}

let qmod = null;
export async function queue() {
  if (qmod) return qmod;
  try { qmod = await import("../upload-queue2.js"); } catch (e) { qmod = null; }
  return qmod;
}

async function need() {
  const q = await queue();
  if (!q || typeof q.enqueue !== "function") {
    const e = new Error("The upload queue did not load — reload the page and try again.");
    e.code = "local_rule";
    throw e;
  }
  return q;
}

/** Hand one file to the queue -> its queue id once the bytes are safe on this device.
    job: {projectId, file, kind, caption, takenAt, gps, journalEntryId, entryDate, pendingEntry, name, costId,
    billId, paymentId, tag, keepName, preview, folder, subpath} (costId: a receipt's cost; billId: a bill's file's
    bill, and a payment's file's bill with paymentId its payment; tag: the page's own note on the item; keepName:
    the name as given; preview: false for no small copy; folder / subpath: another place than the kind's) */
export async function enqueue(job) {
  const q = await need();
  return q.enqueue(queueOptions(job));
}

/** The job as the queue takes it (only what was given; node tests check it). */
export function queueOptions(job) {
  const o = { projectId: job.projectId, file: job.file, kind: job.kind, caption: job.caption || "",
    takenAt: job.takenAt || new Date(), gps: job.gps || null };
  if (job.name) o.name = job.name;
  if (job.journalEntryId != null) o.journalEntryId = job.journalEntryId;
  if (job.entryDate) o.entryDate = job.entryDate;
  if (job.pendingEntry) o.pendingEntry = job.pendingEntry;
  if (job.costId != null) o.costId = job.costId;
  if (job.billId != null) o.billId = job.billId;
  if (job.paymentId != null) o.paymentId = job.paymentId;
  if (job.tag) o.tag = String(job.tag);
  if (job.keepName) o.keepName = true;
  if (job.preview === false) o.preview = false;
  if (job.folder) o.folder = job.folder;
  if (job.subpath !== undefined && job.subpath !== null) o.subpath = String(job.subpath);
  return o;
}

/** cb(items, event) -> Promise<unsubscribe>; event {type: "done", item, row} when a file landed. */
export async function onProgress(cb) {
  const q = await queue();
  if (!q || typeof q.onProgress !== "function") return function () {};
  const off = q.onProgress(function (items, evt) {
    try { cb(progressItems(items), evt || null); } catch (e) { /* drawing never breaks the queue */ }
  });
  return typeof off === "function" ? off : function () {};
}

export async function bindEntry(localKey, entryId) {
  const q = await queue();
  if (q && typeof q.bindEntry === "function") return q.bindEntry(localKey, entryId);
  return null;
}

/** Take one file off the queue before it uploads (the journal's ✕ on a photo still on its way). */
export async function remove(id) {
  const q = await queue();
  if (q && typeof q.remove === "function") return q.remove(id);
  return null;
}

export async function retryAll() {
  const q = await queue();
  if (q && typeof q.retryAll === "function") { try { return await q.retryAll(); } catch (e) { /* it retries itself */ } }
  return null;
}

export async function drain() {
  const q = await queue();
  if (q && typeof q.drain === "function") { try { return await q.drain(); } catch (e) { /* */ } }
  return null;
}

export async function durable() {
  const q = await queue();
  return !q || typeof q.durable !== "function" ? true : q.durable();
}
