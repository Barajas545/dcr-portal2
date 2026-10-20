/* People (profiles) for names on log lines, journal entries and "changed by …" messages.

   Only names and colours are read here, although Q29 lets every signed-in person read colleagues'
   e-mail and phone: the project pages never need them. One read per page, shared by every caller. */

import { db, must } from "./_db.js";

let cache = null;          // Promise<Map<id, {id, name, color, role, active}>>

export function clearPeople() { cache = null; }

export function listPeople() {
  if (!cache) {
    cache = (async function () {
      const c = await db();
      const rows = must(await c.from("profiles").select("id, full_name, color, role, active")) || [];
      const m = new Map();
      rows.forEach(function (r) {
        m.set(String(r.id), { id: r.id, name: (r.full_name || "").trim(), color: r.color || "", role: r.role || "", active: r.active !== false });
      });
      return m;
    })().catch(function (e) { cache = null; throw e; });
  }
  return cache;
}

/** A nameOf(uid) function over the loaded people ("" for an unknown id); never throws. */
export async function nameBook() {
  let m;
  try { m = await listPeople(); } catch (e) { m = new Map(); }
  return function nameOf(uid) {
    if (!uid) return "";
    const p = m.get(String(uid));
    return p ? p.name : "";
  };
}

export async function firstName(uid) {
  const nameOf = await nameBook();
  return (nameOf(uid).split(/\s+/)[0]) || "";
}
