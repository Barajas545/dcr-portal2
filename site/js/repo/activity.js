/* The project log (activity; BLUEPRINT 3.3.2, Appendix A "board logs / logsSince").

   * forProject(id, {limit, mask})       newest first: 30 for the Board's panel, 300 for a project's
                                         history (Log History, the Log tab);
   * inWindow(fromISO, toISO, {mask})    every project's lines in [from, to), newest first, at most
                                         800, with projects(number, name) embedded;
   * addNote(projectId, text)            a note (admin, manager, accountant, lead — RLS decides);
   * setDone(line, done, opts)           tick a note off (done true) or back on: rpc set_note_done(p_id,
                                         p_version, p_done) — anyone who may write notes, any note; the
                                         database stamps the date and the name (DCR Desktop 2.26). In that
                                         state already (someone was faster): the line as it is, `already`
                                         true; changed meanwhile (PT409): sent once more on the new version.

   Status and system lines come only from the database's triggers. `mask` (the page's amount mask
   for people without prices, Q28) is applied to the text as it is mapped. */

import { db, must, idOf, isConflict } from "./_db.js";
import { toLogLine, cleanNote } from "../map/activity.js";
import { nameBook } from "./people.js";

export const PANEL_LIMIT = 30;
export const HISTORY_LIMIT = 300;
export const WINDOW_LIMIT = 800;

export async function forProject(projectId, opts) {
  opts = opts || {};
  const limit = opts.limit || PANEL_LIMIT;
  const c = await db();
  const [rows, nameOf] = await Promise.all([
    c.from("activity").select("*").eq("project_id", idOf(projectId))
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(0, limit - 1).then(must),
    nameBook(),
  ]);
  return (rows || []).map(function (r) { return toLogLine(r, nameOf, opts.mask); });
}

export async function inWindow(fromISO, toISO, opts) {
  opts = opts || {};
  const c = await db();
  const [rows, nameOf] = await Promise.all([
    c.from("activity").select("*, projects(number, name)")
      .gte("created_at", fromISO).lt("created_at", toISO)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(0, (opts.limit || WINDOW_LIMIT) - 1).then(must),
    nameBook(),
  ]);
  return (rows || []).map(function (r) { return toLogLine(r, nameOf, opts.mask); });
}

export async function addNote(projectId, text, opts) {
  const t = cleanNote(text);
  if (!t) throw Object.assign(new Error("Write something first."), { code: "22023", status: 400 });
  const c = await db();
  const rows = must(await c.from("activity").insert({ project_id: idOf(projectId), kind: "note", text: t }).select("*")) || [];
  const nameOf = await nameBook();
  return rows[0] ? toLogLine(rows[0], nameOf, opts && opts.mask) : null;
}

/** -> the note's log line as it is now, with `already: true` when it was in the asked state before this call
    (the database answered without writing: the last change is not opts.me's - done_by says who ticked it).
    opts: {mask, me (the caller's user id)}. */
export async function setDone(line, done, opts) {
  const c = await db();
  const want = !!done;
  const send = async (version) => {
    const res = must(await c.rpc("set_note_done", { p_id: idOf(line.id), p_version: version == null ? null : Number(version), p_done: want }));
    return Array.isArray(res) ? res[0] || null : res;
  };
  let row;
  try {
    row = await send(line.version);
  } catch (e) {
    if (!isConflict(e)) throw e;
    // someone changed the note first: when it is not in the asked state, the tick goes on their version
    const cur = must(await c.from("activity").select("*").eq("id", idOf(line.id))) || [];
    if (!cur.length) throw e;
    row = !!cur[0].done_at === want ? cur[0] : await send(cur[0].version);
  }
  const nameOf = await nameBook();
  const out = row ? toLogLine(row, nameOf, opts && opts.mask) : null;
  const me = opts && opts.me ? String(opts.me).toLowerCase() : "";
  if (out && me) out.already = String(row.updated_by || "").toLowerCase() !== me;
  return out;
}
