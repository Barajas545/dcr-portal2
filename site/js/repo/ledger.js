/* The expense ledger's data (BLUEPRINT 3.3.11 "Expenses and Receipts (ledger)", "Printed expense report";
   Appendix A "ledger": costs plus tag_costs and reconcile_costs; receipts through files.cost_id). Replaces the
   old ?action=ledger aggregation and its separate receipt folder walk: every read is a plain select under row
   level security, so a person without the financials switch is answered no cost row at all (costs RLS:
   app.can_financials()) — and the pages do not even ask (map/ledger.js seesLedger).

   Reads
   * loadLedger(opts)                every cost the person may read, as ledger rows (map/ledger.js toLedgerRow),
                                     with their projects, estimate lines, employees (names only), receipts
                                     (files.cost_id, M5b: live, newest version) and the people who tagged /
                                     reconciled them;
                                     plus the live invoices (billed out: shown greyed, never added to a cost);
                                     opts.prices false: the lines' words amount-free (map/ledger.js lineLabel);
   * hoursBetween(from, to)          timesheet hours by employee for the side block (never turned into money);
   * projectExpenses(pid, opts)      one project's costs as ledger rows (the project's Expenses tab, the
                                     printed expense report); opts.prices as loadLedger's;
   * projectPayments(projectId)      one project's bills with their payments, and its invoices with their lines
                                     and client payments (the project's Payments tab);
   * receiptUrl(file, seconds)       a signed URL for one receipt (120 s for a document, BLUEPRINT 2.2.5).
   Writes (M5b RPCs — app.can_edit('money'): an admin, or a manager or accountant with financials; the
   database refuses anyone else, and never writes an amount into the activity log)
   * tagCosts(ids, card)             rpc tag_costs(p_ids, p_card): "Paid with" for up to 1,000 rows; card one of
                                     the 8 ids (map/ledger.js CARDS; "untagged" takes the tag off); the database
                                     stamps card_by / card_at, and clears the reconciled mark of a row whose card
                                     changed (a different card is not what was reconciled);
   * reconcileCosts(ids, on)         rpc reconcile_costs(p_ids, p_on): reconciled (by, at) set or cleared;
   * confirmEmployee(ids, empId)     rpc confirm_cost_employee(p_ids, p_employee_id): the employee stored as
                                     confirmed (NULL: nobody) — the database's inferred guess becomes a fact.
   M5b answers {changed: [ids], unchanged: [ids], refused: [{id, reason}], …}; outcome() reads it as
   {changed: n, unchanged: n, refused} (refused rows are said, never dropped).
   Adding and correcting a cost (the project's Expenses tab, owner decision 2026-10-24 D13; DCR Desktop 2's CostDialog
   does the same plain writes: MoneyRepo.add_cost / update_cost) — costs RLS and t01_money_writer refuse anyone but
   a money editor (42501), t10_costs works out a labour amount, t12_costs_ledger stamps "Paid with" and infers the
   employee; only the columns of COST_WRITE are ever sent (never card_by / card_at, reconciled_*, employee_*: the
   database refuses them from a person). Costs have NO delete here: a wrong one is corrected, or a negative credit
   added.
   * getCost(id)                     the raw row (COST_COLS: the words as typed, never the ledger's tidied ones);
   * addCost(fields)                 one INSERT (once: no retry) -> the row;
   * updateCost(row, patch)          a versioned PATCH of the changed columns (not project_id) -> the row; PT409 with
                                     err.current = the row now;
   * lineChoices(pid, keep, prices)  [{id, label}] the live estimate lines a cost can be booked to (map/ledger.js
                                     lineLabel: "CO #2 · Walls — Exterior walls"; prices false: amount-free),
                                     archived estimates left out — but the cost's own line (keep: the cost
                                     being corrected is booked to it) is always kept, marked "(archived
                                     estimate)" or "(removed)", so an edit shows the line it has.

   The RPC names and arguments live in RPC below and nowhere else. */

import { db, must, idOf, pageAll, versioned } from "./_db.js";
import { insertOne } from "./_rows.js";
import { loadProjects } from "./projects.js";
import { nameBook } from "./people.js";
import { signedUrl } from "./files.js";
import { toLedgerRow, CARDS, hoursByEmployee, lineLabel } from "../map/ledger.js";

export const COST_COLS = "id, project_id, estimate_item_id, cost_date, kind, description, vendor, amount, hours, rate, " +
  "card, card_by, card_at, reconciled_by, reconciled_at, employee_id, employee_source, version";
