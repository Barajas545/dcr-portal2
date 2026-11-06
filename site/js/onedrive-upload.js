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
     broker  {session(job) -> {uploadUrl, ticket, name, chunkBytes, maxChunkBytes, maxBytes, commit?},
              done(job, itemId, ticket) -> the upload_done answer,
              find(job) -> [{id, name, size}] the folder's files with this name and size,
              commit?(job) -> the answer, for a session whose answer said commit: "broker" (below)}
     send    transport(req) -> {status, header(name), text()}; req {method, url, headers, body, onProgress, signal}
     now(), setTimeout, clearTimeout, maxTries (8), wait(tries) -> ms
   -> {add(spec) -> job, cancel(id), retry(id), remove(id), list(), active(), wake(), onChange(cb) -> off}
   spec: {projectId, file, folder, relDir, name, label, meta}. A job's state: waiting | starting | sending | finishing |
   done | failed | cancelled; done jobs carry the broker's answer (result: recorded, renamed, name, message), failed ones
   the broker's code when it gave one (code).

   The Plans Library's save back (js/plan-library.js sendSaved, owner decisions Q1-Q3 of 2026-11-04) uses the same loop
   with a plan broker: session = plan_save_session, done = plan_save_done, find = "does OneDrive hold my save" (the plan
   itself for a replace - plan_save_done is the proof -, a file of the copy's name and size for a copy); `meta` carries
   what that broker needs (the plan's item id, the version the work was done on), never shown. Its done answers 409
   not_saved when OneDrive did not get the whole file: never "the bytes are in OneDrive" (as upload_done's refusals
   are) - the next try sends it again from a new session.

   A session whose answer says commit: "broker" (a plan's replace: contract addendum 2, C1b - the upload is DEFERRED,
   so an office save that lands while it goes up is never overwritten) is committed by the broker, not by its last
   chunk: every chunk, the last one too, answers 202; once the final range is in - a 202 that wants no more, or the
   upload URL's own GET saying it wants nothing more - the uploader calls broker.commit(job) (plan_save_commit: the
   broker needs the upload URL for that one call; it goes nowhere else), never done(). A last chunk that answers 200 /
   201 with the file means OneDrive committed it itself (it did not honour the deferral: addendum 3 D3): never taken as
   done here either - the job is marked `chunkLanded` and broker.commit says so (landed: true), so the broker only
   checks what OneDrive did (its version history: an office save that commit crossed is put back). A session that is
   gone once every byte may be in (a last answer lost after such a commit) is asked of broker.commit too, never of
   find()/done(): the broker settles it and checks it the same way. A commit that did not get through is asked again
   (the bytes are there: never sent again); one refused with not_saved starts a new session on Retry (a gone session's:
   at once); one the broker answers with an error marked `restart` (plan_changed: it dropped the session) starts a new
   session at once, which the broker's session() makes a copy. A commit the broker answers with its version check's own
   503 (the body's why "checking": OneDrive has no hash of the plan yet, or the office's save is not put back yet - DCR
   Desktop 2's repair round 3; since its repair round 4 any 503 code it answers once the bytes may be on the plan)
   marks the job `checking` while it is asked again, and a job that ends so is failed with `checking` too (its session
   kept): the bytes are in OneDrive's hands and only the check is left - never "not sent". A broker error marked `hold`
   (js/plan-library.js askBroker, contract addendum 5 G2: the answer to this send's commit or settle never came back, or
   another window's request for it may still run) is never asked again in the job's own loop: the job ends failed with
   its session (and its item) kept, the error's code and Retry-After - the Plans Library asks again once the broker's
   longest run is over. Once a commit of the job's session got the check's 503, every later 503 of it is the check too,
   marked or not, until the broker answers anything else (contract addendum 6 H2, R4: the broker reads "checking" per
   request). A commit the broker refuses otherwise - 401 (the sign-in expired), 403, 400 (a ticket or an address it does
   not take), 404, any other final code - keeps the session too: every byte of it went up, so it may hold landed bytes
   (an earlier commit of it whose answer was lost, OneDrive committing at the last chunk, the check begun), and only the
   broker's settle of it says what OneDrive holds. The job ends failed with `settle` (H2): the Plans Library settles that
   session (plan_save_done) before anything is sent again, and never commits it again by itself. Only the broker's
   not_saved (OneDrive does not hold it) or plan_changed (it dropped the session) ends a session here.

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
      tries: j.tries, result: j.result, landed: !!j.landed, code: j.code || "", retryAfter: j.retryAfter || null, checking: !!j.checking,
      canRetry: (j.state === "failed" || j.state === "cancelled") && !j.landed,
      // (the job still holds its session - a resume goes on with it; `settle`: one the broker would not commit that may
      // hold landed bytes - settled first, never committed again by itself: contract addendum 6 H2)
      session: !!j.session, settle: !!j.settle,
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

  /** A session the broker commits (its answer said commit: "broker"): its last chunk commits nothing. */
  function deferred(j) { return !!(j.session && j.session.commit === "broker" && typeof d.broker.commit === "function"); }

  /** How far Microsoft got: the next byte it wants, "gone" (404 / 410), or null (could not ask). A session the broker
      commits that wants no more (nextExpectedRanges empty: every byte is in) answers the size. */
  async function where(j) {
    try {
      const res = await d.send({ method: "GET", url: j.session.uploadUrl, headers: {}, signal: j.ctl.signal });
      if (res.status === 404 || res.status === 410) return "gone";
      if (res.status >= 200 && res.status < 300) {
        const body = jsonOf(res);
        const next = body ? parseNext(body.nextExpectedRanges) : null;
        if (next !== null) return next;
        if (deferred(j) && body && Array.isArray(body.nextExpectedRanges) && !body.nextExpectedRanges.length) return j.size;
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
        j.chunkLanded = false;
        return true;
      } catch (e) {
        if (stopped(j)) return false;
        const code = String((e && e.code) || "");
        if (RETRYABLE.indexOf(code) !== -1 && (await again(j, e && e.retryAfter ? e.retryAfter * 1000 : 0))) continue;
        if (stopped(j)) return false;
        setState(j, "failed", { error: (e && e.message) || "OneDrive could not start the upload.", code });
        return false;
      }
    }
  }

  /** The session is gone: is the file there already (the last answer was lost)? -> {id, result} (it is, recorded now),
      null (it is not: start over), or {fail} (could not tell - never start over then: that could make a second copy). */
  async function lookForIt(j) {
    let found = null;
    while (found === null) {
      try { found = (await d.broker.find(j)) || []; } catch (e) {
        if (stopped(j)) return null;
        if (RETRYABLE.indexOf(String((e && e.code) || "")) !== -1 && (await again(j, e && e.retryAfter ? e.retryAfter * 1000 : 0))) continue;
        return stopped(j) ? null : { fail: "Could not check whether OneDrive kept the file. Retry when the connection is back." };
      }
    }
    for (const f of found.slice(0, 3)) {
      if (!f || !ITEM_ID.test(String(f.id))) continue;
      for (;;) {
        try {
          const r = await d.broker.done(j, f.id, j.session.ticket);
          return { id: f.id, result: r };
        } catch (e) {
          if (stopped(j)) return null;
          const code = String((e && e.code) || "");
          // the answer to this send's check never came back (a hold: never asked again in this loop) - Retry asks it
          if (e && e.hold) return { fail: e.message, code, retryAfter: e.retryAfter };
          // someone else's file of that name and size (upload_done), or not this save's bytes (plan_save_done): look on
          if (code === "not_this_upload" || code === "not_saved") break;
          if (RETRYABLE.indexOf(code) !== -1 && (await again(j, e && e.retryAfter ? e.retryAfter * 1000 : 0))) continue;
          return stopped(j) ? null : { fail: (e && e.message) || "Could not check whether OneDrive kept the file." };
        }
      }
    }
    return null;
  }

  async function sendAll(j) {
    setState(j, "sending");
    for (;;) {
      if (stopped(j)) return null;
      const plan = chunkPlan(j.size, j.offset, j.chunk);
      if (!plan && deferred(j)) return { commit: true };          // the final range is in: the broker commits it
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
        // a session the broker commits answered as a committed one: OneDrive did not wait for the broker's commit
        // (addendum 3 D3) - never adopted from this answer: the broker is told it landed, and checks what it became
        if (deferred(j)) { j.offset = j.size; j.chunkLanded = true; return { commit: true }; }
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
        // a hold (its answer never came back): the item kept, Retry asks again once the wait is over
        if (e && e.hold) { setState(j, "failed", { error: e.message, itemId, code, retryAfter: e.retryAfter || null }); return; }
        if (RETRYABLE.indexOf(code) !== -1 && (await again(j, e && e.retryAfter ? e.retryAfter * 1000 : 0))) continue;
        if (stopped(j)) return;
        if (code === "not_saved") {
          // a plan save OneDrive did not get whole (plan_save_done): nothing of it counts - Retry sends it again from a
          // new session (never "the file is in OneDrive")
          j.session = null;
          j.itemId = null;
          setState(j, "failed", { error: (e && e.message) || "OneDrive did not get the whole file - send it again.", code });
          return;
        }
        if (RETRYABLE.indexOf(code) !== -1) {
          // the bytes are in OneDrive; only the broker's check is left: Retry asks it again (never a second upload)
          setState(j, "failed", { error: "The file is in OneDrive; adding it to the file list did not get through. Retry.", itemId, code });
          return;
        }
        // the file list did not take it (the switch taken away, not this upload's file): the bytes stay in OneDrive
        setState(j, "failed", { error: ((e && e.message) || "The file was not added to the file list.") + " The file is in OneDrive.", landed: true, code });
        return;
      }
    }
  }

  /** Every byte of a session the broker commits is in: the broker commits it -> null (the job ended: done or failed),
      or "restart" (the broker dropped the session - plan_changed: a new session from the start, a copy). `gone`: the
      session was found gone (its last answer lost) - the broker settles it; one it does not find (not_saved: it never
      landed, the session ran out) starts a new session at once, as a gone upload session always did. */
  async function commit(j, gone) {
    setState(j, "finishing", { sent: j.size });
    for (;;) {
      try {
        const r = await d.broker.commit(j);
        setState(j, "done", { result: r, error: "", checking: false, settle: false });
        return null;
      } catch (e) {
        if (stopped(j)) return null;
        const code = String((e && e.code) || "");
        // the broker's version check waits on OneDrive (its 503's why "checking"): the job says so while it asks again -
        // and from then on every 503 of this send is the check, marked or not, until the broker answers anything else
        // (contract addendum 6 H2, R4); a hold or no answer at all is no answer: nothing changes
        const answered = !(e && (e.hold || code === "offline"));
        const checking = answered ? !!(e && Number(e.status) === 503 && ((e.info && e.info.why === "checking") || j.checking)) : !!j.checking;
        if (checking !== !!j.checking) { j.checking = checking; emitNow({ type: "checking", job: pub(j) }); }
        if (e && e.restart) { j.session = null; return "restart"; }
        if (gone && code === "not_saved") { j.session = null; return "restart"; }
        // a hold (the answer to this commit never came back, or another window's may still run - contract addendum 5
        // G2): never asked again here - the job ends with its session kept, the Plans Library asks after the wait
        if (e && e.hold) { setState(j, "failed", { error: e.message, code, retryAfter: e.retryAfter || null }); return null; }
        // (the check's own 503, whatever its code: asked again like a busy one - G4)
        const again2 = RETRYABLE.indexOf(code) !== -1 || checking;
        if (again2 && (await again(j, e && e.retryAfter ? e.retryAfter * 1000 : 0))) continue;
        if (stopped(j)) return null;
        if (again2) {
          // the bytes are in the session: Retry asks the broker to commit them again (never a second upload: the session
          // and its offset are kept, so the chunk loop finds every byte sent and goes straight to the commit). A
          // Retry-After the broker gave (its version check waiting on OneDrive) goes with it: the Plans Library asks
          // again on a timer then (contract addendum 4 E7)
          // (the version check's own wait: the job ends `checking` - the save is being checked, not "not sent")
          setState(j, "failed", { error: checking ? "Your save is being checked against office saves in OneDrive." : "Your save is sent; OneDrive's last step did not get through. Retry.", code,
            retryAfter: e && Number(e.retryAfter) > 0 ? Number(e.retryAfter) : null });
          return null;
        }
        // not_saved (the broker's answer: OneDrive does not hold this session's bytes): nothing of this session counts -
        // Retry sends it again from a new session
        if (code === "not_saved") {
          j.session = null;
          setState(j, "failed", { error: (e && e.message) || "OneDrive did not get the whole file - send it again.", code });
          return null;
        }
        // any other refusal (401 auth or "Invalid JWT", 403, 400 invalid, 404 not_found, a final code): the session may
        // hold landed bytes - it is KEPT, and the job ends `settle`: the Plans Library settles it with plan_save_done
        // before anything is sent again (contract addendum 6 H2)
        j.settle = true;
        setState(j, "failed", { error: (e && e.message) || "OneDrive did not take the save's last step.", code });
        return null;
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
      // a session the broker commits that is gone (a lost last answer: OneDrive may have committed it at its last chunk,
      // addendum 3 D3): the broker settles it and checks it by the plan's version history - never done() here, which
      // would take it without that check
      const goneDeferred = !!r.gone && deferred(j);
      if (r.commit || goneDeferred) {
        if ((await commit(j, goneDeferred)) !== "restart" || stopped(j)) return;
        if (++restarts > 2) { setState(j, "failed", { error: "OneDrive kept closing the upload. Retry in a few minutes." }); return; }
        if (!(await openSession(j))) return;
        setState(j, "sending");
        continue;
      }
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
      if (hit && hit.fail) { setState(j, "failed", { error: hit.fail, code: hit.code || "", retryAfter: hit.retryAfter || null }); return; }      // Retry asks again (the session is kept)
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
      modified: file.lastModified ? new Date(file.lastModified) : null, meta: spec.meta || null, code: "",
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
    j.code = "";
    j.retryAfter = null;
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
