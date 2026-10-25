/* Projects (BLUEPRINT 3.3.1, Appendix A "board", "project"): the Board, the project header and
   Overview, the switcher, Log History's names and Site Photos all read through here.

   * loadProjects()        every live project (RLS: any active person), 1,000 a page, mapped to the
                           old shape; one shared read per page (the Board, the switcher and Log
                           History use the same answer — BLUEPRINT 2.2.3 "one projects query");
   * getProject(id)        one project with its prices embed ('prices:project_prices(*)': null
                           when the prices switch is off = "hidden");
   * setStatus(p, status)  a versioned PATCH of status (the status trigger writes the one activity
                           row; the status note stays as it is, as Desktop 2's set_status does);
   * updateProject(p, ch)  Overview autosave: old-key changes, versioned; the labor rate goes to
                           project_prices with that row's own version (prices people only);
   * createProject(f)      rpc create_project (admin, manager): the database gives the number; the New
                           Project dialog's fields (a zone alone needs no prices, a custom rate does);
   * setThumbnail(p, id)   the project's picture (projects.thumbnail_file_id), versioned;
   * setLocation(...)      rpc set_project_location (write-once rules live in the database). */

import { db, must, versioned, pageAll, conflict, notFound, forbidden, idOf } from "./_db.js";
import { toProject, toDbPatch, NEW_PROJECT_KEYS } from "../map/projects.js";
import { statusForWrite } from "../map/projects.js";
import { isStatus } from "../map/status.js";

export const PRICE_EMBED = "*, prices:project_prices(*)";

let shared = null;

export function loadProjects(opts) {
  if (!shared || (opts && opts.fresh)) {
    shared = pageAll(function (c) {
      return c.from("projects").select("*").order("id", { ascending: true });
    }).then(function (rows) {
      return rows.filter(function (r) { return !r.deleted_at; }).map(toProject);
    }).catch(function (e) { shared = null; throw e; });
  }
  return shared;
}

export function forgetProjects() { shared = null; }

export async function getProject(id) {
  const c = await db();
  const rows = must(await c.from("projects").select(PRICE_EMBED).eq("id", idOf(id))) || [];
  if (!rows.length) throw notFound("That project");
  return toProject(rows[0]);
}

/** A row from a live change -> the mapped shape (prices kept from `before` when the change has none:
    Realtime sends the projects row alone). */
export function fromLive(row, before) {
  const p = toProject(row);
  if (p && before && p.prices === undefined) {
    p.prices = before.prices;
    p.projectLaborRate = before.projectLaborRate;
  }
  return p;
}

export async function setStatus(project, status) {
  const s = statusForWrite(status);
  if (!isStatus(s)) throw Object.assign(new Error("That is not a project status."), { code: "22023" });
  try {
    const row = await versioned("projects", idOf(project.id), project.version, { status: s });
    return fromLive(row, project);
  } catch (e) {
    if (e && e.code === "PT409" && e.current) e.current = fromLive(e.current, project);
    throw e;
  }
}

/** changes: {oldKey: formValue}. Returns the project as the database has it after the save. */
export async function updateProject(project, changes) {
  const patch = toDbPatch(changes);
  let out = project;
  const c = await db();
  if (Object.keys(patch.row).length) {
    try {
      const row = await versioned("projects", idOf(project.id), project.version, patch.row, PRICE_EMBED);
      out = toProject(row);
    } catch (e) {
      if (e && e.code === "PT409" && e.current) e.current = toProject(e.current);
      throw e;
    }
  }
  if (Object.keys(patch.prices).length) {
    const pv = project.prices && project.prices.version;
    if (pv == null) throw Object.assign(new Error("You don't have permission to change prices."), { code: "42501", status: 403 });
    const body = Object.assign({}, patch.prices);
    if ("labor_rate" in body && !("rate_source" in body)) body.rate_source = "custom";   // a typed rate is the project's own
    const rows = must(await c.from("project_prices").update(body).eq("project_id", idOf(project.id)).eq("version", pv).select("*")) || [];
    if (!rows.length) {
      const fresh = await getProject(project.id);
      if (!fresh.prices || Number(fresh.prices.version) === Number(pv)) throw forbidden();   // refused, not raced
      throw conflict(fresh);
    }
    out = Object.assign({}, out, { prices: rows[0], projectLaborRate: rows[0].labor_rate == null ? null : Number(rows[0].labor_rate) });
  }
  return out;
}

const OLD_CREATE_KEYS = { projectName: "name", projectAddress: "address", projectCity: "city" };

/** f: the New Project dialog's fields (map/projects.js newProjectFields: name, address, city, state, zip, client_*,
    status, scope, start_date, rate_source, labor_rate) — the old modal's projectName / projectAddress / projectCity
    still map to name / address / city. Blank text is left out; any other key throws (a typo must not vanish). The
    number is the database's. Returns the new project. */
export async function createProject(f) {
  const fields = {};
  Object.keys(f || {}).forEach(function (k) {
    const col = OLD_CREATE_KEYS[k] || k;
    if (NEW_PROJECT_KEYS.indexOf(col) === -1) throw new Error("unknown project field: " + k);
    const v = f[k];
    if (v === null || v === undefined) return;
    if (col === "labor_rate") { fields[col] = Math.round(Number(v) * 100) / 100; return; }
    const s = String(v).trim();
    if (s) fields[col] = s;
  });
  if (!fields.name) throw Object.assign(new Error("A project needs a name."), { code: "22023", status: 400 });
  const c = await db();
  const res = must(await c.rpc("create_project", { fields: fields }));
  const row = Array.isArray(res) ? res[0] : res;
  if (!row || row.id == null) throw new Error("The project was not created.");
  forgetProjects();
  return toProject(row);
}

/** The project's picture: projects.thumbnail_file_id = fileId (a live file of this project in the thumbnail folder —
    t12_projects_thumbnail refuses anything else with 23514), or null for none. A versioned PATCH of that one column:
    when someone else changed the project meanwhile it is sent once more at their version (nothing else is sent, so
    nothing of theirs is overwritten). Returns the project as the database has it. */
export async function setThumbnail(project, fileId) {
  const patch = { thumbnail_file_id: fileId === null || fileId === undefined ? null : idOf(fileId) };
  try {
    return toProject(await versioned("projects", idOf(project.id), project.version, patch, PRICE_EMBED));
  } catch (e) {
    if (!(e && e.code === "PT409" && e.current)) throw e;
    return toProject(await versioned("projects", idOf(project.id), e.current.version, patch, PRICE_EMBED));
  }
}

/** -> whatever the RPC answers (the project row, or {stored:false, reason}); errors throw. */
export async function setLocation(projectId, lat, lng, accuracyM, source) {
  const c = await db();
  return must(await c.rpc("set_project_location", {
    project_id: idOf(projectId), lat: lat, lng: lng,
    accuracy_m: accuracyM == null ? null : Math.round(Number(accuracyM) * 10) / 10,
    source: source || "gps",
  }));
}
