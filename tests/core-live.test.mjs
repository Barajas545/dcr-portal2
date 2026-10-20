// live.js (presence merge, filters) and the DCR2.live autosave contract with versions.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mergePresence, parseFilter, matchFilter, SOFT_DELETE_TABLES, PRESENCE_TOPIC } from "../site/js/live.js";
import { LiveRecord, live } from "../site/js/common2.js";

test("presence is merged per person like Desktop 2 (latest meta, sessions, views, projects)", () => {
  const raw = {
    u1: [
      { user_id: "u1", name: "Morgan", view: "project:12", editing: true, project: "12", since: "2026-10-19T15:00:00Z", presence_ref: "a" },
      { user_id: "u1", name: "Morgan", view: "web:board", editing: false, project: null, since: "2026-10-19T15:05:00Z", phx_ref: "b" },
    ],
    u2: [{ user_id: "u2", name: "Riley", view: "web:project", editing: false, project: "12", since: "2026-10-19T15:01:00Z" }],
    empty: [],
  };
  const m = mergePresence(raw);
  assert.deepEqual(Object.keys(m).sort(), ["u1", "u2"]);
  assert.equal(m.u1.view, "web:board", "the newest meta wins");
  assert.equal(m.u1.sessions, 2);
  assert.deepEqual(m.u1.views, ["project:12", "web:board"]);
  assert.deepEqual(m.u1.projects, ["12"]);
  assert.equal(m.u1.editing, false, "the pencil belongs to the main view");
  assert.equal(m.u1.presence_ref, undefined);
  assert.equal(m.u2.editing, false);
  assert.equal(PRESENCE_TOPIC, "presence:dcr");
});

test("watch filters: Realtime's one condition on the server, the rest here", () => {
  assert.deepEqual(parseFilter("project_id=eq.12,kind=neq.system"), [
    { col: "project_id", neg: false, op: "eq", val: "12" }, { col: "kind", neg: false, op: "neq", val: "system" }]);
  assert.ok(matchFilter({ project_id: 12, kind: "note" }, "project_id=eq.12,kind=neq.system"));
  assert.ok(!matchFilter({ project_id: 12, kind: "system" }, "project_id=eq.12,kind=neq.system"));
  assert.ok(matchFilter({ status: "sent" }, "status=in.(sent,approved)"));
  assert.ok(matchFilter({ deleted_at: null }, "deleted_at=is.null"));
  assert.ok(matchFilter({ n: 5 }, "n=gt.3") && !matchFilter({ n: 2 }, "n=gt.3"));
  assert.ok(matchFilter({ a: 1 }, null));
  assert.ok(SOFT_DELETE_TABLES.has("projects") && SOFT_DELETE_TABLES.has("files") && !SOFT_DELETE_TABLES.has("activity"));
});

/* a tiny "database" of one row with versions, the way PostgREST answers */
function server(row) {
  const db = { row: Object.assign({}, row), writes: [], fail: null };
  db.save = async (patch, version) => {
    db.writes.push({ patch, version });
    if (db.fail) { const f = db.fail; db.fail = null; throw f; }
    if (!db.row) return [];
    if (db.row.version !== version) return [];
    if (db.refuse) return [];
    Object.assign(db.row, patch, { version: db.row.version + 1 });
    return [Object.assign({}, db.row)];
  };
  db.reread = async () => (db.row ? Object.assign({}, db.row) : null);
  db.other = (patch) => { Object.assign(db.row, patch, { version: db.row.version + 1 }); };
  return db;
}

test("autosave: the write carries the version and keeps the one it gets back", async () => {
  live._reset();
  const db = server({ id: 1, name: "Old", status_note: "", version: 4 });
  const rec = live({ id: 1, name: "Old", status_note: "", version: 4 }, { save: db.save, reread: db.reread, key: "p:1" });
  rec.set("name", "New");
  await rec.flush();
  assert.deepEqual(db.writes[0], { patch: { name: "New" }, version: 4 });
  assert.equal(rec.version, 5);
  assert.equal(rec.state, "saved");
  rec.set("status_note", "Waiting on plans");
  await rec.flush();
  assert.equal(db.writes[1].version, 5);
  assert.equal(db.row.version, 6);
  assert.equal(live({ id: 1 }, { save: db.save, key: "p:1" }), rec, "the same key is the same saver");
});

test("autosave: someone else changed OTHER fields -> their version is taken and ours is sent again", async () => {
  live._reset();
  const db = server({ id: 2, name: "A", city: "Pine Hollow", version: 1 });
  const rec = new LiveRecord({ id: 2, name: "A", city: "Pine Hollow", version: 1 }, { save: db.save, reread: db.reread, key: "x" });
  db.other({ city: "Oak Vista" });                       // another browser, version 2
  rec.set("name", "B");
  await rec.flush();
  assert.equal(db.writes.length, 2, "the first write matched nothing, the second went in");
  assert.equal(db.writes[1].version, 2);
  assert.equal(db.row.name, "B");
  assert.equal(db.row.city, "Oak Vista", "their change is kept");
  assert.equal(rec.state, "saved");
  assert.equal(rec.base.city, "Oak Vista");
});

