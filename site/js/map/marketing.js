/* Marketing tasks (billable): Desktop 2 rows (M5c `marketing_tasks` + `marketing_task_prices`) <-> the shapes the old
   marketing page consumes (BLUEPRINT 3.3.11 "Marketing tasks", Q17, Appendix A "mtasks", MODULES §5 "marketing.html").

     marketingTaskName <- name        marketingTaskCaterogy <- category (the old list's own spelling, kept as the key)
     marketingTaskDescripiton <- description   marketingTaskDate <- task_date   marketingTaskCompletedDate <- completed_date
     marketingTaskCompletedWork <- completed_work   marketingTaskMarkComplete <- done   marketingTaskCheckInvoiced <- invoiced
     marketingTaskCheckPaid <- paid   projectID <- project_id
     marketingTaskPrice <- prices.price (the financials switch: null = hidden; the embed is not even asked for without it)

   Q17: the price is money, so it lives in its own table under the financials switch. In the old portal the view-only
   accounts and the managers saw it; in Portal 2 nobody without financials does — not in the table, not in the totals,
   not in the page's HTML. Done / invoiced / paid are yes-or-no marks, not amounts, and stay readable.
   Who: read admin, manager, accountant, view-only; write admin, manager (app.can_edit('marketing')); a price needs
   financials too. UI only — the database decides. Pure module (node tests import it). */

export const TASK_COLS = Object.freeze({
  marketingTaskName: "name", marketingTaskCaterogy: "category", marketingTaskDescripiton: "description",
  marketingTaskDate: "task_date", marketingTaskCompletedDate: "completed_date", marketingTaskCompletedWork: "completed_work",
  marketingTaskMarkComplete: "done", marketingTaskCheckInvoiced: "invoiced", marketingTaskCheckPaid: "paid", projectID: "project_id",
});
export const PRICE_TABLE = "marketing_task_prices";
export const PRICE_KEY = "task_id";
export const PRICE_COL = "price";
export const FLAGS = Object.freeze(["marketingTaskMarkComplete", "marketingTaskCheckInvoiced", "marketingTaskCheckPaid"]);
export const READERS = Object.freeze(["admin", "manager", "accountant", "viewer"]);
export const WRITERS = Object.freeze(["admin", "manager"]);

const active = (me) => !!me && me.active !== false && !!me.role;
export function readsMarketing(me) { return active(me) && READERS.indexOf(me.role) !== -1; }
export function writesMarketing(me) { return active(me) && WRITERS.indexOf(me.role) !== -1; }
export function seesPrice(me) { return active(me) && me.role !== "agents" && (me.role === "admin" || !!me.can_see_financials); }