export const RECEIPT_COLS = "id, project_id, cost_id, previous_id, folder, name, storage, storage_path, preview_path, mime, size, created_at, deleted_at";
export const BILL_COLS = "id, project_id, estimate_item_id, kind, vendor_name, invoice_number, invoice_date, due_date, amount, description, " +
  "document_file_id, void, approved_at, approved_amount, pay_method, deleted_at, version, " +
  "payments(id, bill_id, paid_date, amount, method, check_number, reference, payee, memo, pickup_told_at, pickup_told_by, pickup_told_how)";
export const INVOICE_COLS = "id, project_id, number, invoice_date, due_date, description, status, sent_date, deleted_at, " +
  "invoice_lines(amount), client_payments(id, paid_date, amount, method, reference)";
export const EMPLOYEE_COLS = "id, full_name, active";

/** The M5b ledger RPCs, by name and argument (one place to keep in step with the migration). */
export const RPC = Object.freeze({
  tag: { name: "tag_costs", args: (ids, card) => ({ p_ids: ids, p_card: card }) },
  reconcile: { name: "reconcile_costs", args: (ids, on) => ({ p_ids: ids, p_on: !!on }) },
  confirm: { name: "confirm_cost_employee", args: (ids, employeeId) => ({ p_ids: ids, p_employee_id: employeeId }) },
});
/** M5b's app.books_ids: at most 1,000 ids a call. */
export const MAX_IDS = 1000;
const IDS_PER_READ = 150;

/** rows of `table` whose `col` is one of `ids`, 150 ids a read (a URL stays short) */
async function byIds(c, table, cols, col, ids) {
  const list = Array.from(new Set((ids || []).filter((v) => v !== null && v !== undefined).map(idOf)));
  const out = [];
  for (let i = 0; i < list.length; i += IDS_PER_READ) {
    (must(await c.from(table).select(cols).in(col, list.slice(i, i + IDS_PER_READ))) || []).forEach((r) => out.push(r));
  }
  return out;
}
/* The receipts of the costs `ids` (files.cost_id, M5b): the live rows of `files` itself rather than the
   current_files view, so a receipt link reads the same whether or not that view was re-made with the new
   column; a row a newer version of the same file replaced (its id is another row's previous_id) is dropped,
   as current_files drops it. */
async function receiptsOf(c, ids) {
  const list = Array.from(new Set((ids || []).filter((v) => v !== null && v !== undefined).map(idOf)));
  const out = [];
  for (let i = 0; i < list.length; i += IDS_PER_READ) {
    (must(await c.from("files").select(RECEIPT_COLS).in("cost_id", list.slice(i, i + IDS_PER_READ)).is("deleted_at", null)) || [])
      .forEach((r) => out.push(r));
  }
  const replaced = new Set(out.map((f) => f.previous_id).filter((v) => v !== null && v !== undefined).map(String));
  return out.filter((f) => !f.deleted_at && !replaced.has(String(f.id)));
}
const indexBy = (rows, key) => { const m = {}; (rows || []).forEach((r) => { m[String(r[key || "id"])] = r; }); return m; };

/** The lookups every ledger row needs, for the costs `costs` (opts: {projects, prices}). */
async function context(c, costs, opts) {
  const o = opts || {};
  const itemIds = costs.map((r) => r.estimate_item_id).filter((v) => v !== null && v !== undefined);
  const [projects, items, employees, receipts, nameOf] = await Promise.all([
    o.projects ? Promise.resolve(o.projects) : loadProjects(),
    byIds(c, "estimate_items", "id, estimate_id, name, description, group_name", "id", itemIds),
    pageAll((cl) => cl.from("employees").select(EMPLOYEE_COLS).order("id", { ascending: true })),
    receiptsOf(c, costs.map((r) => r.id)),
    nameBook(),
  ]);
  const estimates = await byIds(c, "estimates", "id, kind, number, co_number, name", "id", items.map((i) => i.estimate_id));
  const byCost = {};
  receipts.forEach((f) => {
    if (f.cost_id === null || f.cost_id === undefined) return;
    (byCost[String(f.cost_id)] = byCost[String(f.cost_id)] || []).push({ id: f.id, name: f.name || "receipt", storage: f.storage || "cloud",
      path: f.storage_path || null, preview: f.preview_path || null, mime: f.mime || "", size: f.size || null, created_at: f.created_at });
  });
  Object.keys(byCost).forEach((k) => byCost[k].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")) || a.id - b.id));
  return {
    projects: indexBy(projects), items: indexBy(items), estimates: indexBy(estimates), employees: indexBy(employees),
    receipts: byCost, nameOf, prices: o.prices,
  };
}

/** Everything the ledger screen draws: {rows, employees: [{id, full_name, active}], invoices, cards}. */
export async function loadLedger(opts) {
  const c = await db();
  const [costs, invoices] = await Promise.all([
    pageAll((cl) => cl.from("costs").select(COST_COLS).order("cost_date", { ascending: false }).order("id", { ascending: false })),
    pageAll((cl) => cl.from("invoices").select("id, project_id, invoice_date, status, deleted_at, invoice_lines(amount)")
      .order("id", { ascending: true })),
  ]);
  const ctx = await context(c, costs, { prices: (opts || {}).prices });
  return {
    rows: costs.map((r) => toLedgerRow(r, ctx)),
    employees: Object.keys(ctx.employees).map((k) => ctx.employees[k]).sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""))),
    invoices,
    cards: CARDS,
  };
}

