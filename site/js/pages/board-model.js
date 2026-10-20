/* The Board's rules over mapped projects (map/projects.js toProject) — no DOM here.

   Views (?view=main|sales|marketing|accounting) keep the old Board's lane lists, mapped to
   Desktop 2's statuses (BLUEPRINT 3.3.1):
     main        On hold, New request, Estimating, Sent (newest first), Approved, In progress,
                 Completed (last 2 months)
     sales       Estimating, Sent (newest change first), Approved, In progress, Completed (24 months)
     marketing   Approved, In progress, Completed (5 months)
     accounting  Approved, In progress, Completed (2 months)
   "Completed in the last N months" counts from completed_date (else the last change).

   The old portal's projects nobody has changed yet (map/legacy.js dormant: imported, version 1)
   are no live work — Desktop 2's choice: they come after the own projects in every lane and the
   "Old portal" chip folds them away (off at first). `keep` holds ids that never count as old (a
   card being moved: the move makes it an ordinary project).

   The filter: every word must appear in the number, name, address, city, client, status, status
   note or tags. */

import { STATUS_LABELS, statusColor } from "../map/status.js";
import { numberSortKey } from "../map/projects.js";
import { monthsBefore } from "../map/pacific.js";

function lane(status, opts) {
  const c = { key: status, status: status, label: STATUS_LABELS[status], acc: statusColor(status) };
  if (opts) Object.keys(opts).forEach(function (k) { c[k] = opts[k]; });
  return c;
}

export const VIEWS = Object.freeze({
  main: { label: "Main Board", cols: [lane("on_hold"), lane("new_request"), lane("estimating"),
    lane("sent", { desc: true }), lane("approved"), lane("in_progress"), lane("completed", { months: 2, desc: true, sortField: "completed" })] },
  sales: { label: "Sales", cols: [lane("estimating"), lane("sent", { desc: true, sortField: "projectDateLastModified" }),
    lane("approved"), lane("in_progress"), lane("completed", { months: 24, desc: true, sortField: "completed" })] },
  marketing: { label: "Marketing", cols: [lane("approved"), lane("in_progress"),
    lane("completed", { months: 5, desc: true, sortField: "completed" })] },
  accounting: { label: "Accounting", cols: [lane("approved"), lane("in_progress"),
    lane("completed", { months: 2, desc: true, sortField: "completed" })] },
});

export function viewOf(name) { return VIEWS[name] ? name : "main"; }

function day(v) { return v ? String(v).slice(0, 10) : ""; }

/** The day a completed project counts from: completed_date, else its last change. */
export function completionDay(p) {
  return day(p.projectCompletedDate) || day(p.projectDateLastModified) || day(p.projectDate);
}

function sortValue(p, field) {
  if (field === "completed") return completionDay(p);
  return String(p[field || "projectDate"] || p.projectDate || "");
}

export function searchText(p, mask) {
  const m = typeof mask === "function" ? mask : function (x) { return x; };
  return [p.internalIDNumber, p.projectName, p.projectAddress, p.projectCity, p.projectZip, p.projectClientName,
    p.statusLabel, m(p.estimateStatusDescription || "")].concat(p.checkTagNames || [])
    .filter(Boolean).join(" \u0000 ").toLowerCase();
}

export function matches(p, query, mask) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = searchText(p, mask);
  return words.every(function (w) { return hay.indexOf(w) !== -1; });
}

export function isOld(p, keep) {
  return !!(p && p.dormant) && !(keep && keep.has && keep.has(String(p.id)));
}

/** One lane: {rows, oldCount, oldHidden, hiddenCompleted}. */
export function columnProjects(projects, col, opts) {
  opts = opts || {};
  const keep = opts.keep || new Set();
  const cutoff = col.months ? monthsBefore(opts.today, col.months) : null;
  let oldCount = 0, oldHidden = 0, hiddenCompleted = 0;
  const own = [], old = [];
  (projects || []).forEach(function (p) {
    if (!p || p.deletedAt || p.status !== col.status) return;
    if (!matches(p, opts.search, opts.mask)) return;
    if (cutoff) {
      const d = col.sortField === "completed" ? completionDay(p) : day(p[col.sortField] || p.projectDate);
      if (!d || d < cutoff) { hiddenCompleted++; return; }
    }
    if (isOld(p, keep)) {
      oldCount++;
      if (!opts.showOld) { oldHidden++; return; }
      old.push(p);
    } else own.push(p);
  });
  function cmp(a, b) {
    const va = sortValue(a, col.sortField), vb = sortValue(b, col.sortField);
    let r = va < vb ? -1 : va > vb ? 1 : 0;
    if (col.desc) r = -r;
    if (r) return r;
    const na = numberSortKey(a.internalIDNumber), nb = numberSortKey(b.internalIDNumber);
    return na < nb ? -1 : na > nb ? 1 : 0;
  }
  own.sort(cmp); old.sort(cmp);
  return { rows: own.concat(old), oldCount: oldCount, oldHidden: oldHidden, hiddenCompleted: hiddenCompleted };
}

/** The whole view: {columns: [{col, rows, ...}], shown, oldCount, oldHidden, other}. `other`
    counts projects (matching the filter) whose status has no lane in this view. */
export function buildBoard(projects, viewName, opts) {
  opts = opts || {};
  const view = VIEWS[viewOf(viewName)];
  const lanes = {};
  view.cols.forEach(function (c) { lanes[c.status] = true; });
  let shown = 0, oldCount = 0, oldHidden = 0, other = 0;
  const columns = view.cols.map(function (col) {
    const r = columnProjects(projects, col, opts);
    shown += r.rows.length; oldCount += r.oldCount; oldHidden += r.oldHidden;
    return { col: col, rows: r.rows, oldCount: r.oldCount, oldHidden: r.oldHidden, hiddenCompleted: r.hiddenCompleted };
  });
  (projects || []).forEach(function (p) {
    if (p && !p.deletedAt && !lanes[p.status] && matches(p, opts.search, opts.mask)) other++;
  });
  return { columns: columns, shown: shown, oldCount: oldCount, oldHidden: oldHidden, other: other };
}

/** The summary under the toolbar: "41 projects on the board · 12 from the old portal · 6 in other statuses". */
export function summaryText(b, filtering) {
  const parts = [];
  parts.push(filtering ? (b.shown ? b.shown + " project" + (b.shown === 1 ? "" : "s") + " match"
    : "No projects match the filter") : b.shown + " project" + (b.shown === 1 ? "" : "s") + " on the board");
  if (b.oldHidden) parts.push(b.oldHidden + " from the old portal");
  if (b.other) parts.push(b.other + " in other statuses");
  return parts.join(" · ");
}

/** Merge a live row into the list: a row read before a live change never steps back over it
    (versions decide). Returns the new list. */
export function mergeRow(list, row) {
  if (!row || row.id == null) return list;
  const i = list.findIndex(function (p) { return String(p.id) === String(row.id); });
  if (row.deletedAt) return i === -1 ? list : list.slice(0, i).concat(list.slice(i + 1));
  if (i === -1) return list.concat([row]);
  if (Number(list[i].version || 0) > Number(row.version || 0)) return list;
  const out = list.slice();
  out[i] = row;
  return out;
}

export function removeRow(list, id) {
  return list.filter(function (p) { return String(p.id) !== String(id); });
}
