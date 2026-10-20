// P3 (tasks): repo/tasks.js over the DEMO database (tools/fake: migration M3's rules imitated — my_tasks
// and its views per role, my_tasks_summary, add_task_note, complete_task, the guards, the outbox, the
// "no longer yours" tombstone), as the demo accounts — so the demo pages behave as the real database does
// (tools/schema-check.mjs runs the same module against the real migrations). Made-up people only.
import test from "node:test";
import assert from "node:assert/strict";
import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import { clearPeople } from "../site/js/repo/people.js";
import * as tasks from "../site/js/repo/tasks.js";
import { clockOf, toTask } from "../site/js/map/tasks.js";
import { companyToday } from "../site/js/common2.js";

const skip = !available && "the demo database (tools/fake) is not here";

async function as(engine, key, extra) {
  const p = await person(key);
  clearPeople();
  useClient(Object.assign(clientAs(engine, p.id), extra || {}));
  return p;
}
const titleOf = (e, t) => e.rows.tasks.find((x) => x.title === t);

test("list(view): mine for everyone; crew a lead's; everyone the office and leads (Q3); refused views are 42501 / 22023; the agents account nothing", { skip }, async () => {
  const e = await freshEngine();
  const want = { field: 7, newhire: 3, viewer: 1, accountant: 1, lead: 4, manager: 4, admin: 0 };
  for (const [k, n] of Object.entries(want)) {
    const me = await as(e, k);
    const list = await tasks.list("mine", { me: me.id });
    assert.equal(list.length, n, k + " mine");
    assert.ok(list.every((t) => t.mine && !t.done), k + ": open, mine");
  }
  const lead = await as(e, "lead");
  const crew = await tasks.list("crew", { me: lead.id });
  assert.deepEqual([...new Set(crew.map((t) => t.assigneeName))].sort(), ["Jordan Field", "Pat Newhire", "Riley Lead"]);
  const all = await tasks.list("everyone", { me: lead.id });
  assert.equal(all.length, e.rows.tasks.filter((t) => t.status === "open").length, "a lead reads every open task (Q3)");
  for (const [k, v, code] of [["field", "everyone", "42501"], ["viewer", "crew", "42501"], ["accountant", "crew", "42501"], ["manager", "crew", "42501"]]) {
    await as(e, k);
    await assert.rejects(tasks.list(v), (x) => x.code === code, k + " " + v);
  }
  await as(e, "admin");
  const c = clientAs(e, (await person("admin")).id);
  const bad = await c.rpc("my_tasks", { p_view: "all" });
  assert.equal(bad.error.code, "22023");
  await as(e, "agents");
  await assert.rejects(tasks.list("mine"), (x) => x.code === "42501");
});

test("list(): the project, the place, names, notes oldest first, the clock — the demo's clock is app.task_clock's rule (clockOf)", { skip }, async () => {
  const e = await freshEngine();
  const me = await as(e, "field");
  const list = await tasks.list("mine", { me: me.id });
  const shoot = list.find((t) => t.photo);
  assert.ok(shoot && shoot.photo.ref === "PV-A267-03" && shoot.projectNumber === "A267" && shoot.address === "1 Test Way" && shoot.lat !== null);
  assert.equal(shoot.needsUpdate, false, "a shoot before its day never needs an update");
  const imported = list.find((t) => t.legacy);
  assert.ok(imported, "the imported task");
  assert.deepEqual(imported.notes.map((n) => [n.who, n.viaLabel]), [["Ana Crew · old portal", "old portal"], ["Lee Office · old portal", "old portal"], ["Jordan Field", "by text"]]);
  assert.equal(imported.requestedBy, "Lee Office · old portal");
  assert.ok(list.find((t) => t.recurring && t.recurring.every === "Weekly on Mondays"), "the recurring chip's words");
  const quiet = list.find((t) => t.title === "Measure the deck ledger");
  assert.deepEqual([quiet.needsUpdate, quiet.daysSinceUpdate, quiet.lastUpdateSource], [true, 7, "note"]);
  // the demo's clock agrees with the page's rule for every seeded task
  const today = companyToday();
  for (const t of e.rows.tasks) {
    const notes = e.rows.task_notes.filter((n) => n.task_id === t.id);
    const js = clockOf(t, notes, today);
    const row = e.rpc({ uid: (await person("admin")).id }, "my_tasks", { p_view: "everyone" }).find((x) => x.id === t.id);
    if (!row) continue;
    assert.deepEqual([row.days_since_update, row.needs_update, row.last_update_source === "note"], [js.days_since_update, js.needs_update, js.last_update_source === "note"], t.title);
  }
});

