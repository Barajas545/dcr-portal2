/* The project log (activity; BLUEPRINT 3.3.2, Appendix A "board logs / logsSince").

   * forProject(id, {limit, mask})       newest first: 30 for the Board's panel, 300 for a project's
                                         history (Log History, the Log tab);
   * inWindow(fromISO, toISO, {mask})    every project's lines in [from, to), newest first, at most
                                         800, with projects(number, name) embedded;
   * addNote(projectId, text)            a note (admin, manager, accountant, lead — RLS decides).

   Status and system lines come only from the database's triggers. `mask` (the page's amount mask
   for people without prices, Q28) is applied to the text as it is mapped. */

import { db, must, idOf } from "./_db.js";
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
