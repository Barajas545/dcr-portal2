/* Sales leads: Desktop 2 rows (M5c `leads`) <-> the shapes the old leads page consumes (BLUEPRINT 3.3.11
   "Leads", Appendix A "leads", MODULES §5 "leads.html").

     leadClientName <- client_name        leadClientPhone <- client_phone     leadClientAddress <- client_address
     leadProjectName <- project_name      leadCategory <- category            leadSource <- source
     leadDate <- lead_date                leadLastcontactedDate <- last_contacted   leadNotes <- notes
     leadCreateEstimate <- converted_project_id is set ("estimate created" on the old page)
     projectID <- the converted project's number (A###), convertedProjectId <- converted_project_id

   Every day here is a company day ("YYYY-MM-DD", America/Los_Angeles): "contacted 3d ago" counts calendar days in
   Los Angeles, never hours from the phone's own clock. Who: read admin, manager, accountant, view-only; write admin,
   manager (app.can_edit('leads')); a lead or a field account has no leads, as in the old portal. These helpers only
   HIDE controls — the database decides (BLUEPRINT 2.1). Pure module (node tests import it). */

// old key -> column; the page edits only these
export const LEAD_COLS = Object.freeze({
  leadClientName: "client_name",
  leadClientPhone: "client_phone",
  leadClientAddress: "client_address",
  leadProjectName: "project_name",
  leadCategory: "category",
  leadSource: "source",
  leadDate: "lead_date",
  leadNotes: "notes",
});
export const CONTACTED_COL = "last_contacted";
export const READERS = Object.freeze(["admin", "manager", "accountant", "viewer"]);
export const WRITERS = Object.freeze(["admin", "manager"]);
export const MAX_NOTES = 20000;          // leads.notes: at most 20,000 characters (M5c)

const active = (me) => !!me && me.active !== false && !!me.role;
export function readsLeads(me) { return active(me) && READERS.indexOf(me.role) !== -1; }
export function writesLeads(me) { return active(me) && WRITERS.indexOf(me.role) !== -1; }

function txt(v) { return v === null || v === undefined ? "" : String(v); }
function day(v) { const s = txt(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; }

/** A database row -> the old page's shape. byId: {projectId: mapped project} (number and name of a converted lead). */
export function toLead(row, byId) {
  if (!row) return null;
  const pid = row.converted_project_id === null || row.converted_project_id === undefined ? null : row.converted_project_id;
  const p = pid !== null && byId ? byId[String(pid)] : null;
  return {
    id: row.id, version: row.version,
    leadClientName: txt(row.client_name), leadClientPhone: txt(row.client_phone), leadClientAddress: txt(row.client_address),
    leadProjectName: txt(row.project_name), leadCategory: txt(row.category), leadSource: txt(row.source),
    leadDate: day(row.lead_date), leadLastcontactedDate: day(row[CONTACTED_COL]), leadNotes: txt(row.notes),
    leadCreateEstimate: pid !== null, convertedProjectId: pid,
    projectID: p ? txt(p.internalIDNumber) : "", projectName: p ? txt(p.projectName) : "",
    legacySpId: row.legacy_sp_id === undefined ? null : row.legacy_sp_id,
    updatedAt: row.updated_at || row.created_at || null,
  };
}

/** The form's {oldKey: text} -> a row patch: trimmed, "" -> NULL, the date as a company day (an empty date box is not
    sent: the lead date is required, and a new lead's is today), notes kept as typed. The database tidies the same way
    (app.one_line, app.text_block) and formats the phone like every phone. */
export function toLeadRow(fields) {
  const out = {};
  Object.keys(fields || {}).forEach(function (k) {
    const col = LEAD_COLS[k];
    if (!col) return;
    let v = fields[k];
    if (k === "leadNotes") { v = txt(v).replace(/\s+$/, ""); out[col] = v.trim() ? v : null; return; }
    if (k === "leadDate") { const d = day(v); if (d) out[col] = d; return; }   // NOT NULL: an empty box keeps the date
    v = txt(v).replace(/\s+/g, " ").trim();
    out[col] = v || null;
  });
  return out;
}

/** What the form would change on `lead` (an edit sends only the fields that moved). */
export function changedFields(lead, fields) {
  const out = {};
  Object.keys(fields || {}).forEach(function (k) {
    if (!LEAD_COLS[k]) return;
    const a = toLeadRow({ [k]: lead ? lead[k] : "" })[LEAD_COLS[k]];
    const b = toLeadRow({ [k]: fields[k] })[LEAD_COLS[k]];
    if ((a === undefined ? null : a) !== (b === undefined ? null : b)) out[k] = fields[k];
  });
  return out;
}

/** The form's checks, before anything is sent: "" when it is fine, else what to fix. */
export function checkLead(fields) {
  if (!txt(fields && fields.leadClientName).trim()) return "Client name is required.";
  if (txt(fields && fields.leadNotes).length > MAX_NOTES) return "Notes are limited to " + MAX_NOTES.toLocaleString("en-US") + " characters.";
  const d = txt(fields && fields.leadDate).trim();
  if (d && !day(d)) return "The lead date is not a date.";
  return "";
}

function dayNumber(ymdText) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(ymdText));
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
}
/** Calendar days from a to b (both "YYYY-MM-DD"); null when either is missing. */
export function daysBetween(a, b) {
  const x = dayNumber(a), y = dayNumber(b);
  return x === null || y === null ? null : y - x;
}

