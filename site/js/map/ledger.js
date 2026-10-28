/* The expense ledger — the arithmetic, the grouping and the honesty (port of the old lib/ledger.js and the
   reading half of lib/ledger-handler.js; BLUEPRINT 3.3.11 "Expenses and Receipts (ledger)", Appendix A
   "ledger"; MODULES §6 "ledger.html").

   One table, folded several ways. The accountant's summaries — by project, by employee, by card, by month,
   by kind — are group-by headers over the SAME rows, not separate screens, so a header total and the rows
   under it come out of one function and cannot disagree.

   ── what counts as cost, and what does not (BLUEPRINT 3.3.11) ──────────────────────────────────────────
   A DCR Desktop 2 `costs` row has one kind. Cost = the materials, subcontractor and labour rows
   (COST_KINDS). Billed-out money (invoices to the client) is revenue: it is shown on its own, greyed, and
   never added to a cost figure. Equipment and "other" rows are real rows: they are listed and totalled in
   their own column ("Equipment / other") and are NOT inside Cost — kept apart, out loud, never dropped.
   A cost's amount is `amount`; a labour row priced by the hour with no amount yet is hours × rate (the
   database computes the same: Desktop 2 money_logic.cost_amount).

   ── the card vocabulary ─────────────────────────────────────────────────────────────────────────────
   Closed on purpose (M5b: costs.card is check-constrained to these ids). Free text is how one card becomes
   "Amex 1007", "AMEX-1007" and "amex 1007" — three groups. A row with no card (NULL, or the id
   "untagged") is "Not tagged yet" and is never shown as a payment method.

   ── the employee ────────────────────────────────────────────────────────────────────────────────────
   costs.employee_id + employee_source (M5b: 'inferred' | 'confirmed'). The DATABASE infers a labour row's crew
   member from its words (app.cost_employee_guess: the "who" or the first words of the description, exactly one
   employee) — one rule, in Postgres (BLUEPRINT 2.1 principle 1); the browser never guesses. An inferred name is
   labelled `inferred` everywhere it appears (row, group header, CSV) and never added to a confirmed figure.
   Confirm (rpc confirm_cost_employee) stores it as confirmed, so the guess drains into fact one click at a time.

   ── receipts ────────────────────────────────────────────────────────────────────────────────────────
   files.cost_id (M5b) links a receipt to its row, so one row can own several files (a two-page invoice, a
   photo and its re-scan). It replaces the old "… - ID 145_20251030.jpg" file-name convention and its slow
   folder walk: a row has its receipts or it has none, nothing is "not checked yet".

   Gates (they hide controls; the database decides — BLUEPRINT 2.1 principle 1):
   * seesLedger(me): app.can_financials() — an admin, or anyone with the financials switch (costs RLS);
   * canTag(me):     app.can_edit('money') — an admin, or a manager or accountant with financials.

   Pure module: no DOM, no network (node tests import it). */

