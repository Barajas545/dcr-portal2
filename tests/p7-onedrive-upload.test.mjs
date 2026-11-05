// Part 4: site/js/onedrive-upload.js - the Files tab's uploads straight to OneDrive (D10) - over a stub transport (a
// made-up upload session with Microsoft's semantics: Content-Range, 202 + nextExpectedRanges, the last chunk 201 + the
// driveItem, GET how far, 404 once finished) and a stub broker: the chunk plan, no Authorization header ever, resume
// after a lost connection / 5xx / 429 / 416, a 404 that starts over only after looking for the file, upload_done
// retried, cancel, retry, nothing kept on the device. Made-up names only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createUploader } from "../site/js/onedrive-upload.js";
import { CHUNK_UNIT, MAX_CHUNK } from "../site/js/map/onedrive.js";

/** Microsoft's side of one or more upload sessions, with scripts for the bad days. */
function graph() {
  const g = { sessions: new Map(), requests: [], script: [], items: new Map(), n: 0 };
  g.open = (name, size) => {
    const url = "https://up.example/s" + (++g.n);
    g.sessions.set(url, { name, size, offset: 0, done: null });
    return url;
  };
  g.send = async (req) => {
    g.requests.push({ method: req.method, url: req.url, headers: Object.assign({}, req.headers), size: req.body ? req.body.size : 0 });
    const s = g.sessions.get(req.url);
    const step = g.script.shift();
    if (step === "drop") throw Object.assign(new Error("No connection"), { code: "offline" });
    const res = (status, body, headers) => ({ status, header: (n) => (headers || {})[n] || null, text: () => (body === undefined ? "" : JSON.stringify(body)) });
    if (typeof step === "number") return res(step, { error: { code: "x" } }, step === 429 ? { "Retry-After": "3" } : {});
    if (!s || s.done) return res(404, { error: { code: "itemNotFound" } });
    if (req.method === "GET") return res(200, { nextExpectedRanges: [s.offset + "-"] });
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers["Content-Range"]);
    const a = Number(m[1]), z = Number(m[2]);
    if (a !== s.offset) return res(416, { nextExpectedRanges: [s.offset + "-"] });
    assert.equal(z - a + 1, req.body.size, "the chunk is what its range says");
    s.offset = z + 1;
    if (step === "lose-answer") throw Object.assign(new Error("No connection"), { code: "offline" });
    if (s.offset < s.size) return res(202, { nextExpectedRanges: [s.offset + "-"] });
    s.done = "01ITEM" + String(g.n).padStart(6, "0");
    g.items.set(s.done, { id: s.done, name: s.name, size: s.size });
    if (step === "lose-final") throw Object.assign(new Error("No connection"), { code: "offline" });
    return res(201, { id: s.done, name: s.name, size: s.size });
  };
  return g;
}
function broker(g, opts) {
  const o = Object.assign({ chunk: CHUNK_UNIT }, opts);
  const b = { sessions: 0, recorded: [], finds: 0, script: [] };
  b.session = async (j) => {
    b.sessions++;
    const step = b.script.shift();
    if (step) throw Object.assign(new Error(step.message || "x"), step);
    return { uploadUrl: g.open(j.name, j.size), ticket: "tk" + b.sessions, name: j.name, chunkBytes: o.chunk, maxChunkBytes: MAX_CHUNK };
  };
  b.done = async (j, itemId, ticket) => {
    const step = b.script.shift();
    if (step) throw Object.assign(new Error(step.message || "x"), step);
    if (!g.items.has(itemId)) throw Object.assign(new Error("That file is not the one this upload made."), { code: "not_this_upload", status: 409 });
    b.recorded.push([itemId, ticket]);
    return { recorded: true, already: false, renamed: false, name: j.name, size: j.size, file: { id: 1, versionNo: 1 } };
  };
  b.find = async (j) => { b.finds++; return Array.from(g.items.values()).filter((i) => i.name === j.name && i.size === j.size); };
  return b;
}
function make(g, b, extra) {
  return createUploader(Object.assign({ send: g.send, broker: b, setTimeout: (fn) => setTimeout(fn, 0), wait: () => 1 }, extra));
}
function settle(up) {
  return new Promise((resolve) => {
    const check = () => (up.active() ? setTimeout(check, 2) : resolve(up.list()));
    setTimeout(check, 2);
  });
}
const file = (size, name) => new File([new Uint8Array(size)], name || "Plan.pdf", { type: "application/pdf" });

