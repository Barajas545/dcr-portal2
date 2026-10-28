/* Global search (rpc search; BLUEPRINT Appendix A "search") and the Mailing tab's contact search.

   * search(q, opts)      -> the old page's groups (map/search.js); tasks and files carry their
                             project's number when the page has the projects list; opts.prices false:
                             only the hits whose shown (masked) words hold q;
   * searchContacts(q)    -> contacts (the same RPC: names, companies, trades, e-mail, phone digits). */

import { db, must } from "./_db.js";
import { toGroups } from "../map/search.js";

export async function raw(q) {
  const t = String(q || "").trim();
  if (t.length < 2) return { projects: [], contacts: [], items: [], tasks: [], files: [] };
  const c = await db();
  const res = must(await c.rpc("search", { q: t }));
  return res || {};
}

export async function search(q, opts) {
  const res = await raw(q);
  return toGroups(res, Object.assign({ q: String(q || "").trim() }, opts));
}

export async function searchContacts(q) {
  const res = await raw(q);
  return Array.isArray(res.contacts) ? res.contacts : [];
}