function txt(v) { return v === null || v === undefined ? "" : String(v); }
function day(v) { const s = txt(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; }
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** A marketing_tasks row (with its prices embed, or without) -> the old shape. prices: undefined = not asked,
    null = hidden or none written. */
export function toTask(row) {
  if (!row) return null;
  const t = { id: row.id, version: row.version, legacySpId: row.legacy_sp_id === undefined ? null : row.legacy_sp_id };
  t.marketingTaskName = txt(row.name);
  t.marketingTaskCaterogy = txt(row.category);
  t.marketingTaskDescripiton = txt(row.description);
  t.marketingTaskDate = day(row.task_date);
  t.marketingTaskCompletedDate = day(row.completed_date);
  t.marketingTaskCompletedWork = txt(row.completed_work);
  t.marketingTaskMarkComplete = row.done === true;
  t.marketingTaskCheckInvoiced = row.invoiced === true;
  t.marketingTaskCheckPaid = row.paid === true;
  t.projectID = row.project_id === null || row.project_id === undefined ? null : row.project_id;
  const pr = Array.isArray(row.prices) ? row.prices[0] || null : row.prices;
  t.prices = pr === undefined ? undefined : pr || null;
  t.marketingTaskPrice = pr ? num(pr[PRICE_COL]) : null;
  t.priceVersion = pr && pr.version !== undefined ? pr.version : null;
  return t;
}

/** {oldKey: value} -> a marketing_tasks patch: text trimmed ("" -> NULL), the date a company day, the marks true/false,
    the project an id or NULL. The price is NOT here (its own table). */
export function toTaskRow(fields) {
  const out = {};
  Object.keys(fields || {}).forEach(function (k) {
    const col = TASK_COLS[k];
    if (!col) return;
    const v = fields[k];
    if (FLAGS.indexOf(k) !== -1) { out[col] = v === true || v === "true"; return; }
    if (k === "marketingTaskDate") { const d = day(v); if (d) out[col] = d; return; }   // an empty box keeps it (an unknown date stays unknown)
    if (k === "marketingTaskCompletedDate") { out[col] = day(v) || null; return; }
    if (k === "projectID") { const n = num(v); out[col] = n === null ? null : n; return; }
    const s = k === "marketingTaskDescripiton" || k === "marketingTaskCompletedWork" ? txt(v).replace(/\s+$/, "") : txt(v).replace(/\s+/g, " ").trim();
    out[col] = s.trim() ? s : null;
  });
  return out;
}

/** A mark flipped: the patch. Done stamps the completed day itself — the database's company day, once — and undone
    clears it (M5c's marketing_tasks trigger; the old server stamped the UTC day), so the page sends the mark only. */
export function togglePatch(task, key) {
  if (FLAGS.indexOf(key) === -1) throw Object.assign(new Error("That is not one of the marks."), { code: "22023" });
  const patch = {};
  patch[TASK_COLS[key]] = !(task && task[key] === true);
  return patch;
}

/** A price typed into the form: "" -> null; "$1,250" -> 1250; throws {code: "22023"} for anything else. */
export function parsePrice(v) {
  const s = txt(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 1e7) throw Object.assign(new Error("The price must be an amount of dollars."), { code: "22023", field: "marketingTaskPrice" });
  return Math.round(n * 100) / 100;
}

export function checkTask(fields) {
  if (!txt(fields && fields.marketingTaskName).trim()) return "Task name is required.";
  if (txt(fields && fields.marketingTaskName).trim().length > 200) return "The task name is limited to 200 characters.";
  return "";
}

export const FILTERS = Object.freeze([
  ["open", "Open"], ["completed", "Completed"], ["uninvoiced", "Not invoiced"], ["unpaid", "Not paid"], ["all", "All"],
]);

/** The old filter chips. */
export function passes(t, filter) {
  const done = !!t.marketingTaskMarkComplete, inv = !!t.marketingTaskCheckInvoiced, paid = !!t.marketingTaskCheckPaid;
  switch (filter) {
    case "open": return !done;
    case "completed": return done;
    case "uninvoiced": return done && !inv;
    case "unpaid": return inv && !paid;
    default: return true;
  }
}

/** The totals line over ALL tasks (not the filter): open, done not invoiced, invoiced not paid, paid. Only for a person
    who sees prices (the page never draws it otherwise); a task without a price adds nothing. */
export function totals(tasks) {
  const t = { open: 0, uninv: 0, unpaid: 0, paid: 0, priced: 0, unpriced: 0 };
  (tasks || []).forEach(function (x) {
    const p = x.marketingTaskPrice;
    if (p === null || p === undefined) { t.unpriced++; return; }
    t.priced++;
    if (!x.marketingTaskMarkComplete) t.open += p;
    else if (!x.marketingTaskCheckInvoiced) t.uninv += p;
    else if (!x.marketingTaskCheckPaid) t.unpaid += p;
    else t.paid += p;
  });
  ["open", "uninv", "unpaid", "paid"].forEach(function (k) { t[k] = Math.round(t[k] * 100) / 100; });
  return t;
}

/** The project's group label: "A267 — Sandbox job", "General / no project", or "Project 12" when it is not readable. */
export function projectLabel(pid, byId) {
  if (pid === null || pid === undefined || pid === "") return GENERAL;
  const p = byId && byId[String(pid)];
  return p ? (txt(p.internalIDNumber) + " — " + txt(p.projectName)) : "Project " + pid;
}
export const GENERAL = "General / no project";

/** The table: the filter, the words typed, grouped by project (General last), each group's newest task first.
    opts.mask: the page's mask - the task's words are searched as shown, so watching which tasks stay can't spell out
    an amount hidden from a person without prices. */
export function groups(tasks, opts) {
  const o = opts || {};
  const mask = typeof o.mask === "function" ? o.mask : txt;
  const words = txt(o.q).toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (tasks || []).filter(function (x) {
    if (!passes(x, o.filter || "open")) return false;
    if (!words.length) return true;
    const hay = [x.marketingTaskName, x.marketingTaskCaterogy, x.marketingTaskDescripiton, x.marketingTaskCompletedWork]
      .map(function (t) { return txt(mask(txt(t))); }).concat([projectLabel(x.projectID, o.byId)]).join(" ").toLowerCase();
    return words.every(function (w) { return hay.indexOf(w) !== -1; });
  });
  const by = {};
  rows.forEach(function (x) { const g = projectLabel(x.projectID, o.byId); (by[g] = by[g] || []).push(x); });
  return Object.keys(by).sort(function (a, b) {
    if (a === GENERAL) return 1;
    if (b === GENERAL) return -1;
    return a.localeCompare(b, "en", { numeric: true });
  }).map(function (g) {
    return {
      label: g, pid: by[g][0].projectID,
      rows: by[g].sort(function (a, b) { return (b.marketingTaskDate || "").localeCompare(a.marketingTaskDate || "") || Number(b.id) - Number(a.id); }),
    };
  });
}

/** The project box's text -> a project id: "A267 — Sandbox job" or just "A267" (any case); "" -> null; else undefined
    (not a project: the form says so). */
export function resolveProject(text, projects) {
  const v = txt(text).replace(/\s+/g, " ").trim().toLowerCase();
  if (!v) return null;
  const hit = (projects || []).find(function (p) {
    return (txt(p.internalIDNumber) + " — " + txt(p.projectName)).toLowerCase() === v || txt(p.internalIDNumber).toLowerCase() === v;
  });
  return hit ? hit.id : undefined;
}

export function fmtMoney(n) {
  return "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The dashboard card's line: open tasks, and the ones done but not invoiced yet (counts only, never an amount). */
export function marketingSummary(tasks) {
  const open = (tasks || []).filter(function (t) { return !t.marketingTaskMarkComplete; }).length;
  const uninvoiced = (tasks || []).filter(function (t) { return t.marketingTaskMarkComplete && !t.marketingTaskCheckInvoiced; }).length;
  return { open, uninvoiced };
}
