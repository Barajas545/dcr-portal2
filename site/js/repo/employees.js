/* Employees and crews (BLUEPRINT 3.3.5, migration M2; Appendix A "roster", "profile", "users").

   * roster()                 rpc my_roster(): the employees in the caller's scope — id, full_name,
                              employee_no and the normal schedule only (never phone, address or pay).
                              Admin, manager, accountant: everyone; a lead: self and crew; anyone
                              else: self. It is what every timesheet page picks people from.
   * mine(uid)                the caller's own employees row (RLS: anyone reads their own row), or
                              null when the account is not linked to an employee yet — named
                              columns only, never the office's notes.
   * former() / get(id)       turned-off employees in scope / one employee by id (names and normal
                              hours only): the history of someone who left stays readable.
   * updateMyContact(p, a)    rpc update_my_contact(p_phone, p_address): phone and address of one's
                              own row only (the old profile.js allow-list).
   * crewOf(uid)              the employee ids of a lead's crew (crew_members, RLS: own rows).
   * the admin page (admin, manager — the database refuses everyone else):
       listEmployees(), createEmployee(f), updateEmployee(emp, patch) (versioned), setActive(),
       linkAccount(emp, profileId), listCrews(), addToCrew(lead, emp), removeFromCrew(lead, emp),
       listAccounts() (profiles: names, roles, active — Q29 lets everyone read them; only names
       and roles are used here). */

import { db, must, versioned, pageAll, idOf } from "./_db.js";

/** my_roster() rows, sorted by name: [{id, full_name, employee_no, normal_start1, normal_end1,
    normal_start2, normal_end2, normal_lunch_hours, ...}]. */
export async function roster() {
  const c = await db();
  const rows = must(await c.rpc("my_roster")) || [];
  return (Array.isArray(rows) ? rows : [rows]).filter(Boolean).slice().sort(function (a, b) {
    return String(a.full_name || "").localeCompare(String(b.full_name || ""));
  });
}

/* The columns the timesheet pages read of an employees row: names and normal hours for the pickers,
   phone and address for one's own Settings. Named, never "*": the office's notes stay on the office
   pages (the database lets the person and their lead read the whole row, so a "*" here would carry
   the notes into every phone). */
export const PICKER_COLS = "id, profile_id, full_name, employee_no, active, normal_start1, normal_end1, normal_start2, normal_end2, normal_lunch_hours";
export const MINE_COLS = PICKER_COLS + ", phone, phone_e164, address, version";

/** The caller's own employees row (MINE_COLS), or null (an account not linked to an employee yet). */
export async function mine(uid) {
  if (!uid) return null;
  const c = await db();
  const rows = must(await c.from("employees").select(MINE_COLS).eq("profile_id", uid)) || [];
  return rows[0] || null;
}

/** The turned-off employees in the caller's scope (RLS: the office everyone, a lead self and crew,
    anyone else self), PICKER_COLS, by name — so the history of someone who left can still be read,
    printed and corrected. */
export async function former() {
  const c = await db();
  const rows = must(await c.from("employees").select(PICKER_COLS).eq("active", false)) || [];
  return rows.slice().sort(function (a, b) { return String(a.full_name || "").localeCompare(String(b.full_name || "")); });
}

/** One employee by id (PICKER_COLS), or null when there is none in the caller's scope. */
export async function get(id) {
  if (!/^\d{1,15}$/.test(String(id == null ? "" : id))) return null;     // ids travel through URLs
  const c = await db();
  const rows = must(await c.from("employees").select(PICKER_COLS).eq("id", idOf(String(id)))) || [];
  return rows[0] || null;
}

/** Both values are sent: a blank clears it (the RPC leaves a NULL as it is). */
export async function updateMyContact(phone, address) {
  const c = await db();
  const clean = function (v) { return String(v == null ? "" : v).trim(); };
  return must(await c.rpc("update_my_contact", { p_phone: clean(phone), p_address: clean(address) }));
}

/** A lead's crew: the employee ids of crew_members rows naming them as the lead. */
export async function crewOf(uid) {
  if (!uid) return [];
  const c = await db();
  const rows = must(await c.from("crew_members").select("employee_id").eq("lead_profile_id", uid)) || [];
  return rows.map(function (r) { return r.employee_id; });
}

/* ── the admin page ────────────────────────────────────────────────────── */

export async function listEmployees() {
  const rows = await pageAll(function (c) { return c.from("employees").select("*").order("full_name", { ascending: true }); });
  return rows.filter(function (r) { return !r.deleted_at; });
}

const EDITABLE = ["full_name", "employee_no", "phone", "email", "address", "normal_start1", "normal_end1", "normal_start2",
  "normal_end2", "normal_lunch_hours", "active", "notes", "profile_id", "contact_id"];

/** A form's values -> the columns (blank text -> null, times "HH:MM:SS", lunch a number). */
export function employeeRow(f) {
  const out = {};
  Object.keys(f || {}).forEach(function (k) {
    if (EDITABLE.indexOf(k) === -1) throw new Error("unknown employee field: " + k);
    let v = f[k];
    if (k === "active") { out[k] = v !== false; return; }
    if (k === "normal_lunch_hours") {
      if (v === null || v === undefined || String(v).trim() === "") { out[k] = null; return; }
      const n = Number(v);
      out[k] = Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
      return;
    }
    if (/^normal_(start|end)[12]$/.test(k)) {
      const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(v == null ? "" : v).trim());
      out[k] = m ? String(m[1]).padStart(2, "0") + ":" + m[2] + ":00" : null;
      return;
    }
    if (k === "profile_id") { out[k] = v ? String(v) : null; return; }
    if (k === "contact_id") { out[k] = v === null || v === undefined || v === "" ? null : idOf(String(v)); return; }
    const s = String(v == null ? "" : v).trim();
    out[k] = s ? s : null;
  });
  return out;
}

export async function createEmployee(f) {
  const row = employeeRow(f);
  if (!row.full_name) throw Object.assign(new Error("An employee needs a name."), { code: "22023", status: 400 });
  const c = await db();
  const res = must(await c.from("employees").insert(row).select("*")) || [];
  return res[0] || null;
}

export async function updateEmployee(emp, patch) {
  const row = employeeRow(patch);
  if (!Object.keys(row).length) return emp;
  return versioned("employees", idOf(emp.id), emp.version, row, "*");
}

export function setActive(emp, on) { return updateEmployee(emp, { active: !!on }); }

export function linkAccount(emp, profileId) { return updateEmployee(emp, { profile_id: profileId || null }); }

export async function listCrews() {
  const c = await db();
  return must(await c.from("crew_members").select("*")) || [];
}

export async function addToCrew(leadProfileId, employeeId) {
  const c = await db();
  const res = must(await c.from("crew_members").insert({ lead_profile_id: leadProfileId, employee_id: idOf(employeeId) }).select("*")) || [];
  return res[0] || null;
}

/** -> true when a row was removed, false when there was nothing (already gone, or not allowed). */
export async function removeFromCrew(leadProfileId, employeeId) {
  const c = await db();
  const res = must(await c.from("crew_members").delete().eq("lead_profile_id", leadProfileId).eq("employee_id", idOf(employeeId)).select("*")) || [];
  return res.length > 0;
}

/** Accounts for the "linked account" and crew-lead pickers: names and roles only. */
export async function listAccounts() {
  const c = await db();
  const rows = must(await c.from("profiles").select("id, full_name, role, active")) || [];
  return rows.filter(function (r) { return r.role !== "agents"; }).map(function (r) {
    return { id: r.id, name: String(r.full_name || "").trim(), role: r.role || "", active: r.active !== false };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}
