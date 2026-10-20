/* Projects imported from the old portal (migration 20261019000100_legacy_projects.sql).
   A port of dcrdesk/domain/legacy.py so both apps say the same thing:

   * oldPortalUrl(project)  the old portal's page of an imported project (legacy_sp_id set), else null;
   * dormant(project)       imported and nobody has changed it in Desktop 2 / Portal 2 yet
                            (legacy_sp_id set, still version 1): the Board folds it behind "Old portal";
   * authorLabel(name)      "Juan" -> "Juan · old portal" ("Old portal" stays itself);
   * activityAuthor(row, nameOf)  who wrote an activity row: the person (created_by) by name,
                            else the imported author with "· old portal", else "".

   Pure module (node tests import it). */

export const OLD_PORTAL_SITE = "https://barajas545.github.io/dcr-portal";
export const OLD_PORTAL_LABEL = "Old portal";
export const IMPORTED_SUFFIX = "old portal";

function squash(v) {
  return String(v == null ? "" : v).split(/\s+/).filter(Boolean).join(" ");
}

/** The old portal's item id (a positive integer) or null. Takes a row (legacy_sp_id) or a mapped
    project (legacySpId). */
export function legacyId(p) {
  if (!p) return null;
  const v = p.legacy_sp_id != null ? p.legacy_sp_id : p.legacySpId;
  if (v == null || v === "") return null;
  const n = Number(String(v).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Imported and still as the import left it (version 1; a row without a version counts as 1). */
export function dormant(p) {
  if (!p || legacyId(p) == null) return false;
  const v = Number(p.version == null || p.version === "" ? 1 : p.version);
  return Number.isFinite(v) ? v <= 1 : false;
}

export function oldPortalUrl(p) {
  const n = legacyId(p);
  return n == null ? null : OLD_PORTAL_SITE + "/project.html?id=" + encodeURIComponent(String(n));
}

/** author_name of an imported entry nobody in Desktop 2 wrote (created_by empty), else "". */
export function importedAuthor(row) {
  if (!row || row.created_by) return "";
  return squash(row.author_name);
}

export function authorLabel(name) {
  const t = squash(name);
  if (!t) return "";
  if (t.toLowerCase() === OLD_PORTAL_LABEL.toLowerCase()) return OLD_PORTAL_LABEL;
  return t + " · " + IMPORTED_SUFFIX;
}

/** Who wrote an activity row, for a one-line label. nameOf(uid) -> a name or "". */
export function activityAuthor(row, nameOf) {
  row = row || {};
  if (row.created_by && typeof nameOf === "function") {
    let n = "";
    try { n = nameOf(row.created_by) || ""; } catch (e) { n = ""; }
    if (n) return String(n);
  }
  return authorLabel(importedAuthor(row));
}