test("autosave: someone else changed the SAME field -> \"changed by someone else\", theirs is kept", async () => {
  live._reset();
  const db = server({ id: 3, status_note: "x", version: 1 });
  let seen = null;
  const rec = new LiveRecord({ id: 3, status_note: "x", version: 1 }, { save: db.save, reread: db.reread, key: "y", onConflict: (c) => { seen = c; } });
  db.other({ status_note: "theirs" });
  rec.set("status_note", "mine");
  await rec.flush();
  assert.equal(rec.state, "conflict");
  assert.match(rec.summary().text, /Changed by someone else/);
  assert.deepEqual(seen.fields, ["status_note"]);
  assert.equal(db.row.status_note, "theirs", "nothing overwrote them");
  assert.equal(rec.version, 2, "the next edit goes on their version");
  rec.set("status_note", "mine again");
  await rec.flush();
  assert.equal(db.row.status_note, "mine again");
  assert.equal(rec.state, "saved");
});

test("autosave: PT409 from an RPC is handled like an empty answer", async () => {
  live._reset();
  const db = server({ id: 4, name: "A", version: 1 });
  db.other({ name: "Z" });
  const rec = new LiveRecord({ id: 4, name: "A", version: 1 }, {
    save: async (patch, v) => { if (v !== db.row.version) { const e = new Error("the record was changed by someone else"); e.code = "PT409"; throw e; } return db.save(patch, v); },
    reread: db.reread, key: "z",
  });
  rec.set("name", "B");
  await rec.flush();
  assert.equal(rec.state, "conflict");
});

test("autosave: the row is gone, or the database refused it (same version back)", async () => {
  live._reset();
  const gone = server({ id: 5, name: "A", version: 1 });
  const r1 = new LiveRecord({ id: 5, name: "A", version: 1 }, { save: gone.save, reread: gone.reread, key: "g" });
  gone.row = null;
  r1.set("name", "B");
  await r1.flush();
  assert.equal(r1.state, "error");
  assert.match(r1.summary().text, /no longer exists/);

  const refused = server({ id: 6, name: "A", version: 1 });
  refused.refuse = true;                                  // row level security: nothing matched
  const r2 = new LiveRecord({ id: 6, name: "A", version: 1 }, { save: refused.save, reread: refused.reread, key: "r" });
  r2.set("name", "B");
  await r2.flush();
  assert.equal(r2.state, "error");
  assert.match(r2.summary().text, /permission/);
});

test("autosave: a network error keeps the edit and retries; a refusal does not retry", async () => {
  live._reset();
  const db = server({ id: 7, name: "A", version: 1 });
  const rec = new LiveRecord({ id: 7, name: "A", version: 1 }, { save: db.save, reread: db.reread, key: "n" });
  db.fail = Object.assign(new TypeError("Failed to fetch"), { status: 0 });
  rec.set("name", "B");
  await rec.flush();
  assert.equal(rec.state, "error");
  assert.ok(rec.retryTimer, "a retry is scheduled");
  assert.equal(rec.pend.name, "B", "the edit is kept");
  clearTimeout(rec.retryTimer);
  await rec.retry();
  assert.equal(db.row.name, "B");
  assert.equal(rec.state, "saved");

  const r2 = new LiveRecord({ id: 8, name: "A", version: 1 }, { save: async () => { const e = new Error("x"); e.code = "23514"; e.message = "the name is too long"; throw e; }, key: "v" });
  r2.set("name", "B");
  await r2.flush();
  assert.equal(r2.state, "error");
  assert.equal(r2.retryTimer, null, "a refusal is not retried");
  assert.match(r2.summary().text, /The name is too long/);
});

test("autosave: one write in flight; edits typed meanwhile go in the next write, debounced 800 ms", async () => {
  live._reset();
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000000 });
  try {
    const db = server({ id: 9, a: "", b: "", version: 1 });
    let release;
    const slow = (patch, v) => new Promise((r) => { release = () => r(db.save(patch, v)); });
    const rec = new LiveRecord({ id: 9, a: "", b: "", version: 1 }, { save: slow, reread: db.reread, key: "d" });
    rec.set("a", "1"); rec.set("a", "12"); rec.set("a", "123");
    mock.timers.tick(799);
    assert.equal(db.writes.length, 0, "still typing");
    mock.timers.tick(1);
    await Promise.resolve();
    rec.set("b", "x");                                   // typed while the first write is in flight
    mock.timers.tick(800);
    release();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(db.writes.length, 1);
    assert.deepEqual(db.writes[0].patch, { a: "123" }, "three keystrokes, one write");
    for (let i = 0; i < 20 && db.writes.length < 2; i++) { if (release) release(); await Promise.resolve(); }
    assert.deepEqual(db.writes[1] && db.writes[1].patch, { b: "x" });
    assert.equal(db.writes[1].version, 2);
  } finally {
    mock.timers.reset();
  }
});

