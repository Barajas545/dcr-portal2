/* The one supabase client, for the repository modules.

   In the browser it is sb() from ../sb.js (in demo mode the dev server's fake stands behind it).
   Node tests never load sb.js: they hand a stub client to useClient() first.

   Shared helpers keep every repo module on the same rules (BLUEPRINT 2.1 principle 7, 2.2.3):
   * must(res)           throws the PostgREST error ({code, message, details}) or returns data;
   * versioned(...)      a versioned PATCH: .eq('version', v); an empty answer re-reads the row —
                         still there means "changed by someone else" (code PT409, err.current = the
                         row now), otherwise "not found" (PT404);
   * pageAll(build)      reads 1,000 rows at a time with .range() until a short page. */

let override = null;

export function useClient(c) { override = c || null; }

/** A row id as the database's bigint: "278" -> 278 (ids travel through URLs and data- attributes
    as text); anything else is passed on as it is. */
export function idOf(v) {
  return typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : v;
}

export async function db() {
  if (override) return override;
  const m = await import("../sb.js");
  return m.sb();
}

export function must(res) {
  if (!res) throw Object.assign(new Error("No answer from the database."), { code: "NETWORK" });
  if (res.error) {
    const e = res.error;
    const err = new Error(e.message || "The database refused the request.");
    err.code = e.code || ""; err.details = e.details || ""; err.hint = e.hint || "";
    err.status = e.status || res.status || 0;
    throw err;
  }
  return res.data;
}

export function conflict(current) {
  const e = new Error("Changed by someone else.");
  e.code = "PT409"; e.status = 409; e.current = current || null;
  return e;
}

export function notFound(what) {
  const e = new Error((what || "That record") + " was not found — it may have been deleted.");
  e.code = "PT404"; e.status = 404;
  return e;
}

/** Update `patch` on table.id = id at `version`; returns the updated row (with `select`). */
export async function versioned(table, id, version, patch, select) {
  const c = await db();
  const sel = select || "*";
  const rows = must(await c.from(table).update(patch).eq("id", id).eq("version", version).select(sel));
  if (rows && rows.length) return rows[0];
  const cur = must(await c.from(table).select(sel).eq("id", id));
  if (cur && cur.length) {
    // still at the version sent: nothing changed it, so row level security refused the write
    if (version != null && cur[0].version != null && Number(cur[0].version) === Number(version)) throw forbidden();
    throw conflict(cur[0]);
  }
  throw notFound();
}

export function forbidden() {
  const e = new Error("You don't have permission to change this.");
  e.code = "42501"; e.status = 403;
  return e;
}

export const PAGE = 1000;

/** build(client) -> a query builder (without .range); every page read until a short one. */
export async function pageAll(build, max) {
  const c = await db();
  const out = [];
  const cap = max || 20000;
  for (let from = 0; from < cap; from += PAGE) {
    const rows = must(await build(c).range(from, from + PAGE - 1)) || [];
    for (let i = 0; i < rows.length; i++) out.push(rows[i]);
    if (rows.length < PAGE) break;
  }
  return out;
}

export function isConflict(e) { return !!e && (e.code === "PT409" || e.status === 409); }
export function isNotFound(e) { return !!e && (e.code === "PT404" || e.status === 404); }
