/* Takeoffs and the Material List on Portal 2 (BLUEPRINT 3.3.11 "Takeoffs and material list"; Q12: view and
   print only — the takeoff grid stays in DCR Desktop 2; Q20: the old .takeoff plan files stay on the old
   portal).

   Ports of DCR Desktop 2's dcrdesk/printing/figures.py (takeoff_levels, unit_price, row_total, quote_totals)
   and printing/takeoffs.py (the Material List and the Material Quote), so the paper a crew or a lumber
   yard reads is the same from the office or a phone:
   * rows -> levels -> categories -> sub-categories, each in the order its first row comes (rows by sort,
     then id); blank names are their own group ("(no level)", no band for a blank category or
     sub-category unless something under it is named);
   * the Material Quote (people with prices only): line total = qty × unit price in cents, a subtotal
     per level, then Subtotal, Sales tax at settings.tax_rate percent and GRAND TOTAL. A row without its
     price (no prices switch, or the price row missing) never prints as $0.00: the sheet is the Material
     List then.
   The Material List itself never shows money, and amounts typed into its words are masked: it goes to
   the yard and the crew.

   Pure module: no DOM, no network. */

import { toCents, mulCents, pctOfCents, parseDec, lowerPg } from "./estimates.js";

function sortNum(v) {
  const d = parseDec(v);
  return d ? Number(d.n) / Math.pow(10, d.s) : Infinity;
}

/** Rows by sort (blank last), then id. */
export function rowOrder(a, b) {
  const x = sortNum(a && a.sort), y = sortNum(b && b.sort);
  if (x !== y) return x < y ? -1 : 1;
  return Number((a && a.id) || 0) - Number((b && b.id) || 0);
}

function trimmed(v) { return String(v == null ? "" : v).trim(); }
function bucket(name) { return { name, rows: [], children: [] }; }
function child(b, name) {
  const k = lowerPg(name);
  let c = b.children.find(function (x) { return lowerPg(x.name) === k; });
  if (!c) { c = bucket(name); b.children.push(c); }
  return c;
}

/** Every row of a bucket, in order (its own, then its children's). */
export function allRows(b) {
  let out = b.rows.slice();
  b.children.forEach(function (c) { out = out.concat(allRows(c)); });
  return out;
}

/** Rows -> [{name (level), children: [{name (category), children: [{name (sub), rows}]}]}]. */
export function takeoffLevels(rows) {
  const root = bucket("");
  (rows || []).filter(function (r) { return r && typeof r === "object"; }).slice().sort(rowOrder).forEach(function (r) {
    const level = child(root, trimmed(r.level));
    const cat = child(level, trimmed(r.category));
    const sub = child(cat, trimmed(r.subcategory));
    sub.rows.push(r);
  });
  return root.children;
}

/** The row's unit price in cents, or null (no prices, or none set). */
export function unitPrice(row) {
  const p = row && row.prices;
  if (!p || typeof p !== "object" || p.unit_price === null || p.unit_price === undefined) return null;
  return toCents(p.unit_price);
}

/** qty × unit price in cents (blank qty or price: 0): the database's line_total when it sent one. */
export function rowTotal(row) {
  const p = row && row.prices;
  if (!p || typeof p !== "object" || p.unit_price === null || p.unit_price === undefined) return 0;
  if (p.line_total !== null && p.line_total !== undefined) return toCents(p.line_total) || 0;
  return mulCents(row.qty, p.unit_price);
}

/** Every row carries its price row (an empty list counts as priced). */
export function rowsPriced(rows) {
  return (rows || []).every(function (r) { return r && r.prices && typeof r.prices === "object"; });
}

/** {subtotal, ratePct, tax, total} in cents; a negative rate counts as 0. */
export function quoteTotals(rows, ratePct) {
  const subtotal = (rows || []).reduce(function (s, r) { return s + rowTotal(r); }, 0);
  const d = parseDec(ratePct);
  const rate = d && d.n > 0n ? ratePct : 0;
  const tax = pctOfCents(subtotal, rate);
  return { subtotal, ratePct: rate, tax, total: subtotal + tax };
}

/** The words of a row: the item name as typed, else the catalog material's code. */
export function rowItemName(row) {
  const own = String((row && row.item_name) || "").trim();
  if (own) return row.item_name;
  return (row && row.material_code) || "";
}

/** The unit as typed. */
export function rowUnit(row) {
  return String((row && row.unit) || "");
}

/**
 * The answer of rpc takeoff_print (M5a: {prices, project, takeoffs [{takeoff, item {id, estimate_id, name,
 * estimate_label} | null, rows [...] [, subtotal]}] [, totals {subtotal, tax_rate, tax, total}]}) -> {prices,
 * project, taxRate, takeoffs: [{...takeoff, item, rows (in print order, each with prices {unit_price,
 * line_total} only when the database sent them), lines, levels, priced}] newest first (date, then id)}.
 * Without the prices switch the database sent no price key and scrubbed the typed words.
 */
export function fromTakeoffPrint(answer) {
  const a = answer || {};
  const list = (Array.isArray(a.takeoffs) ? a.takeoffs : []).filter(function (x) { return x && x.takeoff; }).map(function (x) {
    const rows = (Array.isArray(x.rows) ? x.rows : []).map(function (r) {
      const out = Object.assign({}, r);
      delete out.unit_price; delete out.line_total;
      if ("unit_price" in r) out.prices = { unit_price: r.unit_price, line_total: r.line_total };
      return out;
    }).sort(rowOrder);
    return Object.assign({}, x.takeoff, { item: x.item || null, rows, lines: rows.length, levels: takeoffLevels(rows), priced: rowsPriced(rows) });
  });
  list.sort(function (p, q) {
    const x = String(p.takeoff_date || ""), y = String(q.takeoff_date || "");
    if (x !== y) return x < y ? 1 : -1;
    return Number(q.id || 0) - Number(p.id || 0);
  });
  const t = a.totals && typeof a.totals === "object" ? a.totals : null;
  return { prices: !!a.prices, project: a.project || null, taxRate: t ? t.tax_rate : null, takeoffs: list };
}

/** A band's words: "(no level)" for a blank level. */
export function levelName(name) { return name ? name : "(no level)"; }

/** Whether a category band is drawn: it is named, or one of its sub-categories is. */
export function categoryBand(cat) {
  return !!cat.name || cat.children.some(function (s) { return !!s.name; });
}