import { addDays, ymd } from "./pacific.js";
import { csvCell } from "./timesheets.js";
import { maskAmounts } from "../money-mask.js";
import { scrubMoney } from "../scrub-money.js";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function num(v) {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return 0;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function hasNumber(v) { return v !== null && v !== undefined && v !== "" && typeof v !== "boolean" && Number.isFinite(Number(v)); }
const cents = (n) => Math.round(num(n) * 100);
export const round2 = (n) => Math.round(num(n) * 100) / 100;
const text = (v) => String(v == null ? "" : v).trim();

export function money(n) {
  const v = round2(n);
  const t = "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? "-" + t : t;
}

/** Some descriptions were typed into a rich-text box and carry their own markup: read as one plain line. */
export function stripML(v) {
  return String(v == null ? "" : v)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── kinds and cost ─────────────────────────────────────────────────── */
export const KINDS = Object.freeze(["material", "subcontractor", "labor", "equipment", "other"]);
export const KIND_LABELS = Object.freeze({ material: "Materials", subcontractor: "Subcontractor", labor: "Labour",
  equipment: "Equipment", other: "Other" });
/** The kinds that are cost (BLUEPRINT 3.3.11: materials + subcontractor + labour). */
export const COST_KINDS = Object.freeze(["material", "subcontractor", "labor"]);

export function kindOf(row) { const k = text(row && row.kind); return KINDS.indexOf(k) === -1 ? "other" : k; }

/** The row's amount (labour by the hour: hours × rate while no amount is stored). */
export function amountOf(row) {
  const r = row || {};
  if (kindOf(r) === "labor" && hasNumber(r.hours) && hasNumber(r.rate) && !hasNumber(r.amount)) return round2(num(r.hours) * num(r.rate));
  return round2(r.amount);
}
export function inCost(row) { return COST_KINDS.indexOf(kindOf(row)) !== -1; }
/** What the row adds to Cost: its amount for a materials, subcontractor or labour row, else 0. */
export function rowCost(row) { return inCost(row) ? amountOf(row) : 0; }
/** A row with no amount at all is a real record but not spend: hidden by default, always counted out loud. */
export function hasAmount(row) { return cents(amountOf(row)) !== 0; }

/* ── the card vocabulary (M5b: costs.card) ──────────────────────────── */
export const CARDS = Object.freeze([
  { id: "untagged", label: "Not tagged yet", kind: "none" },
  { id: "card-amex", label: "Company Amex", kind: "card" },
  { id: "card-visa", label: "Company Visa", kind: "card" },
  { id: "card-fuel", label: "Fuel card", kind: "card" },
  { id: "check", label: "Check", kind: "other" },
  { id: "account", label: "On account (net terms)", kind: "other" },
  { id: "employee", label: "Employee out of pocket", kind: "other" },
  { id: "cash", label: "Cash", kind: "other" },
]);
const CARD_IDS = CARDS.map((c) => c.id);
export function isCardId(v) { return CARD_IDS.indexOf(text(v)) !== -1; }
/** The stored card as one of the ids: NULL / "" / "untagged" -> "untagged"; anything unknown stays itself. */
export function cardOf(v) { const id = text(v).toLowerCase(); return id || "untagged"; }
export function cardLabel(v) {
  const id = cardOf(v);
  const hit = CARDS.find((c) => c.id === id);
  return hit ? hit.label : id;
}
export function isTagged(row) { return cardOf(row && row.card) !== "untagged"; }

/* ── periods ────────────────────────────────────────────────────────
   The owner asked for a 30-day default and it is honoured literally; the count travels with every
   period chip, so a screen that looks empty always says why. Days are the company's. */
export const PERIODS = Object.freeze([
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "365", label: "Last 12 months", days: 365 },
  { id: "ytd", label: "This year", days: null },
  { id: "all", label: "All records", days: null },
]);

export function dayKey(v) {
  const s = text(v).slice(0, 10);
  return DAY_RE.test(s) ? s : "";
}
/** The company day of a stamp (timestamptz: card_at, reconciled_at); a date stays as written. */
export function stampDay(v) {
  const s = text(v);
  if (!s) return "";
  if (DAY_RE.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? dayKey(s) : ymd(d);
}

/** {from, to} ("YYYY-MM-DD", both included) or null for "everything". */
export function periodBounds(period, todayKey) {
  const today = dayKey(todayKey);
  if (!today || period === "all") return null;
  if (period === "ytd") return { from: today.slice(0, 4) + "-01-01", to: today };
  const spec = PERIODS.find((p) => p.id === String(period));
  const days = spec && spec.days ? spec.days : 30;
  return { from: addDays(today, -(days - 1)), to: today };
}
export function inPeriod(row, bounds) {
  if (!bounds) return true;
  const d = dayKey(row && row.date);
  if (!d) return false;                  // an undated row is counted separately
  return d >= bounds.from && d <= bounds.to;
}
export function undated(rows) { return (rows || []).filter((r) => !dayKey(r && r.date)).length; }

/* ── the employee ───────────────────────────────────────────────────── */
/** {id, name, source: "confirmed" | "inferred" | "none"} as the database holds it (a link without a source is
    never shown as confirmed). */
export function employeeOf(cost, employees) {
  const r = cost || {};
  if (r.employee_id !== null && r.employee_id !== undefined) {
    const e = (employees || {})[String(r.employee_id)];
    const name = text(e && e.full_name) || "Employee " + r.employee_id;
    return { id: r.employee_id, name, source: r.employee_source === "confirmed" ? "confirmed" : "inferred" };
  }
  return { id: null, name: "", source: "none" };
}

/* ── one row ────────────────────────────────────────────────────────── */
/** The estimate line a cost is booked to: "Walls — Exterior walls" (a change order: "CO #2 · …"). prices false (the
    financials switch without prices): its words amount-free by the database's no-price rule (app.priceless_text, as
    the Estimate tab and DCR Desktop 2's money_logic.item_choices) - display only, the line is chosen by its id. */
export function lineLabel(item, estimate, prices) {
  if (!item) return "";
  const shown = prices === false ? function (t) { return text(scrubMoney(maskAmounts(t))); } : text;
  const name = shown(item.name) || shown(item.description) || "Item " + item.id;
  const g = shown(item.group_name);
  const co = estimate && estimate.kind === "change_order" ? "CO #" + (estimate.co_number || "") + " · " : "";
  return co + (g && g.toLowerCase() !== name.toLowerCase() ? g + " — " : "") + name;
}

/** A DCR Desktop 2 `costs` row -> the ledger row every screen, the CSV and the printed sheet read.
    ctx: {projects: {id: project}, items: {id: item}, estimates: {id: estimate}, employees: {id: employee},
    receipts: {costId: [file]}, nameOf: uid -> name, prices: the prices switch (false: the line's words amount-free,
    lineLabel)}. */
export function toLedgerRow(cost, ctx) {
  const c = cost || {};
  const x = ctx || {};
  const p = (x.projects || {})[String(c.project_id)] || null;
  const item = c.estimate_item_id != null ? (x.items || {})[String(c.estimate_item_id)] || null : null;
  const est = item ? (x.estimates || {})[String(item.estimate_id)] || null : null;
  const kind = kindOf(c);
  const amount = amountOf(c);
  const who = employeeOf(c, x.employees);
  const nameOf = typeof x.nameOf === "function" ? x.nameOf : () => "";
  const number = p ? text(p.number || p.internalIDNumber) : "";
  const pname = p ? text(p.name || p.projectName) : "";
  return {
    id: c.id, version: c.version, projectId: c.project_id,
    projectNumber: number,
    projectLabel: (number && pname ? number + " — " + pname : number || pname) || (c.project_id != null ? "Project " + c.project_id : ""),
    date: dayKey(c.cost_date), kind, kindLabel: KIND_LABELS[kind],
    description: stripML(c.description), vendor: text(c.vendor),
    amount, hours: hasNumber(c.hours) ? num(c.hours) : null, rate: hasNumber(c.rate) ? num(c.rate) : null,
    materials: kind === "material" ? amount : 0,
    contractors: kind === "subcontractor" ? amount : 0,
    labor: kind === "labor" ? amount : 0,
    other: kind === "equipment" || kind === "other" ? amount : 0,
    cost: rowCost({ kind, amount }),
    card: cardOf(c.card), cardBy: c.card_by ? nameOf(c.card_by) || "" : "", cardAt: c.card_at || null,
    reconciledAt: c.reconciled_at || null, reconciledBy: c.reconciled_by ? nameOf(c.reconciled_by) || "" : "",
    employeeId: who.id, employeeName: who.name, employeeSource: who.source,
    receipts: ((x.receipts || {})[String(c.id)] || []).slice(),
    itemId: c.estimate_item_id == null ? null : c.estimate_item_id,
    group: item ? lineLabel(item, est, x.prices) : "",
  };
}

/* ── search ─────────────────────────────────────────────────────────
   Reaches the description, vendor, project, line, employee, card and kind — and AMOUNTS, because typing a
   figure off a statement is the single most common thing a bookkeeper does with this screen. */
export function searchMatch(row, q) {
  const needle = text(q).toLowerCase();
  if (!needle) return true;
  const hay = [row.description, row.vendor, row.projectLabel, row.group, row.employeeName, cardLabel(row.card), row.kindLabel]
    .map(text).join("  ").toLowerCase();
  if (hay.indexOf(needle) !== -1) return true;
  const asNum = Number(needle.replace(/[$,]/g, ""));
  if (needle !== "" && Number.isFinite(asNum) && /\d/.test(needle)) {
    return [row.amount, row.materials, row.contractors, row.labor, row.other, row.cost]
      .some((v) => num(v) !== 0 && cents(v) === Math.round(asNum * 100));
  }
  return false;
}

/* ── grouping ───────────────────────────────────────────────────────── */
export const DIMENSIONS = Object.freeze([
  { id: "none", label: "No grouping" },
  { id: "project", label: "By project" },
  { id: "employee", label: "By employee" },
  { id: "card", label: "By card / payment" },
  { id: "month", label: "By month" },
  { id: "kind", label: "By kind" },
]);
const LAST = "\uffff";

function keyOf(row, dim) {
  if (dim === "project") return { key: String(row.projectId), label: row.projectLabel || "Project " + row.projectId };
  if (dim === "card") {
    const id = cardOf(row.card);
    return { key: id, label: cardLabel(id), pinned: id === "untagged" };
  }
  if (dim === "employee") {
    if (!row.employeeName) return { key: LAST + "-none", label: "Not attributed to anybody", pinned: true };
    return { key: row.employeeSource + ":" + row.employeeId, label: row.employeeName, source: row.employeeSource };
  }
  if (dim === "month") {
    const d = dayKey(row.date);
    return d ? { key: d.slice(0, 7), label: d.slice(0, 7) } : { key: LAST + "-undated", label: "No date", pinned: true };
  }
  if (dim === "kind") return { key: row.kind, label: KIND_LABELS[row.kind] + (inCost(row) ? "" : " (not in Cost)") };
  return { key: "all", label: "All records" };
}

/** null for "none"; otherwise [{key, label, pinned, source, rows, cost, other, count, withReceipt, reconciled}].
    Untagged and unattributed stay on top: the danger is not that day one looks empty, it is that week three
    looks complete. */
export function groupRows(rows, dim) {
  if (!dim || dim === "none") return null;
  const map = new Map();
  for (const row of rows || []) {
    const k = keyOf(row, dim);
    if (!map.has(k.key)) map.set(k.key, { key: k.key, label: k.label, pinned: !!k.pinned, source: k.source || "", rows: [], c: 0, o: 0 });
    const g = map.get(k.key);
    g.rows.push(row);
    g.c += cents(row.cost);
    g.o += cents(row.other);
  }
  const out = Array.from(map.values()).map((g) => ({
    key: g.key, label: g.label, pinned: g.pinned, source: g.source, rows: g.rows,
    cost: g.c / 100, other: g.o / 100, count: g.rows.length,
    withReceipt: g.rows.filter((r) => r.receipts && r.receipts.length).length,
    reconciled: g.rows.filter((r) => !!r.reconciledAt).length,
  }));
  out.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.cost - a.cost || b.other - a.other ||
    String(a.label).localeCompare(String(b.label)));
  return out;
}

/** The totals of a set of rows, in cents (one pass: a header and its rows are the same arithmetic). */
export function summarize(rows) {
  const list = rows || [];
  const sum = (k) => list.reduce((n, r) => n + cents(r[k]), 0) / 100;
  return {
    count: list.length,
    cost: sum("cost"), materials: sum("materials"), contractors: sum("contractors"), labor: sum("labor"), other: sum("other"),
    withReceipt: list.filter((r) => r.receipts && r.receipts.length).length,
    noReceipt: list.filter((r) => !(r.receipts && r.receipts.length)).length,
    receiptFiles: list.reduce((n, r) => n + ((r.receipts && r.receipts.length) || 0), 0),
    reconciled: list.filter((r) => !!r.reconciledAt).length,
    tagged: list.filter(isTagged).length,
    inferred: list.filter((r) => r.employeeSource === "inferred").length,
  };
}

/** The span actually present in a set of rows (the screen says what it shows, not what was asked for). */
export function span(rows) {
  const days = (rows || []).map((r) => dayKey(r.date)).filter(Boolean).sort();
  return days.length ? { from: days[0], to: days[days.length - 1] } : null;
}

function newestFirst(a, b) {
  const x = dayKey(a.date), y = dayKey(b.date);
  return x < y ? 1 : x > y ? -1 : (Number(b.id) || 0) - (Number(a.id) || 0);
}

/** Everything the ledger screen shows for one choice of period, search, grouping and "show rows with no
    amount" — the old server's GET, now run in the browser over the rows the database let this person read.
    opts: {period, q, group, zero, today}. */
export function ledgerView(rows, opts) {
  const o = opts || {};
  const all = (rows || []).slice().sort(newestFirst);
  const period = PERIODS.some((p) => p.id === String(o.period)) ? String(o.period) : "30";
  const bounds = periodBounds(period, o.today);
  const zero = !!o.zero;
  const q = text(o.q).slice(0, 200);
  const dim = DIMENSIONS.some((d) => d.id === o.group) ? o.group : "none";
  let visible = all.filter((r) => inPeriod(r, bounds));
  const inPeriodCount = visible.length;
  if (!zero) visible = visible.filter(hasAmount);
  const noAmount = inPeriodCount - visible.length;
  if (q) visible = visible.filter((r) => searchMatch(r, q));
  const counts = {};
  PERIODS.forEach((p) => {
    const b = periodBounds(p.id, o.today);
    counts[p.id] = all.filter((r) => inPeriod(r, b) && (zero || hasAmount(r))).length;
  });
  return {
    rows: visible, groups: groupRows(visible, dim), totals: summarize(visible), span: span(visible),
    period, bounds, group: dim, q, zero, counts,
    excluded: { all: all.length, outsidePeriod: all.length - inPeriodCount, noAmount, undated: undated(all) },
    // a search that finds nothing in this window says how many it finds in all of them
    matchesAllTime: q ? all.filter((r) => (zero || hasAmount(r)) && searchMatch(r, q)).length : null,
  };
}

/** Billed out (invoices sent to the client) inside a window: {total, count} — revenue, shown, never added. A draft
    was not billed yet and a void one never was (DCR Desktop 2's Invoices tab keeps drafts apart the same way). */
export function billedOut(invoices, bounds) {
  let c = 0, n = 0;
  (invoices || []).forEach((iv) => {
    if (!iv || iv.deleted_at || iv.status === "void" || iv.status === "draft") return;
    const d = dayKey(iv.invoice_date);
    if (bounds && (!d || d < bounds.from || d > bounds.to)) return;
    const lines = Array.isArray(iv.invoice_lines) ? iv.invoice_lines : [];
    c += lines.reduce((s, l) => s + cents(l && l.amount), 0);
    n += 1;
  });
  return { total: c / 100, count: n };
}

/** Hours by employee for the side block (timesheets: work rows; calculated hours first, then hours). */
export function hoursByEmployee(timesheets, employees) {
  const by = new Map();
  (timesheets || []).forEach((t) => {
    if (!t || (t.kind && t.kind !== "work")) return;
    const h = hasNumber(t.calculated_hours) ? num(t.calculated_hours) : num(t.hours);
    if (!h) return;
    const key = String(t.employee_id);
    by.set(key, (by.get(key) || 0) + Math.round(h * 100));
  });
  const rows = Array.from(by.entries()).map(([id, h]) => {
    const e = (employees || {})[id];
    return { id, name: text(e && e.full_name) || "Employee " + id, hours: h / 100 };
  }).sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
  return { rows, total: rows.reduce((s, r) => s + Math.round(r.hours * 100), 0) / 100 };
}

/* ── the CSV (built in the browser: the formula guard of csvCell, a BOM and CRLF when downloaded) ── */
/** A money cell: plain digits with two decimals (a number is never a formula, a minus sign included). */
export function csvMoney(v) { return round2(v).toFixed(2); }
export const CSV_HEAD = Object.freeze(["Date", "Project", "Description", "Kind", "Vendor", "Materials", "Subcontractors", "Labor",
  "Equipment / other (not in cost)", "Cost", "Paid with", "Employee", "Employee source", "Receipts", "Reconciled", "Estimate line", "Ledger row ID"]);
export function ledgerCsvRows(rows) {
  return [CSV_HEAD.slice()].concat((rows || []).map((r) => [
    dayKey(r.date), r.projectLabel || "", r.description || "", r.kindLabel || "", r.vendor || "",
    { money: r.materials }, { money: r.contractors }, { money: r.labor }, { money: r.other }, { money: r.cost },
    cardLabel(r.card), r.employeeName || "",
    // so an inference never leaves the building disguised as a fact
    r.employeeSource || "none",
    String((r.receipts && r.receipts.length) || 0), stampDay(r.reconciledAt),
    r.group || "", String(r.id == null ? "" : r.id),
  ]));
}
/** Rows of cells -> CSV text with CRLF line ends; {money: n} cells are written as plain numbers, every
    other cell through csvCell (text a spreadsheet would run — = + - @, tab, return — gets an apostrophe). */
export function csvText(rows) {
  return rows.map((r) => r.map((c) => (c && typeof c === "object" && "money" in c ? csvMoney(c.money) : csvCell(c))).join(",")).join("\r\n") + "\r\n";
}

/* ── gates (UI only) ────────────────────────────────────────────────── */
function active(me) { return !!me && me.active !== false && me.role !== "agents"; }
/** app.can_financials(): costs, bills, payments, invoices are read with it (Appendix D). */
export function seesLedger(me) { return active(me) && (me.role === "admin" || !!me.can_see_financials); }
/** app.can_edit('money'): tag a card, reconcile, confirm an employee. */
export function canTag(me) {
  return active(me) && (me.role === "admin" || ((me.role === "manager" || me.role === "accountant") && !!me.can_see_financials));
}