test("summary(): M3's badge counts — mine, a lead's crew, the office's everyone (null without such a list)", { skip }, async () => {
  const e = await freshEngine();
  await as(e, "lead");
  const s = await tasks.summary();
  assert.deepEqual([s.mine, s.mine_needs_update, s.crew, s.everyone !== null], [4, 2, 13, true]);
  await as(e, "field");
  const f = await tasks.summary();
  assert.deepEqual([f.mine, f.crew, f.everyone], [7, null, null]);
});

test("addNote(): one line, written once per client key (a resend adds nothing), refused on a done task with 'already complete' (err.complete), never for a viewer or a stranger", { skip }, async () => {
  const e = await freshEngine();
  const me = await as(e, "field");
  const t = (await tasks.list("mine", { me: me.id })).find((x) => x.title === "Pick up the permit card");
  const n0 = e.rows.task_notes.length;
  const a = await tasks.addNote(t, "  Picked it up\n at the counter  ", "p2-demo-key-1");
  const b = await tasks.addNote(t, "Picked it up at the counter", "p2-demo-key-1");
  assert.equal(e.rows.task_notes.length, n0 + 1, "one note for one key");
  assert.equal(a.id, b.id);
  const row = e.rows.task_notes[e.rows.task_notes.length - 1];
  assert.deepEqual([row.text, row.via, row.source_key, row.created_by], ["Picked it up at the counter", "portal", "portal:p2-demo-key-1", me.id]);
  await assert.rejects(tasks.addNote(t, "   "), (x) => x.code === "22023" && x.own, "nothing to send: said by the page");
  await assert.rejects(tasks.addNote(t, "x".repeat(2001)), (x) => x.code === "22023");
  await tasks.complete(t, "");
  await assert.rejects(tasks.addNote(t, "Too late", "p2-demo-key-2"), (x) => x.complete === true && /already complete/.test(x.message));
  assert.equal((await tasks.addNote(t, "Picked it up at the counter", "p2-demo-key-1")).id, a.id, "the same key after the task was completed: the note already written");
  const v = await as(e, "viewer");
  const mine = (await tasks.list("mine", { me: v.id }))[0];
  await assert.rejects(tasks.addNote(mine, "Read it"), (x) => x.code === "42501", "a viewer adds no note");
  await as(e, "newhire");
  await assert.rejects(tasks.addNote({ id: titleOf(e, "Measure the deck ledger").id }, "not mine"), (x) => x.code === "PT404", "someone else's task: not on my list");
});

test("complete(): the status and the closing note together; done already is done (no second note); a moved version is PT409; reopen() is a versioned PATCH", { skip }, async () => {
  const e = await freshEngine();
  const me = await as(e, "lead");
  const t = (await tasks.list("mine", { me: me.id })).find((x) => x.title === "Confirm truss delivery");
  e.update({ uid: (await person("manager")).id }, "tasks", { priority: "high" }, { filters: [{ col: "id", op: "eq", val: t.id }] });
  await assert.rejects(tasks.complete(t, "Delivered"), (x) => x.code === "PT409", "someone changed it while it was open");
  const fresh = (await tasks.list("mine", { me: me.id })).find((x) => x.id === t.id);
  const n0 = e.rows.task_notes.length;
  const done = await tasks.complete(fresh, "Delivered\nand stacked");
  assert.equal(done.status, "done");
  const row = titleOf(e, "Confirm truss delivery");
  assert.deepEqual([row.status, row.completed_by, e.rows.task_notes.length], ["done", me.id, n0 + 1]);
  assert.deepEqual([e.rows.task_notes[n0].text, e.rows.task_notes[n0].via], ["Delivered and stacked", "portal"]);
  const again = await tasks.complete(fresh, "Delivered\nand  stacked", me.id);
  assert.equal(again.status, "done");
  assert.equal(again.already, undefined, "completed by me: not 'already'");
  assert.equal(e.rows.task_notes.length, n0 + 1, "the same words again (a lost answer): no second note");
  await tasks.complete(fresh, "Delivered", me.id);
  assert.equal(e.rows.task_notes.length, n0 + 2, "other words on a done task still count (a note of their own)");
  const back = await tasks.reopen(Object.assign({}, fresh, { version: row.version }));
  assert.deepEqual([back.status, back.completed_at], ["open", null]);
  await as(e, "viewer");
  const vt = titleOf(e, "Read the new safety plan");
  await assert.rejects(tasks.complete({ id: vt.id, version: vt.version }, ""), (x) => x.code === "42501", "a viewer completes nothing");
});

