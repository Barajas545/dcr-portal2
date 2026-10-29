/* The upload queue that does not lose pictures — Portal 2 (BLUEPRINT 2.2.5).

   Same custody idea as the old portal's upload-queue.js: the bytes go into IndexedDB the moment a
   file is picked, BEFORE any network, and the queue drains whenever there is a connection (on page
   load, when the connection comes back, after a kill). What changed:

   - IndexedDB "dcr2Uploads" (Appendix C), never the old portal's queue;
   - bytes go to the private bucket "project-files" at DCR Desktop 2's object path
     p/{project_id}/{folder}/{uuid}/{ascii_slug(name)} (dcrdesk/backend/files.py object_key, with
     the same safe_name / ascii_slug rules), never overwritten (x-upsert: false);
   - up to 6 MiB one request; above that Supabase's resumable (TUS) endpoint in 6 MiB chunks (every
     chunk but the last exactly 6 MiB, as Supabase requires and Desktop 2's transfers do), a fresh
     access token for each request, the upload URL and offset kept after every chunk so a killed
     page resumes where it stopped (HEAD asks the server); a 409 when the upload is created means
     the object is already complete;
   - images also get a <= 320 px JPEG preview uploaded next to the original (files.preview_path);
   - once the object is complete, the files row is inserted: photos -> folder "photos", sub-folder
     the day taken; journal -> "journal" with journal_entry_id, sub-folder the entry's day; voice
     and text notes -> "documents"/"Site Notes"; the money files (the Books program's contract §4.1,
     migration 20261030000100_money_files) -> "receipts", no sub-folder, under f/{project}/receipts/…
     (financial: a money editor's): a receipt (a cost's, D13) with cost_id, a bill's file (its document or
     an extra) with bill_id, a payment's file (a photo of the check, a transfer confirmation) with
     bill_id = the payment's bill AND payment_id; caption -> files.description; source "portal2".
     Every upload has a sub-folder (one "Files uploaded to …" log line per person, folder and hour)
     and a unique display name ("IMG 2026-10-19 14.30.12-2.jpg"): the same name in the same place
     would become a new VERSION hiding the earlier photo, and iPhones call every capture image.jpg.
     The name is checked against the project's current files just before the row goes in - except a
     money file's: it is never a version (each upload is its own row) and the DATABASE makes its name
     unique among the record's live files ("INV-4101 (2).pdf", atomically); the row that comes back
     carries the name to show;
   - records belong to the account that queued them; another account signed in on the same device
     never uploads them under its own name;
   - one tab drains at a time (Web Lock "dcr2-upload-queue").

   API: enqueue({projectId, file, kind, caption, takenAt, gps, name?, journalEntryId?, entryDate?,
   pendingEntry?, folder?, subpath?, tag?, costId?, billId?, paymentId?, keepName?, preview?}) -> id once the
   bytes are safe on this device (costId: a receipt's cost, required for kind "receipt"; billId: the bill of
   kind "bill" (its document or an extra) and of kind "payment", whose paymentId is required too; tag: the
   page's own note on the item, kept with it - the bill page's "document" / "replace:<file id>"; keepName: the
   name as given, even when the place has one already — the database then makes it a new version; preview:
   false, no small preview);
   onProgress(cb) -> unsubscribe; drain(); list(); listFor(projectId); remove(id); retryAll();
   bindEntry(localKey, entryId); durable(); online().                                            */

import { BUCKET, session, storedUserId, sb as sbClient } from "./sb.js";
import { companyDay, mapError } from "./common2.js";

export const DB_NAME = "dcr2Uploads";
export const STORE = "q";
export const MIB = 1024 * 1024;
export const CHUNK = 6 * MIB;              // Supabase TUS: exactly 6 MiB per chunk but the last
export const SIMPLE_LIMIT = 6 * MIB;       // up to this: one request (Desktop 2's SIMPLE_LIMIT)
export const MAX_TRIES = 8;
export const FILE_SOURCE = "portal2";
export const PREVIEW_MAX = 320;
export const PREVIEW_NAME = "preview-320.jpg";
const TUS_VERSION = "1.0.0";
const LOCK = "dcr2-upload-queue";

/* ── names and keys (DCR Desktop 2's dcrdesk/backend/files.py) ──────────── */