test("uploader: chunks of 320 KiB multiples, the last one short, 202 then 201; no Authorization or key on any of them", async () => {
  const g = graph(), b = broker(g, { chunk: 2 * CHUNK_UNIT });
  const up = make(g, b);
  const size = 5 * CHUNK_UNIT + 777;
  up.add({ projectId: 9, file: file(size), folder: "Floor Plans", relDir: "Level 1", name: "Plan.pdf", label: "Floor Plans / Level 1" });
  const [job] = await settle(up);
  assert.equal(job.state, "done", job.error);
  assert.deepEqual(g.requests.map((r) => [r.method, r.headers["Content-Range"]]), [
    ["PUT", "bytes 0-655359/" + size], ["PUT", "bytes 655360-1310719/" + size], ["PUT", "bytes 1310720-" + (size - 1) + "/" + size]]);
  assert.ok(g.requests.every((r) => Object.keys(r.headers).every((k) => !/authorization|apikey|cookie/i.test(k))), "no sign-in on a chunk");
  assert.ok(g.requests.slice(0, -1).every((r) => r.size % CHUNK_UNIT === 0));
  assert.deepEqual(b.recorded, [["01ITEM000001", "tk1"]]);
  assert.deepEqual([job.pct, job.result.recorded, job.label], [100, true, "Floor Plans / Level 1"]);
});

test("uploader: a lost connection, a 5xx, a 429 and a 416 ask the upload URL how far it got and go on from there", async () => {
  const g = graph(), b = broker(g);
  const up = make(g, b);
  const size = 3 * CHUNK_UNIT + 5;
  g.script = [undefined, "drop", undefined, 503, undefined, 429, undefined];
  up.add({ projectId: 9, file: file(size), folder: "Documents", name: "Plan.pdf" });
  const [job] = await settle(up);
  assert.equal(job.state, "done", job.error);
  const gets = g.requests.filter((r) => r.method === "GET").length;
  assert.ok(gets >= 3, "asked how far after each failure (" + gets + ")");
  assert.equal(b.sessions, 1, "the same session all along");
  // a 416: the range Microsoft wants is taken from its answer
  const g2 = graph(), b2 = broker(g2);
  const up2 = make(g2, b2);
  up2.add({ projectId: 9, file: file(2 * CHUNK_UNIT + 1), folder: "Documents", name: "B.pdf" });
  g2.script = [undefined, 416];
  const [j2] = await settle(up2);
  assert.equal(j2.state, "done", j2.error);
});

test("uploader: a lost LAST answer - the session is gone (404) - is never a second copy: the broker is asked for the file first", async () => {
  const g = graph(), b = broker(g);
  const up = make(g, b);
  g.script = ["lose-final"];
  up.add({ projectId: 9, file: file(CHUNK_UNIT - 10), folder: "Documents", name: "Plan.pdf" });
  const [job] = await settle(up);
  assert.equal(job.state, "done", job.error);
  assert.equal(b.finds, 1, "looked for it");
  assert.equal(b.sessions, 1, "no new session: the file was there");
  assert.equal(g.items.size, 1, "one file in OneDrive");
  // the session gone and the file NOT there (it ran out): a new session from the start
  const g2 = graph(), b2 = broker(g2);
  const size = 2 * CHUNK_UNIT;
  g2.send = ((orig) => async (req) => {
    if (req.method === "PUT" && /s1$/.test(req.url) && /^bytes 327680-/.test(req.headers["Content-Range"])) g2.sessions.get(req.url).done = "expired";
    return orig(req);
  })(g2.send);
  const up2 = make(g2, b2);
  up2.add({ projectId: 9, file: file(size), folder: "Documents", name: "C.pdf" });
  const [j2] = await settle(up2);
  assert.equal(j2.state, "done", j2.error);
  assert.deepEqual([b2.finds, b2.sessions], [1, 2], "looked, found nothing, started over");
  assert.ok(g2.requests.some((r) => /s2$/.test(r.url) && r.headers["Content-Range"] === "bytes 0-327679/" + size), "from byte 0");
});

