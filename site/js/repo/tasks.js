/* Tasks and their updates (BLUEPRINT 3.3.7, migration M3; Appendix A "tasks", "project" taskAdd /
   taskToggle). Who reads which task is the database's rule (Q3: the office and leads all, field and
   view-only people the ones assigned to them or created by them); the pages only draw it.

   * list(view)              rpc my_tasks(p_view): 'mine' | 'crew' (a lead's crew) | 'everyone' — open
                             tasks with their project (number, name, address, city, point), the
                             assignee's name, the notes and the SQL clock (app.task_clock);
   * summary()               rpc my_tasks_summary(): the home page's badge counts;
   * forProject(projectId)   a project's tasks, open and done, with their notes (the Tasks tab);
   * getOne(id)              one task read straight from the tables (a link to a task no list has:
                             finished since, or someone else's), or null when it is not readable;
   * addNote(task, text, key) rpc add_task_note(p_task_id, p_text, p_client_key): one line, at most
                             2,000 characters; refused on a done task ("already complete": err.complete);
                             the same key is accepted once (a resend after a lost answer adds nothing);
   * complete(task, note, me) rpc complete_task(p_id, p_version, p_note): the status and the closing note
                             in one transaction; done already counts as done — completed by someone else
                             first answers {…row, already: true} and the database kept the closing words
                             as a note of their own; a stale version is PT409;
   * reopen(task)            a versioned PATCH back to open (the project's Tasks tab);
   * create(form, me)        a tasks INSERT (row level security decides who may give a task to whom:
                             task editors anyone, the others themselves or nobody — Q8);
   * drain()                 asks the push function to send the new-task notices waiting in the outbox
                             (op 'drain'), with the person's own sign-in; fire-and-forget;
   * people()                active people who can be given a task (names only). */

import { db, must, versioned, idOf, conflict, notFound } from "./_db.js";
import { listPeople, nameBook } from "./people.js";
import { toTask, newTaskRow, cleanNote, NOTE_MAX } from "../map/tasks.js";
import { ymd } from "../map/pacific.js";

export const VIEWS = ["mine", "crew", "everyone"];
const PROJECT_COLS = "id, number, name, address, city, lat, lng, location_source, version, legacy_sp_id";

function opts(extra) {
  return Object.assign({ today: ymd(new Date()) }, extra || {});
}

async function decorate(rows, o) {
  const nameOf = await nameBook();
  const base = opts(Object.assign({ nameOf: nameOf }, o || {}));
  return (rows || []).map(function (r) { return toTask(r, base); });
}

/** -> [task] (open tasks of that list). o: {me, mask}. */
export async function list(view, o) {
  const v = VIEWS.indexOf(view) === -1 ? "mine" : view;
  const c = await db();
  const rows = must(await c.rpc("my_tasks", { p_view: v })) || [];
  return decorate(Array.isArray(rows) ? rows : [rows], o);
}

export async function summary() {
  const c = await db();
  return must(await c.rpc("my_tasks_summary"));
}

async function notesFor(c, ids) {
  if (!ids.length) return {};
  const out = {};
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const rows = must(await c.from("task_notes").select("*").in("task_id", part)
      .order("created_at", { ascending: true }).order("id", { ascending: true }).range(0, 4999)) || [];
    rows.forEach(function (n) { (out[String(n.task_id)] = out[String(n.task_id)] || []).push(n); });
  }
  return out;
}

/** A project's tasks (open and done), newest request first, each with its notes. o: {me, mask, project}. */
export async function forProject(projectId, o) {
  const c = await db();
  const rows = must(await c.from("tasks").select("*").eq("project_id", idOf(projectId))
    .order("created_at", { ascending: false }).order("id", { ascending: false }).range(0, 999)) || [];
  const notes = await notesFor(c, rows.map(function (r) { return r.id; }));
  const p = (o && o.project) || null;
  const full = rows.map(function (r) {
    return Object.assign({}, r, { notes: notes[String(r.id)] || [], project: p ? { number: p.internalIDNumber || p.number, name: p.projectName || p.name,
      address: p.projectAddress || p.address, city: p.projectCity || p.city, lat: p.lat, lng: p.lng } : null });
  });
  return decorate(full, o);
}

/** One task from the tables (with its notes and project), or null when it is not readable (gone, or
    not this person's to see: the two answers are the same, so a link never tells which ids exist). */
