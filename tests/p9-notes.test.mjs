// Check-off notes (DCR Desktop 2.26, migration 20261103000100_activity_checkoff; the owner's request of 2026-11-02): the
// log line's new fields and words (map/activity.js), the box the three log views draw (checkHtml / doneHtml), the
// to-dos first in the project Log (every open to-do, however old: repo/activity.js openTodos), repo/activity.js
// setDone (set_note_done; someone else first; a moved version sent once more), the demo database's rules (tools/fake:
// the trigger and the RPC, as the SQL), the pages' wiring, the service worker's new name and list - and, P4's Portal
// line, every line of an item name in the title style.
// Made-up demo data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { toLogLine, doneLabel, doneDay, todosFirst, withTodos, checkHtml, doneHtml, isOpenTodo } from "../site/js/map/activity.js";
import { makeClient } from "./pages-stub.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as activity from "../site/js/repo/activity.js";
import { clearPeople } from "../site/js/repo/people.js";
import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { itemScreenHtml } from "../site/js/pages/est-render.js";
import * as projectLog from "../site/js/pages/project-log.js";

const SITE = fileURLToPath(new URL("../site/", import.meta.url));
const read = (rel) => readFileSync(SITE + rel, "utf8");
const code = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NOW = new Date("2026-11-03T18:00:00Z");
const names = { "u-ana": "Ana Torres", "u-me": "Morgan Admin" };
const nameOf = (id) => names[id] || "";

/* ── map ─────────────────────────────────────────────────────────────── */
test("toLogLine: a note's to-do mark and its tick (who and when); never on a status or system line", () => {
  const l = toLogLine({ id: 5, project_id: 7, kind: "note", text: "Study drawings", todo: true, done_at: "2026-11-02T16:59:00Z",
    done_by: "u-ana", created_by: "u-me", version: 4 }, nameOf);
  assert.deepEqual([l.todo, l.done, l.doneAt, l.doneBy, l.doneByName, l.version], [true, true, "2026-11-02T16:59:00Z", "u-ana", "Ana Torres", 4]);
  const plain = toLogLine({ id: 6, kind: "note", text: "x" }, nameOf);
  assert.deepEqual([plain.todo, plain.done, plain.doneAt, plain.doneBy, plain.doneByName], [false, false, null, null, ""]);
  const sys = toLogLine({ id: 7, kind: "status", text: "Status: Sent → Approved", todo: true, done_at: "2026-11-02T16:59:00Z" }, nameOf);
  assert.deepEqual([sys.todo, sys.done], [false, false]);
  const gone = toLogLine({ id: 8, kind: "note", text: "x", done_at: "2026-11-02T16:59:00Z", done_by: null }, nameOf);
  assert.equal(doneLabel(gone, NOW), "Done Nov 2", "a removed account: the date alone");
});

test("doneLabel / doneDay: the Pacific day, the first name, the year when it is another year", () => {
  const l = toLogLine({ id: 1, kind: "note", text: "x", done_at: "2026-11-02T16:59:00Z", done_by: "u-ana" }, nameOf);
  assert.equal(doneLabel(l, NOW), "Done Nov 2 · Ana");
  assert.equal(doneDay("2026-11-03T06:30:00Z", NOW), "Nov 2", "still Nov 2 in Pacific time");
  assert.equal(doneDay("2025-12-31T20:00:00Z", NOW), "Dec 31, 2025");
  assert.equal(doneLabel(toLogLine({ id: 2, kind: "note", text: "x" }, nameOf), NOW), "");
  assert.equal(doneDay(null), "");
});

test("todosFirst: the open to-dos on top, oldest first; the rest as they came", () => {
  const L = (id, at, extra) => toLogLine(Object.assign({ id, kind: "note", text: "n" + id, created_at: at }, extra), nameOf);
  const lines = [L(1, "2026-11-03T10:00:00Z"), L(2, "2026-11-02T10:00:00Z", { todo: true }), L(3, "2026-11-01T10:00:00Z"),
    L(4, "2026-10-01T10:00:00Z", { todo: true }), L(5, "2026-09-01T10:00:00Z", { todo: true, done_at: "2026-10-02T10:00:00Z" })];
  assert.deepEqual(todosFirst(lines).map((l) => l.id), [4, 2, 1, 3, 5]);
  assert.ok(isOpenTodo(lines[1]) && !isOpenTodo(lines[4]));
  assert.deepEqual(todosFirst([]), []);
});