/** The old badge: never contacted (red), over 30 days (red), over 14 (gold), else green. -> {cls, text} */
export function contactedBadge(lead, today) {
  const days = daysBetween(lead && lead.leadLastcontactedDate, today);
  if (days === null) return { cls: "over", text: "never contacted" };
  const cls = days > 30 ? "over" : days > 14 ? "warn" : "ok";
  if (days <= 0) return { cls: "ok", text: "contacted today" };
  return { cls, text: "contacted " + days + "d ago" };
}

export const UNCATEGORIZED = "Uncategorized";
export function categoryOf(lead) { return lead && lead.leadCategory ? lead.leadCategory : UNCATEGORIZED; }

/** The chips: "all" first, then every category in name order (one chip per spelling the office used). */
export function categories(leads) {
  const seen = {};
  (leads || []).forEach(function (l) { seen[categoryOf(l)] = (seen[categoryOf(l)] || 0) + 1; });
  return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b); }).map(function (c) { return { id: c, n: seen[c] }; });
}

/** The values typed before, for the form's suggestions (category, source). */
export function suggestions(leads, key) {
  const seen = {};
  (leads || []).forEach(function (l) { const v = txt(l && l[key]).trim(); if (v) seen[v] = 1; });
  return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b); });
}

const SEARCHED = ["leadClientName", "leadClientPhone", "leadClientAddress", "leadProjectName", "leadCategory", "leadSource", "leadNotes", "projectID"];

/** The list on screen: the category chip, the words typed (every word must match somewhere), the newest lead first
    (then the most recently contacted, then the name). opts: {cat, q, show: "open" | "converted" | "all"} */
export function visibleLeads(leads, opts) {
  const o = opts || {};
  const words = txt(o.q).toLowerCase().split(/\s+/).filter(Boolean);
  const cat = o.cat || "all";
  const show = o.show || "all";
  return (leads || []).filter(function (l) {
    if (cat !== "all" && categoryOf(l) !== cat) return false;
    if (show === "open" && l.leadCreateEstimate) return false;
    if (show === "converted" && !l.leadCreateEstimate) return false;
    if (!words.length) return true;
    const hay = SEARCHED.map(function (k) { return txt(l[k]); }).join(" ").toLowerCase();
    return words.every(function (w) { return hay.indexOf(w) !== -1; });
  }).sort(function (a, b) {
    return (b.leadDate || "").localeCompare(a.leadDate || "") ||
      (b.leadLastcontactedDate || "").localeCompare(a.leadLastcontactedDate || "") ||
      a.leadClientName.localeCompare(b.leadClientName) || Number(a.id) - Number(b.id);
  });
}

/** "120 Juniper Ln, Pine Hollow, CA 93401" -> {address: "120 Juniper Ln", city: "Pine Hollow"}: the old lead keeps one
    address line, a project keeps the street and the city apart. Only a clear "street, city[, state zip]" is split;
    anything else stays the street, with no city. */
export function splitAddress(line) {
  const s = txt(line).replace(/\s+/g, " ").trim();
  if (!s) return { address: "", city: "" };
  const parts = s.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  if (parts.length < 2) return { address: s, city: "" };
  let last = parts[parts.length - 1];
  if (/^(CA|California)(\s+\d{5}(-\d{4})?)?$/i.test(last) || /^\d{5}(-\d{4})?$/.test(last)) {
    parts.pop();
    if (parts.length < 2) return { address: parts[0] || s, city: "" };
    last = parts[parts.length - 1];
  }
  const cityZip = /^(.*?)(?:\s+(?:CA|California))?(?:\s+\d{5}(?:-\d{4})?)?$/i.exec(last);
  const city = (cityZip ? cityZip[1] : last).trim();
  if (!city || /\d/.test(city)) return { address: s, city: "" };
  return { address: parts.slice(0, -1).join(", "), city };
}

/** The convert form's first values: the lead's project name, else "<client> Residence" (the old page's rule), and
    the lead's address split into street and city. */
export function convertDefaults(lead) {
  const a = splitAddress(lead && lead.leadClientAddress);
  const name = txt(lead && lead.leadProjectName).trim() ||
    (txt(lead && lead.leadClientName).trim() ? txt(lead.leadClientName).trim() + " Residence" : "");
  return { name, address: a.address, city: a.city };
}

/** The convert form -> rpc convert_lead's p_project_fields (create_project's own keys). The client's name and phone
    come from the lead itself (convert_lead copies them), so they are not sent twice. The address and the city are
    always sent — an emptied box is NULL — because convert_lead would otherwise put the lead's whole address line on the
    project. */
export function projectFields(f) {
  const out = {};
  const name = txt(f && f.name).replace(/\s+/g, " ").trim();
  if (name) out.name = name;
  ["address", "city"].forEach(function (k) {
    const v = txt(f && f[k]).replace(/\s+/g, " ").trim();
    out[k] = v || null;
  });
  return out;
}

/** `tel:` link text for a phone as typed ("(805) 555-0101 ext 2" -> "+18055550101"); "" when it holds no number. */
export function telHref(phone) {
  const d = txt(phone).split(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i)[0].replace(/\D+/g, "");
  if (d.length === 10) return "tel:+1" + d;
  if (d.length === 11 && d[0] === "1") return "tel:+" + d;
  if (d.length >= 7) return "tel:" + d;
  return "";
}

/** The dashboard card's line: open leads, and how many nobody has called in two weeks. */
export function leadsSummary(leads, today) {
  const open = (leads || []).filter(function (l) { return !l.leadCreateEstimate; });
  const stale = open.filter(function (l) { const d = daysBetween(l.leadLastcontactedDate, today); return d === null || d > 14; });
  return { open: open.length, stale: stale.length };
}