test("autosave: baseline from Realtime updates fields nobody is editing", () => {
  live._reset();
  const rec = new LiveRecord({ id: 10, a: "1", b: "1", version: 1 }, { save: async () => null, key: "b" });
  rec.pend.a = "mine";
  rec.baseline({ id: 10, a: "theirs", b: "2", version: 2 });
  assert.equal(rec.base.b, "2");
  assert.equal(rec.pend.a, "mine", "an unsaved edit is kept");
  assert.equal(rec.version, 1, "the version waits: the save's conflict check decides");
  rec.pend = {};
  rec.baseline({ id: 10, a: "theirs", b: "3", version: 3 });
  assert.equal(rec.version, 3);
});

/* a control the way bind() and showValue() use it (no DOM in node) */
function fakeInput(key, value, opts) {
  const attrs = Object.assign({ "data-key": key }, (opts && opts.attrs) || {});
  const ls = {};
  return {
    type: "text", tagName: "INPUT", value: value == null ? "" : String(value), disabled: !!(opts && opts.disabled), title: "",
    getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); },
    hasAttribute: (k) => k in attrs, removeAttribute: (k) => { delete attrs[k]; },
    addEventListener: (t, fn) => { (ls[t] = ls[t] || []).push(fn); },
    fire: (t) => (ls[t] || []).forEach((fn) => fn()),
    attrs,
  };
}
const rootOf = (...inputs) => ({ querySelectorAll: () => inputs });
const AMOUNT = /\$\s?\d[\d,]*(\.\d+)?/g;
const maskHook = (k, v) => (k === "note" && /\$\s?\d/.test(String(v || "")) ? String(v).replace(AMOUNT, "(amount hidden)") : null);

test("autosave mask hook (Q28): a live change that brings an amount is shown masked and read-only, never saved", async () => {
  live._reset();
  const db = server({ id: 7, note: "Waiting on plans", version: 1 });
  const rec = new LiveRecord({ id: 7, note: "Waiting on plans", version: 1 }, { save: db.save, reread: db.reread, key: "m", mask: maskHook });
  const inp = fakeInput("note", "Waiting on plans");
  rec.bind(rootOf(inp));
  assert.equal(inp.disabled, false);
  rec.baseline({ id: 7, note: "Quoted $12,400 to the client", version: 2 });          // someone else, live
  assert.equal(inp.value, "Quoted (amount hidden) to the client");
  assert.equal(inp.disabled, true, "read-only while it holds an amount");
  assert.equal(inp.getAttribute("data-masked"), "note");
  inp.value = "Quoted (amount hidden) to the client!";
  inp.fire("input"); inp.fire("blur");
  await rec.flush();
  assert.equal(db.writes.length, 0, "the masked text is never written over the real one");
  rec.baseline({ id: 7, note: "Plans approved", version: 3 });                          // the amount is gone
  assert.equal(inp.value, "Plans approved");
  assert.equal(inp.disabled, false, "editable again");
  assert.equal(inp.hasAttribute("data-masked"), false);
});

test("autosave mask hook: drawn masked at first, bound, and a conflict that brings an amount is masked too", async () => {
  live._reset();
  const db = server({ id: 8, note: "Deposit $2,000 in", version: 1 });
  const rec = new LiveRecord({ id: 8, note: "Deposit $2,000 in", version: 1 }, { save: db.save, reread: db.reread, key: "n", mask: maskHook });
  const inp = fakeInput("note", "Deposit (amount hidden) in", { disabled: true, attrs: { "data-masked": "note" } });
  rec.bind(rootOf(inp));
  assert.equal(inp.value, "Deposit (amount hidden) in");
  assert.equal(inp.disabled, true);
  rec.baseline({ id: 8, note: "Deposit in", version: 2 });
  assert.equal(inp.disabled, false, "disabled only because of the mask: editable once it is gone");
  // the person types; someone else saves the same field with an amount first -> conflict, theirs masked
  inp.value = "Deposit in, thanks";
  inp.fire("input");
  db.row.version = 2; db.other({ note: "Deposit in: $5,500" });
  await rec.flush();
  assert.equal(rec.state, "conflict");
  assert.equal(inp.value, "Deposit in: (amount hidden)");
  assert.equal(inp.disabled, true);
  rec.showField("note", "Deposit in, thanks");                                          // "Use mine"
  assert.equal(inp.value, "Deposit in, thanks");
  assert.equal(inp.disabled, false);
});