/** Timesheet hours in [from, to] (company days) by employee: {rows: [{id, name, hours}], total}. */
export async function hoursBetween(from, to) {
  const rows = await pageAll((cl) => {
    let q = cl.from("timesheets").select("id, employee_id, work_date, kind, hours, calculated_hours").order("id", { ascending: true });
    if (from) q = q.gte("work_date", from);
    if (to) q = q.lte("work_date", to);
    return q;
  });
  const c = await db();
  const emps = await byIds(c, "employees", EMPLOYEE_COLS, "id", rows.map((r) => r.employee_id));
  return hoursByEmployee(rows, indexBy(emps));
}

/** One project's costs as ledger rows (newest first). */
export async function projectExpenses(projectId, opts) {
  const c = await db();
  const pid = idOf(projectId);
  const costs = await pageAll((cl) => cl.from("costs").select(COST_COLS).eq("project_id", pid)
    .order("cost_date", { ascending: false }).order("id", { ascending: false }));
  const ctx = await context(c, costs, { prices: (opts || {}).prices });
  return costs.map((r) => toLedgerRow(r, ctx));
}

/** One project's bills (with payments) and invoices (with lines and client payments). */
export async function projectPayments(projectId) {
  const c = await db();
  const pid = idOf(projectId);
  const [bills, invoices] = await Promise.all([
    c.from("bills").select(BILL_COLS).eq("project_id", pid).order("id", { ascending: true }).then(must),
    c.from("invoices").select(INVOICE_COLS).eq("project_id", pid).order("invoice_date", { ascending: false }).then(must),
  ]);
  return { bills: (bills || []).filter((b) => !b.deleted_at), invoices: (invoices || []).filter((i) => !i.deleted_at) };
}

/** A signed URL for one receipt (cloud rows only; a local row lives on the office computers). */
export async function receiptUrl(file, seconds, preview) {
  if (!file || file.storage === "local") return null;
  const path = preview && file.preview ? file.preview : file.path;
  return path ? signedUrl(path, seconds || 120) : null;
}

/* ── writes ── */
function cleanIds(ids) {
  const list = Array.from(new Set((ids || []).map((v) => idOf(v)).filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0)));
  if (!list.length) throw Object.assign(new Error("Nothing was selected."), { code: "22023", status: 400 });
  if (list.length > MAX_IDS) throw Object.assign(new Error("At most " + MAX_IDS + " rows at a time."), { code: "22023", status: 400 });
  return list;
}
/** The RPC's answer ({changed: [ids], unchanged: [ids], refused: [{id, reason}]}) as {changed, unchanged, refused}. */
export function outcome(res, asked) {
  const r = Array.isArray(res) ? res[0] || {} : res || {};
  const refused = Array.isArray(r.refused) ? r.refused.map((x) => (x && typeof x === "object" ? { id: x.id, reason: String(x.reason || x.message || "Could not change it.") }
    : { id: x, reason: "Could not change it." })) : [];
  const count = (v) => (Array.isArray(v) ? v.length : Number.isFinite(Number(v)) ? Number(v) : null);
  const unchanged = count(r.unchanged) || 0;
  let changed = count(r.changed);
  if (changed === null) changed = Math.max(0, (asked || 0) - refused.length - unchanged);
  return { changed, unchanged, refused };
}