const PY_WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const UNSAFE = /[\\/:*?"<>|\r\n\t‎‏‪-‮⁦-⁩]/g;
const KEY_UNSAFE = /[^A-Za-z0-9._ ()-]+/g;
const LONE_SURROGATE = /[\uD800-\uDFFF]/gu;     // with the u flag only an unpaired half matches

const PY_WS_RE = new RegExp("^[" + PY_WS + "]$");
/* Python's str.strip(chars) (both ends) and str.rstrip(chars) (the right end only). */
function pyStrip(s, chars, rightOnly) {
  const isStrip = (ch) => (chars === undefined ? PY_WS_RE.test(ch) : chars.indexOf(ch) !== -1);
  let a = 0, b = s.length;
  if (!rightOnly) while (a < b && isStrip(s[a])) a++;
  while (b > a && isStrip(s[b - 1])) b--;
  return s.slice(a, b);
}

/** A file name Windows accepts (safe_name): no \ / : * ? " < > |, line breaks or bidi controls,
    no white space at either end, no trailing dots; empty -> fallback. */
export function safeName(text, fallback) {
  const fb = fallback === undefined ? "Document" : fallback;
  let s = String(text ?? "").replace(UNSAFE, "").replace(LONE_SURROGATE, "_");
  for (;;) {
    const t = pyStrip(pyStrip(pyStrip(s), ". ", true));
    if (t === s) break;
    s = t;
  }
  return s || fb;
}

/** The name as Storage keys accept it (ascii_slug): accents folded, other characters dropped. */
export function asciiSlug(name, fallback) {
  const fb = fallback === undefined ? "file" : fallback;
  const folded = safeName(name, fb).normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
  const slug = pyStrip(folded.replace(KEY_UNSAFE, "_"), " ._") || fb;
  return slug.slice(0, 120);
}

export function newUid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replace(/-/g, "");
  }
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/** {p|f}/{project_id}/{folder}/{uuid}/{ascii_slug(name)}: f/ for the receipts folder - every money file: a
    cost's receipt, a bill's document or extra, a payment's file (financial files: the files check and the
    Storage policy want them there, and only a money editor writes one) -, p/ for everything else. A money
    file's key is exactly what the database's t14_files_money_shape takes: 32 hex characters, then the slug. */
export function objectKey(projectId, folder, name, uid) {
  return (folder === "receipts" ? "f" : "p") + "/" + projectId + "/" + folder + "/" + (uid || newUid()) + "/" + asciiSlug(name);
}

export function previewKeyFor(key) {
  const dir = key.slice(0, key.lastIndexOf("/"));
  const leaf = key.slice(key.lastIndexOf("/") + 1);
  return dir + "/" + (leaf === PREVIEW_NAME ? "preview-320-b.jpg" : PREVIEW_NAME);
}

const MIMES = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  heic: "image/heic", heif: "image/heif", mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v",
  "3gp": "video/3gpp", webm: "video/webm", m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav",
  ogg: "audio/ogg", aac: "audio/aac", txt: "text/plain", pdf: "application/pdf",
};
export function guessMime(name) {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || ""));
  return (m && MIMES[m[1].toLowerCase()]) || "application/octet-stream";
}

/** Keep the device's own extension (an iPhone HEIC must not be stored as .jpg). */
export function extOf(file) {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec((file && file.name) || "");
  if (m) return "." + m[1].toLowerCase();
  const t = String((file && file.type) || "");
  const sub = (t.split("/")[1] || "").split(";")[0].replace(/^x-/, "");
  if (t.indexOf("video/") === 0) return "." + (sub === "quicktime" ? "mov" : sub || "mp4");
  if (t.indexOf("image/") === 0) return "." + (sub === "jpeg" ? "jpg" : sub || "jpg");
  if (t.indexOf("audio/") === 0) return "." + (sub === "mpeg" ? "mp3" : sub || "m4a");
  if (t.indexOf("text/") === 0) return ".txt";
  return "";
}

/** "2026-10-19 14.30.12" in company time. */
export function stamp(when) {
  const d = new Date(when);
  const day = companyDay(d);
  const t = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit",
    second: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (k) => (t.find((p) => p.type === k) || {}).value || "00";
  return day + " " + get("hour").replace("24", "00") + "." + get("minute") + "." + get("second");
}

const PREFIX = { photo: "IMG ", video: "VID ", voice: "Voice note ", note: "Note ", journal: "IMG ", document: "Document ", receipt: "Receipt ",
  bill: "Bill ", payment: "Payment " };
/** The money kinds: the receipts folder, f/ keys, the database's own unique names (never a version). */
export const MONEY_KINDS = Object.freeze(["receipt", "bill", "payment"]);

/** The display name of an upload: "IMG 2026-10-19 14.30.12-2.jpg" (n > 1 adds "-n"). */
export function displayName(kind, file, when, n) {
  const isVid = String((file && file.type) || "").indexOf("video/") === 0 || /\.(mov|mp4|m4v|avi|3gp)$/i.test((file && file.name) || "");
  const prefix = isVid && (kind === "photo" || kind === "journal") ? "VID " : PREFIX[kind] || "IMG ";
  return prefix + stamp(when) + (n > 1 ? "-" + n : "") + extOf(file);
}

