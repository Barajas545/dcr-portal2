// The upload queue's state machine against the demo engine's Storage (simple uploads, TUS in 6 MiB
// chunks, the project-files rules) and its files table (version chain, "Files uploaded to" lines).
import { test } from "node:test";
import assert from "node:assert/strict";
import "../tools/fake/engine.js";
import "../tools/fake/seed.js";
import { createQueue, CHUNK, MIB, FILE_SOURCE, placeFor, displayName, MONEY_KINDS } from "../site/js/upload-queue2.js";

const F = globalThis.DCR2Fake;
const NOW = new Date("2026-10-19T18:00:00Z");        // 11 am PDT, Monday
const WHEN = "2026-10-19T17:30:12Z";                 // 10:30:12 am PDT

function blob(size, type) {
  return new Blob([new Uint8Array(size).fill(7)], { type: type || "image/jpeg" });
}

/** One phone, one database: a queue over a memory store, the engine's Storage and files table. */
function world(opts) {
  const o = opts || {};
  const engine = o.engine || F.createEngine({ clock: () => NOW });
  if (!o.engine) engine.load(F.seed({ now: NOW }));
  const people = Object.fromEntries(F.PEOPLE.map((p) => [p.key, p.id]));
  const sandbox = engine.rows.projects.find((p) => p.number === "A267");
  const store = o.store || new Map();
  const w = {
    engine, people, sandbox, store, user: o.user || people.field, requests: [], net: { down: false, failWhen: null },
    timers: [], clock: NOW.getTime(),
  };
  const ctx = () => ({ uid: w.user });
  w.send = async (req) => {
    w.requests.push({ method: req.method, path: new URL(req.url).pathname, size: req.body ? req.body.size : 0, offset: req.headers["upload-offset"] });
    const failing = w.net.down || (w.net.failWhen && w.net.failWhen(req, w.requests.length));
    if (failing) throw Object.assign(new Error("No connection"), { own: true, retryable: true, status: 0 });
    const r = engine.storage.request(req.method, new URL(req.url).pathname, req.headers, req.body);
    if (!r) throw Object.assign(new Error("No connection"), { own: true, retryable: true, status: 0 });
    if (req.onProgress && r.status < 300 && req.body) req.onProgress(req.body.size);
    return { status: r.status, header: (n) => (r.headers[n.toLowerCase()] ?? null), text: () => r.text };
  };
  w.db = o.db || {
    findByPath: async (key) => engine.select(ctx(), "files", { columns: "*", filters: [{ col: "storage_path", op: "eq", val: key }] }).data[0] || null,
    nameTaken: async (place, name) => engine.select(ctx(), "current_files", { columns: "id", filters: [
      { col: "project_id", op: "eq", val: place.project_id }, { col: "folder", op: "eq", val: place.folder },
      { col: "subpath", op: "ilike", val: place.subpath.replace(/[\\%_]/g, "\\$&") },
      { col: "name", op: "ilike", val: name.replace(/[\\%_]/g, "\\$&") },
      place.journal_entry_id === null ? { col: "journal_entry_id", op: "is", val: "null" } : { col: "journal_entry_id", op: "eq", val: place.journal_entry_id },
    ] }).data.length > 0,
    insert: async (row) => engine.insert(ctx(), "files", row)[0],
  };
  w.queue = () => createQueue({
    store: {
      put: async (v) => { store.set(v.id, Object.assign({}, v)); },
      del: async (id) => { store.delete(id); },
      all: async () => Array.from(store.values()).map((v) => Object.assign({}, v)),
    },
    send: w.send,
    auth: async () => ({ url: "https://demo-ref.supabase.co", apikey: "publishable", token: w.user }),
    owner: () => w.user,
    db: w.db,
    now: () => w.clock,
    setTimeout: (fn, ms) => { w.timers.push({ fn, ms }); return w.timers.length; },
    clearTimeout: () => {},
    makePreview: o.preview ? async () => blob(2000) : async () => null,
  });
  w.files = () => engine.rows.files.filter((f) => f.project_id === sandbox.id && f.source === FILE_SOURCE && f.created_at === NOW.toISOString());
  w.later = (ms) => { w.clock += ms; };
  return w;
}

