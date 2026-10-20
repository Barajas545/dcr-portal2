/* Projects: Desktop 2 rows <-> the shapes the old portal's pages consume (BLUEPRINT Appendix A).

     internalIDNumber <- number      projectName <- name        estimateStatus <- status (old word)
     projectAddress   <- address     projectCity <- city        estimateStatusDescription <- status_note
     projectClientName <- client_name   projectPhoneNumber <- client_phone
     projectEmailAddress <- client_email  projectDate <- created_at (the import keeps the old date)
     projectCompletedDate <- completed_date   projectDateLastModified <- updated_at
     projectCoordinates <- "lat,lng|<location_source>" (the old capture page's format)
     projectLaborRate <- prices.labor_rate (null when the prices switch is off: "hidden")

   Every mapped project also keeps what the new pages need: status (database word), statusLabel,
   version, legacySpId, dormant, thumbnailFileId, prices (null = hidden, undefined = not read).

   Writes are reverse-mapped through PROJECT_FIELDS (old key -> column). Pure module. */

import { toOldStatus, toNewStatus, statusLabel } from "./status.js";
import { dormant, legacyId } from "./legacy.js";

// Overview fields: Desktop 2's own (dcrdesk/ui/pages/project/overview.py DETAIL_FIELDS), under the
// old portal's keys where it had one. type: text | date | area | money | tags.
export const PROJECT_FIELDS = Object.freeze([
  { key: "projectName", col: "name", label: "Project name", type: "text", section: "project", required: true },
  { key: "projectAddress", col: "address", label: "Address", type: "text", section: "project" },
  { key: "projectCity", col: "city", label: "City", type: "text", section: "project" },
  { key: "projectState", col: "state", label: "State", type: "text", section: "project" },
  { key: "projectZip", col: "zip", label: "ZIP", type: "text", section: "project" },
  { key: "projectStartDate", col: "start_date", label: "Start date", type: "date", section: "project" },
  { key: "projectCompletedDate", col: "completed_date", label: "Completed", type: "date", section: "project" },
  { key: "estimateStatusDescription", col: "status_note", label: "Status note", type: "text", section: "project" },
  { key: "projectClientName", col: "client_name", label: "Client name", type: "text", section: "client" },
  { key: "projectPhoneNumber", col: "client_phone", label: "Client phone", type: "text", section: "client" },
  { key: "projectEmailAddress", col: "client_email", label: "Client e-mail", type: "text", section: "client" },
  { key: "projectLaborRate", col: "labor_rate", label: "Labor rate ($/hour)", type: "money", section: "estimating", price: true },
  { key: "projectPlansURL", col: "plans_url", label: "Plans link", type: "text", section: "estimating" },
  { key: "checkTagNames", col: "tags", label: "Tags", type: "tags", section: "estimating" },
  { key: "checkScopeAndProjectFeatures", col: "scope", label: "Scope", type: "area", section: "estimating" },
]);
const BY_KEY = Object.freeze(PROJECT_FIELDS.reduce(function (m, f) { m[f.key] = f; return m; }, {}));
export const PRICE_KEYS = Object.freeze(PROJECT_FIELDS.filter(function (f) { return f.price; }).map(function (f) { return f.key; }));

// The tag chips every project offers (dcrdesk/domain/tags.py KNOWN_TAGS).
export const KNOWN_TAGS = Object.freeze(["New Construction", "Siding Installation", "ADU", "Deck Installation",
  "Remodel", "Windows and Doors", "Repairs", "Luxury", "General Contracting", "Apartments", "Commercial",
  "Pergola", "Metal Studs", "Duplex", "Addition", "Garage", "Shop", "JADU", "Fence", "Mobile Home", "Winery",
  "Work Truck"]);