test("withTodos: the open to-dos read on their own join the newest lines once each (by id); the lines there stay as they are", () => {
  const L = (id, extra) => toLogLine(Object.assign({ id, kind: "note", text: "n" + id, created_at: "2026-11-0" + (id % 9 + 1) + "T10:00:00Z" }, extra), nameOf);
  const recent = [L(9), L(8, { todo: true }), L(7)];
  const open = [L(2, { todo: true }), L(8, { todo: true, text: "a copy" })];
  const all = withTodos(recent, open);
  assert.deepEqual(all.map((l) => l.id), [9, 8, 7, 2]);
  assert.equal(all[1].logDescription, "n8", "the line already there is kept");
  assert.deepEqual(todosFirst(all).map((l) => l.id), [2, 8, 9, 7]);
  assert.deepEqual(withTodos(null, null), []);
  assert.deepEqual(withTodos(recent, []).map((l) => l.id), [9, 8, 7]);
  assert.equal(recent.length, 3, "the lines given are not changed");
});

test("checkHtml / doneHtml: a button for people who may write notes, a read-only mark for a to-do or a tick, nothing else", () => {
  const open = toLogLine({ id: 9, kind: "note", text: "x", todo: true, version: 3 }, nameOf);
  const btn = checkHtml(open, esc, true);
  assert.match(btn, /^<button type="button" class="nt-box todo" data-tick="9" data-v="3" data-done="0" aria-pressed="false" aria-label="Tick it off"/);
  const done = toLogLine({ id: 10, kind: "note", text: "x", done_at: "2026-11-02T16:59:00Z", done_by: "u-ana", version: 2 }, nameOf);
  assert.match(checkHtml(done, esc, true), /class="nt-box done" data-tick="10" data-v="2" data-done="1" aria-pressed="true" aria-label="Take the tick off"/);
  assert.match(checkHtml(done, esc, false), /^<span class="nt-box done ro" role="img" aria-label="Done Nov 2 · Ana/);
  assert.match(checkHtml(open, esc, false), /^<span class="nt-box todo ro"/);
  assert.equal(checkHtml(toLogLine({ id: 11, kind: "note", text: "x" }, nameOf), esc, false), "", "a plain note: nothing to see");
  assert.equal(checkHtml(toLogLine({ id: 12, kind: "system", text: "x" }, nameOf), esc, true), "", "never on a system line");
  assert.match(doneHtml(done, esc), /<div class="nt-done" title="[^"]+">✓ Done Nov 2 · Ana<\/div>/);
  assert.equal(doneHtml(open, esc), '<div class="nt-todo">To-do</div>');
  const sneaky = toLogLine({ id: 13, kind: "note", text: "x", done_at: "2026-11-02T16:59:00Z", done_by: "u-x" }, () => "<b>Eve</b>");
  assert.ok(!/<b>/.test(doneHtml(sneaky, esc)) && !/<b>/.test(checkHtml(sneaky, esc, false)), "a name is escaped");
});

/* ── repo over the stub client ───────────────────────────────────────── */
function stub(handlers, rows) {
  clearPeople();
  const c = makeClient({ profiles: [{ id: "u-me", full_name: "Morgan Admin", role: "admin", active: true },
    { id: "u-ana", full_name: "Ana Torres", role: "lead", active: true }], activity: rows || [] }, handlers);
  useClient(c);
  return c;
}

test("setDone: rpc set_note_done with the note's id, the version shown and the state asked for; the answer as a log line", async () => {
  const c = stub({ set_note_done: (a) => ({ data: { id: a.p_id, kind: "note", text: "Study drawings", done_at: "2026-11-02T16:59:00Z",
    done_by: "u-me", updated_by: "u-me", version: 5 }, error: null }) });
  const l = await activity.setDone({ id: "41", version: 4 }, true, { me: "u-me" });
  assert.deepEqual(c.calls[0], { rpc: "set_note_done", args: { p_id: 41, p_version: 4, p_done: true } });
  assert.deepEqual([l.done, l.doneByName, l.version, l.already], [true, "Morgan Admin", 5, false]);
});

test("setDone: someone else ticked it first - the line as it is, already; changed otherwise - sent once more on the new version", async () => {
  const first = stub({ set_note_done: () => ({ data: { id: 41, kind: "note", text: "x", done_at: "2026-11-02T16:59:00Z", done_by: "u-ana",
    updated_by: "u-ana", version: 5 }, error: null }) });
  const l = await activity.setDone({ id: 41, version: 4 }, true, { me: "u-me" });
  assert.equal(l.already, true);
  assert.equal(l.doneByName, "Ana Torres");
  assert.equal(first.calls.filter((x) => x.rpc).length, 1);

  let n = 0;
  const c = stub({ set_note_done: (a) => (++n === 1 ? { data: null, error: { code: "PT409", message: "Someone else changed this note first." } }
    : { data: { id: 41, kind: "note", text: "x", done_at: "2026-11-02T16:59:00Z", done_by: "u-me", updated_by: "u-me", version: a.p_version + 1 }, error: null }) },
  [{ id: 41, project_id: 7, kind: "note", text: "x", todo: true, done_at: null, version: 6 }]);
  const again = await activity.setDone({ id: 41, version: 4 }, true, { me: "u-me" });
  assert.deepEqual(c.calls.filter((x) => x.rpc).map((x) => x.args.p_version), [4, 6]);
  assert.deepEqual([again.done, again.version, again.already], [true, 7, false]);

  const d = stub({ set_note_done: () => ({ data: null, error: { code: "PT409", message: "changed" } }) },
    [{ id: 41, project_id: 7, kind: "note", text: "x", done_at: "2026-11-02T16:59:00Z", done_by: "u-ana", updated_by: "u-ana", version: 6 }]);
  const was = await activity.setDone({ id: 41, version: 4 }, true, { me: "u-me" });
  assert.equal(d.calls.filter((x) => x.rpc).length, 1, "already done: not sent again");
  assert.deepEqual([was.done, was.already], [true, true]);

  stub({ set_note_done: () => ({ data: null, error: { code: "42501", message: "Only people who may write notes can tick them off." } }) });
  await assert.rejects(activity.setDone({ id: 41, version: 4 }, true, { me: "u-me" }), (e) => e.code === "42501");
});

test("openTodos: the project's notes made as to-dos and not ticked off - any age, oldest first, at most 100 - masked like every line", async () => {
  const rows = [
    { id: 3, project_id: 7, kind: "note", text: "Collect $1,200 deposit", todo: true, done_at: null, created_at: "2025-01-02T10:00:00Z", created_by: "u-ana" },
    { id: 4, project_id: 7, kind: "note", text: "Done one", todo: true, done_at: "2026-01-01T10:00:00Z", created_at: "2025-01-01T10:00:00Z" },
    { id: 5, project_id: 7, kind: "note", text: "Plain", todo: false, done_at: null, created_at: "2025-01-01T09:00:00Z" },
    { id: 6, project_id: 8, kind: "note", text: "Another project", todo: true, done_at: null, created_at: "2025-01-01T08:00:00Z" },
    { id: 2, project_id: 7, kind: "note", text: "Study drawings", todo: true, done_at: null, created_at: "2024-06-01T10:00:00Z" },
  ];
  const c = stub({}, rows);
  const mask = (t) => t.replace(/\$[\d,]+/g, "(amount hidden)");
  const open = await activity.openTodos("7", { mask });
  assert.deepEqual(open.map((l) => l.id), [2, 3]);
  assert.equal(open[1].logDescription, "Collect (amount hidden) deposit", "masked for people without prices");
  assert.equal(open[1].logUserName, "Ana Torres");
  const q = c.calls.find((x) => x.table === "activity");
  assert.deepEqual(q.filters, [["eq", "project_id", 7], ["eq", "kind", "note"], ["is", "todo", true], ["is", "done_at", null]]);
  assert.deepEqual(q.orders, [["created_at", true], ["id", true]]);
  assert.deepEqual(q.range, [0, activity.OPEN_TODOS_LIMIT - 1]);
  assert.equal(activity.OPEN_TODOS_LIMIT, 100, "as DCR Desktop's OPEN_TODOS_MAX");
});

/* ── the demo database (the SQL's rules) ─────────────────────────────── */
test("demo database: anyone who may write notes ticks any note; field, viewer and the agents account are refused; the server stamps the tick", { skip: !available }, async () => {
  const e = await freshEngine(NOW);
  const lead = await person("lead"), field = await person("field"), viewer = await person("viewer"), acct = await person("accountant");
  const mgr = await person("manager"), agents = await person("agents");
  const sandbox = e.rows.projects.find((p) => p.number === "A267");
  const [note] = e.insert({ uid: mgr.id }, "activity", { project_id: sandbox.id, kind: "note", text: "Study drawings", todo: true,
    done_at: "2020-01-01T00:00:00Z", done_by: field.id });
  assert.deepEqual([note.todo, note.done_at, note.done_by], [true, null, null], "a person's new note starts not done");
  for (const who of [field, viewer, agents]) {
    assert.throws(() => e.rpc({ uid: who.id }, "set_note_done", { p_id: note.id, p_version: note.version, p_done: true }), (x) => x.code === "42501");
  }
  const on = e.rpc({ uid: acct.id }, "set_note_done", { p_id: note.id, p_version: note.version, p_done: true });
  assert.deepEqual([on.done_by, on.version, on.updated_by], [acct.id, note.version + 1, acct.id]);
  assert.ok(on.done_at);
  const same = e.rpc({ uid: lead.id }, "set_note_done", { p_id: note.id, p_version: 1, p_done: true });
  assert.deepEqual([same.version, same.done_by], [on.version, acct.id], "in the asked state already: as it is");
  assert.throws(() => e.rpc({ uid: lead.id }, "set_note_done", { p_id: note.id, p_version: 1, p_done: false }), (x) => x.code === "PT409");
  const off = e.rpc({ uid: lead.id }, "set_note_done", { p_id: note.id, p_version: on.version, p_done: false });
  assert.deepEqual([off.done_at, off.done_by], [null, null]);
  const status = e.rows.activity.find((a) => a.kind === "status" || a.kind === "system");
  assert.throws(() => e.rpc({ uid: lead.id }, "set_note_done", { p_id: status.id, p_version: status.version, p_done: true }), (x) => x.code === "22023");
  assert.throws(() => e.rpc({ uid: lead.id }, "set_note_done", { p_id: 987654, p_version: 1, p_done: true }), (x) => x.code === "PT404");
  assert.throws(() => e.rpc({ uid: lead.id }, "set_note_done", { p_id: note.id, p_version: 1 }), (x) => x.code === "PGRST202");
  // the author's own update: the tick is the server's moment and the author, never a date or a name sent with it
  const [mine] = e.update({ uid: mgr.id }, "activity", { done_at: "2020-01-01T00:00:00Z", done_by: lead.id }, { filters: [{ col: "id", op: "eq", val: note.id }] });
  assert.deepEqual([mine.done_by, mine.done_at === "2020-01-01T00:00:00Z"], [mgr.id, false]);
  assert.deepEqual(e.update({ uid: lead.id }, "activity", { todo: false }, { filters: [{ col: "id", op: "eq", val: note.id }] }), [],
    "a to-do mark is its author's or an admin's");
});

test("demo database: the sandbox holds two of the usual steps as to-dos, the first one ticked off", { skip: !available }, async () => {
  const e = await freshEngine(NOW);
  const sandbox = e.rows.projects.find((p) => p.number === "A267");
  const steps = e.rows.activity.filter((a) => a.project_id === sandbox.id && a.todo);
  assert.deepEqual(steps.map((a) => [a.text, !!a.done_at]), [["Send plans for material takeoff", true], ["Study drawings", false]]);
});

test("the project Log over the demo database: to-dos first, the tick through the page's repo", { skip: !available }, async () => {
  const e = await freshEngine(NOW);
  const lead = await person("lead");
  clearPeople();
  useClient(clientAs(e, lead.id));
  const sandbox = e.rows.projects.find((p) => p.number === "A267");
  const lines = todosFirst(await activity.forProject(sandbox.id, { limit: activity.HISTORY_LIMIT }));
  assert.equal(lines[0].logDescription, "Study drawings");
  assert.ok(isOpenTodo(lines[0]));
  const full = e.rows.profiles.find((p) => p.id === lead.id).full_name;
  const got = await activity.setDone(lines[0], true, { me: lead.id });
  assert.deepEqual([got.done, got.doneByName, got.already], [true, full, false]);
  assert.equal(doneLabel(got, NOW).split(" · ")[1], full.split(" ")[0]);
});

test("the project Log over the demo database: an open to-do older than the 300 newest lines is still there, on top; ticked off, it drops back out", { skip: !available }, async () => {
  const e = await freshEngine(NOW);
  const mgr = await person("manager");
  clearPeople();
  useClient(clientAs(e, mgr.id));
  const sandbox = e.rows.projects.find((p) => p.number === "A267");
  const [old] = e.insert({ uid: mgr.id }, "activity", { project_id: sandbox.id, kind: "note", text: "Follow up estimate", todo: true });
  for (let i = 0; i < activity.HISTORY_LIMIT; i++) e.insert({ uid: mgr.id }, "activity", { project_id: sandbox.id, kind: "note", text: "Busy day " + i });
  const recent = await activity.forProject(sandbox.id, { limit: activity.HISTORY_LIMIT });
  assert.ok(!recent.some((l) => l.id === old.id), "out of the 300 newest lines");
  // the Log tab as a phone shows it (a bare stand-in for its list element)
  const list = { innerHTML: "" };
  const host = { innerHTML: "", querySelector: (sel) => (sel === "#lgList" ? list : null), addEventListener() {},
    getAttribute: () => null, setAttribute() {} };
  const ctx = { pid: sandbox.id, canLog: false, mask: null, me: mgr, esc, errorText: (x) => String(x && x.message), toast() {} };
  const shown = async () => {
    for (let i = 0; i < 200 && !/pj-log/.test(list.innerHTML); i++) await new Promise((r) => setTimeout(r, 5));
    return list.innerHTML.split(/<div class="pj-log(?=[" ])/).slice(1);
  };
  projectLog.render(ctx, host);
  let rows = await shown();
  const at = rows.findIndex((r) => r.includes("Follow up estimate"));
  assert.ok(at >= 0 && at < rows.findIndex((r) => r.includes("Busy day")), "on top, with the open to-dos");
  assert.ok(rows.slice(0, at + 1).every((r) => r.includes('aria-label="To-do"')), "only open to-dos above it");
  assert.equal(rows.filter((r) => r.includes("Follow up estimate")).length, 1, "once");
  assert.equal(rows.length, recent.length + 1, "and the 300 newest lines (the to-do one more)");
  const got = await activity.setDone(toLogLine(old, nameOf), true, { me: mgr.id });
  assert.equal(got.done, true);
  list.innerHTML = "";
  projectLog.render(ctx, host);
  rows = await shown();
  assert.ok(!rows.some((r) => r.includes("Follow up estimate")), "ticked off and older than the 300: no longer pinned");
});