test("complete(): someone else completed it first — the answer says so (already) and the closing words are still kept, once", { skip }, async () => {
  const e = await freshEngine();
  const lead = await person("lead");
  const field = await as(e, "field");
  const t = (await tasks.list("mine", { me: field.id }))[0];
  assert.ok(t, "the field person has an open task");
  // the office completes it without a live event reaching the phone
  e.rpc({ uid: lead.id }, "complete_task", { p_id: t.id, p_note: null });
  const n0 = e.rows.task_notes.filter((n) => n.task_id === t.id).length;
  const r = await tasks.complete(t, "Garage sheathing finished, nails short by one box", field.id);
  assert.equal(r.already, true, "completed by someone else first");
  assert.equal(r.noteKept, true);
  assert.equal(r.completed_by, lead.id);
  const mine = e.rows.task_notes.filter((n) => n.task_id === t.id);
  assert.equal(mine.length, n0 + 1, "the closing words are kept as an update");
  assert.deepEqual([mine[mine.length - 1].text, mine[mine.length - 1].created_by, mine[mine.length - 1].via],
    ["Garage sheathing finished, nails short by one box", field.id, "portal"]);
  await tasks.complete(t, "Garage sheathing finished, nails short by one box", field.id);
  assert.equal(e.rows.task_notes.filter((n) => n.task_id === t.id).length, n0 + 1, "a resend of the same words: once");
  // without `me` (or by me) it is a plain answer
  const plain = await tasks.complete(t, "", null);
  assert.equal(plain.already, undefined);
  assert.equal(tasks.completedElsewhere({ status: "done", completed_by: field.id }, field.id), false);
  assert.equal(tasks.completedElsewhere({ status: "done", completed_by: lead.id }, field.id.toUpperCase()), true);
  assert.equal(tasks.completedElsewhere({ status: "open", completed_by: null }, field.id), false);
});

test("create(): Q8 — a lead for anyone (one outbox row, the Access wording and the Portal 2 link, then the push function's drain); field for themself or nobody; a viewer nothing; nobody sets the agents' or the import's columns", { skip }, async () => {
  const e = await freshEngine();
  const sandbox = e.rows.projects.find((p) => p.number === "A267").id;
  const calls = [];
  const fn = { functions: { invoke: async (name, o) => { calls.push([name, o && o.body]); return { data: { sent: 0 }, error: null }; } } };
  const lead = await as(e, "lead", fn);
  const field = await person("field");
  const out0 = e.rows.notifications_outbox.length;
  const row = await tasks.create({ title: "Check the north wall blocking", category: "General Task", subCategory: "Review", priority: "high",
    assignedTo: field.id, projectId: sandbox, dueDate: companyToday(), dueTime: "07:30" }, lead);
  assert.deepEqual([row.title, row.assigned_to, row.created_by, row.due_time, row.sub_category], ["Check the north wall blocking", field.id, lead.id, "07:30:00", "Review"]);
  const ob = e.rows.notifications_outbox.slice(out0);
  assert.equal(ob.length, 1, "one notice");
  assert.equal(ob[0].subject, "New Request - General Task - Review - Check the north wall blocking");
  assert.ok(ob[0].body.includes("https://portal.dcrframing.com/my-tasks.html?task=" + row.id) && ob[0].body.includes("=".repeat(39)) && /\r\n/.test(ob[0].body));
  assert.deepEqual([ob[0].to_profile_id, ob[0].email_wanted], [field.id, false]);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, [["push", { op: "drain" }]], "the push function is asked to send it (fire-and-forget)");
  // field: themself or nobody
  const f = await as(e, "field", fn);
  calls.length = 0;
  const own = await tasks.create({ title: "Bring the ladder", assignedTo: f.id }, f);
  assert.equal(own.assigned_to, f.id);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, [], "no notice for oneself");
  await assert.rejects(tasks.create({ title: "For Riley", assignedTo: lead.id }, f), (x) => x.own && /yourself/.test(x.message), "the page says it first");
  const c = clientAs(e, f.id);
  const raw = await c.from("tasks").insert({ title: "For Riley", assigned_to: lead.id }).select("*");
  assert.equal(raw.error.code, "42501", "the database refuses it too");
  for (const extra of [{ agent_kind: "photo", agent_ref: "PV-X", agent_date: companyToday() }, { legacy_sp_id: 5 }, { author_name: "Someone" }]) {
    const r = await c.from("tasks").insert(Object.assign({ title: "x", assigned_to: f.id }, extra)).select("*");
    assert.equal(r.error && r.error.code, "42501", JSON.stringify(extra));
  }
  const viaSms = await c.from("task_notes").insert({ task_id: own.id, text: "x", via: "sms" }).select("*");
  assert.equal(viaSms.error && viaSms.error.code, "42501", "a person never files a channel's words");
  await as(e, "viewer");
  await assert.rejects(tasks.create({ title: "x" }, { id: (await person("viewer")).id, role: "viewer" }), (x) => x.code === "42501");
});

