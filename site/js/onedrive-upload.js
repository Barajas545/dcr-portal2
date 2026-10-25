/* Uploads to the project's OneDrive folder from the Files tab (owner decisions 2026-10-24, D9 / D10).

   The bytes go STRAIGHT from the browser to Microsoft: the broker (js/repo/onedrive.js, op "upload_session") opens an
   upload session in the target folder and answers its upload URL - a pre-authenticated address on the OneDrive host,
   good for that one file - and the page PUTs the file to it in chunks (Content-Range: bytes a-b/size; every chunk but
   the last a multiple of 320 KiB, never more than 191 x 320 KiB) with NO Authorization header and no key of ours at
   all. The last chunk's answer is the new file; the broker then checks it and records its row (op "upload_done",
   with the session's ticket). What is NOT like the upload queue (js/upload-queue2.js), on purpose:

   * nothing is kept on the device: no IndexedDB custody, no localStorage - the upload URL is a bearer address and
     lives in this page's memory only, never logged, never stored (a reload or a closed tab drops an upload; no
     partial file is made; the page warns before leaving while one is running);
   * resumable within the page: a lost connection, a 5xx, a 429 (its Retry-After, at most 60 s) or a 416 asks the
     upload URL how far it got (GET) and goes on from there;
   * a 404 / 410 (the session is gone - finished, or run out) starts over only after asking the broker whether the
     file is there already (its name - or OneDrive's "name 1.ext" for it - with exactly this size): a lost last answer
     never makes a second copy;
   * one file at a time; ✕ stops one (the session is left to run out on Microsoft's side: nothing is ever deleted).

   createUploader(parts) over injected parts (the tests give a stub transport and broker):
     broker  {session(job) -> {uploadUrl, ticket, name, chunkBytes, maxChunkBytes, maxBytes},
              done(job, itemId, ticket) -> the upload_done answer,
              find(job) -> [{id, name, size}] the folder's files with this name and size}
     send    transport(req) -> {status, header(name), text()}; req {method, url, headers, body, onProgress, signal}
     now(), setTimeout, clearTimeout, maxTries (8), wait(tries) -> ms
   -> {add(spec) -> job, cancel(id), retry(id), remove(id), list(), active(), wake(), onChange(cb) -> off}
   spec: {projectId, file, folder, relDir, name, label}. A job's state: waiting | starting | sending | finishing | done |
   failed | cancelled; done jobs carry the broker's answer (result: recorded, renamed, name, message).

   xhrTransport() is the page's transport (XMLHttpRequest for upload progress, no credentials). */

import { chunkBytes, chunkPlan, parseNext, CHUNK_UNIT } from "./map/onedrive.js";

export const MAX_TRIES = 8;
const WAITS = [2000, 5000, 10000, 20000, 30000, 60000];
const RETRY_AFTER_MAX = 60;
const RETRYABLE = ["offline", "busy", "unavailable", "failed", "server_error", "onedrive_failed", "not_configured", "not_authorized"];

function netErr(message) {
  const e = new Error(message);
  e.code = "offline";
  e.status = 0;
  return e;
}

/** XMLHttpRequest for the chunks: upload progress, a timeout, abort, never credentials or a sign-in header. */
export function xhrTransport() {
  return function send(req) {
    return new Promise(function (resolve, reject) {
      const x = new XMLHttpRequest();
      x.open(req.method, req.url);
      x.withCredentials = false;
      Object.keys(req.headers || {}).forEach(function (k) { x.setRequestHeader(k, req.headers[k]); });
      x.timeout = 180000;
      if (req.onProgress && x.upload) {
        x.upload.onprogress = function (ev) { if (ev.lengthComputable) req.onProgress(ev.loaded); };
      }
      if (req.signal) {
        if (req.signal.aborted) { reject(netErr("Stopped")); return; }
        req.signal.addEventListener("abort", function () { try { x.abort(); } catch (e) { /* */ } });
      }
      x.onload = function () { resolve({ status: x.status, header: function (n) { return x.getResponseHeader(n); }, text: function () { return x.responseText || ""; } }); };
      x.onerror = function () { reject(netErr("No connection")); };
      x.ontimeout = function () { reject(netErr("Timed out")); };
      x.onabort = function () { reject(netErr("Stopped")); };
      x.send(req.body === undefined ? null : req.body);
    });
  };
}