test("a photo: bytes kept first, object uploaded, then the files row (photos/<day>, caption, preview)", async () => {
  const w = world({ preview: true });
  const q = w.queue();
  const events = [];
  q.onProgress((items, evt) => { if (evt) events.push(evt); });
  const id = await q.enqueue({ projectId: w.sandbox.id, file: blob(1.5 * MIB), kind: "photo", caption: "North wall", takenAt: WHEN, gps: { lat: 35.4, lng: -120.6, accuracy: 8 } });
  assert.ok(id);
  await q.drain();
  const rows = w.files();
  assert.equal(rows.length, 1);
  const f = rows[0];
  assert.equal(f.folder, "photos");
  assert.equal(f.subpath, "2026-10-19");
  assert.equal(f.name, "IMG 2026-10-19 10.30.12.jpg");
  assert.equal(f.description, "North wall");
  assert.equal(f.source, "portal2");
  assert.equal(f.storage, "cloud");
  assert.equal(f.created_by, w.people.field);
  assert.match(f.storage_path, new RegExp("^p/" + w.sandbox.id + "/photos/[0-9a-f]{32}/IMG 2026-10-19 10\\.30\\.12\\.jpg$"));
  assert.match(f.preview_path, /\/preview-320\.jpg$/);
  assert.ok(w.engine.storage.has(f.storage_path) && w.engine.storage.has(f.preview_path));
  assert.equal(w.store.size, 0, "the queue is empty once the row is in");
  assert.equal(events.filter((e) => e.type === "done").length, 1);
  assert.deepEqual(w.requests.map((r) => r.method + " " + r.path.split("/").slice(0, 5).join("/")),
    ["POST /storage/v1/object/project-files", "POST /storage/v1/object/project-files"]);
});

test("twenty photos in the same second: twenty rows, no versions, one \"Files uploaded to\" line", async () => {
  const w = world();
  const q = w.queue();
  const before = w.engine.rows.activity.length;
  for (let i = 0; i < 20; i++) await q.enqueue({ projectId: w.sandbox.id, file: new File([blob(2000)], "image.jpg", { type: "image/jpeg" }), kind: "photo", takenAt: WHEN });
  await q.drain();
  const rows = w.files();
  assert.equal(rows.length, 20);
  assert.equal(new Set(rows.map((r) => r.name)).size, 20, "twenty different names");
  assert.ok(rows.every((r) => r.version_no === 1 && r.previous_id === null), "none is a version of another");
  assert.ok(rows.some((r) => r.name === "IMG 2026-10-19 10.30.12-20.jpg"));
  const hour = w.engine.rows.activity.filter((a) => a.project_id === w.sandbox.id && a.created_by === w.people.field &&
    /^Files uploaded to /.test(a.text) && Date.parse(a.created_at) > NOW.getTime() - 3600000);
  assert.equal(hour.length, 1, "one log line for the person, the folder and the hour");
  assert.equal(hour[0].text, "Files uploaded to 2026-10-19");
  assert.ok(!w.engine.rows.activity.slice(before).some((a) => /^File uploaded: /.test(a.text)), "never one line per file");
});

test("a big video goes up by TUS in exact 6 MiB chunks", async () => {
  const w = world();
  const q = w.queue();
  await q.enqueue({ projectId: w.sandbox.id, file: blob(14 * MIB, "video/quicktime"), kind: "video", takenAt: WHEN });
  await q.drain();
  const patches = w.requests.filter((r) => r.method === "PATCH");
  assert.deepEqual(patches.map((r) => r.size), [CHUNK, CHUNK, 2 * MIB]);
  assert.deepEqual(patches.map((r) => r.offset), ["0", String(CHUNK), String(2 * CHUNK)]);
  const f = w.files()[0];
  assert.equal(f.name, "VID 2026-10-19 10.30.12.mov");
  assert.equal(f.size, 14 * MIB);
});