export async function tagCosts(ids, card) {
  const list = cleanIds(ids);
  const id = String(card == null ? "" : card).trim();
  if (!CARDS.some((x) => x.id === id)) throw Object.assign(new Error("That is not one of the payment methods."), { code: "22023", status: 400 });
  const c = await db();
  return outcome(must(await c.rpc(RPC.tag.name, RPC.tag.args(list, id))), list.length);
}

export async function reconcileCosts(ids, on) {
  const list = cleanIds(ids);
  const c = await db();
  return outcome(must(await c.rpc(RPC.reconcile.name, RPC.reconcile.args(list, on))), list.length);
}

/** Store `employeeId` against the rows `ids` as confirmed (null: nobody). */
export async function confirmEmployee(ids, employeeId) {
  const list = cleanIds(ids);
  const emp = employeeId === null ? null : idOf(employeeId);
  if (emp !== null && typeof emp !== "number") throw Object.assign(new Error("Which employee?"), { code: "22023", status: 400 });
  const c = await db();
  return outcome(must(await c.rpc(RPC.confirm.name, RPC.confirm.args(list, emp))), list.length);
}

/* ── adding and correcting a cost (no delete) ── */
export const COST_WRITE = Object.freeze(["project_id", "kind", "cost_date", "description", "vendor", "amount", "hours", "rate",
  "estimate_item_id", "card"]);
const COST_EDIT = COST_WRITE.filter((k) => k !== "project_id");

function pick(obj, keys) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    if (keys.indexOf(k) === -1) throw new Error("not a cost column this page writes: " + k);
    out[k] = obj[k];
  });
  return out;
}

export async function getCost(id) {
  const c = await db();
  const rows = must(await c.from("costs").select(COST_COLS).eq("id", idOf(id))) || [];
  return rows[0] || null;
}

export async function addCost(fields) {
  const row = pick(fields, COST_WRITE);
  if (row.project_id === undefined || row.project_id === null) throw Object.assign(new Error("A cost belongs to a project."), { code: "22023", status: 400 });
  row.project_id = idOf(row.project_id);
  if (row.estimate_item_id !== undefined && row.estimate_item_id !== null) row.estimate_item_id = idOf(row.estimate_item_id);
  return insertOne("costs", row, COST_COLS);
}

export async function updateCost(row, patch) {
  const body = pick(patch, COST_EDIT);
  if (body.estimate_item_id !== undefined && body.estimate_item_id !== null) body.estimate_item_id = idOf(body.estimate_item_id);
  if (!Object.keys(body).length) return row;
  return versioned("costs", idOf(row.id), row.version, body, COST_COLS);
}

/** The project's live estimate lines (not an archived estimate's), in estimate and line order; plus the line
    `keepId` whatever its estimate (a cost's present line). `prices` false: the labels amount-free (lineLabel). */
export async function lineChoices(projectId, keepId, prices) {
  const pid = idOf(projectId);
  const keep = keepId === null || keepId === undefined || keepId === "" ? null : String(keepId);
  const [items, estimates] = await Promise.all([
    pageAll((cl) => cl.from("estimate_items").select("id, estimate_id, name, description, group_name, sort, deleted_at").eq("project_id", pid)
      .order("id", { ascending: true })),
    pageAll((cl) => cl.from("estimates").select("id, kind, number, co_number, name, archived_at, deleted_at").eq("project_id", pid)
      .order("id", { ascending: true })),
  ]);
  const est = {}, all = {};
  estimates.forEach((e) => { all[String(e.id)] = e; if (!e.deleted_at && !e.archived_at) est[String(e.id)] = e; });
  const live = (i) => !i.deleted_at && !!est[String(i.estimate_id)];
  const order = (e) => (!e ? 2e6 : e.kind === "change_order" ? 1e6 + Number(e.co_number || 0) : Number(e.number || 0));
  const why = (i) => {
    const e = all[String(i.estimate_id)];
    return e && !e.deleted_at && !i.deleted_at ? " (archived estimate)" : " (removed)";
  };
  return items.filter((i) => live(i) || (keep !== null && String(i.id) === keep))
    .sort((a, b) => order(all[String(a.estimate_id)]) - order(all[String(b.estimate_id)]) || a.estimate_id - b.estimate_id ||
      Number(a.sort || 0) - Number(b.sort || 0) || a.id - b.id)
    .map((i) => ({ id: i.id, label: lineLabel(i, all[String(i.estimate_id)] || null, prices) + (live(i) ? "" : why(i)) }));
}
