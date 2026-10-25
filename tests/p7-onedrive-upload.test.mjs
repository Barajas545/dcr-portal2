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