/** "IMG x.jpg" -> "IMG x-3.jpg" (an earlier "-k" suffix is replaced). */
export function bumpName(name, n) {
  const m = /^(.*?)(\.[A-Za-z0-9]{1,5})?$/.exec(name);
  const base = (m[1] || name).replace(/-\d+$/, "");
  return base + "-" + n + (m[2] || "");
}

/** Where a kind of upload goes: folder and sub-folder. */
export function placeFor(kind, o, takenAt) {
  const opt = o || {};
  if (kind === "receipt") return { folder: "receipts", subpath: opt.subpath ? String(opt.subpath) : "" };   // Desktop 2: none
  if (kind === "bill" || kind === "payment") return { folder: "receipts", subpath: "" };   // Desktop 2's bill files: receipts + bill_id
  if (opt.folder) return { folder: opt.folder, subpath: opt.subpath !== undefined ? String(opt.subpath) : companyDay(takenAt) };
  if (kind === "journal") return { folder: "journal", subpath: opt.subpath || opt.entryDate || companyDay(takenAt) };
  if (kind === "voice" || kind === "note" || kind === "document") return { folder: "documents", subpath: opt.subpath || "Site Notes" };
  return { folder: "photos", subpath: opt.subpath || companyDay(takenAt) };
}

/* ── errors ───────────────────────────────────────────────────────────── */

function qerr(message, extra) {
  const e = new Error(message);
  e.own = true;
  return Object.assign(e, extra || {});
}
const netErr = (m) => qerr(m || "No connection", { status: 0, retryable: true, kind: "offline" });

const TOO_LARGE = "The file is larger than the DCR file storage accepts per file (the limit is set by the " +
  "Supabase plan and the project's Storage settings).";

function storageErr(status, body) {
  const inner = Number(body && body.statusCode) || status;
  const text = String((body && (body.message || body.error)) || "");
  if (inner === 413 || status === 413 || /too large|maximum allowed size|maximum size exceeded/i.test(text)) {
    return qerr(TOO_LARGE, { status: 413, fatal: true, code: "too_large", kind: "validation" });
  }
  if (inner === 403 || status === 403 || /row-level security|unauthorized/i.test(text)) {
    return qerr("You don't have permission to upload files to this project.", { status: 403, fatal: true, kind: "forbidden" });
  }
  if (inner === 401 || status === 401) return qerr("Your sign-in needs refreshing.", { status: 401, retryable: true, kind: "auth" });
  if (status === 0 || status === 408 || status === 423 || status === 429 || status === 460 || status >= 500) {
    return qerr("Storage did not answer (" + status + ").", { status, retryable: true, kind: "offline" });
  }
  return qerr("Storage refused the upload (" + (inner || status) + ")" + (text ? ": " + text : "."), { status, fatal: true, kind: "validation" });
}

/* ── transports: {method, url, headers, body, onProgress} -> {status, header(name), text()} ── */

export function fetchTransport(fetchImpl) {
  return async function send(req) {
    let res;
    try {
      res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body });
    } catch (e) {
      throw netErr("No connection");
    }
    const text = await res.text().catch(() => "");
    if (req.onProgress && res.status < 300 && req.body && req.body.size) req.onProgress(req.body.size);
    return { status: res.status, header: (n) => res.headers.get(n), text: () => text };
  };
}

export function xhrTransport() {
  return function send(req) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open(req.method, req.url);
      for (const [k, v] of Object.entries(req.headers || {})) x.setRequestHeader(k, v);
      x.timeout = 180000;
      if (req.onProgress && x.upload) {
        x.upload.onprogress = (ev) => { if (ev.lengthComputable) req.onProgress(ev.loaded); };
      }
      x.onload = () => resolve({ status: x.status, header: (n) => x.getResponseHeader(n), text: () => x.responseText || "" });
      x.onerror = () => reject(netErr("No connection"));
      x.ontimeout = () => reject(netErr("Timed out"));
      x.onabort = () => reject(netErr("Stopped"));
      x.send(req.body === undefined ? null : req.body);
    });
  };
}

function b64(text) {
  const bytes = new TextEncoder().encode(String(text));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
}

const encodeKey = (key) => key.split("/").map(encodeURIComponent).join("/");

function parseBody(res) {
  try { return JSON.parse(res.text() || "null"); } catch (e) { return null; }
}

/* ── the queue ────────────────────────────────────────────────────────── */

const isItem = (r) => r && !String(r.id).startsWith("entry:");

/** A queue over injected parts (the tests use memory and a fake Storage; the page uses
    IndexedDB, XMLHttpRequest and supabase-js):
      store   {put(rec), del(id), all()}             durable custody
      send    transport (see above)
      auth()  -> {url, apikey, token}                a fresh token (refreshes when expired)
      owner() -> user id of this device's sign-in, without network (or null)
      db      {findByPath(key), nameTaken(place, name), insert(row)}
      online(), now(), lock(fn), makePreview(blob, mime), uid(), timers                         */
