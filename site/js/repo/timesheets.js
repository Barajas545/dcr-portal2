/* Timesheets (BLUEPRINT 3.3.6, migration M2; Appendix A "timesheets", "part=confirm").

   The table is read and written under row level security — the old crew scope, now the database's:
   admin and manager everything; the accountant reads everything and writes only their own (Q7); a
   lead self and crew; everyone else self; a view-only account reads its own and writes nothing.
   A write that moves a row out of the writer's scope is refused (WITH CHECK on the new employee).

   * list(from, to, {employeeId, employeeIds})  entries with work_date in [from, to], each with its
                              employee (name, number) and project (number, name, address) embedded,
                              1,000 a page;
   * create(form) / update(entry, form) / remove(entry)
                              one row, source "portal"; an edit sends the changed columns at the
                              version it read (PT409 "changed by someone else" with the row now);
                              a delete is a hard delete at the version read;
   * createMany(forms, onEach) Batch Entry: one insert per employee, a result per row (one refusal
                              never stops the others);
   * weeks(from, to)          rpc timesheet_weeks: the sign-off marks (live or stale, the confirmer's
                              colour) of every employee-week in scope, the fingerprint of each;
   * confirm(emp, saturday, fingerprint) / unconfirm(confirmationId)
                              rpc confirm_timesheet_week (PT409 when the hours changed since the
                              fingerprint was read) / unconfirm_timesheet_week. */

import { db, must, versioned, pageAll, idOf, conflict, notFound, forbidden } from "./_db.js";
import { toEntry, toRow, rowOf, diffRow, toWeeks } from "../map/timesheets.js";

export const SELECT = "*, employee:employees(id, full_name, employee_no), project:projects(id, number, name, address, city, status)";

export async function list(from, to, opts) {
  const o = opts || {};
  const rows = await pageAll(function (c) {
    let q = c.from("timesheets").select(SELECT).gte("work_date", from).lte("work_date", to);
    if (o.employeeId !== undefined && o.employeeId !== null) q = q.eq("employee_id", idOf(o.employeeId));
    if (o.employeeIds && o.employeeIds.length) q = q.in("employee_id", o.employeeIds.map(idOf));
    return q.order("work_date", { ascending: true }).order("id", { ascending: true });
  });
  return rows.map(toEntry);
}

export async function get(id) {
  const c = await db();
  const rows = must(await c.from("timesheets").select(SELECT).eq("id", idOf(id))) || [];
  if (!rows.length) throw notFound("That time entry");
  return toEntry(rows[0]);
}

export async function create(form) {
  const c = await db();
  const rows = must(await c.from("timesheets").insert(toRow(form, true)).select(SELECT)) || [];
  if (!rows.length) throw new Error("The time entry was not saved.");
  return toEntry(rows[0]);
}

/** -> the entry as saved (or as it was, when nothing changed). */
export async function update(entry, form) {
  const patch = diffRow(rowOf(entry), toRow(form, false));
  if (!Object.keys(patch).length) return entry;
  try {
    return toEntry(await versioned("timesheets", idOf(entry.id), entry.version, patch, SELECT));
  } catch (e) {
    if (e && e.code === "PT409" && e.current) e.current = toEntry(e.current);
    throw e;
  }
}

/** A hard delete at the version read. Gone already counts as done. */
export async function remove(entry) {
  const c = await db();
  const rows = must(await c.from("timesheets").delete().eq("id", idOf(entry.id)).eq("version", entry.version).select("id")) || [];
  if (rows.length) return true;
  const cur = must(await c.from("timesheets").select(SELECT).eq("id", idOf(entry.id))) || [];
  if (!cur.length) return true;
  if (Number(cur[0].version) === Number(entry.version)) throw forbidden();
  throw conflict(toEntry(cur[0]));
}

/** One insert per form, in order; -> [{form, ok, entry} | {form, ok: false, error}]. */
export async function createMany(forms, onEach) {
  const out = [];
  for (let i = 0; i < forms.length; i++) {
    let r;
    try { r = { form: forms[i], ok: true, entry: await create(forms[i]) }; }
    catch (e) { r = { form: forms[i], ok: false, error: e }; }
    out.push(r);
    if (onEach) { try { onEach(r, i, forms.length); } catch (x) { /* the page's own trouble */ } }
  }
  return out;
}

/* ── sign-off ──────────────────────────────────────────────────────────── */

export async function weeks(from, to) {
  const c = await db();
  const rows = must(await c.rpc("timesheet_weeks", { p_from: from, p_to: to })) || [];
  return toWeeks(Array.isArray(rows) ? rows : [rows]);
}

export async function confirm(employeeId, weekStart, seenFingerprint) {
  const c = await db();
  return must(await c.rpc("confirm_timesheet_week", {
    p_employee_id: idOf(employeeId), p_week_start: weekStart, p_seen_fingerprint: seenFingerprint || null,
  }));
}

export async function unconfirm(confirmationId) {
  const c = await db();
  return must(await c.rpc("unconfirm_timesheet_week", { p_confirmation_id: idOf(confirmationId) }));
}
