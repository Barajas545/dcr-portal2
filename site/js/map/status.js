/* Project statuses: Desktop 2's nine database words <-> the old portal's spellings
   (BLUEPRINT 2.2.3). The pages keep the old portal's flows; the words people see are
   Desktop 2's clean labels ("New request", "In progress"), never "Recived" / "Aproved".

   Pure module: no DOM, no network (node tests import it). */

// Menu / lane order, as Desktop 2 lists them (dcrdesk/ui/pages/status_moves.py STATUS_ORDER).
export const STATUS_ORDER = Object.freeze([
  "new_request", "estimating", "sent", "approved", "in_progress", "on_hold",
  "completed", "follow_up", "closed",
]);

// Desktop 2's labels (dcrdesk/backend/schema.py STATUS_LABELS).
export const STATUS_LABELS = Object.freeze({
  new_request: "New request", estimating: "Estimating", sent: "Sent", approved: "Approved",
  in_progress: "In progress", on_hold: "On hold", completed: "Completed", closed: "Closed",
  follow_up: "Follow up",
});

// new -> old (the value map of BLUEPRINT 2.2.3).
export const OLD_BY_NEW = Object.freeze({
  new_request: "Recived", estimating: "Estimating", sent: "Sent", approved: "Aproved",
  in_progress: "In Progress", on_hold: "On Hold", completed: "Completed", closed: "Closed",
  follow_up: "Follow",
});

// old -> new. The old words with no equivalent follow the projects import's answer to Q9
// (tools/legacy_import/legacy_map.py): Active -> in progress, Not Started -> approved,
// blank / To Do / anything unknown -> new request.
const NEW_BY_OLD = (function () {
  const m = {};
  Object.keys(OLD_BY_NEW).forEach(function (k) { m[OLD_BY_NEW[k].toLowerCase()] = k; });
  m["active"] = "in_progress";
  m["not started"] = "approved";
  m["to do"] = "new_request";
  // the clean words and the database words map to themselves
  STATUS_ORDER.forEach(function (k) { m[k] = k; m[STATUS_LABELS[k].toLowerCase()] = k; });
  return Object.freeze(m);
})();

// Lane colours: the old Board's palette, keyed by the database word.
export const STATUS_COLORS = Object.freeze({
  on_hold: "#d9614f", estimating: "#d6a13a", new_request: "#2f80d8", sent: "#8e6fd8",
  approved: "#2fa679", in_progress: "#1f6fc8", completed: "#6b7c6f", follow_up: "#7a8595",
  closed: "#7a8595",
});

export function isStatus(s) {
  return STATUS_ORDER.indexOf(String(s || "")) !== -1;
}

/** "in_progress" -> "In progress"; nothing -> "No status"; an unknown word -> itself, readable. */
export function statusLabel(s) {
  const k = String(s || "").trim();
  if (!k) return "No status";
  if (STATUS_LABELS[k]) return STATUS_LABELS[k];
  const t = k.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Database word -> the old portal's spelling ("approved" -> "Aproved"). */
export function toOldStatus(s) {
  return OLD_BY_NEW[String(s || "")] || "";
}

/** The old portal's spelling (or a clean label, or a database word) -> the database word. */
export function toNewStatus(old) {
  const k = String(old == null ? "" : old).trim().toLowerCase();
  if (!k) return "new_request";
  return NEW_BY_OLD[k] || "new_request";
}

export function statusColor(s) {
  return STATUS_COLORS[String(s || "")] || "#7a8595";
}