export function createQueue(parts) {
  const d = Object.assign({
    online: () => true,
    now: () => Date.now(),
    lock: (fn) => fn(),
    makePreview: async () => null,
    uid: newUid,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t),
    durable: () => true,
  }, parts);
  const listeners = new Set();
  const live = {};             // id -> bytes sent now (between persisted chunk ends)
  const removed = new Set();
  let draining = null;
  let again = false;
  let wake = null;
  let seq = 0;
  let emitTimer = null;

  function pub(r) {
    const sent = live[r.id] !== undefined ? live[r.id] : r.sent || 0;
    return {
      id: r.id, projectId: r.projectId, name: r.name, kind: r.kind, folder: r.folder, subpath: r.subpath,
      size: r.size || 0, sent, pct: r.size ? Math.min(100, Math.round((sent / r.size) * 100)) : 0,
      state: r.state || "waiting", stage: r.stage, error: r.error || "", tries: r.tries || 0, added: r.added,
      caption: r.caption || "", takenAt: r.takenAt, journalEntryId: r.journalEntryId ?? null,
      pendingEntry: r.pendingEntry || null, tag: r.tag || "", mime: r.mime, costId: r.costId ?? null,
      billId: r.billId ?? null, paymentId: r.paymentId ?? null,
    };
  }

  async function list() {
    const all = (await d.store.all()).filter(isItem);
    return all.sort((a, b) => a.added - b.added).map(pub);
  }

  async function emitNow(evt) {
    if (!listeners.size) return;
    let items = [];
    try { items = await list(); } catch (e) { items = []; }
    for (const cb of Array.from(listeners)) {
      try { cb(items, evt || null); } catch (e) { /* a listener never stalls the queue */ }
    }
  }
  function emit(evt) {
    if (evt) return emitNow(evt);
    if (emitTimer) return undefined;
    emitTimer = d.setTimeout(() => { emitTimer = null; emitNow(); }, 120);
    return undefined;
  }

  async function save(r) {
    if (removed.has(r.id)) throw qerr("Removed", { removed: true });
    await d.store.put(r);
  }

  /* custody */
  async function enqueue(o) {
    const opt = o || {};
    const file = opt.file || opt.blob;
    if (!file || !file.size) throw qerr("The file is empty.", { code: "local_rule", kind: "validation", fatal: true });
    if (opt.projectId === undefined || opt.projectId === null || opt.projectId === "") {
      throw qerr("A file belongs to a project.", { code: "local_rule", kind: "validation", fatal: true });
    }
    const mime = String(opt.mime || file.type || guessMime(file.name));
    const kind = opt.kind || (mime.indexOf("video/") === 0 ? "video" : mime.indexOf("audio/") === 0 ? "voice" : "photo");
    const idIn = (v) => (v === undefined || v === null || v === "" ? null : (/^\d+$/.test(String(v)) ? Number(v) : v));
    const costId = idIn(opt.costId);
    // a bill's or a payment's file names its bill (a payment's: the payment's own bill, and the payment)
    const billId = kind === "bill" || kind === "payment" ? idIn(opt.billId) : null;
    const paymentId = kind === "payment" ? idIn(opt.paymentId) : null;
    if (kind === "receipt" && costId === null) {
      throw qerr("A receipt belongs to a cost.", { code: "local_rule", kind: "validation", fatal: true });
    }
    if ((kind === "bill" || kind === "payment") && billId === null) {
      throw qerr("A bill's file belongs to its bill.", { code: "local_rule", kind: "validation", fatal: true });
    }
    if (kind === "payment" && paymentId === null) {
      throw qerr("A payment's file belongs to its payment.", { code: "local_rule", kind: "validation", fatal: true });
    }
    if ((kind === "bill" || kind === "payment") && costId !== null) {
      throw qerr("A bill's or a payment's file is not a cost's receipt.", { code: "local_rule", kind: "validation", fatal: true });
    }
    const when = opt.takenAt ? new Date(opt.takenAt) : new Date(d.now());
    const takenAt = isNaN(when.getTime()) ? new Date(d.now()).toISOString() : when.toISOString();
    const place = placeFor(kind, opt, takenAt);
    let name;
    if (opt.name) name = safeName(opt.name, "File");
    else {
      seq += 1;
      name = displayName(kind, file, takenAt, 1);
      const taken = new Set((await list()).filter((r) => r.projectId === String(opt.projectId)).map((r) => r.name.toLowerCase()));
      for (let n = 2; taken.has(name.toLowerCase()) && n < 999; n++) name = displayName(kind, file, takenAt, n);
    }
    const projectId = /^\d+$/.test(String(opt.projectId)) ? Number(opt.projectId) : opt.projectId;
    const rec = {
      id: String(d.now()) + "-" + Math.random().toString(36).slice(2, 8),
      owner: opt.owner || d.owner() || null,
      projectId: String(opt.projectId), projectKey: projectId,
      kind, folder: place.folder, subpath: place.subpath,
      journalEntryId: opt.journalEntryId ?? null, pendingEntry: opt.pendingEntry || null,
      name, mime, size: file.size, blob: file, preview: null, caption: String(opt.caption || ""),
      takenAt, gps: opt.gps || null, tag: opt.tag || "", costId, billId, paymentId, keepName: !!opt.keepName,
      key: objectKey(projectId, place.folder, name, d.uid()), previewKey: null,
      tus: null, sent: 0, stage: "object", state: "waiting", error: "", tries: 0, waitUntil: 0,
      added: d.now(), ready: false,
    };
    if (rec.folder === "journal" && rec.journalEntryId === null && !rec.pendingEntry) {
      throw qerr("A journal picture needs its journal entry.", { code: "local_rule", kind: "validation", fatal: true });
    }
    await d.store.put(rec);                 // the bytes are on this device now
    emit();
    if (opt.preview !== false) {             // preview: false — no small copy next to it
      try {
        const pv = await Promise.race([
          d.makePreview(file, mime),
          new Promise((r) => d.setTimeout(() => r(null), 4000)),
        ]);
        if (pv && pv.size) { rec.preview = pv; rec.previewKey = previewKeyFor(rec.key); }
      } catch (e) { /* no preview: the file still goes up */ }
    }
    rec.ready = true;
    if (!removed.has(rec.id)) await d.store.put(rec);
    emit();
    drain();
    return rec.id;
  }

  function ready(r) {
    return r.ready || d.now() - (r.added || 0) > 30000;
  }

  /* one step of work on one record; returns "done" | "blocked" | "later" */
  async function step(r) {
    r.state = "uploading";
    r.error = "";
    await save(r);
    emit();
    if (r.stage === "object") {
      if (r.size <= SIMPLE_LIMIT) await sendSmall(r, r.key, r.blob, r.mime, true);
      else await sendTus(r);
      delete live[r.id];
      r.sent = r.size;
      r.tus = null;
      r.stage = r.preview && r.previewKey ? "preview" : "row";
      r.tries = 0;
      await save(r);
      emit();
    }
    if (r.stage === "preview") {
      try {
        await sendSmall(r, r.previewKey, r.preview, "image/jpeg", false);
      } catch (e) {
        if (!e.retryable) r.previewKey = null;     // refused: the photo goes in without a preview
        else throw e;
      }
      r.preview = null;
      r.stage = "row";
      await save(r);
    }
    if (r.stage === "row") {
      let entryId = r.journalEntryId;
      if ((entryId === null || entryId === undefined) && r.pendingEntry) {
        const all = await d.store.all();
        const b = all.find((x) => x && x.id === "entry:" + r.pendingEntry);
        if (!b) {
          r.state = "held";
          r.error = "Waiting for its journal entry to be saved.";
          await save(r);
          emit();
          return "blocked";
        }
        entryId = b.entryId;
        r.journalEntryId = entryId;
      }
      const row = await insertRow(r, entryId);
      await d.store.del(r.id);
      delete live[r.id];
      await emit({ type: "done", item: pub(r), row });
      return "done";
    }
    return "later";
  }

  async function sendSmall(r, key, blob, mime, isMain) {
    const a = await d.auth();
    const res = await d.send({
      method: "POST",
      url: a.url + "/storage/v1/object/" + BUCKET + "/" + encodeKey(key),
      headers: { apikey: a.apikey, authorization: "Bearer " + a.token, "x-upsert": "false",
        "content-type": mime || "application/octet-stream", "cache-control": "3600" },
      body: blob,
      onProgress: isMain ? (n) => { live[r.id] = Math.min(n, r.size); emit(); } : null,
    });
    if (res.status >= 200 && res.status < 300) return;
    const body = parseBody(res);
    const inner = Number(body && body.statusCode) || res.status;
    if (inner === 409 || /duplicate|already exists/i.test(String((body && (body.error + " " + body.message)) || ""))) return;
    throw storageErr(res.status, body);
  }

  async function tusHead(r) {
    const a = await d.auth();
    const res = await d.send({ method: "HEAD", url: r.tus, headers: { apikey: a.apikey, authorization: "Bearer " + a.token, "tus-resumable": TUS_VERSION } });
    if (res.status === 404 || res.status === 410) return null;
    if (res.status >= 400) throw storageErr(res.status, parseBody(res));
    const off = Number(res.header("upload-offset"));
    return Number.isFinite(off) ? off : 0;
  }

  async function tusCreate(r) {
    const a = await d.auth();
    const meta = ["bucketName " + b64(BUCKET), "objectName " + b64(r.key),
      "contentType " + b64(r.mime || "application/octet-stream"), "cacheControl " + b64("3600")].join(",");
    const res = await d.send({
      method: "POST", url: a.url + "/storage/v1/upload/resumable",
      headers: { apikey: a.apikey, authorization: "Bearer " + a.token, "tus-resumable": TUS_VERSION,
        "upload-length": String(r.size), "upload-metadata": meta, "x-upsert": "false" },
    });
    if (res.status === 409) return false;                     // already complete
    const loc = res.header("location");
    if (res.status !== 201 || !loc) throw storageErr(res.status || 500, parseBody(res));
    r.tus = new URL(loc, a.url + "/storage/v1/").href;
    r.sent = 0;
    await save(r);
    return true;
  }

  async function sendTus(r) {
    if (r.tus) {
      const off = await tusHead(r);
      if (off === null) { r.tus = null; r.sent = 0; await save(r); }
      else r.sent = off;
    }
    if (!r.tus) {
      const open = await tusCreate(r);
      if (!open) return;
    }
    let failures = 0;
    while (r.sent < r.size) {
      const a = await d.auth();                          // a fresh token for every chunk
      const start = r.sent;
      const end = Math.min(start + CHUNK, r.size);
      let res;
      try {
        res = await d.send({
          method: "PATCH", url: r.tus,
          headers: { apikey: a.apikey, authorization: "Bearer " + a.token, "tus-resumable": TUS_VERSION,
            "upload-offset": String(start), "content-type": "application/offset+octet-stream" },
          body: r.blob.slice(start, end),
          onProgress: (n) => { live[r.id] = start + n; emit(); },
        });
      } catch (e) {
        throw e;                                          // the next attempt asks the server (HEAD)
      }
      if (res.status === 204 || res.status === 200) {
        const off = Number(res.header("upload-offset"));
        r.sent = Number.isFinite(off) && off > start ? off : end;
        live[r.id] = r.sent;
        failures = 0;
        await save(r);
        emit();
        continue;
      }
      if (res.status === 404 || res.status === 410) {
        r.tus = null; r.sent = 0;
        await save(r);
        throw qerr("The upload expired; it starts again.", { status: res.status, retryable: true, kind: "offline" });
      }
      if (res.status === 409 || res.status === 423 || res.status === 429 || res.status === 460 || res.status === 408 || res.status >= 500) {
        if (++failures > 4) throw storageErr(res.status, parseBody(res));
        const off = await tusHead(r);
        if (off === null) { r.tus = null; r.sent = 0; await save(r); throw qerr("The upload expired; it starts again.", { retryable: true }); }
        r.sent = off;
        continue;
      }
      throw storageErr(res.status, parseBody(res));
    }
  }

  async function insertRow(r, entryId) {
    const existing = await d.db.findByPath(r.key);
    if (existing) return existing;                       // an earlier attempt's answer was lost
    const place = { project_id: r.projectKey ?? r.projectId, folder: r.folder, subpath: r.subpath, journal_entry_id: entryId ?? null };
    if (r.costId !== null && r.costId !== undefined) place.cost_id = r.costId;
    if (r.billId !== null && r.billId !== undefined) place.bill_id = r.billId;
    if (r.paymentId !== null && r.paymentId !== undefined) place.payment_id = r.paymentId;
    let name = r.name;
    // a money file (a cost's, a bill's or a payment's) is never a version: the database makes its name unique among
    // the record's live files ("INV-4101 (2).pdf") under one lock, and the row it answers carries that name. Anything
    // else - keepName: the same name in the same place on purpose (a new version of it); else a free name
    const money = place.cost_id !== undefined || place.bill_id !== undefined || place.payment_id !== undefined;
    if (!r.keepName && !money) for (let n = 2; n < 60 && await d.db.nameTaken(place, name); n++) name = bumpName(r.name, n);
    const row = Object.assign({}, place, {
      name, storage_path: r.key, size: r.size, mime: r.mime,
      description: r.caption ? r.caption : null, preview_path: r.previewKey || null, source: FILE_SOURCE,
    });
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await d.db.insert(row);
      } catch (e) {
        const code = String((e && e.code) || "");
        const col = /'([a-z_]+)' column/.exec(String((e && e.message) || ""));
        if ((code === "PGRST204" || code === "42703") && col && col[1] in row &&
            ["description", "preview_path", "source"].indexOf(col[1]) !== -1) {
          delete row[col[1]];                            // before migration M1
          continue;
        }
        if (code === "23505") {
          const again2 = await d.db.findByPath(r.key);
          if (again2) return again2;
        }
        throw e;
      }
    }
    return d.db.insert(row);
  }

  function classify(e) {
    if (e && e.removed) return { gone: true };
    if (e && e.own) return { retry: !!e.retryable && !e.fatal, message: e.message };
    const m = mapError(e);
    return { retry: m.retryable || m.kind === "auth", message: m.message };
  }

  async function runOnce() {
    for (;;) {
      if (!d.online()) return;
      const who = d.owner();
      if (!who) return;                                  // nobody signed in: wait for them
      const now = d.now();
      const all = (await d.store.all()).filter(isItem);
      const mine = all.filter((r) => r.owner === who && r.state !== "failed" && ready(r) && !removed.has(r.id));
      const due = mine.filter((r) => !(r.waitUntil > now) && r.state !== "held")
        .sort((a, b) => a.added - b.added);
      // held records (waiting for their journal entry) are looked at again when an entry is bound
      if (!due.length) {
        const later = mine.filter((r) => r.waitUntil > now).map((r) => r.waitUntil);
        if (later.length) schedule(Math.min(...later) - now);
        return;
      }
      const r = due[0];
      try {
        await step(r);
      } catch (e) {
        delete live[r.id];
        const c = classify(e);
        if (c.gone) continue;
        r.tries = (r.tries || 0) + 1;
        r.error = c.message || "Upload failed";
        if (!c.retry || r.tries >= MAX_TRIES) {
          r.state = "failed";
        } else {
          r.state = "waiting";
          r.waitUntil = d.now() + Math.min(30000, 2000 * r.tries);
        }
        try { await save(r); } catch (e2) { /* removed meanwhile */ }
        emit();
      }
    }
  }

  function schedule(ms) {
    if (wake) d.clearTimeout(wake);
    wake = d.setTimeout(() => { wake = null; drain(); }, Math.max(50, ms));
  }

  /** Drain. Safe to call any time: it no-ops while running (and runs once more after). */
  function drain() {
    if (draining) { again = true; return draining; }
    draining = Promise.resolve(d.lock(async () => {
      do { again = false; await runOnce(); } while (again);
    })).catch(() => {}).then(() => { draining = null; });
    return draining;
  }

  async function remove(id) {
    removed.add(id);
    await d.store.del(id);
    delete live[id];
    emit();
  }

  async function retryAll() {
    const all = (await d.store.all()).filter(isItem);
    for (const r of all) {
      if (r.state === "failed" || r.waitUntil || r.state === "held") {
        r.state = "waiting"; r.tries = 0; r.error = ""; r.waitUntil = 0;
        await d.store.put(r);
      }
    }
    emit();
    return drain();
  }

  /** A journal entry saved after its pictures were queued (offline): give them its id. */
  async function bindEntry(localKey, entryId) {
    await d.store.put({ id: "entry:" + localKey, entryId, at: d.now() });
    const all = (await d.store.all()).filter(isItem);
    for (const r of all) {
      if (r.pendingEntry === localKey && r.state === "held") { r.state = "waiting"; r.error = ""; await d.store.put(r); }
    }
    return drain();
  }

  function onProgress(cb) {
    listeners.add(cb);
    emitNow();
    return () => listeners.delete(cb);
  }

  return {
    enqueue, list,
    listFor: async (projectId) => (await list()).filter((r) => String(r.projectId) === String(projectId)),
    count: async () => (await list()).length,
    remove, retryAll, bindEntry, drain, onProgress,
    durable: () => d.durable(),
    online: () => d.online(),
  };
}