test("killed in the middle of a TUS upload: the next page resumes at the server's offset", async () => {
  const store = new Map();
  const w = world({ store });
  w.net.failWhen = (req) => req.method === "PATCH" && req.headers["upload-offset"] === String(CHUNK);   // the 2nd chunk dies
  const q1 = w.queue();
  await q1.enqueue({ projectId: w.sandbox.id, file: blob(13 * MIB, "video/mp4"), kind: "video", takenAt: WHEN });
  await q1.drain();
  const kept = Array.from(store.values())[0];
  assert.equal(kept.state, "waiting");
  assert.equal(kept.sent, CHUNK, "the first chunk is known to be there");
  assert.ok(kept.tus, "the upload address is kept");
  assert.ok(kept.blob, "the bytes are still on the device");
  // the page is gone; a new one opens on the same device and store
  w.net.failWhen = null;
  w.requests.length = 0;
  w.later(60000);
  const q2 = w.queue();
  await q2.drain();
  assert.equal(w.requests[0].method, "HEAD", "it asks the server where it stands first");
  const patches = w.requests.filter((r) => r.method === "PATCH");
  assert.deepEqual(patches.map((r) => r.offset), [String(CHUNK), String(2 * CHUNK)], "the first chunk is not sent again");
  assert.equal(w.files().length, 1);
  assert.equal(store.size, 0);
});

test("the server lost the upload (404 on HEAD): it starts over and still lands once", async () => {
  const store = new Map();
  const w = world({ store });
  w.net.failWhen = (req) => req.method === "PATCH" && req.headers["upload-offset"] === String(CHUNK);
  const q1 = w.queue();
  await q1.enqueue({ projectId: w.sandbox.id, file: blob(7 * MIB, "video/mp4"), kind: "video", takenAt: WHEN });
  await q1.drain();
  const kept = Array.from(store.values())[0];
  w.engine.storage.tusDrop(kept.tus.split("/").pop());
  w.net.failWhen = null;
  w.later(60000);
  await w.queue().drain();
  assert.equal(w.files().length, 1);
  assert.equal(w.files()[0].size, 7 * MIB);
});

test("object complete but the row failed: the row goes in later without sending the bytes again", async () => {
  const store = new Map();
  const w = world({ store });
  const realInsert = w.db.insert;
  let failRow = true;
  w.db.insert = async (row) => { if (failRow) throw Object.assign(new TypeError("Failed to fetch"), { status: 0 }); return realInsert(row); };
  const q1 = w.queue();
  await q1.enqueue({ projectId: w.sandbox.id, file: blob(3 * MIB), kind: "photo", takenAt: WHEN });
  await q1.drain();
  const kept = Array.from(store.values())[0];
  assert.equal(kept.stage, "row");
  assert.equal(kept.state, "waiting");
  failRow = false;
  w.requests.length = 0;
  w.later(60000);
  await w.queue().drain();
  assert.equal(w.requests.length, 0, "no byte sent twice");
  assert.equal(w.files().length, 1);
});

test("the row's answer was lost after it went in: no second row", async () => {
  const w = world();
  const realInsert = w.db.insert;
  let lose = true;
  w.db.insert = async (row) => { const r = await realInsert(row); if (lose) { lose = false; throw Object.assign(new TypeError("Failed to fetch"), { status: 0 }); } return r; };
  const q = w.queue();
  await q.enqueue({ projectId: w.sandbox.id, file: blob(1000), kind: "photo", takenAt: WHEN });
  await q.drain();
  w.later(60000);
  await q.drain();
  assert.equal(w.files().length, 1);
  assert.equal(w.store.size, 0);
});

test("TUS create answers 409: the object is already complete", async () => {
  const w = world();
  const q = w.queue();
  w.net.down = true;                             // hold it on the device for a moment
  await q.enqueue({ projectId: w.sandbox.id, file: blob(7 * MIB, "video/mp4"), kind: "video", takenAt: WHEN });
  await q.drain();
  w.net.down = false;
  // put the object there first, as if an earlier attempt finished but its answer never came back
  const rec = Array.from(w.store.values())[0];
  w.engine.storage.upload({ uid: w.user }, rec.key, rec.size, rec.mime, null, false);
  w.requests.length = 0;
  await q.retryAll();
  assert.deepEqual(w.requests.map((r) => r.method), ["POST"], "only the create, which answers 409");
  assert.equal(w.requests.filter((r) => r.method === "PATCH").length, 0);
  assert.equal(w.files().length, 1);
});

