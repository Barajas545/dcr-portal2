/* rpc search(q) -> the old search page's groups (BLUEPRINT Appendix A "search").

   The database answers {projects, contacts, items, tasks, files} (at most 20 each, through the
   caller's own RLS: receipts and tasks a field account may not see never come back). The old
   page drew {groups: [{label, total, more, items: [{title, sub, href, thumbId, email, phone}]}]}.

   Pure module. */

import { statusLabel } from "./status.js";
import { folderLabel } from "./files.js";
import { scrubMoney } from "../scrub-money.js";

export const LIMIT = 20;

// the words of a hit the page shows, masked (below); the database matched these and unseen ones too (an item's
// description and material, a task's description and category), as typed
const SHOWN = { items: ["name", "group_name"], tasks: ["title"], files: ["name"] };

function join(parts, sep) { return parts.filter(function (x) { return x != null && String(x).trim() !== ""; }).join(sep || " · "); }

/** opts: {numberOf, mask, prices, q}; prices false: an item, task or file is kept when q (as the database reads it:
    trimmed, any case) is in what this person is shown of it - "12,000" never keeps "Rail $12,000", shown "Rail
    (amount hidden)", so watching which hits stay can't spell an amount out (DCR Desktop 2's global search) - or when
    the database found it through words the page doesn't show (an item's material, a task's description: q is in
    none of its shown words as typed) and q has no digit, which every amount has. An item's name and group show by
    the database's no-price rule (scrubMoney over the mask: app.priceless_text, as the Estimate tab - "400 dollars",
    "Deposit 1,200" too). */
export function toGroups(res, opts) {
  res = res || {};
  opts = opts || {};
  const numberOf = opts.numberOf || function () { return ""; };
  // names people typed (files, tasks) may quote an amount: masked for people without prices (Q28)
  const mask = typeof opts.mask === "function" ? opts.mask : function (t) { return t; };
  // an item's name and group without prices: the database's own no-price words (the Estimate tab's estimate_print)
  const itemMask = opts.prices === false ? function (t) { return scrubMoney(mask(t)); } : mask;
  const needle = opts.prices === false ? String(opts.q == null ? "" : opts.q).trim().slice(0, 100).toLowerCase() : "";
  function shown(key, r) {
    if (!needle || !SHOWN[key]) return true;
    const m = key === "items" ? itemMask : mask;
    const has = function (t) { return String(t).toLowerCase().indexOf(needle) !== -1; };
    const field = function (f) { return r && r[f] != null ? String(r[f]) : ""; };
    if (SHOWN[key].some(function (f) { return has(m(field(f))); })) return true;
    return !/\p{Nd}/u.test(needle) && !SHOWN[key].some(function (f) { return has(field(f)); });
  }
  const groups = [];
  function add(label, key, rows, mapper) {
    rows = Array.isArray(rows) ? rows : [];
    const more = rows.length >= LIMIT;           // the database's own limit, before the hits this person can't find
    rows = rows.filter(function (r) { return shown(key, r); });
    if (!rows.length) return;
    groups.push({ label: label, key: key, total: rows.length, more: more, items: rows.map(mapper) });
  }
  add("Projects", "projects", res.projects, function (p) {
    return {
      title: join([p.number, p.name], " — "),
      sub: join([p.address, p.city, p.client_name, statusLabel(p.status)]),
      href: "project.html?id=" + encodeURIComponent(p.id),
      thumbId: p.id, projectId: p.id,
    };
  });
  add("Contacts", "contacts", res.contacts, function (c) {
    const trades = Array.isArray(c.trades) ? c.trades.map(function (t) { return t && t.name; }).filter(Boolean) : [];
    return {
      title: c.name || c.company || "(no name)",
      sub: join([c.company && c.company !== c.name ? c.company : "", trades.length ? trades.join(", ") : c.trade, c.city]),
      email: c.email || "", phone: c.phone || "",
    };
  });
  // P5a (acceptance check 1): an item's name and group are typed words too, masked the same way; the hit opens
  // the project's read-only Estimate tab
  add("Estimate items", "items", res.items, function (i) {
    return {
      title: i.name ? itemMask(i.name) : "(no name)",
      sub: join([i.project_number, i.group_name ? itemMask(i.group_name) : ""]),
      href: "project.html?id=" + encodeURIComponent(i.project_id) + "&tab=estimate",
    };
  });
  add("Tasks", "tasks", res.tasks, function (t) {
    return {
      title: t.title ? mask(t.title) : "(no title)",
      sub: join([numberOf(t.project_id), t.status === "done" ? "Done" : "Open", t.due_date ? "due " + t.due_date : ""]),
      // P3: an open task opens on My Tasks (its updates, a box for one); a done one on its project's Tasks tab
      href: t.status !== "done" && t.id != null ? "my-tasks.html?task=" + encodeURIComponent(t.id)
        : t.project_id != null ? "project.html?id=" + encodeURIComponent(t.project_id) + "&tab=tasks" : "",
    };
  });
  add("Files", "files", res.files, function (f) {
    return {
      title: f.name ? mask(f.name) : "(no name)",
      sub: join([numberOf(f.project_id), folderLabel(f.folder), f.version_no > 1 ? "v" + f.version_no : ""]),
      href: "project.html?id=" + encodeURIComponent(f.project_id) + "&tab=files",
    };
  });
  return groups;
}
