/* Project log (activity) rows -> the old pages' log shape (BLUEPRINT 3.3.2, Appendix A):

     logDate <- created_at (an imported line keeps its original date there)
     logDescription <- text
     logUserName <- the author's profile name; "Juan · old portal" for an imported line
                    (created_by empty, author_name set); "" for the database's own lines
     projectID <- project_id   projectName / projectNumber <- the projects(number, name) embed

   An imported line may be up to 20,000 characters: foldText() cuts it for the list and the page
   offers "more". Amounts typed into notes are masked on screen for people without prices (Q28):
   the page passes its mask function (common2 DCR2.maskAmounts) as `mask`.

   Pure module. */

import { activityAuthor } from "./legacy.js";

export const FOLD_AT = 600;          // characters shown before "more"
export const NOTE_MAX = 4000;        // activity_text_check for a person's note

export function toLogLine(row, nameOf, mask) {
  if (!row) return null;
  const pj = row.projects && !Array.isArray(row.projects) ? row.projects
    : (Array.isArray(row.projects) ? row.projects[0] : null);
  const text = String(row.text == null ? "" : row.text);
  return {
    id: row.id,
    projectID: row.project_id,
    projectName: pj ? (pj.name || "") : "",
    projectNumber: pj ? (pj.number || "") : "",
    logDate: row.created_at || null,
    logDescription: typeof mask === "function" ? mask(text) : text,
    logUserName: activityAuthor(row, nameOf),
    kind: row.kind || "note",
    imported: !row.created_by && !!row.author_name,
    createdBy: row.created_by || null,
    version: row.version == null ? 1 : Number(row.version),
  };
}

/** {short, more}: the first FOLD_AT characters (cut at a word when one is near) and whether there
    is more to show. */
export function foldText(text, at) {
  const s = String(text == null ? "" : text);
  const n = at || FOLD_AT;
  if (s.length <= n) return { short: s, more: false };
  let cut = s.lastIndexOf(" ", n);
  if (cut < n * 0.7) cut = n;
  return { short: s.slice(0, cut).replace(/\s+$/, "") + "…", more: true };
}

/** A note as the database takes it: trimmed, 1..4000 characters; "" when there is nothing. */
export function cleanNote(text) {
  const t = String(text == null ? "" : text).replace(/\r\n?/g, "\n").trim();
  return t.length > NOTE_MAX ? t.slice(0, NOTE_MAX) : t;
}

/** Log lines grouped by project in the order they come (newest group first when the lines are
    newest first): [{pid, rows}]. */
export function groupByProject(lines) {
  const groups = [], idx = {};
  (lines || []).forEach(function (l) {
    const k = String(l.projectID == null ? "?" : l.projectID);
    if (!(k in idx)) { idx[k] = groups.length; groups.push({ pid: k, rows: [] }); }
    groups[idx[k]].rows.push(l);
  });
  return groups;
}