test("a name already taken in the same place (another phone) gets the next number", async () => {
  const w = world();
  const ctx = { uid: w.people.lead };
  w.engine.storage.upload(ctx, "p/" + w.sandbox.id + "/photos/" + "c".repeat(32) + "/IMG 2026-10-19 10.30.12.jpg", 10, "image/jpeg", null, false);
  w.engine.insert(ctx, "files", { project_id: w.sandbox.id, folder: "photos", subpath: "2026-10-19", name: "IMG 2026-10-19 10.30.12.jpg",
    storage_path: "p/" + w.sandbox.id + "/photos/" + "c".repeat(32) + "/IMG 2026-10-19 10.30.12.jpg", size: 10, mime: "image/jpeg" });
  const q = w.queue();
  await q.enqueue({ projectId: w.sandbox.id, file: blob(1000), kind: "photo", takenAt: WHEN });
  await q.drain();
  const mine = w.files().find((f) => f.created_by === w.people.field);
  assert.equal(mine.name, "IMG 2026-10-19 10.30.12-2.jpg");
  assert.equal(mine.version_no, 1);
});

test("a journal picture waits for its entry when the entry was not saved yet (offline order)", async () => {
  const w = world();
  const q = w.queue();
  await q.enqueue({ projectId: w.sandbox.id, file: blob(1000), kind: "journal", pendingEntry: "draft-1", entryDate: "2026-10-19", caption: "Before", takenAt: WHEN });
  await q.drain();
  const held = Array.from(w.store.values())[0];
  assert.equal(held.state, "held");
  assert.equal(held.stage, "row", "the bytes went up already; only the row waits");
  const entry = w.engine.insert({ uid: w.people.field }, "journal_entries", { project_id: w.sandbox.id, title: "Walls", category: "progress" })[0];
  await q.bindEntry("draft-1", entry.id);
  const f = w.engine.rows.files.find((x) => x.journal_entry_id === entry.id);
  assert.ok(f, "the row went in with the entry");
  assert.equal(f.folder, "journal");
  assert.equal(f.subpath, "2026-10-19");
  assert.equal(f.description, "Before");
});

test("another account on the same phone never uploads someone else's photos", async () => {
  const w = world();
  const q = w.queue();
  w.net.down = true;                            // taken with no signal
  await q.enqueue({ projectId: w.sandbox.id, file: blob(1000), kind: "photo", takenAt: WHEN });
  await q.drain();
  w.net.down = false;
  w.user = w.people.lead;                       // field signed out; lead signed in on the same phone
  w.requests.length = 0;
  await q.retryAll();
  assert.equal(w.requests.length, 0);
  assert.equal(w.store.size, 1);
  w.user = w.people.field;
  await q.retryAll();
  assert.equal(w.files().length, 1);
  assert.equal(w.files()[0].created_by, w.people.field);
});

test("refusals are final: a view-only account cannot upload; the person is told", async () => {
  const w = world({ user: F.PEOPLE.find((p) => p.key === "viewer").id });
  const q = w.queue();
  await q.enqueue({ projectId: w.sandbox.id, file: blob(1000), kind: "photo", takenAt: WHEN });
  await q.drain();
  const r = Array.from(w.store.values())[0];
  assert.equal(r.state, "failed");
  assert.match(r.error, /permission/);
  assert.equal(w.requests.length, 1, "not retried");
});

test("offline: nothing is lost; it goes up when the connection is back (retryAll)", async () => {
  const w = world();
  w.net.down = true;
  const q = w.queue();
  await q.enqueue({ projectId: w.sandbox.id, file: blob(1000), kind: "voice", takenAt: WHEN });
  await q.drain();
  const r = Array.from(w.store.values())[0];
  assert.equal(r.state, "waiting");
  assert.ok(r.waitUntil > w.clock, "backs off");
  w.net.down = false;
  await q.retryAll();
  const f = w.engine.rows.files.find((x) => x.folder === "documents" && x.subpath === "Site Notes" && x.created_by === w.people.field && x.source === "portal2");
  assert.ok(f);
  assert.match(f.name, /^Voice note 2026-10-19 10\.30\.12/);
});

test("before migration M1: unknown columns are dropped, the upload still lands", async () => {
  const w = world();
  const realInsert = w.db.insert;
  w.db.insert = async (row) => {
    if ("preview_path" in row) {
      throw Object.assign(new Error("Could not find the 'preview_path' column of 'files' in the schema cache"), { code: "PGRST204" });
    }
    return realInsert(row);
  };
  const q = w.queue();
  await q.enqueue({ projectId: w.sandbox.id, file: blob(1000), kind: "photo", takenAt: WHEN });
  await q.drain();
  assert.equal(w.files().length, 1);
  assert.equal(w.files()[0].preview_path, null);
});