/* ── the page's queue: IndexedDB, XMLHttpRequest, supabase-js ─────────── */

function idbStore() {
  let dbp = null;
  let mem = null;
  function open() {
    if (mem) return Promise.resolve(null);
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { mem = new Map(); return resolve(null); }
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { mem = new Map(); resolve(null); };
      req.onblocked = () => { mem = new Map(); resolve(null); };
    });
    return dbp;
  }
  function run(mode, fn) {
    return open().then((db) => {
      if (!db) return fn(null);
      return new Promise((res, rej) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        let out;
        if (r) r.onsuccess = () => { out = r.result; };
        t.oncomplete = () => res(out);
        t.onerror = t.onabort = () => rej(t.error || new Error("The upload store refused the write."));
      });
    });
  }
  return {
    put: (v) => run("readwrite", (s) => (s ? s.put(v) : (mem.set(v.id, v), null))),
    del: (id) => run("readwrite", (s) => (s ? s.delete(id) : (mem.delete(id), null))),
    all: () => run("readonly", (s) => (s ? s.getAll() : null)).then((r) => r || (mem ? Array.from(mem.values()) : [])),
    durable: () => !mem,
  };
}

async function browserPreview(blob, mime) {
  if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(mime) || typeof createImageBitmap !== "function") return null;
  let bmp;
  try { bmp = await createImageBitmap(blob, { imageOrientation: "from-image" }); } catch (e) { return null; }
  const scale = Math.min(1, PREVIEW_MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const hgt = Math.max(1, Math.round(bmp.height * scale));
  let out = null;
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(w, hgt);
    c.getContext("2d").drawImage(bmp, 0, 0, w, hgt);
    out = await c.convertToBlob({ type: "image/jpeg", quality: 0.72 });
  } else {
    const c = document.createElement("canvas");
    c.width = w; c.height = hgt;
    c.getContext("2d").drawImage(bmp, 0, 0, w, hgt);
    out = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.72));
  }
  if (bmp.close) bmp.close();
  return out;
}