function jsonOf(res) {
  try { return JSON.parse(res.text() || "null"); } catch (e) { return null; }
}

function retryAfterOf(res) {
  let n = NaN;
  try { n = Number(res.header("Retry-After")); } catch (e) { n = NaN; }
  return Number.isFinite(n) && n > 0 ? Math.min(n, RETRY_AFTER_MAX) * 1000 : null;
}

const ITEM_ID = /^[A-Za-z0-9!_.-]{8,128}$/;

export function createUploader(parts) {
  const d = Object.assign({
    now: function () { return Date.now(); },
    setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
    clearTimeout: function (t) { clearTimeout(t); },
    maxTries: MAX_TRIES,
    wait: function (tries) { return WAITS[Math.min(WAITS.length - 1, Math.max(0, tries - 1))]; },
  }, parts);
  const jobs = [];
  const listeners = new Set();
  let seq = 0;
  let running = null;
  let sleeper = null;
  let emitTimer = null;

  function pub(j) {
    return {
      id: j.id, projectId: j.projectId, name: j.name, label: j.label, folder: j.folder, relDir: j.relDir, size: j.size,
      sent: j.sent, pct: j.size ? Math.min(100, Math.round((j.sent / j.size) * 100)) : 0, state: j.state, error: j.error,
      tries: j.tries, result: j.result, landed: !!j.landed,
      canRetry: (j.state === "failed" || j.state === "cancelled") && !j.landed,
    };
  }
  function list() { return jobs.map(pub); }
  function emitNow(evt) {
    if (emitTimer) { d.clearTimeout(emitTimer); emitTimer = null; }
    const items = list();
    listeners.forEach(function (cb) { try { cb(items, evt || null); } catch (e) { /* a listener never stalls an upload */ } });
  }
  function emit(evt) {
    if (evt) { emitNow(evt); return; }
    if (emitTimer) return;
    emitTimer = d.setTimeout(function () { emitTimer = null; emitNow(null); }, 200);
  }
  function setState(j, state, extra) {
    j.state = state;
    if (extra) Object.assign(j, extra);
    emitNow({ type: state, job: pub(j) });
  }

  /** Wait `ms` (cut short by wake() or a cancel). */
  function sleep(ms) {
    return new Promise(function (resolve) {
      const t = d.setTimeout(function () { sleeper = null; resolve(); }, ms);
      sleeper = function () { d.clearTimeout(t); sleeper = null; resolve(); };
    });
  }

  function stopped(j) { return j.state === "cancelled" || j.removed; }

  async function put(j, plan) {
    const blob = j.file.slice(plan.start, plan.end);
    return d.send({
      method: "PUT", url: j.session.uploadUrl, headers: { "Content-Range": plan.range }, body: blob, signal: j.ctl.signal,
      onProgress: function (n) { j.sent = Math.min(j.size, plan.start + n); emit(); },
    });
  }

  /** How far Microsoft got: the next byte it wants, "gone" (404 / 410), or null (could not ask). */
  async function where(j) {
    try {
      const res = await d.send({ method: "GET", url: j.session.uploadUrl, headers: {}, signal: j.ctl.signal });
      if (res.status === 404 || res.status === 410) return "gone";
      if (res.status >= 200 && res.status < 300) {
        const body = jsonOf(res);
        const next = body ? parseNext(body.nextExpectedRanges) : null;
        if (next !== null) return next;
      }
      return null;
    } catch (e) { return null; }
  }

  /** A failure that waits and tries again (true), or gives the job up (false). */
  async function again(j, ms) {
    j.tries++;
    if (j.tries >= d.maxTries) return false;
    emit();
    await sleep(ms || d.wait(j.tries));
    return !stopped(j);
  }

  async function openSession(j) {
    setState(j, "starting");
    for (;;) {
      try {
        j.session = await d.broker.session(j);
        j.chunk = chunkBytes({ chunk_bytes: j.session.chunkBytes, max_chunk_bytes: j.session.maxChunkBytes });
        if (j.session.name) j.target = j.session.name;
        j.offset = 0;
        j.sent = 0;
        return true;
      } catch (e) {
        if (stopped(j)) return false;
        const code = String((e && e.code) || "");
        if (RETRYABLE.indexOf(code) !== -1 && (await again(j, e && e.retryAfter ? e.retryAfter * 1000 : 0))) continue;
        if (stopped(j)) return false;
        setState(j, "failed", { error: (e && e.message) || "OneDrive could not start the upload." });
        return false;
      }
    }
  }

  /** The session is gone: the file is there already (the last answer was lost) -> its id; else null (start over). */
  async function lookForIt(j) {
    let found = [];
    try { found = (await d.broker.find(j)) || []; } catch (e) { found = []; }
    for (const f of found.slice(0, 3)) {
      if (!f || !ITEM_ID.test(String(f.id))) continue;
      try {
        const r = await d.broker.done(j, f.id, j.session.ticket);
        return { id: f.id, result: r };
      } catch (e) { /* not this upload's file (someone else's of the same name and size): look on */ }
    }
    return null;
  }

  async function sendAll(j) {
    setState(j, "sending");
    for (;;) {
      if (stopped(j)) return null;
      const plan = chunkPlan(j.size, j.offset, j.chunk);
      if (!plan) {
        // everything was sent but no answer said which file: ask where it is
        const w = await where(j);
        if (w === "gone") return { gone: true };
        if (typeof w === "number" && w < j.size) { j.offset = w; continue; }
        if (!(await again(j))) return stopped(j) ? null : { fail: "OneDrive did not say it kept the file.", resume: true };
        continue;
      }
      let res;
      try {
        res = await put(j, plan);
      } catch (e) {
        if (stopped(j)) return null;
        if (!(await again(j))) return stopped(j) ? null : { fail: "Could not reach OneDrive. Retry when the connection is back.", resume: true };
        const w = await where(j);
        if (w === "gone") return { gone: true };
        if (typeof w === "number") j.offset = w;
        continue;
      }
      if (stopped(j)) return null;
      const s = res.status;
      if (s === 202) {
        const body = jsonOf(res);
        const next = body ? parseNext(body.nextExpectedRanges) : null;
        j.offset = next !== null ? next : plan.end;
        j.sent = Math.min(j.size, j.offset);
        j.tries = 0;
        emit();
        continue;
      }
      if (s === 200 || s === 201) {
        const item = jsonOf(res);
        j.sent = j.size;
        if (item && typeof item.id === "string" && ITEM_ID.test(item.id)) return { itemId: item.id };
        const w = await where(j);
        return w === "gone" ? { gone: true } : { fail: "OneDrive did not say which file it made." };
      }
      if (s === 404 || s === 410) return { gone: true };
      if (s === 416 || s === 429 || s >= 500) {
        if (!(await again(j, s === 429 || s === 503 ? retryAfterOf(res) : 0))) return stopped(j) ? null : { fail: "OneDrive is busy just now. Retry in a few minutes.", resume: true };
        const w = await where(j);
        if (w === "gone") return { gone: true };
        if (typeof w === "number") j.offset = w;
        continue;
      }
      return { fail: s === 413 ? "That file is too large for OneDrive." : "OneDrive refused the file (" + s + ")." };
    }
  }

  async function finish(j, itemId) {
    setState(j, "finishing", { sent: j.size });
    for (;;) {
      try {
        const r = await d.broker.done(j, itemId, j.session.ticket);
        setState(j, "done", { result: r, error: "" });
        return;
      } catch (e) {
        if (stopped(j)) return;
        const code = String((e && e.code) || "");
        if (RETRYABLE.indexOf(code) !== -1 && (await again(j, e && e.retryAfter ? e.retryAfter * 1000 : 0))) continue;
        if (stopped(j)) return;
        if (RETRYABLE.indexOf(code) !== -1) {
          // the bytes are in OneDrive; only the broker's check is left: Retry asks it again (never a second upload)
          setState(j, "failed", { error: "The file is in OneDrive; adding it to the file list did not get through. Retry.", itemId });
          return;
        }
        // the file list did not take it (the switch taken away, not this upload's file): the bytes stay in OneDrive
        setState(j, "failed", { error: ((e && e.message) || "The file was not added to the file list.") + " The file is in OneDrive.", landed: true });
        return;
      }
    }
  }

  async function run(j) {
    j.ctl = typeof AbortController === "function" ? new AbortController() : { signal: null, abort: function () {} };
    let restarts = 0;
    if (j.itemId && j.session) { await finish(j, j.itemId); return; }
    if (!j.session && !(await openSession(j))) return;
    for (;;) {
      if (stopped(j)) return;
      const r = await sendAll(j);
      if (!r || stopped(j)) return;
      if (r.itemId) { j.itemId = r.itemId; await finish(j, r.itemId); return; }
      if (r.fail) {
        // a refusal starts a new session on Retry; a connection that did not come back resumes this one
        if (!r.resume) j.session = null;
        setState(j, "failed", { error: r.fail });
        return;
      }
      // gone: the file may be there already (a lost last answer) - only then not, a new session from the start
      const hit = await lookForIt(j);
      if (stopped(j)) return;
      if (hit) { setState(j, "done", { result: hit.result, error: "", sent: j.size, itemId: hit.id }); return; }
      if (++restarts > 2) { setState(j, "failed", { error: "OneDrive kept closing the upload. Retry in a few minutes." }); return; }
      j.session = null;
      if (!(await openSession(j))) return;
      setState(j, "sending");
    }
  }

  async function pump() {
    if (running) return;
    for (;;) {
      const j = jobs.find(function (x) { return x.state === "waiting"; });
      if (!j) break;
      running = j;
      try { await run(j); } catch (e) {
        if (!stopped(j)) setState(j, "failed", { error: (e && e.message) || "The upload stopped." });
      }
      running = null;
    }
  }

  function add(spec) {
    const file = spec && spec.file;
    if (!file || typeof file.slice !== "function") throw new Error("No file to upload.");
    const j = {
      id: "od" + (++seq), projectId: spec.projectId, file, folder: spec.folder, relDir: spec.relDir || "",
      name: spec.name || file.name, label: spec.label || "", size: Number(file.size) || 0, sent: 0, offset: 0, chunk: CHUNK_UNIT,
      state: "waiting", error: "", tries: 0, result: null, session: null, ctl: null, removed: false, itemId: null, landed: false,
      modified: file.lastModified ? new Date(file.lastModified) : null,
    };
    jobs.push(j);
    emitNow({ type: "added", job: pub(j) });
    pump();
    return pub(j);
  }

  function byId(id) { return jobs.find(function (x) { return x.id === id; }) || null; }

  function cancel(id) {
    const j = byId(id);
    if (!j || ["done", "failed", "cancelled"].indexOf(j.state) !== -1) return false;
    j.state = "cancelled";
    j.error = "Stopped.";
    if (j.ctl && typeof j.ctl.abort === "function") { try { j.ctl.abort(); } catch (e) { /* */ } }
    if (running === j && sleeper) sleeper();
    emitNow({ type: "cancelled", job: pub(j) });
    return true;
  }

  function retry(id) {
    const j = byId(id);
    if (!j || (j.state !== "failed" && j.state !== "cancelled") || j.landed) return false;
    j.state = "waiting";
    j.error = "";
    j.tries = 0;
    emitNow({ type: "waiting", job: pub(j) });
    pump();
    return true;
  }

  function remove(id) {
    const i = jobs.findIndex(function (x) { return x.id === id; });
    if (i === -1) return false;
    const j = jobs[i];
    if (["done", "failed", "cancelled"].indexOf(j.state) === -1) cancel(id);
    j.removed = true;
    jobs.splice(i, 1);
    emitNow({ type: "removed", job: pub(j) });
    return true;
  }

  return {
    add, cancel, retry, remove, list,
    /** Uploads not finished yet (the page warns before it is left). */
    active: function () { return jobs.filter(function (x) { return ["waiting", "starting", "sending", "finishing"].indexOf(x.state) !== -1; }).length; },
    /** The connection is back: a waiting retry goes now. */
    wake: function () { if (sleeper) sleeper(); },
    onChange: function (cb) { listeners.add(cb); return function () { listeners.delete(cb); }; },
  };
}