test("custody refuses what can never go up", async () => {
  const w = world();
  const q = w.queue();
  await assert.rejects(q.enqueue({ projectId: w.sandbox.id, file: blob(0), kind: "photo" }), /empty/);
  await assert.rejects(q.enqueue({ file: blob(10), kind: "photo" }), /belongs to a project/);
  await assert.rejects(q.enqueue({ projectId: w.sandbox.id, file: blob(10), kind: "journal" }), /journal entry/);
  await assert.rejects(q.enqueue({ projectId: w.sandbox.id, file: blob(10), kind: "receipt" }), /A receipt belongs to a cost/);
});

test("Part 3 options: keepName keeps the name in its place (the database makes it a new version), preview:false sends no small copy, costId rides on the item", async () => {
  const w = world({ preview: true });
  const q = w.queue();
  const doc = { projectId: w.sandbox.id, kind: "document", folder: "documents", subpath: "Permits", name: "Permit.pdf", keepName: true, preview: false, takenAt: WHEN };
  await q.enqueue(Object.assign({ file: blob(1000, "application/pdf") }, doc));
  await q.drain();
  await q.enqueue(Object.assign({ file: blob(1200, "application/pdf") }, doc));
  await q.drain();
  const rows = w.files().filter((f) => f.subpath === "Permits").sort((a, b) => a.id - b.id);
  assert.deepEqual(rows.map((f) => [f.name, f.version_no]), [["Permit.pdf", 1], ["Permit.pdf", 2]], "never bumped to Permit-2.pdf");
  assert.equal(rows[1].previous_id, rows[0].id);
  assert.equal(rows[0].preview_path, null);
  // without keepName the second one takes the next free name
  await q.enqueue(Object.assign({ file: blob(900, "application/pdf") }, doc, { keepName: false }));
  await q.drain();
  assert.ok(w.files().some((f) => f.subpath === "Permits" && f.name === "Permit-2.pdf"));
  w.net.down = true;
  await q.enqueue({ projectId: w.sandbox.id, file: blob(100, "image/jpeg"), kind: "receipt", costId: "41", takenAt: WHEN });
  assert.ok((await q.list()).some((i) => i.costId === 41 && i.folder === "receipts"), "the item names its cost");
  const kept = Array.from(w.store.values()).find((r) => r.kind === "receipt");
  assert.deepEqual([kept.folder, kept.subpath, kept.costId], ["receipts", "", 41]);
  assert.match(kept.key, new RegExp("^f/" + w.sandbox.id + "/receipts/[0-9a-f]{32}/Receipt 2026-10-19 10\\.30\\.12\\.jpg$"));
});

/* ── the Books program, release A: the money kinds bill and payment (contract §4.1, migration 20261030000100) ── */

/** A recording database for the queue: every row it is asked to insert, every nameTaken; it answers the name the real
    one would on a clash ("x (2)" - the database's own rule; the queue never bumps a money file's name itself). */
function moneyDb(taken) {
  const t = { rows: [], nameTaken: 0, names: new Set((taken || []).map((n) => n.toLowerCase())) };
  t.db = {
    findByPath: async () => null,
    nameTaken: async () => { t.nameTaken++; return true; },
    insert: async (row) => {
      let name = row.name;
      if (t.names.has(name.toLowerCase())) name = name.replace(/(\.[^.]+)?$/, (ext) => " (2)" + ext);
      t.names.add(name.toLowerCase());
      t.rows.push(row);
      return Object.assign({ id: 9000 + t.rows.length }, row, { name });
    },
  };
  return t;
}