function likeExact(text) {
  return String(text).replace(/[\\%_]/g, (c) => "\\" + c);
}

/** The three database calls of the queue (the same calls tools/schema-check.mjs runs against the real
    schema). `client` () -> the supabase client; the page's own by default. */
export function filesDb(client) {
  const sb = client || sbClient;
  return {
    async findByPath(key) {
      const { data, error, status } = await sb().from("files").select("*").eq("storage_path", key).maybeSingle();
      if (error) { error.status = status; throw error; }
      return data || null;
    },
    async nameTaken(place, name) {
      let q = sb().from("current_files").select("id").eq("project_id", place.project_id).eq("folder", place.folder)
        .ilike("subpath", likeExact(place.subpath || "")).ilike("name", likeExact(name)).limit(1);
      q = place.journal_entry_id === null || place.journal_entry_id === undefined
        ? q.is("journal_entry_id", null) : q.eq("journal_entry_id", place.journal_entry_id);
      // a money file's name is its record's: the same name on two costs, bills or payments is two files (the queue
      // itself leaves a money file's name to the database: 20261030000100_money_files makes it unique)
      if (place.cost_id !== null && place.cost_id !== undefined) q = q.eq("cost_id", place.cost_id);
      if (place.bill_id !== null && place.bill_id !== undefined) q = q.eq("bill_id", place.bill_id);
      if (place.payment_id !== null && place.payment_id !== undefined) q = q.eq("payment_id", place.payment_id);
      const { data, error, status } = await q;
      if (error) { error.status = status; throw error; }
      return !!(data && data.length);
    },
    async insert(row) {
      const { data, error, status } = await sb().from("files").insert(row).select().single();
      if (error) { error.status = status; throw error; }
      return data;
    },
  };
}