/* ── the pages' wiring and the offline list ──────────────────────────── */
test("the three log views draw the box and the done line; the Log tab puts the to-dos first; only people who may write notes tick", () => {
  const log = code(read("js/pages/project-log.js"));
  assert.match(log, /todosFirst\(lines\)\.map/);
  assert.match(log, /activityRepo\.openTodos\(ctx\.pid, \{ mask: ctx\.mask \}\)/, "every open to-do, masked like the rest");
  assert.match(log, /const lines = withTodos\(recent, open\);/);
  assert.match(log, /checkHtml\(l, esc, ctx\.canLog\)/);
  assert.match(log, /doneHtml\(l, esc\)/);
  assert.match(log, /wireTicks\(host, /);
  const board = code(read("js/pages/board.js"));
  assert.match(board, /checkHtml\(l, esc, state\.canLog\)/);
  assert.match(board, /wireTicks\(el\("bdLogs"\), /);
  const logs = code(read("js/pages/logs.js"));
  assert.match(logs, /state\.canLog = can\(me, "activity"\)/);
  assert.match(logs, /checkHtml\(l, esc, state\.canLog\)/);
  assert.match(logs, /wireTicks\(el\("lgList"\), /);
  const ticks = code(read("js/pages/note-ticks.js"));
  assert.match(ticks, /activityRepo\.setDone\(/);
  assert.ok(!/\.rpc\(|\.from\(|console\./.test(ticks), "through repo/ only; nothing logged");
  assert.match(ticks, /b\.disabled = true;/, "one tap at a time");
  const css = read("css/styles.css");
  for (const c of [".nt-box", ".nt-box.done", ".nt-box.todo", ".nt-done", ".nt-todo", ".nt-is-done"]) assert.ok(css.includes(c), c);
  assert.match(css, /:root\[data-theme="dark"\] \{ --nt-ok:/, "both themes");
});

test("the service worker: a new name for the new log code, note-ticks.js kept for offline use", () => {
  const sw = read("sw.js");
  assert.match(sw, /^const CACHE = "dcr-portal2-v4";$/m);
  assert.ok(sw.includes('"js/pages/note-ticks.js"'));
});

/* ── P4's Portal line: a name of several lines ───────────────────────── */
test("an item name of several lines: every line in the title style (Rule A over the whole text first)", () => {
  const html = itemScreenHtml({ name: "Exterior walls\nNorth side\n$1,200 extra", description: "Studs", item_type: "both" }, false);
  assert.match(html, /^<div class="es-t">(<span class="es-type">[^<]*<\/span> )?Exterior walls<br>North side<br>[^<]*<\/div>/);
  assert.ok(!/\$1,200/.test(html), "amounts hidden without prices");
  assert.ok(!/<div class="es-d">North side/.test(html), "no later line in the muted style");
  const one = itemScreenHtml({ name: "Roof", item_type: "both" }, true);
  assert.match(one, /<div class="es-t">(<span class="es-type">[^<]*<\/span> )?Roof<\/div>/);
});