test("money kinds: placeFor, f/ keys and the names - \"Bill <time>\", \"Payment <time>\" (-n for a second in the same second)", async () => {
  assert.deepEqual(placeFor("bill", { folder: "photos", subpath: "x" }, WHEN), { folder: "receipts", subpath: "" });
  assert.deepEqual(placeFor("payment", {}, WHEN), { folder: "receipts", subpath: "" });
  assert.deepEqual(MONEY_KINDS, ["receipt", "bill", "payment"]);
  assert.equal(displayName("bill", { name: "image.png", type: "image/png" }, WHEN, 1), "Bill 2026-10-19 10.30.12.png");
  assert.equal(displayName("payment", { name: "IMG_1.jpg", type: "image/jpeg" }, WHEN, 2), "Payment 2026-10-19 10.30.12-2.jpg");
  const w = world({ user: F.PEOPLE.find((p) => p.key === "accountant").id });
  const rec = moneyDb();
  w.db = rec.db;
  w.net.down = true;                                          // held on the device: the items as kept
  const q = w.queue();
  await q.enqueue({ projectId: w.sandbox.id, file: blob(100, "image/png"), kind: "bill", billId: "77", tag: "document", takenAt: WHEN });
  await q.enqueue({ projectId: w.sandbox.id, file: blob(120, "image/png"), kind: "bill", billId: 77, takenAt: WHEN });
  await q.enqueue({ projectId: w.sandbox.id, file: blob(130, "image/jpeg"), kind: "payment", billId: 77, paymentId: "501", takenAt: WHEN });
  const items = await q.list();
  assert.deepEqual(items.map((i) => [i.kind, i.folder, i.subpath, i.billId, i.paymentId, i.tag, i.name]), [
    ["bill", "receipts", "", 77, null, "document", "Bill 2026-10-19 10.30.12.png"],
    ["bill", "receipts", "", 77, null, "", "Bill 2026-10-19 10.30.12-2.png"],
    ["payment", "receipts", "", 77, 501, "", "Payment 2026-10-19 10.30.12.jpg"],
  ]);
  for (const r of w.store.values()) assert.match(r.key, new RegExp("^f/" + w.sandbox.id + "/receipts/[0-9a-f]{32}/[A-Za-z0-9._ ()-]{1,120}$"), "the money-file key shape (t14)");
});

test("money kinds: the row carries bill_id (and payment_id), the queue asks no nameTaken, and the done event carries the database's name", async () => {
  const w = world({ user: F.PEOPLE.find((p) => p.key === "accountant").id });
  const rec = moneyDb(["INV-4101.pdf"]);
  w.db = rec.db;
  const q = w.queue();
  const done = [];
  q.onProgress((items, evt) => { if (evt && evt.type === "done") done.push(evt); });
  await q.enqueue({ projectId: w.sandbox.id, file: blob(500, "application/pdf"), kind: "bill", billId: 77, name: "INV-4101.pdf", takenAt: WHEN });
  await q.enqueue({ projectId: w.sandbox.id, file: blob(600, "image/jpeg"), kind: "payment", billId: 77, paymentId: 501, name: "Check 1043.jpg", takenAt: WHEN });
  await q.enqueue({ projectId: w.sandbox.id, file: blob(700, "image/jpeg"), kind: "receipt", costId: 41, name: "Yard.jpg", takenAt: WHEN });
  await q.drain();
  assert.equal(rec.nameTaken, 0, "a money file's name is the database's to make unique (never \"INV-4101-2.pdf\")");
  assert.deepEqual(rec.rows.map((r) => [r.folder, r.bill_id, r.payment_id, r.cost_id, r.name]), [
    ["receipts", 77, undefined, undefined, "INV-4101.pdf"],
    ["receipts", 77, 501, undefined, "Check 1043.jpg"],
    ["receipts", undefined, undefined, 41, "Yard.jpg"],
  ]);
  assert.deepEqual(done.map((e) => [e.item.kind, e.item.billId, e.item.paymentId, e.row.name]), [
    ["bill", 77, null, "INV-4101 (2).pdf"], ["payment", 77, 501, "Check 1043.jpg"], ["receipt", null, null, "Yard.jpg"]]);
  assert.equal(w.store.size, 0);
  // a photo still takes the next free name itself (not a money file)
  await q.enqueue({ projectId: w.sandbox.id, file: blob(800), kind: "photo", name: "North.jpg", takenAt: WHEN });
  await q.drain();
  assert.ok(rec.nameTaken > 0, "photos: nameTaken as before");
});