let _queue = null;
function queue() {
  if (_queue) return _queue;
  const store = idbStore();
  _queue = createQueue({
    store,
    send: typeof XMLHttpRequest !== "undefined" ? xhrTransport() : fetchTransport(globalThis.fetch),
    auth: async () => {
      const s = await session();
      if (!s) throw qerr("Sign in again to upload.", { status: 401, retryable: true, kind: "auth" });
      const c = globalThis.DCR2_CONFIG || {};
      return { url: c.SUPABASE_URL, apikey: c.SUPABASE_KEY, token: s.access_token };
    },
    owner: () => storedUserId(),
    db: filesDb(),
    online: () => typeof navigator === "undefined" || navigator.onLine !== false,
    lock: (fn) => (typeof navigator !== "undefined" && navigator.locks && navigator.locks.request
      ? navigator.locks.request(LOCK, { ifAvailable: true }, (l) => (l ? fn() : null))
      : fn()),
    makePreview: browserPreview,
    durable: () => store.durable(),
  });
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => { _queue.retryAll(); });
    window.addEventListener("beforeunload", (e) => {
      if (!store.durable()) { e.preventDefault(); e.returnValue = ""; }
    });
  }
  return _queue;
}

/** Take custody of a file; resolves with the queue id once the bytes are safe on this device. */
export function enqueue(opts) { return queue().enqueue(opts); }
/** onProgress((items, event) => …) -> unsubscribe. event {type: "done", item, row} when a file landed. */
export function onProgress(cb) { return queue().onProgress(cb); }
export function drain() { return queue().drain(); }
export function list() { return queue().list(); }
export function listFor(projectId) { return queue().listFor(projectId); }
export function remove(id) { return queue().remove(id); }
export function retryAll() { return queue().retryAll(); }
export function bindEntry(localKey, entryId) { return queue().bindEntry(localKey, entryId); }
/** False when the browser refused IndexedDB: files are held in memory only. */
export function durable() { return queue().durable(); }
export function online() { return queue().online(); }

if (typeof window !== "undefined") {
  window.addEventListener("load", () => { setTimeout(() => { try { queue().drain(); } catch (e) { /* */ } }, 800); });
}
