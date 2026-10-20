/* rpc search(q) -> the old search page's groups (BLUEPRINT Appendix A "search").

   The database answers {projects, contacts, items, tasks, files} (at most 20 each, through the
   caller's own RLS: receipts and tasks a field account may not see never come back). The old
   page drew {groups: [{label, total, more, items: [{title, sub, href, thumbId, email, phone}]}]}.

   Pure module. */

import { statusLabel } from "./status.js";
import { folderLabel } from "./files.js";

export const LIMIT = 20;

function join(parts, sep) { return parts.filter(function (x) { return x != null && String(x).trim() !== ""; }).join(sep || " · "); }

export function toGroups(res, opts) {
  res = res || {};
  opts = opts || {};
  const numberOf = opts.numberOf || function () { return ""; };
  // names people typed (files, tasks) may quote an amount: masked for people without prices (Q28)
  const mask = typeof opts.mask === "function" ? opts.mask : function (t) { return t; };
  const groups = [];
  function add(label, key, rows, mapper) {
    rows = Array.isArray(rows) ? rows : [];
    if (!rows.length) return;
    groups.push({ label: label, key: key, total: rows.length, more: rows.length >= LIMIT, items: rows.map(mapper) });
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
  add("Estimate items", "items", res.items, function (i) {
    return {
      title: i.name || "(no name)",
      sub: join([i.project_number, i.group_name]),
      href: "project.html?id=" + encodeURIComponent(i.project_id),
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
