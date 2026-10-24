/* Sales leads (BLUEPRINT 3.3.11 "Leads", Appendix A "leads"; migration M5c `leads` + rpc convert_lead).

   * loadLeads(opts)            every lead the person may read (RLS: admin, manager, accountant, view-only), mapped to
                                the old page's shape, with the converted project's number and name from the shared
                                projects read (repo/projects.js — one query per page; {names: false} skips it);
   * addLead(fields)            an INSERT (admin, manager); the lead date defaults to today (company day) as the old
                                server did;
   * updateLead(lead, fields)   a versioned PATCH of the fields that moved;
   * touchLead(lead)            "Contacted today": last_contacted = today (company day), versioned;
   * deleteLead(lead)           a versioned DELETE;
   * convertLead(lead, f)       rpc convert_lead(p_lead_id, p_project_fields) -> {lead, project}: create_project and the
                                lead's link in ONE transaction (the database gives the project its number and logs
                                "Created from a lead"; a lead converted already says so: 23514 "already converted").
   Every write answers the lead as the database has it after the write. */

import { db, must, versioned, pageAll, idOf } from "./_db.js";
import { insertOne, removeVersioned } from "./_rows.js";
import { loadProjects, forgetProjects } from "./projects.js";
import { toLead, toLeadRow, changedFields, checkLead, projectFields, CONTACTED_COL } from "../map/leads.js";
import { ymd } from "../map/pacific.js";

export const TABLE = "leads";
export const RPC = Object.freeze({
  convert: { name: "convert_lead", args: (leadId, fields) => ({ p_lead_id: leadId, p_project_fields: fields }) },
});

function bad(message) { return Object.assign(new Error(message), { code: "22023", status: 400 }); }

async function projectsById() {
  const out = {};
  try { (await loadProjects()).forEach(function (p) { out[String(p.id)] = p; }); } catch (e) { /* names only: the lead still shows */ }
  return out;
}

/** opts.names === false: no project numbers and names for the converted leads (the home page's counts-only badge
    needs none, so it never pages through the projects for them). */
export async function loadLeads(opts) {
  const rows = await pageAll(function (c) { return c.from(TABLE).select("*").order("id", { ascending: true }); });
  const names = !(opts && opts.names === false);
  const byId = names && rows.some(function (r) { return r.converted_project_id !== null && r.converted_project_id !== undefined; }) ? await projectsById() : {};
  return rows.map(function (r) { return toLead(r, byId); });
}

async function mapOne(row) {
  const byId = row && row.converted_project_id !== null && row.converted_project_id !== undefined ? await projectsById() : {};
  return toLead(row, byId);
}

export async function addLead(fields, today) {
  const why = checkLead(fields);
  if (why) throw bad(why);
  const row = toLeadRow(fields);
  if (!row.lead_date) row.lead_date = today || ymd(new Date());
  return mapOne(await insertOne(TABLE, row));
}

export async function updateLead(lead, fields) {
  const why = checkLead(Object.assign({}, lead, fields));
  if (why) throw bad(why);
  const patch = toLeadRow(changedFields(lead, fields));
  if (!Object.keys(patch).length) return lead;
  try {
    return await mapOne(await versioned(TABLE, idOf(lead.id), lead.version, patch));
  } catch (e) {
    if (e && e.current) e.current = await mapOne(e.current);
    throw e;
  }
}

export async function touchLead(lead, today) {
  const patch = {};
  patch[CONTACTED_COL] = today || ymd(new Date());
  try {
    return await mapOne(await versioned(TABLE, idOf(lead.id), lead.version, patch));
  } catch (e) {
    if (e && e.current) e.current = await mapOne(e.current);
    throw e;
  }
}

export async function deleteLead(lead) {
  try {
    return await removeVersioned(TABLE, { id: idOf(lead.id), version: lead.version });
  } catch (e) {
    if (e && e.current) e.current = await mapOne(e.current);
    throw e;
  }
}

/** f: {name, address, city} -> {lead, project: {id, number, name}} */
export async function convertLead(lead, f) {
  const fields = projectFields(f);
  if (!fields.name) throw bad("A project needs a name.");
  const c = await db();
  const res = must(await c.rpc(RPC.convert.name, RPC.convert.args(idOf(lead.id), fields)));
  const out = Array.isArray(res) ? res[0] : res;
  // {lead, project}: the lead as converted and the new project (create_project's row)
  const project = out && out.project ? out.project : out;
  const pid = project && project.id;
  if (pid === undefined || pid === null) throw new Error("The project was not created.");
  forgetProjects();
  let leadRow = out && out.lead ? out.lead : null;
  if (!leadRow) {
    const rows = must(await c.from(TABLE).select("*").eq("id", idOf(lead.id))) || [];
    leadRow = rows[0] || null;
  }
  const mapped = leadRow ? await mapOne(leadRow) : null;
  return { lead: mapped, project: { id: pid, number: project.number || (mapped && mapped.projectID) || "", name: project.name || fields.name } };
}