test("money kinds next to a tab still on the code before them (e66a89f, the same store and lock): a bill's or a payment's file is kept as \"m:<user>\" - the old drain leaves it waiting (it would insert it as a receipt of nothing), this queue drains it with its links", async () => {
  const user = F.PEOPLE.find((p) => p.key === "accountant").id;
  const w = world({ user });
  const rec = moneyDb();
  w.db = rec.db;
  w.net.down = true;                                          // held on the device
  const q = w.queue();
  await q.enqueue({ projectId: w.sandbox.id, file: blob(100, "application/pdf"), kind: "bill", billId: 77, name: "INV-7001.pdf", tag: "document", takenAt: WHEN });
  await q.enqueue({ projectId: w.sandbox.id, file: blob(110, "image/jpeg"), kind: "payment", billId: 77, paymentId: 501, name: "Check 1043.jpg", takenAt: WHEN });
  await q.enqueue({ projectId: w.sandbox.id, file: blob(120, "image/jpeg"), kind: "receipt", costId: 41, name: "Yard.jpg", takenAt: WHEN });
  const photo = await q.enqueue({ projectId: w.sandbox.id, file: blob(130), kind: "photo", name: "North.jpg", takenAt: WHEN });
  await q.drain();                                            // settled: nothing went up
  const kept =Array.from(w.store.values()).sort((a, b) => a.added - b.added || a.size - b.size);
  assert.deepEqual(kept.map((r) => [r.kind, r.owner]), [["bill", "m:" + user], ["payment", "m:" + user], ["receipt", user], ["photo", user]]);
  // e66a89f's runOnce, word for word: (await d.store.all()).filter(isItem), then
  // all.filter((r) => r.owner === who && r.state !== "failed" && ready(r) && !removed.has(r.id))
  const oldIsItem = (r) => r && !String(r.id).startsWith("entry:");
  const oldMine = kept.filter(oldIsItem).filter((r) => r.owner === user && r.state !== "failed");
  assert.deepEqual(oldMine.map((r) => r.kind), ["receipt", "photo"], "the old drain never takes a bill's or a payment's file");
  // another account signed in on this device never takes them either
  const other = world({ user: F.PEOPLE.find((p) => p.key === "admin").id, engine: w.engine, store: w.store });
  const orec = moneyDb();
  other.db = orec.db;
  await other.queue().drain();
  assert.equal(orec.rows.length, 0, "not the admin's");
  // this queue drains them, with their bill and payment
  await q.remove(photo);
  w.net.down = false;
  await q.retryAll();                                         // the connection is back
  assert.deepEqual(rec.rows.map((r) => [r.name, r.bill_id, r.payment_id, r.cost_id]), [
    ["INV-7001.pdf", 77, undefined, undefined], ["Check 1043.jpg", 77, 501, undefined], ["Yard.jpg", undefined, undefined, 41]]);
  assert.equal(w.store.size, 0);
  // a record kept with the plain owner (before this rule) still drains
  w.store.set("1-old", Object.assign({}, kept[0], { id: "1-old", owner: user, key: kept[0].key.replace(/\/[0-9a-f]{32}\//, "/" + "b".repeat(32) + "/"), state: "waiting", stage: "object", sent: 0, tries: 0, waitUntil: 0 }));
  await q.drain();
  assert.equal(rec.rows.length, 4);
  assert.equal(rec.rows[3].bill_id, 77);
});

test("money kinds: custody refuses a bill's file without its bill, a payment's file without its payment, a cost on either", async () => {
  const w = world();
  const q = w.queue();
  await assert.rejects(q.enqueue({ projectId: w.sandbox.id, file: blob(10), kind: "bill" }), /A bill's file belongs to its bill/);
  await assert.rejects(q.enqueue({ projectId: w.sandbox.id, file: blob(10), kind: "payment", billId: 7 }), /A payment's file belongs to its payment/);
  await assert.rejects(q.enqueue({ projectId: w.sandbox.id, file: blob(10), kind: "payment", paymentId: 9 }), /A bill's file belongs to its bill/);
  await assert.rejects(q.enqueue({ projectId: w.sandbox.id, file: blob(10), kind: "bill", billId: 7, costId: 41 }), /not a cost's receipt/);
  // a photo never carries a bill or a payment, whatever is passed
  w.net.down = true;
  await q.enqueue({ projectId: w.sandbox.id, file: blob(10), kind: "photo", billId: 7, paymentId: 9, takenAt: WHEN });
  const it = (await q.list())[0];
  assert.deepEqual([it.billId, it.paymentId], [null, null]);
});
