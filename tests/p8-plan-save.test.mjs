// P4, the save back (owner decisions Q1-Q3 of 2026-11-04; contract C2 / C3): the takeoff app in the portal's frame hands
// a Save to the Plans Library, which keeps it on the device and sends it to OneDrive. Here: the hand-over's side of it
// (site/js/plan-handoff.js saveOf, saveState and talk() with onSave) - a ptt-save counts only from the frame's own
// window, from this site, with the word, a req of at most 20 characters, the opened plan's file name and size ===
// file.size; one answer each; the frame only, a file only, only when offered (canSave); the conversation lasts while
// the frame is open; the send's news to the app - and the frame's Close while a save is kept or sent
// (site/js/plan-frame.js), the purge of the takeoff app's own stores on this site (site/js/takeoff-stores.js), and the
// pages' pins. The Plans Library's spool / send / adopt run in tests/p7-library.test.mjs. Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import * as H from "../site/js/plan-handoff.js";
import * as F from "../site/js/plan-frame.js";
import * as TS from "../site/js/takeoff-stores.js";
import { fakeIndexedDB, fakeOPFS, fakeStorage } from "./plan-device.mjs";

const SITE = fileURLToPath(new URL("../site/", import.meta.url));
const read = (p) => readFileSync(join(SITE, p), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");

const WORD = "Zk3pQ9_x-7LmN2aBcD4e";
const HERE = "https://portal.example.test";
function stage(via, origin) {
  const host = { ls: [], addEventListener(t, fn) { if (t === "message") this.ls.push(fn); }, removeEventListener(t, fn) { this.ls = this.ls.filter((x) => x !== fn); } };
  const win = { posted: [], postMessage(m, o) { this.posted.push({ m, o }); } };
  const peer = { win, origin, via, isClosed: false, closes: 0, closed() { return this.isClosed; }, close() { this.closes++; } };
  const said = [];
  const emit = async (ev) => { for (const fn of host.ls.slice()) fn(ev); for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  const from = (data, over) => Object.assign({ source: win, origin, data: Object.assign({ v: 1, nonce: WORD }, data) }, over || {});
  const states = () => win.posted.filter((p) => p.m.type === "ptt-save-state").map((p) => Object.assign({}, p.m, { o: p.o }));
  return { host, win, peer, said, emit, from, states };
}
const blob = (n) => new Blob([new Uint8Array(n)]);
const NAME = "A900 Bid.takeoff";
const filePlan = (canSave) => async () => Object.assign({ kind: "file", file: blob(9), name: NAME, size: 9, lastModified: 1, number: "A900", updateAvailable: false },
  canSave ? { canSave: true } : {});

test("saveOf: a save to keep, a refusal with why, or nothing to answer (no word); the file never read", () => {
  const f = blob(10);
  assert.deepEqual(H.saveOf({ type: "ptt-save", req: "s123456789", name: NAME, size: 10, file: f }), { req: "s123456789", name: NAME, size: 10, file: f });
  assert.equal(H.saveOf({ type: "ptt-save", req: "x".repeat(20), name: NAME, size: 10, file: f }).req, "x".repeat(20), "20 characters");
  for (const [label, d] of [["a req longer than 20", { req: "x".repeat(21) }], ["no req", { req: undefined }], ["an empty req", { req: "" }],
    ["a req of other characters", { req: "s 1" }], ["a req that is not text", { req: 5 }], ["another type", { type: "ptt-renew" }]]) {
    assert.equal(H.saveOf(Object.assign({ type: "ptt-save", req: "s1", name: NAME, size: 10, file: f }, d)), null, label);
  }
  assert.equal(H.saveOf(null), null);
  assert.equal(H.saveOf("ptt-save"), null);
  for (const [label, d] of [["a path", { name: "../A900 Bid.takeoff" }], ["another kind of file", { name: "A900.pdf" }], ["a control character", { name: "A\u0000.takeoff" }],
    ["a backslash", { name: "a\\b.takeoff" }], ["no name", { name: undefined }], ["no size", { size: undefined }], ["a size of 0", { size: 0, file: blob(0) }],
    ["a size as text", { size: "10" }], ["a size that is not the file's", { size: 11 }], ["no file", { file: undefined }], ["not a Blob", { file: { size: 10, slice() {} } }],
    ["a string", { file: "PDFCACHE1" }]]) {
    const out = H.saveOf(Object.assign({ type: "ptt-save", req: "s1", name: NAME, size: 10, file: f }, d));
    assert.ok(out && out.req === "s1" && typeof out.why === "string" && !out.file, label + ": refused with why");
  }
  // the answers: the contract's fields only; the why plain and short
  assert.deepEqual(H.saveState(WORD, "s1", "kept"), { type: "ptt-save-state", v: 1, nonce: WORD, req: "s1", state: "kept" });
  assert.deepEqual(H.saveState(WORD, "s1", "failed", { why: "a\nb" + "x".repeat(400) }).why.length, 300);
  assert.equal(H.saveState(WORD, "s1", "failed", { why: "a\nb" }).why, "a b");
  assert.deepEqual(H.saveState(WORD, "s1", "sending", { pct: 45.4 }).pct, 45);
  assert.equal(H.saveState(WORD, "s1", "sending", { pct: 140 }).pct, 100);
  assert.equal(H.saveState(WORD, "s1", "copy", { name: "A900 Bid - iPad 2026-11-04 1030.takeoff" }).name, "A900 Bid - iPad 2026-11-04 1030.takeoff");
  assert.ok(!("name" in H.saveState(WORD, "s1", "copy", { name: "../x" })), "never a path");
  assert.ok(!("pct" in H.saveState(WORD, "s1", "sent", { pct: 5 })));
});

test("talk(): a plan offered (canSave, the frame, a file) is told so; a Save from the frame's own window, this site, with the word is kept and answered once - the conversation lasts while the frame is open", async () => {
  const s = stage("frame", HERE);
  const saves = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const onSave = async (save, tell) => { saves.push(save); await gate; tell("sending", { pct: 10 }); return { state: "kept" }; };
  let offline = 0;
  const ctl = H.talk(s.peer, WORD, filePlan(true), null, (r) => s.said.push(r), () => offline++, s.host, onSave);
  await s.emit(s.from({ type: "ptt-ready" }));
  const open = s.win.posted[0].m;
  assert.deepEqual([open.type, open.canSave, s.win.posted[0].o], ["ptt-open", true, HERE], "offered, to this site only");
  // a save from anyone else - another window of this site, another site, another word - is never heard
  const f = blob(9);
  const save = { type: "ptt-save", req: "s123456789", name: NAME, size: 9, file: f };
  await s.emit(s.from(save, { source: { postMessage() {} } }));
  await s.emit(s.from(save, { origin: "https://barajas545.github.io" }));
  await s.emit(s.from(Object.assign({}, save, { nonce: "Zk3pQ9_x-7LmN2aBcD4f" })));
  await s.emit(s.from(Object.assign({}, save, { v: 2 })));
  assert.deepEqual([saves.length, s.states().length], [0, 0], "nothing kept, nothing said");
  await s.emit(s.from(save));
  await s.emit(s.from(save));                                // the same word again: one answer
  assert.equal(saves.length, 1);
  assert.equal(saves[0].file, f, "the File itself (nothing copied here)");
  assert.deepEqual(s.states(), [], "not answered before it is kept");
  release();
  await s.emit(s.from({ type: "ptt-noop" }));
  assert.deepEqual(s.states().map((x) => [x.req, x.state, x.pct, x.o, x.nonce]), [["s123456789", "sending", 10, HERE, WORD], ["s123456789", "kept", undefined, HERE, WORD]]);
  // the offline word and the 4 minutes no longer end it: a Save can come any time while the frame is open
  await s.emit(s.from({ type: "ptt-offline" }));
  assert.equal(offline, 1);
  assert.equal(s.host.ls.length, 1, "still listening");
  // a malformed save with a word: refused, with why; a second save after the first: kept too (one at a time)
  await s.emit(s.from({ type: "ptt-save", req: "s2", name: "x.pdf", size: 9, file: f }));
  assert.deepEqual(s.states().slice(-1).map((x) => [x.req, x.state]), [["s2", "refused"]]);
  assert.match(s.states().slice(-1)[0].why, /takeoff project file's name/);
  await s.emit(s.from(Object.assign({}, save, { req: "s3" })));
  assert.deepEqual(s.states().slice(-1).map((x) => [x.req, x.state]), [["s3", "kept"]]);
  ctl.stop();                                                // the frame closed
  assert.equal(s.host.ls.length, 0);
  const n = s.win.posted.length;
  await new Promise((r) => setImmediate(r));
  assert.equal(s.win.posted.length, n, "nothing posted to a closed frame");
  assert.deepEqual(s.said, [{ ok: true, via: "frame", kind: "file" }]);
});

test("talk(): never offered to a tab, for a link, without the Library's taker, or when the plan does not say canSave - and a ptt-save then is refused", async () => {
  for (const [label, via, origin, plan, onSave] of [
    ["a computer's tab", "tab", "https://barajas545.github.io", filePlan(true), async () => ({ state: "kept" })],
    ["no taker", "frame", HERE, filePlan(true), undefined],
    ["not offered", "frame", HERE, filePlan(false), async () => ({ state: "kept" })],
    ["a link", "frame", HERE, async () => ({ kind: "link", url: "https://made-up-my.sharepoint.com/x", name: NAME, size: 9, lastModified: 0, number: "A1", canSave: true }),
      async () => ({ state: "kept" })],
  ]) {
    const s = stage(via, origin);
    let kept = 0;
    const ctl = H.talk(s.peer, WORD, plan, async () => "", () => {}, null, s.host, onSave ? async (...a) => { kept++; return onSave(...a); } : undefined);
    await s.emit(s.from({ type: "ptt-ready" }));
    assert.ok(!("canSave" in s.win.posted[0].m), label + ": not offered");
    await s.emit(s.from({ type: "ptt-save", req: "s1", name: NAME, size: 9, file: blob(9) }));
    assert.equal(kept, 0, label);
    assert.deepEqual(s.states().map((x) => x.state), ["refused"], label);
    assert.match(s.states()[0].why, /Save a copy to Files/, label);
    ctl.stop();
  }
  // before the plan was handed over: nothing (no plan, no save)
  const early = stage("frame", HERE);
  const e = H.talk(early.peer, WORD, filePlan(true), null, () => {}, null, early.host, async () => ({ state: "kept" }));
  await early.emit(early.from({ type: "ptt-save", req: "s1", name: NAME, size: 9, file: blob(9) }));
  assert.equal(early.win.posted.length, 0);
  e.stop();
});

test("talk(): what the Library says is the answer - refused / no-room / failed with why; a throw is failed; anything else is failed; news after the answer while the frame is open", async () => {
  const outs = [{ state: "no-room", why: "Not enough room on this device." }, { state: "refused", why: "No." }, { state: "weird" }, null];
  const s = stage("frame", HERE);
  const tells = [];
  const ctl = H.talk(s.peer, WORD, filePlan(true), null, () => {}, null, s.host, async (save, tell) => {
    tells.push(tell);
    if (save.req === "s5") throw new Error("The save could not be kept: made up.");
    return outs.shift();
  });
  await s.emit(s.from({ type: "ptt-ready" }));
  for (const req of ["s1", "s2", "s3", "s4", "s5"]) await s.emit(s.from({ type: "ptt-save", req, name: NAME, size: 9, file: blob(9) }));
  assert.deepEqual(s.states().map((x) => [x.req, x.state, x.why]), [["s1", "no-room", "Not enough room on this device."], ["s2", "refused", "No."],
    ["s3", "failed", undefined], ["s4", "failed", undefined], ["s5", "failed", "The save could not be kept: made up."]]);
  // the send's news, later: to the frame, about that save
  tells[0]("copy", { name: "A900 Bid - iPad 2026-11-04 1030.takeoff" });
  assert.deepEqual(s.states().slice(-1).map((x) => [x.req, x.state, x.name]), [["s1", "copy", "A900 Bid - iPad 2026-11-04 1030.takeoff"]]);
  ctl.stop();
});

test("the heartbeat (takeoff-web's 'keeping', pct): to the save being kept and, without a pct, to one queued behind it; never after a save's answer", async () => {
  // the answer's shape: pct carried for keeping as for sending, rounded and kept within 0-100; no pct when not a number
  assert.deepEqual(H.saveState(WORD, "s1", "keeping", { pct: 45.4 }), { type: "ptt-save-state", v: 1, nonce: WORD, req: "s1", state: "keeping", pct: 45 });
  assert.equal(H.saveState(WORD, "s1", "keeping", { pct: -3 }).pct, 0);
  assert.equal(H.saveState(WORD, "s1", "keeping", { pct: 250 }).pct, 100);
  for (const bad of [NaN, Infinity, "45", null, undefined]) assert.ok(!("pct" in H.saveState(WORD, "s1", "keeping", { pct: bad })), String(bad));
  assert.deepEqual(H.saveState(WORD, "s1", "keeping"), { type: "ptt-save-state", v: 1, nonce: WORD, req: "s1", state: "keeping" });
  assert.ok(!("pct" in H.saveState(WORD, "s1", "kept", { pct: 5 })), "an answer carries no pct");
  assert.deepEqual(H.SAVE_FINAL, ["kept", "refused", "no-room", "failed"]);
  // talk(): s1 is being kept (its heartbeat), s2 came meanwhile and waits behind it
  const s = stage("frame", HERE);
  const gates = {};
  const tells = {};
  const ctl = H.talk(s.peer, WORD, filePlan(true), null, () => {}, null, s.host, async (save, tell) => {
    tells[save.req] = tell;
    tell("keeping", { pct: 0 });
    await new Promise((r) => { gates[save.req] = r; });
    return { state: "kept" };
  });
  try {
    await s.emit(s.from({ type: "ptt-ready" }));
    await s.emit(s.from({ type: "ptt-save", req: "s1", name: NAME, size: 9, file: blob(9) }));
    assert.deepEqual(s.states().map((x) => [x.req, x.state, x.pct, x.o]), [["s1", "keeping", 0, HERE]], "to this site only");
    await s.emit(s.from({ type: "ptt-save", req: "s2", name: NAME, size: 9, file: blob(9) }));
    // the queue: a word for s1 now reaches s2 too (no pct: its own copy has not started)
    tells.s1("keeping", { pct: 40 });
    assert.deepEqual(s.states().slice(1).map((x) => [x.req, x.state, x.pct, x.o]), [["s2", "keeping", undefined, HERE], ["s1", "keeping", 40, HERE]]);
    gates.s1();
    await s.emit(s.from({ type: "ptt-noop" }));
    // s1 answered: its heartbeat is over (a late word from its worker is never posted); s2 started (its own word, pct 0)
    const after = s.states().length;
    tells.s1("keeping", { pct: 99 });
    assert.equal(s.states().length, after, "no keeping after s1's answer");
    assert.deepEqual(s.states().filter((x) => x.req === "s1").map((x) => x.state), ["keeping", "keeping", "kept"]);
    assert.deepEqual(s.states().filter((x) => x.req === "s2").map((x) => [x.state, x.pct]), [["keeping", undefined], ["keeping", 0]]);
    // s2 is no longer queued: s1's late words never reach it either; news after an answer still goes (only "keeping" stops)
    tells.s1("sending", { pct: 10 });
    assert.deepEqual(s.states().slice(-1).map((x) => [x.req, x.state, x.pct]), [["s1", "sending", 10]]);
    gates.s2();
    await s.emit(s.from({ type: "ptt-noop" }));
    tells.s2("keeping", { pct: 50 });
    assert.deepEqual(s.states().filter((x) => x.req === "s2").map((x) => x.state), ["keeping", "keeping", "kept"]);
  } finally {
    ctl.stop();
  }
});

/** The two halves wired together: this portal's talk() and the VENDORED takeoff-web's own portal-handoff.js
    (site/takeoff/js/core/portal-handoff.js: what the frame really runs), over a made-up pair of windows of one site. */
async function twoHalves(onSave, waitMs) {
  const TW = await import("../site/takeoff/js/core/portal-handoff.js");
  const portalLs = [], appLs = [];
  const later = (fn) => setImmediate(fn);
  const portalWin = { postMessage(m, o) { later(() => { if (o === HERE) portalLs.slice().forEach((fn) => fn({ source: frameWin, origin: HERE, data: m })); }); } };
  const frameWin = { postMessage(m, o) { later(() => { if (o === HERE) appLs.slice().forEach((fn) => fn({ source: portalWin, origin: HERE, data: m })); }); } };
  const host = { addEventListener(t, fn) { if (t === "message") portalLs.push(fn); }, removeEventListener(t, fn) { const i = portalLs.indexOf(fn); if (i !== -1) portalLs.splice(i, 1); } };
  const peer = { win: frameWin, origin: HERE, via: "frame", closed: () => false, close() {} };
  const ctl = H.talk(peer, WORD, filePlan(true), null, () => {}, null, host, onSave);
  const opened = new Promise((resolve) => appLs.push(function first(ev) {
    if (ev.data && ev.data.type === "ptt-open") { appLs.splice(appLs.indexOf(first), 1); resolve(TW.openFromMessage(ev.data, WORD)); }
  }));
  portalWin.postMessage(TW.readyMessage(WORD), HERE);
  const plan = await opened;
  const news = [];
  const ask = (req) => TW.askPortalToKeep({ peer: { via: "frame", win: portalWin, origin: HERE }, nonce: WORD, req, name: NAME, size: 9, file: blob(9) }, {
    listen(fn) { appLs.push(fn); return () => { const i = appLs.indexOf(fn); if (i !== -1) appLs.splice(i, 1); }; },
    post(win, msg, origin) { win.postMessage(msg, origin); }, peerGone: () => false, onNews: (s) => news.push(s), doc: null, waitMs, pollMs: 1000 });
  return { TW, plan, ask, news, stop: () => ctl.stop() };
}

test("the two halves together (the vendored takeoff-web's own askPortalToKeep): the heartbeat keeps the app waiting past its window; kept, then the send's news; without it the app times out and still hears a late kept", async () => {
  const WAIT = 150;
  const t = Date.now;
  // a save the portal takes 4 windows to keep, its worker reporting all along
  const slow = await twoHalves(async (save, tell) => {
    for (let pct = 0; pct <= 100; pct += 10) { tell("keeping", { pct }); await new Promise((r) => setTimeout(r, WAIT * 0.4 * 1.5)); }
    setTimeout(() => { tell("sending", { pct: 50 }); tell("sent"); }, 20);
    return { state: "kept" };
  }, WAIT);
  try {
    assert.equal(slow.plan.canSave, true, "the app reads canSave from the portal's ptt-open");
    const start = t();
    const r = await slow.ask("sAAAAAAAAA");
    assert.equal(r.ending, "kept", "the heartbeat kept the wait going");
    assert.ok(t() - start > WAIT * 3, "well past the app's own window: " + (t() - start) + " ms");
    await new Promise((res) => setTimeout(res, 80));
    const keeping = slow.news.filter((s) => s.state === "keeping");
    assert.ok(keeping.length >= 10 && keeping.every((s, i) => s.pct === i * 10), JSON.stringify(keeping));
    assert.deepEqual(slow.news.filter((s) => s.state !== "keeping").map((s) => [s.state, s.pct]), [["sending", 50], ["sent", undefined]], "then the send's news");
  } finally { slow.stop(); }
  // the same save with a portal that says nothing until it is done: the app gives up, and a late kept still counts
  const quiet = await twoHalves(async () => { await new Promise((r) => setTimeout(r, WAIT * 3)); return { state: "kept" }; }, WAIT);
  try {
    const r = await quiet.ask("sBBBBBBBBB");
    assert.equal(r.ending, "timeout");
    assert.deepEqual(await r.late, { state: "kept", why: "" }, "the late answer");
    r.stop();
  } finally { quiet.stop(); }
  // every word the portal composes is one the app reads, exactly
  const TW = slow.TW;
  for (const [state, extra, want] of [["keeping", { pct: 45.4 }, { pct: 45 }], ["keeping", {}, { pct: null }], ["sending", { pct: 3 }, { pct: 3 }], ["sent", {}, {}],
    ["copy", { name: "A900 Bid - iPad 2026-11-04 1030.takeoff" }, { name: "A900 Bid - iPad 2026-11-04 1030.takeoff" }], ["kept", {}, {}], ["refused", { why: "No." }, {}],
    ["no-room", {}, {}], ["failed", { why: "x" }, {}]]) {
    const got = TW.saveStateFromMessage(H.saveState(WORD, "s1", state, extra), WORD, "s1");
    assert.ok(got && got.state === state, state);
    for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, state + " " + k);
  }
  assert.deepEqual(Array.from(TW.SAVE_ENDINGS), Array.from(H.SAVE_FINAL), "the same answers on both sides");
  assert.ok(TW.SAVE_PROGRESS.includes("keeping"));
  assert.equal(String(TW.SAVE_WAIT_MS / 1000), "120", "the app's window: one heartbeat within it is enough (BEAT_MS is 2 s)");
});

test("the hand-over's file: three posts in all (the plan, a fresh link, a save's state), each to the peer's address; a save's word checked as takeoff-web makes it", () => {
  const ho = code(read("js/plan-handoff.js"));
  assert.equal((ho.match(/postMessage\(/g) || []).length, 3);
  assert.match(ho, /try \{ peer\.win\.postMessage\(saveState\(word, req, state, extra\), peer\.origin\); \}/);
  assert.match(ho, /saving = via === "frame" && p\.kind === "file" && p\.canSave === true && typeof onSave === "function";/);
  assert.match(ho, /if \(saving\) open\.canSave = true; else delete open\.canSave;/);
  assert.match(ho, /if \(kind !== "link" && !saving\) timer = setTimeout\(function \(\) \{ finish\(null\); \}, OFFLINE_WAIT_MS\);/);
  assert.match(ho, /\}, onOffline, null, opts && opts\.onSave\);/, "the frame's conversation only (a tab is never given onSave)");
  assert.equal(String(H.REQ_RE), "/^[A-Za-z0-9_-]{1,20}$/");
  // takeoff-web's own rule for its req (its P2: js/core/portal-handoff.js REQ_RE) - the same, when that checkout is here
  try {
    const tw = readFileSync("C:/DCR/wt/ipad-p2/js/core/portal-handoff.js", "utf8");
    const m = /const REQ_RE = (\/[^\n]+\/);/.exec(tw);
    if (m) assert.equal(m[1], String(H.REQ_RE));
  } catch (e) { /* not on this machine: the contract's rule stands */ }
});

test("the Plans Library offers a save only in the frame, to a person who may save back, and takes it with keepSave; the switch PLAN_SAVE_BACK", () => {
  const lib = code(read("js/plan-library.js"));
  assert.match(lib, /const frame = usesFrame\(\);\s*const offer = frame && saveBackFor\(o\.me\);/);
  assert.match(lib, /if \(offer\) plan\.canSave = true;/);
  assert.match(lib, /onSave: offer \? function \(save, tell\) \{ return keepSave\(itemId, save, tell\); \} : null/);
  assert.match(lib, /if \(!PLAN_SAVE_BACK\) return \{ state: "refused",/, "keepSave refuses with the switch off");
  assert.match(lib, /if \(!PLAN_SAVE_BACK\) throw err\("off",/, "and nothing is sent");
  assert.match(lib, /if \(o\.download !== false && saveBackFor\(me\)\) await sendWaiting\(\);/, "sent on the pages that may reach OneDrive");
  // a save waiting here is never taken away by the library's own housekeeping (only by the person's Remove, a purge)
  assert.match(lib, /inSubFolder\(x\.folder\) && x\.latest && x\.latest\.status !== "ok" && !hasLocal\(x\)\)/);
  assert.match(lib, /if \(hasLocal\(r\)\) return \{ local: true \};/, "no download over it");
  // the bytes: through the worker's spool only, never read whole by the page
  assert.ok(!/\.arrayBuffer\(\)|\.blob\(\)|\.text\(\)/.test(lib), "never a whole plan in memory");
  const worker = code(read("js/plan-library-worker.js"));
  assert.match(worker, /var buf = new Uint8Array\(await readSlice\(blob\.slice\(pos, end\)\)\);/);
  assert.match(worker, /var end = Math\.min\(pos \+ CHUNK, size\);/);
  assert.match(worker, /var CHUNK = 8 \* 1024 \* 1024;/);
  assert.match(worker, /if \(there\) throw failure\("That library file is already there\.", 409\);/, "a NEW file only");
  assert.match(worker, /if \(made && dir\) \{ try \{ await dir\.removeEntry\(m\.file\); \}/, "nothing left of a failed copy");
  // the upload address in memory only; the ticket (the broker's sealed word) kept with the save in IndexedDB
  assert.ok(!/localStorage\.setItem\([^)]*(ticket|uploadUrl|upload_url)/i.test(lib));
  assert.ok(!/uploadUrl/.test(lib.replace(/\(j\.session && j\.session\.name\)/g, "")), "the library never touches an upload address itself");
  // the pages: the person is offered save back through openOnDevice (me), and Send now / Retry
  assert.match(code(read("js/pages/plan-buttons.js")), /L\.sendSaved\(id, \{ manual: true \}\)/);
  assert.match(code(read("js/pages/plans-library.js")), /L\.sendSaved\(id, \{ manual: true \}\)/);
  assert.match(code(read("js/pages/plans-library.js")), /me: state\.me \}, told,/);
});

test("the frame's Close while a save is kept (closing can stop it) or sent (it goes on in the page: the question says to keep the page open)", () => {
  const keeping = F.closeQuestion("Your save is being kept on this iPad.", false);
  assert.deepEqual([keeping.title, keeping.danger, keeping.okText], ["The save is not finished", true, "Close anyway"]);
  assert.match(keeping.text, /^Your save is being kept on this iPad\. Closing now stops it/);
  const sending = F.closeQuestion({ title: "Still sending to OneDrive", okText: "Close the takeoff app", danger: false, text: "Your save is on this iPad and is being sent (45%)." }, true);
  assert.deepEqual(sending, { title: "Still sending to OneDrive", okText: "Close the takeoff app", danger: false, text: "Your save is on this iPad and is being sent (45%)." },
    "a question of its own: never 'closing stops it'");
  assert.deepEqual(F.closeQuestion({ text: "x" }, false), { title: "The save is not finished", okText: "Close anyway", danger: true, text: "x" });
  const lib = code(read("js/plan-library.js"));
  assert.match(lib, /if \(spooling\) return "Your save is being kept on this " \+ d \+ "\.";/);
  assert.match(lib, /return \{ title: "Still sending to OneDrive", okText: "Close the takeoff app", danger: false,/);
  assert.match(lib, /window\.addEventListener\("beforeunload", function \(e\) \{\s*if \(!spooling && !Object\.keys\(sending\)\.length\) return;/);
  assert.match(lib, /navigator\.wakeLock\.request\("screen"\)/, "the screen held awake while it is sent");
  const fr = code(read("js/plan-frame.js"));
  assert.match(fr, /if \(t && typeof t === "object"\) return t;/);
});

test("takeoff-stores.js: the takeoff app's drafts, kept copies and their indexes go from this site; held open by the app, its drafts are cleared now and the database goes once it lets go", async () => {
  const idb = fakeIndexedDB();
  const fs = fakeOPFS();
  const store = fakeStorage();
  const kept = await fs.root.getDirectoryHandle("plans-kept", { create: true });
  (await kept.getFileHandle("kabc-1.takeoff", { create: true })).bytes = new Uint8Array(5);
  await fs.root.getDirectoryHandle("plan-library", { create: true });
  let app = null;
  await new Promise((done) => {
    const r = idb.open("ptt-drafts", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("drafts");
    r.onsuccess = () => { app = r.result; const t = app.transaction("drafts", "readwrite"); t.objectStore("drafts").put({ unit_cost: 4.25 }, "k"); t.oncomplete = done; };
  });
  ["ptt.keptPlans.v1", "ptt.recent.v1", "ptt.settings.v1", "ptt.catalog.user.v1"].forEach((k) => store.setItem(k, "x"));
  TS.noteTakeoffUser("u1", store);
  TS.noteTakeoffUser("u2", store);
  TS.noteTakeoffUser("u1", store);
  assert.deepEqual(TS.takeoffUsers(store), ["u2", "u1"], "ids only, once each");
  idb.blockDelete = true;                                    // the app in a frame holds its database open
  const out = await TS.purgeTakeoffStores({ root: fs.root, idb, store, wait: 2000 });
  assert.deepEqual(out, { kept: "removed", drafts: "cleared", keys: 2 });
  assert.equal(fs.root.entries.has("plans-kept"), false);
  assert.equal(fs.root.entries.has("plan-library"), true, "the Plans Library's own folder is not the takeoff app's");
  assert.deepEqual(idb.rows("ptt-drafts", "drafts"), [], "its drafts cleared now");
  assert.deepEqual([store.getItem("ptt.keptPlans.v1"), store.getItem("ptt.recent.v1"), store.getItem(TS.USERS_KEY)], [null, null, null]);
  assert.deepEqual([store.getItem("ptt.settings.v1"), store.getItem("ptt.catalog.user.v1")], ["x", "x"], "its settings and own catalog stay");
  // nothing there: nothing to do, nothing fails
  idb.blockDelete = false;
  app.close();
  assert.deepEqual(await TS.purgeTakeoffStores({ root: fakeOPFS().root, idb: fakeIndexedDB(), store: fakeStorage(), wait: 50 }), { kept: "none", drafts: "deleted", keys: 0 });
  // the names are takeoff-web's own (the vendored copy's)
  assert.match(read("takeoff/js/core/drafts.js"), /const DB_NAME = 'ptt-drafts';/);
  assert.match(read("takeoff/js/core/device-plans.js"), /export const KEPT_DIR = 'plans-kept';/);
  assert.match(read("takeoff/js/core/device-plans.js"), /export const KEPT_INDEX_KEY = 'ptt\.keptPlans\.v1';/);
  assert.match(read("takeoff/js/main.js"), /const RECENT_KEY = 'ptt\.recent\.v1';/);
  // web storage: the only note written is the ids; takeoff-web's keys are only ever removed
  const src = code(read("js/takeoff-stores.js"));
  assert.deepEqual(Array.from(src.matchAll(/\.setItem\(([A-Z_]+)/g)).map((m) => m[1]), ["USERS_KEY"]);
  assert.ok(read("sw.js").includes('"js/takeoff-stores.js"'), "kept for offline use (the Plans Library imports it)");
});