test("handing a field person's task to someone else leaves a 'no longer yours' tombstone only they read (M1 7b); a new outbox row for the new person", { skip }, async () => {
  const e = await freshEngine();
  const t = titleOf(e, "Sheathing on the garage");
  const mgr = await person("manager"), lead = await person("lead"), field = await person("field");
  const out0 = e.rows.notifications_outbox.length;
  e.update({ uid: mgr.id }, "tasks", { assigned_to: lead.id }, { filters: [{ col: "id", op: "eq", val: t.id }] });
  const tomb = e.rows.deletions.find((d) => d.table_name === "tasks" && d.row_id === t.id);
  assert.ok(tomb && tomb.for_user === field.id);
  assert.ok(e.canRead(e.who({ uid: field.id }), "deletions", tomb) && !e.canRead(e.who({ uid: lead.id }), "deletions", tomb));
  assert.equal(e.rows.notifications_outbox.length, out0 + 1);
  await as(e, "field");
  assert.ok(!(await tasks.list("mine", { me: field.id })).some((x) => x.id === t.id), "it left the field person's list");
});

test("forProject() / getOne(): a project's tasks open and done with their notes; one task from the tables (done reads as done; not readable is null)", { skip }, async () => {
  const e = await freshEngine();
  const sandbox = e.rows.projects.find((p) => p.number === "A267");
  const me = await as(e, "lead");
  const list = await tasks.forProject(sandbox.id, { me: me.id, project: { id: sandbox.id, internalIDNumber: sandbox.number, projectName: sandbox.name } });
  assert.ok(list.length >= 3 && list.every((t) => t.projectNumber === "A267"));
  const insp = list.find((t) => t.title === "Schedule the framing inspection");
  assert.deepEqual([insp.notes.length, insp.notes[0].who, insp.dueTime], [1, "Morgan Manager", "07:30"]);
  const done = titleOf(e, "Clean up the lumber pile");
  const one = await tasks.getOne(done.id, { me: me.id });
  assert.equal(one.done, true);
  assert.equal(one.notes.length, 1);
  await as(e, "newhire");
  assert.equal(await tasks.getOne(titleOf(e, "Measure the deck ledger").id), null, "someone else's task: the same answer as none");
  assert.equal(await tasks.getOne("12 or 1=1"), null, "an id only");
});

test("people(): active people a task can be given to, never the DCR Agents account (names only)", { skip }, async () => {
  const e = await freshEngine();
  await as(e, "lead");
  const ps = await tasks.people();
  assert.ok(ps.length >= 7 && ps.every((p) => p.role !== "agents" && p.active && p.name));
  assert.ok(!ps.some((p) => p.name === "Sam Former"), "a deactivated account is not offered");
  void toTask;
});