/** "#adu" -> "ADU"; the old typo Pergolla -> Pergola; other text trimmed (domain/tags.py canonical). */
export function canonicalTag(tag) {
  const t = String(tag == null ? "" : tag).split(/\s+/).filter(Boolean).join(" ").replace(/^#+/, "").trim();
  if (!t) return "";
  const k = t.toLowerCase();
  if (k === "pergolla") return "Pergola";
  for (let i = 0; i < KNOWN_TAGS.length; i++) if (KNOWN_TAGS[i].toLowerCase() === k) return KNOWN_TAGS[i];
  return t;
}

/** A tag list (or the old "#ADU, #Remodel" text) -> canonical tags, order kept, no repeats. */
export function parseTags(v) {
  const items = Array.isArray(v) ? v : String(v == null ? "" : v).split(/[,;\n]+/);
  const out = [], seen = {};
  items.forEach(function (x) {
    const t = canonicalTag(x);
    if (t && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = 1; out.push(t); }
  });
  return out;
}

function nz(v) { return v === undefined ? null : v; }

/** "lat,lng|src" for the capture page's ranking; null without a pin. An imported point without a
    source counts as a geocoded guess (most of them were). */
export function coordsText(row) {
  const lat = row && row.lat, lng = row && row.lng;
  if (lat == null || lng == null || lat === "" || lng === "") return null;
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a.toFixed(6) + "," + b.toFixed(6) + "|" + (row.location_source || "geocode");
}

/** A projects row (optionally with the prices embed) -> the old pages' project shape. */
export function toProject(row) {
  if (!row) return null;
  const prices = row.prices === undefined ? undefined : (row.prices && typeof row.prices === "object"
    ? (Array.isArray(row.prices) ? (row.prices[0] || null) : row.prices) : null);
  return {
    id: row.id,
    internalIDNumber: row.number || "",
    projectName: row.name || "",
    projectAddress: nz(row.address),
    projectCity: nz(row.city),
    projectState: nz(row.state),
    projectZip: nz(row.zip),
    projectDate: nz(row.created_at),
    projectStartDate: nz(row.start_date),
    projectCompletedDate: nz(row.completed_date),
    projectDateLastModified: nz(row.updated_at),
    estimateStatus: toOldStatus(row.status),
    estimateStatusDescription: nz(row.status_note),
    projectClientName: nz(row.client_name),
    projectPhoneNumber: nz(row.client_phone),
    projectEmailAddress: nz(row.client_email),
    projectPlansURL: nz(row.plans_url),
    checkScopeAndProjectFeatures: nz(row.scope),
    checkTagNames: parseTags(row.tags || []),
    projectCoordinates: coordsText(row),
    projectLaborRate: prices ? nz(prices.labor_rate) : null,
    // the new pages' fields
    status: row.status || "",
    statusLabel: statusLabel(row.status),
    clientContactId: nz(row.client_contact_id),
    lat: row.lat == null ? null : Number(row.lat),
    lng: row.lng == null ? null : Number(row.lng),
    locationSource: nz(row.location_source),
    version: row.version == null ? 1 : Number(row.version),
    legacySpId: legacyId(row),
    dormant: dormant(row),
    thumbnailFileId: nz(row.thumbnail_file_id),
    folderName: nz(row.folder_name),
    createdBy: nz(row.created_by),
    updatedBy: nz(row.updated_by),
    deletedAt: nz(row.deleted_at),
    prices: prices === undefined ? undefined : prices,
  };
}

/** The value a field holds in the form (dates as YYYY-MM-DD, tags as a list, money a number). */
export function fieldValue(project, key) {
  const f = BY_KEY[key];
  if (!f || !project) return null;
  const v = project[key];
  if (f.type === "date") return v ? String(v).slice(0, 10) : "";
  if (f.type === "tags") return parseTags(v || []);
  if (f.type === "money") return v == null || v === "" ? null : Math.round(Number(v) * 100) / 100;
  return v == null ? "" : String(v);
}

/** A form value -> what the database takes (blank text -> null, dates YYYY-MM-DD, money 2 places). */
export function wireValue(key, value) {
  const f = BY_KEY[key];
  if (!f) throw new Error("unknown project field: " + key);
  if (f.type === "date") {
    const s = String(value == null ? "" : value).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  if (f.type === "money") {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  if (f.type === "tags") return parseTags(value || []);
  const t = String(value == null ? "" : value).trim();
  return t ? t : null;
}

/** Old-key changes -> {row: {column: value}, prices: {labor_rate}}; unknown keys throw (a typo must
    not silently drop an edit). */
export function toDbPatch(changes) {
  const row = {}, prices = {};
  Object.keys(changes || {}).forEach(function (k) {
    const f = BY_KEY[k];
    if (!f) throw new Error("unknown project field: " + k);
    const v = wireValue(k, changes[k]);
    if (f.price) prices[f.col] = v; else row[f.col] = v;
  });
  return { row: row, prices: prices };
}

/** Do two form values of a field mean the same thing? (the autosave's "is it dirty") */
export function sameValue(key, a, b) {
  const f = BY_KEY[key];
  if (!f) return a === b;
  if (f.type === "tags") {
    const x = parseTags(a || []), y = parseTags(b || []);
    return x.length === y.length && x.every(function (t, i) { return t.toLowerCase() === y[i].toLowerCase(); });
  }
  if (f.type === "money") {
    const x = wireValue(key, a), y = wireValue(key, b);
    return x === y;
  }
  return String(wireValue(key, a) == null ? "" : wireValue(key, a)) === String(wireValue(key, b) == null ? "" : wireValue(key, b));
}

export function fieldDef(key) { return BY_KEY[key] || null; }

/** "A291 — Hillside Residence" */
export function projectTitle(p) {
  if (!p) return "";
  const n = p.internalIDNumber || p.number || "", nm = p.projectName || p.name || "";
  return n && nm ? n + " — " + nm : (n || nm || ("Project " + (p.id == null ? "" : p.id)));
}

/** "100 Sample Rd · Paso Robles" */
export function addressLine(p, sep) {
  if (!p) return "";
  return [p.projectAddress, p.projectCity].filter(Boolean).join(sep || " · ");
}

/** The switcher / search label: number — name · client · address · phone · e-mail. */
export function switcherLabel(p) {
  return [projectTitle(p), p.projectClientName, addressLine(p, ", "), p.projectPhoneNumber,
    p.projectEmailAddress].filter(Boolean).join(" · ");
}

/** Status for writes: accepts a database word or an old spelling. */
export function statusForWrite(s) {
  return toNewStatus(s);
}

/** Natural project-number order: A99 < A291 < A1000; a suffix right after its base
    (A024 < A024-B < A025; A000 < A000T1 < A001) — app.project_number_sort. */
export function numberSortKey(number) {
  const s = String(number || "");
  const m = /^([A-Z])([0-9]{1,18})(.*)$/.exec(s);
  if (!m) return s;
  return m[1] + m[2].padStart(18, "0") + m[3];
}