export async function getOne(id, o) {
  if (!/^\d{1,15}$/.test(String(id))) return null;
  const c = await db();
  const rows = must(await c.from("tasks").select("*").eq("id", idOf(String(id)))) || [];
  if (!rows.length) return null;
  const r = rows[0];
  const notes = await notesFor(c, [r.id]);
  let project = null;
  if (r.project_id !== null && r.project_id !== undefined) {
    const pr = must(await c.from("projects").select(PROJECT_COLS).eq("id", r.project_id)) || [];
    project = pr[0] || null;
  }
  return (await decorate([Object.assign({}, r, { notes: notes[String(r.id)] || [], project: project })], o))[0];
}

function refusedComplete(e) {
  if (e && /already complete|already done|is done/i.test(String(e.message || ""))) e.complete = true;
  return e;
}

/** -> whatever add_task_note answers (the note, or {already: true}). */
export async function addNote(task, words, key) {
  const t = cleanNote(words);
  if (!t) throw Object.assign(new Error("Write an update first — or tap one of the phrases above."), { code: "22023", status: 400, own: true });
  if (t.length > NOTE_MAX) throw Object.assign(new Error("That update is too long — keep it under 2,000 characters."), { code: "22023", status: 400, own: true });
  const c = await db();
  try {
    return must(await c.rpc("add_task_note", { p_task_id: idOf(task.id), p_text: t, p_client_key: key || null }));
  } catch (e) { throw refusedComplete(e); }
}

/** -> the answer of complete_task: the task row, with `already: true` when someone else had completed it
    first (completed_by is not `me`, the caller's user id). The database still kept the closing words then,
    as a note of their own (once: a resend of the same words adds nothing) — the pages say so. */
export async function complete(task, note, me) {
  const n = cleanNote(note);
  if (n.length > NOTE_MAX) throw Object.assign(new Error("Keep the closing note under 2,000 characters."), { code: "22023", status: 400, own: true });
  const c = await db();
  let version = task.version;
  if (version === null || version === undefined) {
    const cur = must(await c.from("tasks").select("id, version, status").eq("id", idOf(task.id))) || [];
    if (!cur.length) throw notFound("That task");
    version = cur[0].version;
  }
  const res = must(await c.rpc("complete_task", { p_id: idOf(task.id), p_version: version, p_note: n || null }));
  const row = Array.isArray(res) ? res[0] || null : res;
  return completedElsewhere(row, me) ? Object.assign({}, row, { already: true, noteKept: !!n }) : row;
}

/** Did someone else complete it first? (completed_by is the database's stamp of who did.) */
export function completedElsewhere(row, me) {
  const by = row && row.status === "done" && row.completed_by ? String(row.completed_by).toLowerCase() : "";
  return !!(by && me && by !== String(me).toLowerCase());
}

/** Open again (a versioned PATCH; the database clears completed_at / completed_by). */
export async function reopen(task) {
  const row = await versioned("tasks", idOf(task.id), task.version, { status: "open" });
  return row;
}

/** f: {title, description, category, subCategory, priority, assignedTo, dueDate, dueTime, projectId}.
    -> the new task row. A new task given to someone else is announced by the push function (drain). */
export async function create(f, me) {
  const made = newTaskRow(f, me);
  if (made.error) throw Object.assign(new Error(made.error), { code: "22023", status: 400, own: true });
  const c = await db();
  const rows = must(await c.from("tasks").insert(made.row).select("*")) || [];
  if (!rows.length) throw new Error("The task was not created.");
  if (made.row.assigned_to && (!me || String(made.row.assigned_to) !== String(me.id))) drain();
  return rows[0];
}

/** Fire-and-forget: the push function sends the new-task notices waiting in the outbox. Never
    throws, never waits for an answer the page needs (a task is never lost over a notice). */
export function drain() {
  try {
    Promise.resolve(db()).then(function (c) {
      if (!c || !c.functions || typeof c.functions.invoke !== "function") return null;
      return c.functions.invoke("push", { body: { op: "drain" } });
    }).then(function () { return null; }, function () { return null; });
  } catch (e) { /* a notice is a nicety */ }
}

/** Active people who can be given a task: [{id, name, role}] (never the DCR Agents account). */
export async function people() {
  const m = await listPeople();
  return Array.from(m.values()).filter(function (p) { return p.active && p.role !== "agents" && p.name; });
}

export { conflict };
