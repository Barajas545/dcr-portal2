/* Row writes the office lists share (leads, vehicles, marketing tasks — P5c), on the rules of _db.js:

   * insertOne(table, row, select)       one INSERT returning the new row; a refused one is 42501 (RLS), as the
                                         database says it;
   * removeVersioned(table, row)         a DELETE at the version read: an empty answer re-reads the row — still there
                                         at that version means the database refused it (42501), at another version
                                         "changed by someone else" (PT409), gone means it was already deleted (PT404);
   * savePrice(table, key, id, col, value, version)
                                         the money row of a record (one per record, keyed by the record's id): updated
                                         at its version when it was read, inserted when there is none yet (an empty row
                                         the database made meanwhile is updated at its own version; one somebody else
                                         priced meanwhile is a conflict, PT409); NULL clears the amount. -> the price row */

import { db, must, conflict, notFound, forbidden } from "./_db.js";

export async function insertOne(table, row, select) {
  const c = await db();
  const rows = must(await c.from(table).insert(row).select(select || "*")) || [];
  const r = Array.isArray(rows) ? rows[0] : rows;
  if (!r) throw forbidden();
  return r;
}

export async function removeVersioned(table, row) {
  const c = await db();
  const gone = must(await c.from(table).delete().eq("id", row.id).eq("version", row.version).select("id")) || [];
  if (gone.length) return true;
  const cur = must(await c.from(table).select("*").eq("id", row.id)) || [];
  if (!cur.length) throw notFound();
  if (Number(cur[0].version) === Number(row.version)) throw forbidden();
  throw conflict(cur[0]);
}

async function updateAt(c, table, key, id, body, version) {
  const rows = must(await c.from(table).update(body).eq(key, id).eq("version", version).select("*")) || [];
  if (rows.length) return rows[0];
  const cur = must(await c.from(table).select("*").eq(key, id)) || [];
  if (!cur.length) return null;
  if (Number(cur[0].version) === Number(version)) throw forbidden();
  throw conflict(cur[0]);
}

export async function savePrice(table, key, id, col, value, version) {
  const c = await db();
  const body = {};
  body[col] = value;
  if (version !== null && version !== undefined) {
    const r = await updateAt(c, table, key, id, body, version);
    if (r) return r;
  }
  const ins = Object.assign({}, body);
  ins[key] = id;
  const res = await c.from(table).insert(ins).select("*");
  if (res && res.error && String(res.error.code) === "23505") {
    // there is one already (made since the page read, or by the database): change it at its own version
    const cur = must(await c.from(table).select("*").eq(key, id)) || [];
    if (!cur.length) throw forbidden();
    // someone else priced it since this page read it: say so rather than write over their amount
    if (cur[0][col] !== null && cur[0][col] !== undefined && Number(cur[0][col]) !== Number(value)) throw conflict(cur[0]);
    const r = await updateAt(c, table, key, id, body, cur[0].version);
    if (r) return r;
    throw notFound();
  }
  const rows = must(res) || [];
  if (!rows.length) throw forbidden();
  return rows[0];
}
