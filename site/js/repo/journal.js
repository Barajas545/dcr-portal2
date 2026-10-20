/* The project journal (journal_entries; BLUEPRINT 3.3.3, Appendix A "project part=journal, jrn*").

   * list(projectId)          entries newest day first, each with its media (files rows in the
                              journal folder) and the author's name;
   * create(projectId, d)     a new entry from the phone's draft (map/journal fromDraft); the
                              database writes "Journal entry: <title>" to the log;
   * update(entry, d)         versioned (the author — field writes their own, Q4 — or lead,
                              manager, admin: RLS decides);
   * remove(entry)            rpc soft_delete('journal_entries', id, version); photos stay as files.

   An entry row is created as soon as it is worth keeping and before any media is queued, so a
   queued photo always has its journal_entry_id (BLUEPRINT 3.3.3 "Offline order"). */

import { db, must, versioned, idOf } from "./_db.js";
import { toEntry, fromDraft } from "../map/journal.js";
import { journalMedia } from "./files.js";
import { nameBook } from "./people.js";

export async function list(projectId) {
  const c = await db();
  const [rows, files, nameOf] = await Promise.all([
    c.from("journal_entries").select("*").eq("project_id", idOf(projectId))
      .order("entry_date", { ascending: false }).order("id", { ascending: false }).then(must),
    journalMedia(projectId).catch(function () { return []; }),
    nameBook(),
  ]);
  return (rows || []).filter(function (r) { return !r.deleted_at; }).map(function (r) { return toEntry(r, nameOf, files); });
}

export async function create(projectId, draft) {
  const c = await db();
  const body = Object.assign({ project_id: idOf(projectId) }, fromDraft(draft));
  const rows = must(await c.from("journal_entries").insert(body).select("*")) || [];
  if (!rows.length) throw new Error("The journal entry was not saved.");
  const nameOf = await nameBook();
  return toEntry(rows[0], nameOf, []);
}

export async function update(entry, draft) {
  const row = await versioned("journal_entries", idOf(entry.id), entry.version, fromDraft(draft));
  const nameOf = await nameBook();
  return toEntry(row, nameOf, []);
}

/* The drafts of this device (pages/journal-sync.js) work on the row's own columns: they send only
   what this device changed and compare the rest with what came back. */

/** Insert a new entry from journal_entries columns -> the row as the database has it. */
export async function createRow(projectId, cols) {
  const c = await db();
  const rows = must(await c.from("journal_entries").insert(Object.assign({ project_id: idOf(projectId) }, cols)).select("*")) || [];
  if (!rows.length) throw new Error("The journal entry was not saved.");
  return rows[0];
}

/** A versioned PATCH of only these columns -> the row; PT409 (err.current = the row now), PT404, 42501. */
export async function patchRow(id, version, cols) {
  return versioned("journal_entries", idOf(id), version, cols);
}

export async function remove(entry) {
  const c = await db();
  must(await c.rpc("soft_delete", { tbl: "journal_entries", id: idOf(entry.id), version: entry.version }));
}