test("uploader: upload_done is retried on a lost connection; a refusal fails the job with the file left in OneDrive (no Retry)", async () => {
  const g = graph(), b = broker(g);
  const up = make(g, b);
  b.script = [null, { code: "offline", message: "No connection" }];
  up.add({ projectId: 9, file: file(100), folder: "Documents", name: "A.pdf" });
  const [job] = await settle(up);
  assert.equal(job.state, "done", job.error);
  const g2 = graph(), b2 = broker(g2);
  const up2 = make(g2, b2);
  b2.script = [null, { code: "forbidden", status: 403, message: "You don't have permission to do that." }];
  up2.add({ projectId: 9, file: file(100), folder: "Documents", name: "A.pdf" });
  const [j2] = await settle(up2);
  assert.equal(j2.state, "failed");
  assert.match(j2.error, /permission[\s\S]*The file is in OneDrive/);
  assert.deepEqual([j2.landed, j2.canRetry], [true, false], "never uploaded twice");
  // a session that cannot be opened (a refusal) fails at once with the broker's words; offline is tried again
  const g3 = graph(), b3 = broker(g3);
  const up3 = make(g3, b3);
  b3.script = [{ code: "file_type", status: 415, message: "That kind of file cannot be uploaded here." }];
  up3.add({ projectId: 9, file: file(10), folder: "Documents", name: "x.pdf" });
  const [j3] = await settle(up3);
  assert.deepEqual([j3.state, j3.error, j3.canRetry], ["failed", "That kind of file cannot be uploaded here.", true]);
  const g4 = graph(), b4 = broker(g4);
  const up4 = make(g4, b4);
  b4.script = [{ code: "offline" }, { code: "busy", retryAfter: 1 }];
  up4.add({ projectId: 9, file: file(10), folder: "Documents", name: "y.pdf" });
  assert.equal((await settle(up4))[0].state, "done");
});

test("uploader: give up after maxTries and Retry resumes the same session; ✕ stops one; one file at a time", async () => {
  const g = graph(), b = broker(g);
  const up = make(g, b, { maxTries: 3 });
  const size = 2 * CHUNK_UNIT;
  g.script = [undefined, "drop", "drop", "drop", "drop", "drop", "drop"];
  up.add({ projectId: 9, file: file(size), folder: "Documents", name: "A.pdf" });
  const [failed] = await settle(up);
  assert.deepEqual([failed.state, failed.canRetry], ["failed", true]);
  assert.match(failed.error, /connection/);
  g.script = [];
  assert.equal(up.retry(failed.id), true);
  const [again] = await settle(up);
  assert.equal(again.state, "done", again.error);
  assert.equal(b.sessions, 1, "resumed the same session");
  // one at a time: the second waits for the first; a stopped one never finishes
  const g2 = graph(), b2 = broker(g2);
  let release;
  const hold = new Promise((r) => { release = r; });
  const slow = g2.send;
  g2.send = async (req) => { if (/s1$/.test(req.url) && req.method === "PUT") await hold; return slow(req); };
  const up2 = make(g2, b2);
  const a = up2.add({ projectId: 9, file: file(10), folder: "Documents", name: "one.pdf" });
  up2.add({ projectId: 9, file: file(10), folder: "Documents", name: "two.pdf" });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(up2.list().map((j) => j.state), ["sending", "waiting"]);
  assert.equal(up2.cancel(a.id), true);
  release();
  const done = await settle(up2);
  assert.deepEqual(done.map((j) => j.state), ["cancelled", "done"]);
  assert.equal(up2.remove(a.id), true);
  assert.deepEqual(up2.list().map((j) => j.name), ["two.pdf"]);
});

test("uploader: nothing is kept on the device and nothing is logged (the upload URL is a bearer address)", () => {
  const src = readFileSync(new URL("../site/js/onedrive-upload.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/localStorage|sessionStorage|indexedDB|caches\.|console\./.test(src), "no storage, no log");
  assert.ok(!/Authorization|apikey|withCredentials\s*=\s*true/i.test(src), "no sign-in header, no credentials");
  assert.ok(!/["']DELETE["']/.test(src), "a stopped upload is left to run out: nothing is ever deleted");
  const page = readFileSync(new URL("../site/js/pages/project-files.js", import.meta.url), "utf8");
  const od = page.slice(page.indexOf("the OneDrive project folder ─"), page.indexOf("/* ── capture"));
  assert.ok(od.length > 1000 && !/localStorage|sessionStorage|indexedDB|console\./.test(od), "the Files tab's OneDrive part keeps nothing either");
});

test("uploader: a lost last answer and a flaky connection - never a new session while it cannot tell whether OneDrive kept the file", async () => {
  // find fails twice (offline), then answers; done fails once (offline), then records: one file, one session
  const g = graph(), b = broker(g);
  const find = b.find;
  let findFails = 2, doneFails = 1;
  b.find = async (j) => { if (findFails-- > 0) throw Object.assign(new Error("No connection"), { code: "offline" }); return find(j); };
  const done = b.done;
  b.done = async (j, id, t) => { if (doneFails-- > 0) throw Object.assign(new Error("No connection"), { code: "offline" }); return done(j, id, t); };
  const up = make(g, b);
  g.script = ["lose-final"];
  up.add({ projectId: 9, file: file(500), folder: "Documents", name: "A.pdf" });
  const [job] = await settle(up);
  assert.equal(job.state, "done", job.error);
  assert.deepEqual([b.sessions, g.items.size], [1, 1]);
  // someone else's file of that name and size first (not_this_upload): looked on, ours recorded
  const g2 = graph(), b2 = broker(g2);
  g2.items.set("01OTHER00001", { id: "01OTHER00001", name: "B.pdf", size: 500 });
  const done2 = b2.done;
  b2.done = async (j, id, t) => { if (id === "01OTHER00001") throw Object.assign(new Error("That file is not the one this upload made."), { code: "not_this_upload" }); return done2(j, id, t); };
  const up2 = make(g2, b2);
  g2.script = ["lose-final"];
  up2.add({ projectId: 9, file: file(500), folder: "Documents", name: "B.pdf" });
  const [j2] = await settle(up2);
  assert.deepEqual([j2.state, b2.sessions, b2.recorded.length], ["done", 1, 1], j2.error);
  // the broker cannot be asked at all: the job fails (Retry keeps the session) - no second upload
  const g3 = graph(), b3 = broker(g3);
  b3.find = async () => { throw Object.assign(new Error("No connection"), { code: "offline" }); };
  const up3 = make(g3, b3, { maxTries: 3 });
  g3.script = ["lose-final"];
  up3.add({ projectId: 9, file: file(500), folder: "Documents", name: "C.pdf" });
  const [j3] = await settle(up3);
  assert.deepEqual([j3.state, j3.canRetry, b3.sessions], ["failed", true, 1], j3.error);
  assert.match(j3.error, /Could not check whether OneDrive kept the file/);
  b3.find = async (j) => Array.from(g3.items.values()).filter((i) => i.name === j.name && i.size === j.size);
  assert.equal(up3.retry(j3.id), true);
  const [again] = await settle(up3);
  assert.deepEqual([again.state, b3.sessions, g3.items.size], ["done", 1, 1], again.error);
});

/* ── the Plans Library's save back (P4; owner decisions Q1-Q3, 2026-11-04): the same loop over a PLAN broker ──
   (js/plan-library.js planBroker over repo/onedrive.js planSaveSession / planSaveDone): the job's meta reaches the
   broker; a replace keeps the plan's own id; plan_save_done answers 409 not_saved when OneDrive did not get the whole
   file; find asks "does OneDrive hold my save" (the plan itself: plan_save_done is the proof). */
function planBroker(g) {
  const b = { sessions: 0, saved: [], finds: 0, script: [], metas: [] };
  b.session = async (j) => {
    b.sessions++;
    b.metas.push(j.meta);
    const step = b.script.shift();
    if (step) throw Object.assign(new Error(step.message || "x"), step);
    const uploadUrl = g.open(j.name, j.size);
    j.meta.itemId = "01ITEM" + String(g.n).padStart(6, "0");      // the plan's own id: what the last chunk answers
    return { mode: "replace", uploadUrl, ticket: "pt" + b.sessions, name: j.name, chunkBytes: CHUNK_UNIT, maxChunkBytes: MAX_CHUNK };
  };
  b.done = async (j, itemId, ticket) => {
    const step = b.script.shift();
    if (step) throw Object.assign(new Error(step.message || "x"), step);
    if (!g.items.has(itemId)) throw Object.assign(new Error("OneDrive did not get the whole file - send it again."), { code: "not_saved", status: 409 });
    b.saved.push([itemId, ticket]);
    return { saved: true, mode: "replace", id: itemId, name: j.name, size: j.size, modified: "2026-11-04T18:30:00Z", version: "qx:NEW" };
  };
  b.find = async (j) => { b.finds++; return [{ id: j.meta.itemId, name: j.name, size: j.size }]; };
  return b;
}

test("uploader, a plan's save: its meta reaches the broker; the last answer lost and the session gone (404) - found by plan_save_done, never a second session or byte", async () => {
  const g = graph(), b = planBroker(g);
  const up = make(g, b);
  const size = 2 * CHUNK_UNIT + 5;
  g.script = [null, null, "lose-final"];                        // the last chunk lands, its answer never comes
  const meta = { key: "u|01FAKEPLAN0001", base: "qx:AAA", file: "p1-x-2.takeoff" };
  up.add({ projectId: 7, file: file(size, "A900 Bid.takeoff"), name: "A900 Bid.takeoff", meta });
  const [job] = await settle(up);
  assert.equal(job.state, "done", job.error);
  assert.equal(b.metas[0], meta, "the job's meta, as given");
  assert.ok(!("meta" in job), "never shown");
  assert.deepEqual([b.sessions, b.finds, b.saved.length], [1, 1, 1], "looked, found it: done");
  const puts = g.requests.filter((r) => r.method === "PUT");
  assert.equal(puts.reduce((n, r) => n + r.size, 0), size, "every byte sent once");
  assert.deepEqual([job.result.mode, job.result.id, job.result.version], ["replace", meta.itemId, "qx:NEW"]);
});

test("uploader, a plan's save: plan_save_done's not_saved is never 'the file is in OneDrive' - failed (code not_saved), and Retry sends it again from a new session", async () => {
  const g = graph(), b = planBroker(g);
  const up = make(g, b);
  b.script = [null, { code: "not_saved", status: 409, message: "OneDrive did not get the whole file - send it again." }];
  up.add({ projectId: 7, file: file(CHUNK_UNIT + 1, "A.takeoff"), name: "A.takeoff", meta: {} });
  const [j] = await settle(up);
  assert.deepEqual([j.state, j.code, j.landed, j.canRetry], ["failed", "not_saved", false, true]);
  assert.match(j.error, /send it again/);
  assert.ok(up.retry(j.id));
  const [again] = await settle(up);
  assert.deepEqual([again.state, again.code, b.sessions], ["done", "", 2], again.error);
  // the session gone part way (run out): find asks plan_save_done, not_saved means not there - a new session from the
  // start, one file in the end
  const g2 = graph(), b2 = planBroker(g2);
  const size = 2 * CHUNK_UNIT;
  g2.send = ((orig) => async (req) => {
    if (req.method === "PUT" && /s1$/.test(req.url) && /^bytes 327680-/.test(req.headers["Content-Range"])) g2.sessions.get(req.url).done = "expired";
    return orig(req);
  })(g2.send);
  const up2 = make(g2, b2);
  up2.add({ projectId: 7, file: file(size, "B.takeoff"), name: "B.takeoff", meta: {} });
  const [j2] = await settle(up2);
  assert.equal(j2.state, "done", j2.error);
  assert.deepEqual([b2.finds, b2.sessions, b2.saved.length], [1, 2, 1], "looked (not there), started over, one save");
  // a refusal at the session carries the broker's code (the library says it in a save's words: too_large, not_found)
  const g3 = graph(), b3 = planBroker(g3);
  const up3 = make(g3, b3);
  b3.script = [{ code: "too_large", status: 413, message: "That file is too large to upload here." }];
  up3.add({ projectId: 7, file: file(10, "C.takeoff"), name: "C.takeoff", meta: {} });
  const [j3] = await settle(up3);
  assert.deepEqual([j3.state, j3.code, j3.canRetry], ["failed", "too_large", true]);
});

/* ── a plan's replace the broker commits (contract addendum 2, C1b: deferCommit; review Q3-2 / BRK-1) ── */
/** Microsoft's side of a DEFERRED session: every chunk answers 202, the last one too (nothing is committed), and the
    upload URL's GET says it wants nothing more once every byte is in; commit(url) is the broker's commit of it. */
function deferredGraph() {
  const g = graph();
  g.last = [];                                                     // what the last chunk does (g.script: the others)
  const open = g.open;
  g.open = (name, size) => { const url = open(name, size); g.sessions.get(url).deferred = true; return url; };
  const send = g.send;
  g.send = async (req) => {
    const s = g.sessions.get(req.url);
    if (!s || !s.deferred || s.done) return send(req);
    if (req.method === "GET" && !g.script.length) {
      g.requests.push({ method: "GET", url: req.url, headers: {}, size: 0 });
      return { status: 200, header: () => null, text: () => JSON.stringify({ nextExpectedRanges: s.offset < s.size ? [s.offset + "-"] : [] }) };
    }
    if (req.method !== "PUT") return send(req);
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers["Content-Range"]);
    if (Number(m[2]) + 1 < s.size) return send(req);               // not the last chunk: as any session
    const step = g.last.shift();
    g.requests.push({ method: "PUT", url: req.url, headers: Object.assign({}, req.headers), size: req.body.size });
    if (Number(m[1]) !== s.offset) return { status: 416, header: () => null, text: () => JSON.stringify({ nextExpectedRanges: [s.offset + "-"] }) };
    s.offset = s.size;
    if (step === "lose-answer") throw Object.assign(new Error("No connection"), { code: "offline" });
    // what Graph does not document for a deferred session's last chunk: 202 (expected), or a 201 the uploader must not believe
    if (step === 201 || step === 200) return { status: step, header: () => null, text: () => JSON.stringify({ id: "01NOTTHIS0001", name: s.name, size: s.size }) };
    return { status: 202, header: () => null, text: () => JSON.stringify({ expirationDateTime: "2026-11-05T00:00:00Z", nextExpectedRanges: [] }) };
  };
  g.commit = (url) => {
    const s = g.sessions.get(url);
    if (!s || s.done || s.offset !== s.size) return null;
    s.done = "01ITEM" + String(g.n).padStart(6, "0");
    g.items.set(s.done, { id: s.done, name: s.name, size: s.size });
    return s.done;
  };
  return g;
}
function deferredBroker(g) {
  const b = planBroker(g);
  b.commits = [];
  b.cscript = [];                                                  // what the commits answer (b.script: the session and done)
  b.dones = 0;
  const session = b.session;
  b.session = async (j) => {
    const s = await session(j);
    // the second session of a plan_changed is the copy the broker makes (its last chunk commits it)
    if (j.meta.mode === "copy") {
      g.sessions.get(s.uploadUrl).deferred = false;
      return Object.assign(s, { mode: "copy", name: "A900 Bid - iPad 2026-11-04 1030.takeoff" });
    }
    return Object.assign(s, { commit: "broker" });
  };
  b.done = ((done) => async (j, itemId, ticket) => { b.dones++; return done(j, itemId, ticket); })(b.done);
  b.commit = async (j) => {
    b.commits.push({ url: j.session.uploadUrl, ticket: j.session.ticket });
    const step = b.cscript.shift();
    if (step && step.code === "plan_changed") { j.meta.mode = "copy"; throw Object.assign(new Error(step.message || "x"), step, { restart: true }); }
    if (step) throw Object.assign(new Error(step.message || "x"), step);
    const id = g.commit(j.session.uploadUrl);
    if (!id) throw Object.assign(new Error("OneDrive did not get the whole file - send it again."), { code: "not_saved", status: 409 });
    return { saved: true, mode: "replace", id, name: j.name, size: j.size, modified: "2026-11-04T18:30:00Z", version: "qx:NEW" };
  };
  return b;
}
const bytesSent = (g) => g.requests.filter((r) => r.method === "PUT").reduce((n, r) => n + r.size, 0);

test("uploader, a replace the broker commits (commit 'broker'): every chunk, the last one too, answers 202; then broker.commit - never done(); every byte once", async () => {
  const g = deferredGraph(), b = deferredBroker(g);
  const up = make(g, b);
  const size = 3 * CHUNK_UNIT + 11;
  up.add({ projectId: 7, file: file(size, "A900 Bid.takeoff"), name: "A900 Bid.takeoff", meta: {} });
  const [job] = await settle(up);
  assert.equal(job.state, "done", job.error);
  assert.deepEqual([b.sessions, b.commits.length, b.dones], [1, 1, 0], "one session, its commit, no plan_save_done");
  assert.equal(b.commits[0].url, g.requests[0].url, "the session's own upload address, to the broker's commit");
  assert.equal(bytesSent(g), size, "every byte sent once");
  assert.ok(g.requests.filter((r) => r.method === "PUT").every((r) => !Object.keys(r.headers).some((k) => /authorization/i.test(k))));
  assert.deepEqual([job.result.mode, job.result.version, job.sent], ["replace", "qx:NEW", size]);
  // a last chunk that answers 200/201 all the same (the docs do not say what it answers): still the broker's commit
  const g2 = deferredGraph(), b2 = deferredBroker(g2);
  g2.last = [201];
  const up2 = make(g2, b2);
  up2.add({ projectId: 7, file: file(CHUNK_UNIT + 1, "A.takeoff"), name: "A.takeoff", meta: {} });
  const [j2] = await settle(up2);
  assert.equal(j2.state, "done", j2.error);
  assert.deepEqual([b2.commits.length, b2.dones, j2.result.id !== "01NOTTHIS0001"], [1, 0, true], "the 201's item is never taken: the commit's answer is");
});

test("uploader, a commit 'broker' session: the last chunk's answer lost - the upload URL says it wants nothing more, so the broker commits it (nothing sent again); a commit that does not get through is asked again, never re-sent", async () => {
  const g = deferredGraph(), b = deferredBroker(g);
  g.last = ["lose-answer"];
  const up = make(g, b);
  const size = 2 * CHUNK_UNIT + 3;
  up.add({ projectId: 7, file: file(size, "A.takeoff"), name: "A.takeoff", meta: {} });
  const [job] = await settle(up);
  assert.equal(job.state, "done", job.error);
  assert.equal(bytesSent(g), size, "the last chunk was not sent again");
  assert.ok(g.requests.some((r) => r.method === "GET"), "it asked the upload URL first");
  assert.deepEqual([b.sessions, b.commits.length], [1, 1]);
  // the commit itself offline: tried again; given up after maxTries -> failed, Retry commits again - no byte, no session
  const g2 = deferredGraph(), b2 = deferredBroker(g2);
  const offline = { code: "offline", status: 0, message: "No connection to DCR just now." };
  b2.cscript = [offline, offline];
  const up2 = make(g2, b2, { maxTries: 2 });
  up2.add({ projectId: 7, file: file(CHUNK_UNIT + 5, "B.takeoff"), name: "B.takeoff", meta: {} });
  const [j2] = await settle(up2);
  assert.deepEqual([j2.state, j2.code, j2.canRetry, b2.commits.length], ["failed", "offline", true, 2], j2.error);
  const puts = g2.requests.filter((r) => r.method === "PUT").length;
  assert.ok(up2.retry(j2.id));
  const [again] = await settle(up2);
  assert.equal(again.state, "done", again.error);
  assert.deepEqual([b2.sessions, b2.commits.length, g2.requests.filter((r) => r.method === "PUT").length], [1, 3, puts], "committed on Retry, nothing sent again");
  // not_saved at the commit: nothing of that session counts - Retry sends it again from a new session
  const g3 = deferredGraph(), b3 = deferredBroker(g3);
  b3.cscript = [{ code: "not_saved", status: 409, message: "OneDrive did not get the whole file - send it again." }];
  const up3 = make(g3, b3);
  up3.add({ projectId: 7, file: file(CHUNK_UNIT + 5, "C.takeoff"), name: "C.takeoff", meta: {} });
  const [j3] = await settle(up3);
  assert.deepEqual([j3.state, j3.code, j3.canRetry], ["failed", "not_saved", true]);
  assert.ok(up3.retry(j3.id));
  const [j3b] = await settle(up3);
  assert.deepEqual([j3b.state, b3.sessions, b3.commits.length], ["done", 2, 2], j3b.error);
});

test("uploader, a commit 'broker' session: the broker dropped it (plan_changed, retry copy) - a new session at once, which the plan's broker makes a copy; its last chunk commits it and done() checks it", async () => {
  const g = deferredGraph(), b = deferredBroker(g);
  b.cscript = [{ code: "plan_changed", status: 409, message: "OneDrive's plan changed while the save was sent: it is sent again as a separate file.", info: { retry: "copy" } }];
  const up = make(g, b);
  const size = CHUNK_UNIT + 9;
  const meta = {};
  up.add({ projectId: 7, file: file(size, "A900 Bid.takeoff"), name: "A900 Bid.takeoff", meta });
  const [job] = await settle(up);
  assert.equal(job.state, "done", job.error);
  assert.deepEqual([b.sessions, b.commits.length, b.dones, meta.mode], [2, 1, 1, "copy"], "the replace's commit, then a copy session checked by done()");
  assert.equal(bytesSent(g), 2 * size, "the save sent again, as the copy");
  // a broker that keeps dropping it gives up (never for ever)
  const g2 = deferredGraph(), b2 = deferredBroker(g2);
  b2.session = ((s) => async (j) => Object.assign(await s(j), { mode: "replace", commit: "broker" }))(b2.session);
  const changed = { code: "plan_changed", status: 409, message: "x", info: { retry: "copy" } };
  b2.cscript = [changed, changed, changed, changed];
  const up2 = make(g2, b2);
  up2.add({ projectId: 7, file: file(10, "D.takeoff"), name: "D.takeoff", meta: {} });
  const [j2] = await settle(up2);
  assert.equal(j2.state, "failed");
  assert.ok(b2.sessions <= 3, "at most three sessions: " + b2.sessions);
});

test("uploader, a commit 'broker' session OneDrive committed itself (contract addendum 3 D3): a last chunk that answers 200 or 201 with the file marks the job chunkLanded - the broker's commit is told so (landed), the file never taken from that answer; a session found gone (its last answer lost) is asked of broker.commit, never of find()/done(); one gone that never landed starts a new session at once", async () => {
  for (const status of [200, 201]) {
    const g = deferredGraph(), b = deferredBroker(g);
    g.last = [status];
    const landed = [];
    b.commit = ((c) => async (j) => { landed.push(j.chunkLanded); return c(j); })(b.commit);
    const up = make(g, b);
    up.add({ projectId: 7, file: file(CHUNK_UNIT + 1, "A.takeoff"), name: "A.takeoff", meta: {} });
    const [job] = await settle(up);
    assert.equal(job.state, "done", job.error);
    assert.deepEqual([landed, b.dones, b.finds, job.result.id !== "01NOTTHIS0001"], [[true], 0, 0, true], status + ": landed, checked by the broker's commit only");
  }
  // a 202 (deferral honoured): not landed
  const g0 = deferredGraph(), b0 = deferredBroker(g0);
  const seen0 = [];
  b0.commit = ((c) => async (j) => { seen0.push(j.chunkLanded); return c(j); })(b0.commit);
  const up0 = make(g0, b0);
  up0.add({ projectId: 7, file: file(CHUNK_UNIT + 1, "A.takeoff"), name: "A.takeoff", meta: {} });
  await settle(up0);
  assert.deepEqual(seen0, [false]);
  // the last chunk's answer lost and the session gone (OneDrive committed it at the last chunk): the broker's commit
  // settles and checks it - never find() and done(), which would take it unchecked
  const g1 = deferredGraph(), b1 = deferredBroker(g1);
  g1.last = ["lose-answer"];
  const gone = [];
  b1.commit = async (j) => {
    b1.commits.push({ url: j.session.uploadUrl });
    gone.push(j.chunkLanded);
    return { saved: true, mode: "replace", id: "01ITEM000001", name: j.name, size: j.size, modified: "2026-11-04T18:30:00Z", version: "qx:NEW", verified: true };
  };
  // once the last answer is lost, the session is gone (its GET: 404)
  const inner = g1.send;
  let lost = false;
  g1.send = async (req) => {
    if (lost && req.method === "GET") Array.from(g1.sessions.values())[0].done = "committed-at-the-last-chunk";
    try { return await inner(req); } catch (e) { lost = true; throw e; }
  };
  const up1 = make(g1, b1);
  up1.add({ projectId: 7, file: file(2 * CHUNK_UNIT + 3, "B.takeoff"), name: "B.takeoff", meta: {} });
  const [j1] = await settle(up1);
  assert.equal(j1.state, "done", j1.error);
  assert.deepEqual([b1.commits.length, b1.dones, b1.finds, b1.sessions, gone], [1, 0, 0, 1, [false]], "the gone session went to the broker's commit");
  // gone part way and never landed: the broker says not_saved - a new session at once (no Retry needed)
  const g2 = deferredGraph(), b2 = deferredBroker(g2);
  g2.script = [null, 404];                                          // the second chunk: the session is gone
  const up2 = make(g2, b2);
  up2.add({ projectId: 7, file: file(3 * CHUNK_UNIT + 5, "C.takeoff"), name: "C.takeoff", meta: {} });
  const [j2] = await settle(up2);
  assert.equal(j2.state, "done", j2.error);
  assert.deepEqual([b2.sessions, b2.commits.length, b2.dones, b2.finds], [2, 2, 0, 0], "the broker asked of the gone one (not_saved), then a new session");
  const src = readFileSync(new URL("../site/js/onedrive-upload.js", import.meta.url), "utf8");
  assert.match(src, /if \(deferred\(j\)\) \{ j\.offset = j\.size; j\.chunkLanded = true; return \{ commit: true \}; \}/);
});
